// Traces: one row per root session, its subagent transcripts folded in. Opening one opens its flamegraph.
import { useMemo, useState } from "react";
import { Card, CellBar, PagedTable, Page, PageHeader, SearchInput } from "@/components/charts";
import type { Column } from "@/components/charts";
import { EmptyState } from "@/components/common";
import { VendorMark } from "@/components/brand";
import type { AgentStats, AgentTraceRow } from "@/lib/data";
import { displayModel, fmt, fmtElapsed, fmtShort, projectLabel, relAge, stampLocal } from "@/lib/format";

/** The last two segments of a path, the way the reference names a session's folder. */
function shortFolder(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.slice(-2).join("/");
}

/** The first model a session ran, with a count of the rest, and every name in a hover tip. */
function ModelList({ models }: { models: string[] }) {
  if (models.length === 0) return <span className="text-dim">-</span>;
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={models.join("\n")}>
      <VendorMark model={models[0]} tiny />
      <span className="mono min-w-0 truncate text-xs">{displayModel(models[0])}</span>
      {models.length > 1 && (
        <span className="mono shrink-0 rounded-full border border-line px-1.5 text-[10px] text-dim">
          +{models.length - 1}
        </span>
      )}
    </span>
  );
}

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
      (row) =>
        (row.title ?? "").toLowerCase().includes(needle) ||
        (row.cwd || row.project).toLowerCase().includes(needle) ||
        row.sessionFile.toLowerCase().includes(needle) ||
        row.models.some((model) => model.toLowerCase().includes(needle)),
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
            <span className="block truncate" title={row.sessionFile}>
              {row.title ?? row.sessionFile.split("/").pop() ?? row.sessionFile}
            </span>
            <span className="mono block truncate text-[11px] text-dim" title={row.cwd || projectLabel(row.project)}>
              {shortFolder(row.cwd || row.project)}
            </span>
          </span>
        ),
        sort: (row) => (row.title ?? row.sessionFile).toLowerCase(),
      },
      {
        key: "models",
        header: "Models",
        render: (row) => <ModelList models={row.models} />,
        sort: (row) => row.models.length,
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
        render: (row) => <span className="mono text-xs tabular-nums">{fmtElapsed(row.lastTs - row.firstTs)}</span>,
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
        key: "agents",
        header: "Agents",
        title: "Subagent transcripts folded into this session",
        align: "right",
        render: (row) => (
          <span className="mono text-xs tabular-nums">
            {row.subagents > 0 ? fmt(row.subagents) : <span className="text-dim">0</span>}
          </span>
        ),
        sort: (row) => row.subagents,
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
          <span className="flex flex-col items-end gap-1" title={row.unpriced > 0 ? `${fmt(row.unpriced)} unpriced requests` : undefined}>
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
        <PagedTable
          columns={columns}
          rows={filtered}
          rowKey={(row) => row.sessionFile}
          onRowClick={(row) => onOpenSession(row.sessionFile)}
          initialSort={{ key: "started", dir: "desc" }}
          perPage={25}
          ariaLabel="Sessions"
          empty={
            <EmptyState
              icon="folder-search"
              title={filter.trim() ? "No matching sessions" : "No sessions in this range"}
              desc={filter.trim() ? "Try a different filter." : "Start a session in your terminal."}
            />
          }
        />
      </Card>
    </Page>
  );
}
