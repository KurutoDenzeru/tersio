// extensions/shared/usage-store.ts — tersio-owned usage.db.
// Persists the same per-message rows importSessionTokens derives live (model,
// tokens, cache, cost input, timing, status, tools), so top models, costing,
// cache, CO2 inputs, and activity survive session-file rotation. Sync is
// incremental: a files ledger (mtime+size) skips unchanged transcripts, and
// every read applies the current reset watermark — the store is a cache,
// never a fork. Missing sqlite3 CLI → sync false / read null, callers fall
// back to the live path. Never touches RTK's history.db or host transcripts.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  RECENT_LIMIT,
  canonicalModelId,
  classifyOpencodeMessage,
  classifySessionLine,
  codexModelLabel,
  codexSessionsDir,
  costOf,
  durOf,
  hasPositiveUsage,
  ingestSessionRow,
  newSessionAccum,
  opencodeSessionsDir,
  piSessionsDir,
  sessionsDir,
  walkJsonl,
} from './usage-ledger.ts';
import { tersioDataPath } from '../lib/utils.ts';
import type { RunStatus, SessionTokens } from './usage-ledger.ts';

export function usageDbPath(): string {
  const override = process.env.TERSIO_USAGE_DB;
  if (override) return override;
  return tersioDataPath('usage.db', 'tersio-usage.db');
}

export interface StoredUsage {
  tokens: SessionTokens;
  syncedAt: number;
}

function esc(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

function intOf(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

function nullNum(v: number | undefined): string {
  return v === undefined ? 'NULL' : String(v);
}

function nullStr(v: string | undefined): string {
  return v === undefined ? 'NULL' : esc(v);
}

function run(db: string, sql: string): void {
  // .bail on keeps a chunk atomic: the sqlite CLI otherwise keeps executing
  // past a failed statement and COMMITs the partial chunk, which deletes rows
  // without re-inserting them. .timeout waits out the dashboard server's
  // concurrent reads instead of failing busy at COMMIT.
  execFileSync('sqlite3', ['-cmd', '.bail on', '-cmd', '.timeout 10000', db, sql], { stdio: ['ignore', 'ignore', 'ignore'], timeout: 30000 });
}

function query(db: string, sql: string): string[][] {
  const out = execFileSync('sqlite3', ['-separator', '\t', db, sql], {
    encoding: 'utf8',
    timeout: 30000,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return out
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => line.split('\t'));
}

function ensureSchema(db: string): void {
  fs.mkdirSync(path.dirname(db), { recursive: true });
  run(
    db,
    `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);` +
      `CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, mtime REAL NOT NULL, size INTEGER NOT NULL);` +
      `CREATE TABLE IF NOT EXISTS messages (file TEXT NOT NULL, t REAL, model TEXT NOT NULL,` +
      ` i INTEGER NOT NULL, o INTEGER NOT NULL, d REAL, cr INTEGER NOT NULL, cw INTEGER NOT NULL,` +
      ` usd REAL, st TEXT NOT NULL, code REAL, note TEXT, tools TEXT NOT NULL DEFAULT '[]');` +
      `CREATE INDEX IF NOT EXISTS idx_messages_file ON messages(file);`,
  );
}

function readFiles(db: string): Record<string, { mtime: number; size: number }> {
  const known: Record<string, { mtime: number; size: number }> = {};
  try {
    for (const [p, mtime, size] of query(db, `SELECT path, mtime, size FROM files;`)) {
      known[p] = { mtime: Number(mtime) || 0, size: Number(size) || 0 };
    }
  } catch { /* fresh db */ }
  return known;
}

// One parsed assistant message, as stored. `t` is epoch ms or null when the
// source row carries no usable timestamp (live counts it, skips its recent).
interface StoredRow {
  t: number | null;
  model: string;
  i: number;
  o: number;
  d: number | undefined;
  cr: number;
  cw: number;
  usd: number | undefined;
  st: RunStatus;
  code: number | undefined;
  note: string | undefined;
  tools: string[];
}

function parseFile(text: string): StoredRow[] {
  const rows: StoredRow[] = [];
  let codexProvider: string | null = null;
  let codexModel: string | null = null;
  const codexState = {
    get codexProvider() { return codexProvider; },
    set codexProvider(v: string | null) { codexProvider = v; },
    get codexModel() { return codexModel; },
    set codexModel(v: string | null) { codexModel = v; },
  };
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as Parameters<typeof classifySessionLine>[0];
      const parsed = classifySessionLine(row);
      if (parsed.kind === 'codex_provider') {
        if (parsed.provider) codexProvider = parsed.provider;
        continue;
      }
      // The sync the dashboard reads had no notion of turn_context, so it kept
      // labelling every Codex row codex/<provider> after the live import had
      // been fixed. Both readers now take the label from one helper.
      if (parsed.kind === 'codex_model') {
        if (parsed.model) codexModel = parsed.model;
        continue;
      }
      const ts = row.timestamp;
      const ms = ts === undefined ? NaN : typeof ts === 'number' ? ts : Date.parse(ts);
      const t = Number.isFinite(ms) ? ms : null;
      if (parsed.kind === 'token_row') {
        const usage = parsed.usage ?? {};
        rows.push({
          t,
          model: canonicalModelId(codexModelLabel(codexState, parsed.provider)),
          i: intOf(usage.input),
          o: intOf(usage.output),
          d: undefined,
          cr: intOf(usage.cacheRead),
          cw: intOf(usage.cacheWrite),
          usd: costOf(usage),
          st: 'completed',
          code: undefined,
          note: undefined,
          tools: [],
        });
        continue;
      }
      if (parsed.kind !== 'assistant_row' || !parsed.model || !parsed.usage) continue;
      if (!hasPositiveUsage(parsed.usage)) continue;
      const usage = parsed.usage;
      const dur = durOf(parsed.durMs);
      const run = parsed.run ?? { st: 'completed' as RunStatus };
      const note = run.note?.replace(/[\t\n\r]/g, ' ').slice(0, 180);
      rows.push({
        t,
        model: canonicalModelId(parsed.model),
        i: intOf(usage.input),
        o: intOf(usage.output),
        d: dur,
        cr: intOf(usage.cacheRead),
        cw: intOf(usage.cacheWrite),
        usd: costOf(usage),
        st: run.st,
        code: run.code,
        note,
        tools: parsed.tools ?? [],
      });
    } catch { /* skip corrupt lines */ }
  }
  return rows;
}

// One OpenCode message file into stored rows. Mirrors processOpencodeFile on
// the live path: same classifier, same completed status, same zero skip.
function parseOpencodeFile(text: string): StoredRow[] {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return [];
  }
  const parsed = classifyOpencodeMessage(obj as Parameters<typeof classifyOpencodeMessage>[0]);
  if (!parsed) return [];
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  const usage = parsed.usage;
  return [{
    t: parsed.ms ?? null,
    model: canonicalModelId(parsed.model),
    i: num(usage.input),
    o: num(usage.output),
    d: durOf(parsed.durMs),
    cr: num(usage.cacheRead),
    cw: num(usage.cacheWrite),
    usd: costOf(usage),
    st: 'completed',
    code: undefined,
    note: undefined,
    tools: [],
  }];
}

function insertSql(file: string, r: StoredRow): string {
  return `INSERT INTO messages (file, t, model, i, o, d, cr, cw, usd, st, code, note, tools) VALUES (` +
    `${esc(file)},${r.t === null ? 'NULL' : String(r.t)},${esc(r.model)},${r.i},${r.o},` +
    `${nullNum(r.d)},${r.cr},${r.cw},${nullNum(r.usd)},${esc(r.st)},` +
    `${nullNum(r.code)},${nullStr(r.note)},${esc(JSON.stringify(r.tools))});`;
}

// Incremental sync: unchanged transcripts are skipped via mtime+size,
// changed ones are deleted and re-inserted. Rows for deleted transcripts
// are kept, so OMP session rotation never erases history. True on success
// (including nothing-to-do), false when sqlite3 or disk is unavailable.
/**
 * Bump when a parser change would produce different rows for a file that has
 * not changed on disk.
 *
 * The sync skips a file whose mtime and size match what it recorded, and those
 * say nothing about which code read it. So a parser fix reached new transcripts
 * only: every session already ingested kept the old label forever, which is how
 * a corrected Codex model name could sit in the code while the dashboard went
 * on reporting the provider. This makes that a one-time re-read.
 */
const PARSER_VERSION = '2';

function readParserVersion(db: string): string | null {
  try {
    for (const [v] of query(db, `SELECT v FROM meta WHERE k='parser_version';`)) return String(v);
  } catch { /* fresh db */ }
  return null;
}

export function syncUsageDb(): boolean {
  let db: string;
  try {
    db = usageDbPath();
    ensureSchema(db);
  } catch {
    return false;
  }
  const files: string[] = [];
  try {
    walkJsonl(sessionsDir(), files, 2000);
    if (process.env.TERSIO_SESSIONS_DIR === undefined || process.env.TERSIO_CODEX_DIR !== undefined) {
      walkJsonl(codexSessionsDir(), files, 2000);
    }
    if (process.env.TERSIO_SESSIONS_DIR === undefined || process.env.TERSIO_PI_DIR !== undefined) {
      walkJsonl(piSessionsDir(), files, 5000);
    }
    if (process.env.TERSIO_SESSIONS_DIR === undefined || process.env.TERSIO_OPENCODE_DIR !== undefined) {
      walkJsonl(opencodeSessionsDir(), files, 5000, '.json');
    }
  } catch {
    return false;
  }
  const known = readFiles(db);
  const restale = readParserVersion(db) !== PARSER_VERSION;
  const current: Record<string, { mtime: number; size: number }> = {};
  const changed: string[] = [];
  for (const file of files) {
    let st: fs.Stats;
    try {
      st = fs.statSync(file);
    } catch {
      continue;
    }
    const entry = { mtime: st.mtimeMs, size: st.size };
    current[file] = entry;
    const prev = known[file];
    if (restale || !prev || prev.mtime !== entry.mtime || prev.size !== entry.size) changed.push(file);
  }
  if (!changed.length) {
    if (restale) run(db, `INSERT OR REPLACE INTO meta (k, v) VALUES ('parser_version',${esc(PARSER_VERSION)});`);
    return true;
  }
  const chunks: string[] = [];
  let chunkBytes = 0;
  const flush = (): boolean => {
    if (!chunks.length) return true;
    try {
      run(db, `BEGIN;${chunks.join('')}COMMIT;`);
    } catch {
      return false;
    }
    chunks.length = 0;
    chunkBytes = 0;
    return true;
  };
  const push = (sql: string): boolean => {
    chunks.push(sql);
    chunkBytes += sql.length;
    if (chunkBytes < 400_000) return true;
    return flush();
  };
  for (const file of changed) {
    if (!push(`DELETE FROM messages WHERE file=${esc(file)};DELETE FROM files WHERE path=${esc(file)};`)) return false;
  }
  try {
    for (const file of changed) {
      const entry = current[file];
      const text = fs.readFileSync(file, 'utf8');
      // OpenCode message bodies are single JSON documents, parsed by their
      // own classifier; everything else is JSONL through parseFile.
      const parsed = file.endsWith('.json') ? parseOpencodeFile(text) : parseFile(text);
      for (const r of parsed) {
        if (!push(insertSql(file, r))) return false;
      }
      if (!push(`INSERT OR REPLACE INTO files (path, mtime, size) VALUES (${esc(file)},${entry.mtime},${entry.size});`)) return false;
    }
  } catch {
    return false;
  }
  if (!push(`INSERT OR REPLACE INTO meta (k, v) VALUES ('last_sync',${esc(String(Date.now()))});`)) return false;
  if (!push(`INSERT OR REPLACE INTO meta (k, v) VALUES ('parser_version',${esc(PARSER_VERSION)});`)) return false;
  return flush();
}

export function readUsageDb(): StoredUsage | null {
  const db = usageDbPath();
  try {
    if (!fs.existsSync(db)) return null;
  } catch {
    return null;
  }
  let rows: string[][];
  try {
    rows = query(db, `SELECT t, model, i, o, d, cr, cw, usd, st, code, note, tools FROM messages;`);
  } catch {
    return null;
  }
  const accum = newSessionAccum();
  for (const [t, model, i, o, d, cr, cw, usd, st, code, note, tools] of rows) {
    const ts = t === '' ? undefined : Number(t);
    let toolNames: string[] = [];
    try {
      const parsed: unknown = JSON.parse(tools || '[]');
      if (Array.isArray(parsed)) toolNames = parsed.filter((x): x is string => typeof x === 'string');
    } catch { /* keep empty */ }
    const usage: Record<string, unknown> = {
      input: Number(i) || 0,
      output: Number(o) || 0,
      cacheRead: Number(cr) || 0,
      cacheWrite: Number(cw) || 0,
    };
    if (usd !== '') {
      const measured = Number(usd);
      if (Number.isFinite(measured)) usage.cost = measured;
    }
    ingestSessionRow(
      accum,
      model || 'unknown',
      usage,
      Number.isFinite(ts) ? (ts as number) : undefined,
      d === '' ? undefined : Number(d),
      {
        st: st === 'error' || st === 'aborted' ? st : 'completed',
        code: code === '' ? undefined : Number(code),
        note: note === '' ? undefined : note,
      },
      toolNames,
    );
  }
  accum.recent.sort((a, b) => b.t - a.t);
  let syncedAt = 0;
  try {
    const meta = query(db, `SELECT v FROM meta WHERE k='last_sync';`);
    if (meta.length) syncedAt = Number(meta[0][0]) || 0;
  } catch { /* keep 0 */ }
  return {
    tokens: {
      messages: accum.messages,
      totals: accum.totals,
      byModel: accum.byModel,
      byDay: accum.byDay,
      byDayModel: accum.byDayModel,
      byTool: accum.byTool,
      byModelMessages: accum.byModelMessages,
      costMeasured: accum.costMeasured,
      recent: accum.recent.slice(0, RECENT_LIMIT),
    },
    syncedAt,
  };
}

// Delete the store file. Returns 1 when removed, 0 when already absent.
export function clearUsageDb(): number {
  try {
    fs.unlinkSync(usageDbPath());
    return 1;
  } catch {
    return 0;
  }
}
