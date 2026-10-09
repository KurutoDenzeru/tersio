// Tools page: which tools omp called, how often they failed, and what they cost.
import { useMemo, useState } from "react";
import {
  Card,
  CellBar,
  PagedTable,
  Legend,
  Page,
  PageHeader,
  SearchInput,
  Segmented,
  Sparkline,
  Stat,
  StatGrid,
  TimeChart,
} from "@/components/charts";
import type { Column, SeriesSpec } from "@/components/charts";
import type { OmpStats, OmpToolRow } from "@/lib/data";
import { OMP_RANGE_LABEL } from "@/lib/data";
import { PALETTE, fmt, fmtShort, pct, relAge, tsFull, tsLabel } from "@/lib/format";

type CallMetric = "calls" | "errors";

const METRIC_OPTIONS: ReadonlyArray<{ value: CallMetric; label: string }> = [
  { value: "calls", label: "Calls" },
  { value: "errors", label: "Errors" },
];

/** Tools stacked in the calls chart; the rest fold into "Other". */
const TOP_TOOLS = 6;

const ATTRIBUTION_NOTE =
  "Tokens and API-equivalent cost of each invoking turn, split evenly across that turn's tool calls";

const OTHER_COLOR = "var(--dim)";

/** The bucket reads as a word, so a chart description can name it. */
function bucketWord(bucketMs: number): string {
  if (bucketMs < 3_600_000) return "5 minutes";
  if (bucketMs < 86_400_000) return "hour";
  return "day";
}

interface ToolTotals {
  calls: number;
  errors: number;
  tools: number;
  tokens: number;
  output: number;
  cost: number;
  unpriced: number;
  resultChars: number;
  argsChars: number;
}

interface ToolsView {
  rows: OmpToolRow[];
  colors: Map<string, string>;
  buckets: number[];
  totalCalls: number[];
  totalErrors: number[];
  callSeries: Array<{ spec: SeriesSpec; values: Array<number | null> }>;
  errorSeries: Array<{ spec: SeriesSpec; values: Array<number | null> }>;
  trend: Map<string, number[]>;
  totals: ToolTotals;
  maxCalls: number;
}

function buildView(omp: OmpStats): ToolsView {
  const rows = [...omp.tools].toSorted((a, b) => b.calls - a.calls);
  const colors = new Map(rows.map((row, i) => [row.tool, PALETTE[i % PALETTE.length]]));

  const totals: ToolTotals = {
    calls: 0,
    errors: 0,
    tools: rows.length,
    tokens: 0,
    output: 0,
    cost: 0,
    unpriced: 0,
    resultChars: 0,
    argsChars: 0,
  };
  for (const row of rows) {
    totals.calls += row.calls;
    totals.errors += row.errors;
    totals.tokens += row.totalTokensShare;
    totals.output += row.outputTokensShare;
    totals.cost += row.costShare;
    totals.unpriced += row.unpricedShare;
    totals.resultChars += row.resultChars;
    totals.argsChars += row.argsChars;
  }

  const stamps = new Set<number>();
  for (const point of omp.toolSeries) stamps.add(point.ts);
  const buckets = [...stamps].toSorted((a, b) => a - b);
  const at = new Map(buckets.map((ts, i) => [ts, i]));

  const callsByTool = new Map<string, number[]>();
  const errorsByTool = new Map<string, number[]>();
  for (const point of omp.toolSeries) {
    const index = at.get(point.ts);
    if (index === undefined) continue;
    const calls = callsByTool.get(point.tool) ?? Array.from({ length: buckets.length }, () => 0);
    calls[index] += point.calls;
    callsByTool.set(point.tool, calls);
    const errors = errorsByTool.get(point.tool) ?? Array.from({ length: buckets.length }, () => 0);
    errors[index] += point.errors;
    errorsByTool.set(point.tool, errors);
  }

  const totalCalls = Array.from({ length: buckets.length }, () => 0);
  const totalErrors = Array.from({ length: buckets.length }, () => 0);
  for (const dense of callsByTool.values()) for (let i = 0; i < buckets.length; i += 1) totalCalls[i] += dense[i];
  for (const dense of errorsByTool.values()) for (let i = 0; i < buckets.length; i += 1) totalErrors[i] += dense[i];

  const ranked = [...callsByTool.entries()].toSorted(
    (a, b) => b[1].reduce((s, v) => s + v, 0) - a[1].reduce((s, v) => s + v, 0),
  );
  const plotted = ranked.slice(0, TOP_TOOLS);
  const callSeries = plotted.map(([tool, dense], i) => ({
    spec: { key: `t${i}`, label: tool, color: PALETTE[i % PALETTE.length] },
    values: dense.map((v) => (v > 0 ? v : null)),
  }));
  const errorSeries = plotted.map(([tool], i) => ({
    spec: { key: `t${i}`, label: tool, color: PALETTE[i % PALETTE.length] },
    values: (errorsByTool.get(tool) ?? []).map((v) => (v > 0 ? v : null)),
  }));
  if (ranked.length > TOP_TOOLS) {
    const rest = Array.from({ length: buckets.length }, () => 0);
    const restErrors = Array.from({ length: buckets.length }, () => 0);
    for (let i = 0; i < buckets.length; i += 1) {
      let plottedSum = 0;
      let plottedErrors = 0;
      for (const series of callSeries) plottedSum += series.values[i] ?? 0;
      for (const series of errorSeries) plottedErrors += series.values[i] ?? 0;
      rest[i] = Math.max(0, totalCalls[i] - plottedSum);
      restErrors[i] = Math.max(0, totalErrors[i] - plottedErrors);
    }
    callSeries.push({ spec: { key: "other", label: "Other", color: OTHER_COLOR }, values: rest.map((v) => (v > 0 ? v : null)) });
    errorSeries.push({ spec: { key: "other", label: "Other", color: OTHER_COLOR }, values: restErrors.map((v) => (v > 0 ? v : null)) });
  }

  return {
    rows,
    colors,
    buckets,
    totalCalls,
    totalErrors,
    callSeries,
    errorSeries,
    trend: callsByTool,
    totals,
    maxCalls: rows[0]?.calls ?? 0,
  };
}

export function ToolsPage({ omp, money }: { omp: OmpStats; money: (v: number) => string }) {
  const [metric, setMetric] = useState<CallMetric>("calls");
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState("");
  const view = useMemo(() => buildView(omp), [omp]);
  const word = bucketWord(omp.bucketMs);

  const toggle = (key: string): void => {
    setHidden((held) => {
      const next = new Set(held);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const active = metric === "calls" ? view.callSeries : view.errorSeries;
  const shown = active.filter((series) => !hidden.has(series.spec.key));
  const data = view.buckets.map((ts, i) => {
    const row: { ts: number } & Record<string, number | null> = { ts };
    for (const series of shown) row[series.spec.key] = series.values[i];
    return row;
  });

  const toolColumns = useMemo<Array<Column<OmpToolRow>>>(() => {
    const colorOf = (row: OmpToolRow): string => view.colors.get(row.tool) ?? OTHER_COLOR;
    return [
      {
        key: "tool",
        header: "Tool",
        sort: (row) => row.tool,
        render: (row) => (
          <span className="flex min-w-0 items-center gap-2">
            <span className="size-2 shrink-0 rounded-[2px]" style={{ background: colorOf(row) }} aria-hidden="true" />
            <span className="mono truncate" title={row.tool}>{row.tool}</span>
          </span>
        ),
      },
      {
        key: "trend",
        header: "Trend",
        title: "Calls per bucket over the range",
        render: (row) => {
          const dense = view.trend.get(row.tool);
          return dense && dense.length > 1 ? (
            <Sparkline values={dense} color={colorOf(row)} />
          ) : (
            <span className="text-dim">–</span>
          );
        },
      },
      {
        key: "calls",
        header: "Calls",
        align: "right",
        sort: (row) => row.calls,
        render: (row) => (
          <span className="flex flex-col items-end gap-1" title={`${pct(row.calls / Math.max(1, view.totals.calls))} of all tool calls`}>
            <span className="tabular-nums">{fmt(row.calls)}</span>
            <CellBar value={row.calls} max={view.maxCalls} color={colorOf(row)} />
          </span>
        ),
      },
      {
        key: "errors",
        header: "Errors",
        title: "Calls whose result came back flagged as an error",
        align: "right",
        sort: (row) => (row.calls > 0 ? row.errors / row.calls : 0),
        render: (row) => (
          <span className="flex items-center justify-end gap-2">
            <span className="tabular-nums text-dim">{fmt(row.errors)}</span>
            <span className="tabular-nums">{row.errors > 0 ? pct(row.errors / row.calls) : "0%"}</span>
          </span>
        ),
      },
      {
        key: "args",
        header: "Args",
        title: "Characters of serialized tool-call arguments",
        align: "right",
        sort: (row) => row.argsChars,
        render: (row) => <span className="tabular-nums">{fmtShort(row.argsChars)}</span>,
      },
      {
        key: "result",
        header: "Result",
        title: "Characters of tool-result text fed back into context",
        align: "right",
        sort: (row) => row.resultChars,
        render: (row) => <span className="tabular-nums">{fmtShort(row.resultChars)}</span>,
      },
      {
        key: "avgResult",
        header: "Result / call",
        title: "Mean tool-result characters per call",
        align: "right",
        sort: (row) => (row.calls > 0 ? row.resultChars / row.calls : 0),
        render: (row) => (
          <span className="tabular-nums text-dim">{fmtShort(row.calls > 0 ? Math.round(row.resultChars / row.calls) : 0)}</span>
        ),
      },
      {
        key: "tokens",
        header: "Attr. tokens",
        title: ATTRIBUTION_NOTE,
        align: "right",
        sort: (row) => row.totalTokensShare,
        render: (row) => (
          <span className="flex items-center justify-end gap-2" title={`${pct(row.totalTokensShare / Math.max(1, view.totals.tokens))} of attributed tokens`}>
            <span className="tabular-nums">{fmtShort(Math.round(row.totalTokensShare))}</span>
            <span className="text-dim">{pct(row.totalTokensShare / Math.max(1, view.totals.tokens), 0)}</span>
          </span>
        ),
      },
      {
        key: "cost",
        header: "Attr. cost",
        title: `${ATTRIBUTION_NOTE}; API-equivalent estimate`,
        align: "right",
        sort: (row) => row.costShare,
        render: (row) => (
          <span className="flex items-center justify-end gap-2" title={`${pct(row.costShare / Math.max(1, view.totals.cost))} of attributed cost`}>
            <span className="tabular-nums">{money(row.costShare)}</span>
            <span className="text-dim">{pct(row.costShare / Math.max(1, view.totals.cost), 0)}</span>
          </span>
        ),
      },
      {
        key: "lastUsed",
        header: "Last used",
        align: "right",
        sort: (row) => row.lastUsed ?? 0,
        render: (row) => <span className="text-dim">{row.lastUsed ? relAge(row.lastUsed) : "–"}</span>,
      },
    ];
  }, [view, money]);

  const modelColumns = useMemo<Array<Column<OmpToolRow>>>(() => {
    const colorOf = (row: OmpToolRow): string => view.colors.get(row.tool) ?? OTHER_COLOR;
    const maxCalls = filteredMax(omp.toolsByModel);
    return [
      {
        key: "tool",
        header: "Tool",
        sort: (row) => row.tool,
        render: (row) => (
          <span className="flex min-w-0 items-center gap-2">
            <span className="size-2 shrink-0 rounded-[2px]" style={{ background: colorOf(row) }} aria-hidden="true" />
            <span className="mono truncate" title={row.tool}>{row.tool}</span>
          </span>
        ),
      },
      {
        key: "model",
        header: "Model",
        sort: (row) => row.model,
        render: (row) => (
          <span className="flex min-w-0 flex-col">
            <span className="mono truncate">{row.model || "(unknown)"}</span>
            {row.provider && <span className="text-dim">{row.provider}</span>}
          </span>
        ),
      },
      {
        key: "calls",
        header: "Calls",
        align: "right",
        sort: (row) => row.calls,
        render: (row) => (
          <span className="flex flex-col items-end gap-1">
            <span className="tabular-nums">{fmt(row.calls)}</span>
            <CellBar value={row.calls} max={maxCalls} color={colorOf(row)} />
          </span>
        ),
      },
      {
        key: "errors",
        header: "Errors",
        title: "Calls whose result came back flagged as an error",
        align: "right",
        sort: (row) => (row.calls > 0 ? row.errors / row.calls : 0),
        render: (row) => (
          <span className="flex items-center justify-end gap-2">
            <span className="tabular-nums text-dim">{fmt(row.errors)}</span>
            <span className="tabular-nums">{row.errors > 0 ? pct(row.errors / row.calls) : "0%"}</span>
          </span>
        ),
      },
      {
        key: "result",
        header: "Result",
        title: "Characters of tool-result text fed back into context",
        align: "right",
        sort: (row) => row.resultChars,
        render: (row) => <span className="tabular-nums">{fmtShort(row.resultChars)}</span>,
      },
      {
        key: "tokens",
        header: "Attr. tokens",
        title: ATTRIBUTION_NOTE,
        align: "right",
        sort: (row) => row.totalTokensShare,
        render: (row) => <span className="tabular-nums">{fmtShort(Math.round(row.totalTokensShare))}</span>,
      },
      {
        key: "cost",
        header: "Attr. cost",
        title: `${ATTRIBUTION_NOTE}; API-equivalent estimate`,
        align: "right",
        sort: (row) => row.costShare,
        render: (row) => <span className="tabular-nums">{money(row.costShare)}</span>,
      },
      {
        key: "lastUsed",
        header: "Last used",
        align: "right",
        sort: (row) => row.lastUsed ?? 0,
        render: (row) => <span className="text-dim">{row.lastUsed ? relAge(row.lastUsed) : "–"}</span>,
      },
    ];
  }, [view, money, omp.toolsByModel]);

  const needle = filter.trim().toLowerCase();
  const modelRows = needle
    ? omp.toolsByModel.filter((row) => row.tool.toLowerCase().includes(needle) || row.model.toLowerCase().includes(needle))
    : omp.toolsByModel;

  return (
    <Page>
      <PageHeader
        title="Tools"
        description={`Which tools omp called in ${OMP_RANGE_LABEL[omp.range]}, how often they failed, and what they cost.`}
      />

      <div className="flex flex-col gap-3">
        <StatGrid cols={5}>
          <Stat
            label="Tool calls"
            value={fmt(view.totals.calls)}
            hint={`${fmt(view.totals.errors)} failed`}
            spark={view.totalCalls}
          />
          <Stat
            label="Distinct tools"
            value={fmt(view.totals.tools)}
            hint={view.rows[0] ? `Most used: ${view.rows[0].tool}` : undefined}
          />
          <Stat
            label="Error rate"
            title="Tool results that came back flagged as errors"
            value={pct(view.totals.calls > 0 ? view.totals.errors / view.totals.calls : 0)}
            hint={`${fmt(view.totals.calls - view.totals.errors)} succeeded`}
            spark={view.totalErrors}
          />
          <Stat
            label="Attributed tokens"
            title={ATTRIBUTION_NOTE}
            value={fmtShort(Math.round(view.totals.tokens))}
            hint={`${fmtShort(Math.round(view.totals.output))} output`}
          />
          <Stat
            label="Attributed cost"
            title={`${ATTRIBUTION_NOTE}; API-equivalent estimate`}
            value={money(view.totals.cost)}
            hint={view.totals.unpriced > 0 ? `${fmt(Math.round(view.totals.unpriced))} unpriced requests` : "API-equivalent"}
          />
        </StatGrid>
        <StatGrid cols={4}>
          <Stat
            size="sm"
            label="Result text"
            title="Characters of tool-result text fed back into context"
            value={`${fmtShort(view.totals.resultChars)} chars`}
          />
          <Stat
            size="sm"
            label="Call arguments"
            title="Characters of serialized tool-call arguments"
            value={`${fmtShort(view.totals.argsChars)} chars`}
          />
          <Stat
            size="sm"
            label="Avg result per call"
            value={`${fmtShort(view.totals.calls > 0 ? Math.round(view.totals.resultChars / view.totals.calls) : 0)} chars`}
          />
          <Stat
            size="sm"
            label="Avg arguments per call"
            value={`${fmtShort(view.totals.calls > 0 ? Math.round(view.totals.argsChars / view.totals.calls) : 0)} chars`}
          />
        </StatGrid>
      </div>

      <Card
        index={1}
        title={metric === "calls" ? "Calls over time" : "Errors over time"}
        description={`Per ${word}, top ${TOP_TOOLS} tools stacked`}
        actions={<Segmented label="Call metric" options={METRIC_OPTIONS} value={metric} onChange={setMetric} />}
      >
        {view.buckets.length === 0 ? (
          <p className="text-xs text-dim">No tool calls in this range.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <TimeChart
              data={data}
              series={shown.map((series) => series.spec)}
              xKey="ts"
              stacked
              height={260}
              tick={(value) => tsLabel(value, omp.bucketMs)}
              label={(value) => tsFull(value, omp.bucketMs)}
              valueFmt={fmt}
              ariaLabel={metric === "calls" ? "Tool calls per bucket, stacked by tool" : "Tool errors per bucket, stacked by tool"}
              summary={
                metric === "calls"
                  ? `Tool calls per ${word}, stacked by tool.`
                  : `Tool errors per ${word}, stacked by tool.`
              }
            />
            <Legend
              items={active.map((series) => series.spec)}
              active={new Set(shown.map((series) => series.spec.key))}
              onToggle={toggle}
            />
          </div>
        )}
      </Card>

      <Card index={2} title="By tool" description={`${ATTRIBUTION_NOTE}.`} flush>
        <PagedTable
          columns={toolColumns}
          rows={view.rows}
          rowKey={(row) => row.tool}
          initialSort={{ key: "calls", dir: "desc" }}
          perPage={20}
          empty={<p className="p-4 text-xs text-dim">No tool calls in this range.</p>}
          ariaLabel="Tools by call volume"
        />
      </Card>

      <Card
        index={3}
        title="By tool and model"
        description="Which models call which tools, and how often those calls fail"
        flush
        actions={
          <SearchInput
            value={filter}
            onChange={setFilter}
            placeholder="Filter by tool or model"
            label="Filter by tool or model"
            className="w-[220px]"
          />
        }
      >
        <PagedTable
          columns={modelColumns}
          rows={modelRows}
          rowKey={(row) => `${row.tool}\u0000${row.model}\u0000${row.provider}`}
          initialSort={{ key: "calls", dir: "desc" }}
          perPage={25}
          empty={<p className="p-4 text-xs text-dim">No matching tool calls in this range.</p>}
          ariaLabel="Tools by model"
        />
      </Card>
    </Page>
  );
}

/** The largest call count in a slice, so each meter reads against its own table. */
function filteredMax(rows: OmpToolRow[]): number {
  let max = 0;
  for (const row of rows) if (row.calls > max) max = row.calls;
  return max;
}
