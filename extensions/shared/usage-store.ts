// extensions/shared/usage-store.ts — tersio-owned usage.db. A cache of the live parse, never a fork; missing sqlite3 → sync false / read null.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  RECENT_LIMIT,
  canonicalModelId,
  classifySessionLine,
  OpencodeMessage,
  classifyOpencodeMessage,
  costOf,
  durOf,
  hostOfSessionFile,
  ingestSessionRow,
  opencodeSessionsDir,
  newSessionAccum,
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
  execFileSync('sqlite3', [db, sql], { stdio: ['ignore', 'ignore', 'ignore'], timeout: 30000 });
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

// Bump on a parse change: unchanged transcripts are never re-read.
const PARSER_VERSION = '9';

function ensureSchema(db: string): void {
  fs.mkdirSync(path.dirname(db), { recursive: true });
  // Fold in rows stored under a pre-alias spelling; the mtime ledger will not re-read those transcripts.
  const rekeys = MODEL_ALIASES.map((a) => `UPDATE messages SET model='${a.id}' WHERE model='${a.feed}';`).join('');
  run(
    db,
    `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);` +
      `CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, mtime REAL NOT NULL, size INTEGER NOT NULL);` +
      `CREATE TABLE IF NOT EXISTS messages (file TEXT NOT NULL, t REAL, model TEXT NOT NULL,` +
      ` i INTEGER NOT NULL, o INTEGER NOT NULL, d REAL, cr INTEGER NOT NULL, cw INTEGER NOT NULL,` +
      ` usd REAL, st TEXT NOT NULL, code REAL, note TEXT, tools TEXT NOT NULL DEFAULT '[]', h TEXT);` +
      `CREATE INDEX IF NOT EXISTS idx_messages_file ON messages(file);` + rekeys,
  );
  // An older db has no h column; CREATE TABLE IF NOT EXISTS will not add one.
  try {
    run(db, `ALTER TABLE messages ADD COLUMN h TEXT;`);
  } catch { /* already present */ }
  // Host is derivable from the path, so backfill without re-reading transcripts.
  try {
    for (const [file] of query(db, `SELECT DISTINCT file FROM messages WHERE h IS NULL;`)) {
      run(db, `UPDATE messages SET h='${esc(hostOfSessionFile(file))}' WHERE file=${esc(file)};`);
    }
  } catch { /* fresh or unreadable db */ }
  // Drop the cache when the parser has moved on, so every transcript is read again and the new columns actually fill.
  try {
    const stored = query(db, `SELECT v FROM meta WHERE k='parser_version';`);
    if (stored.length && stored[0][0] === PARSER_VERSION) return;
    backupUsageDb(db);
    run(db, `DELETE FROM messages;DELETE FROM files;INSERT OR REPLACE INTO meta (k,v) VALUES ('parser_version','${PARSER_VERSION}');`);
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

function backupUsageDb(db: string): void {
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
}

function parseFile(text: string, host?: string): StoredRow[] {
  const rows: StoredRow[] = [];
  // Guarded: a JSONL transcript must fall through, not abort the sync.
  let oc: ReturnType<typeof classifyOpencodeMessage> = null;
  try { oc = classifyOpencodeMessage(JSON.parse(text) as OpencodeMessage); } catch { /* JSONL */ }
  if (oc) {
    rows.push({
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
    });
    return rows;
  }
  let codexProvider: string | null = null;
  let codexModel: string | null = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as Parameters<typeof classifySessionLine>[0];
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
      });
    } catch { /* skip corrupt lines */ }
  }
  return rows;
}

function insertSql(file: string, r: StoredRow): string {
  return `INSERT INTO messages (file, t, model, i, o, d, cr, cw, usd, st, code, note, tools, h) VALUES (` +
    `${esc(file)},${r.t === null ? 'NULL' : String(r.t)},${esc(r.model)},${r.i},${r.o},` +
    `${nullNum(r.d)},${r.cr},${r.cw},${nullNum(r.usd)},${esc(r.st)},` +
    `${nullNum(r.code)},${nullStr(r.note)},${esc(JSON.stringify(r.tools))},${nullStr(r.host)});`;
}

// Unchanged transcripts are skipped via mtime+size; rows for deleted ones are kept so rotation never erases history. False when sqlite3 is unavailable.
export function syncUsageDb(): boolean {
  let db: string;
  try {
    db = usageDbPath();
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
  if (!changed.length) return true;
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
      for (const r of parseFile(text, hostOfSessionFile(file))) {
        if (!push(insertSql(file, r))) return false;
      }
      if (!push(`INSERT OR REPLACE INTO files (path, mtime, size) VALUES (${esc(file)},${entry.mtime},${entry.size});`)) return false;
    }
  } catch {
    return false;
  }
  if (!push(`INSERT OR REPLACE INTO meta (k, v) VALUES ('last_sync',${esc(String(Date.now()))});`)) return false;
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
    rows = query(db, `SELECT t, model, i, o, d, cr, cw, usd, st, code, note, tools, h FROM messages;`);
  } catch {
    return null;
  }
  const accum = newSessionAccum();
  for (const [t, model, i, o, d, cr, cw, usd, st, code, note, tools, h] of rows) {
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
