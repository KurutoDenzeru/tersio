// Providers: burn, reliability, and subscription headroom per provider, plus what one usage window buys.
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/native-select";
import { ProviderMark } from "@/components/brand";
import { OMP_RANGE_LABEL } from "@/lib/data";
import type { OmpProviderHour, OmpRow, OmpStats, OmpUsageWindowSeries, OmpWindowInsight } from "@/lib/data";
import {
  Card,
  CellBar,
  Chart,
  DataTable,
  Legend,
  MeterCell,
  Page,
  PageHeader,
  QueryView,
  Segmented,
  Stat,
  StatGrid,
  TimeChart,
} from "@/components/charts";
import type { Column, SeriesSpec } from "@/components/charts";
import { EmptyState } from "@/components/common";
import {
  PALETTE,
  fmt,
  fmtShort,
  hourLabel,
  pct,
  providerColor,
  relAge,
  stampLocal,
  tsFull,
  tsLabel,
  whenStamp,
} from "@/lib/format";

type BurnMetric = "tokens" | "cost" | "requests";

const BURN_OPTIONS = [
  { value: "tokens" as const, label: "Tokens" },
  { value: "cost" as const, label: "Cost" },
  { value: "requests" as const, label: "Requests" },
];

/** Providers stacked individually in the burn chart; the rest fold into "Other". */
const TOP_PROVIDERS = 6;

const SNAPSHOT_HINT = "Usage snapshots accumulate whenever usage limits are fetched (TUI footer, /usage, omp usage).";

interface WindowRef {
  provider: string;
  windowKey: string;
}

export function ProvidersPage({ omp, money }: { omp: OmpStats; money: (v: number) => string }) {
  const [metric, setMetric] = useState<BurnMetric>("tokens");
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [picked, setPicked] = useState<WindowRef | null>(null);

  const selected = useMemo(() => resolveWindow(omp.windowInsights, picked), [omp.windowInsights, picked]);

  const burn = useMemo(() => {
    const top = [...omp.seriesByProvider]
      .toSorted(
        (a, b) =>
          b.points.reduce((sum, p) => sum + p.costUsd, 0) - a.points.reduce((sum, p) => sum + p.costUsd, 0),
      )
      .slice(0, TOP_PROVIDERS);
    const spec: SeriesSpec[] = top.map((p, i) => ({
      key: `p${i}`,
      label: p.provider,
      color: PALETTE[i % PALETTE.length],
    }));
    const stamps = [...new Set(top.flatMap((p) => p.points.map((point) => point.ts)))].toSorted((a, b) => a - b);
    const byTs = top.map(
      (p) =>
        new Map(
          p.points.map(
            (point) =>
              [
                point.ts,
                metric === "cost" ? point.costUsd : metric === "requests" ? point.requests : point.tokens,
              ] as const,
          ),
        ),
    );
    const rows = stamps.map((ts) => {
      const row: { ts: number } & Record<string, number> = { ts };
      spec.forEach((s, i) => {
        row[s.key] = byTs[i].get(ts) ?? 0;
      });
      return row;
    });
    return { spec, rows };
  }, [omp.seriesByProvider, metric]);

  const shown = burn.spec.filter((s) => !hidden.has(s.key));
  const toggle = (key: string) =>
    setHidden((held) => {
      const next = new Set(held);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const totals = omp.overall;
  const unpriced = totals.unpricedRequests;
  const burnFmt = metric === "cost" ? money : fmtShort;
  const bucketWord = omp.bucketMs < 3_600_000 ? "5 minutes" : omp.bucketMs < 86_400_000 ? "hour" : "day";
  const topProvider = useMemo(
    () => omp.byProvider.reduce<OmpRow | null>((top, p) => (top === null || p.total > top.total ? p : top), null),
    [omp.byProvider],
  );

  return (
    <Page>
      <PageHeader
        title="Providers"
        description={`Burn, reliability and subscription headroom per provider over ${OMP_RANGE_LABEL[omp.range]}.`}
      />

      <StatGrid cols={5}>
        <Stat
          label="Providers"
          value={fmt(omp.byProvider.length)}
          hint={topProvider ? `Most tokens: ${topProvider.key}` : undefined}
        />
        <Stat
          label="Requests"
          value={fmt(totals.requests)}
          hint={`${fmt(totals.failed)} failed`}
          spark={omp.series.map((b) => b.requests)}
        />
        <Stat
          label="Tokens"
          title="Uncached input + cache reads + cache writes + output"
          value={fmtShort(totals.total)}
          spark={omp.series.map((b) => b.tokens)}
        />
        <Stat
          label="API-equivalent cost"
          title="What this usage would cost at public API rates"
          value={money(totals.costUsd)}
          hint={unpriced > 0 ? `${fmt(unpriced)} unpriced` : undefined}
          spark={omp.series.map((b) => b.costUsd)}
        />
        <Stat
          label="Error rate"
          value={pct(totals.errorRate)}
          hint={`${fmt(totals.requests - totals.failed)} succeeded`}
        />
      </StatGrid>

      <Card
        index={1}
        title="Provider totals"
        description={
          unpriced > 0
            ? `Cost is an API-equivalent estimate and excludes ${fmt(unpriced)} unpriced subscription request${unpriced === 1 ? "" : "s"}. Select a row for its token mix.`
            : "Cost is an API-equivalent estimate. Select a row for its token mix."
        }
        flush
      >
        <ProviderTotalsTable providers={omp.byProvider} money={money} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card
          index={2}
          title="Burn by provider"
          description={
            metric === "cost" && unpriced > 0
              ? `API-equivalent estimate per ${omp.bucketMs < 86_400_000 ? "hour" : "day"}; excludes unpriced subscription requests`
              : `Per ${bucketWord}, top ${TOP_PROVIDERS} providers stacked`
          }
          actions={
            <Segmented
              value={metric}
              options={BURN_OPTIONS}
              onChange={setMetric}
              label="Burn metric"
            />
          }
        >
          <QueryView
            empty={burn.rows.length === 0}
            emptyIcon="chart-column"
            emptyTitle="No provider activity in this range"
            emptyDesc="Pick a longer range to see burn."
          >
            <div className="flex flex-col gap-3">
              <TimeChart
                data={burn.rows}
                series={shown}
                xKey="ts"
                mode="area"
                stacked
                height={260}
                tick={(ts) => tsLabel(ts, omp.bucketMs)}
                label={(ts) => tsFull(ts, omp.bucketMs)}
                valueFmt={burnFmt}
                ariaLabel="Tokens, cost, or requests per bucket, stacked by provider"
                summary={`The ${metric} burned per bucket across the ${burn.spec.length} busiest providers in range.`}
              />
              <Legend items={burn.spec} active={new Set(shown.map((s) => s.key))} onToggle={toggle} />
            </div>
          </QueryView>
        </Card>

        <PeakHoursCard hourly={omp.providerHourly} providers={omp.byProvider} />
      </div>

      <Card
        index={4}
        title="Subscription windows"
        description="What one usage window buys you and how many accounts peak demand needs. Select a row to chart it."
        flush
      >
        <WindowInsightsTable insights={omp.windowInsights} onSelect={setPicked} />
      </Card>

      <WindowUtilizationCard
        insights={omp.windowInsights}
        series={omp.usageSeries}
        selected={selected}
        onSelect={setPicked}
      />
    </Page>
  );
}

/**
 * The window charted below the insights table: the user's pick when it still
 * exists, else the first window of the picked provider, else the most-burned
 * window (the insights table's first row).
 */
function resolveWindow(insights: readonly OmpWindowInsight[], picked: WindowRef | null): WindowRef | null {
  if (picked && insights.some((i) => i.provider === picked.provider && i.windowKey === picked.windowKey)) return picked;
  const fallback =
    (picked && insights.find((i) => i.provider === picked.provider)) ||
    insights.reduce<OmpWindowInsight | undefined>(
      (top, i) => (top === undefined || i.fractionConsumed > top.fractionConsumed ? i : top),
      undefined,
    );
  return fallback ? { provider: fallback.provider, windowKey: fallback.windowKey } : null;
}

// ---------------------------------------------------------------------------
// Provider totals
// ---------------------------------------------------------------------------

function ProviderTotalsTable({
  providers,
  money,
}: {
  providers: OmpRow[];
  money: (v: number) => string;
}) {
  const [open, setOpen] = useState<string | null>(null);

  const columns = useMemo<Array<Column<OmpRow>>>(() => {
    let maxRequests = 0;
    let maxTokens = 0;
    let grandTokens = 0;
    for (const p of providers) {
      maxRequests = Math.max(maxRequests, p.requests);
      maxTokens = Math.max(maxTokens, p.total);
      grandTokens += p.total;
    }
    return [
      {
        key: "provider",
        header: "Provider",
        sort: (p) => p.provider,
        render: (p) => (
          <span className="mono flex items-center gap-2">
            <ProviderMark provider={p.provider} small />
            <span className="truncate">{p.provider}</span>
          </span>
        ),
      },
      {
        key: "requests",
        header: "Requests",
        align: "right",
        width: 140,
        sort: (p) => p.requests,
        render: (p) => (
          <span className="flex flex-col items-end gap-1">
            <span className="mono tabular-nums">{fmt(p.requests)}</span>
            <CellBar value={p.requests} max={maxRequests} />
          </span>
        ),
      },
      {
        key: "errors",
        header: "Error rate",
        align: "right",
        sort: (p) => (p.requests > 0 ? p.failed / p.requests : 0),
        render: (p) => (
          <span className="flex items-center justify-end gap-2">
            <span className="mono tabular-nums text-dim">{fmt(p.failed)}</span>
            <Badge
              variant={p.failed > 0 && p.errorRate >= 0.1 ? "destructive" : "outline"}
              className={
                p.failed > 0 && p.errorRate >= 0.1
                  ? "mono"
                  : `mono border-line ${p.failed > 0 ? "text-[var(--warn-border)]" : "text-dim"}`
              }
            >
              {pct(p.errorRate)}
            </Badge>
          </span>
        ),
      },
      {
        key: "models",
        header: "Models",
        title: "Distinct models used through this provider",
        align: "right",
        sort: (p) => p.models,
        render: (p) => <span className="mono tabular-nums">{fmt(p.models)}</span>,
      },
      {
        key: "tokens",
        header: "Tokens",
        title: "Uncached input + cache reads + cache writes + output",
        align: "right",
        width: 150,
        sort: (p) => p.total,
        render: (p) => (
          <span className="flex flex-col items-end gap-1">
            <span className="mono tabular-nums">{fmtShort(p.total)}</span>
            <CellBar value={p.total} max={maxTokens} color={providerColor(p.provider)} />
          </span>
        ),
      },
      {
        key: "share",
        header: "Share",
        title: "Fraction of all tokens in range",
        align: "right",
        sort: (p) => p.total,
        render: (p) => (
          <span className="mono tabular-nums text-dim">
            {pct(grandTokens > 0 ? p.total / grandTokens : 0)}
          </span>
        ),
      },
      {
        key: "cost",
        header: "Cost",
        title: "API-equivalent estimate",
        align: "right",
        sort: (p) => p.costUsd,
        render: (p) => (
          <span
            className="mono tabular-nums"
            title={p.unpricedRequests > 0 ? `${fmt(p.unpricedRequests)} unpriced` : undefined}
          >
            {money(p.costUsd)}
          </span>
        ),
      },
      {
        key: "tps",
        header: "Tokens/s",
        title: "Average output throughput",
        align: "right",
        sort: (p) => p.avgTokensPerSecond,
        render: (p) => (
          <span className="mono tabular-nums">
            {p.avgTokensPerSecond > 0 ? `${p.avgTokensPerSecond.toFixed(1)}/s` : "-"}
          </span>
        ),
      },
    ];
  }, [providers, money]);

  const current = providers.find((p) => p.provider === open);

  return (
    <>
      <DataTable
        columns={columns}
        rows={providers}
        rowKey={(p) => p.provider}
        onRowClick={(p) => setOpen((prev) => (prev === p.provider ? null : p.provider))}
        initialSort={{ key: "tokens", dir: "desc" }}
        limit={12}
        ariaLabel="Provider totals"
        empty={<EmptyState icon="circle-slash" title="No requests in this range" desc="Try a longer range." />}
      />
      {current && <TokenMix provider={current} />}
    </>
  );
}

const TOKEN_MIX: Array<{ label: string; color: string; pick: (p: OmpRow) => number }> = [
  { label: "Uncached input", color: PALETTE[1], pick: (p) => p.input },
  { label: "Cache read", color: PALETTE[0], pick: (p) => p.cacheRead },
  { label: "Cache write", color: PALETTE[3], pick: (p) => p.cacheWrite },
  { label: "Output", color: PALETTE[4], pick: (p) => p.output },
];

function TokenMix({ provider }: { provider: OmpRow }) {
  const parts = TOKEN_MIX.map((m) => ({ label: m.label, color: m.color, value: m.pick(provider) }));
  return (
    <div className="flex flex-col gap-3 border-t border-line px-3.5 py-3">
      <p className="mono text-[11px] uppercase tracking-[0.12em] text-dim">Token mix · {provider.provider}</p>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-track" aria-hidden="true">
        {parts.map((part) => (
          <span
            key={part.label}
            style={{ width: `${provider.total > 0 ? (part.value / provider.total) * 100 : 0}%`, background: part.color }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {parts.map((part) => (
          <li key={part.label} className="flex items-center gap-1.5 text-[11px] text-dim">
            <span className="size-2 shrink-0 rounded-[2px]" style={{ background: part.color }} />
            <span>{part.label}</span>
            <span className="mono tabular-nums text-ink">
              {fmtShort(part.value)} · {provider.total > 0 ? pct(part.value / provider.total, 0) : "-"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Peak burn hours
// ---------------------------------------------------------------------------

const ALL_PROVIDERS = "";

function PeakHoursCard({ hourly, providers }: { hourly: OmpProviderHour[]; providers: OmpRow[] }) {
  const [provider, setProvider] = useState(ALL_PROVIDERS);
  const current = provider === ALL_PROVIDERS || providers.some((p) => p.provider === provider) ? provider : ALL_PROVIDERS;

  const hours = useMemo(() => {
    const tokens = Array.from({ length: 24 }, () => 0);
    const output = Array.from({ length: 24 }, () => 0);
    const requests = Array.from({ length: 24 }, () => 0);
    for (const point of hourly) {
      if (current !== ALL_PROVIDERS && point.provider !== current) continue;
      tokens[point.hour] += point.totalTokens;
      output[point.hour] += point.outputTokens;
      requests[point.hour] += point.requests;
    }
    let peak = 0;
    for (let hour = 1; hour < 24; hour++) if (tokens[hour] > tokens[peak]) peak = hour;
    const hasData = tokens[peak] > 0;
    const rows = tokens.map((value, hour) => ({ hour, tokens: value }));
    return { rows, output, requests, peak, hasData };
  }, [hourly, current]);

  return (
    <Card
      index={3}
      title="Peak burn hours"
      description={
        hours.hasData ? `Tokens by local hour of day; peak at ${hourLabel(hours.peak)}` : "Tokens by local hour of day"
      }
      actions={
        <NativeSelect
          size="sm"
          className="text-xs"
          aria-label="Provider"
          value={current}
          onChange={(e) => setProvider(e.target.value)}
        >
          <option value={ALL_PROVIDERS}>All providers</option>
          {providers.map((p) => (
            <option key={p.provider} value={p.provider}>
              {p.provider}
            </option>
          ))}
        </NativeSelect>
      }
    >
      <Chart
        data={hours.rows}
        series={[{ key: "tokens", label: "Tokens", color: PALETTE[0] }]}
        xKey="hour"
        height={260}
        tick={(hour) => String(hour).padStart(2, "0")}
        label={(hour) => `${hourLabel(hour)}-${hourLabel((hour + 1) % 24)}`}
        valueFmt={fmt}
        ariaLabel="Tokens by local hour of day"
        summary="Token volume per local hour of day, so the daily burn peak is visible at a glance."
      />
      <p className="mono mt-2 text-[11px] text-dim">
        {hours.hasData
          ? `Peak hour: ${fmt(hours.rows[hours.peak].tokens)} tokens, ${fmt(hours.output[hours.peak])} output across ${fmt(hours.requests[hours.peak])} requests.`
          : "No activity in this range."}
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Subscription window insights
// ---------------------------------------------------------------------------

function WindowInsightsTable({
  insights,
  onSelect,
}: {
  insights: OmpWindowInsight[];
  onSelect: (ref: WindowRef) => void;
}) {
  return (
    <DataTable
      rows={insights}
      rowKey={(i) => `${i.provider}::${i.windowKey}`}
      columns={INSIGHT_COLUMNS}
      onRowClick={(i) => onSelect({ provider: i.provider, windowKey: i.windowKey })}
      initialSort={{ key: "consumed", dir: "desc" }}
      limit={12}
      ariaLabel="Subscription windows"
      empty={
        <EmptyState
          icon="circle-slash"
          title="No usage snapshots in this range"
          desc={SNAPSHOT_HINT}
        />
      }
    />
  );
}

const INSIGHT_COLUMNS: Array<Column<OmpWindowInsight>> = [
  {
    key: "window",
    header: "Window",
    sort: (i) => `${i.provider} ${i.windowLabel}`,
    render: (i) => (
      <span className="block min-w-0">
        <span className="block truncate">{i.windowLabel}</span>
        <span className="mono block truncate text-[11px] text-dim">{i.provider}</span>
      </span>
    ),
  },
  {
    key: "accounts",
    header: "Accounts",
    title: "Accounts with at least one snapshot for this window in range",
    align: "right",
    sort: (i) => i.accounts,
    render: (i) => <span className="mono tabular-nums">{fmt(i.accounts)}</span>,
  },
  {
    key: "cycles",
    header: "Resets",
    title: "Window resets observed (drops in used fraction)",
    align: "right",
    sort: (i) => i.cycles,
    render: (i) => <span className="mono tabular-nums text-dim">{fmt(i.cycles)}</span>,
  },
  {
    key: "consumed",
    header: "Windows burned",
    title: "Subscription-window equivalents consumed in range (sum of used-fraction increases across accounts)",
    align: "right",
    sort: (i) => i.fractionConsumed,
    render: (i) => <span className="mono tabular-nums">{i.fractionConsumed.toFixed(2)}</span>,
  },
  {
    key: "capacity",
    header: "Tokens / window",
    title: "Provider tokens burned in range ÷ windows burned, what one full window is worth",
    align: "right",
    sort: (i) => i.estTokensPerWindow ?? -1,
    render: (i) =>
      i.estTokensPerWindow === null ? (
        <span className="text-dim" title="Too little of the window was consumed to extrapolate">
          -
        </span>
      ) : (
        <span className="mono tabular-nums">{fmtShort(i.estTokensPerWindow)}</span>
      ),
  },
  {
    key: "peak",
    header: "Peak utilization",
    title: "Peak of summed used fraction across accounts at any sampled instant; the bar is relative to fleet capacity",
    align: "right",
    width: 170,
    sort: (i) => i.peakConcurrentFraction,
    render: (i) => (
      <MeterCell
        value={i.peakConcurrentFraction}
        max={i.accounts}
        color={i.accounts > 0 && i.peakConcurrentFraction / i.accounts >= 0.9 ? "var(--warn-border)" : undefined}
        label={`${i.windowLabel} peak utilization`}
      />
    ),
  },
  {
    key: "ideal",
    header: "Accounts needed",
    title: "Accounts needed to keep peak demand under 90% of fleet capacity",
    align: "right",
    sort: (i) => i.idealAccounts - i.accounts,
    render: (i) =>
      i.idealAccounts > i.accounts ? (
        <Badge variant="outline" className="mono border-[var(--warn-border)] text-[var(--warn-border)]">
          {fmt(i.idealAccounts)} · have {fmt(i.accounts)}
        </Badge>
      ) : (
        <span className="mono tabular-nums">{fmt(i.idealAccounts)}</span>
      ),
  },
  {
    key: "exhausted",
    header: "Exhaustions",
    title: "Transitions into an exhausted state observed in range",
    align: "right",
    sort: (i) => i.exhaustedEvents,
    render: (i) =>
      i.exhaustedEvents > 0 ? (
        <Badge variant="outline" className="mono border-[var(--warn-border)] text-[var(--warn-border)]">
          {fmt(i.exhaustedEvents)} exhausted
        </Badge>
      ) : (
        <span className="mono tabular-nums text-dim">0</span>
      ),
  },
];

// ---------------------------------------------------------------------------
// Window utilization
// ---------------------------------------------------------------------------

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** Candidate utilization bucket sizes; the finest one within {@link MAX_UTIL_SLOTS} wins. */
const UTIL_STEPS = [
  5 * MINUTE_MS,
  15 * MINUTE_MS,
  30 * MINUTE_MS,
  HOUR_MS,
  2 * HOUR_MS,
  3 * HOUR_MS,
  6 * HOUR_MS,
  12 * HOUR_MS,
  DAY_MS,
];
const MAX_UTIL_SLOTS = 240;
/**
 * Snapshots are recorded whenever usage is fetched, so an account's samples
 * are irregular. A reading holds until the next one, but only this long:
 * longer silences render as gaps rather than invented plateaus.
 */
const MAX_HOLD_MS = 6 * HOUR_MS;

interface AccountRow {
  series: OmpUsageWindowSeries;
  /** Account label, numbered when another account shares it. */
  name: string;
  color: string | null;
  latest: { fraction: number; exhausted: boolean; timestamp: number } | null;
  peak: number | null;
  samples: number;
}

interface UtilizationChart {
  rows: Array<{ ts: number } & Record<string, number | null>>;
  series: SeriesSpec[];
  /** Color assigned to each charted account, keyed by account key. */
  colorByAccount: ReadonlyMap<string, string>;
  stepMs: number;
  first: number;
  last: number;
}

function WindowUtilizationCard({
  insights,
  series,
  selected,
  onSelect,
}: {
  insights: OmpWindowInsight[];
  /** Every provider's series; the card charts only the selected provider's window. */
  series: OmpUsageWindowSeries[];
  selected: WindowRef | null;
  onSelect: (ref: WindowRef) => void;
}) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set<string>());

  const providers = useMemo(() => [...new Set(insights.map((i) => i.provider))], [insights]);
  const windows = useMemo(
    () =>
      insights
        .filter((i) => i.provider === selected?.provider)
        .map((i) => ({ key: i.windowKey, label: i.windowLabel })),
    [insights, selected?.provider],
  );
  const providerSeries = useMemo(
    () => series.filter((s) => s.provider === selected?.provider),
    [series, selected?.provider],
  );

  // Distinct accounts can share a label (one email in two orgs): number the repeats.
  const names = useMemo(() => {
    const keysByLabel = new Map<string, string[]>();
    for (const s of providerSeries) {
      const keys = keysByLabel.get(s.accountLabel) ?? [];
      if (!keys.includes(s.accountKey)) keys.push(s.accountKey);
      keysByLabel.set(s.accountLabel, keys);
    }
    const out = new Map<string, string>();
    for (const [label, keys] of keysByLabel) {
      keys.sort();
      keys.forEach((key, i) => out.set(key, keys.length > 1 ? `${label} #${i + 1}` : label));
    }
    return out;
  }, [providerSeries]);

  const chart = useMemo(
    () =>
      buildUtilization(
        providerSeries.filter((s) => s.windowKey === selected?.windowKey),
        names,
      ),
    [providerSeries, names, selected?.windowKey],
  );

  const shown = chart.series.filter((s) => !hidden.has(s.key));
  const toggle = (key: string) =>
    setHidden((held) => {
      const next = new Set(held);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const rows = useMemo<AccountRow[]>(() => {
    return providerSeries
      .map((account) => {
        let latest: AccountRow["latest"] = null;
        let peak: number | null = null;
        for (const p of account.points) {
          if (p.usedFraction === null) continue;
          peak = Math.max(peak ?? 0, p.usedFraction);
          if (!latest || p.ts >= latest.timestamp)
            latest = { fraction: p.usedFraction, exhausted: p.exhausted, timestamp: p.ts };
        }
        const color =
          account.windowKey === selected?.windowKey ? (chart.colorByAccount.get(account.accountKey) ?? null) : null;
        return {
          series: account,
          name: names.get(account.accountKey) ?? account.accountLabel,
          color,
          latest,
          peak,
          samples: account.points.length,
        };
      })
      .toSorted(
        (a, b) =>
          Number(b.color !== null) - Number(a.color !== null) ||
          a.series.windowLabel.localeCompare(b.series.windowLabel) ||
          (b.latest?.fraction ?? -1) - (a.latest?.fraction ?? -1),
      );
  }, [providerSeries, names, chart.colorByAccount, selected?.windowKey]);

  const windowLabel = windows.find((w) => w.key === selected?.windowKey)?.label;

  return (
    <Card
      index={5}
      title="Window utilization"
      description={
        chart.rows.length > 0
          ? `${windowLabel ?? "Window"} used fraction per account, ${whenStamp(chart.first)} - ${whenStamp(chart.last)}`
          : "Recorded limit utilization per account"
      }
      actions={
        selected && (
          <>
            <NativeSelect
              size="sm"
              className="text-xs"
              aria-label="Provider"
              value={selected.provider}
              onChange={(e) => {
                const next = e.target.value;
                const first = insights.find((i) => i.provider === next);
                if (first) onSelect({ provider: next, windowKey: first.windowKey });
              }}
            >
              {providers.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              size="sm"
              className="text-xs"
              aria-label="Window"
              value={selected.windowKey}
              onChange={(e) => onSelect({ provider: selected.provider, windowKey: e.target.value })}
            >
              {windows.map((w) => (
                <option key={w.key} value={w.key}>
                  {w.label}
                </option>
              ))}
            </NativeSelect>
          </>
        )
      }
    >
      {selected === null ? (
        <EmptyState icon="circle-slash" title="No usage snapshots in this range" desc={SNAPSHOT_HINT} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <TimeChart
              data={chart.rows}
              series={shown}
              xKey="ts"
              mode="area"
              stacked={false}
              height={260}
              tick={(ts) => tsLabel(ts, chart.stepMs)}
              label={(ts) => tsFull(ts, chart.stepMs)}
              valueFmt={(v) => pct(v, 0)}
              ariaLabel="Used fraction per account over the selected subscription window"
              summary="Each line is one account's recorded used fraction, so overlapping demand and exhaustion are visible."
            />
            {chart.series.length > 1 && (
              <Legend items={chart.series} active={new Set(shown.map((s) => s.key))} onToggle={toggle} />
            )}
          </div>
          <DataTable
            rows={rows}
            rowKey={(r) => `${r.series.windowKey}::${r.series.accountKey}`}
            columns={ACCOUNT_COLUMNS}
            onRowClick={(r) => onSelect({ provider: r.series.provider, windowKey: r.series.windowKey })}
            limit={16}
            ariaLabel="Accounts"
            empty={<EmptyState icon="circle-slash" title="No accounts recorded" desc={SNAPSHOT_HINT} />}
          />
        </div>
      )}
    </Card>
  );
}

/** One line per account over a shared axis spanning the window's recorded snapshots. */
function buildUtilization(accounts: OmpUsageWindowSeries[], names: ReadonlyMap<string, string>): UtilizationChart {
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const account of accounts) {
    for (const p of account.points) {
      if (p.ts < first) first = p.ts;
      if (p.ts > last) last = p.ts;
    }
  }
  if (!(last >= first)) return { rows: [], series: [], colorByAccount: new Map<string, string>(), stepMs: HOUR_MS, first: 0, last: 0 };

  const span = last - first;
  const stepMs = UTIL_STEPS.find((step) => span / step < MAX_UTIL_SLOTS) ?? DAY_MS;
  const start = Math.floor(first / stepMs) * stepMs;
  const buckets: number[] = [];
  for (let ts = start; ts <= last; ts += stepMs) buckets.push(ts);

  const ordered = [...accounts].toSorted((a, b) =>
    (names.get(a.accountKey) ?? a.accountLabel).localeCompare(names.get(b.accountKey) ?? b.accountLabel),
  );
  const rows = buckets.map((ts) => ({ ts }) as { ts: number } & Record<string, number | null>);
  const colorByAccount = new Map<string, string>();
  const series = ordered.map((account, rank) => {
    const color = PALETTE[rank % PALETTE.length];
    colorByAccount.set(account.accountKey, color);
    const key = `a${rank}`;
    // Last reading in each bucket, then hold it forward across short silences.
    const held = buckets.map(() => Number.NaN);
    const readAt = buckets.map(() => 0);
    for (const p of account.points) {
      const i = Math.floor((p.ts - start) / stepMs);
      if (i < 0 || i >= buckets.length || p.usedFraction === null || p.ts < readAt[i]) continue;
      held[i] = p.usedFraction;
      readAt[i] = p.ts;
    }
    let carry = Number.NaN;
    let carryAt = 0;
    for (let i = 0; i < buckets.length; i++) {
      if (!Number.isNaN(held[i])) {
        carry = held[i];
        carryAt = readAt[i];
      } else if (!Number.isNaN(carry) && buckets[i] - carryAt <= MAX_HOLD_MS) {
        held[i] = carry;
      }
      rows[i][key] = Number.isNaN(held[i]) ? null : held[i];
    }
    return { key, label: names.get(account.accountKey) ?? account.accountLabel, color };
  });

  return { rows, series, colorByAccount, stepMs, first: buckets[0], last: buckets[buckets.length - 1] };
}

const BADGE_BY_STATUS: Record<
  "none" | "exhausted" | "high" | "ok",
  { variant: "success" | "outline" | "destructive"; className: string; label: string }
> = {
  none: { variant: "outline", className: "mono border-line text-dim", label: "No reading" },
  exhausted: { variant: "destructive", className: "mono", label: "Exhausted" },
  high: { variant: "outline", className: "mono border-[var(--warn-border)] text-[var(--warn-border)]", label: "High" },
  ok: { variant: "success", className: "mono", label: "OK" },
};

const ACCOUNT_COLUMNS: Array<Column<AccountRow>> = [
  {
    key: "account",
    header: "Account",
    sort: (r) => r.name,
    render: (r) => (
      <span className="flex min-w-0 items-center gap-2">
        <span className="grid size-2 shrink-0 place-items-center rounded-[2px]" style={{ background: r.color ?? "transparent" }} />
        <span className="truncate" title={r.series.accountKey}>
          {r.name}
        </span>
      </span>
    ),
  },
  {
    key: "window",
    header: "Window",
    sort: (r) => r.series.windowLabel,
    render: (r) => <span className={r.color ? undefined : "text-dim"}>{r.series.windowLabel}</span>,
  },
  {
    key: "latest",
    header: "Latest used",
    align: "right",
    width: 170,
    sort: (r) => r.latest?.fraction ?? -1,
    render: (r) =>
      r.latest ? (
        <MeterCell
          value={r.latest.fraction}
          max={1}
          color={
            r.latest.exhausted
              ? "var(--danger)"
              : r.latest.fraction >= 0.8
                ? "var(--warn-border)"
                : undefined
          }
          label={`${r.name} latest used`}
        />
      ) : (
        <span className="text-dim">-</span>
      ),
  },
  {
    key: "status",
    header: "Status",
    sort: (r) => (r.latest?.exhausted ? 2 : (r.latest?.fraction ?? 0) >= 0.8 ? 1 : 0),
    render: (r) => {
      const badge =
        BADGE_BY_STATUS[
          !r.latest ? "none" : r.latest.exhausted ? "exhausted" : r.latest.fraction >= 0.8 ? "high" : "ok"
        ];
      return (
        <Badge variant={badge.variant} className={badge.className}>
          {badge.label}
        </Badge>
      );
    },
  },
  {
    key: "peak",
    header: "Peak in range",
    align: "right",
    sort: (r) => r.peak ?? -1,
    render: (r) => <span className="mono tabular-nums">{r.peak === null ? "-" : pct(r.peak, 0)}</span>,
  },
  {
    key: "samples",
    header: "Snapshots",
    align: "right",
    sort: (r) => r.samples,
    render: (r) => <span className="mono tabular-nums text-dim">{fmt(r.samples)}</span>,
  },
  {
    key: "recorded",
    header: "Recorded",
    align: "right",
    sort: (r) => r.latest?.timestamp ?? 0,
    render: (r) =>
      r.latest ? (
        <span className="text-dim" title={stampLocal(r.latest.timestamp)}>
          {relAge(r.latest.timestamp)}
        </span>
      ) : (
        <span className="text-dim">-</span>
      ),
  },
];
