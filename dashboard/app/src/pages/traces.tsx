// Traces: every session recorded on this machine, and the span timeline of the one selected.
// Both views are served by the dashboard API (/sessions, /session/trace, /session/entry), which
// reads the transcripts after the fact. Nothing here is synthesized: what a session recorded is
// what these lanes show, and a file:// export has no server to read them from.
import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";

import { DataTable } from "@/components/dash/data-table";
import { TraceDrawer } from "@/components/dash/trace-drawer";
import { TraceWaterfall } from "@/components/dash/trace-waterfall";
import {
  Note,
  Section,
  Stat,
  StatGrid,
  StatStrip,
  StripStat,
  TableFilter,
} from "@/components/dash/composites";
import { Icon } from "@/components/icon";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { fetchSessions, fetchTrace, isFileExport } from "@/lib/data";
import type { SessionListEntry, SessionTrace, TraceSpan, TraceToolStat } from "@/lib/data";
import { displayModel, fmt, fmtMs, relAge, whenStamp } from "@/lib/format";
import type { PageProps } from "./types";

function baseName(p: string | null): string {
  if (!p) return "";
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

/** A session names itself when it can; an untitled one falls back to its folder. */
function sessionTitle(s: SessionListEntry): string {
  return s.title || baseName(s.folder) || baseName(s.file);
}

const numeric = (value: string) => <span className="mono block text-right tabular-nums">{value}</span>;

const TOOL_COLUMNS: ColumnDef<TraceToolStat, unknown>[] = [
  { id: "tool", header: "Tool", accessorFn: (t) => t.tool, cell: ({ getValue }) => <span className="mono block max-w-[260px] truncate">{String(getValue())}</span> },
  { id: "calls", header: "Calls", accessorFn: (t) => t.calls, cell: ({ getValue }) => numeric(fmt(Number(getValue()))) },
  { id: "errors", header: "Errors", accessorFn: (t) => t.errors, cell: ({ getValue }) => numeric(fmt(Number(getValue()))) },
  { id: "totalMs", header: "Total", accessorFn: (t) => t.totalMs, cell: ({ getValue }) => numeric(fmtMs(Number(getValue()))) },
  { id: "maxMs", header: "Max", accessorFn: (t) => t.maxMs, cell: ({ getValue }) => numeric(fmtMs(Number(getValue()))) },
];

/** The range picker has nothing to do with a session list; say so rather than imply a filter. */
function RangeNote() {
  return (
    <Note>
      The range picker does not narrow this page: each session is self-contained, so every recorded
      transcript is listed newest first whatever the range is set to.
    </Note>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="flex w-fit items-center gap-1.5 rounded-[10px] border border-line px-2.5 py-1.5 text-xs text-dim hover:text-ink"
    >
      <Icon name="arrow-left" className="size-3.5" /> Sessions
    </button>
  );
}

function SessionsView({
  modelLabel,
  money,
  onOpen,
}: {
  modelLabel: (model: string) => string;
  money: (v: number) => string;
  onOpen: (file: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [sessions, setSessions] = useState<SessionListEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The server does the matching, so the field debounces instead of filtering a fetched page.
  useEffect(() => {
    const id = setTimeout(() => setQ(query.trim()), 250);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    const ctl = new AbortController();
    let live = true;
    fetchSessions(q, ctl.signal)
      .then((rows) => {
        if (!live) return;
        setSessions(rows);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!live) return;
        setSessions([]);
        setError(err instanceof Error ? err.message : "Could not read the session list.");
      });
    return () => {
      live = false;
      ctl.abort();
    };
  }, [q]);

  const columns = useMemo<ColumnDef<SessionListEntry, unknown>[]>(
    () => [
      {
        id: "session",
        header: "Session",
        accessorFn: (s) => sessionTitle(s),
        cell: ({ row }) => (
          <span className="grid gap-0.5">
            <span className="mono block max-w-[320px] truncate font-semibold" title={row.original.file}>
              {sessionTitle(row.original)}
            </span>
            <span className="mono block max-w-[320px] truncate text-[11px] text-dim">
              {row.original.folder ?? "no working directory"}
            </span>
          </span>
        ),
      },
      {
        id: "models",
        header: "Models",
        accessorFn: (s) => s.models.join(" "),
        cell: ({ row }) => (
          <span className="flex max-w-[260px] flex-wrap items-center gap-1">
            {row.original.models.slice(0, 2).map((model) => (
              <Badge key={model} variant="outline" className="mono max-w-[150px] truncate text-[10px]">
                {modelLabel(model)}
              </Badge>
            ))}
            {row.original.models.length > 2 && (
              <span className="mono text-[10px] text-dim">+{row.original.models.length - 2}</span>
            )}
          </span>
        ),
      },
      { id: "requests", header: "Req", accessorFn: (s) => s.requests, cell: ({ getValue }) => numeric(fmt(Number(getValue()))) },
      { id: "toolCalls", header: "Tools", accessorFn: (s) => s.toolCalls, cell: ({ getValue }) => numeric(fmt(Number(getValue()))) },
      { id: "subagents", header: "Subagents", accessorFn: (s) => s.subagents, cell: ({ getValue }) => numeric(fmt(Number(getValue()))) },
      { id: "tokens", header: "Tokens", accessorFn: (s) => s.totalTokens, cell: ({ getValue }) => numeric(fmt(Number(getValue()))) },
      {
        id: "cost",
        header: "Cost",
        accessorFn: (s) => s.costTotal,
        cell: ({ row }) => (
          <span
            className="mono block text-right tabular-nums"
            title={row.original.unpricedRequests ? `${fmt(row.original.unpricedRequests)} requests had no public price` : undefined}
          >
            {money(row.original.costTotal)}
          </span>
        ),
      },
      {
        id: "started",
        header: "Started",
        accessorFn: (s) => s.startedAt,
        cell: ({ row }) => (
          <span className="mono whitespace-nowrap text-dim" title={whenStamp(row.original.startedAt)}>
            {relAge(row.original.startedAt)}
          </span>
        ),
      },
      {
        id: "duration",
        header: "Wall",
        // Sort by the duration, not by the start it was derived from.
        accessorFn: (s) => s.endedAt - s.startedAt,
        cell: ({ row }) => numeric(fmtMs(row.original.endedAt - row.original.startedAt)),
      },
    ],
    [modelLabel, money],
  );

  const shown = sessions?.length ?? 0;
  return (
    <div className="grid gap-9">
      <Section
        title="Sessions"
        hint={sessions ? `${fmt(shown)} shown · newest first · matches title, folder, and model` : "Newest first"}
        actions={<TableFilter value={query} onChange={setQuery} placeholder="Search sessions" />}
      >
        <RangeNote />
        {error && <Note tone="warn">{error}</Note>}
        {sessions === null ? (
          <p className="m-0 flex items-center gap-2 text-sm text-dim">
            <Spinner /> Loading sessions
          </p>
        ) : (
          <DataTable
            columns={columns}
            data={sessions}
            pageSize={25}
            onRowClick={(s) => onOpen(s.file)}
            caption="Recorded agent sessions, newest first"
            emptyTitle={q ? `No session matches “${q}”` : "No sessions recorded"}
            emptyBody={
              q
                ? "Search matches a session title, its folder, and its model ids."
                : "Tersio found no pi or omp transcript under the sessions directories. Run a session, then reload."
            }
          />
        )}
      </Section>
    </div>
  );
}

function TraceView({
  file,
  modelLabel,
  money,
  onBack,
}: {
  file: string;
  modelLabel: (model: string) => string;
  money: (v: number) => string;
  onBack: () => void;
}) {
  const [trace, setTrace] = useState<SessionTrace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<TraceSpan | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [highlightTrackId, setHighlightTrackId] = useState<string | null>(null);
  const [toolFilter, setToolFilter] = useState("");

  useEffect(() => {
    const ctl = new AbortController();
    let live = true;
    fetchTrace(file, ctl.signal)
      .then((next) => {
        if (!live) return;
        setTrace(next);
        setError(null);
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : "Could not read that transcript.");
      });
    return () => {
      live = false;
      ctl.abort();
    };
  }, [file, attempt]);

  if (error) {
    return (
      <div className="grid gap-6">
        <BackButton onBack={onBack} />
        <Section title="Trace unavailable">
          <Note tone="warn">{error}</Note>
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="w-fit rounded-[10px] border border-line px-2.5 py-1.5 text-xs text-ink hover:bg-accent-soft"
          >
            Read it again
          </button>
        </Section>
      </div>
    );
  }

  if (!trace) {
    return (
      <div className="grid gap-6">
        <BackButton onBack={onBack} />
        <p className="m-0 flex items-center gap-2 text-sm text-dim">
          <Spinner /> Reading {baseName(file)}
        </p>
      </div>
    );
  }

  const s = trace.summary;
  const spanCount = trace.tracks.reduce((n, track) => n + track.spans.length, 0);
  const title = trace.title || baseName(trace.cwd) || baseName(trace.file);
  const selectedTrack = trace.tracks.find((track) => track.id === selectedTrackId) ?? null;

  return (
    <div className="grid gap-8">
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <BackButton onBack={onBack} />
          <h2 className="m-0 min-w-0 truncate text-base font-semibold tracking-[-0.01em]">{title}</h2>
          <span className="mono text-[11px] text-dim">
            {whenStamp(trace.startedAt)} → {whenStamp(trace.endedAt)}
          </span>
        </div>
        <p className="mono m-0 truncate text-[11px] text-dim" title={trace.file}>
          {trace.cwd ?? trace.file}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {s.models.map((model) => (
            <Badge key={model} variant="outline" className="mono text-[10px]">
              {modelLabel(model)}
            </Badge>
          ))}
          {s.unpricedRequests > 0 && (
            <span className="mono text-[11px] text-dim">
              no public price for {fmt(s.unpricedRequests)} request{s.unpricedRequests === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <RangeNote />
      </div>

      <div className="grid gap-5">
        <StatStrip>
          <StripStat label="Wall" value={fmtMs(s.wallMs)} sub="first turn to last activity" />
          <StripStat label="Model" value={fmtMs(s.modelMs)} sub="summed over tracks, so it can exceed wall" />
          <StripStat label="Tool" value={fmtMs(s.toolMs)} sub="summed over tracks" />
          <StripStat label="Idle" value={fmtMs(s.idleMs)} sub="wall not spent in a span" />
        </StatStrip>
        <StatGrid>
          <Stat label="Turns" value={fmt(s.turns)} sub="user turns, main track" />
          <Stat label="Requests" value={fmt(s.requests)} sub="model requests, all tracks" />
          <Stat label="Tool calls" value={fmt(s.toolCalls)} />
          <Stat label="Subagents" value={fmt(s.subagents)} sub="task transcripts" />
          <Stat label="Tokens" value={fmt(s.totalTokens)} />
          <Stat label="Cost" value={money(s.costTotal)} sub="API-equivalent" />
        </StatGrid>
      </div>

      <Section
        title="Timeline"
        hint={
          spanCount === 0
            ? "no spans recorded"
            : `${fmt(trace.tracks.length)} tracks · ${fmt(spanCount)} spans · select a bar for its row`
        }
      >
        {spanCount === 0 ? (
          <Note>
            This session recorded no span: its transcript has no assistant or tool row with a time on it, so
            there is nothing to draw.
          </Note>
        ) : (
          <TraceWaterfall
            trace={trace}
            selectedSpanId={selected?.id ?? null}
            highlightTrackId={highlightTrackId}
            onSelectSpan={(span, track) => {
              setSelected(span);
              setSelectedTrackId(track.id);
            }}
          />
        )}
      </Section>

      <Section
        title="Tool calls"
        hint="Slowest tool first"
        actions={
          s.toolStats.length > 0 ? (
            <TableFilter value={toolFilter} onChange={setToolFilter} placeholder="Filter by tool" />
          ) : undefined
        }
      >
        {s.toolStats.length === 0 ? (
          <Note>This session recorded no tool call.</Note>
        ) : (
          <DataTable
            columns={TOOL_COLUMNS}
            data={s.toolStats}
            filterColumn="tool"
            filterValue={toolFilter}
            pageSize={15}
            caption="Tool calls in this session, slowest first"
            emptyTitle="No tool matches"
            emptyBody="Clear the filter to see every tool this session called."
          />
        )}
      </Section>

      {selected && selectedTrack && (
        <TraceDrawer
          key={selected.id}
          span={selected}
          track={selectedTrack}
          childTrack={trace.tracks.find((track) => track.id === selected.childTrackId) ?? null}
          modelLabel={modelLabel}
          onTrack={(id) => {
            setHighlightTrackId(id);
            setSelected(null);
          }}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

export function TracesPage({ data, session, onSession, money }: PageProps) {
  if (isFileExport()) {
    return (
      <Note tone="warn">
        Session traces are read from the dashboard server, which a file:// export has none of. Open the
        served dashboard with <span className="mono">tersio dashboard</span> to list sessions here.
      </Note>
    );
  }

  const modelLabel = (model: string): string => data.modelLabels[model] ?? displayModel(model);
  return session ? (
    // Keyed by file, so switching session starts the trace view from a clean slate.
    <TraceView key={session} file={session} modelLabel={modelLabel} money={money} onBack={() => onSession?.(null)} />
  ) : (
    <SessionsView modelLabel={modelLabel} money={money} onOpen={(file) => onSession?.(file)} />
  );
}
