// extensions/shared/pricing.ts — dynamic model pricing from LiteLLM.
// Lookup order: exact id in the live cache → provider-prefix strip → default.
// The cache is the full LiteLLM feed (3k+ ids), refreshed lazily in background
// and on `tersio update`; every reader is sync and offline-safe. No static
// per-model table — list prices rot, the feed does not. Unknown models report
// the default with known:false so the dashboard labels them honestly.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

// Sonnet-class default for unpriced models; always paired with known:false.
export const DEFAULT_PRICE: ModelPrice = { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 };

const LITELLM_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
// Live cache refreshes lazily: readers use the file even when stale, and only
// one refresh runs per process. `tersio update` still forces a fresh fetch.
const CACHE_TTL_MS = 7 * 24 * 3600 * 1000;
let refreshInflight: Promise<boolean> | null = null;

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
  // Compact tuples [input, output, cacheRead, cacheWrite] per LiteLLM id —
  // the full feed caches to ~1MB instead of multi-MB objects.
  exact: Record<string, [number, number, number, number]>;
  deprecated?: string[];
}

function toPrice(t: [number, number, number, number]): ModelPrice {
  return { input: t[0], output: t[1], cacheRead: t[2], cacheWrite: t[3] };
}

// Tolerate both cache shapes: compact tuples (new) and ModelPrice objects
// (written by older refreshes) — a version bump never orphans the cache.
function asPrice(v: unknown): ModelPrice | null {
  if (Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)) {
    return toPrice(v as [number, number, number, number]);
  }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (['input', 'output', 'cacheRead', 'cacheWrite'].every((k) => typeof o[k] === 'number' && Number.isFinite(o[k]) && (o[k] as number) >= 0)) {
      return o as unknown as ModelPrice;
    }
  }
  return null;
}

export function loadLivePrices(): LivePrices | null {
  let raw: string;
  try {
    raw = fs.readFileSync(pricesCachePath(), 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as { fetchedAt?: unknown; exact?: unknown; deprecated?: unknown };
    if (typeof parsed.fetchedAt !== 'number' || !parsed.exact || typeof parsed.exact !== 'object') return null;
    const exact: Record<string, [number, number, number, number]> = {};
    for (const [k, v] of Object.entries(parsed.exact as Record<string, unknown>)) {
      const p = asPrice(v);
      if (p) exact[k] = [p.input, p.output, p.cacheRead, p.cacheWrite];
    }
    if (!Object.keys(exact).length) return null;
    // Stale entries stay usable; refreshPricesIfStale refreshes in background.
    const deprecated = Array.isArray(parsed.deprecated) ? (parsed.deprecated as unknown[]).filter((d): d is string => typeof d === 'string') : [];
    return { fetchedAt: parsed.fetchedAt, exact, deprecated };
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
    const hit = asPrice(table.exact[model] ?? table.exact[model.toLowerCase()]);
    if (hit) return { price: hit, known: true, live: true };
    // Provider-prefixed ids ("azure/gpt-4o", "dashscope/qwen-max"): match the
    // first cached id that ends with the bare model name.
    const name = model.toLowerCase();
    const key = Object.keys(table.exact).find((k) => k.toLowerCase() === name || k.toLowerCase().endsWith(`/${name}`));
    const prefixed = key ? asPrice(table.exact[key]) : null;
    if (prefixed) return { price: prefixed, known: true, live: true };
  }
  return { price: DEFAULT_PRICE, known: false, live: false };
}
// Fetch LiteLLM pricing, keep every id with valid input/output rates, write
// the cache. False on any failure (offline, timeout, shape change) — callers
// fall back silently.
export async function refreshPrices(): Promise<boolean> {
  if (refreshInflight) return refreshInflight;
  refreshInflight = (async () => {
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
    const exact: Record<string, [number, number, number, number]> = {};
    const deprecated: string[] = [];
    for (const [id, row] of Object.entries(data)) {
      if (!row || typeof row !== 'object') continue;
      const input = num(row.input_cost_per_token);
      const output = num(row.output_cost_per_token);
      if (input === null || output === null) continue;
      exact[id] = [
        input * 1e6,
        output * 1e6,
        (num(row.cache_read_input_token_cost) ?? input) * 1e6,
        (num(row.cache_creation_input_token_cost) ?? input) * 1e6,
      ];
      if (typeof row.deprecation_date === 'string' && row.deprecation_date) deprecated.push(id);
    }
    if (!Object.keys(exact).length) return false;
    try {
      fs.mkdirSync(path.dirname(pricesCachePath()), { recursive: true });
      fs.writeFileSync(pricesCachePath(), JSON.stringify({ fetchedAt: Date.now(), exact, deprecated }), 'utf8');
      return true;
    } catch {
      return false;
    }
  })();
  try {
    return await refreshInflight;
  } finally {
    refreshInflight = null;
  }
}

// Fire-and-forget refresh when the cache is stale or missing. Readers keep
// using the stale file (or the built-in table) — pricing never blocks.
export function refreshPricesIfStale(): void {
  const live = loadLivePrices();
  if (live && Date.now() - live.fetchedAt <= CACHE_TTL_MS) return;
  void refreshPrices().catch(() => false);
}
