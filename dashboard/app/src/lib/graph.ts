// Pure helpers for graphs that are not chart series: the weeks-by-weekday activity grid, the
// bar strip, and the streak figures. Both the share card and any future page read it, so the
// layout rules live here instead of in a component.
import { bucketWord, tsFull } from "./format.ts";
import type { AgentStats } from "./data.ts";

const DAY_MS = 86_400_000;
/** The activity graph keeps the GitHub proportions, so a card reads as a contribution graph. */
export const GRAPH_WEEKS = 53;
/** A bar strip never widens past this many bars, so a bar stays a bar. */
const STRIP_BARS = 90;
/** A calendar that spans no more than this many weeks reads better as a bar strip. */
export const STRIP_MAX_WEEKS = 6;
/** A window no wider than this many weeks reads better as month bands than as a calendar. */
export const BAND_MAX_WEEKS = 18;

/** One cell of the activity graph. `week` counts back from the left, `day` is the weekday. */
export interface GraphCell {
  week: number;
  day: number;
  /** Tokens inside the cell, and the bucket it came from. */
  tokens: number;
  ts: number;
  /** UTC day key, which is what the card tooltip reads. */
  label: string;
  level: 0 | 1 | 2 | 3 | 4;
  /** The calendar month the cell falls in, which is what a month label reads. */
  month: string;
}

/** A run of consecutive days with activity, the way a contribution graph reads one. */
export interface Streak {
  /** How many days the run holds, today or yesterday included for a live streak. */
  days: number;
  /** The run's newest day, or null when no day in the window holds activity. */
  endTs: number | null;
  /** The run's oldest day. */
  startTs: number | null;
}

/** The streak and peak figures the card's right panel reads. */
export interface GraphStreaks {
  /** The run that is still live today or yesterday; zero when the window is quiet right now. */
  current: Streak;
  /** The longest run anywhere in the window. */
  longest: Streak;
  /** How many days in the window hold activity. */
  activeDays: number;
  /** The busiest day's tokens. */
  peakTokens: number;
  /** The busiest day, or null when the window is empty. */
  peakTs: number | null;
  /** Every day in the window, oldest first, so a panel can walk them. */
  days: Array<{ ts: number; tokens: number }>;
}

const utcDay = (ts: number): number => Math.floor(ts / DAY_MS) * DAY_MS;

/** The window's own day bounds, and every day's token total inside it. */
export interface DayTotals {
  perDay: Map<number, number>;
  /** The oldest day the grid draws, the Sunday on or before the range's start. */
  start: number;
  /** The newest day the grid draws: today. */
  end: number;
}

const dayTotalsOf = (agent: AgentStats): DayTotals => {
  const perDay = new Map<number, number>();
  for (const bucket of agent.series) {
    if (!Number.isFinite(bucket.ts) || bucket.ts <= 0) continue;
    // Bucket sizes are epoch-aligned, so a day bucket is already its own key.
    const day = utcDay(bucket.ts);
    perDay.set(day, (perDay.get(day) ?? 0) + (Number.isFinite(bucket.tokens) ? bucket.tokens : 0));
  }
  const end = Math.max(utcDay(agent.generatedAt || Date.now()), 0);
  // With no bucket the window starts on its own last day, so a quiet range draws nothing.
  const keys = [...perDay.keys(), end];
  const oldest = Math.min(...keys);
  const wantStart = agent.cutoff > 0 ? utcDay(agent.cutoff) : oldest;
  // A window wider than the grid cap starts at the cap, so the shape stays GitHub's 53 weeks.
  const windowStart = Math.max(wantStart, utcDay(end - (GRAPH_WEEKS - 1) * 7 * DAY_MS));
  // Column zero is the Sunday on or before the window start.
  return { perDay, start: windowStart - new Date(windowStart).getUTCDay() * DAY_MS, end };
};

/** How many days in the window hold activity, the busiest one, and the longest single request. */
export interface DayFact {
  activeDays: number;
  peakTokens: number;
  peakTs: number | null;
  perDay: Map<number, number>;
  start: number;
  end: number;
}

/** The day totals plus the peak, read once so a card draws one set of numbers. */
export function dayFactsOf(agent: AgentStats): DayFact {
  const { perDay, start, end } = dayTotalsOf(agent);
  let activeDays = 0;
  let peakTokens = 0;
  let peakTs: number | null = null;
  for (let ts = start; ts <= end; ts += DAY_MS) {
    const tokens = perDay.get(ts) ?? 0;
    if (tokens <= 0) continue;
    activeDays += 1;
    if (tokens > peakTokens) {
      peakTokens = tokens;
      peakTs = ts;
    }
  }
  return { activeDays, peakTokens, peakTs, perDay, start, end };
}

/**
 * The buckets become a weeks-by-weekday grid that covers the whole window, not just the days
 * that hold data. The oldest cell is the Sunday on or before the range's start and the newest
 * is today, so a window that opens mid-month still draws that month's leading days as empty
 * boxes and the current month fills out to the right edge. GitHub's own graph behaves this way:
 * a run of quiet days reads as its own shape rather than being cut out of the picture.
 */
export function graphOf(agent: AgentStats): GraphCell[] {
  const { perDay, start, end } = dayTotalsOf(agent);
  // A window with no activity draws no graph, so the card's empty state reads.
  if (perDay.size === 0) return [];
  const cells: GraphCell[] = [];
  for (let ts = start; ts <= end; ts += DAY_MS) {
    const at = new Date(ts);
    cells.push({
      week: Math.floor((ts - start) / (7 * DAY_MS)),
      day: at.getUTCDay(),
      tokens: perDay.get(ts) ?? 0,
      ts,
      label: at.toISOString().slice(0, 10),
      level: 0,
      month: `${at.getUTCFullYear()}-${at.getUTCMonth()}`,
    });
  }
  // Five levels against the busiest day, which is how a contribution graph reads at a glance.
  const peak = Math.max(...cells.map((cell) => cell.tokens), 0);
  for (const cell of cells) {
    if (peak <= 0) continue;
    const share = cell.tokens / peak;
    cell.level = cell.tokens > 0 ? (Math.min(4, Math.max(1, Math.ceil(share * 4))) as 1 | 2 | 3 | 4) : 0;
  }
  return cells;
}

/** How many weeks the grid spans, which is what picks a calendar from a bar strip. */
export function graphWeeks(cells: GraphCell[]): number {
  return cells.reduce((max, c) => Math.max(max, c.week + 1), 0);
}

/**
 * The streak and peak figures, read off the same day grid so a card never counts twice.
 * A streak is a run of consecutive days that hold activity; the current one is live only when
 * it reaches today or yesterday, because a day still open is not a missed day.
 */
export function streaksOf(facts: DayFact): GraphStreaks {
  const all: Array<{ ts: number; tokens: number }> = [];
  for (let ts = facts.start; ts <= facts.end; ts += DAY_MS) {
    all.push({ ts, tokens: facts.perDay.get(ts) ?? 0 });
  }
  const runs: Array<{ days: number; startTs: number; endTs: number }> = [];
  let runLength = 0;
  let runStart: number | null = null;
  let runEnd: number | null = null;
  for (const day of all) {
    if (day.tokens <= 0) {
      runLength = 0;
      runStart = null;
      runEnd = null;
      continue;
    }
    // Consecutive means one day on from the run's last active day.
    runLength = runEnd !== null && day.ts - runEnd === DAY_MS ? runLength + 1 : 1;
    if (runLength === 1) runStart = day.ts;
    runEnd = day.ts;
    runs.push({ days: runLength, startTs: runStart ?? day.ts, endTs: runEnd });
  }
  const longest = runs.reduce<Streak>(
    (best, r) => (r.days > best.days ? { days: r.days, startTs: r.startTs, endTs: r.endTs } : best),
    { days: 0, startTs: null, endTs: null },
  );
  // Live means the last run reaches today or yesterday: today is still open, yesterday is the
  // newest day that can be missed.
  const last = runs.length > 0 ? runs[runs.length - 1]! : null;
  const current: Streak =
    last !== null && [facts.end, facts.end - DAY_MS].includes(last.endTs)
      ? { days: last.days, startTs: last.startTs, endTs: last.endTs }
      : { days: 0, startTs: null, endTs: null };
  return {
    current,
    longest,
    activeDays: facts.activeDays,
    peakTokens: facts.peakTokens,
    peakTs: facts.peakTs,
    days: all,
  };
}

/** One day of a month band: a cell the band draws left to right. */
export interface BandCell {
  ts: number;
  tokens: number;
  level: 0 | 1 | 2 | 3 | 4;
  label: string;
  /** False for a day before the window opened, so the band can draw it as outside the range. */
  inWindow: boolean;
}

/** One month of a band chart: a full row of days, oldest month first and newest last. */
export interface MonthBand {
  /** Sort key: the month's own year and month. */
  key: string;
  /** Short month name, which is what the row labels. */
  label: string;
  /** Long form for the tooltip: `October 2026`. */
  title: string;
  year: number;
  cells: BandCell[];
}

/**
 * The window becomes one row per calendar month, every day of that month as a cell, oldest month
 * at the top and the current month last. A three month window reads as three even rows instead of
 * a fourteen column grid that a card cannot fill, and a month that opened before the range keeps
 * its earlier days as boxes marked outside the window, so the row's length still names the month.
 */
export function monthBandsOf(facts: DayFact, peak: number): MonthBand[] {
  const bands = new Map<string, MonthBand>();
  for (let ts = facts.start; ts <= facts.end; ts += DAY_MS) {
    const at = new Date(ts);
    const key = `${at.getUTCFullYear()}-${at.getUTCMonth()}`;
    // A band holds every day of its month, so the rows align on the day of the month.
    if (!bands.has(key)) {
      bands.set(key, {
        key,
        label: at.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }),
        title: at.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
        year: at.getUTCFullYear(),
        cells: daysOfMonth(at.getUTCFullYear(), at.getUTCMonth(), facts, peak),
      });
    }
  }
  return [...bands.values()].toSorted((a, b) => a.cells[0]!.ts - b.cells[0]!.ts);
}

/** Every day of one month, in order, with the level each day earns against the window's peak. */
function daysOfMonth(year: number, month: number, facts: DayFact, peak: number): BandCell[] {
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: BandCell[] = [];
  for (let day = 1; day <= last; day += 1) {
    const ts = Date.UTC(year, month, day);
    cells.push({
      ...toCell(ts, facts.perDay.get(ts) ?? 0, peak, ts >= facts.start && ts <= facts.end),
      ts,
      tokens: facts.perDay.get(ts) ?? 0,
    });
  }
  return cells;
}

const toCell = (ts: number, tokens: number, peak: number, inWindow: boolean): BandCell => {
  const share = peak > 0 ? tokens / peak : 0;
  const level: BandCell["level"] =
    tokens > 0 && peak > 0 ? (Math.min(4, Math.max(1, Math.ceil(share * 4))) as 1 | 2 | 3 | 4) : 0;
  return { ts, tokens, level, inWindow, label: new Date(ts).toISOString().slice(0, 10) };
};

/** One bar of the activity strip. */
export interface ActivityBar {
  ts: number;
  tokens: number;
  /** UTC label, which is what the card tooltip reads. */
  label: string;
}

/**
 * The buckets become a bar strip, one bar per slot, with quiet slots kept at zero so a gap still
 * reads in the shape. A window that spans too few weeks for a calendar reads better this way.
 */
export function stripOf(agent: AgentStats): { unit: string; bars: ActivityBar[] } {
  const step = agent.bucketMs > 0 ? agent.bucketMs : DAY_MS;
  const perSlot = new Map<number, number>();
  for (const bucket of agent.series) {
    if (!Number.isFinite(bucket.ts) || bucket.ts <= 0) continue;
    const slot = Math.floor(bucket.ts / step) * step;
    perSlot.set(slot, (perSlot.get(slot) ?? 0) + (Number.isFinite(bucket.tokens) ? bucket.tokens : 0));
  }
  if (perSlot.size === 0) return { unit: bucketWord(step), bars: [] };
  const first = Math.min(...perSlot.keys());
  const last = Math.max(...perSlot.keys());
  const bars: ActivityBar[] = [];
  // The window starts at the range's first slot, so a quiet lead-in shows its gap, and never
  // stretches past the bar cap, so a bar stays a bar.
  const windowStart = agent.cutoff > 0 ? Math.floor(agent.cutoff / step) * step : first;
  for (let ts = Math.max(windowStart, last - (STRIP_BARS - 1) * step); ts <= last; ts += step) {
    bars.push({
      ts,
      tokens: perSlot.get(ts) ?? 0,
      label: step < DAY_MS ? tsFull(ts, step) : new Date(ts).toISOString().slice(0, 10),
    });
  }
  return { unit: bucketWord(step), bars };
}
