// Span drawer: what one span recorded, plus the raw transcript row behind it.
// The row is read on open from /session/entry, keyed by the track's file and the span's entryId.
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { fetchEntry } from "@/lib/data";
import type { TraceSpan, TraceTrack, TranscriptEntry } from "@/lib/data";
import { fmt, fmtMs, whenStamp } from "@/lib/format";
import { KIND_LABEL } from "./trace-waterfall";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline gap-3 text-[13px]">
      <span className="mono w-20 shrink-0 text-[11px] tracking-[0.1em] text-dim uppercase">{label}</span>
      <span className="mono min-w-0 flex-1 text-right [overflow-wrap:break-word]">{children}</span>
    </div>
  );
}

function stampText(value: unknown): string {
  if (typeof value === "number") return whenStamp(value);
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? value : whenStamp(ms);
  }
  return "—";
}

/** A message body is text when the host wrote text; anything else is shown as the row's JSON. */
function entryBody(entry: TranscriptEntry): string {
  if (typeof entry.content === "string") return entry.content;
  return JSON.stringify(entry.content ?? entry, null, 2);
}

export function TraceDrawer({
  span,
  track,
  childTrack,
  modelLabel,
  onTrack,
  onClose,
}: {
  span: TraceSpan;
  track: TraceTrack;
  /** The track a subagent span spawned, when it has one. */
  childTrack: TraceTrack | null;
  modelLabel: (model: string) => string;
  onTrack: (id: string) => void;
  onClose: () => void;
}) {
  const [entry, setEntry] = useState<TranscriptEntry | null>(null);
  const [entryError, setEntryError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(span.entryId));

  useEffect(() => {
    if (!span.entryId) return;
    const ctl = new AbortController();
    let live = true;
    fetchEntry(track.file, span.entryId, ctl.signal)
      .then((row) => {
        if (!live) return;
        setEntry(row);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!live) return;
        setEntryError(err instanceof Error ? err.message : "Could not read that transcript row.");
        setLoading(false);
      });
    return () => {
      live = false;
      ctl.abort();
    };
  }, [span.entryId, track.file]);

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent
        side="right"
        className="w-[min(520px,calc(100vw-2rem))] gap-0 overflow-y-auto p-0 sm:max-w-[520px]"
        aria-describedby={undefined}
      >
        <SheetHeader className="border-b border-line">
          <SheetTitle className="mono pr-8 text-base tracking-tight [overflow-wrap:break-word]">{span.label}</SheetTitle>
          <SheetDescription className="mono">
            {KIND_LABEL[span.kind]} · {track.label} · {fmtMs(span.end - span.start)}
          </SheetDescription>
        </SheetHeader>

        <div className="grid gap-6 p-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="mono text-[10px]">{KIND_LABEL[span.kind]}</Badge>
            {span.error && <Badge variant="destructive" className="mono text-[10px]">error</Badge>}
            {span.unterminated && <Badge variant="outline" className="mono text-[10px]">unterminated</Badge>}
            {span.stop && <Badge variant="outline" className="mono text-[10px]">stop: {span.stop}</Badge>}
          </div>

          <section aria-label="Span" className="grid gap-2">
            <Row label="Duration">{fmtMs(span.end - span.start)}</Row>
            <Row label="Start">{whenStamp(span.start)}</Row>
            <Row label="End">{whenStamp(span.end)}</Row>
            {span.model && <Row label="Model">{modelLabel(span.model)}</Row>}
            {span.ttft !== undefined && <Row label="TTFT">{fmtMs(span.ttft)}</Row>}
            {span.tokens !== undefined && <Row label="Tokens">{fmt(span.tokens)}</Row>}
            <Row label="Track">{track.label}</Row>
            {span.entryId && <Row label="Row">{span.entryId}</Row>}
          </section>

          {span.detail && (
            <section aria-label="Detail" className="grid gap-2">
              <p className="mono m-0 text-[10px] tracking-[0.14em] text-dim uppercase">Detail</p>
              <pre className="mono m-0 max-h-64 overflow-auto rounded-[10px] border border-line bg-track/40 p-2.5 text-[11px] leading-relaxed whitespace-pre-wrap">
                {span.detail}
              </pre>
            </section>
          )}

          {childTrack && (
            <button
              type="button"
              onClick={() => onTrack(childTrack.id)}
              className="flex w-fit items-center gap-1.5 rounded-[10px] border border-line px-2.5 py-1.5 text-xs text-ink hover:bg-accent-soft"
            >
              Open the {childTrack.label} track
            </button>
          )}

          <section aria-label="Transcript row" className="grid gap-2">
            <p className="mono m-0 text-[10px] tracking-[0.14em] text-dim uppercase">Transcript row</p>
            {loading && (
              <p className="m-0 flex items-center gap-2 text-sm text-dim">
                <Spinner /> Reading the transcript row
              </p>
            )}
            {entryError && (
              <p className="m-0 rounded-[10px] border border-warn-border bg-warn-soft px-3 py-2 text-[11px] text-ink">
                {entryError}
              </p>
            )}
            {entry && (
              <>
                <Row label="Role">{typeof entry.role === "string" ? entry.role : "—"}</Row>
                <Row label="Time">{stampText(entry.timestamp)}</Row>
                <pre className="mono m-0 max-h-80 overflow-auto rounded-[10px] border border-line bg-track/40 p-2.5 text-[11px] leading-relaxed whitespace-pre-wrap [overflow-wrap:break-word]">
                  {entryBody(entry)}
                </pre>
              </>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
