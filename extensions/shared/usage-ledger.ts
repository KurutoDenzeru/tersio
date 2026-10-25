// Usage ledger: append-only JSON lines, read by the CLI, `/tersio`, and the Dashboard. Corrupt lines are skipped.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { homeDir, isPiProcess, piAgentDir, resolveRtkBinary, rtkDirs, shimCommand, tersioDataPath } from './utils.ts';
import { tersioStateFile } from './state.ts';
import { eligibleHeads } from './rtk-eligible.ts';
import { sqliteRead } from './sqlite.ts';
import { patchState, readState, takeLegacy } from './state.ts';

export type UsageKind = 'command' | 'toggle' | 'install' | 'update' | 'rtk-audit';

export interface UsageRow {
  ts: number;
  kind: UsageKind;
  detail: string;
}

export function ledgerPath(): string {
  const override = process.env.TERSIO_USAGE_FILE;
  if (override) return override;
  return tersioDataPath('usage.jsonl', 'tersio-usage.jsonl');
}

// Reset watermark: views filter rows older than it, so nothing else is deleted. The env override still names a file.
export function resetMarkerPath(): string {
  const override = process.env.TERSIO_RESET_FILE;
  if (override) return override;
  return tersioStateFile();
}

export function readResetWatermark(): number {
  const override = process.env.TERSIO_RESET_FILE;
  if (!override) {
    const value = readState().reset;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
    const legacy = takeLegacy(tersioDataPath('reset.json', 'tersio-reset.json'), (raw) => {
      const ts = (JSON.parse(raw) as { ts?: unknown }).ts;
      return typeof ts === 'number' && Number.isFinite(ts) && ts > 0 ? ts : null;
    });
    if (legacy !== null) {
      patchState({ reset: legacy });
      return legacy;
    }
    return 0;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(override, 'utf8')) as { ts?: unknown };
    return typeof raw.ts === 'number' && Number.isFinite(raw.ts) && raw.ts > 0 ? raw.ts : 0;
  } catch {
    return 0;
  }
}

export function markReset(now = Date.now()): number {
  if (process.env.TERSIO_RESET_FILE) {
    try {
      fs.mkdirSync(path.dirname(resetMarkerPath()), { recursive: true });
      fs.writeFileSync(resetMarkerPath(), JSON.stringify({ ts: now }) + '\n', 'utf8');
    } catch { /* best-effort */ }
    return now;
  }
  patchState({ reset: now });
  return now;
}

export function appendUsage(kind: UsageKind, detail: string): void {
  const row = JSON.stringify({ ts: Date.now(), kind, detail }) + '\n';
  try {
    fs.mkdirSync(path.dirname(ledgerPath()), { recursive: true });
    fs.appendFileSync(ledgerPath(), row, 'utf8');
  } catch { /* ledger is best-effort; never break the caller */ }
}

// Session tokens, tokscale-style: assistant messages in the host transcripts carry usage, model, and a timestamp.
export interface TokenBreakdown {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

// `toolUse` is an ordinary turn that handed off to tools, so it reads completed.
export type RunStatus = 'completed' | 'aborted' | 'error';

export interface RecentRequest {
  m: string;
  i: number;
  o: number;
  t: number;
  d?: number;
  /** First-token latency, when the host recorded one. */
  tf?: number;
  /** Which agent wrote the session: pi, omp, or codex. */
  h?: string;
  cr?: number;
  cw?: number;
  // Undefined when the host recorded no cost; never backfilled.
  usd?: number;
  st: RunStatus;
  code?: number;
  note?: string;
  /** Name, argument bytes, result bytes, and error flag per call; facts for the Tools page. */
  toolFacts?: ToolFact[];
  /** Message id when the host provides one (transcript row id, opencode msg file). */
  id?: string;
}

export interface SessionTokens {
  messages: number;
  totals: TokenBreakdown;
  byModel: Record<string, TokenBreakdown>;
  byDay: Record<string, TokenBreakdown>;
  byDayModel: Record<string, Record<string, number>>;
  byTool: Record<string, number>;
  byModelMessages: Record<string, number>;
  byHost: Record<string, Record<string, TokenBreakdown>>;
  /** Model -> agent kind (`main`, `subagent`), so a subagent's work reads apart from its root's. */
  byAgent: Record<string, Record<string, TokenBreakdown>>;
  /** Model -> agent kind -> message count, so a share can read requests beside the tokens. */
  byAgentMessages: Record<string, Record<string, number>>;
  /** Model -> cost the host reported, over the messages that carried one. */
  byModelMeasured: Record<string, number>;
  /** Model -> messages that carried a cost. Compare to `byModelMessages` before trusting the sum. */
  byModelCostMessages: Record<string, number>;
  costMeasured: number;
  recent: RecentRequest[];
}

export interface RtkHostAdoption {
  bashCalls: number;
  eligibleCalls: number;
  rtkCalls: number;
  missedCalls: number;
  adoptionPct: number;
}

export interface RtkAdoption {
  sessions: number;
  bashCalls: number;
  eligibleCalls: number;
  rtkCalls: number;
  missedCalls: number;
  adoptionPct: number;
  /** One entry per host that recorded bash calls, so a blended number cannot hide a host. */
  byHost: Record<string, RtkHostAdoption>;
}

export interface RtkRecallDiagnostics {
  mode: 'sqlite' | 'tee' | 'disabled' | 'unknown';
  entries: number;
  available: boolean;
}

function zeroBreakdown(): TokenBreakdown {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}
function stampMs(ts: string | number | undefined): number {
  return ts === undefined ? NaN : typeof ts === 'number' ? ts : Date.parse(ts);
}

export function durOf(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
}

// Measured cost: usage.cost.total, or a bare number in old fixtures. Anything else means unrecorded, not 0.
export function costOf(usage: Record<string, unknown>): number | undefined {
  const c = usage.cost;
  if (typeof c === 'number') return Number.isFinite(c) ? c : undefined;
  if (c && typeof c === 'object') {
    const total = (c as { total?: unknown }).total;
    if (typeof total === 'number' && Number.isFinite(total)) return total;
  }
  return undefined;
}

// First line only: real messages carry multi-line provider errors, and this ends up in a tooltip.
export function statusOf(msg: { stopReason?: unknown; errorStatus?: unknown; errorMessage?: unknown; isError?: unknown }): { st: RunStatus; code?: number; note?: string } {
  const stop = typeof msg.stopReason === 'string' ? msg.stopReason : '';
  const note = typeof msg.errorMessage === 'string' && msg.errorMessage.trim()
    ? msg.errorMessage.split('\n')[0].trim().slice(0, 180)
    : undefined;
  if (stop === 'error' || msg.isError === true) {
    const code = typeof msg.errorStatus === 'number' && Number.isFinite(msg.errorStatus) ? msg.errorStatus : undefined;
    return { st: 'error', code, note };
  }
  if (stop === 'aborted') return { st: 'aborted', note };
  return { st: 'completed', note };
}

function addInto(into: TokenBreakdown, u: { input?: unknown; output?: unknown; cacheRead?: unknown; cacheWrite?: unknown }): void {
  for (const k of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) {
    const v = u[k];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) into[k] += Math.floor(v);
  }
}

export function sessionsDirs(): string[] {
  const override = process.env.TERSIO_SESSIONS_DIR;
  if (override) return [override];
  // Every host, not just the running one: a session is missing if we stop at the first existing directory.
  const dirs = isPiProcess()
    ? [path.join(piAgentDir(), 'sessions'), path.join(homeDir(), '.omp', 'agent', 'sessions'), path.join(homeDir(), '.codex', 'sessions')]
    : [path.join(homeDir(), '.omp', 'agent', 'sessions'), path.join(piAgentDir(), 'sessions'), path.join(homeDir(), '.codex', 'sessions')];
  const found = dirs.filter((dir) => fs.existsSync(dir));
  return found.length > 0 ? found : [dirs[0]];
}

export function sessionsDir(): string {
  return sessionsDirs()[0];
}

// One JSON file per message; probe XDG, then local, then macOS default.
export function opencodeSessionsDir(): string {
  const override = process.env.TERSIO_OPENCODE_DIR;
  if (override) return override;
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg && xdg.trim() !== '') return path.join(xdg, 'opencode', 'storage', 'message');
  const local = path.join(homeDir(), '.local', 'share', 'opencode', 'storage', 'message');
  try {
    if (fs.existsSync(local)) return local;
  } catch { /* fall through to the platform default */ }
  return path.join(homeDir(), 'Library', 'Application Support', 'opencode', 'storage', 'message');
}

// OpenCode v2 keeps messages in sqlite; the JSON tree above is only the pre-v2 layout.
export function opencodeDbPath(): string {
  const override = process.env.TERSIO_OPENCODE_DB;
  if (override) return override;
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg && xdg.trim() !== '') return path.join(xdg, 'opencode', 'opencode.db');
  const local = path.join(homeDir(), '.local', 'share', 'opencode', 'opencode.db');
  try {
    if (fs.existsSync(local)) return local;
  } catch { /* fall through to the platform default */ }
  return path.join(homeDir(), 'Library', 'Application Support', 'opencode', 'opencode.db');
}

export interface OpencodeDbRow {
  id: string;
  created: number;
  row: OpencodeMessage;
  /** Tool names this message called, comma-joined. Empty when it called none. */
  tools?: string;
}

// `message` vs `session_message`: read scalars only, since the blob's newlines break the row-per-line output.
const OC_DB_ORDER = ' ORDER BY time_created;';
const OC_DB_COLUMNS =
  'json_extract(data,\'$.time.created\'), json_extract(data,\'$.time.streamed\'), json_extract(data,\'$.time.completed\'),' +
  ' json_extract(data,\'$.tokens.input\'), json_extract(data,\'$.tokens.output\'),' +
  ' json_extract(data,\'$.tokens.cache.read\'), json_extract(data,\'$.tokens.cache.write\'), json_extract(data,\'$.cost\')';
const OC_DB_TOOLS =
  '(SELECT group_concat(json_extract(j.value,\'$.name\')) FROM json_each(data,\'$.content\') j' +
  ' WHERE json_extract(j.value,\'$.type\')=\'tool\')';
const ocDbLegacy = (since: number): string =>
  `SELECT id, time_created, json_extract(data,'$.role'), json_extract(data,'$.providerID'), json_extract(data,'$.modelID'), ${OC_DB_COLUMNS}, ${OC_DB_TOOLS}` +
  ` FROM message WHERE json_extract(data,'$.role')='assistant' AND time_created > ${since}${OC_DB_ORDER}`;
const ocDbCurrent = (since: number): string =>
  `SELECT id, time_created, 'assistant', json_extract(data,'$.model.providerID'), json_extract(data,'$.model.id'), ${OC_DB_COLUMNS}, ${OC_DB_TOOLS}` +
  ` FROM session_message WHERE type='assistant' AND time_created > ${since}${OC_DB_ORDER}`;

// A re-scan window covers tokens that land after the row was created, so a late fill is not lost.
export const OPENCODE_DB_OVERLAP_MS = 3_600_000;

// Empty when no SQLite is available or the db is unreadable; that is a sync skip, not a failure.
export function readOpencodeDbRows(db: string, sinceMs: number): OpencodeDbRow[] {
  if (!Number.isFinite(sinceMs)) return [];
  try {
    if (!fs.existsSync(db)) return [];
    const since = Math.max(0, Math.floor(sinceMs));
    // Separate calls: a db holding only one table must not cancel the other.
    const run = (sql: string): string => sqliteRead(db, sql);
let out = '';
try { out += run(ocDbLegacy(since)); } catch { /* no legacy table or unreadable */ }
try { out += run(ocDbCurrent(since)); } catch { /* no session_message table or unreadable */ }
    const rows: OpencodeDbRow[] = [];
    for (const line of out.split('\n')) {
      if (!line.trim()) continue;
      const [id, created, role, providerID, modelID, tCreated, tStreamed, tCompleted, input, output, cacheRead, cacheWrite, cost, tools] = line.split('\t');
      const n = (v: string | undefined): unknown => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
      rows.push({
        id,
        created: Number(created),
        tools: tools ?? '',
        row: {
          role,
          modelID,
          providerID,
          tokens: { input: n(input), output: n(output), cache: { read: n(cacheRead), write: n(cacheWrite) } },
          time: { created: n(tCreated), streamed: n(tStreamed), completed: n(tCompleted) },
          cost: n(cost),
        },
      });
    }
    return rows;
  } catch {
    return [];
  }
}

export function dayKey(ts: string | number): string | null {
  const ms = typeof ts === 'number' ? ts : Date.parse(ts);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// OpenCode tool parts carry the command in the message blob; sqliteRead is line-based, so newlines are flattened in SQL.
const OC_BASH_CMD = "replace(replace(json_extract(j.value,'$.state.input.command'), char(10), ' '), char(13), ' ')";
const OC_BASH_TOOL = "json_extract(j.value,'$.type')='tool' AND (json_extract(j.value,'$.name')='bash' OR json_extract(j.value,'$.name')='shell')";
const ocBashLegacy = `SELECT message.id, json_extract(message.data,'$.sessionID'), ${OC_BASH_CMD} FROM message, json_each(message.data,'$.content') j WHERE json_extract(message.data,'$.role')='assistant' AND ${OC_BASH_TOOL}`;
const ocBashCurrent = `SELECT session_message.id, session_message.session_id, ${OC_BASH_CMD} FROM session_message, json_each(session_message.data,'$.content') j WHERE session_message.type='assistant' AND ${OC_BASH_TOOL}`;

export interface OpencodeBashRow {
  id: string;
  sessionId: string;
  command: string;
}

/** Every executed bash command in an OpenCode db, v2 first and the legacy table second. */
export function readOpencodeBashRows(db: string): OpencodeBashRow[] {
  const rows: OpencodeBashRow[] = [];
  try {
    if (!fs.existsSync(db)) return rows;
    let out = '';
    try { out += sqliteRead(db, ocBashCurrent); } catch { /* no v2 table */ }
    try { out += sqliteRead(db, ocBashLegacy); } catch { /* no legacy table */ }
    for (const line of out.split('\n')) {
      if (!line.trim()) continue;
      const [id, sessionId, command] = line.split('\t');
      if (typeof command !== 'string' || !command.trim()) continue;
      rows.push({ id: id ?? '', sessionId: sessionId ?? '', command });
    }
  } catch { /* an unreadable db is a skip, not a failure */ }
  return rows;
}

// Pre-v2 OpenCode stores one message per JSON file; the same tool-part shape holds the command.
function opencodeFileBash(file: string): { commands: string[]; sessionId: string } {
  try {
    const message = JSON.parse(fs.readFileSync(file, 'utf8')) as { sessionID?: unknown; content?: unknown };
    const parts = Array.isArray(message.content) ? message.content : [];
    const commands: string[] = [];
    for (const part of parts) {
      const p = part as { type?: unknown; name?: unknown; state?: { input?: { command?: unknown } } };
      if (p?.type !== 'tool') continue;
      if (p.name !== 'bash' && p.name !== 'shell') continue;
      const command = p.state?.input?.command;
      if (typeof command === 'string' && command) commands.push(command);
    }
    return { commands, sessionId: typeof message.sessionID === 'string' ? message.sessionID : '' };
  } catch {
    return { commands: [], sessionId: '' };
  }
}
export function walkJsonl(dir: string, out: string[], cap: number, ext = '.jsonl'): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= cap) return;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkJsonl(full, out, cap, ext);
    else if (e.isFile() && e.name.endsWith(ext)) out.push(full);
  }
}
// Recent rows are a newest-first window over lifetime history; aggregates keep everything.
export const RECENT_LIMIT = 2000;
const FREE_SUFFIX = /(?::free|-free)$/i;
// Parse buffer shared by live reads and usage.db syncs, so the store is a cache and never a fork.
export interface SessionAccum {
  byModel: Record<string, TokenBreakdown>;
  byDay: Record<string, TokenBreakdown>;
  byDayModel: Record<string, Record<string, number>>;
  byTool: Record<string, number>;
  byModelMessages: Record<string, number>;
  byHost: Record<string, Record<string, TokenBreakdown>>;
  /** Model -> agent kind (`main`, `subagent`), so a subagent's work reads apart from its root's. */
  byAgent: Record<string, Record<string, TokenBreakdown>>;
  /** Model -> agent kind -> message count. */
  byAgentMessages: Record<string, Record<string, number>>;
  /** Model -> cost the host itself reported, summed over the messages that carried one. */
  byModelMeasured: Record<string, number>;
  /** Model -> messages that carried a cost. Compare to `byModelMessages` before trusting the sum. */
  byModelCostMessages: Record<string, number>;
  totals: TokenBreakdown;
  messages: number;
  costMeasured: number;
  recent: RecentRequest[];
  /** Distinct tool facts across the window, so a caller can read the set without re-parsing. */
  toolFacts: ToolFact[];
  /** Oldest timestamp held in `recent`, so the list stays bounded instead of growing with the store. */
  recentFloor: number;
}
export function newSessionAccum(): SessionAccum {
  return { byModel: {}, byDay: {}, byDayModel: {}, byTool: {}, byModelMessages: {}, byHost: {}, byAgent: {}, byAgentMessages: {}, byModelMeasured: {}, byModelCostMessages: {}, totals: zeroBreakdown(), messages: 0, costMeasured: 0, recent: [], recentFloor: Number.POSITIVE_INFINITY, toolFacts: [] };
}
export function ingestSessionRow(accum: SessionAccum, model: string, usage: Record<string, unknown>, ts: string | number | undefined, durMs?: unknown, run?: { st: RunStatus; code?: number; note?: string }, toolNames?: string[], host?: string, id?: string, agent?: string, ttftMs?: unknown, toolFacts?: ToolFact[]): boolean {
  const watermark = readResetWatermark();
  const ms = ts === undefined ? NaN : typeof ts === 'number' ? ts : Date.parse(ts);
  if (watermark > 0 && (!Number.isFinite(ms) || ms < watermark)) return false;
  addInto(accum.totals, usage);
  const key = model.replace(FREE_SUFFIX, '').toLowerCase();
  accum.byModel[key] ??= zeroBreakdown();
  addInto(accum.byModel[key], usage);
  accum.byModelMessages[key] = (accum.byModelMessages[key] ?? 0) + 1;
  if (host) {
    const hs = (accum.byHost[key] ??= {});
    hs[host] ??= zeroBreakdown();
    addInto(hs[host], usage);
  }
  if (agent) {
    const as = (accum.byAgent[key] ??= {});
    as[agent] ??= zeroBreakdown();
    addInto(as[agent], usage);
    const am = (accum.byAgentMessages[key] ??= {});
    am[agent] = (am[agent] ?? 0) + 1;
  }
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  if (Number.isFinite(ms)) {
    const outcome = run ?? { st: 'completed' as RunStatus };
    // Only the newest rows are read: skip below the floor, and a 50k-row store costs 2000 rows of memory.
    if (accum.recent.length < RECENT_LIMIT || ms >= accum.recentFloor) {
      accum.recent.push({ m: key, i: num(usage.input), o: num(usage.output), t: ms, d: durOf(durMs), tf: durOf(ttftMs), h: host, cr: num(usage.cacheRead), cw: num(usage.cacheWrite), usd: costOf(usage), st: outcome.st, code: outcome.code, note: outcome.note, id });
      if (accum.recent.length > RECENT_LIMIT) {
        let drop = 0;
        for (let k = 1; k < accum.recent.length; k += 1) if (accum.recent[k].t < accum.recent[drop].t) drop = k;
        accum.recent.splice(drop, 1);
        accum.recentFloor = accum.recent.reduce((lo, r) => Math.min(lo, r.t), Number.POSITIVE_INFINITY);
      } else if (ms < accum.recentFloor) {
        accum.recentFloor = ms;
      }
    }
  }
  const day = ts !== undefined ? dayKey(ts) : null;
  if (day) {
    accum.byDay[day] ??= zeroBreakdown();
    addInto(accum.byDay[day], usage);
    const sum = ['input', 'output', 'cacheRead', 'cacheWrite'].reduce((a, k) => a + (typeof usage[k] === 'number' && Number.isFinite(usage[k]) ? Math.floor(usage[k] as number) : 0), 0);
    if (sum > 0) {
      accum.byDayModel[day] ??= {};
      accum.byDayModel[day][key] = (accum.byDayModel[day][key] ?? 0) + sum;
    }
  }
  accum.messages += 1;
  const measured = costOf(usage);
  if (measured !== undefined) {
    accum.costMeasured += measured;
    accum.byModelMeasured[key] = (accum.byModelMeasured[key] ?? 0) + measured;
    accum.byModelCostMessages[key] = (accum.byModelCostMessages[key] ?? 0) + 1;
  }
  for (const name of toolNames ?? []) accum.byTool[name] = (accum.byTool[name] ?? 0) + 1;
  for (const fact of toolFacts ?? []) if (!accum.toolFacts.some((f) => f.n === fact.n && f.a === fact.a && f.r === fact.r && f.e === fact.e)) accum.toolFacts.push(fact);
  return true;
}
export type SessionLineKind = 'codex_provider' | 'codex_model' | 'token_row' | 'assistant_row' | 'skip';

/** New-line-split transcript, so every pass reads the same rows. */
export interface SessionTextLines {
  /** A line that parsed, or the error that kept it out. */
  parsed: Array<{ row: SessionLineRow }>;
  errors: number;
}

export function parseSessionLines(text: string): SessionTextLines {
  const parsed: Array<{ row: SessionLineRow }> = [];
  let errors = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      parsed.push({ row: JSON.parse(line) as SessionLineRow });
    } catch {
      errors += 1;
    }
  }
  return { parsed, errors };
}

/** One tool call with the facts the Tools page reads: name, argument bytes, result bytes, error flag. */
export interface ToolFact {
  n: string;
  a: number;
  r: number;
  e: number;
}

/** Result text length and error flag per call id: both sit on the `toolResult` line, not on the call. */
export type ToolResults = Map<string, { chars: number; error: boolean }>;

/** The bytes a JSON value serializes to, which is what the model sent and the host stored. */
function jsonChars(value: unknown): number {
  if (value === undefined) return 0;
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

/** Every `toolResult` line in a transcript, keyed by the call it closes. */
export function collectToolResults(text: string): ToolResults {
  const found: ToolResults = new Map();
  for (const line of text.split('\n')) {
    if (!line.includes('toolResult')) continue;
    try {
      const row = JSON.parse(line) as { message?: { role?: unknown; toolCallId?: unknown; content?: unknown; isError?: unknown } };
      const msg = row.message;
      if (!msg || msg.role !== 'toolResult' || typeof msg.toolCallId !== 'string' || !msg.toolCallId) continue;
      const parts = Array.isArray(msg.content) ? msg.content as Array<Record<string, unknown>> : [];
      const chars = parts.reduce((sum, part) => sum + (typeof part.text === 'string' ? part.text.length : 0), 0);
      found.set(msg.toolCallId, { chars, error: msg.isError === true });
    } catch { /* skip a corrupt line */ }
  }
  return found;
}

/** A transcript line as every host writes it. Only the fields the parse reads are named. */
export interface SessionLineRow {
  timestamp?: string | number;
  type?: unknown;
  message?: {
    role?: unknown;
    model?: unknown;
    provider?: unknown;
    usage?: Record<string, unknown>;
    duration?: unknown;
    ttft?: unknown;
    completedAt?: unknown;
    timestamp?: unknown;
    stopReason?: unknown;
    errorStatus?: unknown;
    errorMessage?: unknown;
    isError?: unknown;
    content?: Array<{ type?: unknown; name?: unknown; id?: unknown; arguments?: unknown }>;
  };
  payload?: {
    type?: unknown;
    model?: unknown;
    model_provider?: unknown;
    info?: { last_token_usage?: Record<string, unknown> };
    call_id?: unknown;
    name?: unknown;
    input?: unknown;
    output?: Array<{ text?: unknown }>;
    item?: { type?: unknown; command?: unknown; exit_code?: unknown; duration_secs?: unknown };
    turn_id?: unknown;
    duration_ms?: unknown;
    time_to_first_token_ms?: unknown;
  };
}

/** What one transcript line classifies to. `assistant_row` carries the usage and the tool facts. */
export interface SessionLine {
  kind: SessionLineKind;
  provider?: string;
  model?: string;
  usage?: Record<string, unknown>;
  callId?: string;
  callName?: string;
  callChars?: number;
  turnId?: string;
  durMs?: number;
  ttftMs?: number;
  run?: { st: RunStatus; code?: number; note?: string };
  tools?: string[];
  toolFacts?: ToolFact[];
  ms?: number;
}

export function classifySessionLine(row: SessionLineRow, results?: ToolResults): SessionLine {
  const payload = row.payload;
  if (payload && typeof payload === 'object') {
    if (row.type === 'session_meta' && typeof payload.model_provider === 'string') return { kind: 'codex_provider', provider: payload.model_provider };
    // A Codex transcript states the model once per turn, in turn_context.
    if (row.type === 'turn_context' && typeof payload.model === 'string' && payload.model) {
      return { kind: 'codex_model', model: payload.model };
    }
    if (payload.type === 'token_count') {
      const last = payload.info?.last_token_usage;
      if (last) {
        const provider = typeof payload.model_provider === 'string' ? payload.model_provider : undefined;
        const ts = row.timestamp === undefined ? NaN : typeof row.timestamp === 'number' ? row.timestamp : Date.parse(row.timestamp);
        return { kind: 'token_row', provider, model: 'codex', usage: { input: last['input_tokens'], output: last['output_tokens'], cacheRead: last['cached_input_tokens'], cacheWrite: last['cache_write_input_tokens'] }, ms: Number.isFinite(ts) ? ts : undefined };
      }
    }
    // A Codex tool call: `custom_tool_call` carries the name and input; the call id ties the output to it.
    if (payload.type === 'custom_tool_call' && typeof payload.call_id === 'string' && typeof payload.name === 'string' && payload.name) {
      return { kind: 'assistant_row', model: 'codex-tool-call', callId: payload.call_id, callName: payload.name, callChars: typeof payload.input === 'string' ? payload.input.length : jsonChars(payload.input) };
    }
    if (payload.type === 'custom_tool_call_output' && typeof payload.call_id === 'string') {
      const parts = Array.isArray(payload.output) ? payload.output : [];
      const chars = parts.reduce((sum, part) => sum + (typeof part?.text === 'string' ? part.text.length : 0), 0);
      results?.set(payload.call_id, { chars, error: false });
      return { kind: 'skip' };
    }
    // A Codex shell fact: the host's own record of one command, its exit code, and its wall time.
    if (payload.type === 'item_completed' && payload.item?.type === 'CommandExecution') {
      const cmds = Array.isArray(payload.item.command) ? payload.item.command : [];
      // The array holds the shell and its flags; the script tail is what the model asked to run.
      const script = cmds.filter((c): c is string => typeof c === 'string').at(-1) ?? '';
      const fact: ToolFact = { n: `bash:${leadBinary(script)}`, a: script.length, r: 0, e: payload.item.exit_code === 0 ? 0 : 1 };
      return { kind: 'assistant_row', model: 'codex-shell-fact', turnId: typeof payload.turn_id === 'string' ? payload.turn_id : undefined, toolFacts: [fact], durMs: durOf(payload.item.duration_secs), callName: 'bash', callChars: script.length };
    }
    // A Codex turn summary: the timing the token rows lack, keyed by turn.
    if (payload.type === 'task_complete') {
      return { kind: 'token_row', provider: typeof payload.model_provider === 'string' ? payload.model_provider : undefined, turnId: typeof payload.turn_id === 'string' ? payload.turn_id : undefined, durMs: durOf(payload.duration_ms), ttftMs: durOf(payload.time_to_first_token_ms) };
    }
  }
  const msg = row.message;
  if (!msg || msg.role !== 'assistant' || !msg.usage) return { kind: 'skip' };
  const model = typeof msg.model === 'string' && msg.model ? msg.model : 'unknown';
  // pi omits duration, so derive Elapsed/Speed from the timestamp pair.
  const startMs = typeof msg.timestamp === 'number' ? msg.timestamp : undefined;
  const endMs = typeof msg.completedAt === 'number' ? msg.completedAt : stampMs(row.timestamp);
  const computedDur = startMs !== undefined && Number.isFinite(endMs) && endMs > startMs ? endMs - startMs : undefined;
  const tools: string[] = [];
  const toolFacts: ToolFact[] = [];
  for (const part of msg.content ?? []) {
    if (part?.type !== 'toolCall' || typeof part.name !== 'string' || !part.name) continue;
    const name = part.name === 'bash'
      ? `bash:${leadBinary((part.arguments as { command?: unknown } | null)?.command)}`
      : part.name;
    tools.push(name);
    const result = typeof part.id === 'string' ? results?.get(part.id) : undefined;
    toolFacts.push({ n: name, a: jsonChars(part.arguments), r: result?.chars ?? 0, e: result?.error ? 1 : 0 });
  }
  // The gateway that served the turn: `commandcode` for `deepseek/...`, which the model id cannot show.
  const provider = typeof msg.provider === 'string' && msg.provider ? msg.provider : undefined;
  return { kind: 'assistant_row', model, provider, usage: msg.usage, durMs: typeof msg.duration === 'number' ? msg.duration : computedDur, ttftMs: typeof msg.ttft === 'number' ? msg.ttft : undefined, run: statusOf(msg), tools, toolFacts };
}
// True when at least one token bucket holds a positive finite count.
export function hasPositiveUsage(usage: Record<string, unknown>): boolean {
  for (const k of ['input', 'output', 'cacheRead', 'cacheWrite']) {
    const v = usage[k];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return true;
  }
  return false;
}

export interface OpencodeMessage {
  role?: unknown;
  tokens?: { input?: unknown; output?: unknown; reasoning?: unknown; cache?: { read?: unknown; write?: unknown } } | null;
  modelID?: unknown;
  providerID?: unknown;
  time?: { created?: unknown; streamed?: unknown; completed?: unknown } | null;
  cost?: unknown;
  finish?: unknown;
  /** The message's parts. Tool calls sit here, named under a part of type `tool`. */
  content?: unknown;
}

/** Tool names an OpenCode message called; v2 passes SQL's comma-joined string as the blob holds newlines. */
export function opencodeToolNames(message: OpencodeMessage, joined?: string): string[] {
  if (joined !== undefined) return joined === '' ? [] : joined.split(',');
  const parts = message?.content;
  if (!Array.isArray(parts)) return [];
  const names: string[] = [];
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    if ((part as Record<string, unknown>).type !== 'tool') continue;
    const name = (part as Record<string, unknown>).name;
    if (typeof name === 'string' && name) names.push(name);
  }
  return names;
}

/** One OpenCode assistant message, as the shared accumulator reads it. */
export interface OpencodeClassification {
  model: string;
  usage: Record<string, unknown>;
  ms: number | undefined;
  durMs: number | undefined;
  ttftMs: number | undefined;
}

// One OpenCode message file; assistant rows carry the token buckets.
export function classifyOpencodeMessage(obj: OpencodeMessage | null | undefined): OpencodeClassification | null {
  if (!obj || typeof obj !== 'object' || obj.role !== 'assistant') return null;
  const t = obj.tokens;
  if (!t || typeof t !== 'object') return null;
  const usage: Record<string, unknown> = {
    input: t.input,
    output: t.output,
    cacheRead: t.cache?.read,
    cacheWrite: t.cache?.write,
    cost: (obj as Record<string, unknown>).cost,
  };
  if (!hasPositiveUsage(usage)) return null;
  const provider = typeof obj.providerID === 'string' && obj.providerID ? obj.providerID : 'unknown';
  const model = typeof obj.modelID === 'string' && obj.modelID ? obj.modelID : 'unknown';
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);
  const created = num(obj.time?.created);
  const completed = num(obj.time?.completed);
  // `streamed` is when the first token arrived, so it is the host's own first-token latency.
  const streamed = num(obj.time?.streamed);
  return {
    model: `opencode/${provider}/${model}`,
    usage,
    ms: created,
    durMs: created !== undefined && completed !== undefined && completed > created ? completed - created : undefined,
    ttftMs: created !== undefined && streamed !== undefined && streamed > created ? streamed - created : undefined,
  };
}

export function processOpencodeFile(accum: SessionAccum, text: string, file?: string): void {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return;
  }
  const message = obj as OpencodeMessage;
  const parsed = classifyOpencodeMessage(message);
  if (!parsed) return;
  const id = file ? path.basename(file).replace(/\.[^.]+$/, '') || undefined : undefined;
  ingestSessionRow(accum, parsed.model, parsed.usage, parsed.ms, parsed.durMs, { st: 'completed' as RunStatus }, opencodeToolNames(message), 'opencode', id, 'main', parsed.ttftMs);
}

// One v2 message row into the shared accum. The msg id is the row primary key.
export function ingestOpencodeDbRow(accum: SessionAccum, row: OpencodeDbRow): void {
  const parsed = classifyOpencodeMessage(row.row);
  if (!parsed) return;
  ingestSessionRow(accum, parsed.model, parsed.usage, parsed.ms, parsed.durMs, { st: 'completed' as RunStatus }, opencodeToolNames(row.row, row.tools), 'opencode', row.id, 'main', parsed.ttftMs);
}

// Fold `:free`/`-free` suffixes and case variants into one chart key.
export function canonicalModelId(model: string): string {
  return canonicalPriceId(model.replace(FREE_SUFFIX, ''));
}
// Transcript row id when the host provides one; anything else is not an id.
export function messageRowId(row: unknown): string | undefined {
  const id = (row as { id?: unknown }).id;
  return typeof id === 'string' && id ? id : undefined;
}

// Vendor names mirror the dashboard map; family first, so gateway segments shadow it (minimaxai holds xai).
const VENDOR_RES: Array<[RegExp, string]> = [
  [/inclusionai|ling-/i, 'InclusionAI'],
  [/minimax/i, 'MiniMax'],
  [/grok|xai/i, 'xAI'],
  [/stealth|space-bunny/i, 'Stealth'],
  [/openai|codex|gpt-|o1/i, 'OpenAI'],
  [/muse|llama/i, 'Meta'],
  [/deepseek/i, 'DeepSeek'],
  [/qwen|qwq/i, 'Alibaba'],
  [/glm|z-ai|zhipu/i, 'Z.ai'],
  [/mimo/i, 'Xiaomi'],
  [/kimi|moonshot/i, 'Moonshot'],
  [/mistral/i, 'Mistral'],
  [/claude|anthropic/i, 'Anthropic'],
  [/gemini|google|gemma/i, 'Google'],
  [/nemotron|nvidia/i, 'NVIDIA'],
  [/devin|cognition|^swe[-/]/i, 'Cognition'],
];

/**
 * The model's author. A Codex id reads `codex/<provider>/<model>`, so the host and the provider
 * id are dropped first; a Z.ai run under Codex must not read as an OpenAI model.
 */
function modelVendor(model: string): string {
  const segs = model.split('/').filter(Boolean);
  const id = segs[0] === 'codex' && segs.length > 2 ? segs.slice(2).join('/') : model;
  for (const [re, name] of VENDOR_RES) {
    if (re.test(id)) return name;
  }
  return 'Other';
}

// Gateway variants of one model share a row under the display label.
export function foldModelsByLabel(
  byModel: Record<string, TokenBreakdown>,
  byModelMessages: Record<string, number>,
): { byModel: Record<string, TokenBreakdown>; byModelMessages: Record<string, number> } {
  const folded: Record<string, TokenBreakdown> = {};
  const messages: Record<string, number> = {};
  for (const [model, t] of Object.entries(byModel)) {
    const label = displayModelId(model);
    folded[label] ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const into = folded[label];
    into.input += t.input;
    into.output += t.output;
    into.cacheRead += t.cacheRead;
    into.cacheWrite += t.cacheWrite;
    messages[label] = (messages[label] ?? 0) + (byModelMessages[model] ?? 0);
  }
  return { byModel: folded, byModelMessages: messages };
}
// Vendor-first labels, same fold as the dashboard: "Anthropic - Claude - Haiku-4.5".
export function displayModelId(model: string): string {
  const bare = model.replace(FREE_SUFFIX, '');
  // The report already folds keys; folding again would lowercase the caps.
  if (bare.includes(' - ')) return bare;
  const cap = (s: string): string => {
    const low = s.toLowerCase();
    if (low === 'openai') return 'OpenAI';
    if (low === 'gpt') return 'GPT';
    if (low === 'swe') return 'SWE';
    if (low === 'glm') return 'GLM';
    if (low === 'ai') return 'AI';
    if (/^\d+[a-z]+$/.test(low)) return low.toUpperCase();
    if (s.length <= 2) return s.toUpperCase();
    return s[0].toUpperCase() + s.slice(1).toLowerCase();
  };
  const seg = (s: string): string => s.split('.').map(cap).join('.');
  const words = (s: string): string => s.split(/[-_:]+/).filter(Boolean).map(seg).join('-');
  const segs = bare.split('/').filter(Boolean);
  // A Codex id names the host and its provider first; the label reads the model's own id.
  const rest = segs[0] === 'codex' && segs.length > 2 ? segs.slice(2) : segs;
  const tail = rest[rest.length - 1] ?? bare;
  // One free model under two spellings; fold the alpha variant onto it.
  const pretty = /^space-bunny(-alpha)?$/i.test(tail) ? 'Space-Bunny' : words(tail);
  const vendor = modelVendor(bare);
  if (vendor === 'Other') return rest.length > 1 ? `${words(rest[rest.length - 2])} - ${pretty}` : pretty;
  const claude = pretty.match(/^claude[-_](.+)$/i);
  if (vendor === 'Anthropic' && claude) return `Anthropic - Claude - ${claude[1]}`;
  if (pretty.toLowerCase().startsWith(vendor.toLowerCase())) return pretty;
  return `${vendor} - ${pretty}`;
}

export function importSessionTokens(): SessionTokens {
  const accum = newSessionAccum();
  const files: string[] = [];
  for (const dir of sessionsDirs()) walkJsonl(dir, files, 2000);
  // OpenCode message bodies are single JSON documents, not JSONL.
  const ocFiles: string[] = [];
  if (process.env.TERSIO_SESSIONS_DIR === undefined || process.env.TERSIO_OPENCODE_DIR !== undefined) {
    walkJsonl(opencodeSessionsDir(), ocFiles, 5000, '.json');
  }
  for (const file of ocFiles) {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    processOpencodeFile(accum, text, file);
  }
  // v2 hosts write sqlite, not the JSON tree above.
  if (process.env.TERSIO_SESSIONS_DIR === undefined || process.env.TERSIO_OPENCODE_DB !== undefined) {
    for (const row of readOpencodeDbRows(opencodeDbPath(), 0)) ingestOpencodeDbRow(accum, row);
  }
  let codexProvider: string | null = null;
  let codexModel: string | null = null;
  for (const file of files) {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    processSessionText(accum, {
      get codexProvider() { return codexProvider; },
      set codexProvider(v: string | null) { codexProvider = v; },
      get codexModel() { return codexModel; },
      set codexModel(v: string | null) { codexModel = v; },
    }, text, hostOfSessionFile(file), agentOfSessionText(text));
  }
  accum.recent.sort((a, b) => b.t - a.t);
  return { messages: accum.messages, totals: accum.totals, byModel: accum.byModel, byDay: accum.byDay, byDayModel: accum.byDayModel, byTool: accum.byTool, byModelMessages: accum.byModelMessages, byHost: accum.byHost, byAgent: accum.byAgent, byAgentMessages: accum.byAgentMessages, byModelMeasured: accum.byModelMeasured, byModelCostMessages: accum.byModelCostMessages, costMeasured: accum.costMeasured, recent: accum.recent.slice(0, RECENT_LIMIT) };
}

// Which agent wrote a session file, from the directory it sits in.
export function hostOfSessionFile(file: string): string {
  const norm = file.replace(/\\/g, '/');
  if (norm.includes('/.omp/')) return 'omp';
  if (norm.includes('/.codex/')) return 'codex';
  if (norm.includes('/opencode/')) return 'opencode';
  return 'pi';
}

// A transcript with a parent session ran as a subagent; the host's own row, so a mirror answers the same.
export function agentOfSessionText(text: string): string {
  if (!text.includes('parentSession')) return 'main';
  for (const line of text.split('\n')) {
    if (!line.includes('parentSession')) continue;
    try {
      const row = JSON.parse(line) as { type?: unknown; parentSession?: unknown };
      if (row.type === 'session' && typeof row.parentSession === 'string' && row.parentSession !== '') return 'subagent';
    } catch { /* skip a corrupt line */ }
  }
  return 'main';
}

const adoptionFileCache = new Map<string, { size: number; mtimeMs: number; heads: string; counts: BashCounts }>();

interface BashCounts { bashCalls: number; eligibleCalls: number; rtkCalls: number }

function countBashCommands(commands: readonly string[], eligible: ReadonlySet<string>, counts: BashCounts): void {
  for (const command of commands) {
    counts.bashCalls += 1;
    const head = leadBinary(command);
    if (eligible.has(head)) counts.eligibleCalls += 1;
    if (head === 'rtk') counts.rtkCalls += 1;
  }
}

interface PiToolCall {
  type?: unknown;
  name?: unknown;
  id?: unknown;
  arguments?: unknown;
}

function parseAdoptionFile(file: string, eligible: ReadonlySet<string>): { counts: BashCounts; sessions: number } {
  const counts: BashCounts = { bashCalls: 0, eligibleCalls: 0, rtkCalls: 0 };
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { counts, sessions: 0 };
  }
  // omp emits a custom row per tool start; pi records the same call inside the assistant message.
  // A host that writes both shapes would double every call, so the custom ids gate the message pass.
  const commands: string[] = [];
  const customIds = new Set<string>();
  const messageCalls: Array<{ id: string | undefined; command: string }> = [];
  for (const line of text.split('\n')) {
    if (!line.includes('tool_execution_start') && !line.includes('"toolCall"')) continue;
    try {
      const row = JSON.parse(line) as {
        type?: unknown;
        customType?: unknown;
        data?: { toolCallId?: unknown; toolName?: unknown; args?: { command?: unknown } };
        message?: { content?: unknown };
      };
      if (row.type === 'custom' && row.customType === 'tool_execution_start' && row.data?.toolName === 'bash') {
        const command = row.data.args?.command;
        if (typeof command !== 'string') continue;
        if (typeof row.data.toolCallId === 'string') customIds.add(row.data.toolCallId);
        commands.push(command);
        continue;
      }
      const content = row.message?.content;
      if (row.type !== 'message' || !Array.isArray(content)) continue;
      for (const part of content) {
        if (typeof part !== 'object' || part === null) continue;
        const call: PiToolCall = part;
        if (call.type !== 'toolCall' || call.name !== 'bash') continue;
        const args = call.arguments;
        if (typeof args !== 'object' || args === null || !('command' in args)) continue;
        const command = args.command;
        if (typeof command !== 'string') continue;
        messageCalls.push({ id: typeof call.id === 'string' ? call.id : undefined, command });
      }
    } catch { /* skip corrupt line */ }
  }
  for (const call of messageCalls) {
    if (call.id !== undefined && customIds.has(call.id)) continue;
    commands.push(call.command);
  }
  countBashCommands(commands, eligible, counts);
  return { counts, sessions: commands.length > 0 ? 1 : 0 };
}

export function clearRtkAdoptionCache(): void {
  adoptionFileCache.clear();
}

/** Rewrites the hook performed on hosts whose transcript records the pre-hook command, by host. */
function countRtkAuditRows(): Record<string, number> {
  const byHost: Record<string, number> = {};
  let text: string;
  try { text = fs.readFileSync(ledgerPath(), 'utf8'); } catch { return byHost; }
  for (const line of text.split('\n')) {
    if (!line.includes('rtk-audit')) continue;
    try {
      const row = JSON.parse(line) as { kind?: unknown; detail?: unknown };
      if (row.kind !== 'rtk-audit' || typeof row.detail !== 'string') continue;
      const host = row.detail.split(' ')[0];
      if (!host) continue;
      byHost[host] = (byHost[host] ?? 0) + 1;
    } catch { /* skip corrupt line */ }
  }
  return byHost;
}

export function readRtkAdoption(): RtkAdoption {
  // The eligible set comes from rtk's rewrite contract, cached per binary version.
  const eligible = eligibleHeads(resolveRtkBinary());
  // A cached count is only valid for the head set that produced it.
  const headsKey = [...eligible].sort().join(',');
  const files: string[] = [];
  for (const dir of sessionsDirs()) walkJsonl(dir, files, 2000);
  const live = new Set(files);
  for (const file of adoptionFileCache.keys()) {
    if (!live.has(file)) adoptionFileCache.delete(file);
  }
  let bashCalls = 0;
  let eligibleCalls = 0;
  let rtkCalls = 0;
  let sessions = 0;
  const byHost: Record<string, BashCounts> = {};
  const hostCounts = (host: string, counts: BashCounts): void => {
    const into = byHost[host] ?? { bashCalls: 0, eligibleCalls: 0, rtkCalls: 0 };
    into.bashCalls += counts.bashCalls;
    into.eligibleCalls += counts.eligibleCalls;
    into.rtkCalls += counts.rtkCalls;
    byHost[host] = into;
  };
  for (const file of files) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    let entry = adoptionFileCache.get(file);
    if (!entry || entry.size !== stat.size || entry.mtimeMs !== stat.mtimeMs || entry.heads !== headsKey) {
      const parsed = parseAdoptionFile(file, eligible);
      entry = { size: stat.size, mtimeMs: stat.mtimeMs, heads: headsKey, counts: parsed.counts };
      adoptionFileCache.set(file, entry);
      sessions += parsed.sessions;
    } else if (entry.counts.bashCalls > 0) {
      sessions += 1;
    }
    bashCalls += entry.counts.bashCalls;
    eligibleCalls += entry.counts.eligibleCalls;
    rtkCalls += entry.counts.rtkCalls;
    hostCounts(hostOfSessionFile(file), entry.counts);
  }
  // OpenCode keeps its own store: a v2 sqlite db, or one JSON file per message before v2.
  const opencode: BashCounts = { bashCalls: 0, eligibleCalls: 0, rtkCalls: 0 };
  const opencodeSessions = new Set<string>();
  if (process.env.TERSIO_SESSIONS_DIR === undefined || process.env.TERSIO_OPENCODE_DB !== undefined) {
    for (const row of readOpencodeBashRows(opencodeDbPath())) {
      countBashCommands([row.command], eligible, opencode);
      if (row.sessionId) opencodeSessions.add(row.sessionId);
    }
  }
  const ocFiles: string[] = [];
  if (process.env.TERSIO_SESSIONS_DIR === undefined || process.env.TERSIO_OPENCODE_DIR !== undefined) {
    walkJsonl(opencodeSessionsDir(), ocFiles, 5000, '.json');
    for (const file of ocFiles) {
      const parsed = opencodeFileBash(file);
      countBashCommands(parsed.commands, eligible, opencode);
      if (parsed.sessionId) opencodeSessions.add(parsed.sessionId);
    }
  }
  bashCalls += opencode.bashCalls;
  eligibleCalls += opencode.eligibleCalls;
  rtkCalls += opencode.rtkCalls;
  sessions += opencodeSessions.size;
  if (opencode.bashCalls > 0) hostCounts('opencode', opencode);
  // The hook audit carries rewrites on pi and opencode, whose transcripts record the pre-hook command.
  for (const [host, rows] of Object.entries(countRtkAuditRows())) {
    rtkCalls += rows;
    hostCounts(host, { bashCalls: 0, eligibleCalls: 0, rtkCalls: rows });
  }
  const missedCalls = Math.max(0, eligibleCalls - rtkCalls);
  const host = (counts: BashCounts): RtkHostAdoption => ({
    bashCalls: counts.bashCalls,
    eligibleCalls: counts.eligibleCalls,
    rtkCalls: counts.rtkCalls,
    missedCalls: Math.max(0, counts.eligibleCalls - counts.rtkCalls),
    adoptionPct: counts.eligibleCalls ? (counts.rtkCalls / counts.eligibleCalls) * 100 : 0,
  });
  return {
    sessions,
    bashCalls,
    eligibleCalls,
    rtkCalls,
    missedCalls,
    adoptionPct: eligibleCalls ? (rtkCalls / eligibleCalls) * 100 : 0,
    byHost: Object.fromEntries(Object.entries(byHost).map(([name, counts]) => [name, host(counts)])),
  };
}
export function processSessionText(accum: SessionAccum, state: { codexProvider: string | null; codexModel?: string | null }, text: string, host?: string, agent?: string): void {
  processSessionRows(accum, state, parseSessionLines(text), collectToolResults(text), host, agent);
}

/** One pass over parsed lines: Codex calls, shell facts, and turn timing fold into the token rows. */
export function processSessionRows(
  accum: SessionAccum,
  state: { codexProvider: string | null; codexModel?: string | null },
  lines: SessionTextLines,
  results: ToolResults,
  host?: string,
  agent?: string,
): void {
  const { parsed } = lines;
  interface CodexCall { name: string; args: number }
  const codexCalls = new Map<string, CodexCall>();
  const callOrder: string[] = [];
  interface ShellFact { turn: string | undefined; fact: ToolFact; durMs: number | undefined }
  const shellFacts = new Map<string, ShellFact>();
  const shellOrder: string[] = [];
  const turnTimes = new Map<string, { durMs?: number; ttftMs?: number }>();
  // The last `task_complete` timing wins: a token row without a turn id takes it in row order.
  let lastTurnTiming: { durMs?: number; ttftMs?: number } | undefined;
  for (const { row } of parsed) {
    const parsed2 = classifySessionLine(row, results);
    if (parsed2.kind === 'assistant_row' && parsed2.model === 'codex-tool-call' && parsed2.callId && parsed2.callName) {
      codexCalls.set(parsed2.callId, { name: parsed2.callName, args: parsed2.callChars ?? 0 });
      callOrder.push(parsed2.callId);
    } else if (parsed2.kind === 'assistant_row' && parsed2.model === 'codex-shell-fact') {
      const turn = parsed2.turnId ?? '';
      if (!shellFacts.has(turn)) shellOrder.push(turn);
      shellFacts.set(turn, { turn: parsed2.turnId, fact: parsed2.toolFacts![0], durMs: parsed2.durMs });
    } else if (parsed2.kind === 'token_row' && parsed2.turnId && !parsed2.usage) {
      turnTimes.set(parsed2.turnId, { durMs: parsed2.durMs, ttftMs: parsed2.ttftMs });
      lastTurnTiming = { durMs: parsed2.durMs, ttftMs: parsed2.ttftMs };
    }
  }
  for (const { row } of parsed) {
    const parsed2 = classifySessionLine(row, results);
    const rid = messageRowId(row);
    if (parsed2.kind === 'codex_provider') {
      if (parsed2.provider) state.codexProvider = parsed2.provider;
      continue;
    }
    if (parsed2.kind === 'codex_model') {
      if (parsed2.model) state.codexModel = parsed2.model;
      continue;
    }
    if (parsed2.kind === 'token_row') {
      if (parsed2.turnId && !parsed2.usage) continue;
      const base = parsed2.provider ? `codex/${parsed2.provider}` : (state.codexProvider ? `codex/${state.codexProvider}` : 'codex');
      const model = state.codexModel ? `${base}/${state.codexModel}` : base;
      const turn = parsed2.turnId ? turnTimes.get(parsed2.turnId) : lastTurnTiming;
      ingestSessionRow(accum, model, parsed2.usage ?? {}, row.timestamp, parsed2.durMs ?? turn?.durMs, { st: 'completed' as RunStatus }, undefined, host ?? 'codex', rid, agent, parsed2.ttftMs ?? turn?.ttftMs);
      continue;
    }
    if (parsed2.kind !== 'assistant_row' || !parsed2.model || !parsed2.usage) continue;
    ingestSessionRow(accum, parsed2.model, parsed2.usage, row.timestamp, parsed2.durMs, parsed2.run, parsed2.tools, host, rid, agent, parsed2.ttftMs, parsed2.toolFacts);
  }
  // Codex facts ride outside the token rows: one entry per shell fact, then one per tool call.
  for (const turn of shellOrder) {
    const shell = shellFacts.get(turn)!;
    if (accum.toolFacts.some((f) => f.n === shell.fact.n && f.a === shell.fact.a)) continue;
    accum.toolFacts.push(shell.fact);
  }
  for (const callId of callOrder) {
    const call = codexCalls.get(callId);
    if (!call) continue;
    const res = results.get(callId);
    const fact: ToolFact = { n: call.name === 'exec' ? 'bash' : call.name, a: call.args, r: res?.chars ?? 0, e: res?.error ? 1 : 0 };
    if (accum.toolFacts.some((f) => f.n === fact.n && f.a === fact.a && f.r === fact.r && f.e === fact.e)) continue;
    accum.toolFacts.push(fact);
  }
}

export function readRtkRecallDiagnostics(binary: string | null = resolveRtkBinary()): RtkRecallDiagnostics {
  if (!binary) return { mode: 'unknown', entries: 0, available: false };
  try {
    const configPath = process.env.RTK_CONFIG || path.join(rtkDirs().config, 'config.toml');
    let config = '';
    try { config = fs.readFileSync(configPath, 'utf8'); } catch { /* use RTK CLI fallback */ }
    const modeMatch = /^\s*mode\s*=\s*"(sqlite|tee|disabled)"/m.exec(config);
    const mode = (modeMatch?.[1] ?? 'unknown') as RtkRecallDiagnostics['mode'];
    const shim = shimCommand(binary, ['recall', '--list']);
    const output = execFileSync(shim.cmd, shim.args, { encoding: 'utf8', timeout: 5000, windowsHide: true });
    const entries = /\((\d+)\s+(?:entries?|stored)\)/i.exec(output)?.[1] ?? /^\s*(\d+)\s+entries?/im.exec(output)?.[1] ?? '0';
    return { mode, entries: Number(entries) || 0, available: true };
  } catch {
    return { mode: 'unknown', entries: 0, available: false };
  }
}
// Lead binary of a shell string: first segment past `cd` chains and VAR=x assignments. Falls back to `bash`.
const SKIP_HEADS = ['cd', 'echo', 'export', 'true', 'false'];
export function leadBinary(command: unknown): string {
  if (typeof command !== 'string' || !command.trim()) return 'bash';
  for (const seg of command.split(/&&|;|\n|\|(?!\|)/)) {
    const toks = seg.trim().split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < toks.length && (toks[i] === 'sudo' || /^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[i]))) i++;
    const head = (toks[i] ?? '').replace(/^['"]|['"]$/g, '').split('/').pop() ?? '';
    if (head && !SKIP_HEADS.includes(head)) return head;
  }
  return 'bash';
}

// Pricing lives in ./pricing.ts (live LiteLLM cache + fallback table).
import { DEFAULT_PRICE, PRICE_TIERS_FIRM, canonicalPriceId, priceFor, pricesOverridePath, refreshPricesIfStale, type PriceHit, type PriceTier } from './pricing.ts';
import { co2GramsFor, energyWhFor } from './carbon.ts';
import type { ModelPrice } from './pricing.ts';

export { DEFAULT_PRICE, PRICE_TIERS_FIRM, priceFor, pricesOverridePath, refreshPricesIfStale };
export { co2GramsFor, energyWhFor };
export type { PriceHit, PriceTier, ModelPrice };

/** Price one model's tokens; `measured` outranks every rate card, so pass undefined when unreported. */
export function usdCost(t: TokenBreakdown, model?: string, measured?: number): { usd: number; priced: boolean; tier: PriceTier; buckets: { input: number; output: number; cacheRead: number; cacheWrite: number } } {
  const m = 1 / 1_000_000;
  if (measured !== undefined) {
    // Only a bare total arrives, so it attributes to input, the largest bucket for every model here.
    return {
      usd: measured,
      priced: true,
      tier: 'measured',
      buckets: { input: measured, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
  }
  const hit: PriceHit = model ? priceFor(model) : { price: DEFAULT_PRICE, known: false, live: false, tier: 'default' };
  const price = hit.price;
  const buckets = {
    input: t.input * price.input * m,
    output: t.output * price.output * m,
    cacheRead: t.cacheRead * price.cacheRead * m,
    cacheWrite: t.cacheWrite * price.cacheWrite * m,
  };
  return {
    usd: buckets.input + buckets.output + buckets.cacheRead + buckets.cacheWrite,
    // `tail`/`default` are estimates; summing them beside measured cost reads as a bill it is not.
    priced: PRICE_TIERS_FIRM.includes(hit.tier),
    tier: hit.tier,
    buckets,
  };
}

export function co2Grams(outputTokens: number, model?: string): number {
  return co2GramsFor(model ?? 'gpt-4o', outputTokens);
}

export function readUsage(): UsageRow[] {
  let text: string;
  try {
    text = fs.readFileSync(ledgerPath(), 'utf8');
  } catch {
    return [];
  }
  const rows: UsageRow[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as Partial<UsageRow>;
      if (typeof row.ts === 'number' && typeof row.kind === 'string' && typeof row.detail === 'string') {
        rows.push({ ts: row.ts, kind: row.kind as UsageKind, detail: row.detail });
      }
    } catch { /* skip corrupt lines */ }
  }
  return rows;
}

// Delete the ledger file and return the rows cleared. Tersio-owned data only: transcripts and the RTK database stay.
export function clearUsageLedger(): number {
  const rows = readUsage().length;
  try {
    fs.unlinkSync(ledgerPath());
  } catch { /* already absent */ }
  return rows;
}
