// Shared usage ledger: append-only JSON-lines file. One source of truth read
// by `tersio usage`, `/tersio usage`, and the gain dashboard.
// Best-effort by design: a ledger failure never breaks the caller, and
// corrupt lines are skipped on read (same pattern as the config normalizer).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type UsageKind = 'command' | 'toggle' | 'install' | 'update' | 'rtk-audit';

export interface UsageRow {
  ts: number;
  kind: UsageKind;
  detail: string;
}

export function ledgerPath(): string {
  const override = process.env.TERSIO_USAGE_FILE;
  if (override) return override;
  return path.join(os.homedir(), '.omp', 'plugins', 'tersio-usage.jsonl');
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

export interface RecentRequest {
  m: string;
  i: number;
  o: number;
  t: number;
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

function zeroBreakdown(): TokenBreakdown {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
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

function dayKey(ts: string | number): string | null {
  const ms = typeof ts === 'number' ? ts : Date.parse(ts);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function walkJsonl(dir: string, out: string[], cap: number): void {
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

export function importSessionTokens(): SessionTokens {
  const byModel: Record<string, TokenBreakdown> = {};
  const byDay: Record<string, TokenBreakdown> = {};
  const byDayModel: Record<string, Record<string, number>> = {};
  const byTool: Record<string, number> = {};
  const byModelMessages: Record<string, number> = {};
  const totals = zeroBreakdown();
  let messages = 0;
  let costMeasured = 0;
  const files: string[] = [];
  walkJsonl(sessionsDir(), files, 2000);
  // A sessions override signals an isolated environment (tests, fixtures):
  // only walk the real codex dir when it is explicitly set.
  if (process.env.TERSIO_SESSIONS_DIR === undefined || process.env.TERSIO_CODEX_DIR !== undefined) {
    walkJsonl(codexSessionsDir(), files, 2000);
  }
  let codexProvider: string | null = null;
  const recent: RecentRequest[] = [];
  function ingest(model: string, usage: Record<string, unknown>, ts: string | number | undefined): void {
    addInto(totals, usage);
    byModel[model] ??= zeroBreakdown();
    addInto(byModel[model], usage);
    byModelMessages[model] = (byModelMessages[model] ?? 0) + 1;
    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
    const ms = ts === undefined ? NaN : typeof ts === 'number' ? ts : Date.parse(ts);
    if (Number.isFinite(ms)) recent.push({ m: model, i: num(usage.input), o: num(usage.output), t: ms });
    const day = ts !== undefined ? dayKey(ts) : null;
    if (day) {
      byDay[day] ??= zeroBreakdown();
      addInto(byDay[day], usage);
      const sum = ['input', 'output', 'cacheRead', 'cacheWrite'].reduce((a, k) => a + (typeof usage[k] === 'number' && Number.isFinite(usage[k]) ? Math.floor(usage[k] as number) : 0), 0);
      if (sum > 0) {
        byDayModel[day] ??= {};
        byDayModel[day][model] = (byDayModel[day][model] ?? 0) + sum;
      }
    }
    messages += 1;
  }
  for (const file of files) {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as {
          timestamp?: string | number;
          message?: { role?: unknown; model?: unknown; usage?: Record<string, unknown>; content?: Array<{ type?: unknown; name?: unknown; arguments?: unknown }> };
        };
        const codexRow = row as { type?: unknown; payload?: { type?: unknown; model_provider?: unknown; info?: { last_token_usage?: Record<string, unknown> } } };
        const payload = codexRow.payload;
        if (payload && typeof payload === 'object') {
          if (codexRow.type === 'session_meta' && typeof payload.model_provider === 'string') {
            codexProvider = payload.model_provider;
          } else if (payload.type === 'token_count') {
            const last = payload.info?.last_token_usage;
            if (last) {
              ingest(codexProvider ? `codex/${codexProvider}` : 'codex', {
                input: last['input_tokens'],
                output: last['output_tokens'],
                cacheRead: last['cached_input_tokens'],
                cacheWrite: last['cache_write_input_tokens'],
              }, row.timestamp);
              continue;
            }
          }
        }
        const msg = row.message;
        if (!msg || msg.role !== 'assistant' || !msg.usage) continue;
        const model = typeof msg.model === 'string' && msg.model ? msg.model : 'unknown';
        ingest(model, msg.usage, row.timestamp);
        if (typeof msg.usage.cost === 'number' && Number.isFinite(msg.usage.cost)) costMeasured += msg.usage.cost;
        for (const part of msg.content ?? []) {
          if (part?.type === 'toolCall' && typeof part.name === 'string' && part.name) {
            const key = part.name === 'bash' ? `bash:${leadBinary((part.arguments as { command?: unknown } | null)?.command)}` : part.name;
            byTool[key] = (byTool[key] ?? 0) + 1;
          }
        }
      } catch { /* skip corrupt lines */ }
    }
  }
  recent.sort((a, b) => b.t - a.t);
  return { messages, totals, byModel, byDay, byDayModel, byTool, byModelMessages, costMeasured, recent: recent.slice(0, 25) };
}
// Lead binary of a shell string: first segment head past `cd` chains and
// VAR=x assignments (`cd /x && git status` → `git`). Falls back to `bash`.
const SKIP_HEADS = ['cd', 'echo', 'export', 'true', 'false'];
function leadBinary(command: unknown): string {
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
import { DEFAULT_PRICE, priceFor } from './pricing.ts';
import { co2GramsFor, energyWhFor } from './carbon.ts';
import type { ModelPrice } from './pricing.ts';

export { DEFAULT_PRICE, priceFor };
export { co2GramsFor, energyWhFor };
export type { ModelPrice };

export function usdCost(t: TokenBreakdown, model?: string): { usd: number; priced: boolean } {
  const { price, known } = model ? priceFor(model) : { price: DEFAULT_PRICE, known: false };
  const m = 1 / 1_000_000;
  return {
    usd: (t.input * price.input + t.output * price.output + t.cacheRead * price.cacheRead + t.cacheWrite * price.cacheWrite) * m,
    priced: model ? known : false,
  };
}

// CO2 now model-differentiated via ./carbon.ts (EcoLogits 0.8.2 port).
// Always render with ~est. and never merge with measured figures.
// The constant below is the served gCO2eq per 1K output tokens for the
// default (gpt-4o-class) model, kept so single-figure callers stay honest.
export const CO2_G_PER_1K_OUTPUT = 0.2;

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
