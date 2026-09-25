// Shared usage ledger: append-only JSON-lines file. One source of truth read
// by `tersio usage`, `/tersio usage`, and the Dashboard.
// Best-effort by design: a ledger failure never breaks the caller, and
// corrupt lines are skipped on read (same pattern as the config normalizer).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveRtkBinary, tersioDataPath } from '../lib/utils.ts';
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

// Reset watermark: tersio-owned timestamp marking the last statistics reset.
// Session transcripts and the RTK database are host/tool-owned and never
// touched — instead, every derived view (token stats, command tools) filters
// rows from before the watermark, so "reset" empties what tersio shows
// without deleting anything it does not own.
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

// --- Session tokens, tokscale-style ------------------------------------------
// OMP writes per-assistant-message usage into ~/.omp/agent/sessions/**/*.jsonl:
// message.role === 'assistant', message.usage = { input, output, cacheRead,
// cacheWrite }, message.model, plus a per-line timestamp. Same source tokscale
// parses for its oh-my-pi client. Best-effort: unreadable files are skipped.
export interface TokenBreakdown {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

// Run outcome for one assistant message. OMP writes stopReason on every turn
// (toolUse | stop | aborted | error) and, when the request failed, an HTTP
// errorStatus plus errorMessage. `toolUse` is an ordinary turn that handed off
// to tools, so it reads as completed rather than as a distinct state.
export type RunStatus = 'completed' | 'aborted' | 'error';

export interface RecentRequest {
  m: string;
  i: number;
  o: number;
  t: number;
  d?: number;
  cr?: number;
  cw?: number;
  // Measured spend for this message, from the transcript's usage.cost.total.
  // Left undefined when the host recorded no cost — never backfilled with an
  // estimate, so a measured figure is never mistaken for a modeled one.
  usd?: number;
  st: RunStatus;
  code?: number;
  note?: string;
}

export interface SessionTokens {
  messages: number;
  totals: TokenBreakdown;
  byModel: Record<string, TokenBreakdown>;
  byDay: Record<string, TokenBreakdown>;
  byDayModel: Record<string, Record<string, number>>;
  byTool: Record<string, number>;
  byModelMessages: Record<string, number>;
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
export function durOf(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
}

// Measured cost for one message. OMP writes usage.cost as
// { input, output, cacheRead, cacheWrite, total }; a bare number shows up in
// older fixtures. Anything else means "not recorded" — deliberately not 0, so
// the dashboard can tell a genuinely free run from an unrecorded one.
export function costOf(usage: Record<string, unknown>): number | undefined {
  const c = usage.cost;
  if (typeof c === 'number') return Number.isFinite(c) ? c : undefined;
  if (c && typeof c === 'object') {
    const total = (c as { total?: unknown }).total;
    if (typeof total === 'number' && Number.isFinite(total)) return total;
  }
  return undefined;
}

// First line only: real messages carry multi-line provider errors, and this
// ends up in a tooltip.
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

export function sessionsDir(): string {
  const override = process.env.TERSIO_SESSIONS_DIR;
  if (override) return override;
  return path.join(os.homedir(), '.omp', 'agent', 'sessions');
}

export function codexSessionsDir(): string {
  const override = process.env.TERSIO_CODEX_DIR;
  if (override) return override;
  const codexHome = process.env.CODEX_HOME;
  if (codexHome) return path.join(codexHome, 'sessions');
  return path.join(os.homedir(), '.codex', 'sessions');
}

export function dayKey(ts: string | number): string | null {
  const ms = typeof ts === 'number' ? ts : Date.parse(ts);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function walkJsonl(dir: string, out: string[], cap: number): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= cap) return;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkJsonl(full, out, cap);
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(full);
  }
}
// Recent requests are their own full-width table in the dashboard, so this is
// a payload bound rather than a "few highlights" bound. Rows are small
// (model, tokens, timing, status), so a few hundred cost little to ship.
export const RECENT_LIMIT = 200;
const FREE_SUFFIX = /(?::free|-free)$/i;
const RTK_ELIGIBLE_HEADS = new Set([
  'rtk', 'git', 'grep', 'rg', 'find', 'cat', 'ls', 'tree', 'diff', 'log',
  'npm', 'npx', 'pnpm', 'bun', 'bunx', 'cargo', 'go', 'python', 'pytest',
  'ruff', 'mypy', 'docker', 'kubectl', 'psql', 'aws', 'gh', 'glab', 'wc',
]);
// Session-parse buffer shared by live reads and usage.db syncs: identical
// inputs produce identical aggregates, so the store is a cache, never a fork.
export interface SessionAccum {
  byModel: Record<string, TokenBreakdown>;
  byDay: Record<string, TokenBreakdown>;
  byDayModel: Record<string, Record<string, number>>;
  byTool: Record<string, number>;
  byModelMessages: Record<string, number>;
  totals: TokenBreakdown;
  messages: number;
  costMeasured: number;
  recent: RecentRequest[];
}
export function newSessionAccum(): SessionAccum {
  return { byModel: {}, byDay: {}, byDayModel: {}, byTool: {}, byModelMessages: {}, totals: zeroBreakdown(), messages: 0, costMeasured: 0, recent: [] };
}
export function ingestSessionRow(accum: SessionAccum, model: string, usage: Record<string, unknown>, ts: string | number | undefined, durMs?: unknown, run?: { st: RunStatus; code?: number; note?: string }, toolNames?: string[]): boolean {
  const watermark = readResetWatermark();
  const ms = ts === undefined ? NaN : typeof ts === 'number' ? ts : Date.parse(ts);
  if (watermark > 0 && (!Number.isFinite(ms) || ms < watermark)) return false;
  addInto(accum.totals, usage);
  const key = model.replace(FREE_SUFFIX, '').toLowerCase();
  accum.byModel[key] ??= zeroBreakdown();
  addInto(accum.byModel[key], usage);
  accum.byModelMessages[key] = (accum.byModelMessages[key] ?? 0) + 1;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  if (Number.isFinite(ms)) {
    const outcome = run ?? { st: 'completed' as RunStatus };
    accum.recent.push({ m: key, i: num(usage.input), o: num(usage.output), t: ms, d: durOf(durMs), cr: num(usage.cacheRead), cw: num(usage.cacheWrite), usd: costOf(usage), st: outcome.st, code: outcome.code, note: outcome.note });
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
export type SessionLineKind = 'codex_provider' | 'token_row' | 'assistant_row' | 'skip';
export function classifySessionLine(row: { timestamp?: string | number; type?: unknown; message?: { role?: unknown; model?: unknown; usage?: Record<string, unknown>; duration?: unknown; completedAt?: unknown; timestamp?: unknown; stopReason?: unknown; errorStatus?: unknown; errorMessage?: unknown; isError?: unknown; content?: Array<{ type?: unknown; name?: unknown; arguments?: unknown }> }; payload?: { type?: unknown; model_provider?: unknown; info?: { last_token_usage?: Record<string, unknown> } } }): { kind: SessionLineKind; provider?: string; model?: string; usage?: Record<string, unknown>; durMs?: number; run?: { st: RunStatus; code?: number; note?: string }; tools?: string[]; ms?: number } {
  const payload = row.payload;
  if (payload && typeof payload === 'object') {
    if (row.type === 'session_meta' && typeof payload.model_provider === 'string') return { kind: 'codex_provider', provider: payload.model_provider };
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
  const computedDur = (typeof msg.completedAt === 'number' && typeof msg.timestamp === 'number') ? msg.completedAt - msg.timestamp : undefined;
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
// Fold `:free`/`-free` suffixes and case variants into one chart key, so the
// same model from two providers stops splitting into separate rows.
export function canonicalModelId(model: string): string {
  return model.replace(FREE_SUFFIX, '').toLowerCase();
}
// LiteLLM-style display: namespace stays lowercase, model segments title-case
// with version dots kept (`deepseek-v4.1-flash` → `Deepseek-V4.1-Flash`).
export function displayModelId(model: string): string {
  const bare = model.replace(FREE_SUFFIX, '');
  const cap = (s: string): string => {
    const low = s.toLowerCase();
    if (low === 'openai') return 'OpenAI';
    if (low === 'ai') return 'AI';
    if (/^\d+[a-z]+$/.test(low)) return low.toUpperCase();
    if (s.length <= 2) return s.toUpperCase();
    return s[0].toUpperCase() + s.slice(1).toLowerCase();
  };
  const seg = (s: string): string => s.split('.').map(cap).join('.');
  const words = (s: string): string => s.split(/[-_:]+/).filter(Boolean).map(seg).join('-');
  const slash = bare.indexOf('/');
  if (slash >= 0) return `${bare.slice(0, slash).toLowerCase()}/${words(bare.slice(slash + 1))}`;
  return words(bare);
}

export function importSessionTokens(): SessionTokens {
  const accum = newSessionAccum();
  const files: string[] = [];
  walkJsonl(sessionsDir(), files, 2000);
  // A sessions override signals an isolated environment (tests, fixtures):
  // only walk the real codex dir when it is explicitly set.
  if (process.env.TERSIO_SESSIONS_DIR === undefined || process.env.TERSIO_CODEX_DIR !== undefined) {
    walkJsonl(codexSessionsDir(), files, 2000);
  }
  let codexProvider: string | null = null;
  for (const file of files) {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    processSessionText(accum, { get codexProvider() { return codexProvider; }, set codexProvider(v: string | null) { codexProvider = v; } }, text);
  }
  accum.recent.sort((a, b) => b.t - a.t);
  return { messages: accum.messages, totals: accum.totals, byModel: accum.byModel, byDay: accum.byDay, byDayModel: accum.byDayModel, byTool: accum.byTool, byModelMessages: accum.byModelMessages, costMeasured: accum.costMeasured, recent: accum.recent.slice(0, RECENT_LIMIT) };
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
  walkJsonl(sessionsDir(), files, 2000);
  if (process.env.TERSIO_SESSIONS_DIR === undefined || process.env.TERSIO_CODEX_DIR !== undefined) {
    walkJsonl(codexSessionsDir(), files, 2000);
  }
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
export function processSessionText(accum: SessionAccum, state: { codexProvider: string | null }, text: string): void {
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as Parameters<typeof classifySessionLine>[0];
      const parsed = classifySessionLine(row);
      if (parsed.kind === 'codex_provider') {
        if (parsed.provider) state.codexProvider = parsed.provider;
        continue;
      }
      if (parsed.kind === 'token_row') {
        const model = parsed.provider ? `codex/${parsed.provider}` : (state.codexProvider ? `codex/${state.codexProvider}` : 'codex');
        ingestSessionRow(accum, model, parsed.usage ?? {}, row.timestamp, undefined, { st: 'completed' as RunStatus });
        continue;
      }
      if (parsed.kind !== 'assistant_row' || !parsed.model || !parsed.usage) continue;
      ingestSessionRow(accum, parsed.model, parsed.usage, row.timestamp, parsed.durMs, parsed.run, parsed.tools);
    } catch { /* skip corrupt lines */ }
  }
}

export function readRtkRecallDiagnostics(binary: string | null = resolveRtkBinary()): RtkRecallDiagnostics {
  if (!binary) return { mode: 'unknown', entries: 0, available: false };
  try {
    const configPath = process.env.RTK_CONFIG
      || (process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support', 'rtk', 'config.toml')
        : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'rtk', 'config.toml'));
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
// Lead binary of a shell string: first segment head past `cd` chains and
// VAR=x assignments (`cd /x && git status` → `git`). Falls back to `bash`.
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
import { DEFAULT_PRICE, priceFor, refreshPricesIfStale } from './pricing.ts';
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

// CO2 is model-differentiated via ./carbon.ts (EcoLogits 0.8.2 port).
// Always render with ~est. and never merge with measured figures.

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

// Delete the ledger file. Returns the rows cleared (0 when already absent).
// Only tersio-owned data lives here; session transcripts and the RTK
// database are never touched.
export function clearUsageLedger(): number {
  const rows = readUsage().length;
  try {
    fs.unlinkSync(ledgerPath());
  } catch { /* already absent */ }
  return rows;
}
