// One session as a flamegraph: the summary strip, the timeline, the transcript, the tool totals,
// and the drawer behind a span.
//
// The page follows the reference trace viewer's shape: nine headline figures, then a timeline with
// an axis mode, an idle bridge, a search, a legend, an overview strip, and the flamegraph itself,
// then the transcript in words and the per-tool totals. Brand marks stay wherever a model or a
// provider is named.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { Card, Segmented, Stat, StatGrid } from "@/components/charts";
import { EmptyState } from "@/components/common";
import { useSessionTrace } from "@/lib/data";
import type { AgentTraceSpan } from "@/lib/data";
import { fmt, fmtElapsed, fmtShort, pct, relAge, stampLocal } from "@/lib/format";
import { AXIS_MODES, Timeline, TraceLegend, type TimelineViewport } from "./trace/Timeline";
import { buildTranscriptRows, TranscriptList } from "./trace/Transcript";
import { ToolAggregates } from "./trace/ToolAggregates";
import { SpanDrawer } from "./trace/SpanDrawer";
import { buildScale, type AxisMode } from "./trace/scale";

/** Idle gaps longer than this are bridged by default, so a pause costs a pause. */
const COMPRESS_DEFAULT = true;

/** The reference's key hints, kept next to the timeline's own controls. */
const KEY_HINTS = "W/S zoom · A/D pan · drag pan · wheel zoom · 0 fit · F focus selection · dbl-click focus · Esc deselect";

export function SessionTrace({
  sessionFile,
  money,
  onClose,
}: {
  sessionFile: string;
  money: (v: number) => string;
  onClose: () => void;
}) {
  const { trace, loading } = useSessionTrace(sessionFile);
  const [mode, setMode] = useState<AxisMode>("time");
  const [compressIdle, setCompressIdle] = useState(COMPRESS_DEFAULT);
  const [selection, setSelection] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [viewport, setViewport] = useState<TimelineViewport | null>(null);

  // A new session remounts the page (see App), so state never has to be cleared by hand.
  const tracks = useMemo(() => trace?.tracks ?? [], [trace]);
  const scale = useMemo(() => buildScale(tracks, mode, compressIdle), [tracks, mode, compressIdle]);

  // Switching the axis keeps the visible window where it was in wall time.
  const previousScale = useRef(scale);
  useEffect(() => {
    const previous = previousScale.current;
    previousScale.current = scale;
    setViewport((current) => {
      if (!current) return current;
      const t0 = previous.toT(current.u0);
      const t1 = previous.toT(current.u1);
      const u0 = scale.toU(t0);
      const u1 = scale.toU(t1);
      return u1 - u0 > 0 ? { u0, u1 } : null;
    });
  }, [scale]);

  const rows = useMemo(() => buildTranscriptRows(tracks), [tracks]);
  const allSpans = useMemo(() => rows.map((row) => row.span), [rows]);
  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return [];
    return allSpans.filter((span) => `${span.label} ${span.detail} ${span.model} ${span.tool}`.toLowerCase().includes(needle));
  }, [allSpans, search]);
  const matchIds = useMemo(() => (search.trim() ? new Set(matches.map((span) => span.id)) : null), [matches, search]);
  const selected = useMemo(() => allSpans.find((span) => span.id === selection) ?? null, [allSpans, selection]);

  const centerOn = useCallback(
    (span: AgentTraceSpan) => {
      const u = scale.toU(span.start);
      const uEnd = scale.toU(span.end);
      setViewport((current) => {
        const window = current ?? { u0: scale.domain[0], u1: scale.domain[1] };
        if (u >= window.u0 && uEnd <= window.u1) return current;
        const width = window.u1 - window.u0;
        const mid = (u + uEnd) / 2;
        const [d0, d1] = scale.domain;
        let u0 = mid - width / 2;
        if (u0 < d0) u0 = d0;
        if (u0 + width > d1) u0 = Math.max(d0, d1 - width);
        return { u0, u1: u0 + width };
      });
    },
    [scale],
  );

  const cycleMatch = useCallback(
    (direction: 1 | -1) => {
      if (matches.length === 0) return;
      const next = (((matchIndex + direction) % matches.length) + matches.length) % matches.length;
      setMatchIndex(next);
      const span = matches[next];
      setSelection(span.id);
      centerOn(span);
    },
    [matches, matchIndex, centerOn],
  );

  // Keyboard: the same keys the reference viewer binds.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const view = viewport ?? { u0: scale.domain[0], u1: scale.domain[1] };
      const width = view.u1 - view.u0;
      const shift = (event.shiftKey ? 0.5 : 0.2) * width;
      const zoomAt = (factor: number): void => {
        const mid = (view.u0 + view.u1) / 2;
        const next = Math.min(scale.domain[1] - scale.domain[0], Math.max(width * factor, 10));
        setViewport({ u0: mid - next / 2, u1: mid + next / 2 });
      };
      switch (event.key.toLowerCase()) {
        case "w": zoomAt(0.8); break;
        case "s": zoomAt(1.25); break;
        case "a": setViewport({ u0: Math.max(scale.domain[0], view.u0 - shift), u1: view.u1 - shift }); break;
        case "d": setViewport({ u0: view.u0 + shift, u1: Math.min(scale.domain[1], view.u1 + shift) }); break;
        case "0": setViewport({ u0: scale.domain[0], u1: scale.domain[1] }); break;
        case "f":
          if (selected) {
            const mid = scale.toU((selected.start + selected.end) / 2);
            const next = Math.min(scale.domain[1] - scale.domain[0], width / 3);
            setViewport({ u0: mid - next / 2, u1: mid + next / 2 });
          }
          break;
        case "escape": setSelection(null); break;
        default: return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, viewport, scale]);

  const title = trace?.title || sessionFile.split("/").pop() || sessionFile;
  const summary = trace?.summary;

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4 px-4 py-5 sm:px-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onClose}
          className="mono flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-dim transition-[background,color] duration-200 hover:bg-accent-soft hover:text-ink"
        >
          <Icon name="arrow-left" className="size-3.5" />
          Sessions
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-bold sm:text-lg">{title}</h1>
          <p className="mono truncate text-[11px] text-dim" title={sessionFile}>
            {stampLocal(trace?.startedAt ?? 0)} · {sessionFile.split("/sessions/")[1]?.split("/")[0] ?? ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mono cursor-pointer rounded-lg border border-line px-2.5 py-1.5 text-xs text-dim hover:bg-track hover:text-ink"
          title="Reload the trace"
        >
          <Icon name="refresh" className="size-3.5" />
        </button>
      </div>

      {loading && <p className="mono text-xs text-dim">Reading the transcript…</p>}
      {!loading && !trace && (
        <EmptyState
          icon="file-question"
          title="This transcript is gone"
          desc="The file is no longer on disk, or it holds no readable journal lines."
        />
      )}

      {trace && summary && (
        <>
          <StatGrid cols={5}>
            <Stat label="Wall time" value={fmtElapsed(summary.wallMs)} hint={trace.startedAt ? `since ${relAge(trace.startedAt)}` : undefined} />
            <Stat
              label="Model time"
              value={fmtElapsed(summary.modelMs)}
              hint={summary.wallMs > 0 ? `${pct(summary.modelMs / summary.wallMs)} of wall` : undefined}
            />
            <Stat
              label="Tool time"
              value={fmtElapsed(summary.toolMs)}
              hint={summary.wallMs > 0 ? `${pct(summary.toolMs / summary.wallMs)} of wall` : undefined}
            />
            <Stat
              label="Idle"
              title="Wall time no model and no tool held"
              value={fmtElapsed(summary.idleMs)}
              hint={summary.wallMs > 0 ? `${pct(summary.idleMs / summary.wallMs)} of wall` : undefined}
            />
            <Stat label="Turns" value={fmt(summary.turns)} />
            <Stat label="Requests" value={fmt(summary.requests)} hint={`${fmt(summary.toolCalls)} tool calls`} />
            <Stat
              label="Agents"
              title="Tool calls that hand the work to another agent"
              value={fmt(summary.agents)}
            />
            <Stat label="Tokens" value={fmtShort(summary.totalTokens)} />
            <Stat label="Cost" value={money(summary.costUsd)} hint="Public rate card estimate" />
          </StatGrid>

          <Card title="Timeline" icon="route" description={KEY_HINTS} flush>
            <div className="flex flex-col gap-3 p-3">
              <div className="flex flex-wrap items-center gap-3">
                <Segmented label="Axis" value={mode} options={AXIS_MODES} onChange={setMode} />
                <label className="mono flex cursor-pointer items-center gap-1.5 text-[11px] text-dim">
                  <input
                    type="checkbox"
                    checked={compressIdle}
                    onChange={(event) => setCompressIdle(event.target.checked)}
                    disabled={mode !== "time"}
                    className="size-3 accent-[var(--accent)]"
                  />
                  Compress idle
                </label>
                <div className="ml-auto flex items-center gap-3">
                  <TraceLegend />
                  <span className="mono text-[11px] text-dim">Search spans</span>
                  <input
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setMatchIndex(0);
                    }}
                    placeholder="Tool, model, text…"
                    aria-label="Search spans"
                    className="mono h-7 w-[190px] rounded-lg border border-line bg-panel px-2 text-[11px] placeholder:text-dim"
                  />
                  {search.trim() && (
                    <span className="mono flex items-center gap-1 text-[11px] text-dim">
                      <span className="tabular-nums">
                        {matches.length === 0 ? "0" : `${matchIndex + 1}/${matches.length}`}
                      </span>
                      <button
                        type="button"
                        className="cursor-pointer rounded border border-line px-1 text-[10px] hover:bg-track disabled:opacity-40"
                        onClick={() => cycleMatch(-1)}
                        disabled={matches.length === 0}
                        aria-label="Previous match"
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        className="cursor-pointer rounded border border-line px-1 text-[10px] hover:bg-track disabled:opacity-40"
                        onClick={() => cycleMatch(1)}
                        disabled={matches.length === 0}
                        aria-label="Next match"
                      >
                        ›
                      </button>
                    </span>
                  )}
                </div>
              </div>
              <Timeline
                tracks={tracks}
                scale={scale}
                markers={trace.markers}
                viewport={viewport ?? { u0: scale.domain[0], u1: scale.domain[1] }}
                onViewportChange={setViewport}
                selectedId={selection}
                onSelect={(span) => setSelection(span ? span.id : null)}
                matchIds={matchIds}
              />
              {trace.truncated && (
                <p className="mono m-0 text-[11px] text-dim">
                  This session ran past {fmt(allSpans.length)} spans, so the timeline shows its newest ones.
                </p>
              )}
            </div>
          </Card>

          <Card
            title="Transcript"
            icon="list"
            description={`${fmt(rows.length)} spans in order. Select one to inspect it.`}
            flush
          >
            {rows.length === 0 ? (
              <EmptyState icon="file-question" title="No spans" desc="This session holds no message entries." />
            ) : (
              <TranscriptList
                rows={rows}
                traceStart={trace.startedAt}
                traceEnd={trace.endedAt}
                selection={selection}
                onSelect={(span) => setSelection(span.id)}
                search={search}
                matchIds={matchIds}
              />
            )}
          </Card>

          <ToolAggregates toolStats={trace.toolStats} />
        </>
      )}

      <SpanDrawer
        sessionFile={sessionFile}
        span={selected}
        money={money}
        onClose={() => setSelection(null)}
      />
    </div>
  );
}
