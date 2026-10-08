// Hash routing and range math. Both are pure, so they are cheap to pin.
import { expect, test } from "vitest";

import { buildHash, parseHash, rangeForKey } from "../src/lib/route";
import {
  cutoffDay,
  mergeTokens,
  rangeView,
  rangeWindow,
  recentSeries,
  recentTotals,
  sumTokens,
  tokensOf,
  windowPartial,
} from "../src/lib/aggregate";
import { report } from "./fixtures";
import type { UsageReport } from "../src/lib/data";

test("a bare hash falls back to the default route", () => {
  expect(parseHash("")).toEqual({ page: "overview", range: "24h", session: null });
  expect(parseHash("#")).toEqual({ page: "overview", range: "24h", session: null });
});

test("a full hash round-trips", () => {
  const hash = buildHash("costs", "90d");
  expect(hash).toBe("#/costs?range=90d");
  expect(parseHash(hash)).toEqual({ page: "costs", range: "90d", session: null });
});

test("the session param round-trips and leaves the range alone", () => {
  const hash = buildHash("traces", "7d", "/sessions/a b.jsonl");
  expect(hash).toBe("#/traces?range=7d&session=%2Fsessions%2Fa+b.jsonl");
  expect(parseHash(hash)).toEqual({ page: "traces", range: "7d", session: "/sessions/a b.jsonl" });
  // No session selected is null, not an empty string, so a caller can tell "cleared" from "kept".
  expect(parseHash("#/traces?range=all").session).toBe(null);
  // A path carrying ? or # would truncate the hash, so the value is encoded.
  expect(parseHash(buildHash("traces", "all", "/sessions/a?b#c.jsonl")).session).toBe("/sessions/a?b#c.jsonl");
});

test("an unknown page or range falls back rather than rendering nothing", () => {
  expect(parseHash("#/nope?range=all")).toEqual({ page: "nope", range: "all", session: null });
  expect(parseHash("#/costs?range=forever")).toEqual({ page: "costs", range: "24h", session: null });
  // A page id must stay URL-safe, so anything else is not treated as one.
  expect(parseHash("#/../etc?range=all").page).toBe("overview");
});

test("number keys pick a range, like OMP", () => {
  expect(rangeForKey("1")).toBe("1h");
  expect(rangeForKey("2")).toBe("24h");
  expect(rangeForKey("3")).toBe("7d");
  expect(rangeForKey("4")).toBe("30d");
  expect(rangeForKey("5")).toBe("90d");
  expect(rangeForKey("6")).toBe("all");
  expect(rangeForKey("0")).toBeNull();
  expect(rangeForKey("7")).toBeNull();
  expect(rangeForKey("9")).toBeNull();
  expect(rangeForKey("g")).toBeNull();
});

test("cutoffDay counts the window inclusively and all time is unbounded", () => {
  const now = new Date("2026-09-30T12:00:00");
  expect(cutoffDay("7d", now)).toBe("2026-09-24");
  expect(cutoffDay("30d", now)).toBe("2026-09-01");
  expect(cutoffDay("90d", now)).toBe("2026-07-03");
  expect(cutoffDay("all", now)).toBeNull();
  // A short range reads recent rows, so it has no day cutoff to slice a day table with.
  expect(cutoffDay("1h", now)).toBeNull();
  expect(cutoffDay("24h", now)).toBeNull();
});

test("range filtering drops days before the cutoff and keeps the boundary", () => {
  const byDay = {
    "2026-09-20": { input: 10, output: 1, cacheRead: 0, cacheWrite: 0 },
    "2026-09-24": { input: 20, output: 2, cacheRead: 0, cacheWrite: 0 },
    "2026-09-30": { input: 30, output: 3, cacheRead: 0, cacheWrite: 0 },
  };
  expect(tokensOf(sumTokens(byDay, null))).toBe(66);
  // The cutoff day itself is inside the window, so 09-24 and 09-30 remain.
  expect(tokensOf(sumTokens(byDay, "2026-09-24"))).toBe(55);
});

test("mergeTokens folds per-day nested tables into one entry per key", () => {
  const perDay = {
    "2026-09-24": {
      a: { input: 10, output: 0, cacheRead: 0, cacheWrite: 0 },
      b: { input: 5, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    "2026-09-30": { a: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 } },
  };
  const merged = mergeTokens(perDay, "2026-09-24");
  expect(merged.map(([key]) => key)).toEqual(["a", "b"]);
  expect(tokensOf(merged[0][1])).toBe(11);
  // An older day is excluded entirely.
  expect(mergeTokens(perDay, "2026-09-30").map(([key]) => key)).toEqual(["a"]);
});

type Row = UsageReport["recent"][number];

const HOUR = 3_600_000;
const NOW = Date.parse("2026-10-08T12:30:00Z");

// The day tables are deliberately huge: a short range must never read them.
function shortData(recent: Row[]): UsageReport {
  return report({
    byDay: { "2026-10-08": { input: 9_000_000, output: 0, cacheRead: 0, cacheWrite: 0 } },
    byDayApiUsd: { "2026-10-08": 999 },
    recent,
    modelLabels: { m1: "Model One" },
    modelRates: {
      "Model One": { provider: "acme", known: true, input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
    },
  });
}

test("rangeWindow gives the short ranges an exact span and the day ranges none", () => {
  expect(rangeWindow("1h", NOW)).toEqual({ since: NOW - HOUR });
  expect(rangeWindow("24h", NOW)).toEqual({ since: NOW - 24 * HOUR });
  expect(rangeWindow("7d", NOW)).toEqual({ since: null });
  expect(rangeWindow("all", NOW)).toEqual({ since: null });
});

test("recentSeries buckets the window and keeps the empty buckets", () => {
  const since = NOW - HOUR;
  const rows: Row[] = [
    { m: "m1", i: 10, o: 2, t: NOW - 10 * 60_000, st: "completed", est: 0.5, cr: 4 },
    { m: "m1", i: 5, o: 1, t: NOW - 10 * 60_000 + 1000, st: "error", est: 0.25 },
  ];
  const series = recentSeries(shortData(rows), rows, since, HOUR, 300_000);
  expect(series).toHaveLength(12);
  const keys = series.map((bucket) => bucket.day);
  expect(keys).toEqual(keys.toSorted());
  expect(series.reduce((n, bucket) => n + bucket.requests, 0)).toBe(2);
  expect(series.reduce((n, bucket) => n + bucket.errors, 0)).toBe(1);
  expect(series.reduce((n, bucket) => n + tokensOf(bucket.tokens), 0)).toBe(22);
  expect(series.reduce((n, bucket) => n + bucket.api, 0)).toBeCloseTo(0.75);
});

test("recentTotals folds the window, and the partial flag is honest about the cap", () => {
  const rows: Row[] = [
    { m: "m1", i: 10, o: 2, t: NOW - 1000, st: "completed", est: 1, cr: 30 },
    { m: "m1", i: 5, o: 1, t: NOW - 2000, st: "aborted", est: 0 },
  ];
  const totals = recentTotals(rows, false);
  expect(totals.runs).toBe(2);
  expect(totals.aborted).toBe(1);
  expect(totals.cacheHitPct).toBeCloseTo((30 / 45) * 100);

  const many: Row[] = Array.from({ length: 2000 }, (_, i) => ({
    m: "m1",
    i: 1,
    o: 0,
    t: NOW - i * 1000,
    st: "completed",
    est: 0,
  }));
  // The cap is hit and the list holds no row older than the window start, so rows are missing.
  expect(windowPartial(many, many)).toBe(true);
  // No cap, so the window is complete whatever it holds.
  expect(windowPartial(many.slice(0, 10), many.slice(0, 10))).toBe(false);
  // A full list with a row older than the window proves the window itself is complete.
  expect(windowPartial(many, many.slice(1))).toBe(false);
});

test("a short range reads recent rows, never the day tables", () => {
  const rows: Row[] = [{ m: "m1", i: 10, o: 2, t: NOW - 60_000, st: "completed", est: 0.3, cr: 10 }];
  const data = shortData(rows);
  const view = rangeView(data, "1h", null, NOW - HOUR);
  expect(view.short).toBe(true);
  expect(view.cutoff).toBeNull();
  expect(tokensOf(view.totals().tokens)).toBe(22);
  expect(view.totals().runs).toBe(1);
  // The bucket tables come from the rows, not from the payload's 9M-token day.
  expect(Object.keys(view.data.byDay)).toHaveLength(12);
  expect(view.requests()).toHaveLength(1);
  // A day range still reads the payload's tables.
  const day = rangeView(data, "7d", cutoffDay("7d", new Date(NOW)), null);
  expect(day.short).toBe(false);
  expect(tokensOf(day.totals().tokens)).toBe(9_000_000);
});

test("a 24h range carries one bucket per hour", () => {
  const rows: Row[] = [{ m: "m1", i: 1, o: 1, t: NOW - 30_000, st: "completed", est: 0 }];
  const view = rangeView(shortData(rows), "24h", null, NOW - 24 * HOUR);
  expect(Object.keys(view.data.byDay)).toHaveLength(24);
  expect(tokensOf(view.totals().tokens)).toBe(2);
});
