// Costs page: what the usage in range would cost at public API rates. Every figure is an
// estimate from a rate card, never a bill.
import { useMemo, useState } from "react";
import {
  BarList,
  Card,
  CellBar,
  Chart,
  PagedTable,
  Legend,
  Page,
  PageHeader,
  Segmented,
  Stat,
  StatGrid,
} from "@/components/charts";
import type { Column, SeriesSpec } from "@/components/charts";
import type { OmpRow, OmpStats } from "@/lib/data";
import { OMP_RANGE_LABEL } from "@/lib/data";
import { PALETTE, fmt, fmtShort, pct, tsFull, tsLabel } from "@/lib/format";

type SplitMode = "model" | "total";

const SPLIT_OPTIONS: ReadonlyArray<{ value: SplitMode; label: string }> = [
  { value: "model", label: "By model" },
  { value: "total", label: "Total" },
];

/** Models stacked in the estimate chart; the rest fold into "Other". */
const MODEL_LIMIT = 6;

const DAY_MS = 86_400_000;
const OTHER_COLOR = "var(--dim)";

/** The bucket reads as a word, so a chart description can name it. */
function bucketWord(bucketMs: number): string {
  if (bucketMs < 3_600_000) return "5 minutes";
  if (bucketMs < 86_400_000) return "hour";
  return "day";
}

interface CostsView {
  rows: OmpRow[];
  top: OmpRow | null;
  colors: Map<string, string>;
  buckets: number[];
  dailyCost: number[];
  totalSeries: SeriesSpec;
  totalValues: Array<number | null>;
  modelSeries: Array<{ spec: SeriesSpec; values: Array<number | null> }>;
  totalCost: number;
  unpricedRequests: number;
  requests: number;
  pricedRequests: number;
  avgDailyCost: number;
  activeDays: number;
  maxModelCost: number;
}

function buildView(omp: OmpStats): CostsView {
  const rows = omp.byModel;
  const ordered = [...rows].toSorted((a, b) => b.costUsd - a.costUsd);
  const colors = new Map(ordered.map((row, i) => [`${row.key}\u0000${row.provider}`, PALETTE[i % PALETTE.length]]));
  const overall = omp.overall;
  const pricedRequests = overall.requests - overall.unpricedRequests;

  const buckets = omp.series.map((bucket) => bucket.ts);
  const at = new Map(buckets.map((ts, i) => [ts, i]));
  const dailyCost = omp.series.map((bucket) => bucket.costUsd);

  const perModel = new Map<string, number[]>();
  for (const series of omp.modelSeries) {
    const dense = Array.from({ length: buckets.length }, () => 0);
    for (const point of series.points) {
      const index = at.get(point.ts);
      if (index !== undefined) dense[index] = point.costUsd;
    }
    perModel.set(series.model, dense);
  }
  const ranked = [...perModel.entries()].toSorted(
    (a, b) => b[1].reduce((s, v) => s + v, 0) - a[1].reduce((s, v) => s + v, 0),
  );
  const plotted = ranked.slice(0, MODEL_LIMIT);
  const modelSeries = plotted.map(([model, dense], i) => ({
    spec: { key: `m${i}`, label: model, color: PALETTE[i % PALETTE.length] },
    values: dense.map((v) => (v > 0 ? v : null)),
  }));
  if (ranked.length > MODEL_LIMIT) {
    const rest = Array.from({ length: buckets.length }, () => 0);
    for (let i = 0; i < buckets.length; i += 1) {
      let plottedSum = 0;
      for (const series of modelSeries) plottedSum += series.values[i] ?? 0;
      rest[i] = Math.max(0, dailyCost[i] - plottedSum);
    }
    modelSeries.push({ spec: { key: "other", label: "Other", color: OTHER_COLOR }, values: rest.map((v) => (v > 0 ? v : null)) });
  }

  const days = new Set(omp.series.map((bucket) => Math.floor(bucket.ts / DAY_MS)));

  return {
    rows,
    top: ordered[0] ?? null,
    colors,
    buckets,
    dailyCost,
    totalSeries: { key: "cost", label: "Estimate", color: "var(--accent)" },
    totalValues: dailyCost.map((v) => (v > 0 ? v : null)),
    modelSeries,
    totalCost: overall.costUsd,
    unpricedRequests: overall.unpricedRequests,
    requests: overall.requests,
    pricedRequests,
    avgDailyCost: days.size > 0 ? overall.costUsd / days.size : 0,
    activeDays: days.size,
    maxModelCost: ordered[0]?.costUsd ?? 0,
  };
}

export function CostsPage({ omp, money }: { omp: OmpStats; money: (v: number) => string }) {
  const [split, setSplit] = useState<SplitMode>("model");
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

  const specs = split === "model" ? view.modelSeries.map((series) => series.spec) : [view.totalSeries];
  const values = split === "model" ? view.modelSeries : [{ spec: view.totalSeries, values: view.totalValues }];
  const shown = values.filter((series) => !hidden.has(series.spec.key));
  const data = view.buckets.map((ts, i) => {
    const row: { ts: number } & Record<string, number | null> = { ts };
    for (const series of shown) row[series.spec.key] = series.values[i];
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
        header: "Estimate",
        title: "API-equivalent estimate at public rates",
        align: "right",
        sort: (row) => row.costUsd,
        render: (row) => (
          <span className="flex flex-col items-end gap-1">
            <span className="tabular-nums">{money(row.costUsd)}</span>
            <CellBar value={row.costUsd} max={view.maxModelCost} color={colorOf(row)} />
          </span>
        ),
      },
      {
        key: "share",
        header: "Share",
        align: "right",
        sort: (row) => (view.totalCost > 0 ? row.costUsd / view.totalCost : 0),
        render: (row) =>
          row.costUsd > 0 ? <span className="tabular-nums">{pct(row.costUsd / Math.max(1, view.totalCost))}</span> : <span className="text-dim">–</span>,
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
        key: "perRequest",
        header: "Per request",
        title: "Estimate / priced requests",
        align: "right",
        sort: (row) => (row.requests > row.unpricedRequests ? row.costUsd / (row.requests - row.unpricedRequests) : -1),
        render: (row) =>
          row.requests > row.unpricedRequests ? (
            <span className="tabular-nums">{money(row.costUsd / (row.requests - row.unpricedRequests))}</span>
          ) : (
            <span className="text-dim">–</span>
          ),
      },
      {
        key: "unpriced",
        header: "Unpriced",
        title: "Requests with no public-equivalent price",
        align: "right",
        sort: (row) => row.unpricedRequests,
        render: (row) =>
          row.unpricedRequests > 0 ? (
            <span className="tabular-nums text-[var(--warn-border)]">{fmt(row.unpricedRequests)}</span>
          ) : (
            <span className="text-dim">0</span>
          ),
      },
    ];
  }, [view, money]);

  const costRows = view.rows
    .filter((row) => row.costUsd > 0)
    .toSorted((a, b) => b.costUsd - a.costUsd)
    .map((row) => ({
      key: `${row.key}\u0000${row.provider}`,
      label: row.key,
      value: row.costUsd,
      color: view.colors.get(`${row.key}\u0000${row.provider}`) ?? OTHER_COLOR,
    }));

  return (
    <Page>
      <PageHeader
        title="Costs"
        description={`What ${OMP_RANGE_LABEL[omp.range]} of usage would cost at public API rates. Subscription usage without a public price is counted as unpriced, not free.`}
      />

      <StatGrid cols={5}>
        <Stat
          label="API-equivalent estimate"
          title="What this usage would cost at public API rates"
          value={money(view.totalCost)}
          hint={`${fmt(view.requests)} requests`}
          spark={view.dailyCost}
        />
        <Stat
          label="Average per day"
          title="Estimate / days with any usage"
          value={money(view.avgDailyCost)}
          hint={`over ${fmt(view.activeDays)} active day${view.activeDays === 1 ? "" : "s"}`}
        />
        <Stat
          label="Top model"
          title={view.top ? `${view.top.key} (${view.top.provider})` : undefined}
          value={view.top ? view.top.key : "–"}
          hint={view.top ? `${money(view.top.costUsd)} · ${pct(view.top.costUsd / Math.max(1, view.totalCost))} of estimate` : "Nothing priced yet"}
        />
        <Stat
          label="Per priced request"
          title="Estimate / requests that have a public price"
          value={view.pricedRequests > 0 ? money(view.totalCost / view.pricedRequests) : "–"}
          hint={`${fmt(view.pricedRequests)} priced`}
        />
        <Stat
          label="Unpriced requests"
          title="Subscription usage with no public-equivalent price; excluded from the estimate"
          value={fmt(view.unpricedRequests)}
          hint={view.unpricedRequests > 0 ? "excluded from the estimate" : "all usage priced"}
        />
      </StatGrid>

      <Card
        title="Daily estimate"
        description={
          split === "model"
            ? `Per ${word}, stacked by model. The reference can also split this by billing component; the payload carries no per component cost, so the model split is the finest available.`
            : `Per ${word}, total priced estimate across all models`
        }
        actions={<Segmented label="Split by" options={SPLIT_OPTIONS} value={split} onChange={setSplit} />}
      >
        {view.buckets.length === 0 ? (
          <p className="text-xs text-dim">No priced usage in this range.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <Chart
              data={data}
              series={shown.map((series) => series.spec)}
              xKey="ts"
              stacked
              height={280}
              tick={(value) => tsLabel(value, omp.bucketMs)}
              label={(value) => tsFull(value, omp.bucketMs)}
              valueFmt={money}
              ariaLabel={split === "model" ? "Priced estimate per bucket, stacked by model" : "Total priced estimate per bucket"}
              summary={
                split === "model"
                  ? `Priced API-equivalent estimate per ${word}, stacked by model.`
                  : `Total priced API-equivalent estimate per ${word}.`
              }
            />
            <Legend
              items={specs}
              active={new Set(shown.map((series) => series.spec.key))}
              onToggle={toggle}
            />
          </div>
        )}
      </Card>

      <Card
        title="Where it went"
        description="Estimate by model. The reference splits this block by billing component, which the payload does not carry, so the model split stands in."
      >
        <div className="flex flex-col gap-3">
          <BarList rows={costRows} money={money} limit={8} />
          <div className="flex items-center justify-between border-t border-line pt-2 text-xs">
            <span className="text-dim">Total</span>
            <span className="mono tabular-nums">{money(view.totalCost)}</span>
          </div>
          {view.unpricedRequests > 0 && (
            <p className="text-[11px] text-dim">
              {fmt(view.unpricedRequests)} unpriced subscription request{view.unpricedRequests === 1 ? " is" : "s are"} not
              included.
            </p>
          )}
        </div>
      </Card>

      <Card title="By model" description="Estimate per model with its token and cache split" flush>
        <PagedTable
          columns={columns}
          rows={view.rows}
          rowKey={(row) => `${row.key}\u0000${row.provider}`}
          initialSort={{ key: "cost", dir: "desc" }}
          perPage={20}
          empty={<p className="p-4 text-xs text-dim">No usage in this range.</p>}
          ariaLabel="Costs by model"
        />
      </Card>
    </Page>
  );
}
