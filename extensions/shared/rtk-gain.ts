// Savings read from rtk history, never estimated; modes bench in docs/BENCHMARK_GUIDE.md.
import fs from 'node:fs';
import path from 'node:path';
import { rtkDirs } from './utils.ts';
import { sqliteRead } from './sqlite.ts';

export interface RtkCommandRow {
  /** The command, or for a grouped read, the leading verb such as `rtk read`. */
  command: string;
  count: number;
  saved: number;
  avgPct: number;
  avgMs: number;
  /** How many distinct full commands this row folds. 1 for an ungrouped row. */
  variants?: number;
}

/** The leading verb of a stored rtk command: `rtk read`, `rtk grep`, `rtk git`. */
function verbOf(command: string): string {
  const words = command.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "rtk";
  // `rtk:toml ps aux` is a variant spelling of `rtk toml`; the colon is a separator, not part of the name.
  const first = words[0]!.replace(/^rtk:/, "rtk ");
  if (first !== "rtk") return first;
  // `rtk git status` reads as the git verb, not as a bare `rtk`.
  return words[1] ? `rtk ${words[1]}` : "rtk";
}

export interface RtkGain {
  commands: number;
  input: number;
  saved: number;
  avgPct: number;
  totalMs: number;
  byCommand: RtkCommandRow[];
  /** False when rtk's own database could not be read: absent, locked, or corrupt. A zero with this false means "not measured"; a zero with it true means rtk really saved nothing. */
  measured: boolean;
}

const EMPTY: RtkGain = { commands: 0, saved: 0, input: 0, avgPct: 0, totalMs: 0, byCommand: [], measured: false };

// The table shows one clipped cell, so bound the command before it reaches /data.json.
const MAX_CMD_CHARS = 200;

// A multi-line stored command would derail every row after it; flatten on read.
const CMD_ONE_LINE = `replace(replace(replace(rtk_cmd, char(10), ' '), char(13), ' '), char(9), ' ')`;

export function rtkDbPath(): string {
  const override = process.env.TERSIO_RTK_DB;
  if (override) return override;
  return path.join(rtkDirs().data, 'history.db');
}

function query(db: string, sql: string): string[][] {
  return sqliteRead(db, sql)
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => line.split('\t'));
}

/** Why the last gain read found nothing, when it found nothing because the database could not be read. */
let lastFailure: string | null = null;

/** The read failure behind a `measured: false` result, or null when the last read succeeded. */
export function rtkGainFailure(): string | null {
  return lastFailure;
}

export function readRtkGain(limit = 10, cutoffMs?: number): RtkGain {
  lastFailure = null;
  try {
    if (!fs.existsSync(rtkDbPath())) {
      lastFailure = `no rtk database at ${rtkDbPath()}`;
      return EMPTY;
    }
    // View-level cutoff only: rtk's rows stay untouched. Unparseable timestamps land on 0 and drop from filtered views.
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
      measured: true,
    };
  } catch (error) {
    // A zero here would claim rtk saved nothing. The caller reads `measured` and says "not measured" instead.
    lastFailure = error instanceof Error ? error.message : String(error);
    return EMPTY;
  }
}

/** The same rows folded by their leading verb, so 7,000 full commands read as a couple dozen. `limit` bounds the folded rows, and `variants` names how many full commands each one hides. */
export function readRtkGainByVerb(limit = 12, cutoffMs?: number): RtkGain {
  lastFailure = null;
  try {
    if (!fs.existsSync(rtkDbPath())) {
      lastFailure = `no rtk database at ${rtkDbPath()}`;
      return EMPTY;
    }
    const where = cutoffMs && cutoffMs > 0
      ? `WHERE CAST(strftime('%s', timestamp) AS INTEGER) >= ${Math.floor(cutoffMs / 1000)}`
      : '';
    const [[commands = '0', saved = '0', input = '0', totalMs = '0'] = []] = query(
      rtkDbPath(),
      `SELECT COUNT(*), COALESCE(SUM(saved_tokens),0), COALESCE(SUM(input_tokens),0), COALESCE(SUM(exec_time_ms),0) FROM commands ${where};`,
    );
    // The verb is derived in JS, because SQLite has no split and the rule differs per spelling.
    const rows = query(
      rtkDbPath(),
      `SELECT ${CMD_ONE_LINE}, COUNT(*), COALESCE(SUM(saved_tokens),0), COALESCE(SUM(input_tokens),0), COALESCE(AVG(exec_time_ms),0) FROM commands ${where} GROUP BY rtk_cmd;`,
    );
    const folded = new Map<string, { count: number; saved: number; input: number; ms: number; variants: number }>();
    for (const [command, count, savedRow, inputRow, ms] of rows) {
      const verb = verbOf(command ?? "");
      const held = folded.get(verb) ?? { count: 0, saved: 0, input: 0, ms: 0, variants: 0 };
      held.count += Number(count) || 0;
      held.saved += Number(savedRow) || 0;
      held.input += Number(inputRow) || 0;
      held.ms += Number(ms) || 0;
      held.variants += 1;
      folded.set(verb, held);
    }
    const byCommand = [...folded.entries()]
      .map(([command, held]) => ({
        command,
        count: held.count,
        saved: held.saved,
        // The verb's own rate: its saved bytes over the bytes it took in.
        avgPct: held.input > 0 ? (held.saved / held.input) * 100 : 0,
        avgMs: held.count > 0 ? held.ms / held.count : 0,
        variants: held.variants,
      }))
      .toSorted((a, b) => b.saved - a.saved)
      .slice(0, Math.max(1, Math.floor(limit)));
    const totalIn = Number(input) || 0;
    return {
      commands: Number(commands) || 0,
      saved: Number(saved) || 0,
      input: totalIn,
      avgPct: totalIn ? ((Number(saved) || 0) / totalIn) * 100 : 0,
      totalMs: Number(totalMs) || 0,
      byCommand,
      measured: true,
    };
  } catch (error) {
    lastFailure = error instanceof Error ? error.message : String(error);
    return EMPTY;
  }
}