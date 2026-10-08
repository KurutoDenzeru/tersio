// Session waterfall: one lane per transcript track, spans as bars on one shared time axis.
// A plain SVG, hit-tested by the browser: a bar is a rect, the axis is three labels, and a marker
// is a dashed line. No chart library is involved, so 500 spans cost 500 rects and nothing else.
import type { SessionTrace, TraceMarker, TraceSpan, TraceTrack } from "@/lib/data";
import { fmtMs } from "@/lib/format";

const LABEL_W = 168;
const LANE_H = 26;
const BAR_H = 13;
const CHART_W = 880;
const HEADER_H = 20;
/** The row under the lanes that holds marker labels, so they never sit on top of a bar. */
const FOOT_H = 12;
const GRID = [0, 0.25, 0.5, 0.75, 1];

/** Bar colour per span kind, over the app's tokens so both themes stay legible. */
const KIND_COLOR: Record<TraceSpan["kind"], string> = {
  turn: "var(--dim)",
  model: "var(--accent)",
  tool: "#fb923c",
  subagent: "#a78bfa",
  background: "var(--dim)",
};

export const KIND_LABEL: Record<TraceSpan["kind"], string> = {
  turn: "Turn",
  model: "Model request",
  tool: "Tool call",
  subagent: "Subagent",
  background: "Background job",
};

interface Lane {
  track: TraceTrack;
  depth: number;
}

/** Main track first, then each subagent under the track that spawned it, indented one level. */
function lanes(tracks: TraceTrack[]): Lane[] {
  const out: Lane[] = [];
  const seen = new Set<string>();
  const walk = (track: TraceTrack, depth: number): void => {
    if (seen.has(track.id)) return;
    seen.add(track.id);
    out.push({ track, depth });
    for (const child of tracks) {
      if (child.parentId === track.id) walk(child, depth + 1);
    }
  };
  const main = tracks.find((t) => t.parentId === null) ?? tracks[0];
  if (main) walk(main, 0);
  for (const track of tracks) walk(track, 0);
  return out;
}

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function clamp(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function Legend() {
  const items: Array<[string, string]> = [
    ["Model", KIND_COLOR.model],
    ["Tool", KIND_COLOR.tool],
    ["Subagent", KIND_COLOR.subagent],
    ["Background", KIND_COLOR.background],
    ["Error", "var(--danger)"],
  ];
  return (
    <ul className="m-0 flex list-none flex-wrap items-center gap-x-3 gap-y-1 p-0 text-[11px] text-dim">
      {items.map(([label, color]) => (
        <li key={label} className="flex items-center gap-1.5">
          <span className="size-2 rounded-[2px]" style={{ background: color }} />
          <span className="mono">{label}</span>
        </li>
      ))}
      <li className="mono">dashed = unterminated · turn = band at the lane foot</li>
    </ul>
  );
}

/** One clickable bar. A turn is not a bar: it is a thin band marking the lane section it opened. */
function SpanBar({
  span,
  track,
  x,
  laneY,
  selected,
  onSelect,
}: {
  span: TraceSpan;
  track: TraceTrack;
  x: (ms: number) => number;
  laneY: number;
  selected: boolean;
  onSelect: (span: TraceSpan, track: TraceTrack) => void;
}) {
  const left = x(span.start);
  const width = Math.max(1.5, x(span.end) - left);
  const hint = [`${span.label} · ${fmtMs(span.end - span.start)}`, span.error ? "error" : null, span.unterminated ? "unterminated" : null]
    .filter(Boolean)
    .join(" · ");

  if (span.kind === "turn") {
    const bandY = laneY + LANE_H - 6;
    return (
      <g data-span={span.id} role="button" tabIndex={-1} aria-label={hint} onClick={() => onSelect(span, track)}>
        <title>{hint}</title>
        <rect x={left} y={bandY} width={width} height={3} rx={1.5} fill="var(--dim)" opacity={0.3} />
        {selected && <rect x={left - 1} y={bandY - 2} width={width + 2} height={7} rx={2} fill="none" stroke="var(--ink)" />}
      </g>
    );
  }

  const barY = laneY + (LANE_H - BAR_H) / 2;
  const stroke = span.unterminated || selected ? (span.unterminated ? "var(--danger)" : "var(--ink)") : "none";
  return (
    <g data-span={span.id} role="button" tabIndex={-1} aria-label={hint} onClick={() => onSelect(span, track)}>
      <title>{hint}</title>
      <rect
        x={left}
        y={barY}
        width={width}
        height={BAR_H}
        rx={width > 5 ? 2 : 1}
        fill={span.error ? "var(--danger)" : KIND_COLOR[span.kind]}
        opacity={span.unterminated ? 0.45 : span.kind === "background" ? 0.7 : 1}
        stroke={stroke}
        strokeWidth={stroke === "none" ? 0 : 1}
        strokeDasharray={span.unterminated ? "3 2" : undefined}
      />
    </g>
  );
}

export function TraceWaterfall({
  trace,
  selectedSpanId,
  highlightTrackId,
  onSelectSpan,
}: {
  trace: SessionTrace;
  selectedSpanId: string | null;
  highlightTrackId: string | null;
  onSelectSpan: (span: TraceSpan, track: TraceTrack) => void;
}) {
  const ordered = lanes(trace.tracks);
  const spans = trace.tracks.flatMap((track) => track.spans);
  const t0 = Math.min(trace.startedAt, ...spans.map((s) => s.start));
  const t1 = Math.max(trace.endedAt, ...spans.map((s) => s.end));
  const total = Math.max(t1 - t0, 1);
  const width = LABEL_W + CHART_W;
  const lanesBottom = HEADER_H + ordered.length * LANE_H;
  const height = lanesBottom + FOOT_H;
  const x = (ms: number): number => LABEL_W + ((ms - t0) / total) * CHART_W;

  const turns = (trace.tracks.find((track) => track.parentId === null) ?? trace.tracks[0])?.spans.filter(
    (s) => s.kind === "turn",
  ) ?? [];
  const markers = Array.from(
    new Map(
      trace.tracks
        .flatMap((track) => track.markers)
        .map((marker: TraceMarker) => [`${marker.time}:${marker.kind}:${marker.label}`, marker]),
    ).values(),
  );

  return (
    <div className="grid gap-2">
      <Legend />
      <div className="overflow-x-auto">
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block">
          {GRID.map((f) => (
            <line
              key={f}
              x1={LABEL_W + f * CHART_W}
              x2={LABEL_W + f * CHART_W}
              y1={HEADER_H - 4}
              y2={lanesBottom}
              stroke="var(--line)"
              strokeWidth={1}
            />
          ))}
          <text x={LABEL_W + 2} y={10} fontSize={9} fill="var(--dim)" className="mono">
            {clock(t0)}
          </text>
          <text x={LABEL_W + CHART_W / 2} y={10} fontSize={9} fill="var(--dim)" textAnchor="middle" className="mono">
            +{fmtMs(total / 2)}
          </text>
          <text x={LABEL_W + CHART_W - 2} y={10} fontSize={9} fill="var(--dim)" textAnchor="end" className="mono">
            {clock(t1)} · {fmtMs(total)}
          </text>

          {/* A turn bounds whole stretches of every lane, so its start is drawn across them all. */}
          {turns.map((turn) => (
            <line
              key={`sep-${turn.id}`}
              x1={x(turn.start)}
              x2={x(turn.start)}
              y1={HEADER_H}
              y2={lanesBottom}
              stroke="var(--line)"
              strokeDasharray="2 4"
            />
          ))}

          {ordered.map(({ track, depth }, laneIndex) => {
            const laneY = HEADER_H + laneIndex * LANE_H;
            return (
              <g key={track.id} data-track={track.id}>
                {track.id === highlightTrackId && (
                  <rect x={0} y={laneY} width={width} height={LANE_H} fill="var(--accent-soft)" />
                )}
                <text x={6 + depth * 10} y={laneY + LANE_H / 2 + 3} fontSize={11} fill="var(--ink)" className="mono">
                  {clamp(track.label, 20)}
                  <title>{`${track.label}${track.model ? ` · ${track.model}` : ""} · ${track.file}`}</title>
                </text>
                <text x={LABEL_W - 6} y={laneY + LANE_H / 2 + 3} fontSize={9} fill="var(--dim)" textAnchor="end" className="mono">
                  {track.agent ?? ""}
                </text>
                <line x1={0} x2={width} y1={laneY + LANE_H - 0.5} y2={laneY + LANE_H - 0.5} stroke="var(--line)" />
                {track.spans.map((span) => (
                  <SpanBar
                    key={span.id}
                    span={span}
                    track={track}
                    x={x}
                    laneY={laneY}
                    selected={span.id === selectedSpanId}
                    onSelect={onSelectSpan}
                  />
                ))}
              </g>
            );
          })}

          {/* Markers last, so a model change stays visible over the bars it explains. A mode that
              toggled 159 times is one line each and one label: the repeats carry no new name. */}
          {markers.map((marker, i) => {
            const previous = markers[i - 1];
            const firstOfName = !previous || previous.kind !== marker.kind || previous.label !== marker.label;
            return (
              <g key={`${marker.time}-${marker.kind}-${marker.label}`}>
                <title>{`${marker.label} · ${marker.kind.replace("_", " ")} · ${clock(marker.time)}`}</title>
                <line
                  x1={x(marker.time)}
                  x2={x(marker.time)}
                  y1={HEADER_H - 4}
                  y2={lanesBottom}
                  stroke="var(--dim)"
                  strokeWidth={1}
                  strokeDasharray="4 3"
                />
                {firstOfName && (
                  <text x={x(marker.time) + 2} y={lanesBottom + 9} fontSize={9} fill="var(--dim)" className="mono">
                    {clamp(marker.label, 16)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
