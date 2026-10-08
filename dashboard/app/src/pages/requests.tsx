// Requests: every recorded request, sortable, filterable, and openable for full detail.
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";

import { DataTable } from "@/components/dash/data-table";
import { Note, Section, StatStrip, StripStat, TableFilter, percent } from "@/components/dash/composites";
import { RequestDrawer } from "@/components/request-drawer";
import { StatusBadge } from "@/components/recent";
import { meanValue, medianValue, rangeView } from "@/lib/aggregate";
import { fmt } from "@/lib/format";
import type { RecentRequestRow } from "@/lib/data";
import { RANGE_LABELS } from "@/lib/route";
import type { PageProps } from "./types";

function duration(ms: number | undefined): string {
  if (ms === undefined) return "N/A";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function when(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

const numeric = (value: string) => <span className="mono block text-right tabular-nums">{value}</span>;

export function RequestsPage({ data, cutoff, since, range, money }: PageProps) {
  // `rangeView` and `requests()` build fresh objects each call, so both are memoized: sorting or
  // opening a drawer re-renders this component, and re-filtering 2000 rows per click froze the page.
  const view = useMemo(() => rangeView(data, range, cutoff, since), [data, range, cutoff, since]);
  const rows = useMemo(() => view.requests(), [view]);
  const totals = useMemo(() => view.totals(), [view]);
  const ttftMean = useMemo(() => meanValue(rows, (r) => r.tf), [rows]);
  const ttftCount = useMemo(() => rows.filter((r) => r.tf !== undefined).length, [rows]);
  const medianElapsed = useMemo(() => medianValue(rows, (r) => r.d), [rows]);
  const elapsedCount = useMemo(() => rows.filter((r) => r.d !== undefined).length, [rows]);
  const [open, setOpen] = useState<RecentRequestRow | null>(null);
  const [filter, setFilter] = useState("");

  const columns = useMemo<ColumnDef<RecentRequestRow, unknown>[]>(
    () => [
      {
        id: "when",
        header: "When",
        accessorFn: (r) => r.t,
        cell: ({ row }) => <span className="mono whitespace-nowrap text-dim">{when(row.original.t)}</span>,
      },
      {
        id: "model",
        header: "Model",
        accessorFn: (r) => data.modelLabels[r.m] ?? r.m,
        cell: ({ getValue }) => (
          <span className="mono block max-w-[240px] truncate" title={String(getValue())}>
            {String(getValue())}
          </span>
        ),
      },
      {
        id: "host",
        header: "Host",
        accessorFn: (r) => r.h ?? "—",
        cell: ({ getValue }) => <span className="mono text-dim">{String(getValue())}</span>,
      },
      { id: "i", header: "In", accessorFn: (r) => r.i, cell: ({ getValue }) => numeric(fmt(Number(getValue()))) },
      { id: "o", header: "Out", accessorFn: (r) => r.o, cell: ({ getValue }) => numeric(fmt(Number(getValue()))) },
      {
        id: "cache",
        header: "Cache",
        accessorFn: (r) => (r.cr ?? 0) + (r.cw ?? 0),
        cell: ({ getValue }) => numeric(fmt(Number(getValue()))),
      },
      {
        id: "est",
        header: "Est.",
        accessorFn: (r) => r.est,
        cell: ({ row }) => numeric(money(row.original.est)),
      },
      {
        id: "d",
        header: "Elapsed",
        // A missing duration sorts below every measured one rather than counting as instant.
        accessorFn: (r) => r.d ?? -1,
        cell: ({ row }) => numeric(duration(row.original.d)),
      },
      {
        id: "tf",
        header: "TTFT",
        // A missing first-token time sorts below every measured one rather than counting as instant.
        accessorFn: (r) => r.tf ?? -1,
        cell: ({ row }) => numeric(duration(row.original.tf)),
      },
      {
        id: "st",
        header: "Status",
        accessorFn: (r) => r.st,
        cell: ({ row }) => <StatusBadge r={row.original} />,
      },
      {
        id: "tools",
        header: "Tools",
        accessorFn: (r) => r.tools?.length ?? 0,
        cell: ({ row }) => numeric(fmt(row.original.tools?.length ?? 0)),
      },
    ],
    [data.modelLabels, money],
  );

  return (
    <div className="grid gap-9">
      <StatStrip>
        <StripStat label="Requests" value={fmt(rows.length)} sub={`${fmt(totals.errors)} errors`} />
        <StripStat label="Completed" value={percent(totals.completionPct)} sub={`${fmt(totals.aborted)} aborted`} />
        <StripStat
          label="Tokens"
          value={fmt(totals.tokens.input + totals.tokens.output)}
          sub="input + output"
        />
        <StripStat label="Cache hit" value={percent(totals.cacheHitPct)} sub="read / (input + read)" />
        <StripStat
          label="TTFT"
          value={ttftMean === null ? "N/A" : duration(ttftMean)}
          sub={`${fmt(ttftCount)} of ${fmt(rows.length)} recorded`}
        />
        <StripStat
          label="Median elapsed"
          value={medianElapsed === null ? "N/A" : duration(medianElapsed)}
          sub={`${fmt(elapsedCount)} measured`}
        />
      </StatStrip>

      <Section
        title="Requests"
        hint="Newest first by default. Select a row to inspect it."
        actions={<TableFilter value={filter} onChange={setFilter} placeholder="Filter by model" />}
      >
        <DataTable
          columns={columns}
          data={rows}
          filterColumn="model"
          filterValue={filter}
          pageSize={25}
          onRowClick={setOpen}
          caption="Recorded requests"
          emptyTitle={`No requests in ${RANGE_LABELS[range]}`}
          emptyBody="Choose a wider range, or run an agent session to record some usage."
        />
        {(view.partial || rows.length >= 2000) && (
          <Note tone="warn">
            {view.short
              ? "The payload carries the newest 2000 requests, so every figure for this range is a lower bound."
              : "The payload carries the newest 2000 requests, so a long range is a lower bound here. Token and cost figures above come from the per-day tables and are exact."}
          </Note>
        )}
      </Section>

      {open && <RequestDrawer row={open} money={money} onClose={() => setOpen(null)} />}
    </div>
  );
}
