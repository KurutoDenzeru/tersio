// extensions/shared/pricing.ts — dynamic model pricing from LiteLLM. Exact id → provider-prefix strip → default, reported with known:false when unpriced.
import fs from 'node:fs';
import path from 'node:path';
import { tersioDataPath } from '../lib/utils.ts';

export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

// Sonnet-class default for unpriced models; always paired with known:false.
export const DEFAULT_PRICE: ModelPrice = { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 };

const LITELLM_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
// Readers use the file even when stale, and only one refresh runs per process; `tersio update` still forces a fresh fetch.
const CACHE_TTL_MS = 7 * 24 * 3600 * 1000;
let refreshInflight: Promise<boolean> | null = null;

export function pricesCachePath(): string {
  const override = process.env.TERSIO_PRICES_FILE;
  if (override) return override;
  return tersioDataPath('prices.json', 'tersio-prices.json');
}

export function pricesUrl(): string {
  return process.env.TERSIO_PRICES_URL || LITELLM_URL;
}

export interface LivePrices {
  fetchedAt: number;
  // Compact tuples [input, output, cacheRead, cacheWrite] per LiteLLM id — the full feed caches to ~1MB instead of multi-MB objects.
  exact: Record<string, [number, number, number, number]>;
  deprecated?: string[];
}

function toPrice(t: [number, number, number, number]): ModelPrice {
  return { input: t[0], output: t[1], cacheRead: t[2], cacheWrite: t[3] };
}

// Tolerate both cache shapes (compact tuples and ModelPrice objects) so a version bump never orphans the cache.
function asPrice(v: unknown): ModelPrice | null {
  if (Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)) {
    return toPrice(v as [number, number, number, number]);
  }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (['input', 'output', 'cacheRead', 'cacheWrite'].every((k) => typeof o[k] === 'number' && Number.isFinite(o[k]) && (o[k] as number) >= 0)) {
      // SAFETY: the line above verified all four keys are finite numbers >= 0, which is the whole of ModelPrice.
      return o as unknown as ModelPrice;
    }
  }
  return null;
}

let liveCache: { path: string; mtime: number; prices: LivePrices } | null = null;

export function loadLivePrices(): LivePrices | null {
  // One stat per call beats one full parse: the recent-rows map prices thousands of rows.
  try {
    const file = pricesCachePath();
    const mtime = fs.statSync(file).mtimeMs;
    if (liveCache && liveCache.path === file && liveCache.mtime === mtime) return liveCache.prices;
    const prices = readLivePrices();
    if (prices) liveCache = { path: file, mtime, prices };
    return prices;
  } catch {
    return null;
  }
}

function readLivePrices(): LivePrices | null {
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

// Transcripts and the feed spell one model differently; aliases stop a free model reporting the default price.
export const MODEL_ALIASES: ReadonlyArray<{ id: string; feed: string }> = [
  { id: 'space-bunny', feed: 'stealth/space-bunny-alpha' },
];

export function canonicalPriceId(model: string): string {
  const key = model.toLowerCase();
  // Suffix match: gateways prefix the id (opencode/kilo/stealth/space-bunny-alpha).
  return MODEL_ALIASES.find((a) => a.id === key || a.feed === key || key.endsWith(`/${a.id}`) || key.endsWith(`/${a.feed}`))?.id ?? key;
}

export function priceFor(model: string, live?: LivePrices | null): { price: ModelPrice; known: boolean; live: boolean } {
  const table = live === undefined ? loadLivePrices() : live;
  if (live === undefined) {
    const memo = priceMemo(table);
    const hit = memo.get(model);
    if (hit) return hit;
    const resolved = resolvePrice(model, table);
    memo.set(model, resolved);
    return resolved;
  }
  return resolvePrice(model, table);
}

// Recent rows repeat a handful of models; the memo turns thousands of lookups into one per model. Cleared whenever the table identity changes.
let memoTable: LivePrices | null | undefined;
let memo = new Map<string, { price: ModelPrice; known: boolean; live: boolean }>();

function priceMemo(table: LivePrices | null): Map<string, { price: ModelPrice; known: boolean; live: boolean }> {
  if (memoTable !== table) {
    memoTable = table;
    memo = new Map();
  }
  return memo;
}

// Validated once per table instead of once per lookup.
let compiledTable: LivePrices | null = null;
let compiledEntries: Array<[string, ModelPrice]> = [];

function priceEntries(table: LivePrices): Array<[string, ModelPrice]> {
  if (compiledTable === table) return compiledEntries;
  const entries: Array<[string, ModelPrice]> = [];
  for (const [k, v] of Object.entries(table.exact)) {
    const price = asPrice(v);
    if (price) entries.push([k, price]);
  }
  compiledTable = table;
  compiledEntries = entries;
  return entries;
}

function resolvePrice(model: string, table: LivePrices | null): { price: ModelPrice; known: boolean; live: boolean } {
  // An alias goes through the same exact-then-suffix chain as any other id, so it still resolves when the feed keys it under a provider prefix.
  const id = MODEL_ALIASES.find((a) => a.id === model.toLowerCase())?.feed ?? model;
  if (table) {
    const entries = priceEntries(table);
    const lower = id.toLowerCase();
    const hit = entries.find(([k]) => k === id) ?? entries.find(([k]) => k === lower);
    if (hit) return { price: hit[1], known: true, live: true };
    // Provider-prefixed ids ("azure/gpt-4o", "dashscope/qwen-max"): match the
    // first cached key that ends with the full id, then with the bare tail
    // segment, so "codex/openai/gpt-6-luna" still finds "gpt-6-luna".
    const name = lower;
    const tail = name.split('/').pop() ?? name;
    const key = entries.find(([k]) => {
      const lk = k.toLowerCase();
      return lk === name || lk.endsWith(`/${name}`) || lk === tail || lk.endsWith(`/${tail}`);
    });
    if (key) return { price: key[1], known: true, live: true };
  }
  return { price: DEFAULT_PRICE, known: false, live: false };
}
// Fetch LiteLLM pricing and write the cache. False on any failure — callers fall back silently.
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

// Fire-and-forget refresh when the cache is stale; readers keep the stale file, so pricing never blocks.
export function refreshPricesIfStale(): void {
  const live = loadLivePrices();
  if (live && Date.now() - live.fetchedAt <= CACHE_TTL_MS) return;
  void refreshPrices().catch(() => false);
}
