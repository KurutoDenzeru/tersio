// The trace's virtual time axis: three ways to lay a session out, and the ruler they share.
//
// A session is not evenly spent. The default axis is wall clock with idle gaps bridged, so a
// twenty-minute gap between two prompts takes the width of a pause instead of the width of an hour.
// The other two axes throw time away and give every turn, or every call boundary, the same width,
// which is what a comparison wants.

import type { AgentTraceSpan, AgentTraceTrack } from "@/lib/data";

export type AxisMode = "time" | "turns" | "calls";

export interface TraceScale {
  domain: [number, number];
  /** Map a wall time in ms to a virtual unit. */
  toU: (t: number) => number;
  /** Map a virtual unit back to a wall time in ms. */
  toT: (u: number) => number;
}

/** Padding added around activity before a gap counts as idle. */
const ACTIVITY_PAD_MS = 2000;
/** Gaps longer than this are bridged. */
const GAP_THRESHOLD_MS = 30_000;
/** Virtual width of a bridged gap. */
const GAP_BRIDGE_U = 8000;

/** A piecewise-linear map over matched breakpoints: t ascending, u non-decreasing. */
function piecewise(tPoints: number[], uPoints: number[]): TraceScale {
  const span = Math.max(1, tPoints[tPoints.length - 1] - tPoints[0]);
  const domain: [number, number] = [uPoints[0], uPoints[uPoints.length - 1]];
  const toU = (t: number): number => {
    if (tPoints.length === 1) return uPoints[0];
    const clamped = Math.min(Math.max(t, tPoints[0]), tPoints[tPoints.length - 1]);
    let lo = 0;
    let hi = tPoints.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (tPoints[mid] <= clamped) lo = mid;
      else hi = mid;
    }
    const width = tPoints[hi] - tPoints[lo] || 1;
    return uPoints[lo] + ((clamped - tPoints[lo]) / width) * (uPoints[hi] - uPoints[lo]);
  };
  const toT = (u: number): number => {
    const clamped = Math.min(Math.max(u, domain[0]), domain[1]);
    let lo = 0;
    let hi = uPoints.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (uPoints[mid] <= clamped) lo = mid;
      else hi = mid;
    }
    const width = uPoints[hi] - uPoints[lo] || 1;
    return tPoints[lo] + ((clamped - uPoints[lo]) / width) * (tPoints[hi] - tPoints[lo]);
  };
  void span;
  return { domain, toU, toT };
}

/** Every span interval across the tracks, sorted by start. */
function intervals(tracks: AgentTraceTrack[]): Array<[number, number]> {
  const list: Array<[number, number]> = [];
  for (const track of tracks) for (const span of track.spans) list.push([span.start, span.end]);
  return list.toSorted((a, b) => a[0] - b[0]);
}

/** Wall time bounds across every span, or a one millisecond window when there are none. */
function bounds(tracks: AgentTraceTrack[]): [number, number] {
  const list = intervals(tracks);
  if (list.length === 0) return [0, 1];
  return [Math.min(...list.map(([s]) => s)), Math.max(...list.map(([, e]) => e))];
}

/** Wall clock with long idle gaps bridged: activity keeps its own width, a pause costs a bridge. */
function compressedTime(tracks: AgentTraceTrack[], compressIdle: boolean): TraceScale {
  const [tMin, tMax] = bounds(tracks);
  const tPoints = [tMin];
  const uPoints = [0];
  let u = 0;
  if (!compressIdle) {
    tPoints.push(tMax);
    uPoints.push(tMax - tMin);
    return piecewise(tPoints, uPoints);
  }
  // One merged activity timeline, so overlapping spans on one track do not each bridge a gap.
  const merged: Array<[number, number]> = [];
  for (const [start, end] of intervals(tracks)) {
    const last = merged[merged.length - 1];
    if (last && start - last[1] < GAP_THRESHOLD_MS * 2) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  for (const [start, end] of merged) {
    const gap = start - tPoints[tPoints.length - 1];
    if (gap > GAP_THRESHOLD_MS && tPoints.length > 1) {
      u += GAP_BRIDGE_U;
      tPoints.push(start - ACTIVITY_PAD_MS);
      uPoints.push(u);
    }
    const from = Math.max(start - ACTIVITY_PAD_MS, tPoints[tPoints.length - 1]);
    u += Math.max(0, end - from);
    tPoints.push(end);
    uPoints.push(u);
  }
  return piecewise(tPoints, uPoints);
}

/** Equal virtual width per boundary: the anchor times of the mode. */
function equalWidth(tracks: AgentTraceTrack[], mode: AxisMode): TraceScale {
  const [tMin, tMax] = bounds(tracks);
  const anchors = new Set<number>([tMin, tMax]);
  const all = tracks.flatMap((track) => track.spans);
  for (const span of all) {
    if (mode === "turns" && span.kind === "turn") anchors.add(span.start);
    if (mode === "calls" && (span.kind === "model" || span.kind === "tool")) anchors.add(span.start);
  }
  const times = [...anchors].toSorted((a, b) => a - b);
  const width = times.length > 1 ? (tMax - tMin) / (times.length - 1) : 1;
  return piecewise(times, times.map((_, index) => index * width));
}

/** The axis for the mode over every track. */
export function buildScale(tracks: AgentTraceTrack[], mode: AxisMode, compressIdle: boolean): TraceScale {
  if (tracks.every((track) => track.spans.length === 0)) {
    return piecewise([0, 1], [0, 1]);
  }
  if (mode === "time") return compressedTime(tracks, compressIdle);
  return equalWidth(tracks, mode);
}

/** One ruler tick. */
export interface Tick {
  u: number;
  label: string;
  major: boolean;
}

/** Target spacing between ticks. */
const TICK_TARGET_PX = 90;
/** Padding in px between two tick labels. */
const MIN_TICK_PX = 54;

/** Round a raw step up to a 1/2/5 x 10^n step. */
function niceStep(raw: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  for (const factor of [1, 2, 5, 10]) if (raw <= magnitude * factor) return magnitude * factor;
  return magnitude * 10;
}

/** Wall clock label: `14:22:07`, with the date when the range runs past a day. */
function wallClock(t: number, withDate: boolean): string {
  const d = new Date(t);
  const time = [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
  return withDate ? `${d.getMonth() + 1}/${d.getDate()} ${time}` : time;
}

/** Offset from the trace start: `+mm:ss`, hours prepended when needed. */
export function formatOffset(deltaMs: number): string {
  const sign = deltaMs < 0 ? "-" : "+";
  const total = Math.abs(Math.round(deltaMs / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mmss = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return hours > 0 ? `${sign}${hours}:${mmss}` : `${sign}${mmss}`;
}

/** Ticks inside the visible window, placed on nice wall-time steps. */
export function buildTicks(scale: TraceScale, u0: number, u1: number, widthPx: number): Tick[] {
  const t0 = scale.toT(u0);
  const t1 = scale.toT(u1);
  const span = Math.max(1, t1 - t0);
  const step = niceStep((span * TICK_TARGET_PX) / Math.max(1, widthPx));
  const first = Math.ceil(t0 / step) * step;
  const [d0] = scale.domain;
  const ticks: Tick[] = [];
  const withDate = span > 24 * 3600_000;
  const px = (u: number): number => ((u - u0) / Math.max(1e-9, u1 - u0)) * widthPx;
  // A minor tick earns its place only when a full half step clears the padding, in pixels.
  const halfStepPx = px(scale.toU(t0 + step / 2)) - px(scale.toU(t0));
  let lastX = -Infinity;
  const accept = (tick: Tick): void => {
    if (tick.u < u0 || tick.u > u1) return;
    const x = px(tick.u);
    if (x - lastX < MIN_TICK_PX) return;
    ticks.push(tick);
    lastX = x;
  };
  // Majors first, then the minors that still fit: a minor never crowds a major.
  for (let t = first; t <= t1; t += step) {
    accept({ u: scale.toU(t), label: wallClock(t, withDate), major: true });
  }
  if (halfStepPx >= MIN_TICK_PX) {
    for (let t = first; t <= t1; t += step) {
      accept({ u: scale.toU(t + step / 2), label: formatOffset(t + step / 2 - scale.toT(d0)), major: false });
    }
  }
  return ticks;
}

/** The lanes one track draws: its span kinds, in reading order. */
export const LANE_ORDER: readonly string[] = ["turn", "model", "tool", "background"];

/** Lane label for a span kind. */
export const LANE_LABEL: Record<string, string> = {
  turn: "Input",
  model: "Model",
  tool: "Tools",
  background: "Background",
};

/** Group one track's spans into lanes, keeping the order the canvas draws. */
export function lanesOf(track: AgentTraceTrack): Array<{ kind: string; label: string; spans: AgentTraceSpan[] }> {
  const byKind = new Map<string, AgentTraceSpan[]>();
  for (const span of track.spans) {
    const list = byKind.get(span.kind) ?? [];
    list.push(span);
    byKind.set(span.kind, list);
  }
  return LANE_ORDER.filter((kind) => byKind.has(kind)).map((kind) => ({
    kind,
    label: LANE_LABEL[kind],
    spans: (byKind.get(kind) ?? []).toSorted((a, b) => a.start - b.start),
  }));
}
