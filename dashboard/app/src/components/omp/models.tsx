// Models page: which models did the work, how fast they answered, and how they trend.
import { useMemo, useState } from "react";
import {
  Card,
  DataTable,
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
import type { OmpRow, OmpStats } from "@/lib/data";
import { OMP_RANGE_LABEL } from "@/lib/data";
import { PALETTE, fmt, fmtMs, fmtShort, pct, tsFull, tsLabel } from "@/lib/format";

type ShareMode = "share" | "requests";

const SHARE_OPTIONS: ReadonlyArray<{ value: ShareMode; label: string }> = [
  { value: "share", label: "Share" },
  { value: "requests", label: "Requests" },
];

/** Models stacked in the share chart; the rest fold into "Other". */
const SHARE_LIMIT = 6;

const OTHER_COLOR = "var(--dim)";

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
  rows: OmpRow[];
  top: OmpRow | null;
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
function buildView(omp: OmpStats): ModelsView {
  const rows = omp.byModel;
  const ordered = [...rows].toSorted((a, b) => b.requests - a.requests);
  const colors = new Map(ordered.map((row, i) => [`${row.key}\u0000${row.provider}`, PALETTE[i % PALETTE.length]]));

  let top: OmpRow | null = null;
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
  for (const series of omp.modelSeries) for (const point of series.points) stamps.add(point.ts);
  const buckets = [...stamps].toSorted((a, b) => a - b);
  const at = new Map(buckets.map((ts, i) => [ts, i]));

  const perModel = new Map<string, number[]>();
  for (const series of omp.modelSeries) {
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

export function ModelsPage({ omp, money }: { omp: OmpStats; money: (v: number) => string }) {
  const [mode, setMode] = useState<ShareMode>("share");
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
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

  const shown = view.series.filter((series) => !hidden.has(series.spec.key));
  const values = mode === "share" ? "share" : "requests";
  const data = view.buckets.map((ts, i) => {
    const row: { ts: number } & Record<string, number | null> = { ts };
    for (const series of shown) row[series.spec.key] = series[values][i];
    return row;
  });

  const columns = useMemo<Array<Column<OmpRow>>>(() => {
    const colorOf = (row: OmpRow): string => view.colors.get(`${row.key}\u0000${row.provider}`) ?? OTHER_COLOR;
    return [
      {
        key: "model",
        header: "Model",
        sort: (row) => row.key,
        render: (row) => (
          <span className="flex min-w-0 items-center gap-2">
            <span className="size-2 shrink-0 rounded-[2px]" style={{ background: colorOf(row) }} aria-hidden="true" />
            <span className="mono truncate" title={`${row.key} (${row.provider})`}>{row.key}</span>
            <span className="text-dim">{row.provider}</span>
          </span>
        ),
      },
      {
        key: "requests",
        header: "Requests",
        align: "right",
        sort: (row) => row.requests,
        render: (row) => <span className="tabular-nums">{fmt(row.requests)}</span>,
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
        render: (row) =>
          row.failed === 0 ? (
            <span className="text-dim">0%</span>
          ) : (
            <span className="tabular-nums text-danger" title={`${fmt(row.failed)} failed`}>
              {pct(row.errorRate)}
            </span>
          ),
      },
      {
        key: "tps",
        header: "Tokens/s",
        title: "Average output tokens per second",
        align: "right",
        sort: (row) => row.avgTokensPerSecond,
        render: (row) =>
          row.avgTokensPerSecond > 0 ? (
            <span className="tabular-nums">{fmtShort(row.avgTokensPerSecond)}/s</span>
          ) : (
            <span className="text-dim">–</span>
          ),
      },
      {
        key: "ttft",
        header: "TTFT",
        title: "Average time to first token",
        align: "right",
        sort: (row) => row.avgTtftMs,
        render: (row) => <span className="tabular-nums">{fmtMs(row.avgTtftMs)}</span>,
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
  }, [view, money, word]);

  return (
    <Page>
      <PageHeader
        title="Models"
        description={`Which models did the work in ${OMP_RANGE_LABEL[omp.range]}, and how fast they answered.`}
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
        index={1}
        title="Request share"
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
              tick={(value) => tsLabel(value, omp.bucketMs)}
              label={(value) => tsFull(value, omp.bucketMs)}
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

      <Card index={2} title="All models" description="Latency, throughput, and cache per model" flush>
        <DataTable
          columns={columns}
          rows={view.rows}
          rowKey={(row) => `${row.key}\u0000${row.provider}`}
          initialSort={{ key: "requests", dir: "desc" }}
          limit={25}
          empty={<p className="p-4 text-xs text-dim">No model usage in this range.</p>}
          ariaLabel="Models"
        />
      </Card>
    </Page>
  );
}
