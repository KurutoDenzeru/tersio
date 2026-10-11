// The share card's activity graph. Same shape rules as a GitHub contribution graph: one cell per
// weekday, a week per column, and five tint levels off the busiest day.
import { expect, test } from "vitest";

import { GRAPH_WEEKS, graphOf, stripOf } from "../../dashboard/app/src/lib/graph.ts";
import type { AgentStats } from "../../dashboard/app/src/lib/data.ts";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

function stats(range: AgentStats["range"], bucketMs: number, buckets: Array<[number, number]>): AgentStats {
  return {
    range,
    bucketMs,
    cutoff: 0,
    series: buckets.map(([ts, tokens]) => ({ ts, requests: 1, errors: 0, tokens, costUsd: 0 })),
  } as unknown as AgentStats;
}

test("a day bucket becomes one cell per weekday, Sunday first", () => {
  // Four days from a Sunday: 2026-03-01 is a Sunday, so the grid has one column of four cells.
  const start = Date.UTC(2026, 2, 1);
  const cells = graphOf(stats("7d", DAY_MS, [[0, 0], [start, 10], [start + DAY_MS, 20], [start + 2 * DAY_MS, 30], [start + 3 * DAY_MS, 40]]));
  expect(cells).toHaveLength(4);
  // Rows are weekdays, so Sunday is day 0 and the following Monday is row 1.
  expect(cells.map((c) => c.day)).toEqual([0, 1, 2, 3]);
  expect(cells.every((c) => c.week === 0)).toBe(true);
  expect(cells.map((c) => c.tokens)).toEqual([10, 20, 30, 40]);
});

test("an empty bucket keeps a cell at level zero, and the busiest day is level four", () => {
  const start = Date.UTC(2026, 2, 1);
  const cells = graphOf(stats("30d", DAY_MS, [
    [start, 100],
    [start + DAY_MS, 0],
    [start + 2 * DAY_MS, 50],
    [start + 3 * DAY_MS, 10],
    [start + 4 * DAY_MS, 25],
  ]));
  expect(cells.map((c) => c.level)).toEqual([4, 0, 2, 1, 1]);
  expect(cells.map((c) => c.label)).toEqual(["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05"]);
});

test("buckets shorter than a day fold into their UTC day", () => {
  // 24 hours of hourly buckets, one day: the graph is one column of seven rows, not 24 cells.
  const start = Date.UTC(2026, 2, 1);
  const buckets: Array<[number, number]> = [];
  for (let hour = 0; hour < 24; hour += 1) buckets.push([start + hour * HOUR_MS, 5]);
  const cells = graphOf(stats("24h", HOUR_MS, buckets));
  expect(cells).toHaveLength(1);
  expect(cells[0].tokens).toBe(120);
  expect(cells[0].day).toBe(0);
  // The same day at 5 minute buckets folds the same way.
  const fiveMin = graphOf(stats("1h", 300_000, [[start + 5 * 60_000, 7], [start + 25 * 60_000, 3]]));
  expect(fiveMin).toHaveLength(1);
  expect(fiveMin[0].tokens).toBe(10);
});

test("the oldest week is the left column and the newest day the last", () => {
  const start = Date.UTC(2026, 2, 1);
  // 21 days of traffic, seeded backwards, so ingestion order is the reverse of calendar order.
  const buckets: Array<[number, number]> = [];
  for (let day = 20; day >= 0; day -= 1) buckets.push([start - day * DAY_MS, 21 - day]);
  const cells = graphOf(stats("30d", DAY_MS, buckets));
  expect(cells[0].ts).toBe(start - 20 * DAY_MS);
  expect(cells.at(-1)!.ts).toBe(start);
  // Week columns run left to right, oldest first, whatever order the buckets arrived in.
  expect(cells[0].week).toBe(0);
  expect(cells.map((c) => c.week).toSorted((a, b) => a - b)).toEqual(cells.map((c) => c.week));
  // The level scale is taken from the newest and busiest day, which is the right-hand column.
  expect(cells.at(-1)!.level).toBe(4);
  expect(cells[0].level).toBe(1);
});

test("the grid caps at 53 weeks and ends on the newest day", () => {
  const last = Date.UTC(2026, 2, 1);
  const buckets: Array<[number, number]> = [];
  // Just past one year of days, which is the most a GitHub graph draws.
  for (let day = 0; day < 400; day += 1) buckets.push([last - day * DAY_MS, 1]);
  const cells = graphOf(stats("all", DAY_MS, buckets));
  const weeks = cells.reduce((max, c) => Math.max(max, c.week), -1) + 1;
  expect(weeks).toBe(53);
  // The newest day fills the last column, and days past the year cap are dropped.
  expect(cells.some((c) => c.ts === last)).toBe(true);
  expect(Math.min(...cells.map((c) => c.ts))).toBe(last - (GRAPH_WEEKS - 1) * 7 * DAY_MS);
  // 2026-03-01 is a Sunday: 53 columns, the newest holding one day, the year cap holding the rest.
  expect(cells).toHaveLength((GRAPH_WEEKS - 1) * 7 + 1);
});

test("a day with no bucket draws as an empty cell, so gaps stay visible", () => {
  const start = Date.UTC(2026, 2, 1);
  // Two days of activity inside a five day window: three cells draw empty.
  const cells = graphOf(stats("7d", DAY_MS, [[start, 10], [start + 4 * DAY_MS, 20]]));
  expect(cells.map((c) => c.tokens)).toEqual([10, 0, 0, 0, 20]);
  expect(cells.map((c) => c.level)).toEqual([2, 0, 0, 0, 4]);
});

test("no buckets draws no graph", () => {
  expect(graphOf(stats("24h", HOUR_MS, []))).toEqual([]);
  expect(stripOf(stats("24h", HOUR_MS, [])).bars).toEqual([]);
});

test("the strip keeps one bar per slot, quiet slots included", () => {
  // A 24 hour window of hourly buckets: 24 bars, one per hour, even where an hour is quiet.
  const start = Date.UTC(2026, 2, 1);
  const buckets: Array<[number, number]> = [[start, 12], [start + 2 * HOUR_MS, 6]];
  const strip = stripOf(stats("24h", HOUR_MS, buckets));
  expect(strip.unit).toBe("hour");
  expect(strip.bars).toHaveLength(3);
  expect(strip.bars.map((bar) => bar.tokens)).toEqual([12, 0, 6]);
  expect(strip.bars[0].label).toBe("Mar 1 00:00 UTC");
  // Day buckets name their day instead.
  expect(stripOf(stats("7d", DAY_MS, [[start, 4]])).bars[0].label).toBe("2026-03-01");
});

test("the strip caps at 90 bars and keeps the newest ones", () => {
  const start = Date.UTC(2026, 0, 1);
  const buckets: Array<[number, number]> = [];
  for (let day = 0; day < 120; day += 1) buckets.push([start + day * DAY_MS, day]);
  const strip = stripOf(stats("all", DAY_MS, buckets));
  expect(strip.unit).toBe("day");
  expect(strip.bars).toHaveLength(90);
  expect(strip.bars[0].ts).toBe(start + 30 * DAY_MS);
});
