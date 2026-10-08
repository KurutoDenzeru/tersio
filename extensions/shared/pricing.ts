// Per-provider price catalog, from models.dev (<https://models.dev>). Rates are keyed by provider and
// then by model, so a gateway model resolves to the provider that serves it rather than to an
// unrelated global entry. A model with no entry is unknown: it is excluded from dollar totals and
// never valued at a default rate.
import fs from 'node:fs';
import path from 'node:path';
import { tersioDataPath } from '../lib/utils.ts';
import { modelCandidates, providerOf } from './model-id.ts';

/** Per-million-token USD rates. */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * Display-only estimate for a call with no model attached. It never feeds an aggregate: every
 * aggregate consults `known` first and excludes what it cannot price.
 */
export const DEFAULT_PRICE: ModelPrice = { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 };

const MODELS_DEV_URL = 'https://models.dev/api.json';
// Readers use the file even when stale, and only one refresh runs per process; `tersio update` forces a fresh fetch.
const CACHE_TTL_MS = 7 * 24 * 3600 * 1000;
let refreshInflight: Promise<boolean> | null = null;

export function pricesCachePath(): string {
  const override = process.env.TERSIO_PRICES_FILE;
  if (override) return override;
  // A distinct filename, not prices.json: an older installed tersio still fetches LiteLLM and writes
  // its incompatible shape to prices.json. Sharing one path let the older writer silently clobber
  // this catalog, which zeroed every dollar figure. Different files cannot fight.
  return tersioDataPath('prices-modelsdev.json', 'tersio-prices-modelsdev.json');
}

/** Written into the cache so its origin is checkable rather than inferred from the shape. */
const CATALOG_FORMAT = 'models.dev';
const CATALOG_VERSION = 2;

export function pricesUrl(): string {
  return process.env.TERSIO_PRICES_URL || MODELS_DEV_URL;
}

/**
 * Compact cache shape. Tuples rather than objects keep a 226-provider catalog to a few hundred
 * kilobytes instead of several megabytes.
 */
export interface Catalog {
  fetchedAt: number;
  /** Identifies the writer, so a foreign cache is rejected instead of read as empty. */
  format?: string;
  version?: number;
  providers: Record<string, { label: string; models: Record<string, [number, number, number, number]> }>;
}

function toPrice(t: [number, number, number, number]): ModelPrice {
  return { input: t[0], output: t[1], cacheRead: t[2], cacheWrite: t[3] };
}

/** Tolerates both the compact tuples and plain objects, so a version bump never orphans the cache. */
function asPrice(v: unknown): ModelPrice | null {
  if (Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)) {
    return toPrice(v as [number, number, number, number]);
  }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (['input', 'output', 'cacheRead', 'cacheWrite'].every((k) => typeof o[k] === 'number' && Number.isFinite(o[k]) && (o[k] as number) >= 0)) {
      // SAFETY: the guard above verified all four keys are finite numbers >= 0, which is the whole of ModelPrice.
      return o as unknown as ModelPrice;
    }
  }
  return null;
}

interface Index {
  byProvider: Map<string, Map<string, ModelPrice>>;
  /** Any provider, keyed by model id. A gateway wrapping another provider's model still resolves. */
  byModel: Map<string, ModelPrice>;
}

function buildIndex(catalog: Catalog): Index {
  const byProvider = new Map<string, Map<string, ModelPrice>>();
  const byModel = new Map<string, ModelPrice>();
  for (const [providerId, entry] of Object.entries(catalog.providers)) {
    const models = new Map<string, ModelPrice>();
    for (const [modelId, raw] of Object.entries(entry.models)) {
      const price = asPrice(raw);
      if (!price) continue;
      const key = modelId.toLowerCase();
      models.set(key, price);
      if (!byModel.has(key)) byModel.set(key, price);
    }
    byProvider.set(providerId.toLowerCase(), models);
  }
  return { byProvider, byModel };
}

// One parse per catalog identity beats re-indexing a 226-provider file on every lookup.
let cachedCatalog: Catalog | null = null;
let cachedIndex: Index | null = null;

function indexOf(catalog: Catalog): Index {
  if (cachedCatalog !== catalog || cachedIndex === null) {
    cachedCatalog = catalog;
    cachedIndex = buildIndex(catalog);
  }
  return cachedIndex;
}

export function loadCatalog(): Catalog | null {
  // One stat per call beats one full parse: the recent-rows map prices thousands of rows.
  try {
    const file = pricesCachePath();
    const mtime = fs.statSync(file).mtimeMs;
    if (liveCache && liveCache.path === file && liveCache.mtime === mtime) return liveCache.catalog;
    const catalog = readCatalog();
    if (catalog) liveCache = { path: file, mtime, catalog };
    return catalog;
  } catch {
    return null;
  }
}

let liveCache: { path: string; mtime: number; catalog: Catalog } | null = null;

function readCatalog(): Catalog | null {
  let raw: string;
  try {
    raw = fs.readFileSync(pricesCachePath(), 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as { fetchedAt?: unknown; format?: unknown; providers?: unknown };
    if (typeof parsed.fetchedAt !== 'number' || !parsed.providers || typeof parsed.providers !== 'object') return null;
    // A file written by another version is not this catalog; treat it as absent rather than as empty.
    if (typeof parsed.format === 'string' && parsed.format !== CATALOG_FORMAT) return null;
    const providers: Catalog['providers'] = {};
    for (const [id, entry] of Object.entries(parsed.providers as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object') continue;
      const row = entry as { label?: unknown; models?: unknown };
      if (!row.models || typeof row.models !== 'object') continue;
      const models: Record<string, [number, number, number, number]> = {};
      for (const [modelId, value] of Object.entries(row.models as Record<string, unknown>)) {
        const price = asPrice(value);
        if (price) models[modelId] = [price.input, price.output, price.cacheRead, price.cacheWrite];
      }
      if (!Object.keys(models).length) continue;
      providers[id] = { label: typeof row.label === 'string' ? row.label : id, models };
    }
    if (!Object.keys(providers).length) return null;
    const latest: Catalog = { fetchedAt: parsed.fetchedAt, format: typeof parsed.format === 'string' ? parsed.format : undefined, providers };
    // Stale entries stay usable; refreshPricesIfStale refreshes in the background.
    return latest;
  } catch {
    return null;
  }
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

/**
 * Transcripts and the catalog spell one model differently; aliases stop a free model reporting a
 * paid price. `space-bunny` reaches the catalog only under its stealth id.
 */
export const MODEL_ALIASES: ReadonlyArray<{ id: string; feed: string }> = [
  { id: 'space-bunny', feed: 'stealth/space-bunny-alpha' },
];

export function canonicalPriceId(model: string): string {
  const key = model.toLowerCase();
  // Suffix match: gateways prefix the id (opencode/kilo/stealth/space-bunny-alpha).
  return MODEL_ALIASES.find((a) => a.id === key || a.feed === key || key.endsWith(`/${a.id}`) || key.endsWith(`/${a.feed}`))?.id ?? key;
}

function resolve(model: string, catalog: Catalog | null): { price: ModelPrice; known: boolean; live: boolean } {
  if (catalog) {
    const index = indexOf(catalog);
    // An alias goes through the same chain as any other id, so a nested gateway spelling
    // (opencode/opencode/space-bunny) still normalizes to the id the catalog actually keys.
    const alias = MODEL_ALIASES.find((a) => a.id === canonicalPriceId(model))?.feed;
    const aliased = alias ?? model;
    const keys = modelCandidates(aliased);
    const provider = providerOf(aliased);
    // Provider first: the same model id can be listed by several resellers at different rates.
    const scoped = provider ? index.byProvider.get(provider.toLowerCase()) : undefined;
    if (scoped) {
      for (const key of keys) {
        const hit = scoped.get(key);
        if (hit) return { price: hit, known: true, live: true };
      }
    }
    for (const key of keys) {
      const hit = index.byModel.get(key);
      if (hit) return { price: hit, known: true, live: true };
    }
  }
  return { price: DEFAULT_PRICE, known: false, live: false };
}

// Recent rows repeat a handful of models; the memo turns thousands of lookups into one per model.
let memoCatalog: Catalog | null | undefined;
let memo = new Map<string, { price: ModelPrice; known: boolean; live: boolean }>();

function priceMemo(catalog: Catalog | null): Map<string, { price: ModelPrice; known: boolean; live: boolean }> {
  if (memoCatalog !== catalog) {
    memoCatalog = catalog;
    memo = new Map();
  }
  return memo;
}

export function priceFor(model: string, catalog?: Catalog | null): { price: ModelPrice; known: boolean; live: boolean } {
  if (catalog !== undefined) return resolve(model, catalog);
  const table = loadCatalog();
  const memoMap = priceMemo(table);
  const hit = memoMap.get(model);
  if (hit) return hit;
  const resolved = resolve(model, table);
  memoMap.set(model, resolved);
  return resolved;
}

/** Provider id to label, for a page that names the catalog's providers. */
export function providerLabels(catalog: Catalog | null): Array<{ id: string; label: string; models: number }> {
  if (!catalog) return [];
  return Object.entries(catalog.providers)
    .map(([id, entry]) => ({ id, label: entry.label, models: Object.keys(entry.models).length }))
    .sort((a, b) => b.models - a.models);
}

/** Fetch the models.dev catalog and write the compact cache. False on any failure. */
export async function refreshPrices(): Promise<boolean> {
  if (refreshInflight) return refreshInflight;
  refreshInflight = (async () => {
    let res: Response;
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 30000);
      try {
        res = await fetch(pricesUrl(), { signal: ctl.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) return false;
    } catch {
      return false;
    }
    let data: Record<string, unknown>;
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      return false;
    }
    const providers: Catalog['providers'] = {};
    for (const [providerId, rawProvider] of Object.entries(data)) {
      if (!rawProvider || typeof rawProvider !== 'object') continue;
      const row = rawProvider as { name?: unknown; models?: unknown };
      if (!row.models || typeof row.models !== 'object') continue;
      const models: Record<string, [number, number, number, number]> = {};
      for (const [modelId, rawModel] of Object.entries(row.models as Record<string, unknown>)) {
        if (!rawModel || typeof rawModel !== 'object') continue;
        const cost = (rawModel as { cost?: Record<string, unknown> }).cost;
        if (!cost) continue;
        const input = num(cost.input);
        const output = num(cost.output);
        if (input === null || output === null) continue;
        // models.dev quotes per million tokens already, so no scaling is needed.
        models[modelId] = [input, output, num(cost.cache_read) ?? input, num(cost.cache_write) ?? input];
      }
      if (!Object.keys(models).length) continue;
      providers[providerId] = { label: typeof row.name === 'string' ? row.name : providerId, models };
    }
    if (!Object.keys(providers).length) return false;
    try {
      fs.mkdirSync(path.dirname(pricesCachePath()), { recursive: true });
      fs.writeFileSync(
        pricesCachePath(),
        JSON.stringify({ format: CATALOG_FORMAT, version: CATALOG_VERSION, fetchedAt: Date.now(), source: MODELS_DEV_URL, providers }),
        'utf8',
      );
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
  const catalog = loadCatalog();
  if (catalog && Date.now() - catalog.fetchedAt <= CACHE_TTL_MS) return;
  void refreshPrices().catch(() => false);
}
