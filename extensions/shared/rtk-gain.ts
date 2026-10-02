// Savings read from rtk history, never estimated; modes bench in docs/BENCHMARK.md.
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

// The table shows one clipped cell, so bound the command before it crosses the sqlite3 CLI and lands in every /data.json poll.
const MAX_CMD_CHARS = 200;

// A multi-line stored command would derail every row after it; flatten on read.
const CMD_ONE_LINE = `replace(replace(replace(rtk_cmd, char(10), ' '), char(13), ' '), char(9), ' ')`;

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

export function readRtkGain(limit = 10, cutoffMs?: number): RtkGain {
  try {
    if (!fs.existsSync(rtkDbPath())) return EMPTY;
    // View-level cutoff only: rtk's own rows stay untouched. Timestamps that do not parse land on 0 and drop out of a filtered view.
    const where = cutoffMs && cutoffMs > 0
      ? `WHERE CAST(strftime('%s', timestamp) AS INTEGER) >= ${Math.floor(cutoffMs / 1000)}`
      : '';
    const [[commands = '0', saved = '0', input = '0', totalMs = '0'] = []] = query(
      rtkDbPath(),
      `SELECT COUNT(*), COALESCE(SUM(saved_tokens),0), COALESCE(SUM(input_tokens),0), COALESCE(SUM(exec_time_ms),0) FROM commands ${where};`,
    );
    const byCommand = query(
      rtkDbPath(),
      `SELECT substr(${CMD_ONE_LINE}, 1, ${MAX_CMD_CHARS}), COUNT(*), COALESCE(SUM(saved_tokens),0), COALESCE(100.0 * SUM(saved_tokens) / NULLIF(SUM(input_tokens), 0), 0), COALESCE(AVG(exec_time_ms),0) FROM commands ${where} GROUP BY rtk_cmd ORDER BY SUM(saved_tokens) DESC LIMIT ${Math.max(1, Math.floor(limit))};`,
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
