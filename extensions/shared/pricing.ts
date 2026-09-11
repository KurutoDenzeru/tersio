// extensions/shared/pricing.ts — model pricing with live LiteLLM refresh.
// Lookup order: exact id in the live cache → built-in substring table → default.
// Network only in refreshPrices (called from `tersio update`); every reader is
// sync and offline-safe. Best-effort throughout: pricing never breaks a caller.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

// Rough list rates (USD per 1M tokens) for the models OMP sessions cite.
// Refresh against LiteLLM pricing data when adding families.
const PRICE_TABLE: Array<{ match: string; price: ModelPrice }> = [
  { match: ':free', price: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
  { match: 'opus', price: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 } },
  { match: 'sonnet', price: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
  { match: 'haiku', price: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 } },
  { match: 'gpt', price: { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 2.5 } },
  { match: 'gemini', price: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 } },
  { match: 'glm', price: { input: 0.5, output: 1, cacheRead: 0.05, cacheWrite: 0.5 } },
];

export const DEFAULT_PRICE: ModelPrice = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };

const LITELLM_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const CACHE_TTL_MS = 7 * 24 * 3600 * 1000;
const KEEP_RE = /claude|sonnet|opus|haiku|gpt|gemini|glm|deepseek|qwen|kimi|mistral|grok|llama|muse|nemotron|ministral|codestral|qwen/i;

export function pricesCachePath(): string {
  const override = process.env.TERSIO_PRICES_FILE;
  if (override) return override;
  return path.join(os.homedir(), '.omp', 'plugins', 'tersio-prices.json');
}

export function pricesUrl(): string {
  return process.env.TERSIO_PRICES_URL || LITELLM_URL;
}

export interface LivePrices {
  fetchedAt: number;
  exact: Record<string, ModelPrice>;
}

export function loadLivePrices(): LivePrices | null {
  let raw: string;
  try {
    raw = fs.readFileSync(pricesCachePath(), 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<LivePrices>;
    if (typeof parsed.fetchedAt !== 'number' || !parsed.exact || typeof parsed.exact !== 'object') return null;
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
    return { fetchedAt: parsed.fetchedAt, exact: parsed.exact };
  } catch {
    return null;
  }
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

export function priceFor(model: string, live?: LivePrices | null): { price: ModelPrice; known: boolean; live: boolean } {
  const table = live === undefined ? loadLivePrices() : live;
  if (table) {
    const hit = table.exact[model] ?? table.exact[model.toLowerCase()];
    if (hit && [hit.input, hit.output, hit.cacheRead, hit.cacheWrite].every((v) => typeof v === 'number')) {
      return { price: hit, known: true, live: true };
    }
  }
  const name = model.toLowerCase();
  for (const row of PRICE_TABLE) {
    if (name.includes(row.match)) return { price: row.price, known: true, live: false };
  }
  return { price: DEFAULT_PRICE, known: false, live: false };
}

// Fetch LiteLLM pricing, keep relevant families, write the cache. False on
// any failure (offline, timeout, shape change) — callers fall back silently.
export async function refreshPrices(): Promise<boolean> {
  let res: Response;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);
    try {
      res = await fetch(pricesUrl(), { signal: ctl.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return false;
  } catch {
    return false;
  }
  let data: Record<string, Record<string, unknown>>;
  try {
    data = (await res.json()) as Record<string, Record<string, unknown>>;
  } catch {
    return false;
  }
  const exact: Record<string, ModelPrice> = {};
  for (const [id, row] of Object.entries(data)) {
    if (!row || typeof row !== 'object' || !KEEP_RE.test(id)) continue;
    const input = num(row.input_cost_per_token);
    const output = num(row.output_cost_per_token);
    if (input === null || output === null) continue;
    exact[id] = {
      input: input * 1e6,
      output: output * 1e6,
      cacheRead: (num(row.cache_read_input_token_cost) ?? input) * 1e6,
      cacheWrite: (num(row.cache_creation_input_token_cost) ?? input) * 1e6,
    };
  }
  if (!Object.keys(exact).length) return false;
  try {
    fs.mkdirSync(path.dirname(pricesCachePath()), { recursive: true });
    fs.writeFileSync(pricesCachePath(), JSON.stringify({ fetchedAt: Date.now(), exact }), 'utf8');
    return true;
  } catch {
    return false;
  }
}
