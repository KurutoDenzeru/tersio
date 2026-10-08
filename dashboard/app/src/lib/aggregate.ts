// Range-aware aggregation. The server sends per-day tables; every page recomputes its own numbers
// for the selected range from them, so one payload serves every range.
//
// A day table cannot be sliced inside a UTC day, so the short ranges (1h, 24h) do not read them at
// all: they filter `recent` by exact timestamp and bucket it themselves. `rangeView` hands a page
// the same table shapes from whichever source the range requires, so a page needs no branch.
import type { TokenBreakdown } from "./format";
import type { UsageReport } from "./data";
import type { RangeId } from "./route";

/** The payload caps `recent`, so a range-filtered run count can be a lower bound. */
export const RECENT_CAP = 2000;

/** Exact-window spans. A range absent here reads the day tables instead. */
const WINDOW_SPAN_MS: Partial<Record<RangeId, number>> = { "1h": 3_600_000, "24h": 86_400_000 };

/** Bucket width inside a short window: 5 minutes within the hour, 1 hour within the day. */
const WINDOW_BUCKET_MS: Partial<Record<RangeId, number>> = { "1h": 300_000, "24h": 3_600_000 };

export function tokensOf(b: TokenBreakdown): number {
  return b.input + b.output + b.cacheRead + b.cacheWrite;
}

export function zeroTokens(): TokenBreakdown {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

export function addTokens(into: TokenBreakdown, b: TokenBreakdown): void {
  into.input += b.input;
  into.output += b.output;
  into.cacheRead += b.cacheRead;
  into.cacheWrite += b.cacheWrite;
}

/** Two-digit clock/calendar field, shared by the day and bucket keys. */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function dayKeyOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * The earliest day inside the range, or null for all time. Day keys are YYYY-MM-DD, so they compare
 * as strings and no date parsing is needed per row. A short range reads recent rows, not day tables,
 * so it has no day cutoff either.
 */
export function cutoffDay(range: RangeId, now: Date = new Date()): string | null {
  if (range === "all" || WINDOW_SPAN_MS[range] !== undefined) return null;
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return dayKeyOf(d.getTime());
}

export function inRange(day: string, cutoff: string | null): boolean {
  return cutoff === null || day >= cutoff;
}

/** Sums a per-day token table, optionally limited to the range. */
export function sumTokens(byDay: Record<string, TokenBreakdown>, cutoff: string | null): TokenBreakdown {
  const out = zeroTokens();
  for (const [day, b] of Object.entries(byDay)) if (inRange(day, cutoff)) addTokens(out, b);
  return out;
}

export function sumNumbers(byDay: Record<string, number>, cutoff: string | null): number {
  let out = 0;
  for (const [day, v] of Object.entries(byDay)) if (inRange(day, cutoff)) out += v;
  return out;
}

/** Folds a per-day nested token table into one entry per key, biggest first. */
export function mergeTokens(
  perDay: Record<string, Record<string, TokenBreakdown>>,
  cutoff: string | null,
): Array<[string, TokenBreakdown]> {
  const totals: Record<string, TokenBreakdown> = {};
  for (const [day, per] of Object.entries(perDay)) {
    if (!inRange(day, cutoff)) continue;
    for (const [key, value] of Object.entries(per)) {
      totals[key] ??= zeroTokens();
      addTokens(totals[key], value);
    }
  }
  return Object.entries(totals).sort((a, b) => tokensOf(b[1]) - tokensOf(a[1]));
}

/** Folds a per-day nested count table into one entry per key, biggest first. */
export function mergeCounts(
  perDay: Record<string, Record<string, number>>,
  cutoff: string | null,
): Array<[string, number]> {
  const totals: Record<string, number> = {};
  for (const [day, per] of Object.entries(perDay)) {
    if (!inRange(day, cutoff)) continue;
    for (const [key, n] of Object.entries(per)) totals[key] = (totals[key] ?? 0) + n;
  }
  return Object.entries(totals).sort((a, b) => b[1] - a[1]);
}

export function byProvider(perDay: UsageReport["byDayProvider"], cutoff: string | null): Array<[string, TokenBreakdown]> {
  return mergeTokens(perDay, cutoff);
}

export function byProject(perDay: UsageReport["byDayProject"], cutoff: string | null): Array<[string, TokenBreakdown]> {
  return mergeTokens(perDay, cutoff);
}

export function byModel(perDay: UsageReport["byDayModelTokens"], cutoff: string | null): Array<[string, TokenBreakdown]> {
  return mergeTokens(perDay, cutoff);
}

/**
 * Models folded onto their display label. Two gateway keys can name one model, and a chart that
 * showed them separately would disagree with every other page.
 */
export function byModelLabeled(
  perDay: UsageReport["byDayModelTokens"],
  cutoff: string | null,
  labels: Record<string, string>,
): Array<[string, TokenBreakdown]> {
  const totals: Record<string, TokenBreakdown> = {};
  for (const [day, per] of Object.entries(perDay)) {
    if (!inRange(day, cutoff)) continue;
    for (const [key, value] of Object.entries(per)) {
      const label = labels[key] ?? key;
      totals[label] ??= zeroTokens();
      addTokens(totals[label], value);
    }
  }
  return Object.entries(totals).sort((a, b) => tokensOf(b[1]) - tokensOf(a[1]));
}

/** Mean of a running sum, or null when nothing recorded one. Null is N/A, never zero. */
export function meanOf(stat: { ms: number; n: number } | undefined): number | null {
  return stat && stat.n > 0 ? stat.ms / stat.n : null;
}

/** Mean of a value picked from rows, or null when no row carried one. Null is N/A, never zero. */
export function meanValue<T>(rows: T[], pick: (row: T) => number | undefined): number | null {
  const values = rows.map(pick).filter((v): v is number => v !== undefined);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** Median of a value picked from rows, averaging the two middles for an even count. Null when none. */
export function medianValue<T>(rows: T[], pick: (row: T) => number | undefined): number | null {
  const values = rows.map(pick).filter((v): v is number => v !== undefined).sort((a, b) => a - b);
  if (!values.length) return null;
  const mid = values.length >> 1;
  return values.length % 2 === 1 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

/** Per-model USD inside the range, folded onto the same display labels. */
export function modelUsd(
  perDay: UsageReport["byDayModelUsd"],
  cutoff: string | null,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const [day, per] of Object.entries(perDay)) {
    if (!inRange(day, cutoff)) continue;
    for (const [label, usd] of Object.entries(per)) totals.set(label, (totals.get(label) ?? 0) + usd);
  }
  return totals;
}

export function countBy(perDay: Record<string, Record<string, number>>, cutoff: string | null): Array<[string, number]> {
  return mergeCounts(perDay, cutoff);
}

export interface SeriesDay {
  day: string;
  tokens: number;
  requests: number;
  /** Runs that did not complete, the same rule as `byDayErrors`. */
  errors: number;
  /** Vendor-reported cost, the same figures the Measured strip sums. */
  cost: number;
  /** API-equivalent cost, priced models only. */
  api: number;
}

/**
 * The daily series for a chart, oldest first. It reads the same table shapes whether the range is a
 * day range or a short bucket range, so the chart needs no branch. Requests sum the per-day runs
 * table; a bucket with no runs reports zero rather than being dropped.
 */
export function dailySeries(data: UsageReport, cutoff: string | null): SeriesDay[] {
  return Object.keys(data.byDay)
    .filter((day) => inRange(day, cutoff))
    .sort()
    .map((day) => ({
      day,
      tokens: tokensOf(data.byDay[day]),
      requests: Object.values(data.byDayModelRuns[day] ?? {}).reduce((n, v) => n + v, 0),
      errors: Object.values(data.byDayErrors[day] ?? {}).reduce((n, v) => n + v, 0),
      cost: data.byDayCost[day] ?? 0,
      api: data.byDayApiUsd[day] ?? 0,
    }));
}

/** Recent requests inside the range. The payload holds the newest 2000 rows, so this is a subset. */
export function requestsInRange(recent: UsageReport["recent"], cutoff: string | null): UsageReport["recent"] {
  if (cutoff === null) return recent;
  return recent.filter((r) => dayKeyOf(r.t) >= cutoff);
}

export interface Totals {
  tokens: TokenBreakdown;
  runs: number;
  errors: number;
  aborted: number;
  cacheHitPct: number;
  completionPct: number;
  /** True when the run counts came from the capped recent list and therefore undercount. */
  countsPartial: boolean;
}

/**
 * All time reads the exact stored totals. A range reads the recent rows, because runs are not stored
 * per day; that list is capped, so the result says so rather than presenting a floor as a total.
 */
export function totalsFor(data: UsageReport, cutoff: string | null): Totals {
  const tokens = sumTokens(data.byDay, cutoff);
  const cacheBase = tokens.input + tokens.cacheRead;
  const cacheHitPct = cacheBase > 0 ? (tokens.cacheRead / cacheBase) * 100 : 0;

  if (cutoff === null) {
    const errors = data.errors.error ?? 0;
    const aborted = data.errors.aborted ?? 0;
    return {
      tokens,
      runs: data.messages,
      errors,
      aborted,
      cacheHitPct,
      completionPct: data.messages > 0 ? ((data.messages - errors - aborted) / data.messages) * 100 : 0,
      countsPartial: false,
    };
  }

  const rows = requestsInRange(data.recent, cutoff);
  const errors = rows.filter((r) => r.st === "error").length;
  const aborted = rows.filter((r) => r.st === "aborted").length;
  return {
    tokens,
    runs: rows.length,
    errors,
    aborted,
    cacheHitPct,
    completionPct: rows.length > 0 ? ((rows.length - errors - aborted) / rows.length) * 100 : 0,
    countsPartial: rows.length >= RECENT_CAP,
  };
}

export interface RangeWindow {
  /** Window start for a short range, or null when the range reads the day tables. */
  since: number | null;
}

/**
 * The exact window a range covers. `now` is passed in rather than read here so one render computes
 * one window instead of one window per call.
 */
export function rangeWindow(range: RangeId, now: number = Date.now()): RangeWindow {
  const span = WINDOW_SPAN_MS[range];
  return { since: span === undefined ? null : now - span };
}

/** Bucket key `YYYY-MM-DDTHH:MM`, local: it sorts as a string and reads as one axis label. */
function bucketKeyOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

interface Buckets {
  keys: string[];
  start: number;
  width: number;
  count: number;
}

/** Every bucket the window covers, oldest first, aligned to the boundary below the window start. */
function windowBuckets(since: number, span: number, width: number): Buckets {
  const start = Math.floor(since / width) * width;
  const count = Math.floor(span / width);
  return { keys: Array.from({ length: count }, (_, i) => bucketKeyOf(start + i * width)), start, width, count };
}

function bucketIndexOf(buckets: Buckets, t: number): number {
  const index = Math.floor((t - buckets.start) / buckets.width);
  return Math.min(Math.max(index, 0), buckets.count - 1);
}

/** Cache savings for one row: its read tokens priced at the model's uncached input rate. */
function cacheSaved(data: UsageReport, row: UsageReport["recent"][number]): number {
  const rate = data.modelRates[data.modelLabels[row.m] ?? row.m];
  return rate?.known ? ((row.cr ?? 0) / 1e6) * rate.input : 0;
}

export interface WindowBucket {
  /** Bucket key, `YYYY-MM-DDTHH:MM`. */
  day: string;
  tokens: TokenBreakdown;
  requests: number;
  /** Runs that did not complete, the same rule as `byDayErrors`. */
  errors: number;
  /** API-equivalent cost, priced models only. */
  api: number;
  /** Vendor-reported cost, the same rule as `byDayCost`. */
  measured: number;
  /** Cache savings estimate, priced models only. */
  saved: number;
}

/**
 * Bucketed series from recent rows. Every bucket the window covers is present, empty ones included,
 * so a chart spans the range rather than only the buckets that happened to record a run.
 */
export function recentSeries(
  data: UsageReport,
  rows: UsageReport["recent"],
  since: number,
  span: number,
  width: number,
): WindowBucket[] {
  const buckets = windowBuckets(since, span, width);
  const series = buckets.keys.map((day) => ({
    day,
    tokens: zeroTokens(),
    requests: 0,
    errors: 0,
    api: 0,
    measured: 0,
    saved: 0,
  }));
  for (const row of rows) {
    const point = series[bucketIndexOf(buckets, row.t)];
    point.tokens.input += row.i;
    point.tokens.output += row.o;
    point.tokens.cacheRead += row.cr ?? 0;
    point.tokens.cacheWrite += row.cw ?? 0;
    point.requests += 1;
    if (row.st !== "completed") point.errors += 1;
    point.api += row.est;
    point.measured += row.usd ?? 0;
    point.saved += cacheSaved(data, row);
  }
  return series;
}

/** The per-bucket tables a short window needs, in the same shapes the payload's day tables use. */
export interface WindowTables {
  byDay: Record<string, TokenBreakdown>;
  byDayModelTokens: Record<string, Record<string, TokenBreakdown>>;
  byDayModelRuns: Record<string, Record<string, number>>;
  byDayModelErrors: Record<string, Record<string, number>>;
  byDayProvider: Record<string, Record<string, TokenBreakdown>>;
  byDayProject: Record<string, Record<string, TokenBreakdown>>;
  byDayErrors: Record<string, Record<string, number>>;
  byDayTool: Record<string, Record<string, number>>;
  byDayCost: Record<string, number>;
  byDayApiUsd: Record<string, number>;
  byDaySavedUsd: Record<string, number>;
  byDayModelUsd: Record<string, Record<string, number>>;
}

/**
 * Folds recent rows into bucket-keyed tables. A recent row carries no working directory, so
 * `byDayProject` stays empty and the page that reads it says so rather than showing zeroes.
 */
export function recentTables(
  data: UsageReport,
  rows: UsageReport["recent"],
  since: number,
  span: number,
  width: number,
): WindowTables {
  const buckets = windowBuckets(since, span, width);
  const tables: WindowTables = {
    byDay: {},
    byDayModelTokens: {},
    byDayModelRuns: {},
    byDayModelErrors: {},
    byDayProvider: {},
    byDayProject: {},
    byDayErrors: {},
    byDayTool: {},
    byDayCost: {},
    byDayApiUsd: {},
    byDaySavedUsd: {},
    byDayModelUsd: {},
  };
  for (const point of recentSeries(data, rows, since, span, width)) {
    tables.byDay[point.day] = point.tokens;
    tables.byDayCost[point.day] = point.measured;
    tables.byDayApiUsd[point.day] = point.api;
    tables.byDaySavedUsd[point.day] = point.saved;
  }
  for (const row of rows) {
    const key = buckets.keys[bucketIndexOf(buckets, row.t)];
    const label = data.modelLabels[row.m] ?? row.m;
    const tokens: TokenBreakdown = { input: row.i, output: row.o, cacheRead: row.cr ?? 0, cacheWrite: row.cw ?? 0 };

    const modelTokens = (tables.byDayModelTokens[key] ??= {});
    modelTokens[label] ??= zeroTokens();
    addTokens(modelTokens[label], tokens);

    const runs = (tables.byDayModelRuns[key] ??= {});
    runs[label] = (runs[label] ?? 0) + 1;

    const usd = (tables.byDayModelUsd[key] ??= {});
    usd[label] = (usd[label] ?? 0) + row.est;

    if (row.st !== "completed") {
      const errors = (tables.byDayErrors[key] ??= {});
      errors[row.st] = (errors[row.st] ?? 0) + 1;
      const modelErrors = (tables.byDayModelErrors[key] ??= {});
      modelErrors[label] = (modelErrors[label] ?? 0) + 1;
    }

    for (const name of row.tools ?? []) {
      const tools = (tables.byDayTool[key] ??= {});
      tools[name] = (tools[name] ?? 0) + 1;
    }

    const provider = providerOfLabel(data, label);
    const providerTokens = (tables.byDayProvider[key] ??= {});
    providerTokens[provider] ??= zeroTokens();
    addTokens(providerTokens[provider], tokens);
  }
  return tables;
}

/**
 * Totals for a short window, folded from recent rows. `partial` is true when the payload's cap cut
 * the window short, so every count here is a lower bound.
 */
export function recentTotals(rows: UsageReport["recent"], partial: boolean): Totals {
  const tokens = zeroTokens();
  let errors = 0;
  let aborted = 0;
  for (const row of rows) {
    tokens.input += row.i;
    tokens.output += row.o;
    tokens.cacheRead += row.cr ?? 0;
    tokens.cacheWrite += row.cw ?? 0;
    if (row.st === "error") errors += 1;
    else if (row.st === "aborted") aborted += 1;
  }
  const cacheBase = tokens.input + tokens.cacheRead;
  return {
    tokens,
    runs: rows.length,
    errors,
    aborted,
    cacheHitPct: cacheBase > 0 ? (tokens.cacheRead / cacheBase) * 100 : 0,
    completionPct: rows.length > 0 ? ((rows.length - errors - aborted) / rows.length) * 100 : 0,
    countsPartial: partial,
  };
}

/**
 * True when the cap cut the window short: the payload holds its newest rows only, so a window is
 * truncated exactly when the list is full and every row in it falls inside that window. A single row
 * older than the window start proves the list reaches past the window and covers it completely.
 */
export function windowPartial(recent: UsageReport["recent"], rows: UsageReport["recent"]): boolean {
  return recent.length >= RECENT_CAP && rows.length === recent.length;
}

export interface RangeView {
  /** True for 1h/24h, where every number comes from recent rows rather than the day tables. */
  short: boolean;
  /** True only for all time, where the stored totals are exact. */
  allTime: boolean;
  /** Window start for a short range, null otherwise. */
  since: number | null;
  /** Tables scoped to the range: the payload's own for day ranges, bucket-keyed for short ones. */
  data: UsageReport;
  /** Day cutoff for `data`'s tables; null when they are already scoped to the range. */
  cutoff: string | null;
  /** True when the capped recent list truncated the range, so counts are lower bounds. */
  partial: boolean;
  totals(): Totals;
  requests(): UsageReport["recent"];
}

/**
 * The one place a page learns where its numbers come from. A day range reads the payload's tables; a
 * short range reads recent rows filtered by exact timestamp, in the same table shapes, so the page
 * itself needs no range branch.
 */
export function rangeView(
  data: UsageReport,
  range: RangeId,
  cutoff: string | null,
  since: number | null,
): RangeView {
  const span = WINDOW_SPAN_MS[range];
  // A short range always reads recent rows; deriving the window here keeps a missing `since` from
  // silently falling through to the day tables.
  const start = span === undefined ? null : (since ?? rangeWindow(range).since);
  if (span === undefined || start === null) {
    return {
      short: false,
      allTime: cutoff === null,
      since: null,
      data,
      cutoff,
      partial: false,
      totals: () => totalsFor(data, cutoff),
      requests: () => requestsInRange(data.recent, cutoff),
    };
  }
  const width = WINDOW_BUCKET_MS[range] ?? span;
  const rows = data.recent.filter((row) => row.t >= start);
  const partial = windowPartial(data.recent, rows);
  return {
    short: true,
    allTime: false,
    since: start,
    data: { ...data, ...recentTables(data, rows, start, span, width), recent: rows },
    cutoff: null,
    partial,
    totals: () => recentTotals(rows, partial),
    requests: () => rows,
  };
}

export interface ProviderStat {
  provider: string;
  requests: number;
  failed: number;
  /** Distinct display labels the provider served, biggest token total first. */
  modelTokens: Array<[string, number]>;
  tokens: TokenBreakdown;
  /** API-equivalent cost over the range, priced models only; null when none of them was priced. */
  cost: number | null;
  /** Output tokens per second over the rows that recorded a duration; null when none did. */
  tokensPerSecond: number | null;
}

/** The provider a model resolves to: its catalog entry, or "unknown" when no entry names one. */
function providerOfLabel(data: UsageReport, label: string): string {
  return data.modelRates[label]?.provider ?? "unknown";
}

/** Local start of a bucket key. A key with no clock is a whole day. */
function bucketStartOf(bucket: string): number {
  return Date.parse(bucket.includes("T") ? bucket : `${bucket}T00:00:00`);
}

interface ProviderAcc {
  requests: number;
  failed: number;
  tokens: TokenBreakdown;
  cost: number;
  priced: boolean;
  models: Map<string, number>;
  /** Duration and output of the recent rows that recorded one, which is what the rate is a mean of. */
  ms: number;
  out: number;
}

/**
 * Per-provider totals for the range. Tokens, requests, failures, models, and cost all come from the
 * payload's per-model tables, resolved through the one provider rule this page uses; only duration
 * lives on a row, so the rate is a mean over the rows that recorded one.
 */
export function providerStats(view: RangeView): ProviderStat[] {
  const data = view.data;
  const acc = new Map<string, ProviderAcc>();
  const entry = (provider: string): ProviderAcc => {
    let found = acc.get(provider);
    if (!found) {
      found = { requests: 0, failed: 0, tokens: zeroTokens(), cost: 0, priced: false, models: new Map(), ms: 0, out: 0 };
      acc.set(provider, found);
    }
    return found;
  };

  for (const [bucket, per] of Object.entries(data.byDayModelTokens)) {
    if (!inRange(bucket, view.cutoff)) continue;
    for (const [key, tokens] of Object.entries(per)) {
      const label = data.modelLabels[key] ?? key;
      const found = entry(providerOfLabel(data, label));
      addTokens(found.tokens, tokens);
      found.models.set(label, (found.models.get(label) ?? 0) + tokensOf(tokens));
    }
  }
  for (const [bucket, per] of Object.entries(data.byDayModelRuns)) {
    if (!inRange(bucket, view.cutoff)) continue;
    for (const [key, n] of Object.entries(per)) {
      entry(providerOfLabel(data, data.modelLabels[key] ?? key)).requests += n;
    }
  }
  for (const [bucket, per] of Object.entries(data.byDayModelErrors)) {
    if (!inRange(bucket, view.cutoff)) continue;
    for (const [key, n] of Object.entries(per)) entry(providerOfLabel(data, data.modelLabels[key] ?? key)).failed += n;
  }
  for (const [bucket, per] of Object.entries(data.byDayModelUsd)) {
    if (!inRange(bucket, view.cutoff)) continue;
    for (const [label, usd] of Object.entries(per)) {
      const found = entry(providerOfLabel(data, label));
      found.cost += usd;
      if (data.modelRates[label]?.known) found.priced = true;
    }
  }
  for (const row of view.requests()) {
    if (row.d === undefined || row.d <= 0) continue;
    const found = entry(providerOfLabel(data, data.modelLabels[row.m] ?? row.m));
    found.ms += row.d;
    found.out += row.o;
  }

  return [...acc]
    .map(([provider, found]) => ({
      provider,
      requests: found.requests,
      failed: found.failed,
      modelTokens: [...found.models].sort((a, b) => b[1] - a[1]),
      tokens: found.tokens,
      cost: found.priced ? found.cost : null,
      tokensPerSecond: found.ms > 0 ? found.out / (found.ms / 1000) : null,
    }))
    .sort((a, b) => tokensOf(b.tokens) - tokensOf(a.tokens));
}

export interface ProviderSeries {
  /** Bucket key: `YYYY-MM-DDTHH:MM` for a short range, `YYYY-MM-DD` for a day range. */
  bucket: string;
  /** Bucket start in ms, so a caller can order the axis without parsing the key. */
  start: number;
  label: string;
  tokens: number;
  requests: number;
  /** API-equivalent cost in this bucket, priced models only. */
  cost: number;
}

/**
 * One point per provider per bucket, read from the payload's per-model tables so a day range reports
 * its exact stored days rather than the capped recent list. A bucket a provider did not serve is
 * left out.
 */
export function providerSeries(view: RangeView): ProviderSeries[] {
  const data = view.data;
  const points = new Map<string, ProviderSeries>();
  const point = (bucket: string, label: string): ProviderSeries => {
    const key = `${bucket}\u0000${label}`;
    let found = points.get(key);
    if (!found) {
      found = { bucket, start: bucketStartOf(bucket), label, tokens: 0, requests: 0, cost: 0 };
      points.set(key, found);
    }
    return found;
  };

  for (const [bucket, per] of Object.entries(data.byDayModelTokens)) {
    if (!inRange(bucket, view.cutoff)) continue;
    for (const [key, tokens] of Object.entries(per)) {
      point(bucket, providerOfLabel(data, data.modelLabels[key] ?? key)).tokens += tokensOf(tokens);
    }
  }
  for (const [bucket, per] of Object.entries(data.byDayModelRuns)) {
    if (!inRange(bucket, view.cutoff)) continue;
    for (const [key, n] of Object.entries(per)) {
      point(bucket, providerOfLabel(data, data.modelLabels[key] ?? key)).requests += n;
    }
  }
  for (const [bucket, per] of Object.entries(data.byDayModelUsd)) {
    if (!inRange(bucket, view.cutoff)) continue;
    for (const [label, usd] of Object.entries(per)) point(bucket, providerOfLabel(data, label)).cost += usd;
  }

  return [...points.values()].sort((a, b) => a.start - b.start || a.label.localeCompare(b.label));
}

export interface ProviderHourRow {
  /** Local hour of day, 0-23. */
  hour: number;
  label: string;
  tokens: number;
}

/**
 * Tokens per local hour of day per provider. Hour of day is not stored per day, so this folds recent
 * rows and is a lower bound once the payload's cap bites. Only hours with tokens are returned.
 */
export function providerHourHistogram(view: RangeView): ProviderHourRow[] {
  const rows = new Map<string, ProviderHourRow>();
  for (const row of view.requests()) {
    const label = providerOfLabel(view.data, view.data.modelLabels[row.m] ?? row.m);
    const hour = new Date(row.t).getHours();
    const key = `${hour}\u0000${label}`;
    let found = rows.get(key);
    if (!found) {
      found = { hour, label, tokens: 0 };
      rows.set(key, found);
    }
    found.tokens += row.i + row.o + (row.cr ?? 0) + (row.cw ?? 0);
  }
  return [...rows.values()].sort((a, b) => a.hour - b.hour || b.tokens - a.tokens);
}
