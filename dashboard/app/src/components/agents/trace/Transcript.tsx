// The transcript: every span in order, one row each, bidirectionally synced with the timeline.
//
// A session holds thousands of spans, so the list is windowed: it renders the rows the scroll
// position puts on screen plus a little overrun, and keeps the rest as spacer height. A row holds
// the span's kind as a chip, its name, the first line of its text, and how long it held alongside
// the offset from the start of the session, the shape the reference transcript uses.

import { memo, useEffect, useRef, useState } from "react";
import { VendorMark } from "@/components/brand";
import { Icon } from "@/components/icon";
import { toolIcon } from "@/components/common";
import type { AgentTraceSpan, AgentTraceSpanKind, AgentTraceTrack } from "@/lib/data";
import { fmtMs, stampLocal } from "@/lib/format";
import { formatOffset } from "./scale";
import { useTraceTheme } from "./theme";

export interface TranscriptRow {
  key: string;
  time: number;
  span: AgentTraceSpan;
  track: AgentTraceTrack;
}

/** One row's height. The list is windowed against it, so it must stay fixed. */
const ROW_H = 28;
/** Rows kept on either side of the window. */
const OVERSCAN = 12;
/** The list's height. */
const LIST_H = 360;

/** Flatten every track's spans into one chronological list. */
export function buildTranscriptRows(tracks: AgentTraceTrack[]): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  for (const track of tracks) for (const span of track.spans) rows.push({ key: span.id, time: span.start, span, track });
  return rows.toSorted((a, b) => a.time - b.time);
}

export const TranscriptList = memo(function TranscriptList({
  rows,
  traceStart,
  traceEnd,
  selection,
  onSelect,
  search,
  matchIds,
}: {
  rows: TranscriptRow[];
  traceStart: number;
  traceEnd: number;
  selection: string | null;
  onSelect: (span: AgentTraceSpan) => void;
  search: string;
  matchIds: ReadonlySet<string> | null;
}) {
  const theme = useTraceTheme();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);

  // Follow the timeline's selection into view when it moves from outside the list.
  useEffect(() => {
    const box = boxRef.current;
    if (!box || !selection) return;
    const index = rows.findIndex((row) => row.key === selection);
    if (index < 0) return;
    const top = index * ROW_H;
    if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - ROW_H) {
      box.scrollTop = Math.max(0, top - box.clientHeight / 2);
    }
  }, [selection, rows]);

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + LIST_H) / ROW_H) + OVERSCAN);
  const shown = rows.slice(first, last);
  const needle = search.trim().toLowerCase();
  const multiDay = traceEnd - traceStart > 24 * 3600_000;

  return (
    <div
      ref={boxRef}
      className="mono overflow-auto text-[12px] [scrollbar-color:var(--line)_transparent] [scrollbar-width:thin]"
      style={{ height: LIST_H }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      role="list"
      aria-label="Transcript"
    >
      <div style={{ height: rows.length * ROW_H, position: "relative" }}>
        <div style={{ position: "absolute", top: first * ROW_H, left: 0, right: 0 }}>
          {shown.map((row) => {
            const span = row.span;
            const held = span.end > span.start ? fmtMs(span.end - span.start) : "";
            const color = theme.category[span.kind as AgentTraceSpanKind];
            const dim = needle.length > 0 && !matchIds?.has(span.id);
            return (
              <button
                key={row.key}
                type="button"
                onClick={() => onSelect(span)}
                className={`flex w-full items-center gap-2 border-b border-line px-3 text-left hover:bg-track ${
                  span.id === selection ? "bg-accent-soft" : ""
                }`}
                style={{ height: ROW_H }}
              >
                <span
                  className="shrink-0 rounded-full border px-1.5 text-[10px]"
                  style={{ borderColor: color, color }}
                  title={span.kind}
                >
                  {span.kind}
                </span>
                {span.kind === "model" && span.model ? (
                  <VendorMark model={span.model} tiny />
                ) : (
                  <Icon name={toolIcon(span.tool ?? span.label)} className="size-3 shrink-0 text-dim" />
                )}
                <span className="w-[168px] shrink-0 truncate" title={span.label}>
                  {span.kind === "turn" ? "Prompt" : span.label}
                </span>
                <span className={`min-w-0 flex-1 truncate ${dim ? "opacity-50" : "text-dim"}`} title={span.detail}>
                  {span.detail}
                </span>
                <span className="flex shrink-0 items-center gap-2.5 text-dim">
                  {span.isError && <span className="text-danger">error</span>}
                  <span className="w-[58px] text-right tabular-nums">{held}</span>
                  <span
                    className="w-[104px] text-right tabular-nums"
                    title={multiDay ? stampLocal(span.start) : undefined}
                  >
                    {formatOffset(span.start - traceStart)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
});
