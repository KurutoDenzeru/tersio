// Models: which models did the work, where each price came from, and how fast they answered.
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";

import { Note, Section, StatStrip, StripStat, TableFilter, percent, MiniBars } from "@/components/dash/composites";
import { DataTable } from "@/components/dash/data-table";
import { Brandmark } from "@/components/brand";
import { ModelShareChart, type ShareMode, type ShareSeries } from "@/components/dash/model-share";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";
import { byModelLabeled, meanOf, modelUsd, rangeView, tokensOf } from "@/lib/aggregate";
import { fmt, fmtShort } from "@/lib/format";
import type { TokenBreakdown } from "@/lib/format";
import type { UsageReport } from "@/lib/data";
import { RANGE_LABELS } from "@/lib/route";
import type { PageProps } from "./types";

/** Series that keep their own colour. Past this the legend stops fitting and colours stop being telling. */
const TOP_SERIES = 7;

interface ModelRow {
  label: string;
  provider: string | null;
  tokens: TokenBreakdown;
  cost: number | undefined;
  requests: number;
  errors: number;
  cacheRatePct: number;
  /** All time: duration is not stored per day, so a ranged rate would be invented. */
  meanElapsedMs: number | null;
  tokensPerSecond: number | null;
  /** Null where the host recorded no time to first token, which is every host but OMP. */
  ttftMs: number | null;
  /** Day key to tokens, oldest first. Feeds the row sparkline and the detail chart. */
  trendPoints: Array<{ day: string; value: number }>;
  firstSeen: string | null;
  lastSeen: string | null;
  catalogued: boolean;
  rate: UsageReport["modelRates"][string] | undefined;
}

/** Null is N/A: a model with no recorded duration must not read as instant. */
function duration(value: number | null): string {
  if (value === null) return "N/A";
  return value < 1000 ? `${Math.round(value)}ms` : `${(value / 1000).toFixed(1)}s`;
}

function money2(value: number): string {
  return value === 0 ? "$0" : `$${value.toFixed(value < 1 ? 4 : 2)}`;
}

export function ModelsPage({ data, cutoff, since, range, money }: PageProps) {
  const [mode, setMode] = useState<ShareMode>("share");
  const [filter, setFilter] = useState("");
  // `rangeView` returns a fresh object each call, so it is memoized on its inputs; otherwise every
  // memo below misses on each render and re-folds every day table on each click.
  const view = useMemo(() => rangeView(data, range, cutoff, since), [data, range, cutoff, since]);
  const scoped = view.data;
  const scopedCutoff = view.cutoff;

  const rows = useMemo<ModelRow[]>(() => {
    const totals = byModelLabeled(scoped.byDayModelTokens, scopedCutoff, data.modelLabels);
    const usd = modelUsd(scoped.byDayModelUsd, scopedCutoff);

    // Requests come from the per-day runs table, so they are exact for the range rather than limited
    // to whatever the capped recent list holds.
    const requests = new Map<string, number>();
    for (const [day, per] of Object.entries(scoped.byDayModelRuns)) {
      if (scopedCutoff !== null && day < scopedCutoff) continue;
      for (const [key, n] of Object.entries(per)) {
        const label = data.modelLabels[key] ?? key;
        requests.set(label, (requests.get(label) ?? 0) + n);
      }
    }

    const errors = new Map<string, number>();
    for (const [day, per] of Object.entries(scoped.byDayModelErrors)) {
      if (scopedCutoff !== null && day < scopedCutoff) continue;
      for (const [key, n] of Object.entries(per)) {
        const label = data.modelLabels[key] ?? key;
        errors.set(label, (errors.get(label) ?? 0) + n);
      }
    }

    // One pass over the per-day table gives each model its trend, its span, and its days.
    const trend = new Map<string, Array<{ day: string; value: number }>>();
    for (const [day, per] of Object.entries(scoped.byDayModelTokens)) {
      if (scopedCutoff !== null && day < scopedCutoff) continue;
      for (const [key, breakdown] of Object.entries(per)) {
        const label = data.modelLabels[key] ?? key;
        const list = trend.get(label) ?? [];
        list.push({ day, value: tokensOf(breakdown) });
        trend.set(label, list);
      }
    }

    return totals.map(([label, tokens]) => {
      const days = (trend.get(label) ?? []).sort((a, b) => a.day.localeCompare(b.day));
      const resolved = data.modelRates[label];
      const base = tokens.input + tokens.cacheRead;
      const modelKey = (key: string): string => data.modelLabels[key] ?? key;
      // Both sides of each ratio are all time, so the figures are too.
      const elapsed = meanOf(Object.entries(data.latency).find(([key]) => modelKey(key) === label)?.[1]);
      const ttft = meanOf(Object.entries(data.ttft).find(([key]) => modelKey(key) === label)?.[1]);
      return {
        label,
        provider: resolved?.provider ?? null,
        tokens,
        cost: usd.get(label),
        requests: requests.get(label) ?? 0,
        errors: errors.get(label) ?? 0,
        cacheRatePct: base > 0 ? (tokens.cacheRead / base) * 100 : 0,
        meanElapsedMs: elapsed,
        tokensPerSecond: elapsed && elapsed > 0 ? tokens.output / (elapsed / 1000) : null,
        ttftMs: ttft,
        trendPoints: days,
        firstSeen: days[0]?.day ?? null,
        lastSeen: days[days.length - 1]?.day ?? null,
        catalogued: resolved?.known ?? false,
        rate: resolved,
      };
    });
  }, [scoped, scopedCutoff, data.modelLabels]);

  // The share chart is request-based, matching what the tab reports. Only the top models keep a
  // colour of their own; the remainder becomes one bucket so the legend still fits.
  const share = useMemo(() => {
    const perDay = new Map<string, Map<string, number>>();
    const totals = new Map<string, number>();
    for (const [day, per] of Object.entries(scoped.byDayModelRuns)) {
      if (scopedCutoff !== null && day < scopedCutoff) continue;
      const folded = new Map<string, number>();
      for (const [key, n] of Object.entries(per)) {
        const label = data.modelLabels[key] ?? key;
        folded.set(label, (folded.get(label) ?? 0) + n);
        totals.set(label, (totals.get(label) ?? 0) + n);
      }
      perDay.set(day, folded);
    }
    const days = [...perDay.keys()].sort();
    const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    const grand = ranked.reduce((n, [, value]) => n + value, 0);
    const total = (value: number): string => (grand > 0 ? `${((value / grand) * 100).toFixed(1)}%` : "0%");

    const keep = ranked.slice(0, TOP_SERIES);
    const kept = new Set(keep.map(([label]) => label));
    const series: ShareSeries[] = keep.map(([label, value]) => ({
      label: `${label} · ${total(value)}`,
      values: days.map((day) => perDay.get(day)?.get(label) ?? 0),
    }));
    if (ranked.length > keep.length) {
      const rest = ranked.slice(keep.length);
      series.push({
        label: `Other (${rest.length}) · ${total(rest.reduce((n, [, value]) => n + value, 0))}`,
        isOther: true,
        values: days.map((day) => {
          let sum = 0;
          for (const [label, value] of perDay.get(day) ?? new Map<string, number>()) {
            if (!kept.has(label)) sum += value;
          }
          return sum;
        }),
      });
    }
    return {
      days,
      series,
      topLabel: ranked[0]?.[0] ?? null,
      topShare: ranked.length > 0 ? total(ranked[0][1]) : null,
      grand,
    };
  }, [scoped, scopedCutoff, data.modelLabels]);

  const requestTrend = useMemo(
    () =>
      Object.entries(scoped.byDayModelRuns)
        .filter(([day]) => scopedCutoff === null || day >= scopedCutoff)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([, per]) => Object.values(per).reduce((n, value) => n + value, 0)),
    [scoped, scopedCutoff],
  );
  const requestCount = requestTrend.reduce((n, value) => n + value, 0);

  const failureCount = useMemo(
    () =>
      Object.entries(scoped.byDayModelErrors)
        .filter(([day]) => scopedCutoff === null || day >= scopedCutoff)
        .reduce((n, [, per]) => n + Object.values(per).reduce((a, b) => a + b, 0), 0),
    [scoped, scopedCutoff],
  );

  const apiCost = useMemo(() => rows.reduce((n, row) => n + (row.cost ?? 0), 0), [rows]);
  const providers = useMemo(
    () => new Set(rows.map((row) => row.provider).filter(Boolean)),
    [rows],
  );
  const topRow = useMemo(() => rows.find((row) => row.label === share.topLabel), [rows, share.topLabel]);
  const ttftRuns = useMemo(
    () => Object.values(data.ttft).reduce((n, stat) => n + stat.n, 0),
    [data.ttft],
  );

  const columns = useMemo<ColumnDef<ModelRow, unknown>[]>(
    () => [
      {
        id: "expand",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <button
            type="button"
            onClick={row.getToggleExpandedHandler()}
            aria-label={row.getIsExpanded() ? `Collapse ${row.original.label}` : `Expand ${row.original.label}`}
            aria-expanded={row.getIsExpanded()}
            className="grid size-6 place-items-center rounded-md text-dim hover:bg-track hover:text-ink"
          >
            <Icon name={row.getIsExpanded() ? "chevron-down" : "chevron-right"} className="size-3.5" />
          </button>
        ),
      },
      {
        id: "model",
        header: "Model",
        accessorFn: (r) => r.label,
        cell: ({ row }) => (
          <span className="flex min-w-0 items-center gap-2">
            <Brandmark model={row.original.label} row />
            <span className="grid min-w-0">
              <span className="mono block max-w-[260px] truncate font-semibold" title={row.original.label}>
                {row.original.label}
              </span>
              {/* The provider the catalog attributes this model to, which is where its price came from. */}
              <span className="mono block text-[11px] text-dim">
                {row.original.provider ?? "unknown provider"}
                {row.original.catalogued ? "" : " · unpriced"}
              </span>
            </span>
          </span>
        ),
      },
      {
        id: "requests",
        header: "Requests",
        accessorFn: (r) => r.requests,
        cell: ({ row }) => (
          <span className="mono flex items-center justify-end gap-2 tabular-nums">
            {fmt(row.original.requests)}
            <span className="h-1.5 w-14 overflow-hidden rounded-full bg-track">
              <span
                className="block h-full rounded-full bg-accent"
                style={{ width: `${requestCount > 0 ? (row.original.requests / requestCount) * 100 : 0}%` }}
              />
            </span>
          </span>
        ),
      },
      {
        id: "cost",
        header: "Cost",
        accessorFn: (r) => r.cost ?? -1,
        cell: ({ row }) =>
          row.original.cost === undefined ? (
            <span className="mono block text-right text-dim">N/A</span>
          ) : (
            <span className="mono block text-right tabular-nums">{money2(row.original.cost)}</span>
          ),
      },
      {
        id: "tokens",
        header: "Tokens",
        accessorFn: (r) => tokensOf(r.tokens),
        cell: ({ row }) => <span className="mono block text-right tabular-nums">{fmtShort(tokensOf(row.original.tokens))}</span>,
      },
      {
        id: "cache",
        header: "Cache rate",
        accessorFn: (r) => r.cacheRatePct,
        cell: ({ row }) => <span className="mono block text-right tabular-nums">{percent(row.original.cacheRatePct)}</span>,
      },
      {
        id: "errors",
        header: "Errors",
        accessorFn: (r) => (r.requests > 0 ? (r.errors / r.requests) * 100 : -1),
        cell: ({ row }) => {
          const pct = row.original.requests > 0 ? (row.original.errors / row.original.requests) * 100 : 0;
          if (pct <= 0) return <span className="mono block text-right text-dim">0%</span>;
          return (
            <span className="mono block text-right">
              <span className="rounded-full border border-danger-border bg-danger-soft px-2 py-0.5 text-[11px] text-danger tabular-nums">
                {percent(pct)}
              </span>
            </span>
          );
        },
      },
      {
        id: "tps",
        header: "Tokens/s",
        accessorFn: (r) => r.tokensPerSecond ?? -1,
        cell: ({ row }) => (
          <span className="mono block text-right tabular-nums">
            {row.original.tokensPerSecond === null ? "N/A" : row.original.tokensPerSecond.toFixed(1)}
          </span>
        ),
      },
      {
        id: "ttft",
        header: "TTFT",
        // Sorts on the real value and keeps unrecorded values at the bottom.
        accessorFn: (r) => r.ttftMs ?? -1,
        cell: ({ row }) =>
          row.original.ttftMs === null ? (
            <span className="mono block text-right text-dim">N/A</span>
          ) : (
            <span className="mono block text-right tabular-nums">{(row.original.ttftMs / 1000).toFixed(1)}s</span>
          ),
      },
      {
        id: "trend",
        header: "Trend",
        enableSorting: false,
        cell: ({ row }) => <MiniBars values={row.original.trendPoints.map((p) => p.value)} className="ml-auto w-24" />,
      },
    ],
    [requestCount],
  );

  return (
    <div className="grid gap-6">
      <StatStrip>
        <StripStat label="Models used" value={fmt(rows.length)} sub={`across ${fmt(providers.size)} providers`} />
        <StripStat
          label="Most used"
          value={share.topLabel ?? "—"}
          sub={
            share.topLabel && share.topShare
              ? `${share.topShare} of requests · ${topRow?.provider ?? "unknown"}`
              : "no usage in range"
          }
        />
        <StripStat
          label="Requests"
          value={fmt(requestCount)}
          sub={`${fmt(failureCount)} failed`}
          spark={requestTrend}
        />
        <StripStat
          label="API-equivalent cost"
          value={money(apiCost)}
          sub={`${data.pricingCoverage.priced}/${data.pricingCoverage.total} models catalogued`}
        />
      </StatStrip>

      <Section
        title="Request share"
        hint={view.short ? "Each model's share of requests per bucket" : "Each model's share of requests per day"}
        actions={
          <div
            className="mono flex shrink-0 items-center gap-0.5 rounded-[10px] border border-line bg-panel p-0.5"
            role="radiogroup"
            aria-label="Share metric"
          >
            {(["share", "requests"] as const).map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={mode === id}
                onClick={() => setMode(id)}
                className={`rounded-lg px-2.5 py-1 text-[11px] capitalize [transition:background_.15s,color_.15s] ${
                  mode === id ? "bg-accent-soft font-semibold text-accent" : "text-dim hover:bg-track hover:text-ink"
                }`}
              >
                {id}
              </button>
            ))}
          </div>
        }
      >
        {view.partial && (
          <Note tone="warn">
            The payload holds only the newest 2000 requests, so this range&apos;s request counts are a
            lower bound.
          </Note>
        )}
        <ModelShareChart days={share.days} series={share.series} mode={mode} />
      </Section>

      <Section
        title="All models"
        hint="Select a row for efficiency, latency, tokens, and the rate it was priced from"
        actions={<TableFilter value={filter} onChange={setFilter} placeholder="Filter by model" />}
      >
        <DataTable
          columns={columns}
          data={rows}
          filterColumn="model"
          filterValue={filter}
          pageSize={25}
          caption="Models by tokens in range"
          emptyTitle={`No models in ${RANGE_LABELS[range]}`}
          emptyBody="Nothing ran in the selected range."
          renderExpanded={(row) => <ModelDetail row={row} money={money} catalog={data.pricingCatalog} />}
        />
        {ttftRuns === 0 && (
          <Note tone="warn">
            TTFT is N/A everywhere here: only OMP records time to first token, and pi and OpenCode do
            not write it. Mean duration is still real, but it is wall clock, not inference latency.
          </Note>
        )}
      </Section>
    </div>
  );
}

/** The inline panel under a model row: the same groups OMP shows, plus where the price came from. */
function ModelDetail({
  row,
  money,
  catalog,
}: {
  row: ModelRow;
  money: (v: number) => string;
  catalog: UsageReport["pricingCatalog"];
}) {
  const errorRate = row.requests > 0 ? (row.errors / row.requests) * 100 : 0;
  // Savings only exist against a real input rate; an unpriced model has none to save against.
  const savingsUsd = row.rate?.known ? (row.tokens.cacheRead / 1e6) * row.rate.input : 0;

  return (
    <div className="grid gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="grid content-start gap-5">
        <div>
          <p className="mono m-0 text-[10px] tracking-[0.14em] text-dim uppercase">Efficiency</p>
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2">
            <Field label="Error rate" value={`${percent(errorRate)} (${fmt(row.errors)} failed)`} />
            <Field label="Cache rate" value={percent(row.cacheRatePct)} />
            <Field label="Cache savings" value={money(savingsUsd)} />
            <Field label="Requests" value={fmt(row.requests)} />
          </dl>
        </div>
        <div>
          <p className="mono m-0 text-[10px] tracking-[0.14em] text-dim uppercase">Latency</p>
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2">
            <Field label="Avg duration" value={duration(row.meanElapsedMs)} />
            <Field label="Avg TTFT" value={row.ttftMs === null ? "N/A" : duration(row.ttftMs)} />
            <Field label="Tokens/s" value={row.tokensPerSecond === null ? "N/A" : row.tokensPerSecond.toFixed(1)} />
          </dl>
        </div>
        <div>
          <p className="mono m-0 text-[10px] tracking-[0.14em] text-dim uppercase">Tokens</p>
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2">
            <Field label="Uncached input" value={fmtShort(row.tokens.input)} />
            <Field label="Cache read" value={fmtShort(row.tokens.cacheRead)} />
            <Field label="Cache write" value={fmtShort(row.tokens.cacheWrite)} />
            <Field label="Output" value={fmtShort(row.tokens.output)} />
          </dl>
        </div>
        <p className="m-0 text-[11px] text-dim">
          {row.firstSeen ? `First seen ${row.firstSeen}` : "No first-seen date"}
          {row.lastSeen && row.lastSeen !== row.firstSeen ? ` · last seen ${row.lastSeen}` : ""}
        </p>
      </div>

      <div className="grid content-start gap-4">
        <div>
          <p className="mono m-0 text-[10px] tracking-[0.14em] text-dim uppercase">Pricing catalog</p>
          <Table className="mt-2">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-0">Source</TableHead>
                <TableHead className="text-right">Input</TableHead>
                <TableHead className="text-right">Output</TableHead>
                <TableHead className="text-right">Cache read</TableHead>
                <TableHead className="pr-0 text-right">Cache write</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="mono pl-0 text-xs">
                  {row.catalogued ? (row.provider ?? "catalogued") : "not in catalog"}
                </TableCell>
                {row.rate && row.rate.known ? (
                  <>
                    <TableCell className="mono text-right text-xs">{money2(row.rate.input)}</TableCell>
                    <TableCell className="mono text-right text-xs">{money2(row.rate.output)}</TableCell>
                    <TableCell className="mono text-right text-xs">{money2(row.rate.cacheRead)}</TableCell>
                    <TableCell className="mono pr-0 text-right text-xs">{money2(row.rate.cacheWrite)}</TableCell>
                  </>
                ) : (
                  <TableCell colSpan={4} className="mono pr-0 text-right text-xs text-dim">
                    N/A — excluded from dollar totals
                  </TableCell>
                )}
              </TableRow>
            </TableBody>
          </Table>
          <p className="m-0 mt-2 text-[11px] text-dim">
            Rates per million tokens from the models.dev catalog ({fmt(catalog.providers)} providers,{" "}
            {fmt(catalog.models)} models
            {catalog.fetchedAt ? `, refreshed ${new Date(catalog.fetchedAt).toLocaleDateString("en-US")}` : ""}).
          </p>
        </div>
        <div>
          <p className="mono m-0 text-[10px] tracking-[0.14em] text-dim uppercase">Tokens per day</p>
          <MiniBars
            values={row.trendPoints.map((p) => p.value)}
            className="mt-2 h-24 w-full"
          />
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/60 pb-1">
      <dt className="m-0 text-[11px] text-dim">{label}</dt>
      <dd className="mono m-0 text-right text-xs font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
