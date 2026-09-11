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

export interface SessionTokens {
  messages: number;
  totals: TokenBreakdown;
  byModel: Record<string, TokenBreakdown>;
  byDay: Record<string, TokenBreakdown>;
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
  const totals = zeroBreakdown();
  let messages = 0;
  const files: string[] = [];
  walkJsonl(sessionsDir(), files, 2000);
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
          message?: { role?: unknown; model?: unknown; usage?: Record<string, unknown> };
        };
        const msg = row.message;
        if (!msg || msg.role !== 'assistant' || !msg.usage) continue;
        const model = typeof msg.model === 'string' && msg.model ? msg.model : 'unknown';
        addInto(totals, msg.usage);
        byModel[model] ??= zeroBreakdown();
        addInto(byModel[model], msg.usage);
        const day = row.timestamp !== undefined ? dayKey(row.timestamp) : null;
        if (day) {
          byDay[day] ??= zeroBreakdown();
          addInto(byDay[day], msg.usage);
        }
        messages += 1;
      } catch { /* skip corrupt lines */ }
    }
  }
  return { messages, totals, byModel, byDay };
}

// --- Pricing: USD per 1M tokens, LiteLLM-style --------------------------------
// Rough list rates for the models OMP sessions actually cite. Refresh against
// LiteLLM pricing data when adding families. Unknown models fall to DEFAULT.
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const PRICE_TABLE: Array<{ match: string; price: ModelPrice }> = [
  { match: ':free', price: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
  { match: 'opus', price: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 } },
  { match: 'sonnet', price: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
  { match: 'haiku', price: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 } },
  { match: 'gpt', price: { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 2.5 } },
  { match: 'gemini', price: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 } },
  { match: 'glm', price: { input: 0.5, output: 1, cacheRead: 0.05, cacheWrite: 0.5 } },
];

const DEFAULT_PRICE: ModelPrice = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };

export function priceFor(model: string): { price: ModelPrice; known: boolean } {
  const name = model.toLowerCase();
  for (const row of PRICE_TABLE) {
    if (name.includes(row.match)) return { price: row.price, known: true };
  }
  return { price: DEFAULT_PRICE, known: false };
}

export function usdCost(t: TokenBreakdown, model?: string): { usd: number; priced: boolean } {
  const { price, known } = model ? priceFor(model) : { price: DEFAULT_PRICE, known: false };
  const m = 1 / 1_000_000;
  return {
    usd: (t.input * price.input + t.output * price.output + t.cacheRead * price.cacheRead + t.cacheWrite * price.cacheWrite) * m,
    priced: model ? known : false,
  };
}

// ponytail: CO2 is a rough server-energy multiple on output tokens, not metered.
// Always render with ~est. and never merge with measured figures.
export const CO2_G_PER_1K_OUTPUT = 0.2;

export function co2Grams(outputTokens: number): number {
  return (outputTokens / 1000) * CO2_G_PER_1K_OUTPUT;
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
