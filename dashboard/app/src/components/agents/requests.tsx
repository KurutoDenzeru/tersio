// Requests: the range in six figures, then the request log with a search and a status filter.
import { useMemo, useState } from "react";
import { Card, PagedTable, Page, PageHeader, SearchInput, Segmented, Stat, StatGrid } from "@/components/charts";
import type { Column } from "@/components/charts";
import { ProviderMark, VendorMark } from "@/components/brand";
import { EmptyState } from "@/components/common";
import { displayModel, fmt, fmtMs, fmtShort, pct, projectLabel, relAge, runStatusOf, whenStamp } from "@/lib/format";
import type { AgentRequestRow, AgentStats } from "@/lib/data";

type RowStatus = "completed" | "aborted" | "failed";
type StatusFilter = "all" | RowStatus;

const STATUS_LABEL: Record<RowStatus, string> = { completed: "Completed", aborted: "Aborted", failed: "Failed" };
const STATUS_TONE: Record<RowStatus, string> = {
  completed: "var(--accent)",
  aborted: "var(--warn-border)",
  failed: "var(--danger)",
};

// Mirrors the row cap in extensions/shared/agent-stats.ts; at the cap, only the newest rows ride along.
const RECENT_LIMIT = 200;

// The reference window phrases, so the page copy reads like the one it mirrors.
const WINDOW: Record<AgentStats["range"], string> = {
  "1h": "the last hour",
  "24h": "the last 24 hours",
  "7d": "the last 7 days",
  "30d": "the last 30 days",
  "90d": "the last 90 days",
  all: "all time",
};

/** Only `error` is a failure; `aborted` still ran, so it keeps its own bucket. */
function rowStatus(row: AgentRequestRow): RowStatus {
  const st = runStatusOf(row.stopReason);
  return st === "error" ? "failed" : st;
}

export function RequestsPage({
  agent,
  money,
  onOpenRequest,
}: {
  agent: AgentStats;
  money: (v: number) => string;
  onOpenRequest: (row: AgentRequestRow) => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const windowLabel = WINDOW[agent.range];
  const stats = agent.requestStats;
  const rows = agent.recent;
  // Mirrors the row cap in extensions/shared/agent-stats.ts; at the cap only the newest ride
  // along, and the requests view ships no range total to compare against.
  const complete = rows.length < RECENT_LIMIT;

  const counts = useMemo(() => {
    const next: Record<StatusFilter, number> = { all: rows.length, completed: 0, aborted: 0, failed: 0 };
    for (const row of rows) next[rowStatus(row)]++;
    return next;
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter(
      (row) =>
        (status === "all" || rowStatus(row) === status) &&
        (needle === "" ||
          row.model.toLowerCase().includes(needle) ||
          row.provider.toLowerCase().includes(needle) ||
          row.project.toLowerCase().includes(needle) ||
          (row.errorMessage ?? "").toLowerCase().includes(needle)),
    );
  }, [rows, search, status]);

  const statusOptions: ReadonlyArray<{ value: StatusFilter; label: string }> = (
    ["all", "completed", "aborted", "failed"] as const
  ).map((value) => ({
    value,
    label: `${value === "all" ? "All" : STATUS_LABEL[value]} ${fmtShort(counts[value])}`,
  }));

  const oldest = rows.length > 0 ? Math.min(...rows.map((row) => row.ts)) : null;

  return (
    <Page>
      <PageHeader
        title="Requests"
        description={`Every model call in ${windowLabel}, newest first. Open a row for its full payload.`}
      />

      <StatGrid cols={6}>
        <Stat
          label="Requests"
          value={fmt(stats.requests)}
          hint={stats.oldest === null ? `none in ${windowLabel}` : `since ${relAge(stats.oldest)}`}
        />
        <Stat
          label="Failed"
          value={fmt(stats.failed)}
          hint={`${stats.requests > 0 ? pct(stats.failed / stats.requests) : "–"} · ${fmt(stats.aborted)} aborted`}
        />
        <Stat label="Tokens" title="Total tokens across these requests" value={fmtShort(stats.tokens)} />
        <Stat
          label="API-equivalent cost"
          title="What these requests would cost at public API rates"
          value={money(stats.costUsd)}
          hint={stats.unpriced > 0 ? `${fmt(stats.unpriced)} unpriced` : undefined}
        />
        <Stat
          label="Median duration"
          value={fmtMs(stats.medianDurationMs)}
          hint={`p95 ${fmtMs(stats.p95DurationMs)}`}
        />
        <Stat label="Median TTFT" title="Time to first token" value={fmtMs(stats.medianTtftMs)} />
      </StatGrid>

      <Card
        title="Request log" icon="list"
        description={
          complete
            ? `${fmt(filtered.length)} of ${fmt(stats.requests)} requests in ${windowLabel}`
            : `${fmt(filtered.length)} of the latest ${fmt(rows.length)} requests`
        }
        actions={
          <>
            <SearchInput label="Search requests" value={search} onChange={setSearch} placeholder="Model, provider or project" />
            <Segmented label="Status" value={status} options={statusOptions} onChange={setStatus} />
          </>
        }
        flush
      >
        <PagedTable
          columns={buildRequestColumns(money)}
          rows={filtered}
          rowKey={(row) => `${row.sessionFile}:${row.entryId}`}
          onRowClick={onOpenRequest}
          initialSort={{ key: "time", dir: "desc" }}
          perPage={25}
          ariaLabel="Request log"
          empty={
            <EmptyState
              icon="circle-slash"
              title={stats.requests === 0 ? `No requests in ${windowLabel}` : "No requests match"}
              desc={stats.requests === 0 ? "Nothing was recorded in this window." : "Clear the search or status filter."}
            />
          }
        />
        {!complete && (
          <p className="mono m-0 border-t border-line px-3.5 py-2.5 text-[11px] text-dim">
            Showing the latest {fmt(rows.length)} requests, back to {oldest === null ? "–" : whenStamp(oldest)}. Older
            requests in {windowLabel} are not loaded.
          </p>
        )}
      </Card>
    </Page>
  );
}

function buildRequestColumns(money: (v: number) => string): Array<Column<AgentRequestRow>> {
  return [
  {
    key: "model",
    header: "Model",
    sort: (row) => row.model,
    render: (row) => (
      <span className="flex min-w-0 items-center gap-2">
        <VendorMark model={row.model} tiny />
        <span className="min-w-0">
          <span className="mono block truncate">{displayModel(row.model)}</span>
          <span className="flex items-center gap-1.5 text-[11px] text-dim">
            <ProviderMark provider={row.provider} tiny />
            <span className="truncate">{row.provider || "–"}</span>
          </span>
        </span>
      </span>
    ),
  },
  {
    key: "time",
    header: "When",
    sort: (row) => row.ts,
    render: (row) => (
      <span className="text-dim" title={whenStamp(row.ts)}>
        {relAge(row.ts)}
      </span>
    ),
  },
  {
    key: "project",
    header: "Project",
    sort: (row) => row.project,
    render: (row) => (
      <span className="mono block max-w-[180px] truncate text-dim" title={row.project}>
        {projectLabel(row.project)}
      </span>
    ),
  },
  {
    key: "input",
    header: "Input",
    title: "Uncached input tokens",
    align: "right",
    sort: (row) => row.input,
    render: (row) => fmtShort(row.input),
  },
  {
    key: "cache",
    header: "Cache read",
    title: "Cache read tokens (hover a cell for cache writes)",
    align: "right",
    sort: (row) => row.cacheRead,
    render: (row) => <span title={`Cache write: ${fmt(row.cacheWrite)}`}>{fmtShort(row.cacheRead)}</span>,
  },
  { key: "output", header: "Output", align: "right", sort: (row) => row.output, render: (row) => fmtShort(row.output) },
  {
    key: "cost",
    header: "Cost",
    title: "API-equivalent estimate",
    align: "right",
    sort: (row) => row.costUsd,
    render: (row) => money(row.costUsd),
  },
  {
    key: "duration",
    header: "Duration",
    align: "right",
    sort: (row) => row.durationMs ?? -1,
    render: (row) => fmtMs(row.durationMs),
  },
  {
    key: "ttft",
    header: "TTFT",
    title: "Time to first token",
    align: "right",
    sort: (row) => row.ttftMs ?? -1,
    render: (row) => <span className="text-dim">{fmtMs(row.ttftMs)}</span>,
  },
  {
    key: "status",
    header: "Status",
    sort: (row) => rowStatus(row),
    render: (row) => {
      const status = rowStatus(row);
      return (
        <span className="flex min-w-0 items-center gap-2" title={row.errorMessage ?? undefined}>
          <span className="size-2 shrink-0 rounded-full" style={{ background: STATUS_TONE[status] }} />
          <span className="min-w-0">
            <span className="block">{STATUS_LABEL[status]}</span>
            <span className="mono block truncate text-[11px] text-dim">{row.stopReason || "–"}</span>
          </span>
        </span>
      );
    },
  },
  ];
}
