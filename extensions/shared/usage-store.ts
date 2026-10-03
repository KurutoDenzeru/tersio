// extensions/shared/usage-store.ts — tersio-owned usage.db. A cache of the live parse, never a fork; missing sqlite3 → sync false / read null.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  RECENT_LIMIT,
  SQLITE_READ_BUFFER,
  canonicalModelId,
  classifySessionLine,
  OpencodeMessage,
  classifyOpencodeMessage,
  costOf,
  durOf,
  hostOfSessionFile,
  ingestSessionRow,
  messageRowId,
  OpencodeDbRow,
  OPENCODE_DB_OVERLAP_MS,
  opencodeDbPath,
  opencodeSessionsDir,
  newSessionAccum,
  readOpencodeDbRows,
  sessionsDirs,
  walkJsonl,
} from './usage-ledger.ts';
import { tersioDataPath } from '../lib/utils.ts';
import { MODEL_ALIASES } from './pricing.ts';
import { tersioSettingsFile } from './plugin-settings.ts';
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
  // -bail stops the script before COMMIT, so a failed INSERT never leaves DELETEs behind.
  execFileSync('sqlite3', ['-bail', db, sql], { stdio: ['ignore', 'ignore', 'ignore'], timeout: 30000 });
}

function query(db: string, sql: string): string[][] {
  const out = execFileSync('sqlite3', ['-separator', '\t', db, sql], {
    encoding: 'utf8',
    timeout: 30000,
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: SQLITE_READ_BUFFER,
  });
  return out
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => line.split('\t'));
}

// Bump on a parse change: unchanged transcripts are never re-read.
const PARSER_VERSION = '11';

// A re-parse that keeps less than half the rows means transcripts vanished mid-migration; the backup is restored instead of publishing the loss.
const REPARSE_GUARD_RATIO = 0.5;

let guardReport: string | null = null;

/** Why the last sync refused to publish a re-parse, if it did. */
export function reparseGuardReport(): string | null {
  return guardReport;
}

const SCHEMA_SQL =
  `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);` +
  `CREATE TABLE IF NOT EXISTS files (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT UNIQUE NOT NULL, mtime REAL NOT NULL, size INTEGER NOT NULL);` +
  `CREATE TABLE IF NOT EXISTS messages (file_id INTEGER NOT NULL REFERENCES files(id), t REAL, model TEXT NOT NULL,` +
  ` i INTEGER NOT NULL, o INTEGER NOT NULL, d REAL, cr INTEGER NOT NULL, cw INTEGER NOT NULL,` +
  ` usd REAL, st TEXT NOT NULL, code REAL, note TEXT, tools TEXT NOT NULL DEFAULT '[]', h TEXT, id TEXT);` +
  `CREATE INDEX IF NOT EXISTS idx_messages_file ON messages(file_id);`;

function storedParserVersion(db: string): string | null {
  try {
    const stored = query(db, `SELECT v FROM meta WHERE k='parser_version';`);
    return stored.length ? stored[0][0] : null;
  } catch {
    return null;
  }
}

function countMessages(db: string): number {
  try {
    const rows = query(db, `SELECT COUNT(*) FROM messages;`);
    return Number(rows[0]?.[0]) || 0;
  } catch {
    return 0;
  }
}

// Watermark for the sqlite scan: the newest opencode row already stored.
function newestOpencodeMs(db: string): number | null {
  try {
    const rows = query(db, `SELECT MAX(t) FROM messages WHERE h='opencode';`);
    const v = Number(rows[0]?.[0]);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

// Same pre-migration state as the newest backup: another copy churns the 3-slot rotation for nothing.
function newestBackupMatches(stored: string | null): boolean {
  if (stored === null) return false;
  try {
    const newest = listUsageBackups()[0];
    if (!newest) return false;
    const out = query(newest.file, `SELECT v FROM meta WHERE k='parser_version';`);
    return out.length > 0 && out[0][0] === stored;
  } catch {
    return false;
  }
}

// v9 shape (path-keyed rows) migrates in place with zero re-parse, so history survives even when transcripts are gone.
function canMigrateInPlace(db: string): boolean {
  try {
    const names = query(db, `PRAGMA table_info(messages);`).map((r) => r[1]);
    return names.includes('file') && names.includes('h') && !names.includes('file_id');
  } catch {
    return false;
  }
}

function migrateInPlace(db: string, preCount: number): boolean {
  const cols = `t, model, i, o, d, cr, cw, usd, st, code, note, tools, h`;
  try {
    run(db,
      `BEGIN;` +
      `CREATE TABLE files_new (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT UNIQUE NOT NULL, mtime REAL NOT NULL, size INTEGER NOT NULL);` +
      `INSERT INTO files_new (path, mtime, size) SELECT path, mtime, size FROM files;` +
      `CREATE TABLE messages_new (file_id INTEGER NOT NULL REFERENCES files_new(id), t REAL, model TEXT NOT NULL,` +
      ` i INTEGER NOT NULL, o INTEGER NOT NULL, d REAL, cr INTEGER NOT NULL, cw INTEGER NOT NULL,` +
      ` usd REAL, st TEXT NOT NULL, code REAL, note TEXT, tools TEXT NOT NULL DEFAULT '[]', h TEXT, id TEXT);` +
      `INSERT INTO messages_new (file_id, ${cols}) SELECT (SELECT id FROM files_new WHERE files_new.path = messages.file), ${cols} FROM messages;` +
      `DROP TABLE messages;DROP TABLE files;` +
      `ALTER TABLE files_new RENAME TO files;ALTER TABLE messages_new RENAME TO messages;` +
      `CREATE INDEX idx_messages_file ON messages(file_id);` +
      `COMMIT;`);
  } catch {
    return false;
  }
  try {
    const names = query(db, `PRAGMA table_info(messages);`).map((r) => r[1]);
    return names.includes('file_id') && !names.includes('file') && countMessages(db) === preCount;
  } catch {
    return false;
  }
}

// v10 shape gains the message id with a bare ALTER: no rows move, so no re-parse and no guard trip.
function canAlterInPlace(db: string): boolean {
  try {
    const names = query(db, `PRAGMA table_info(messages);`).map((r) => r[1]);
    return names.includes('file_id') && !names.includes('id');
  } catch {
    return false;
  }
}

function alterInPlace(db: string): boolean {
  try {
    run(db, `ALTER TABLE messages ADD COLUMN id TEXT;`);
  } catch {
    return false;
  }
  return !canAlterInPlace(db);
}

function ensureSchema(db: string): void {
  fs.mkdirSync(path.dirname(db), { recursive: true });
  // Fold in rows stored under a pre-alias spelling; the mtime ledger will not re-read those transcripts.
  const rekeys = MODEL_ALIASES.map((a) => `UPDATE messages SET model='${a.id}' WHERE model='${a.feed}';`).join('');
  const stored = storedParserVersion(db);
  if (stored === PARSER_VERSION) {
    run(db, SCHEMA_SQL + rekeys);
    return;
  }
  // A version bump rebuilds both tables, so no ALTER patchwork survives a migration.
  try {
    if (countMessages(db) > 0 && !newestBackupMatches(stored)) backupUsageDb(db);
    if (stored !== null && canMigrateInPlace(db) && migrateInPlace(db, countMessages(db))) {
      run(db, `INSERT OR REPLACE INTO meta (k,v) VALUES ('parser_version','${PARSER_VERSION}');`);
      try { run(db, `VACUUM;`); } catch { /* best-effort */ }
      return;
    }
    if (stored !== null && canAlterInPlace(db) && alterInPlace(db)) {
      run(db, `INSERT OR REPLACE INTO meta (k,v) VALUES ('parser_version','${PARSER_VERSION}');`);
      return;
    }
    run(db, `DROP TABLE IF EXISTS messages;DROP TABLE IF EXISTS files;` + SCHEMA_SQL +
      `INSERT OR REPLACE INTO meta (k,v) VALUES ('parser_version','${PARSER_VERSION}');`);
  } catch { /* fresh db, nothing to invalidate */ }
}

// The one destructive thing we do; keep the last few so a bad bump is recoverable.
const BACKUP_KEEP = 3;

export function backupUsageDir(): string {
  return path.join(path.dirname(usageDbPath()), 'backups');
}

export function listUsageBackups(): Array<{ file: string; mtime: number; size: number }> {
  try {
    return fs.readdirSync(backupUsageDir())
      .filter((n) => /^usage-\d{14}\.db$/.test(n))
      .map((n) => {
        const full = path.join(backupUsageDir(), n);
        const st = fs.statSync(full);
        return { file: full, mtime: st.mtimeMs, size: st.size };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return [];
  }
}

export function backupUsageDb(db: string): void {
  try {
    const dir = backupUsageDir();
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    fs.copyFileSync(db, path.join(dir, `usage-${stamp}.db`));
    for (const old of listUsageBackups().slice(BACKUP_KEEP)) {
      fs.rmSync(old.file, { force: true });
    }
  } catch { /* a missing backup must not block the sync */ }
}

const SCHEDULE_MS: Record<string, number> = { daily: 86_400_000, weekly: 604_800_000, monthly: 2_592_000_000 };

/** Read the schedule straight from settings; this module must not import cli/. */
export function readBackupSchedule(): string {
  try {
    const raw = JSON.parse(fs.readFileSync(tersioSettingsFile(), 'utf8')) as { backupSchedule?: unknown };
    return typeof raw?.backupSchedule === 'string' ? raw.backupSchedule : 'monthly';
  } catch {
    return 'monthly';
  }
}

/** Snapshot on the schedule, skipping when the newest one is still fresh. */
export function maybeScheduledBackup(db: string): boolean {
  const every = SCHEDULE_MS[readBackupSchedule()];
  if (!every) return false;
  try {
    const newest = listUsageBackups()[0];
    if (newest && Date.now() - newest.mtime < every) return false;
    backupUsageDb(db);
    return true;
  } catch {
    return false;
  }
}

// basename only: a crafted `../` must not escape the backup dir.
function resolveBackupFile(file: string): string | null {
  const dir = path.resolve(backupUsageDir());
  const target = path.join(dir, path.basename(String(file || '')));
  if (!target.startsWith(dir + path.sep)) return null;
  return fs.existsSync(target) ? target : null;
}

/** Put a backup back in place. The next sync then re-parses over it. */
export function restoreUsageBackup(file: string): boolean {
  try {
    const src = resolveBackupFile(file);
    if (!src) return false;
    fs.copyFileSync(src, usageDbPath());
    return true;
  } catch {
    return false;
  }
}

/** Delete one snapshot. Only ever touches a file inside the backup dir. */
export function deleteUsageBackup(file: string): boolean {
  try {
    const target = resolveBackupFile(file);
    if (!target) return false;
    fs.rmSync(target, { force: true });
    return true;
  } catch {
    return false;
  }
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

// One parsed assistant message, as stored. `t` is null when the source row has no usable timestamp: counted, but skipped in the recent list.
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
  host?: string;
  id?: string;
}

// OpenCode rows carry no status, code, note, or tool list; only tokens and the msg id.
function opencodeStoredRow(oc: NonNullable<ReturnType<typeof classifyOpencodeMessage>>, host: string | undefined, id: string | undefined): StoredRow {
  return {
    t: oc.ms ?? null,
    model: canonicalModelId(oc.model),
    i: intOf(oc.usage.input),
    o: intOf(oc.usage.output),
    d: durOf(oc.durMs),
    cr: intOf(oc.usage.cacheRead),
    cw: intOf(oc.usage.cacheWrite),
    usd: costOf(oc.usage),
    st: 'completed',
    code: undefined,
    note: undefined,
    tools: [],
    host,
    id,
  };
}

function parseFile(text: string, host?: string, file?: string): StoredRow[] {
  const rows: StoredRow[] = [];
  // Guarded: a JSONL transcript must fall through, not abort the sync.
  let oc: ReturnType<typeof classifyOpencodeMessage> = null;
  try { oc = classifyOpencodeMessage(JSON.parse(text) as OpencodeMessage); } catch { /* JSONL */ }
  if (oc) {
    rows.push(opencodeStoredRow(oc, host, file ? path.basename(file).replace(/\.[^.]+$/, '') : undefined));
    return rows;
  }
  let codexProvider: string | null = null;
  let codexModel: string | null = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as Parameters<typeof classifySessionLine>[0];
      const rid = messageRowId(row);
      const parsed = classifySessionLine(row);
      if (parsed.kind === 'codex_provider') {
        if (parsed.provider) codexProvider = parsed.provider;
        continue;
      }
      if (parsed.kind === 'codex_model') {
        if (parsed.model) codexModel = parsed.model;
        continue;
      }
      const ts = row.timestamp;
      const ms = ts === undefined ? NaN : typeof ts === 'number' ? ts : Date.parse(ts);
      const t = Number.isFinite(ms) ? ms : null;
      if (parsed.kind === 'token_row') {
        const provider = parsed.provider ?? codexProvider;
        const usage = parsed.usage ?? {};
        rows.push({
          t,
          model: canonicalModelId(provider ? (codexModel ? `codex/${provider}/${codexModel}` : `codex/${provider}`) : 'codex'),
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
          host,
          id: rid,
        });
        continue;
      }
      if (parsed.kind !== 'assistant_row' || !parsed.model || !parsed.usage) continue;
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
        host,
        id: rid,
      });
    } catch { /* skip corrupt lines */ }
  }
  return rows;
}

function insertSql(file: string, r: StoredRow): string {
  return `INSERT INTO messages (file_id, t, model, i, o, d, cr, cw, usd, st, code, note, tools, h, id) VALUES (` +
    `(SELECT id FROM files WHERE path=${esc(file)}),${r.t === null ? 'NULL' : String(r.t)},${esc(r.model)},${r.i},${r.o},` +
    `${nullNum(r.d)},${r.cr},${r.cw},${nullNum(r.usd)},${esc(r.st)},` +
    `${nullNum(r.code)},${nullStr(r.note)},${esc(JSON.stringify(r.tools))},${nullStr(r.host)},${nullStr(r.id)});`;
}

// Unchanged transcripts are skipped via mtime+size; rows for deleted ones are kept so rotation never erases history. False when sqlite3 is unavailable.
export function syncUsageDb(): boolean {
  let db: string;
  guardReport = null;
  let preWipe = -1;
  let migrated = false;
  try {
    db = usageDbPath();
    const stored = storedParserVersion(db);
    migrated = stored !== null && stored !== PARSER_VERSION;
    // The operator deleted sessions on purpose and wants the mirror to match: bypass the guard.
    const forced = process.env.TERSIO_FORCE_REPARSE === '1';
    if (migrated && !forced) preWipe = countMessages(db);
    ensureSchema(db);
    maybeScheduledBackup(db);
  } catch {
    return false;
  }
  const files: string[] = [];
  const ocFiles: string[] = [];
  try {
    for (const dir of sessionsDirs()) walkJsonl(dir, files, 2000);
    // OpenCode stores one JSON document per message, not JSONL.
    if (process.env.TERSIO_SESSIONS_DIR === undefined || process.env.TERSIO_OPENCODE_DIR !== undefined) {
      walkJsonl(opencodeSessionsDir(), ocFiles, 5000, '.json');
    }
  } catch {
    return false;
  }
  files.push(...ocFiles);
  // v2 hosts keep messages in sqlite; rows past the watermark are new. Overlap re-reads the tail idempotently.
  const ocDbRows: OpencodeDbRow[] = [];
  const ocDbPath = opencodeDbPath();
  if (process.env.TERSIO_SESSIONS_DIR === undefined || process.env.TERSIO_OPENCODE_DB !== undefined) {
    const newest = newestOpencodeMs(db);
    if (newest !== null || fs.existsSync(ocDbPath)) {
      ocDbRows.push(...readOpencodeDbRows(ocDbPath, newest === null ? 0 : newest - OPENCODE_DB_OVERLAP_MS));
    }
  }
  const known = readFiles(db);
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
    if (!prev || prev.mtime !== entry.mtime || prev.size !== entry.size) changed.push(file);
  }
  if (!changed.length && !ocDbRows.length) return true;
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
    // One argv string caps at 128KB on Linux (E2BIG); stay well under it.
    if (chunkBytes < 100_000) return true;
    return flush();
  };
  for (const file of changed) {
    const entry = current[file];
    if (!push(
      `INSERT INTO files (path, mtime, size) VALUES (${esc(file)},${entry.mtime},${entry.size})` +
      ` ON CONFLICT(path) DO UPDATE SET mtime=excluded.mtime,size=excluded.size;` +
      `DELETE FROM messages WHERE file_id=(SELECT id FROM files WHERE path=${esc(file)});`,
    )) return false;
  }
  try {
    for (const file of changed) {
      const text = fs.readFileSync(file, 'utf8');
      for (const r of parseFile(text, hostOfSessionFile(file), file)) {
        if (!push(insertSql(file, r))) return false;
      }
    }
    for (const row of ocDbRows) {
      const parsed = classifyOpencodeMessage(row.row);
      if (!parsed) continue;
      // One synthetic path per row id, so the delete-and-reinsert that follows is idempotent.
      const key = `${ocDbPath}#${row.id}`;
      if (!push(
        `INSERT INTO files (path, mtime, size) VALUES (${esc(key)},${row.created},0)` +
        ` ON CONFLICT(path) DO UPDATE SET mtime=excluded.mtime;` +
        `DELETE FROM messages WHERE file_id=(SELECT id FROM files WHERE path=${esc(key)});` +
        insertSql(key, opencodeStoredRow(parsed, 'opencode', row.id)),
      )) return false;
    }
  } catch {
    return false;
  }
  if (!push(`INSERT OR REPLACE INTO meta (k, v) VALUES ('last_sync',${esc(String(Date.now()))});`)) return false;
  if (!flush()) return false;
  if (preWipe > 0) {
    const kept = countMessages(db);
    if (kept < preWipe * REPARSE_GUARD_RATIO) {
      const newest = listUsageBackups()[0];
      if (newest && restoreUsageBackup(path.basename(newest.file))) {
        guardReport = `re-parse kept ${kept} of ${preWipe} rows; restored ${path.basename(newest.file)} (set TERSIO_FORCE_REPARSE=1 to accept the loss)`;
        return false;
      }
    }
  }
  // Reclaim the migration's DELETE storm so the file stays small.
  if (migrated) {
    try { run(db, `VACUUM;`); } catch { /* best-effort */ }
  }
  return true;
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
    rows = query(db, `SELECT t, model, i, o, d, cr, cw, usd, st, code, note, tools, h, id FROM messages;`);
  } catch {
    return null;
  }
  const accum = newSessionAccum();
  for (const [t, model, i, o, d, cr, cw, usd, st, code, note, tools, h, id] of rows) {
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
      h === '' ? undefined : h,
      id === '' || id === undefined ? undefined : id,
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
      byHost: accum.byHost,
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
