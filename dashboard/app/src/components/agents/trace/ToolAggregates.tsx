// Per-tool duration totals for one trace, longest first. The columns follow the reference's tool
// aggregates: calls, the failed calls, and total, mean, and longest duration.
import { Card, CellBar, PagedTable } from "@/components/charts";
import type { Column } from "@/components/charts";
import { Badge } from "@/components/ui/badge";
import { fmt, fmtElapsed } from "@/lib/format";
import type { AgentTraceToolStat } from "@/lib/data";

export function ToolAggregates({ toolStats }: { toolStats: AgentTraceToolStat[] }) {
  if (toolStats.length === 0) return null;
  const max = Math.max(...toolStats.map((stat) => stat.totalMs));

  const columns: Array<Column<AgentTraceToolStat>> = [
    {
      key: "tool",
      header: "Tool",
      render: (row) => <span className="mono truncate">{row.tool}</span>,
      sort: (row) => row.tool,
    },
    { key: "calls", header: "Calls", align: "right", sort: (row) => row.calls, render: (row) => fmt(row.calls) },
    {
      key: "errors",
      header: "Errors",
      align: "right",
      title: "Calls whose result came back flagged as an error",
      sort: (row) => row.errors,
      render: (row) =>
        row.errors > 0 ? (
          <Badge variant="destructive" className="mono px-1.5 text-[10px]">
            {fmt(row.errors)} failed
          </Badge>
        ) : (
          <span className="text-dim">0</span>
        ),
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      width: 180,
      render: (row) => (
        <span className="flex flex-col items-end gap-1">
          <span className="tabular-nums">{fmtElapsed(row.totalMs)}</span>
          <CellBar value={row.totalMs} max={max} color="var(--warn-border)" />
        </span>
      ),
      sort: (row) => row.totalMs,
    },
    { key: "avg", header: "Avg", align: "right", sort: (row) => row.avgMs, render: (row) => fmtElapsed(row.avgMs) },
    { key: "max", header: "Max", align: "right", sort: (row) => row.maxMs, render: (row) => fmtElapsed(row.maxMs) },
  ];

  return (
    <Card title="Tool aggregates" icon="wrench" description={`${fmt(toolStats.length)} tools, by total time`} flush>
      <PagedTable
        columns={columns}
        rows={toolStats}
        rowKey={(row) => row.tool}
        initialSort={{ key: "total", dir: "desc" }}
        perPage={10}
        ariaLabel="Tool aggregates"
      />
    </Card>
  );
}
