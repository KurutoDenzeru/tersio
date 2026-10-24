// usage-store.ts — tersio-owned usage.db. A cache of the live parse, not a fork; no SQLite → sync false / read null.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sqliteExec, sqliteRead } from './sqlite.ts';
import {
  RECENT_LIMIT,
  canonicalModelId,
  classifySessionLine,
  classifyOpencodeMessage,
  collectToolResults,
  parseSessionLines,
  costOf,
  durOf,
  agentOfSessionText,
  hostOfSessionFile,
  ingestSessionRow,
  messageRowId,
  OPENCODE_DB_OVERLAP_MS,
  opencodeDbPath,
  opencodeSessionsDir,
  newSessionAccum,
  opencodeToolNames,
  readOpencodeDbRows,
  sessionsDirs,
  walkJsonl,
} from './usage-ledger.ts';
import { tersioDataPath } from './utils.ts';
import { createDataBackup, newestDataBackup, readSnapshotMember, restoreSnapshotMember } from './snapshots.ts';
import { MODEL_ALIASES } from './pricing.ts';
import { tersioSettingsFile } from './plugin-settings.ts';
import type { OpencodeClassification, OpencodeDbRow, OpencodeMessage, RunStatus, SessionLineRow, SessionTokens, ToolFact } from './usage-ledger.ts';

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

// A failed INSERT stops before COMMIT, so it leaves no DELETEs behind.
function run(db: string, sql: string): void {
  sqliteExec(db, sql);
}

function query(db: string, sql: string): string[][] {
  return sqliteRead(db, sql)
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => line.split('\t'));
}

// Bump on a parse change: unchanged transcripts are never re-read.
const PARSER_VERSION = '14';

/** OpenCode rows gained tool names; re-read by id, since a PARSER_VERSION bump drops rotated history. */
const OPENCODE_TOOLS_VERSION = '1';

// A re-parse keeping under half the rows means transcripts vanished mid-migration; the backup is restored instead.
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
  ` i INTEGER NOT NULL, o INTEGER NOT NULL, d REAL, tf REAL, cr INTEGER NOT NULL, cw INTEGER NOT NULL,` +
  ` usd REAL, st TEXT NOT NULL, code REAL, note TEXT, tools TEXT NOT NULL DEFAULT '[]', h TEXT, a TEXT, id TEXT, tc TEXT, p TEXT);` +
  // Every read filters or orders by one of these three; without them each sync and read scans the table.
  `CREATE INDEX IF NOT EXISTS idx_messages_file ON messages(file_id);` +
  `CREATE INDEX IF NOT EXISTS idx_messages_t ON messages(t);` +
  `CREATE INDEX IF NOT EXISTS idx_messages_h_t ON messages(h, t);` +
  `CREATE INDEX IF NOT EXISTS idx_messages_model ON messages(model);`;

/** WAL + a checkpoint: the write path avoids an fsync per commit, and usage.db alone holds every row. */
function pragmas(db: string): void {
  run(db,
    'PRAGMA journal_mode=WAL;' +
    'PRAGMA synchronous=NORMAL;' +
    'PRAGMA wal_autocheckpoint=256;' +
    'PRAGMA cache_size=-8000;' +
    'PRAGMA temp_store=MEMORY;' +
    'PRAGMA mmap_size=268435456;');
}

function storedParserVersion(db: string): string | null {
  try {
    const stored = query(db, `SELECT v FROM meta WHERE k='parser_version';`);
    return stored.length ? stored[0][0] : null;
  } catch {
    return null;
  }
}

// A store written by a newer tersio: no forward migration, so a re-parse would swap rotated history for what is left.
function isDowngrade(stored: string | null): boolean {
  if (stored === null) return false;
  const storedNum = Number(stored);
  const currentNum = Number(PARSER_VERSION);
  return Number.isFinite(storedNum) && Number.isFinite(currentNum) && storedNum > currentNum;
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

/** Whether the OpenCode tools backfill ran; unfilled rows stay empty, so this widens the scan once. */
function opencodeToolsBackfilled(db: string): boolean {
  try {
    const rows = query(db, `SELECT v FROM meta WHERE k='opencode_tools';`);
    return rows.length > 0 && rows[0][0] === OPENCODE_TOOLS_VERSION;
  } catch {
    return false;
  }
}

// Same pre-migration state as the newest snapshot: another copy churns the rotation for nothing.
function newestBackupMatches(stored: string | null): boolean {
  if (stored === null) return false;
  const newest = newestDataBackup();
  const body = newest ? readSnapshotMember(newest, path.basename(usageDbPath())) : null;
  if (!body) return false;
  const copy = path.join(os.tmpdir(), `tersio-guard-${process.pid}.db`);
  try {
    fs.writeFileSync(copy, body);
    const out = query(copy, `SELECT v FROM meta WHERE k='parser_version';`);
    return out.length > 0 && out[0][0] === stored;
  } catch {
    return false;
  } finally {
    fs.rmSync(copy, { force: true });
  }
}

// v9 shape (path-keyed rows) migrates in place with zero re-parse, so history survives even without transcripts.
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
      ` i INTEGER NOT NULL, o INTEGER NOT NULL, d REAL, tf REAL, cr INTEGER NOT NULL, cw INTEGER NOT NULL,` +
      ` usd REAL, st TEXT NOT NULL, code REAL, note TEXT, tools TEXT NOT NULL DEFAULT '[]', h TEXT, a TEXT, id TEXT, tc TEXT);` +
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

// v12 adds the agent kind with a bare ALTER; existing rows read NULL and report under the main agent.
function canAddAgent(db: string): boolean {
  try {
    const names = query(db, `PRAGMA table_info(messages);`).map((r) => r[1]);
    return names.includes('file_id') && !names.includes('a');
  } catch {
    return false;
  }
}

function addAgentColumn(db: string): boolean {
  try {
    run(db, `ALTER TABLE messages ADD COLUMN a TEXT;`);
  } catch {
    return false;
  }
  return true;
}

// v13 shape gains the first-token latency with a bare ALTER, so no row moves and no wipe runs.
function canAddTtft(db: string): boolean {
  try {
    const names = query(db, `PRAGMA table_info(messages);`).map((r) => r[1]);
    return names.includes('file_id') && !names.includes('tf');
  } catch {
    return false;
  }
}

// The column is additive, and a rotated transcript cannot be re-parsed, so the ALTER precedes the backfill.
function addTtftColumn(db: string): boolean {
  try {
    run(db, `ALTER TABLE messages ADD COLUMN tf REAL;`);
  } catch {
    return false;
  }
  return !canAddTtft(db);
}

/** First-token-latency marker; unchanged transcripts are never revisited, so old stores stay null. */
const TTFT_VERSION = '1';

/** Tool-facts marker: rows written before it carry names only, so one backfill fills sizes and errors. */
const TOOL_FACTS_VERSION = '1';

function toolFactsBackfilled(db: string): boolean {
  try {
    const rows = query(db, `SELECT v FROM meta WHERE k='tool_facts';`);
    return rows.length > 0 && rows[0][0] === TOOL_FACTS_VERSION;
  } catch {
    return false;
  }
}

// The tool facts are additive too: a bare ALTER, then one transcript re-read fills them.
function canAddToolFacts(db: string): boolean {
  try {
    const names = query(db, `PRAGMA table_info(messages);`).map((r) => r[1]);
    return names.includes('file_id') && !names.includes('tc');
  } catch {
    return false;
  }
}

function addToolFactsColumn(db: string): boolean {
  try {
    run(db, `ALTER TABLE messages ADD COLUMN tc TEXT;`);
  } catch {
    return false;
  }
  return !canAddToolFacts(db);
}

// v14 adds the named gateway; the model id cannot show it, so a bare ALTER plus one re-read fills it.
function canAddGateway(db: string): boolean {
  try {
    const names = query(db, `PRAGMA table_info(messages);`).map((r) => r[1]);
    return names.includes('file_id') && !names.includes('p');
  } catch {
    return false;
  }
}

function addGatewayColumn(db: string): boolean {
  try {
    run(db, `ALTER TABLE messages ADD COLUMN p TEXT;`);
  } catch {
    return false;
  }
  if (canAddGateway(db)) return false;
  markTranscriptsDirty(db);
  return true;
}

function ttftBackfilled(db: string): boolean {
  try {
    const rows = query(db, `SELECT v FROM meta WHERE k='ttft_backfill';`);
    return rows.length > 0 && rows[0][0] === TTFT_VERSION;
  } catch {
    return false;
  }
}

/** Clears ledger mtimes so every transcript re-reads; synthetic `db#row-id` OpenCode keys stay untouched. */
function markTranscriptsDirty(db: string): void {
  try {
    run(db, `UPDATE files SET mtime = 0 WHERE path NOT LIKE '%#%';`);
  } catch { /* a store with no files table yet, or a read-only file: nothing to backfill */ }
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

function ensureSchema(db: string, forceWipe: boolean): void {
  fs.mkdirSync(path.dirname(db), { recursive: true });
  // Fold in rows stored under a pre-alias spelling; the mtime ledger will not re-read those transcripts.
  const rekeys = MODEL_ALIASES.map((a) => `UPDATE messages SET model='${a.id}' WHERE model='${a.feed}';`).join('');
  const stored = storedParserVersion(db);
  pragmas(db);
  if (stored === PARSER_VERSION) {
    // A store this build already wrote still gains a column added since, without a version bump.
    run(db, SCHEMA_SQL + rekeys);
    if (addAdditiveColumns(db)) run(db, `INSERT OR REPLACE INTO meta (k, v) VALUES ('parser_version','${PARSER_VERSION}');`);
    return;
  }
  // A newer store keeps its rows: only an explicit force re-parse may wipe it.
  if (!forceWipe && isDowngrade(stored)) {
    run(db, SCHEMA_SQL + rekeys);
    return;
  }
  // A version bump rebuilds both tables, so no ALTER patchwork survives a migration.
  try {
    if (countMessages(db) > 0 && !newestBackupMatches(stored)) snapshotData();
    if (stored !== null && canMigrateInPlace(db) && migrateInPlace(db, countMessages(db))) {
      run(db, `INSERT OR REPLACE INTO meta (k,v) VALUES ('parser_version','${PARSER_VERSION}');`);
      try { run(db, `VACUUM;`); } catch { /* best-effort */ }
      return;
    }
    if (stored !== null && canAlterInPlace(db) && alterInPlace(db)) {
      run(db, `INSERT OR REPLACE INTO meta (k,v) VALUES ('parser_version','${PARSER_VERSION}');`);
      return;
    }
    // Every additive column lands in one pass: an older store may miss more than one.
    if (stored !== null && addAdditiveColumns(db)) {
      run(db, `INSERT OR REPLACE INTO meta (k, v) VALUES ('parser_version','${PARSER_VERSION}');`);
      return;
    }
    run(db, `DROP TABLE IF EXISTS messages;DROP TABLE IF EXISTS files;` + SCHEMA_SQL +
      `INSERT OR REPLACE INTO meta (k,v) VALUES ('parser_version','${PARSER_VERSION}');`);
  } catch { /* fresh db, nothing to invalidate */ }
}

/** Adds each missing additive column: the agent kind, the first-token latency, and the tool facts. */
function addAdditiveColumns(db: string): boolean {
  let added = false;
  if (canAddAgent(db) && addAgentColumn(db)) added = true;
  if (canAddTtft(db) && addTtftColumn(db)) added = true;
  if (canAddToolFacts(db) && addToolFactsColumn(db)) added = true;
  if (canAddGateway(db) && addGatewayColumn(db)) added = true;
  return added;
}

// The one destructive thing we do; the snapshot rotation keeps a bad bump recoverable.
export function snapshotData(): void {
  try {
    createDataBackup();
  } catch { /* a missing snapshot must not block the sync */ }
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
export function maybeScheduledBackup(): boolean {
  const every = SCHEDULE_MS[readBackupSchedule()];
  if (!every) return false;
  try {
    const newest = newestDataBackup();
    if (newest && Date.now() - newest.mtime < every) return false;
    createDataBackup();
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

// One parsed assistant message. `t` is null with no usable timestamp: still counted, but skipped in the recent list.
interface StoredRow {
  t: number | null;
  model: string;
  i: number;
  o: number;
  d: number | undefined;
  /** First-token latency in ms. Only omp records it; the rest read null rather than a guess. */
  tf: number | undefined;
  cr: number;
  cw: number;
  usd: number | undefined;
  st: RunStatus;
  code: number | undefined;
  note: string | undefined;
  tools: string[];
  /** Name, argument bytes, result bytes, and error flag per call. Absent for a name-only row. */
  toolFacts?: ToolFact[];
  host?: string;
  /** `main` or `subagent`; null on a row written before the store carried it. */
  agent?: string | null;
  id?: string;
  /** The gateway the transcript named, e.g. `commandcode`. Null on rows written before it was kept. */
  gateway?: string;
}

// OpenCode rows carry only tokens, msg id, and tools; they record as the main agent, so no NULL kind.
function opencodeStoredRow(
  oc: NonNullable<OpencodeClassification>,
  host: string | undefined,
  id: string | undefined,
  tools: string[],
): StoredRow {
  return {
    t: oc.ms ?? null,
    model: canonicalModelId(oc.model),
    i: intOf(oc.usage.input),
    o: intOf(oc.usage.output),
    d: durOf(oc.durMs),
    tf: durOf(oc.ttftMs),
    cr: intOf(oc.usage.cacheRead),
    cw: intOf(oc.usage.cacheWrite),
    usd: costOf(oc.usage),
    st: 'completed',
    code: undefined,
    note: undefined,
    tools,
    host,
    agent: 'main',
    id,
  };
}

function parseFile(text: string, host?: string, file?: string, agent?: string): StoredRow[] {
  const rows: StoredRow[] = [];
  // Guarded: a JSONL transcript must fall through, not abort the sync.
  let oc: OpencodeClassification | null = null;
  try {
    const message = JSON.parse(text) as OpencodeMessage;
    oc = classifyOpencodeMessage(message);
    if (oc) {
      rows.push(opencodeStoredRow(oc, host, file ? path.basename(file).replace(/\.[^.]+$/, '') : undefined, opencodeToolNames(message)));
      return rows;
    }
  } catch { /* JSONL */ }
  // A call's result arrives on a later line, so the whole file is scanned for results first.
  const results = collectToolResults(text);
  const lines = parseSessionLines(text);
  let codexProvider: string | null = null;
  let codexModel: string | null = null;
  const pendingTurns = new Map<string, { durMs?: number; ttftMs?: number }>();
  let lastTurnTiming: { durMs?: number; ttftMs?: number } | undefined;
  for (const { row } of lines.parsed) {
    const parsed = classifySessionLine(row, results);
    if (parsed.kind === 'token_row' && parsed.turnId && !parsed.usage) pendingTurns.set(parsed.turnId, { durMs: parsed.durMs, ttftMs: parsed.ttftMs });
    if (parsed.kind === 'token_row' && parsed.turnId && !parsed.usage) lastTurnTiming = { durMs: parsed.durMs, ttftMs: parsed.ttftMs };
    if (parsed.kind === 'codex_provider' && parsed.provider) codexProvider = parsed.provider;
    if (parsed.kind === 'codex_model' && parsed.model) codexModel = parsed.model;
  }
  // Codex facts ride outside the token rows: one shell fact per CommandExecution, one call fact per custom call.
  const shellOrder: string[] = [];
  const shellFacts = new Map<string, ToolFact>();
  const callOrder: string[] = [];
  const callFacts = new Map<string, ToolFact>();
  for (const { row } of lines.parsed) {
    const parsed = classifySessionLine(row, results);
    if (parsed.kind === 'assistant_row' && parsed.model === 'codex-tool-call' && parsed.callId) {
      if (!callFacts.has(parsed.callId)) callOrder.push(parsed.callId);
      const out = results.get(parsed.callId);
      callFacts.set(parsed.callId, { n: parsed.callName === 'exec' ? 'bash' : parsed.callName ?? 'tool', a: parsed.callChars ?? 0, r: out?.chars ?? 0, e: out?.error ? 1 : 0 });
    } else if (parsed.kind === 'assistant_row' && parsed.model === 'codex-shell-fact' && parsed.toolFacts?.length) {
      const turn = parsed.turnId ?? '';
      if (!shellFacts.has(turn)) shellOrder.push(turn);
      shellFacts.set(turn, parsed.toolFacts[0]);
    }
  }
  const codexFacts: ToolFact[] = [];
  for (const turn of shellOrder) {
    const fact = shellFacts.get(turn)!;
    if (!codexFacts.some((f) => f.n === fact.n && f.a === fact.a)) codexFacts.push(fact);
  }
  for (const callId of callOrder) {
    const fact = callFacts.get(callId)!;
    if (!codexFacts.some((f) => f.n === fact.n && f.a === fact.a && f.r === fact.r && f.e === fact.e)) codexFacts.push(fact);
  }
  for (const { row } of lines.parsed) {
    const parsed = classifySessionLine(row, results);
    const rid = messageRowId(row);
    if (parsed.kind === 'codex_provider') continue;
    if (parsed.kind === 'codex_model') continue;
    const ts = row.timestamp;
    const ms = ts === undefined ? NaN : typeof ts === 'number' ? ts : Date.parse(ts);
    const t = Number.isFinite(ms) ? ms : null;
    if (parsed.kind === 'token_row') {
      // A timing-only row (`task_complete`) is not usage; skip it here, the pass above kept its turn.
      if (!parsed.usage && !parsed.ms) {
        continue;
      }
      const turn = parsed.turnId ? pendingTurns.get(parsed.turnId) : lastTurnTiming;
      const provider = parsed.provider ?? codexProvider;
      const usage = parsed.usage ?? {};
      rows.push({
        t,
        model: canonicalModelId(provider ? (codexModel ? `codex/${provider}/${codexModel}` : `codex/${provider}`) : 'codex'),
        i: intOf(usage.input),
        o: intOf(usage.output),
        d: durOf(parsed.durMs ?? turn?.durMs),
        tf: durOf(parsed.ttftMs ?? turn?.ttftMs),
        cr: intOf(usage.cacheRead),
        cw: intOf(usage.cacheWrite),
        usd: costOf(usage),
        st: 'completed',
        code: undefined,
        note: undefined,
        tools: codexFacts.map((f) => f.n),
        toolFacts: codexFacts.length > 0 ? codexFacts : undefined,
        host,
        agent,
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
      tf: durOf(parsed.ttftMs),
      cr: intOf(usage.cacheRead),
      cw: intOf(usage.cacheWrite),
      usd: costOf(usage),
      st: run.st,
      code: run.code,
      note,
      tools: parsed.tools ?? [],
      toolFacts: parsed.toolFacts,
      host,
      agent,
      id: rid,
      gateway: parsed.provider,
    });
  }
  return rows;
}

function insertSql(file: string, r: StoredRow): string {
  return `INSERT INTO messages (file_id, t, model, i, o, d, tf, cr, cw, usd, st, code, note, tools, h, a, id, tc, p) VALUES (` +
    `(SELECT id FROM files WHERE path=${esc(file)}),${r.t === null ? 'NULL' : String(r.t)},${esc(r.model)},${r.i},${r.o},` +
    `${nullNum(r.d)},${nullNum(r.tf)},${r.cr},${r.cw},${nullNum(r.usd)},${esc(r.st)},` +
    `${nullNum(r.code)},${nullStr(r.note)},${esc(JSON.stringify(r.tools))},${nullStr(r.host)},${nullStr(r.agent ?? undefined)},${nullStr(r.id)},` +
    `${r.toolFacts && r.toolFacts.length > 0 ? esc(JSON.stringify(r.toolFacts)) : 'NULL'},${nullStr(r.gateway)});`;
}

// Unchanged transcripts are skipped via mtime+size; rows for deleted ones are kept so rotation never erases history.
export function syncUsageDb(): boolean {
  let db: string;
  guardReport = null;
  let preWipe = -1;
  let migrated = false;
  try {
    db = usageDbPath();
    const stored = storedParserVersion(db);
    // The operator deleted sessions on purpose and wants the mirror to match: bypass the guard.
    const forced = process.env.TERSIO_FORCE_REPARSE === '1';
    // A downgrade keeps its rows: the wipe below cannot rebuild them from rotated transcripts.
    const downgrade = !forced && isDowngrade(stored);
    migrated = stored !== null && stored !== PARSER_VERSION && !downgrade;
    if (downgrade) guardReport = `store was written by a newer tersio (parser ${stored} > ${PARSER_VERSION}); kept its rows and skipped the re-parse`;
    if (migrated && !forced) preWipe = countMessages(db);
    ensureSchema(db, forced);
    // One rewrite so the additive columns' NULL rows gain latency and tool facts; runs while a marker is absent.
    if (!downgrade && (!ttftBackfilled(db) || !toolFactsBackfilled(db))) markTranscriptsDirty(db);
    maybeScheduledBackup();
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
    // A store predating the tool names re-reads the whole table once; the marker closes the window.
    const since = newest === null || !opencodeToolsBackfilled(db) ? 0 : newest - OPENCODE_DB_OVERLAP_MS;
    if (newest !== null || fs.existsSync(ocDbPath)) {
      ocDbRows.push(...readOpencodeDbRows(ocDbPath, since));
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
  // `ocDbRows` is non-empty whenever the backfill window is open, so this never skips it.
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
      for (const r of parseFile(text, hostOfSessionFile(file), file, agentOfSessionText(text))) {
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
        insertSql(key, opencodeStoredRow(parsed, 'opencode', row.id, opencodeToolNames(row.row, row.tools))),
      )) return false;
    }
  } catch {
    return false;
  }
  if (!push(`INSERT OR REPLACE INTO meta (k, v) VALUES ('last_sync',${esc(String(Date.now()))});`)) return false;
  // Only once the rows are written, so a sync that fails midway widens the scan again.
  if (ocDbRows.length > 0) {
    if (!push(`INSERT OR REPLACE INTO meta (k, v) VALUES ('opencode_tools','${OPENCODE_TOOLS_VERSION}');`)) return false;
  }
  // Set only after the rewrite commits: a crash mid-backfill leaves mtimes cleared and the marker absent.
  if (changed.length > 0) {
    if (!push(`INSERT OR REPLACE INTO meta (k, v) VALUES ('ttft_backfill','${TTFT_VERSION}');`)) return false;
    if (!push(`INSERT OR REPLACE INTO meta (k, v) VALUES ('tool_facts','${TOOL_FACTS_VERSION}');`)) return false;
  }
  if (!flush()) return false;
  if (preWipe > 0) {
    const kept = countMessages(db);
    if (kept < preWipe * REPARSE_GUARD_RATIO) {
      const newest = newestDataBackup();
      const ledger = path.basename(usageDbPath());
      if (newest && restoreSnapshotMember(newest, ledger)) {
        guardReport = `re-parse kept ${kept} of ${preWipe} rows; restored ${newest.name} (set TERSIO_FORCE_REPARSE=1 to accept the loss)`;
        return false;
      }
    }
  }
  // Reclaim the migration's DELETE storm so the file stays small.
  if (migrated) {
    try { run(db, `VACUUM;`); } catch { /* best-effort */ }
  }
  // Fold the WAL back into the main file. Snapshots read through the WAL themselves, so this only keeps the ledger's own directory small.
  try { run(db, `PRAGMA wal_checkpoint(TRUNCATE);`); } catch { /* best-effort */ }
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
    // The wide `tools` column is read as one string and skipped in JS; a pre-agent store is read without it.
    const names = query(db, `PRAGMA table_info(messages);`).map((r) => r[1]);
    const agentCol = names.includes('a') ? 'a' : "''";
    // A store predating first-token latency has no `tf` column; read NULL so the row still loads.
    const tfCol = names.includes('tf') ? 'tf' : 'NULL';
    rows = query(db, `SELECT t, model, i, o, d, cr, cw, usd, st, code, note, tools, h, ${agentCol}, id, ${tfCol} FROM messages;`);
  } catch {
    return null;
  }
  const accum = newSessionAccum();
  for (const [t, model, i, o, d, cr, cw, usd, st, code, note, tools, h, a, id, tf] of rows) {
    const ts = t === '' ? undefined : Number(t);
    let toolNames: string[] = [];
    if (tools && tools !== '[]' && tools !== '') {
      try {
        const parsed: unknown = JSON.parse(tools);
        if (Array.isArray(parsed)) toolNames = parsed.filter((x): x is string => typeof x === 'string');
      } catch { /* keep empty */ }
    }
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
      a === '' ? undefined : a,
      tf === undefined || tf === '' ? undefined : Number(tf),
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
      byAgent: accum.byAgent,
      byAgentMessages: accum.byAgentMessages,
      byModelMeasured: accum.byModelMeasured,
      byModelCostMessages: accum.byModelCostMessages,
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
