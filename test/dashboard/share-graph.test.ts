// The share card's activity graph. The grid covers the whole range window, not just the days
// that hold data: the first cell is the Sunday on or before the range's start, the last is the
// day the server ran, and every quiet day in between is a cell at level zero.
import { expect, test } from "vitest";

import { graphOf, graphWeeks, streaksOf, stripOf } from "../../dashboard/app/src/lib/graph.ts";
import type { AgentStats } from "../../dashboard/app/src/lib/data.ts";

const DAY = 86_400_000;
const HOUR = 3_600_000;
/** A fixed "now", so a window's shape never depends on the day the suite runs. */
const NOW = Date.UTC(2026, 9, 12);
/** A Sunday, so a window that opens on it starts a column. */
const SUNDAY = Date.UTC(2026, 8, 27);

interface Opts {
  cutoff?: number;
  generatedAt?: number;
}

function stats(range: AgentStats["range"], bucketMs: number, buckets: Array<[number, number]>, opts: Opts = {}): AgentStats {
  return {
    range,
    bucketMs,
    cutoff: opts.cutoff ?? 0,
    generatedAt: opts.generatedAt ?? NOW,
    series: buckets.map(([ts, tokens]) => ({ ts, requests: 1, errors: 0, tokens, costUsd: 0 })),
  } as unknown as AgentStats;
}

test("the window opens on the Sunday on or before the range's start", () => {
  // 2026-09-27 is a Sunday, so a cutoff of 09-28 still opens that column.
  const start = Date.UTC(2026, 8, 28);
  const cells = graphOf(stats("90d", DAY, [[start, 10]], { cutoff: start }));
  expect(cells[0]!.ts).toBe(SUNDAY);
  // The grid runs to the day the server ran, not to the newest bucket.
  expect(cells[cells.length - 1]!.ts).toBe(NOW);
  expect(cells).toHaveLength(16);
});

test("a day with no bucket draws as an empty cell, so leading gaps stay visible", () => {
  // The first bucket lands five days into the window, so five quiet boxes open it.
  const cells = graphOf(stats("90d", DAY, [[SUNDAY + 5 * DAY, 40]], { cutoff: SUNDAY, generatedAt: SUNDAY + 9 * DAY }));
  expect(cells).toHaveLength(10);
  expect(cells.slice(0, 5).map((c) => c.level)).toEqual([0, 0, 0, 0, 0]);
  expect(cells.slice(0, 5).every((c) => c.tokens === 0)).toBe(true);
  expect(cells[5]!.tokens).toBe(40);
});

test("a day bucket becomes one cell per weekday, Sunday first", () => {
  const cells = graphOf(
    stats("7d", DAY, [[SUNDAY, 10], [SUNDAY + DAY, 20], [SUNDAY + 2 * DAY, 30], [SUNDAY + 3 * DAY, 40]], {
      cutoff: SUNDAY,
      generatedAt: SUNDAY + 3 * DAY,
    }),
  );
  expect(cells).toHaveLength(4);
  // Rows are weekdays, so Sunday is day 0 and the following Monday is row 1.
  expect(cells.map((c) => c.day)).toEqual([0, 1, 2, 3]);
  expect(cells.every((c) => c.week === 0)).toBe(true);
  expect(cells.map((c) => c.tokens)).toEqual([10, 20, 30, 40]);
});

test("an empty bucket keeps a cell at level zero, and the busiest day is level four", () => {
  const cells = graphOf(
    stats(
      "30d",
      DAY,
      [
        [SUNDAY, 100],
        [SUNDAY + DAY, 0],
        [SUNDAY + 2 * DAY, 50],
        [SUNDAY + 3 * DAY, 10],
        [SUNDAY + 4 * DAY, 25],
      ],
      { cutoff: SUNDAY, generatedAt: SUNDAY + 4 * DAY },
    ),
  );
  expect(cells.map((c) => c.level)).toEqual([4, 0, 2, 1, 1]);
  expect(cells.map((c) => c.label)).toEqual(["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"]);
});

test("buckets shorter than a day fold into their UTC day", () => {
  const cells = graphOf(
    stats("24h", HOUR, [[SUNDAY, 5], [SUNDAY + 6 * HOUR, 7], [SUNDAY + 23 * HOUR, 3]], { cutoff: SUNDAY, generatedAt: SUNDAY }),
  );
  expect(cells).toHaveLength(1);
  expect(cells[0]!.tokens).toBe(15);
  expect(cells[0]!.label).toBe("2026-09-27");
});

test("the grid caps at 53 weeks and ends on the day the server ran", () => {
  const cells = graphOf(stats("all", DAY, [[SUNDAY - 400 * DAY, 3]], { generatedAt: NOW }));
  expect(graphWeeks(cells)).toBe(53);
  expect(cells[cells.length - 1]!.ts).toBe(NOW);
});

test("no buckets draws no graph", () => {
  expect(graphOf(stats("90d", DAY, [], { cutoff: NOW - 90 * DAY }))).toEqual([]);
});

test("the strip opens at the range's start and keeps quiet slots", () => {
  const start = Date.UTC(2026, 8, 20);
  const { unit, bars } = stripOf(stats("30d", DAY, [[start + 9 * DAY, 40]], { cutoff: start, generatedAt: start + 9 * DAY }));
  expect(unit).toBe("day");
  // Nine quiet bars, then the one that carries the window.
  expect(bars).toHaveLength(10);
  expect(bars.slice(0, 9).every((b) => b.tokens === 0)).toBe(true);
  expect(bars[9]!.tokens).toBe(40);
});

test("the strip caps at 90 bars and keeps the newest ones", () => {
  const start = Date.UTC(2026, 8, 20);
  const { bars } = stripOf(stats("all", DAY, [[start, 10], [NOW, 20]], { cutoff: NOW - 400 * DAY, generatedAt: NOW }));
  expect(bars).toHaveLength(90);
  expect(bars[0]!.tokens).toBe(0);
  expect(bars[89]!.tokens).toBe(20);
});

// --- the streak figures ------------------------------------------------------

interface Fact {
  perDay: Map<number, number>;
  start: number;
  end: number;
  activeDays: number;
  peakTokens: number;
  peakTs: number | null;
}

/** Day totals for a run of daily token values ending at `endTs`. */
function facts(tokens: number[], endTs = NOW): Fact {
  const perDay = new Map<number, number>();
  for (const [i, v] of tokens.entries()) if (v > 0) perDay.set(endTs - (tokens.length - 1 - i) * DAY, v);
  const start = endTs - (Math.max(tokens.length, 1) - 1) * DAY;
  let activeDays = 0;
  let peakTokens = 0;
  let peakTs: number | null = null;
  for (let ts = start; ts <= endTs; ts += DAY) {
    const v = perDay.get(ts) ?? 0;
    if (v <= 0) continue;
    activeDays += 1;
    if (v > peakTokens) {
      peakTokens = v;
      peakTs = ts;
    }
  }
  return { perDay, start, end: endTs, activeDays, peakTokens, peakTs };
}

test("the longest streak is the longest run of consecutive active days", () => {
  const s = streaksOf(facts([5, 5, 5, 0, 0, 7, 9]));
  expect(s.longest.days).toBe(3);
  expect(s.current.days).toBe(2);
  expect(s.activeDays).toBe(5);
  expect(s.peakTokens).toBe(9);
  expect(s.peakTs).toBe(NOW);
});

test("a run that stopped two days before the window's end is not a live streak", () => {
  // The window's last two days carry nothing, so the run ended before yesterday.
  const s = streaksOf(facts([5, 5, 5, 0, 0, 7, 0, 0]));
  expect(s.longest.days).toBe(3);
  expect(s.current.days).toBe(0);
  expect(s.current.endTs).toBe(null);
});

test("a live streak counts through yesterday, not only through today", () => {
  // Today is still open, so a run that ends yesterday is live.
  const yesterday = NOW - DAY;
  const s = streaksOf(facts([4], yesterday));
  expect(s.current.days).toBe(1);
  expect(s.current.endTs).toBe(yesterday);
});

test("a window with no activity has neither a streak nor a peak", () => {
  const s = streaksOf(facts([0, 0, 0, 0]));
  expect(s.current.days).toBe(0);
  expect(s.longest.days).toBe(0);
  expect(s.activeDays).toBe(0);
  expect(s.peakTokens).toBe(0);
  expect(s.peakTs).toBe(null);
});
