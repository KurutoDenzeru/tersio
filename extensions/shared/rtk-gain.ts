// extensions/shared/rtk-gain.ts — measured RTK savings from its own store.
// RTK records every invocation (input/output/saved tokens, savings %, exec
// time) in history.db; `rtk gain` renders the same rows. We read them with
// the sqlite3 CLI (present on macOS; best-effort elsewhere) so the dashboard
// shows measured figures, never estimates. Missing DB/CLI → empty, no throw.
//
// Caveman and Ponytail have no per-command counters (instruction-following
// isn't metered); their gains are bench-measured in BENCHMARK.md and cited
// as static figures wherever RTK rows appear.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface RtkCommandRow {
  command: string;
  count: number;
  saved: number;
  avgPct: number;
  avgMs: number;
}

export interface RtkGain {
  commands: number;
  input: number;
  saved: number;
  avgPct: number;
  totalMs: number;
  byCommand: RtkCommandRow[];
}

const EMPTY: RtkGain = { commands: 0, saved: 0, input: 0, avgPct: 0, totalMs: 0, byCommand: [] };

export function rtkDbPath(): string {
  const override = process.env.TERSIO_RTK_DB;
  if (override) return override;
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'rtk', 'history.db');
  }
  const xdg = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(xdg, 'rtk', 'history.db');
}

function query(db: string, sql: string): string[][] {
  const out = execFileSync('sqlite3', ['-separator', '\t', db, sql], {
    encoding: 'utf8',
    timeout: 5000,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return out
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => line.split('\t'));
}

export function readRtkGain(limit = 10): RtkGain {
  try {
    if (!fs.existsSync(rtkDbPath())) return EMPTY;
    const [[commands = '0', saved = '0', input = '0', avgPct = '0', totalMs = '0'] = []] = query(
      rtkDbPath(),
      'SELECT COUNT(*), COALESCE(SUM(saved_tokens),0), COALESCE(SUM(input_tokens),0), COALESCE(AVG(savings_pct),0), COALESCE(SUM(exec_time_ms),0) FROM commands;',
    );
    const byCommand = query(
      rtkDbPath(),
      `SELECT rtk_cmd, COUNT(*), SUM(saved_tokens), AVG(savings_pct), AVG(exec_time_ms) FROM commands GROUP BY rtk_cmd ORDER BY SUM(saved_tokens) DESC LIMIT ${Math.max(1, Math.floor(limit))};`,
    ).map(([command, count, savedRow, pct, ms]) => ({
      command,
      count: Number(count) || 0,
      saved: Number(savedRow) || 0,
      avgPct: Number(pct) || 0,
      avgMs: Number(ms) || 0,
    }));
    const totalIn = Number(input) || 0;
    return {
      commands: Number(commands) || 0,
      saved: Number(saved) || 0,
      input: totalIn,
      avgPct: totalIn ? ((Number(saved) || 0) / totalIn) * 100 : 0,
      totalMs: Number(totalMs) || 0,
      byCommand,
    };
  } catch {
    return EMPTY;
  }
}
