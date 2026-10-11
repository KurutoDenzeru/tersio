// The trace timeline: a minimap of the whole session, a ruler, and the flamegraph itself.
//
// Everything here is plain canvas plus a DOM gutter. The canvas draws the ruler, the turn bands,
// the span blocks, and the markers; the gutter names the lanes on the left so the canvas never
// spends width on words. One component owns the viewport so the minimap, the canvas, and the
// caller's selection stay in step.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ProviderMark, VendorMark } from "@/components/brand";
import type { AgentTraceMarker, AgentTraceSpan, AgentTraceSpanKind, AgentTraceTrack } from "@/lib/data";
import { buildTicks, formatOffset, lanesOf, type AxisMode, type TraceScale } from "./scale";
import { useTraceTheme } from "./theme";

/** The window onto the virtual axis, in virtual units. */
export interface TimelineViewport {
  u0: number;
  u1: number;
}

export interface TimelineProps {
  tracks: AgentTraceTrack[];
  scale: TraceScale;
  markers: AgentTraceMarker[];
  viewport: TimelineViewport;
  onViewportChange: (viewport: TimelineViewport) => void;
  selectedId: string | null;
  onSelect: (span: AgentTraceSpan | null) => void;
  matchIds: ReadonlySet<string> | null;
}

/** Height of the ruler strip above the lanes. */
const RULER_H = 20;
/** Height of one lane. */
const LANE_H = 18;
/** Gap between lanes. */
const LANE_GAP = 5;
/** Width of the DOM gutter. */
const GUTTER_W = 150;
/** Minimap height. */
const MINIMAP_H = 44;
/** Smallest window the viewport can hold, in virtual units. */
const MIN_WINDOW_U = 10;

/** One lane row in the gutter, with the brand mark for what it holds. */
function LaneRow({ track, lane }: { track: AgentTraceTrack; lane: { kind: string; label: string } }) {
  const first = track.spans.find((span) => span.kind === lane.kind);
  return (
    <div className="flex min-w-0 items-center gap-1.5 px-2 text-[11px] text-dim" style={{ height: LANE_H }}>
      {lane.kind === "model" && first?.model ? <VendorMark model={first.model} tiny /> : null}
      {lane.kind === "tool" && first?.provider ? <ProviderMark provider={first.provider} tiny /> : null}
      <span className="truncate">{lane.label}</span>
    </div>
  );
}

/** The overview strip: per-kind density over the whole session, with a brush for the viewport. */
function Minimap({
  tracks,
  scale,
  viewport,
  onViewportChange,
}: {
  tracks: AgentTraceTrack[];
  scale: TraceScale;
  viewport: TimelineViewport;
  onViewportChange: (viewport: TimelineViewport) => void;
}) {
  const theme = useTraceTheme();
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || width <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(MINIMAP_H * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, MINIMAP_H);
    const [d0, d1] = scale.domain;
    const span = Math.max(1e-9, d1 - d0);
    const px = (u: number): number => ((u - d0) / span) * width;
    const kinds = ["turn", "model", "tool", "background"] as const;
    const stripH = MINIMAP_H / kinds.length;
    for (const [index, kind] of kinds.entries()) {
      ctx.fillStyle = theme.category[kind];
      for (const track of tracks) {
        for (const block of track.spans) {
          if (block.kind !== kind) continue;
          const left = px(scale.toU(block.start));
          const right = px(scale.toU(block.end));
          const w = Math.max(0.5, right - left);
          if (right < 0 || left > width) continue;
          ctx.globalAlpha = 0.5;
          ctx.fillRect(left, index * stripH + 1, w, stripH - 2);
        }
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = theme.grid;
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, index * stripH + 0.5, width - 1, stripH - 1);
    }
    // The brush: the window the flamegraph is showing.
    const left = px(viewport.u0);
    const right = px(viewport.u1);
    ctx.fillStyle = theme.selection;
    ctx.globalAlpha = 0.12;
    ctx.fillRect(left, 0, Math.max(1, right - left), MINIMAP_H);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = theme.selection;
    ctx.lineWidth = 1;
    ctx.strokeRect(left + 0.5, 0.5, Math.max(1, right - left) - 1, MINIMAP_H - 1);
  }, [theme, tracks, scale, viewport, width]);

  const jump = useCallback(
    (clientX: number) => {
      const canvas = ref.current;
      if (!canvas) return;
      const box = canvas.getBoundingClientRect();
      const [d0, d1] = scale.domain;
      const mid = d0 + ((clientX - box.left) / box.width) * (d1 - d0);
      const half = (viewport.u1 - viewport.u0) / 2;
      const u0 = Math.min(Math.max(mid - half, d0), Math.max(d0, d1 - half * 2));
      onViewportChange({ u0, u1: u0 + half * 2 });
    },
    [scale, viewport, onViewportChange],
  );

  return (
    <canvas
      ref={ref}
      className="block h-11 w-full cursor-pointer rounded-md border border-line"
      aria-label="Trace overview"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        jump(event.clientX);
      }}
      onPointerMove={(event) => {
        if (event.buttons === 1) jump(event.clientX);
      }}
    />
  );
}

/** The flamegraph: canvas for the drawing, DOM gutter for the lane names. */
export function Timeline({
  tracks,
  scale,
  markers,
  viewport,
  onViewportChange,
  selectedId,
  onSelect,
  matchIds,
}: TimelineProps) {
  const theme = useTraceTheme();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hover, setHover] = useState<{ span: AgentTraceSpan; x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Lane layout: one row per lane, in track order, with the kinds each track holds.
  const rows = useMemo(() => {
    const list: Array<{ track: AgentTraceTrack; lane: { kind: string; label: string; spans: AgentTraceSpan[] }; top: number }> = [];
    let top = RULER_H;
    for (const track of tracks) {
      for (const lane of lanesOf(track)) {
        list.push({ track, lane, top });
        top += LANE_H + LANE_GAP;
      }
    }
    return list;
  }, [tracks]);

  const height = RULER_H + rows.length * (LANE_H + LANE_GAP) + 10;

  const uToX = useCallback(
    (u: number): number => {
      const [d0, d1] = scale.domain;
      return ((u - d0) / Math.max(1e-9, d1 - d0)) * size.width;
    },
    [scale, size.width],
  );
  const xToU = useCallback(
    (x: number): number => {
      const [d0, d1] = scale.domain;
      return d0 + (x / Math.max(1, size.width)) * (d1 - d0);
    },
    [scale, size.width],
  );

  /** The span under a canvas point, if any. */
  const hitTest = useCallback(
    (x: number, y: number): AgentTraceSpan | null => {
      for (const row of rows) {
        if (y < row.top || y > row.top + LANE_H) continue;
        for (const span of row.lane.spans) {
          const left = uToX(scale.toU(span.start));
          const right = uToX(scale.toU(span.end));
          if (x >= left - 1 && x <= right + 1) return span;
        }
      }
      return null;
    },
    [rows, scale, uToX],
  );

  // Draw: ruler, turn bands, spans, markers, selection.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(size.width * dpr);
    canvas.height = Math.floor(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // An opaque backdrop first: a 7% wash over a transparent canvas is invisible.
    ctx.fillStyle = theme.panel;
    ctx.fillRect(0, 0, size.width, height);
    const [d0, d1] = scale.domain;
    const at = (u: number): number => ((u - d0) / Math.max(1e-9, d1 - d0)) * size.width;
    ctx.font = `10px ${theme.fonts.mono}`;
    ctx.textBaseline = "middle";

    // Turn bands: a wash behind each prompt's work, so the shape of the conversation reads.
    for (const row of rows) {
      for (const span of row.lane.spans) {
        const left = at(scale.toU(span.start));
        const right = at(scale.toU(span.end));
        if (!Number.isFinite(left) || !Number.isFinite(right)) continue;
        if (row.lane.kind === "turn") {
          ctx.fillStyle = theme.turnBand;
          ctx.fillRect(left, RULER_H, Math.max(2, right - left), height - RULER_H);
          // The prompt itself: two pixels wide, so a sparse lane still reads at a full-session zoom.
          ctx.fillStyle = theme.category.turn;
          ctx.fillRect(left, row.top + 1, Math.max(2, right - left), LANE_H - 2);
        }
      }
    }

    // Ruler.
    const ticks = buildTicks(scale, viewport.u0, viewport.u1, size.width);
    for (const tick of ticks) {
      const left = at(tick.u);
      if (left < -40 || left > size.width + 40) continue;
      ctx.strokeStyle = theme.grid;
      ctx.beginPath();
      ctx.moveTo(Math.round(left) + 0.5, tick.major ? RULER_H - 5 : RULER_H - 3);
      ctx.lineTo(Math.round(left) + 0.5, height);
      ctx.stroke();
      if (tick.major) {
        ctx.fillStyle = theme.tick;
        ctx.textAlign = "center";
        ctx.fillText(tick.label, Math.round(left), RULER_H - 11);
      }
    }
    ctx.strokeStyle = theme.grid;
    ctx.beginPath();
    ctx.moveTo(0, RULER_H - 0.5);
    ctx.lineTo(size.width, RULER_H - 0.5);
    ctx.stroke();

    // Spans.
    for (const row of rows) {
      if (row.lane.kind === "turn") continue;
      for (const span of row.lane.spans) {
        const left = at(scale.toU(span.start));
        const right = at(scale.toU(span.end));
        if (right < -20 || left > size.width + 20) continue;
        const w = Math.max(1, right - left);
        ctx.fillStyle = theme.category[span.kind];
        ctx.fillRect(left, row.top + 1, w, LANE_H - 2);
        if (span.isError) {
          ctx.fillStyle = theme.error;
          ctx.fillRect(left, row.top + 1, 2, LANE_H - 2);
        }
        if (span.id === selectedId) {
          ctx.strokeStyle = theme.selection;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(left + 0.5, row.top + 1, w - 1, LANE_H - 3);
        } else if (matchIds?.has(span.id)) {
          ctx.strokeStyle = theme.error;
          ctx.lineWidth = 1;
          ctx.strokeRect(left + 0.5, row.top + 1, w - 1, LANE_H - 3);
        }
        // Label only when the block is wide enough to hold it.
        const text = span.kind === "turn" ? span.label : span.label;
        if (w > 26 && LANE_H >= 12) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(left + 2, row.top, Math.max(0, w - 4), LANE_H);
          ctx.clip();
          ctx.fillStyle = theme.spanText;
          ctx.textAlign = "left";
          ctx.fillText(text, left + 4, row.top + LANE_H / 2);
          ctx.restore();
        }
      }
    }

    // Markers as diamonds on the ruler line.
    for (const marker of markers) {
      const left = at(scale.toU(marker.ts));
      if (left < -8 || left > size.width + 8) continue;
      const y = RULER_H - 5;
      ctx.fillStyle = theme.marker;
      ctx.beginPath();
      ctx.moveTo(left, y - 4);
      ctx.lineTo(left + 4, y);
      ctx.lineTo(left, y + 4);
      ctx.lineTo(left - 4, y);
      ctx.closePath();
      ctx.fill();
    }
  }, [theme, rows, scale, viewport, size.width, height, selectedId, matchIds, markers]);

  const zoom = useCallback(
    (factor: number, atX: number) => {
      const anchor = xToU(atX);
      const u0 = anchor - (anchor - viewport.u0) * factor;
      const u1 = anchor + (viewport.u1 - anchor) * factor;
      const [d0, d1] = scale.domain;
      const span = Math.min(d1 - d0, Math.max(MIN_WINDOW_U, u1 - u0));
      const mid = (u0 + u1) / 2;
      const start = Math.min(Math.max(mid - span / 2, d0), Math.max(d0, d1 - span));
      onViewportChange({ u0: start, u1: start + span });
    },
    [viewport, scale, xToU, onViewportChange],
  );

  const dragRef = useRef<{ x: number; u0: number; u1: number } | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <div style={{ paddingLeft: GUTTER_W + 8 }}>
        <Minimap tracks={tracks} scale={scale} viewport={viewport} onViewportChange={onViewportChange} />
      </div>
      <div className="flex gap-2" ref={wrapRef}>
        <div className="shrink-0 overflow-hidden" style={{ width: GUTTER_W }}>
          <div style={{ height: RULER_H }} className="border-b border-line" />
          {rows.map((row) => (
            <div key={`${row.track.id}:${row.lane.kind}`} style={{ height: LANE_H + LANE_GAP }}>
              <LaneRow track={row.track} lane={row.lane} />
            </div>
          ))}
        </div>
        <div className="relative min-w-0 flex-1" style={{ height }}>
          <canvas
            ref={canvasRef}
            className="block h-full w-full rounded-md border border-line"
            style={{ height, touchAction: "none" }}
            aria-label="Trace timeline"
            onPointerDown={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              const x = event.clientX - box.left;
              const y = event.clientY - box.top;
              const span = hitTest(x, y);
              if (span) onSelect(span);
              dragRef.current = { x: event.clientX, u0: viewport.u0, u1: viewport.u1 };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              const x = event.clientX - box.left;
              const y = event.clientY - box.top;
              const span = hitTest(x, y);
              setHover(span ? { span, x, y } : null);
              const drag = dragRef.current;
              if (!drag) return;
              const [d0, d1] = scale.domain;
              const spanU = drag.u1 - drag.u0;
              const shift = ((drag.x - event.clientX) / Math.max(1, box.width)) * spanU;
              const u0 = Math.min(Math.max(drag.u0 + shift, d0), Math.max(d0, d1 - spanU));
              onViewportChange({ u0, u1: u0 + spanU });
            }}
            onPointerUp={(event) => {
              dragRef.current = null;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerLeave={() => {
              setHover(null);
              dragRef.current = null;
            }}
            onDoubleClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              const x = event.clientX - box.left;
              const y = event.clientY - box.top;
              const span = hitTest(x, y);
              if (span) {
                const width = (viewport.u1 - viewport.u0) / 3;
                const mid = scale.toU((span.start + span.end) / 2);
                onViewportChange({ u0: mid - width / 2, u1: mid + width / 2 });
              }
            }}
            onWheel={(event) => {
              event.preventDefault();
              const box = event.currentTarget.getBoundingClientRect();
              const factor = event.deltaY > 0 ? 1.2 : 1 / 1.2;
              zoom(factor, event.clientX - box.left);
            }}
          />
          {hover && (
            <div
              className="pointer-events-none absolute z-10 max-w-[280px] rounded-md border border-line bg-panel px-2 py-1.5 text-[11px] shadow-sm"
              style={{ left: Math.min(hover.x + 12, Math.max(0, size.width - 200)), top: hover.y + 14 }}
            >
              <span className="mono block truncate text-ink">{hover.span.label}</span>
              <span className="mono block text-dim">
                {formatOffset(hover.span.start - scale.toT(scale.domain[0]))} · {Math.round(hover.span.end - hover.span.start)}ms
              </span>
              {hover.span.detail && <span className="mt-0.5 block text-dim">{hover.span.detail}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** The axis choices the toolbar offers. */
export const AXIS_MODES: ReadonlyArray<{ value: AxisMode; label: string; title: string }> = [
  { value: "time", label: "Duration", title: "Wall clock, with long idle gaps bridged" },
  { value: "turns", label: "Turns", title: "Equal width per user turn" },
  { value: "calls", label: "Calls", title: "Equal width per model or tool call" },
];

/** The legend, one swatch per span kind. */
export function TraceLegend() {
  const theme = useTraceTheme();
  const items: ReadonlyArray<{ kind: AgentTraceSpanKind; label: string }> = [
    { kind: "turn", label: "Input" },
    { kind: "model", label: "Model" },
    { kind: "tool", label: "Tool" },
    { kind: "background", label: "Background" },
  ];
  return (
    <div className="flex items-center gap-3 text-[11px] text-dim">
      {items.map((item) => (
        <span key={item.kind} className="flex items-center gap-1.5">
          <span className="size-2 rounded-[2px]" style={{ background: theme.category[item.kind] }} aria-hidden="true" />
          {item.label}
        </span>
      ))}
    </div>
  );
}
