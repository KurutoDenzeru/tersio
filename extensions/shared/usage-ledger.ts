// Shared usage ledger: append-only JSON lines, read by the CLI, `/tersio`, and the Dashboard. Best-effort; corrupt lines are skipped on read.
import fs from 'node:fs';
import path from 'node:path';
import { homeDir, isPiProcess, piAgentDir, resolveRtkBinary, tersioDataPath } from '../lib/utils.ts';
import { execFileSync } from 'node:child_process';

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

// Reset watermark: views filter rows older than it, so nothing else is deleted.
export function resetMarkerPath(): string {
  const override = process.env.TERSIO_RESET_FILE;
  if (override) return override;
  return tersioDataPath('reset.json', 'tersio-reset.json');
}

export function readResetWatermark(): number {
  try {
    const raw = JSON.parse(fs.readFileSync(resetMarkerPath(), 'utf8')) as { ts?: unknown };
    return typeof raw.ts === 'number' && Number.isFinite(raw.ts) && raw.ts > 0 ? raw.ts : 0;
  } catch {
    return 0;
  }
}

export function markReset(now = Date.now()): number {
  try {
    fs.mkdirSync(path.dirname(resetMarkerPath()), { recursive: true });
    fs.writeFileSync(resetMarkerPath(), JSON.stringify({ ts: now }) + '\n', 'utf8');
  } catch { /* best-effort; never break the caller */ }
  return now;
}

export function appendUsage(kind: UsageKind, detail: string): void {
  const row = JSON.stringify({ ts: Date.now(), kind, detail }) + '\n';
  try {
    fs.mkdirSync(path.dirname(ledgerPath()), { recursive: true });
    fs.appendFileSync(ledgerPath(), row, 'utf8');
  } catch { /* ledger is best-effort; never break the caller */ }
}

// --- Session tokens, tokscale-style ------------------------------------------ Assistant messages in the host transcripts carry usage, model, and a timestamp.
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
  /** Time to first token when the host recorded one; omp records it, pi and opencode do not — absent stays absent. */
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
  /** Message id when the host provides one (transcript row id, opencode msg file). */
  id?: string;
  /**
   * Tools invoked during this turn, in the order the host recorded them. This is the closest thing to
   * a per-request trace the transcripts support: what the turn did, without span timings.
   */
  tools?: string[];
}

/** The per-message aggregates, as persisted to usage.db and replayed back. It is an alias so a store round-trip cannot silently drop a field that ingestSessionRow fills. */
export type SessionTokens = SessionAccum;

export interface RtkAdoption {
  sessions: number;
  bashCalls: number;
  eligibleCalls: number;
  rtkCalls: number;
  missedCalls: number;
  adoptionPct: number;
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

// One rule for where a model id keeps its provider; see ./model-id.ts. Imported for local use and
// re-exported for callers that already reach through this module.
import { providerOf, AGENT_NAMESPACES } from './model-id.ts';

export { providerOf };

// Measured cost: usage.cost.total, or a bare number in old fixtures. Anything else means unrecorded, which is deliberately not 0.
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
  // Both hosts, not just the running one: a session on pi is missing from the dashboard entirely if we stop at the first directory that exists.
  const dirs = isPiProcess()
    ? [path.join(piAgentDir(), 'sessions'), path.join(homeDir(), '.omp', 'agent', 'sessions')]
    : [path.join(homeDir(), '.omp', 'agent', 'sessions'), path.join(piAgentDir(), 'sessions')];
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
}

// Two on-disk shapes: legacy `message` (role/modelID/providerID live inside `data`),
// current `session_message` (role in the `type` column, model under data.model).
// Scalars only: the `data` blob holds newlines and tabs, which the sqlite3 CLI would split.
const OC_DB_ORDER = ' ORDER BY time_created;';
const OC_DB_COLUMNS =
  'json_extract(data,\'$.time.created\'), json_extract(data,\'$.time.completed\'),' +
  ' json_extract(data,\'$.tokens.input\'), json_extract(data,\'$.tokens.output\'),' +
  ' json_extract(data,\'$.tokens.cache.read\'), json_extract(data,\'$.tokens.cache.write\'), json_extract(data,\'$.cost\')';
const ocDbLegacy = (since: number): string =>
  `SELECT id, time_created, json_extract(data,'$.role'), json_extract(data,'$.providerID'), json_extract(data,'$.modelID'), ${OC_DB_COLUMNS}` +
  ` FROM message WHERE json_extract(data,'$.role')='assistant' AND time_created > ${since}${OC_DB_ORDER}`;
const ocDbCurrent = (since: number): string =>
  `SELECT id, time_created, 'assistant', json_extract(data,'$.model.providerID'), json_extract(data,'$.model.id'), ${OC_DB_COLUMNS}` +
  ` FROM session_message WHERE type='assistant' AND time_created > ${since}${OC_DB_ORDER}`;

// A re-scan window covers tokens that land after the row was created, so a late fill is not lost.
export const OPENCODE_DB_OVERLAP_MS = 3_600_000;

// execFileSync caps output at 1MB; a busy table clears it in one SELECT.
export const SQLITE_READ_BUFFER = 50 * 1024 * 1024;

// Empty when sqlite3 is absent or the db is unreadable; that is a sync skip, not a failure.
export function readOpencodeDbRows(db: string, sinceMs: number): OpencodeDbRow[] {
  if (!Number.isFinite(sinceMs)) return [];
  try {
    if (!fs.existsSync(db)) return [];
    const since = Math.max(0, Math.floor(sinceMs));
    // Separate calls: a db holding only one table must not cancel the other.
const run = (sql: string): string =>
  execFileSync('sqlite3', ['-separator', '\t', '-readonly', db, sql], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: SQLITE_READ_BUFFER });
let out = '';
try { out += run(ocDbLegacy(since)); } catch { /* no legacy table or unreadable */ }
try { out += run(ocDbCurrent(since)); } catch { /* no session_message table or unreadable */ }
    const rows: OpencodeDbRow[] = [];
    for (const line of out.split('\n')) {
      if (!line.trim()) continue;
      const [id, created, role, providerID, modelID, tCreated, tCompleted, input, output, cacheRead, cacheWrite, cost] = line.split('\t');
      const n = (v: string | undefined): number | undefined => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
      rows.push({
        id,
        created: Number(created),
        row: {
          role,
          modelID,
          providerID,
          tokens: { input: n(input), output: n(output), cache: { read: n(cacheRead), write: n(cacheWrite) } },
          time: { created: n(tCreated), completed: n(tCompleted) },
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
const RTK_ELIGIBLE_HEADS = new Set([
  'rtk', 'git', 'grep', 'rg', 'find', 'cat', 'ls', 'tree', 'diff', 'log',
  'npm', 'npx', 'pnpm', 'bun', 'bunx', 'cargo', 'go', 'python', 'pytest',
  'ruff', 'mypy', 'docker', 'kubectl', 'psql', 'aws', 'gh', 'glab', 'wc',
]);
/** A running mean, kept as a sum so no per-row array is retained. */
export interface LatencyStat {
  ms: number;
  n: number;
}

/** Everything ingestSessionRow aggregates. SessionAccum adds the recent-rows list on top, so the accumulator, the sqlite mirror, and the report cannot drift apart. */
export interface RunAggregates {
  byModel: Record<string, TokenBreakdown>;
  byDay: Record<string, TokenBreakdown>;
  byDayModel: Record<string, Record<string, number>>;
  byTool: Record<string, number>;
  byModelMessages: Record<string, number>;
  byHost: Record<string, Record<string, TokenBreakdown>>;
  totals: TokenBreakdown;
  messages: number;
  costMeasured: number;
  /** Who served the call, from model_change provider or the leading model-id segment. */
  byProvider: Record<string, TokenBreakdown>;
  /** Session working directory; a "project" in the transcripts is a cwd. */
  byProject: Record<string, TokenBreakdown>;
  /** Per-day, per-model tokens: the only exact input to a cost-over-time series. */
  byDayModelTokens: Record<string, Record<string, TokenBreakdown>>;
  /** Per-day requests per model, so a share chart can be request-based rather than token-based. */
  byDayModelRuns: Record<string, Record<string, number>>;
  /** Per-day provider and project tokens, so a range filter can recompute those tables. */
  byDayProvider: Record<string, Record<string, TokenBreakdown>>;
  byDayProject: Record<string, Record<string, TokenBreakdown>>;
  /** Per-day run outcomes, so the error rate follows the selected range. */
  byDayErrors: Record<string, Record<string, number>>;
  /** Per-day failures per model, so a model table can show its own failure count. */
  byDayModelErrors: Record<string, Record<string, number>>;
  /** Per-day tool call counts. */
  byDayTool: Record<string, Record<string, number>>;
  /** Vendor-reported cost per day. Empty when the host reported no cost. */
  byDayCost: Record<string, number>;
  /** Mean elapsed wall clock per model. Absent when no row carried a duration. */
  latency: Record<string, LatencyStat>;
  /** Mean time to first token per model. OMP reports it; pi does not. */
  ttft: Record<string, LatencyStat>;
  /** Runs that did not end completed, by status. */
  errors: Record<string, number>;
  /** Reasoning tokens, billed as output by most providers. */
  reasoning: number;
}

// Parse buffer shared by live reads and usage.db syncs, so the store is a cache and never a fork.
export type SessionAccum = RunAggregates & { recent: RecentRequest[] };

export function newSessionAccum(): SessionAccum {
  return {
    byModel: {}, byDay: {}, byDayModel: {}, byTool: {}, byModelMessages: {}, byHost: {},
    totals: zeroBreakdown(), messages: 0, costMeasured: 0,
    byProvider: {}, byProject: {}, byDayModelTokens: {}, byDayModelRuns: {}, byDayProvider: {}, byDayProject: {},
    byDayErrors: {}, byDayModelErrors: {}, byDayTool: {}, byDayCost: {},
    latency: {}, ttft: {}, errors: {}, reasoning: 0,
    recent: [],
  };
}
/** Mutable per-file parse state: header and model_change rows apply to every row after them. */
export interface SessionState {
  codexProvider: string | null;
  codexModel?: string | null;
  cwd?: string | null;
  provider?: string | null;
}

/** What the running session contributes to each row it produces. */
export interface RunContext {
  provider?: string;
  project?: string;
  ttft?: number;
}

export function ingestSessionRow(accum: SessionAccum, model: string, usage: Record<string, unknown>, ts: string | number | undefined, durMs?: unknown, run?: { st: RunStatus; code?: number; note?: string }, toolNames?: string[], host?: string, id?: string, ctx?: RunContext): boolean {
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
  // Prefer the declared provider; fall back to the model-id prefix for hosts that only prefix it.
  const provider = ctx?.provider ?? providerOf(model);
  if (provider) {
    accum.byProvider[provider] ??= zeroBreakdown();
    addInto(accum.byProvider[provider], usage);
  }
  if (ctx?.project) {
    accum.byProject[ctx.project] ??= zeroBreakdown();
    addInto(accum.byProject[ctx.project], usage);
  }
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  const reasoning = num(usage.reasoning);
  if (reasoning > 0) accum.reasoning += reasoning;
  const outcome = run ?? { st: 'completed' as RunStatus };
  if (outcome.st !== 'completed') accum.errors[outcome.st] = (accum.errors[outcome.st] ?? 0) + 1;
  const dur = durOf(durMs);
  if (dur !== undefined) {
    const stat = (accum.latency[key] ??= { ms: 0, n: 0 });
    stat.ms += dur;
    stat.n += 1;
  }
  // OMP reports ttft; pi and opencode do not, so a missing value stays missing instead of reading as 0.
  const ttft = durOf(ctx?.ttft);
  if (ttft !== undefined) {
    const stat = (accum.ttft[key] ??= { ms: 0, n: 0 });
    stat.ms += ttft;
    stat.n += 1;
  }
  if (Number.isFinite(ms)) {
    accum.recent.push({ m: key, i: num(usage.input), o: num(usage.output), t: ms, d: dur, tf: ttft, h: host, cr: num(usage.cacheRead), cw: num(usage.cacheWrite), usd: costOf(usage), st: outcome.st, code: outcome.code, note: outcome.note, id, tools: toolNames?.length ? toolNames : undefined });
  }
  const day = ts !== undefined ? dayKey(ts) : null;
  if (day) {
    accum.byDay[day] ??= zeroBreakdown();
    addInto(accum.byDay[day], usage);
    accum.byDayModelTokens[day] ??= {};
    accum.byDayModelTokens[day][key] ??= zeroBreakdown();
    addInto(accum.byDayModelTokens[day][key], usage);
    const runs = (accum.byDayModelRuns[day] ??= {});
    runs[key] = (runs[key] ?? 0) + 1;
    // The same row also feeds every per-day table, so the range filter never needs a second pass.
    if (provider) {
      const byDay = (accum.byDayProvider[day] ??= {});
      byDay[provider] ??= zeroBreakdown();
      addInto(byDay[provider], usage);
    }
    if (ctx?.project) {
      const byDay = (accum.byDayProject[day] ??= {});
      byDay[ctx.project] ??= zeroBreakdown();
      addInto(byDay[ctx.project], usage);
    }
    if (outcome.st !== 'completed') {
      const counts = (accum.byDayErrors[day] ??= {});
      counts[outcome.st] = (counts[outcome.st] ?? 0) + 1;
      // The same failure, attributed to the model that ran, so the table needs no second pass.
      const failed = (accum.byDayModelErrors[day] ??= {});
      failed[key] = (failed[key] ?? 0) + 1;
    }
    for (const name of toolNames ?? []) {
      const counts = (accum.byDayTool[day] ??= {});
      counts[name] = (counts[name] ?? 0) + 1;
    }
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
    if (day) accum.byDayCost[day] = (accum.byDayCost[day] ?? 0) + measured;
  }
  for (const name of toolNames ?? []) accum.byTool[name] = (accum.byTool[name] ?? 0) + 1;
  return true;
}
export type SessionLineKind = 'codex_provider' | 'codex_model' | 'session_header' | 'model_change' | 'token_row' | 'assistant_row' | 'skip';
export function classifySessionLine(row: { timestamp?: string | number; type?: unknown; cwd?: unknown; provider?: unknown; modelId?: unknown; message?: { role?: unknown; model?: unknown; usage?: Record<string, unknown>; duration?: unknown; ttft?: unknown; completedAt?: unknown; timestamp?: unknown; stopReason?: unknown; errorStatus?: unknown; errorMessage?: unknown; isError?: unknown; content?: Array<{ type?: unknown; name?: unknown; arguments?: unknown }> }; model?: unknown; payload?: { type?: unknown; model?: unknown; model_provider?: unknown; info?: { last_token_usage?: Record<string, unknown> } } }): { kind: SessionLineKind; cwd?: string; provider?: string; model?: string; usage?: Record<string, unknown>; durMs?: number; ttft?: number; run?: { st: RunStatus; code?: number; note?: string }; tools?: string[]; ms?: number } {
  // The session header names the working directory, which is the only project identity the transcripts carry.
  if (row.type === 'session' && typeof row.cwd === 'string' && row.cwd) return { kind: 'session_header', cwd: row.cwd };
  if (row.type === 'model_change') {
    const provider = typeof row.provider === 'string' && row.provider ? row.provider : undefined;
    const named = typeof row.model === 'string' && row.model ? row.model : undefined;
    const model = named ?? (typeof row.modelId === 'string' && row.modelId ? row.modelId : undefined);
    if (provider || model) return { kind: 'model_change', provider, model };
  }
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
  }
  const msg = row.message;
  if (!msg || msg.role !== 'assistant' || !msg.usage) return { kind: 'skip' };
  const model = typeof msg.model === 'string' && msg.model ? msg.model : 'unknown';
  // pi omits duration, so derive Elapsed/Speed from the timestamp pair.
  const startMs = typeof msg.timestamp === 'number' ? msg.timestamp : undefined;
  const endMs = typeof msg.completedAt === 'number' ? msg.completedAt : stampMs(row.timestamp);
  const computedDur = startMs !== undefined && Number.isFinite(endMs) && endMs > startMs ? endMs - startMs : undefined;
  const tools: string[] = [];
  for (const part of msg.content ?? []) {
    if (part?.type !== 'toolCall' || typeof part.name !== 'string' || !part.name) continue;
    if (part.name !== 'bash') {
      tools.push(part.name);
      continue;
    }
    const command = (part.arguments as { command?: unknown } | null)?.command;
    tools.push(`bash:${leadBinary(command)}`);
  }
  return { kind: 'assistant_row', model, usage: msg.usage, durMs: typeof msg.duration === 'number' ? msg.duration : computedDur, ttft: durOf(msg.ttft), run: statusOf(msg), tools };
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
  time?: { created?: unknown; completed?: unknown } | null;
  cost?: unknown;
  finish?: unknown;
}

// One OpenCode message file; assistant rows carry the token buckets.
export function classifyOpencodeMessage(obj: OpencodeMessage | null | undefined): { model: string; usage: Record<string, unknown>; ms: number | undefined; durMs: number | undefined } | null {
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
  return {
    model: `opencode/${provider}/${model}`,
    usage,
    ms: created,
    durMs: created !== undefined && completed !== undefined && completed > created ? completed - created : undefined,
  };
}

// One OpenCode message file into the shared accum. The msg id is the file name.
export function processOpencodeFile(accum: SessionAccum, text: string, file?: string): void {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return;
  }
  const parsed = classifyOpencodeMessage(obj as OpencodeMessage);
  if (!parsed) return;
  const id = file ? path.basename(file).replace(/\.[^.]+$/, '') || undefined : undefined;
  ingestSessionRow(accum, parsed.model, parsed.usage, parsed.ms, parsed.durMs, { st: 'completed' as RunStatus }, undefined, 'opencode', id);
}

// One v2 message row into the shared accum. The msg id is the row primary key.
export function ingestOpencodeDbRow(accum: SessionAccum, row: OpencodeDbRow): void {
  const parsed = classifyOpencodeMessage(row.row);
  if (!parsed) return;
  ingestSessionRow(accum, parsed.model, parsed.usage, parsed.ms, parsed.durMs, { st: 'completed' as RunStatus }, undefined, 'opencode', row.id);
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

// Vendor names mirror the dashboard map; CLI needs names only. Family first:
// gateway segments shadow it (minimaxai holds xai, gemma rides nvidia).
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

function modelVendor(model: string): string {
  for (const [re, name] of VENDOR_RES) {
    if (re.test(model)) return name;
  }
  return 'Other';
}

// A label must not hide which gateway served the call. Two ids that reach the same model
// through different gateways ("cline/cline-free/x" and "opencode-zen/x") collapse into one row
// under the label alone, so the serving segment stays in the fold key and the row stays honest.
function servingSegmentOf(model: string): string | undefined {
  const segs = model.split('/').filter(Boolean);
  return segs.length > 1 ? segs[segs.length - 2] : undefined;
}

// Gateway variants of one model share a row under the display label. Two gateways serving the
// same model do not: the fold key is the label plus the serving gateway, so a model reachable
// through more than one gateway keeps a row per gateway and no cost lands on the wrong one.
export function foldModelsByLabel(
  byModel: Record<string, TokenBreakdown>,
  byModelMessages: Record<string, number>,
): { byModel: Record<string, TokenBreakdown>; byModelMessages: Record<string, number> } {
  const folded: Record<string, TokenBreakdown> = {};
  const messages: Record<string, number> = {};
  for (const [model, t] of Object.entries(byModel)) {
    const label = displayModelId(model);
    // The serving segment always names who answered, so it always stays in the key:
    // "opencode/openai/x" and "opencode/github-copilot/x" are two different billers for x even
    // when one of them also looks like x's vendor.
    const segment = servingSegmentOf(model);
    const key = segment === undefined ? label : `${label} · ${segment}`;
    folded[key] ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const into = folded[key];
    into.input += t.input;
    into.output += t.output;
    into.cacheRead += t.cacheRead;
    into.cacheWrite += t.cacheWrite;
    messages[key] = (messages[key] ?? 0) + (byModelMessages[model] ?? 0);
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
    if (low === 'ai') return 'AI';
    if (/^\d+[a-z]+$/.test(low)) return low.toUpperCase();
    if (s.length <= 2) return s.toUpperCase();
    return s[0].toUpperCase() + s.slice(1).toLowerCase();
  };
  const seg = (s: string): string => s.split('.').map(cap).join('.');
  const words = (s: string): string => s.split(/[-_:]+/).filter(Boolean).map(seg).join('-');
  // Vendor and gateway segments sit outside the model name, so neither may name the model.
  // "opencode/github-copilot/grok-code-fast-1" is xAI's model on copilot's gateway, and
  // "opencode/cline/mimo-v2.6-flash" is Xiaomi's: test only the tail for the family.
  const raw = bare.split('/').filter(Boolean);
  const tail = raw[raw.length - 1] ?? bare;
  // One free model under two spellings; fold the alpha variant onto it.
  const pretty = /^space-bunny(-alpha)?$/i.test(tail) ? 'Space-Bunny' : words(tail);
  const family = modelVendor(tail);
  // The segment before the tail. With an agent namespace it is the provider ("opencode/cline/..."
  // -> cline); without one it is the serving gateway ("opencode-zen/step-5-preview" -> the vendor).
  const wrap = raw.length > 1 ? raw[raw.length - 2] : undefined;
  if (family === 'Other') {
    // No family in the name. The segment before the tail is a gateway, not a vendor, so the
    // gateway name would become the label: "Opencode-Zen - Step-5-Preview". Name the model.
    return wrap ? `${words(wrap)} - ${pretty}` : pretty;
  }
  const claude = pretty.match(/^claude[-_](.+)$/i);
  if (family === 'Anthropic' && claude) return `Anthropic - Claude - ${claude[1]}`;
  if (pretty.toLowerCase().startsWith(family.toLowerCase())) return pretty;
  return `${family} - ${pretty}`;
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
  // Per file, not per import: a header or model_change belongs only to the transcript holding it.
  let sessionCwd: string | null = null;
  let sessionProvider: string | null = null;
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
      get cwd() { return sessionCwd; },
      set cwd(v: string | null) { sessionCwd = v; },
      get provider() { return sessionProvider; },
      set provider(v: string | null) { sessionProvider = v; },
    }, text, hostOfSessionFile(file));
  }
  accum.recent.sort((a, b) => b.t - a.t);
  // Spread, not a field list: a new aggregate must never be dropped by this return.
  return { ...accum, recent: accum.recent.slice(0, RECENT_LIMIT) };
}

// Which agent wrote a session file, from the directory it sits in.
export function hostOfSessionFile(file: string): string {
  const norm = file.replace(/\\/g, '/');
  if (norm.includes('/.omp/')) return 'omp';
  if (norm.includes('/.codex/')) return 'codex';
  if (norm.includes('/opencode/')) return 'opencode';
  return 'pi';
}

const adoptionFileCache = new Map<string, { size: number; mtimeMs: number; counts: { bashCalls: number; eligibleCalls: number; rtkCalls: number } }>();

function parseAdoptionFile(file: string): { counts: { bashCalls: number; eligibleCalls: number; rtkCalls: number }; sessions: number } {
  const counts = { bashCalls: 0, eligibleCalls: 0, rtkCalls: 0 };
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { counts, sessions: 0 };
  }
  let sawBash = false;
  for (const line of text.split('\n')) {
    if (!line.includes('tool_execution_start')) continue;
    try {
      const row = JSON.parse(line) as {
        type?: string;
        customType?: string;
        data?: { toolName?: unknown; args?: { command?: unknown } };
      };
      if (row.type !== 'custom' || row.customType !== 'tool_execution_start' || row.data?.toolName !== 'bash') continue;
      const command = row.data.args?.command;
      if (typeof command !== 'string') continue;
      sawBash = true;
      counts.bashCalls += 1;
      const head = leadBinary(command);
      if (RTK_ELIGIBLE_HEADS.has(head)) counts.eligibleCalls += 1;
      if (head === 'rtk') counts.rtkCalls += 1;
    } catch { /* skip corrupt line */ }
  }
  return { counts, sessions: sawBash ? 1 : 0 };
}

export function clearRtkAdoptionCache(): void {
  adoptionFileCache.clear();
}

export function readRtkAdoption(): RtkAdoption {
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
  for (const file of files) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    let entry = adoptionFileCache.get(file);
    if (!entry || entry.size !== stat.size || entry.mtimeMs !== stat.mtimeMs) {
      const parsed = parseAdoptionFile(file);
      entry = { size: stat.size, mtimeMs: stat.mtimeMs, counts: parsed.counts };
      adoptionFileCache.set(file, entry);
      sessions += parsed.sessions;
    } else if (entry.counts.bashCalls > 0) {
      sessions += 1;
    }
    bashCalls += entry.counts.bashCalls;
    eligibleCalls += entry.counts.eligibleCalls;
    rtkCalls += entry.counts.rtkCalls;
  }
  const missedCalls = Math.max(0, eligibleCalls - rtkCalls);
  return { sessions, bashCalls, eligibleCalls, rtkCalls, missedCalls, adoptionPct: eligibleCalls ? (rtkCalls / eligibleCalls) * 100 : 0 };
}
export function processSessionText(accum: SessionAccum, state: SessionState, text: string, host?: string): void {
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as Parameters<typeof classifySessionLine>[0];
      const parsed = classifySessionLine(row);
      const rid = messageRowId(row);
      if (parsed.kind === 'codex_provider') {
        if (parsed.provider) state.codexProvider = parsed.provider;
        continue;
      }
      if (parsed.kind === 'codex_model') {
        if (parsed.model) state.codexModel = parsed.model;
        continue;
      }
      if (parsed.kind === 'session_header') {
        state.cwd = parsed.cwd ?? null;
        continue;
      }
      if (parsed.kind === 'model_change') {
        if (parsed.provider) state.provider = parsed.provider;
        continue;
      }
      // Header state applies to every row that follows it in this transcript.
      const ctx: RunContext = { provider: parsed.provider ?? state.provider ?? undefined, project: state.cwd ?? undefined, ttft: parsed.ttft };
      if (parsed.kind === 'token_row') {
        const base = parsed.provider ? `codex/${parsed.provider}` : (state.codexProvider ? `codex/${state.codexProvider}` : 'codex');
        // The provider alone told you nothing about which model ran.
        const model = state.codexModel ? `${base}/${state.codexModel}` : base;
        ingestSessionRow(accum, model, parsed.usage ?? {}, row.timestamp, parsed.durMs, { st: 'completed' as RunStatus }, undefined, host ?? 'codex', rid, ctx);
        continue;
      }
      if (parsed.kind !== 'assistant_row' || !parsed.model || !parsed.usage) continue;
      ingestSessionRow(accum, parsed.model, parsed.usage, row.timestamp, parsed.durMs, parsed.run, parsed.tools, host, rid, ctx);
    } catch { /* skip corrupt lines */ }
  }
}

export function readRtkRecallDiagnostics(binary: string | null = resolveRtkBinary()): RtkRecallDiagnostics {
  if (!binary) return { mode: 'unknown', entries: 0, available: false };
  try {
    const configPath = process.env.RTK_CONFIG
      || (process.platform === 'darwin'
        ? path.join(homeDir(), 'Library', 'Application Support', 'rtk', 'config.toml')
        : path.join(process.env.XDG_DATA_HOME || path.join(homeDir(), '.local', 'share'), 'rtk', 'config.toml'));
    let config = '';
    try { config = fs.readFileSync(configPath, 'utf8'); } catch { /* use RTK CLI fallback */ }
    const modeMatch = /^\s*mode\s*=\s*"(sqlite|tee|disabled)"/m.exec(config);
    const mode = (modeMatch?.[1] ?? 'unknown') as RtkRecallDiagnostics['mode'];
    const output = execFileSync(binary, ['recall', '--list'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
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

// --- Pricing lives in ./pricing.ts (live LiteLLM cache + fallback table) ---
import { DEFAULT_PRICE, canonicalPriceId, priceFor, refreshPricesIfStale } from './pricing.ts';
import { co2GramsFor, energyWhFor } from './carbon.ts';
import type { ModelPrice } from './pricing.ts';

export { DEFAULT_PRICE, priceFor, refreshPricesIfStale };
export { co2GramsFor, energyWhFor };
export type { ModelPrice };

export function usdCost(t: TokenBreakdown, model?: string): { usd: number; priced: boolean; buckets: { input: number; output: number; cacheRead: number; cacheWrite: number } } {
  const { price, known } = model ? priceFor(model) : { price: DEFAULT_PRICE, known: false };
  const m = 1 / 1_000_000;
  const buckets = {
    input: t.input * price.input * m,
    output: t.output * price.output * m,
    cacheRead: t.cacheRead * price.cacheRead * m,
    cacheWrite: t.cacheWrite * price.cacheWrite * m,
  };
  return {
    usd: buckets.input + buckets.output + buckets.cacheRead + buckets.cacheWrite,
    priced: model ? known : false,
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

// Delete the ledger file and return the rows cleared. Tersio-owned data only: transcripts and the RTK database are never touched.
export function clearUsageLedger(): number {
  const rows = readUsage().length;
  try {
    fs.unlinkSync(ledgerPath());
  } catch { /* already absent */ }
  return rows;
}
