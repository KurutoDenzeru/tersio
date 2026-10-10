// Models page: which models did the work, how fast they answered, and how they trend.
import { useMemo, useState } from "react";
import { cn } from "cn";
import {
  Card,
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
import type { AgentModelPerformancePoint, AgentRow, AgentStats } from "@/lib/data";
import { AGENT_RANGE_LABEL } from "@/lib/data";
import { PALETTE, fmt, fmtMs, fmtShort, pct, relAge, tsFull, tsLabel } from "@/lib/format";
import { Icon } from "@/components/icon";
import { VendorMark } from "@/components/brand";
import { Badge } from "@/components/ui/badge";

type ShareMode = "share" | "requests";

const SHARE_OPTIONS: ReadonlyArray<{ value: ShareMode; label: string }> = [
  { value: "share", label: "Share" },
  { value: "requests", label: "Requests" },
];

/** Models stacked in the share chart; the rest fold into "Other". */
const SHARE_LIMIT = 6;

const OTHER_COLOR = "var(--dim)";

/** One row identity: a model can appear under several providers, so both name the row. */
function modelKey(row: { key: string; provider: string }): string {
  return `${row.key}\u0000${row.provider}`;
}

/** The bucket reads as a word, so a chart description can name it. */
function bucketWord(bucketMs: number): string {
  if (bucketMs < 3_600_000) return "5 minutes";
  if (bucketMs < 86_400_000) return "hour";
  return "day";
}

interface ModelSeries {
  spec: SeriesSpec;
  requests: Array<number | null>;
  share: Array<number | null>;
}

interface ModelsView {
  rows: AgentRow[];
  top: AgentRow | null;
  colors: Map<string, string>;
  buckets: number[];
  requestTotals: number[];
  series: ModelSeries[];
  trend: Map<string, number[]>;
  providerCount: number;
  totalRequests: number;
  failedRequests: number;
  totalCost: number;
  unpricedRequests: number;
  maxRequests: number;
}

/** One row per model and provider, so the table matches the payload row for row. */
function buildView(agent: AgentStats): ModelsView {
  const rows = agent.byModel;
  const ordered = [...rows].toSorted((a, b) => b.requests - a.requests);
  const colors = new Map(ordered.map((row, i) => [`${row.key}\u0000${row.provider}`, PALETTE[i % PALETTE.length]]));

  let top: AgentRow | null = null;
  let totalRequests = 0;
  let failedRequests = 0;
  let totalCost = 0;
  let unpricedRequests = 0;
  for (const row of rows) {
    if (!top || row.requests > top.requests) top = row;
    totalRequests += row.requests;
    failedRequests += row.failed;
    totalCost += row.costUsd;
    unpricedRequests += row.unpricedRequests;
  }

  const stamps = new Set<number>();
  for (const series of agent.modelSeries) for (const point of series.points) stamps.add(point.ts);
  const buckets = [...stamps].toSorted((a, b) => a - b);
  const at = new Map(buckets.map((ts, i) => [ts, i]));

  const perModel = new Map<string, number[]>();
  for (const series of agent.modelSeries) {
    const dense = Array.from({ length: buckets.length }, () => 0);
    for (const point of series.points) {
      const index = at.get(point.ts);
      if (index !== undefined) dense[index] = point.requests;
    }
    perModel.set(series.model, dense);
  }

  const requestTotals = Array.from({ length: buckets.length }, () => 0);
  for (const dense of perModel.values()) {
    for (let i = 0; i < buckets.length; i += 1) requestTotals[i] += dense[i];
  }

  const ranked = [...perModel.entries()].toSorted(
    (a, b) => b[1].reduce((s, v) => s + v, 0) - a[1].reduce((s, v) => s + v, 0),
  );
  const plotted = ranked.slice(0, SHARE_LIMIT);
  const series: ModelSeries[] = plotted.map(([model, dense], i) => ({
    spec: { key: `m${i}`, label: model, color: PALETTE[i % PALETTE.length] },
    requests: dense.map((v) => (v > 0 ? v : null)),
    share: dense.map((v, index) => (v > 0 && requestTotals[index] > 0 ? v / requestTotals[index] : null)),
  }));

  if (ranked.length > SHARE_LIMIT) {
    const rest = Array.from({ length: buckets.length }, () => 0);
    for (let i = 0; i < buckets.length; i += 1) {
      let plottedSum = 0;
      for (const [, dense] of plotted) plottedSum += dense[i];
      rest[i] = Math.max(0, requestTotals[i] - plottedSum);
    }
    series.push({
      spec: { key: "other", label: "Other", color: OTHER_COLOR },
      requests: rest.map((v) => (v > 0 ? v : null)),
      share: rest.map((v, index) => (v > 0 && requestTotals[index] > 0 ? v / requestTotals[index] : null)),
    });
  }

  return {
    rows,
    top,
    colors,
    buckets,
    requestTotals,
    series,
    trend: perModel,
    providerCount: new Set(rows.map((row) => row.provider)).size,
    totalRequests,
    failedRequests,
    totalCost,
    unpricedRequests,
    maxRequests: top?.requests ?? 0,
  };
}

/** The panel under an expanded model row: the row's own figures, then its daily performance. */
function ModelDetail({
  row,
  points,
  word,
  bucketMs,
  money,
}: {
  row: AgentRow;
  points: AgentModelPerformancePoint[];
  word: string;
  bucketMs: number;
  money: (v: number) => string;
}) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const color = row.provider ? "var(--accent)" : OTHER_COLOR;
  const perf: SeriesSpec[] = [
    { key: "tps", label: "Tokens/s", color },
    { key: "ttft", label: "TTFT", color: OTHER_COLOR, axis: "right" },
  ];
  const shown = perf.filter((spec) => !hidden.has(spec.key));
  // A bucket with neither timing value would draw an empty frame, so the chart only counts the
  // buckets that carry a sample.
  const plotted = points.filter((point) => point.avgTokensPerSecond !== null || point.avgTtftMs !== null);
  const data = plotted.map((point) => ({ ts: point.ts, tps: point.avgTokensPerSecond, ttft: point.avgTtftMs === null ? null : point.avgTtftMs / 1000 }));
  const fact = (label: string, value: React.ReactNode, hint?: string, icon?: string): React.ReactNode => (
    <div className="min-w-0">
      <p className="mono flex items-center gap-1.5 truncate text-[10px] tracking-[0.14em] text-dim uppercase">
        {icon && <Icon name={icon} className="size-3.5" />}
        {label}
      </p>
      <p className="mono m-0 mt-0.5 truncate text-sm font-bold tabular-nums">{value}</p>
      {hint && <p className="mono m-0 truncate text-[10px] text-dim">{hint}</p>}
    </div>
  );

  return (
    <div className="grid items-start gap-4 border-t border-line bg-track/20 px-4 pt-3 pb-2 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-3">
          {fact("Error rate", pct(row.errorRate), `${fmt(row.failed)} failed`, "circle-alert")}
          {fact("Cache rate", pct(row.cacheRate), undefined, "database")}
          {fact("Cache savings", pct(row.cacheSavings), undefined, "piggy-bank")}
          {fact("Requests", fmt(row.requests), undefined, "activity")}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {fact("Avg duration", fmtMs(row.avgDurationMs), undefined, "timer")}
          {fact("Avg TTFT", fmtMs(row.avgTtftMs), undefined, "hourglass")}
          {fact("Tokens/s", row.avgTokensPerSecond > 0 ? `${fmtShort(row.avgTokensPerSecond)}/s` : "n/a", undefined, "zap")}
          {fact("Cost", row.unpricedRequests > 0 ? money(row.costUsd) : money(row.costUsd), `${fmt(row.unpricedRequests)} unpriced`)}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {fact("Uncached input", fmtShort(row.input), undefined, "arrow-down-to-line")}
          {fact("Cache read", fmtShort(row.cacheRead), undefined, "hard-drive-download")}
          {fact("Cache write", fmtShort(row.cacheWrite), undefined, "hard-drive-upload")}
          {fact("Output", fmtShort(row.output), undefined, "arrow-up-from-line")}
        </div>
        <p className="mono m-0 text-[10px] text-dim">
          {row.firstTs === null ? "first seen not recorded" : `first seen ${relAge(row.firstTs)}`} · {row.lastTs === null ? "last seen not recorded" : `last seen ${relAge(row.lastTs)}`}
        </p>
      </div>
      <div className="grid content-start gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="mono m-0 flex-1 text-[10px] tracking-[0.14em] text-dim uppercase">Performance per active {word}</p>
          <Legend items={perf} active={new Set(shown.map((spec) => spec.key))} onToggle={(key) => setHidden((held) => { const next = new Set(held); if (next.has(key)) next.delete(key); else next.add(key); return next; })} />
        </div>
        {plotted.length === 0 ? (
          <p className="mono m-0 py-8 text-center text-xs text-dim">No performance samples. Timing is recorded for streamed responses only.</p>
        ) : (
          <TimeChart
            data={data}
            series={shown}
            xKey="ts"
            height={240}
            tick={(value) => tsLabel(value, bucketMs)}
            label={(value) => tsFull(value, bucketMs)}
            valueFmt={(value) => fmtShort(value)}
            rightFmt={(value) => `${value.toFixed(1)}s`}
            ariaLabel={`Tokens per second and time to first token per ${word}`}
            summary={`Average output tokens per second and time to first token per ${word}, for ${row.key}.`}
          />
        )}
      </div>
    </div>
  );
}

export function ModelsPage({ agent, money }: { agent: AgentStats; money: (v: number) => string }) {
  const [mode, setMode] = useState<ShareMode>("share");
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const view = useMemo(() => buildView(agent), [agent]);
  const word = bucketWord(agent.bucketMs);
  const perf = useMemo(() => {
    const map = new Map<string, AgentModelPerformancePoint[]>();
    for (const series of agent.modelPerformance) map.set(modelKey({ key: series.model, provider: series.provider }), series.points);
    return map;
  }, [agent.modelPerformance]);
  const detail = (row: AgentRow): React.ReactNode => (modelKey(row) === expanded ? <ModelDetail row={row} points={perf.get(modelKey(row)) ?? []} word={word} bucketMs={agent.bucketMs} money={money} /> : null);

  const toggle = (key: string): void => {
    setHidden((held) => {
      const next = new Set(held);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const shown = view.series.filter((series) => !hidden.has(series.spec.key));
  const values = mode === "share" ? "share" : "requests";
  const data = view.buckets.map((ts, i) => {
    const row: { ts: number } & Record<string, number | null> = { ts };
    for (const series of shown) row[series.spec.key] = series[values][i];
    return row;
  });

  const columns = useMemo<Array<Column<AgentRow>>>(() => {
    const colorOf = (row: AgentRow): string => view.colors.get(`${row.key}\u0000${row.provider}`) ?? OTHER_COLOR;
    return [
      {
        key: "expand",
        header: "",
        width: 28,
        render: (row) => (
          <Icon
            name="chevron-right"
            className={"size-3.5 text-dim transition-transform " + (expanded === modelKey(row) ? "rotate-90 text-accent" : "")}
          />
        ),
      },
      {
        key: "model",
        header: "Model",
        sort: (row) => row.key,
        render: (row) => (
          <span className="flex min-w-0 items-center gap-2.5">
            <VendorMark model={row.key} row />
            <span className="grid min-w-0 leading-tight">
              <span className="mono truncate font-bold" title={`${row.key} (${row.provider})`}>{row.key}</span>
              <span className="mono truncate text-[10px] text-dim">{row.provider || "unknown provider"}</span>
            </span>
          </span>
        ),
      },
      {
        key: "requests",
        header: "Requests",
        align: "right",
        sort: (row) => row.requests,
        render: (row) => (
          <span className="grid justify-items-end gap-1">
            <span className="tabular-nums">{fmt(row.requests)}</span>
            <span className="h-[3px] w-[92px] overflow-hidden rounded-full bg-track" aria-hidden="true">
              <span
                className="block h-full rounded-full"
                style={{ width: `${view.maxRequests > 0 ? (row.requests / view.maxRequests) * 100 : 0}%`, background: colorOf(row) }}
              />
            </span>
          </span>
        ),
      },
      {
        key: "cost",
        header: "Cost",
        title: "API-equivalent estimate at public rates",
        align: "right",
        sort: (row) => row.costUsd,
        render: (row) => <span className="tabular-nums">{money(row.costUsd)}</span>,
      },
      {
        key: "tokens",
        header: "Tokens",
        title: "Uncached input + cache reads + cache writes + output",
        align: "right",
        sort: (row) => row.total,
        render: (row) => (
          <span className="tabular-nums" title={fmt(row.total)}>
            {fmtShort(row.total)}
          </span>
        ),
      },
      {
        key: "cache",
        header: "Cache rate",
        title: "Cache reads / (uncached input + cache reads)",
        align: "right",
        sort: (row) => row.cacheRate,
        render: (row) => <span className="tabular-nums">{pct(row.cacheRate)}</span>,
      },
      {
        key: "errors",
        header: "Errors",
        align: "right",
        sort: (row) => row.errorRate,
        render: (row) => {
          const rate = row.errorRate;
          // The chip carries the severity and the figure stays in ink, so a tinted number
          // never drops under AA on either panel.
          const chip =
            rate === 0
              ? "border-line text-dim"
              : rate >= 0.05
                ? "border-[var(--danger-border)] bg-[var(--danger-soft)]"
                : rate >= 0.01
                  ? "border-[var(--warn-border)] bg-[var(--warn-soft)]"
                  : "border-transparent bg-accent-soft";
          return (
            <Badge variant="outline" className={cn("mono px-1.5 text-[10px] tabular-nums", chip)} title={`${fmt(row.failed)} failed of ${fmt(row.requests)}`}>
              {pct(rate)}
            </Badge>
          );
        },
      },
      {
        key: "tps",
        header: "Tokens/s",
        title: "Average output tokens per second",
        align: "right",
        sort: (row) => row.avgTokensPerSecond,
        render: (row) =>
          row.avgTokensPerSecond > 0 ? (
            <span className="tabular-nums">{fmtShort(row.avgTokensPerSecond)}</span>
          ) : (
            <span className="text-dim">-</span>
          ),
      },
      {
        key: "ttft",
        header: "TTFT",
        title: "Average time to first token",
        align: "right",
        sort: (row) => row.avgTtftMs,
        render: (row) =>
          row.avgTtftMs > 0 ? (
            <span className="tabular-nums">{fmtMs(row.avgTtftMs)}</span>
          ) : (
            <span className="text-dim">-</span>
          ),
      },
      {
        key: "trend",
        header: "Trend",
        title: `Requests per ${word}`,
        width: 112,
        render: (row) => {
          const dense = view.trend.get(row.key);
          return dense && dense.length > 1 ? (
            <Sparkline values={dense} color={colorOf(row)} />
          ) : (
            <span className="text-dim">–</span>
          );
        },
      },
    ];
  }, [view, money, word, expanded]);

  return (
    <Page>
      <PageHeader
        title="Models"
        description={`Which models did the work in ${AGENT_RANGE_LABEL[agent.range]}, and how fast they answered.`}
      />

      <StatGrid cols={4}>
        <Stat
          label="Models used"
          value={fmt(view.rows.length)}
          hint={`across ${fmt(view.providerCount)} provider${view.providerCount === 1 ? "" : "s"}`}
        />
        <Stat
          label="Most used"
          title={view.top ? `${view.top.key} (${view.top.provider})` : undefined}
          value={view.top ? view.top.key : "–"}
          hint={
            view.top
              ? `${pct(view.top.requests / Math.max(1, view.totalRequests))} of requests · ${view.top.provider}`
              : undefined
          }
        />
        <Stat
          label="Requests"
          value={fmt(view.totalRequests)}
          hint={`${fmt(view.failedRequests)} failed`}
          spark={view.requestTotals}
        />
        <Stat
          label="API-equivalent cost"
          title="What this usage would cost at public API rates"
          value={money(view.totalCost)}
          hint={view.unpricedRequests > 0 ? `${fmt(view.unpricedRequests)} unpriced` : undefined}
        />
      </StatGrid>

      <Card
        title="Request share" icon="chart-spline"
        description={
          mode === "share"
            ? `Each model's share of requests per ${word}`
            : `Requests per ${word}, stacked by model`
        }
        actions={
          <Segmented label="Share chart mode" options={SHARE_OPTIONS} value={mode} onChange={setMode} />
        }
      >
        {view.buckets.length === 0 ? (
          <p className="text-xs text-dim">No per-model trend in this range.</p>
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
              valueFmt={mode === "share" ? (value) => pct(value, 0) : fmtShort}
              ariaLabel={`Requests per ${word}, stacked by model`}
              summary={
                mode === "share"
                  ? `Each model's share of requests per ${word}.`
                  : `Requests per ${word}, stacked by model.`
              }
            />
            <Legend
              items={view.series.map((series) => series.spec)}
              active={new Set(shown.map((series) => series.spec.key))}
              onToggle={toggle}
            />
          </div>
        )}
      </Card>

      <Card title="All models" icon="table" description="Click a row for latency and throughput over time" flush>
        <PagedTable
          columns={columns}
          rows={view.rows}
          rowKey={(row) => modelKey(row)}
          initialSort={{ key: "requests", dir: "desc" }}
          perPage={25}
          onRowClick={(row) => setExpanded((held) => (held === modelKey(row) ? null : modelKey(row)))}
          detail={detail}
          detailOpenFor={(row) => modelKey(row) === expanded}
          empty={<p className="p-4 text-xs text-dim">No model usage in this range.</p>}
          ariaLabel="Models"
        />
      </Card>
    </Page>
  );
}
