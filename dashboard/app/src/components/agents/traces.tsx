// Traces: one row per session transcript. The parent renders the timeline, this page lists and opens it.
import { useMemo, useState } from "react";
import { Card, CellBar, PagedTable, Page, PageHeader, QueryView, SearchInput } from "@/components/charts";
import type { Column } from "@/components/charts";
import { EmptyState } from "@/components/common";
import type { AgentStats, AgentTraceRow } from "@/lib/data";
import { fmt, fmtMs, fmtShort, projectLabel, relAge, stampLocal } from "@/lib/format";

export function TracesPage({
  agent,
  money,
  onOpenSession,
}: {
  agent: AgentStats;
  money: (v: number) => string;
  onOpenSession: (sessionFile: string) => void;
}) {
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return agent.traces;
    return agent.traces.filter(
      (row) => projectLabel(row.project).toLowerCase().includes(needle) || row.sessionFile.toLowerCase().includes(needle),
    );
  }, [agent.traces, filter]);

  const maxCost = useMemo(() => Math.max(0, ...filtered.map((row) => row.costUsd)), [filtered]);

  const columns = useMemo<Array<Column<AgentTraceRow>>>(
    () => [
      {
        key: "session",
        header: "Session",
        render: (row) => (
          <span className="block min-w-0">
            <span className="block truncate">{row.sessionFile.split("/").pop() ?? row.sessionFile}</span>
            <span className="mono block truncate text-[11px] text-dim">{projectLabel(row.project)}</span>
          </span>
        ),
        sort: (row) => row.sessionFile.toLowerCase(),
      },
      {
        key: "models",
        header: "Models",
        render: (row) => <span className="mono text-xs tabular-nums">{fmt(row.models)}</span>,
        sort: (row) => row.models,
      },
      {
        key: "started",
        header: "Started",
        align: "right",
        render: (row) => (
          <span className="text-dim" title={stampLocal(row.firstTs)}>
            {relAge(row.firstTs)}
          </span>
        ),
        sort: (row) => row.firstTs,
      },
      {
        key: "duration",
        header: "Duration",
        align: "right",
        render: (row) => <span className="mono text-xs tabular-nums">{fmtMs(row.lastTs - row.firstTs)}</span>,
        sort: (row) => row.lastTs - row.firstTs,
      },
      {
        key: "requests",
        header: "Requests",
        align: "right",
        render: (row) => <span className="mono text-xs tabular-nums">{fmt(row.requests)}</span>,
        sort: (row) => row.requests,
      },
      {
        key: "tools",
        header: "Tools",
        align: "right",
        render: (row) => <span className="mono text-xs tabular-nums">{fmt(row.toolCalls)}</span>,
        sort: (row) => row.toolCalls,
      },
      {
        key: "tokens",
        header: "Tokens",
        align: "right",
        render: (row) => <span className="mono text-xs tabular-nums">{fmtShort(row.tokens)}</span>,
        sort: (row) => row.tokens,
      },
      {
        key: "cost",
        header: "Cost",
        align: "right",
        width: 150,
        render: (row) => (
          <span className="flex flex-col items-end gap-1">
            <span className="mono text-xs tabular-nums">
              {row.costUsd === 0 && row.unpriced > 0 ? "N/A" : money(row.costUsd)}
            </span>
            <CellBar value={row.costUsd} max={maxCost} />
          </span>
        ),
        sort: (row) => row.costUsd,
      },
    ],
    [maxCost, money],
  );

  const total = agent.traces.length;

  return (
    <Page>
      <PageHeader
        title="Traces"
        description="Recent sessions with subagent activity folded in. Open one to inspect its timeline."
      />
      <Card
        title="Sessions" icon="square-chart-gantt"
        description={filter.trim() ? `${fmt(filtered.length)} of ${fmt(total)} most recent` : `${fmt(total)} most recent`}
        actions={
          <SearchInput
            value={filter}
            onChange={setFilter}
            placeholder="Filter by title, project, model…"
            label="Filter sessions"
            className="w-[260px]"
          />
        }
        flush
      >
        <QueryView
          empty={total === 0}
          emptyTitle="No sessions found"
          emptyDesc="Run a sync to index recent activity."
        >
          <PagedTable
            columns={columns}
            rows={filtered}
            rowKey={(row) => row.sessionFile}
            onRowClick={(row) => onOpenSession(row.sessionFile)}
            initialSort={{ key: "started", dir: "desc" }}
            perPage={25}
            ariaLabel="Sessions"
            empty={<EmptyState icon="circle-slash" title="No matching sessions" desc="Try a different filter." />}
          />
        </QueryView>
      </Card>
    </Page>
  );
}
