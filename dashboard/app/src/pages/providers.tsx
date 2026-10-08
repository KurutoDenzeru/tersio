// Providers: which provider served each call, what it burned, and the hour it peaked.
import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";

import { Note, Section, StatStrip, StripStat, percent } from "@/components/dash/composites";
import { DataTable } from "@/components/dash/data-table";
import { StackedTrendChart, seriesColor, type StackedSeries } from "@/components/dash/trend";
import { Brandmark } from "@/components/brand";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Icon } from "@/components/icon";
import {
  RECENT_CAP,
  providerHourHistogram,
  providerSeries,
  providerStats,
  rangeView,
  sumNumbers,
  tokensOf,
  type ProviderStat,
} from "@/lib/aggregate";
import { fmt, fmtShort } from "@/lib/format";
import { RANGE_LABELS } from "@/lib/route";
import type { PageProps } from "./types";

/** Series that keep their own colour; past this the legend stops fitting. */
const TOP_SERIES = 5;

const BURN_MODES = ["tokens", "cost"] as const;
type BurnMode = (typeof BURN_MODES)[number];
const BURN_LABEL: Record<BurnMode, string> = { tokens: "Tokens", cost: "Cost" };

/** The provider table's columns. A plain factory rather than a memo, so a cell reads one number. */
function providerColumns(
  money: (v: number) => string,
  requests: number,
  tokens: number,
): ColumnDef<ProviderStat, unknown>[] {
  return [
    {
      id: "expand",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <button
          type="button"
          onClick={row.getToggleExpandedHandler()}
          aria-label={row.getIsExpanded() ? `Collapse ${row.original.provider}` : `Expand ${row.original.provider}`}
          aria-expanded={row.getIsExpanded()}
          className="grid size-6 place-items-center rounded-md text-dim hover:bg-track hover:text-ink"
        >
          <Icon name={row.getIsExpanded() ? "chevron-down" : "chevron-right"} className="size-3.5" />
        </button>
      ),
    },
    {
      id: "provider",
      header: "Provider",
      accessorFn: (r) => r.provider,
      cell: ({ row }) => (
        <span className="flex min-w-0 items-center gap-2">
          <Brandmark model={row.original.provider} row />
          <span className="mono block max-w-[220px] truncate font-semibold" title={row.original.provider}>
            {row.original.provider}
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
              style={{ width: `${requests > 0 ? (row.original.requests / requests) * 100 : 0}%` }}
            />
          </span>
        </span>
      ),
    },
    {
      id: "failed",
      header: "Error rate",
      accessorFn: (r) => (r.requests > 0 ? (r.failed / r.requests) * 100 : -1),
      cell: ({ row }) => {
        const pct = row.original.requests > 0 ? (row.original.failed / row.original.requests) * 100 : 0;
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
      id: "models",
      header: "Models",
      accessorFn: (r) => r.modelTokens.length,
      cell: ({ row }) => (
        <span className="mono block text-right tabular-nums">{fmt(row.original.modelTokens.length)}</span>
      ),
    },
    {
      id: "tokens",
      header: "Tokens",
      accessorFn: (r) => tokensOf(r.tokens),
      cell: ({ row }) => (
        <span className="mono flex items-center justify-end gap-2 tabular-nums">
          {fmtShort(tokensOf(row.original.tokens))}
          <span className="h-1.5 w-14 overflow-hidden rounded-full bg-track">
            <span
              className="block h-full rounded-full bg-accent"
              style={{ width: `${tokens > 0 ? (tokensOf(row.original.tokens) / tokens) * 100 : 0}%` }}
            />
          </span>
        </span>
      ),
    },
    {
      id: "share",
      header: "Share",
      accessorFn: (r) => (tokens > 0 ? (tokensOf(r.tokens) / tokens) * 100 : 0),
      cell: ({ row }) => (
        <span className="mono block text-right tabular-nums">
          {percent(tokens > 0 ? (tokensOf(row.original.tokens) / tokens) * 100 : 0)}
        </span>
      ),
    },
    {
      id: "cost",
      header: "Cost",
      accessorFn: (r) => r.cost ?? -1,
      cell: ({ row }) =>
        row.original.cost === null ? (
          <span className="mono block text-right text-dim">N/A</span>
        ) : (
          <span className="mono block text-right tabular-nums">{money(row.original.cost)}</span>
        ),
    },
    {
      id: "tps",
      header: "Tokens/s",
      accessorFn: (r) => r.tokensPerSecond ?? -1,
      cell: ({ row }) => (
        <span className="mono block text-right tabular-nums">
          {row.original.tokensPerSecond === null ? "–" : row.original.tokensPerSecond.toFixed(1)}
        </span>
      ),
    },
  ];
}

export function ProvidersPage({ data, cutoff, since, range, money }: PageProps) {
  // `rangeView` returns a fresh object each call, so it must be memoized on its inputs or every memo
  // below would miss on every render.
  const view = useMemo(() => rangeView(data, range, cutoff, since), [data, range, cutoff, since]);
  const [mode, setMode] = useState<BurnMode>("tokens");
  // One pass per payload, not one per click: expanding a row or toggling a tab re-renders this
  // component, and a fresh fold over every day table on each render is what froze the page.
  const stats = useMemo(() => providerStats(view), [view]);
  const series = useMemo(() => providerSeries(view), [view]);
  const hourly = useMemo(() => providerHourHistogram(view), [view]);

  const tokens = useMemo(() => stats.reduce((n, row) => n + tokensOf(row.tokens), 0), [stats]);
  const output = useMemo(() => stats.reduce((n, row) => n + row.tokens.output, 0), [stats]);
  const requests = useMemo(() => stats.reduce((n, row) => n + row.requests, 0), [stats]);
  const failed = useMemo(() => stats.reduce((n, row) => n + row.failed, 0), [stats]);
  const errorRate = requests > 0 ? (failed / requests) * 100 : 0;
  const apiUsd = useMemo(() => sumNumbers(view.data.byDayApiUsd, view.cutoff), [view]);
  const measuredUsd = useMemo(() => sumNumbers(view.data.byDayCost, view.cutoff), [view]);
  // Hour of day is not stored per day, so the histogram folds the capped recent list: a lower bound
  // for every range whose hours come from it. Only the exact-window ranges can reach past the cap,
  // and a partial one states the same floor for every figure on the page.
  const rowsCapped = view.partial || view.short || view.requests().length >= RECENT_CAP;

  const columns = useMemo(() => providerColumns(money, requests, tokens), [money, requests, tokens]);

  // Buckets stay in the order `providerSeries` sorted them: oldest first, one entry per bucket.
  const buckets = useMemo(() => {
    const seen: string[] = [];
    for (const point of series) if (!seen.includes(point.bucket)) seen.push(point.bucket);
    return seen;
  }, [series]);
  // The chart and the hour bars share one split, so the same series keeps the same colour.
  const kept = useMemo(() => stats.slice(0, TOP_SERIES), [stats]);
  const rest = useMemo(() => stats.slice(TOP_SERIES), [stats]);
  const chartSeries = useMemo<StackedSeries[]>(() => {
    const pointOf = new Map(series.map((point) => [`${point.bucket}\u0000${point.label}`, point]));
    const keptSeries: StackedSeries[] = kept.map((row) => ({
      label: row.provider,
      values: buckets.map((bucket) => pointOf.get(`${bucket}\u0000${row.provider}`)?.[mode] ?? 0),
    }));
    if (rest.length > 0) {
      keptSeries.push({
        label: `Other (${rest.length})`,
        isOther: true,
        values: buckets.map((bucket) =>
          rest.reduce((n, row) => n + (pointOf.get(`${bucket}\u0000${row.provider}`)?.[mode] ?? 0), 0),
        ),
      });
    }
    return keptSeries;
  }, [series, kept, rest, buckets, mode]);

  const hourPoint = useMemo(() => new Map(hourly.map((row) => [`${row.hour}\u0000${row.label}`, row.tokens])), [hourly]);
  const hourTotals = useMemo(() => {
    const totals = new Map<number, number>();
    for (const row of hourly) totals.set(row.hour, (totals.get(row.hour) ?? 0) + row.tokens);
    return totals;
  }, [hourly]);
  const hours = useMemo(() => [...hourTotals.keys()].sort((a, b) => a - b), [hourTotals]);
  const peak = useMemo(
    () =>
      hours.reduce<number | null>(
        (best, hour) => (best === null || (hourTotals.get(hour) ?? 0) > (hourTotals.get(best) ?? 0) ? hour : best),
        null,
      ),
    [hours, hourTotals],
  );
  const maxHour = useMemo(() => hours.reduce((n, hour) => Math.max(n, hourTotals.get(hour) ?? 0), 0), [hours, hourTotals]);

  return (
    <div className="grid gap-9">
      <StatStrip>
        <StripStat
          label="Providers"
          value={fmt(stats.length)}
          sub={stats.length > 0 ? `most tokens: ${stats[0].provider}` : "none in range"}
        />
        <StripStat label="Requests" value={fmt(requests)} sub={`${fmt(failed)} failed`} />
        <StripStat label="Tokens" value={fmtShort(tokens)} sub={`${fmt(output)} out`} />
        <StripStat
          label="API-equivalent cost"
          value={money(apiUsd)}
          sub={`${data.pricingCoverage.priced}/${data.pricingCoverage.total} models priced`}
        />
        <StripStat
          label="Error rate"
          value={percent(errorRate)}
          tone={failed > 0 ? "danger" : "default"}
          sub={`${fmt(requests - failed)} succeeded`}
        />
      </StatStrip>

      <Section
        title="Provider totals"
        hint="Requests, cost, and share per provider in the range; tokens/s averages the rows that recorded a duration. Select a row for its token mix"
      >
        <DataTable
          columns={columns}
          data={stats}
          caption="Requests, cost, and share per provider in the selected range"
          emptyTitle={`No providers in ${RANGE_LABELS[range]}`}
          emptyBody="Nothing ran in the selected range."
          renderExpanded={(row) => (
            <ul className="m-0 grid list-none divide-y divide-line p-0">
              {row.modelTokens.map(([label, value]) => (
                <li key={label} className="flex items-center justify-between gap-3 px-5 py-1.5 text-xs">
                  <span className="mono min-w-0 truncate text-dim" title={label}>
                    {label}
                  </span>
                  <span className="mono shrink-0 tabular-nums">{fmtShort(value)}</span>
                </li>
              ))}
            </ul>
          )}
        />
      </Section>

      <Section
        title="Burn by provider"
        hint={`${RANGE_LABELS[range]} · ${mode === "tokens" ? "tokens" : "API-equivalent cost"} · ${
          view.short ? "per bucket" : "per day"
        }, largest five named`}
        actions={
          <Tabs value={mode} onValueChange={(value) => setMode(value as BurnMode)}>
            <TabsList className="h-auto rounded-[10px] border border-line bg-panel p-1">
              {BURN_MODES.map((id) => (
                <TabsTrigger key={id} value={id} className="h-auto px-3 py-1.5 text-xs">
                  {BURN_LABEL[id]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        }
      >
        <StackedTrendChart
          buckets={buckets}
          series={chartSeries}
          format={mode === "tokens" ? fmtShort : money}
          emptyTitle="No provider activity in this range"
          emptyBody="Choose a wider range, or run an agent session to record usage."
        />
      </Section>

      <Section
        title="Peak burn hours"
        hint={
          peak === null
            ? "Tokens by local hour of day"
            : `Tokens by local hour of day; peak at ${String(peak).padStart(2, "0")}:00 · colours match the burn chart`
        }
      >
        {rowsCapped && (
          <Note tone="warn">
            Hour of day is not stored per day, so this folds the newest {fmt(RECENT_CAP)} requests;
            the hours are a lower bound.
          </Note>
        )}
        {hours.length === 0 ? (
          <Note>No request carried a timestamp in this range.</Note>
        ) : (
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {hours.map((hour) => {
              const total = hourTotals.get(hour) ?? 0;
              const segments = kept.map((row, i) => ({
                color: seriesColor(i),
                value: hourPoint.get(`${hour}\u0000${row.provider}`) ?? 0,
              }));
              if (rest.length > 0) {
                segments.push({
                  color: seriesColor(kept.length, true),
                  value: rest.reduce((n, row) => n + (hourPoint.get(`${hour}\u0000${row.provider}`) ?? 0), 0),
                });
              }
              return (
                <li key={hour} className="flex items-center gap-3">
                  <span className="mono w-11 shrink-0 text-[11px] text-dim tabular-nums">{String(hour).padStart(2, "0")}:00</span>
                  <span className="h-3 min-w-0 flex-1 overflow-hidden rounded-[3px] bg-track">
                    <span
                      className="flex h-full"
                      style={{ width: `${maxHour > 0 ? (total / maxHour) * 100 : 0}%` }}
                    >
                      {segments.map((segment, i) => (
                        <span
                          key={i}
                          className="h-full"
                          style={{
                            width: `${total > 0 ? (segment.value / total) * 100 : 0}%`,
                            background: segment.color,
                          }}
                        />
                      ))}
                    </span>
                  </span>
                  <span className="mono w-14 shrink-0 text-right text-[11px] tabular-nums">{fmtShort(total)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <div className="grid gap-2">
        <Note>
          A provider is the pricing catalog&apos;s entry for the model that ran: the provider the catalog
          says serves it. A model the catalog does not list has no provider to name, so its usage counts
          as <span className="mono">unknown</span> — which is why that row can hold the most tokens.
        </Note>
        <Note>
          {`Cost here is API-equivalent: each row's tokens priced at its model's catalog rate, so a provider with no priced model reads N/A. It is not vendor-reported spend. Measured spend in this range is ${money(
            measuredUsd,
          )}, reported per model on the Costs page.`}
        </Note>
      </div>

      <Section title="Subscription windows">
        <Note>
          Tersio records no subscription, quota, reset, or rate-limit windows, so there is nothing to
          fill in here. OMP&apos;s equivalent lists each account&apos;s window burn, resets, and utilization;
          that needs per-account plan data, which the transcripts do not carry.
        </Note>
      </Section>

      <Section title="Window utilization">
        <Note>
          No rate-limit or quota window is recorded, so there is no utilization to show. This stays a
          note until an account&apos;s plan data is available.
        </Note>
      </Section>
    </div>
  );
}
