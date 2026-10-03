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
  costMeasured: number;
  recent: RecentRequest[];
}

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

// Empty when sqlite3 is absent or the db is unreadable; that is a sync skip, not a failure.
export function readOpencodeDbRows(db: string, sinceMs: number): OpencodeDbRow[] {
  if (!Number.isFinite(sinceMs)) return [];
  try {
    if (!fs.existsSync(db)) return [];
    const since = Math.max(0, Math.floor(sinceMs));
    // Separate calls: a db holding only one table must not cancel the other.
const run = (sql: string): string =>
  execFileSync('sqlite3', ['-separator', '\t', '-readonly', db, sql], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'] });
let out = '';
try { out += run(ocDbLegacy(since)); } catch { /* no legacy table or unreadable */ }
try { out += run(ocDbCurrent(since)); } catch { /* no session_message table or unreadable */ }
    const rows: OpencodeDbRow[] = [];
    for (const line of out.split('\n')) {
      if (!line.trim()) continue;
      const [id, created, role, providerID, modelID, tCreated, tCompleted, input, output, cacheRead, cacheWrite, cost] = line.split('\t');
      const n = (v: string | undefined): unknown => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
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
// Parse buffer shared by live reads and usage.db syncs, so the store is a cache and never a fork.
export interface SessionAccum {
  byModel: Record<string, TokenBreakdown>;
  byDay: Record<string, TokenBreakdown>;
  byDayModel: Record<string, Record<string, number>>;
  byTool: Record<string, number>;
  byModelMessages: Record<string, number>;
  byHost: Record<string, Record<string, TokenBreakdown>>;
  totals: TokenBreakdown;
  messages: number;
  costMeasured: number;
  recent: RecentRequest[];
}
export function newSessionAccum(): SessionAccum {
  return { byModel: {}, byDay: {}, byDayModel: {}, byTool: {}, byModelMessages: {}, byHost: {}, totals: zeroBreakdown(), messages: 0, costMeasured: 0, recent: [] };
}
export function ingestSessionRow(accum: SessionAccum, model: string, usage: Record<string, unknown>, ts: string | number | undefined, durMs?: unknown, run?: { st: RunStatus; code?: number; note?: string }, toolNames?: string[], host?: string, id?: string): boolean {
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
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  if (Number.isFinite(ms)) {
    const outcome = run ?? { st: 'completed' as RunStatus };
    accum.recent.push({ m: key, i: num(usage.input), o: num(usage.output), t: ms, d: durOf(durMs), h: host, cr: num(usage.cacheRead), cw: num(usage.cacheWrite), usd: costOf(usage), st: outcome.st, code: outcome.code, note: outcome.note, id });
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
  if (measured !== undefined) accum.costMeasured += measured;
  for (const name of toolNames ?? []) accum.byTool[name] = (accum.byTool[name] ?? 0) + 1;
  return true;
}
export type SessionLineKind = 'codex_provider' | 'codex_model' | 'token_row' | 'assistant_row' | 'skip';
export function classifySessionLine(row: { timestamp?: string | number; type?: unknown; message?: { role?: unknown; model?: unknown; usage?: Record<string, unknown>; duration?: unknown; completedAt?: unknown; timestamp?: unknown; stopReason?: unknown; errorStatus?: unknown; errorMessage?: unknown; isError?: unknown; content?: Array<{ type?: unknown; name?: unknown; arguments?: unknown }> }; payload?: { type?: unknown; model?: unknown; model_provider?: unknown; info?: { last_token_usage?: Record<string, unknown> } } }): { kind: SessionLineKind; provider?: string; model?: string; usage?: Record<string, unknown>; durMs?: number; run?: { st: RunStatus; code?: number; note?: string }; tools?: string[]; ms?: number } {
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
  return { kind: 'assistant_row', model, usage: msg.usage, durMs: typeof msg.duration === 'number' ? msg.duration : computedDur, run: statusOf(msg), tools };
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

// Vendor names mirror the dashboard map; CLI needs names only.
const VENDOR_RES: Array<[RegExp, string]> = [
  [/inclusionai|ling-/i, 'InclusionAI'],
  [/grok|xai/i, 'xAI'],
  [/stealth|space-bunny/i, 'Stealth'],
  [/openai|codex|gpt-|o1/i, 'OpenAI'],
  [/muse|llama/i, 'Meta'],
  [/deepseek/i, 'DeepSeek'],
  [/qwen|qwq/i, 'Alibaba'],
  [/glm|z-ai|zhipu/i, 'Z.ai'],
  [/mimo/i, 'Xiaomi'],
  [/kimi|moonshot/i, 'Moonshot'],
  [/minimax/i, 'MiniMax'],
  [/nemotron|nvidia/i, 'NVIDIA'],
  [/mistral/i, 'Mistral'],
  [/claude|anthropic/i, 'Anthropic'],
  [/gemini|google|gemma/i, 'Google'],
  [/devin|cognition|^swe[-/]/i, 'Cognition'],
];

function modelVendor(model: string): string {
  for (const [re, name] of VENDOR_RES) {
    if (re.test(model)) return name;
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
    if (low === 'ai') return 'AI';
    if (/^\d+[a-z]+$/.test(low)) return low.toUpperCase();
    if (s.length <= 2) return s.toUpperCase();
    return s[0].toUpperCase() + s.slice(1).toLowerCase();
  };
  const seg = (s: string): string => s.split('.').map(cap).join('.');
  const words = (s: string): string => s.split(/[-_:]+/).filter(Boolean).map(seg).join('-');
  const segs = bare.split('/').filter(Boolean);
  const pretty = words(segs[segs.length - 1] ?? bare);
  const vendor = modelVendor(bare);
  if (vendor === 'Other') return segs.length > 1 ? `${words(segs[segs.length - 2])} - ${pretty}` : pretty;
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
    }, text, hostOfSessionFile(file));
  }
  accum.recent.sort((a, b) => b.t - a.t);
  return { messages: accum.messages, totals: accum.totals, byModel: accum.byModel, byDay: accum.byDay, byDayModel: accum.byDayModel, byTool: accum.byTool, byModelMessages: accum.byModelMessages, byHost: accum.byHost, costMeasured: accum.costMeasured, recent: accum.recent.slice(0, RECENT_LIMIT) };
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
export function processSessionText(accum: SessionAccum, state: { codexProvider: string | null; codexModel?: string | null }, text: string, host?: string): void {
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
      if (parsed.kind === 'token_row') {
        const base = parsed.provider ? `codex/${parsed.provider}` : (state.codexProvider ? `codex/${state.codexProvider}` : 'codex');
        // The provider alone told you nothing about which model ran.
        const model = state.codexModel ? `${base}/${state.codexModel}` : base;
        ingestSessionRow(accum, model, parsed.usage ?? {}, row.timestamp, parsed.durMs, { st: 'completed' as RunStatus }, undefined, host ?? 'codex', rid);
        continue;
      }
      if (parsed.kind !== 'assistant_row' || !parsed.model || !parsed.usage) continue;
      ingestSessionRow(accum, parsed.model, parsed.usage, row.timestamp, parsed.durMs, parsed.run, parsed.tools, host, rid);
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
