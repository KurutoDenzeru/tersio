// Pure helpers for graphs that are not chart series: the weeks-by-weekday activity grid and the
// bar strip. Both the share card and any future page read it, so the layout rules live here
// instead of in a component.
import { bucketWord, tsFull } from "./format.ts";
import type { AgentStats } from "./data.ts";

const DAY_MS = 86_400_000;
/** The activity graph keeps the GitHub proportions, so a card reads as a contribution graph. */
export const GRAPH_WEEKS = 53;
/** A bar strip never widens past this many bars, so a bar stays a bar. */
const STRIP_BARS = 90;
/** A calendar that spans no more than this many weeks reads better as a bar strip. */
export const STRIP_MAX_WEEKS = 6;

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
}

/**
 * The buckets become a weeks-by-weekday grid. Every bucket folds into its UTC day, so a day
 * bucket gives one cell and a 24 hour card draws the same graph as a 30 day one. Cells with no
 * bucket stay empty, and the newest days fill the right-hand columns.
 */
export function graphOf(agent: AgentStats): GraphCell[] {
  const perDay = new Map<number, number>();
  for (const bucket of agent.series) {
    if (!Number.isFinite(bucket.ts) || bucket.ts <= 0) continue;
    // Bucket sizes are epoch-aligned, so a day bucket is already its own key.
    const day = Math.floor(bucket.ts / DAY_MS) * DAY_MS;
    perDay.set(day, (perDay.get(day) ?? 0) + (Number.isFinite(bucket.tokens) ? bucket.tokens : 0));
  }
  if (perDay.size === 0) return [];
  const oldest = Math.min(...perDay.keys());
  const last = Math.max(...perDay.keys());
  const lastSunday = last - new Date(last).getUTCDay() * DAY_MS;
  // The first column opens on the Sunday of the oldest week in the window, and the newest day
  // fills the last column: GitHub puts the busiest day on the right, and so does the card.
  const windowStart = Math.max(oldest, lastSunday - (GRAPH_WEEKS - 1) * 7 * DAY_MS);
  const start = windowStart - new Date(windowStart).getUTCDay() * DAY_MS;
  const first = Math.max(oldest, start);
  const cells: GraphCell[] = [];
  for (let ts = first; ts <= last; ts += DAY_MS) {
    // Column zero is the oldest Sunday in range, and the column count stays inside the cap
    // because the window above is at most 53 weeks.
    cells.push({
      week: Math.floor((ts - start) / (7 * DAY_MS)),
      day: new Date(ts).getUTCDay(),
      tokens: perDay.get(ts) ?? 0,
      ts,
      label: new Date(ts).toISOString().slice(0, 10),
      level: 0,
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
  // The window starts at the first slot with data, so a quiet tail never stretches the strip.
  for (let ts = Math.max(first, last - (STRIP_BARS - 1) * step); ts <= last; ts += step) {
    bars.push({
      ts,
      tokens: perSlot.get(ts) ?? 0,
      label: step < DAY_MS ? tsFull(ts, step) : new Date(ts).toISOString().slice(0, 10),
    });
  }
  return { unit: bucketWord(step), bars };
}
