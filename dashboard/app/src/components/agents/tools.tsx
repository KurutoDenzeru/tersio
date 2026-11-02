// Tools page: which tools the agent called, how often they failed, and what they cost.
import { useEffect, useMemo, useState } from "react";
import {
  Card,
  CellBar,
  ErrorRateBadge,
  PagedTable,
  Legend,
  Page,
  PageHeader,
  Segmented,
  Sparkline,
  Stat,
  StatGrid,
  TimeChart,
} from "@/components/charts";
import type { Column, SeriesSpec } from "@/components/charts";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import type { AgentStats, AgentToolRow, HealthReport, RtkVerbRow } from "@/lib/data";
import { AGENT_RANGE_LABEL, fetchHealth, installHeadroom, postHeadroomRuntime } from "@/lib/data";
import { PALETTE, fmt, fmtShort, pct, relAge, tsFull, tsLabel } from "@/lib/format";
import { cn } from "cn";
import { Spinner } from "@/components/ui/spinner";

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

/** The sentinel both pickers use for "no filter", so a real tool named `all` could never collide. */
const ALL = "\u0000all";

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
  rows: AgentToolRow[];
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

function buildView(agent: AgentStats): ToolsView {
  const rows = [...agent.tools].toSorted((a, b) => b.calls - a.calls);
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
  for (const point of agent.toolSeries) stamps.add(point.ts);
  const buckets = [...stamps].toSorted((a, b) => a - b);
  const at = new Map(buckets.map((ts, i) => [ts, i]));

  const callsByTool = new Map<string, number[]>();
  const errorsByTool = new Map<string, number[]>();
  for (const point of agent.toolSeries) {
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
  const sum = (values: Array<number | null>): number => values.reduce<number>((total, v) => total + (v ?? 0), 0);
  const callSeries = plotted.map(([tool, dense], i) => ({
    spec: { key: `t${i}`, label: tool, color: PALETTE[i % PALETTE.length], value: sum(dense) },
    values: dense.map((v) => (v > 0 ? v : null)),
  }));
  const errorSeries = plotted.map(([tool], i) => ({
    spec: { key: `t${i}`, label: tool, color: PALETTE[i % PALETTE.length], value: sum(errorsByTool.get(tool) ?? []) },
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
    const folded = ranked.length - TOP_TOOLS;
    callSeries.push({ spec: { key: "other", label: `Other (${folded})`, color: OTHER_COLOR, value: sum(rest) }, values: rest.map((v) => (v > 0 ? v : null)) });
    errorSeries.push({ spec: { key: "other", label: `Other (${folded})`, color: OTHER_COLOR, value: sum(restErrors) }, values: restErrors.map((v) => (v > 0 ? v : null)) });
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

export function ToolsPage({ agent, money }: { agent: AgentStats; money: (v: number) => string }) {
  const [metric, setMetric] = useState<CallMetric>("calls");
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [toolPick, setToolPick] = useState<string>(ALL);
  const [modelPick, setModelPick] = useState<string>(ALL);
  const [rtkShowAll, setRtkShowAll] = useState(false);
  const view = useMemo(() => buildView(agent), [agent]);
  const word = bucketWord(agent.bucketMs);

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

  const toolColumns = useMemo<Array<Column<AgentToolRow>>>(() => {
    const colorOf = (row: AgentToolRow): string => view.colors.get(row.tool) ?? OTHER_COLOR;
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
            <ErrorRateBadge rate={row.calls > 0 ? row.errors / row.calls : 0} title={`${fmt(row.errors)} failed of ${fmt(row.calls)} calls`} />
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

  const modelColumns = useMemo<Array<Column<AgentToolRow>>>(() => {
    const colorOf = (row: AgentToolRow): string => view.colors.get(row.tool) ?? OTHER_COLOR;
    const maxCalls = filteredMax(agent.toolsByModel);
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
            <ErrorRateBadge rate={row.calls > 0 ? row.errors / row.calls : 0} title={`${fmt(row.errors)} failed of ${fmt(row.calls)} calls`} />
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
  }, [view, money, agent.toolsByModel]);

  // Two pickers, one per column: the table names what it can show, so a typo cannot hide every row.
  const toolOptions = useMemo(
    () => [...new Set(agent.toolsByModel.map((row) => row.tool))].toSorted((a, b) => a.localeCompare(b)),
    [agent.toolsByModel],
  );
  const modelOptions = useMemo(
    () => [...new Set(agent.toolsByModel.map((row) => row.model))].toSorted((a, b) => a.localeCompare(b)),
    [agent.toolsByModel],
  );
  const modelRows = agent.toolsByModel.filter(
    (row) => (toolPick === ALL ? true : row.tool === toolPick) && (modelPick === ALL ? true : row.model === modelPick),
  );
  // The trigger reads its label from this map, so the sentinel shows as "All tools", not its raw value.
  const toolItems = useMemo(
    () => Object.fromEntries([[ALL, "All tools"] as const, ...toolOptions.map((tool) => [tool, tool] as const)]),
    [toolOptions],
  );
  const modelItems = useMemo(
    () => Object.fromEntries([[ALL, "All models"] as const, ...modelOptions.map((model) => [model, model] as const)]),
    [modelOptions],
  );
  // rtk's own numbers. A read that failed draws "not measured"; it never draws a zero.
  const rtk = agent.rtk;
  // Headroom is opt-in, so the card also carries the install offer when the binary is absent.
  const headroom = agent.headroom;
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [startingRuntime, setStartingRuntime] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const headroomPresent = health?.headroom?.present ?? false;
  // Routing has its own health gate; without this read the proxy row never appears on an installed machine.
  useEffect(() => {
    void fetchHealth().then(setHealth).catch(() => {});
  }, []);
  function startInstall(): void {
    setInstalling(true);
    setInstallError(null);
    void installHeadroom().then((result) => {
      setInstalling(false);
      setInstallError(result.error);
      if (result.present) void fetchHealth().then(setHealth).catch(() => {});
    });
  }
  function startRuntime(): void {
    setStartingRuntime(true);
    setRuntimeError(null);
    void postHeadroomRuntime().then((result) => {
      if (result?.ok) {
        // Routing and savings come from the server's next read; reload is the honest refresh.
        window.location.reload();
        return;
      }
      setStartingRuntime(false);
      setRuntimeError(result?.error ?? "headroom did not start");
    });
  }
  const rtkRows = useMemo(() => {
    const rows = [...rtk.byVerb].toSorted((a, b) => b.saved - a.saved);
    // The tail is folded only when the reader asks for it, so the default view is the commands that matter.
    if (!rtkShowAll) return rows.filter((row) => row.saved > 0);
    return rows;
  }, [rtk.byVerb, rtkShowAll]);
  // The sparkline reads each verb's bytes kept, biggest first, so the shape shows the top-heaviness.
  const rtkSpark = useMemo(() => rtk.byVerb.filter((row) => row.saved > 0).map((row) => row.saved), [rtk.byVerb]);
  const rtkColumns = useMemo<Array<Column<RtkVerbRow>>>(() => {
    const maxSaved = Math.max(1, ...rtkRows.map((row) => row.saved));
    return [
      {
        key: "command",
        header: "Command",
        sort: (row) => row.command,
        render: (row) => (
          <span className="mono flex min-w-0 items-center gap-2">
            <span className="truncate" title={row.command}>{row.command}</span>
            {row.variants && row.variants > 1 ? (
              <span className="shrink-0 text-[10px] text-dim" title={`${fmt(row.variants)} distinct commands folded here`}>
                {fmt(row.variants)}
              </span>
            ) : null}
          </span>
        ),
      },
      {
        key: "count",
        header: "Runs",
        align: "right",
        sort: (row) => row.count,
        render: (row) => <span className="tabular-nums">{fmt(row.count)}</span>,
      },
      {
        key: "saved",
        header: "Saved",
        title: "Bytes rtk kept out of the transcript, from rtk's own history",
        align: "right",
        sort: (row) => row.saved,
        render: (row) => (
          <span className="flex flex-col items-end gap-1">
            <span className={`tabular-nums ${row.saved < 0 ? "text-danger" : ""}`}>
              {row.saved < 0 ? `+${fmtShort(Math.abs(row.saved))} B` : `${fmtShort(row.saved)} B`}
            </span>
            <CellBar value={Math.abs(row.saved)} max={maxSaved} color={row.saved < 0 ? "var(--danger)" : "var(--accent)"} />
          </span>
        ),
      },
      {
        key: "pct",
        header: "Saved %",
        title: "Saved bytes over the bytes the verb took in",
        align: "right",
        sort: (row) => row.avgPct,
        render: (row) => <span className={`tabular-nums ${row.avgPct < 0 ? "text-danger" : "text-dim"}`}>{pct(row.avgPct / 100, 0)}</span>,
      },
    ];
  }, [rtkRows]);

  return (
    <Page>
      <PageHeader
        title="Tools"
        description={`Which tools ran in ${AGENT_RANGE_LABEL[agent.range]}, how often they failed, and what they cost.`}
      />

      <div className="flex flex-col gap-3">
        <StatGrid cols={6}>
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
          <Stat
            label="Saved by RTK"
            title="Bytes rtk kept out of context, from its own history"
            value={rtk.measured ? `${fmtShort(rtk.saved)} B` : "not measured"}
            hint={
              rtk.measured
                ? `${pct(rtk.avgPct / 100, 1)} of the ${fmtShort(rtk.input)} B those commands took in`
                : "rtk's history could not be read"
            }
            spark={rtkSpark}
          />
          <Stat
            label="Saved by Headroom"
            title="Tokens Headroom's compression kept out of context, from its own savings ledger"
            value={headroom.measured ? fmtShort(headroom.tokensSaved) : "not measured"}
            hint={
              headroom.measured
                ? `${pct(headroom.savingsPercent / 100, 1)} of ${fmtShort(headroom.tokensBefore)} across ${fmt(headroom.calls)} calls`
                : "install Headroom and wrap a tool to record savings"
            }
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
        icon={metric === "calls" ? "wrench" : "circle-alert"}
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
              tick={(value) => tsLabel(value, agent.bucketMs)}
              label={(value) => tsFull(value, agent.bucketMs)}
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
              valueFmt={fmt}
            />
          </div>
        )}
      </Card>

      <Card title="By tool" icon="wrench" description={`${ATTRIBUTION_NOTE}.`} flush>
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
        title="By tool and model" icon="table"
        description="Which models call which tools, and how often those calls fail"
        flush
        actions={
          <div className="flex items-center gap-2">
            <Select value={toolPick} items={toolItems} onValueChange={(next) => setToolPick(next ?? ALL)}>
              <SelectTrigger size="sm" aria-label="Filter by tool" className="w-[150px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={ALL}>All tools</SelectItem>
                  {toolOptions.map((tool) => (
                    <SelectItem key={tool} value={tool}>{tool}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select value={modelPick} items={modelItems} onValueChange={(next) => setModelPick(next ?? ALL)}>
              <SelectTrigger size="sm" aria-label="Filter by model" className="w-[230px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={ALL}>All models</SelectItem>
                  {modelOptions.map((model) => (
                    <SelectItem key={model} value={model}>{model}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
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

      <Card
        title="Saved by rtk" icon="zap"
        description={
          rtk.measured
            ? `Bytes rtk kept out of context in ${AGENT_RANGE_LABEL[agent.range]}, from rtk's own history. Commands are folded by their leading verb.`
            : "rtk's history could not be read, so nothing here is measured."
        }
        flush
        actions={
          <label className="mono flex cursor-pointer items-center gap-1.5 text-[11px] text-dim">
            <input
              type="checkbox"
              checked={rtkShowAll}
              onChange={(event) => setRtkShowAll(event.target.checked)}
              className="size-3 accent-[var(--accent)]"
            />
            Show every command
          </label>
        }
      >
        {rtk.measured ? (
          <>
            <PagedTable
              columns={rtkColumns}
              rows={rtkRows}
              rowKey={(row) => row.command}
              initialSort={{ key: "saved", dir: "desc" }}
              perPage={20}
              empty={
                <p className="p-4 text-xs text-dim">
                  rtk ran {fmt(rtk.commands)} commands in this range and kept no bytes.
                </p>
              }
              ariaLabel="Saved by rtk, folded by verb"
            />
            <div className="mono flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-3.5 py-2 text-[11px] text-dim">
              <span>
                rtk ran <span className="text-ink">{fmt(rtk.rtkCalls)}</span> of {fmt(rtk.eligibleCalls)} eligible bash calls
                ({pct(rtk.adoptionPct / 100, 0)})
              </span>
              {rtk.missedCalls > 0 && <span>{fmt(rtk.missedCalls)} left on the plain shell</span>}
              <span className="ml-auto">
                {fmtShort(rtk.saved)} B saved of {fmtShort(rtk.input)} B taken in
              </span>
            </div>
          </>
        ) : (
          <p className="p-4 text-xs text-dim">
            rtk's history could not be read, so its savings are not measured.
            {rtk.failure ? ` (${rtk.failure})` : ""}
          </p>
        )}
      </Card>
      <Card
        title="Headroom" icon="leaf"
        description={
          headroom.measured
            ? `Tokens Headroom's compression kept out of context, from its durable ledger. Today: ${fmtShort(headroom.todayTokens)} · 7 days: ${fmtShort(headroom.last7Tokens)} · 30 days: ${fmtShort(headroom.last30Tokens)}.`
            : headroomPresent
              ? `Headroom ${health?.headroom?.version ? `(${health.headroom.version}) ` : ""}is installed, but no savings are recorded yet. Run \`headroom wrap <tool>\` — or flip the switch on the Quick start canvas — so traffic flows through it.`
              : "Headroom is not installed. Installing adds the headroom CLI; nothing is enabled on its own."
        }
        flush
        actions={
          !headroomPresent && !headroom.measured ? (
            <Button size="sm" className="mono h-8 gap-1.5 rounded-xl" disabled={installing} onClick={startInstall}>
              {installing ? <Spinner className="size-3.5" /> : <Icon name="download" className="size-3.5" />}
              <span>{installing ? "Installing Headroom" : installError ? "Retry install" : "Install Headroom"}</span>
            </Button>
          ) : undefined
        }
      >
        {headroom.measured ? (
          <div className="mono flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-3.5 py-2 text-[11px] text-dim">
            <span>
              lifetime <span className="text-ink">{fmtShort(headroom.tokensSaved)}</span> of {fmtShort(headroom.tokensBefore)} tokens ({pct(headroom.savingsPercent / 100, 1)})
            </span>
            <span>{fmt(headroom.calls)} calls</span>
            <span>${headroom.costUsd.toFixed(4)} avoided</span>
            {headroom.byClient.slice(0, 4).map((row) => (
              <span key={row.client}>
                {row.client}: {fmt(row.calls)} calls · {fmtShort(row.tokensSaved)} saved
              </span>
            ))}
          </div>
        ) : (
          <p className="p-4 text-xs text-dim">
            {installError ? (
              <>
                Install failed: <span className="text-danger">{installError}</span> — run it yourself with{" "}
                <span className="mono">uv tool install &quot;headroom-ai[all]&quot;</span> or{" "}
                <span className="mono">pip install --user &quot;headroom-ai[all]&quot;</span>.
              </>
            ) : headroomPresent ? (
              "No compression events yet, so nothing is measured."
            ) : (
              `Headroom savings are not measured. ${headroom.failure ? `(${headroom.failure}) ` : ""}Enable the mode with /headroom on, or set it as a session default in Settings.`
            )}
          </p>
        )}
        {/* Routing is what separates "installed and idle" from "installed and working". */}
        {headroomPresent ? (
          <div className="border-t border-line px-3.5 py-2">
            {headroom.routing.measured ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="mono text-[10px] uppercase tracking-[0.12em] text-dim">routing</span>
                {(headroom.routes ?? []).map((route) => (
                  <span
                    key={route.host}
                    className={cn("mono rounded border px-1.5 py-0.5 text-[10px]", route.routed ? "border-success/40 text-success" : "border-warning/40 text-warning")}
                    title={route.text}
                  >
                    {route.host} {route.measured ? (route.routed ? "routed" : "not routed") : "route unknown"}
                  </span>
                ))}
                <span className={cn("mono rounded border px-1.5 py-0.5 text-[10px]", headroom.routing.proxyUp ? "border-success/40 text-success" : "border-danger/40 text-danger")}>
                  proxy {headroom.routing.proxyUp ? "up" : "down"}
                </span>
                {headroom.proxy ? (
                  <span className="mono text-[10px] text-dim" title="Live counters since this proxy process started">
                    {fmt(headroom.proxy.requests)} requests · {fmt(headroom.proxy.compressed)} compressed · {fmtShort(headroom.proxy.tokensSaved)} saved
                  </span>
                ) : (
                  <span className="mono text-[10px] text-dim">counters not measured</span>
                )}
                {headroom.routing.failing.length > 0 ? (
                  headroom.routing.failing.slice(0, 4).map((check) => (
                    <span key={check.name} className="mono text-[10px] text-dim" title={check.hint ?? undefined}>
                      {check.name} {check.status}: {check.summary}
                    </span>
                  ))
                ) : (
                  <span className="mono text-[10px] text-dim">every check passing</span>
                )}
                {!headroom.routing.proxyUp ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mono ml-auto h-6 gap-1 px-2 text-[10px]"
                    disabled={startingRuntime}
                    onClick={startRuntime}
                  >
                    {startingRuntime ? <Spinner className="size-3" /> : <Icon name="play" className="size-3" />}
                    {startingRuntime ? "Starting" : "Start Headroom"}
                  </Button>
                ) : null}
                {runtimeError ? <span className="mono text-[10px] text-danger">{runtimeError}</span> : null}
              </div>
            ) : (
              <span className="mono text-[10px] text-dim">routing not measured — {headroom.routing.failure || "headroom doctor did not answer"}</span>
            )}
          </div>
        ) : null}
      </Card>
    </Page>
  );
}

/** The largest call count in a slice, so each meter reads against its own table. */
function filteredMax(rows: AgentToolRow[]): number {
  let max = 0;
  for (const row of rows) if (row.calls > max) max = row.calls;
  return max;
}
