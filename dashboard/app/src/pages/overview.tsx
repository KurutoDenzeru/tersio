// Overview: the totals, the trend, and who did the work.
import { useMemo, useState } from "react";

import { BarList, Note, Section, percent, StatStrip, StripStat } from "@/components/dash/composites";
import { TrendChart } from "@/components/dash/trend";
import { Activity } from "@/components/activity";
import { Savings } from "@/components/savings";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { byModelLabeled, byProvider, dailySeries, meanValue, rangeView, sumNumbers, tokensOf, type SeriesDay } from "@/lib/aggregate";
import { fmt, fmtShort, fmtMs } from "@/lib/format";
import { RANGE_LABELS } from "@/lib/route";
import { StatusBadge } from "@/components/recent";
import type { PageProps } from "./types";

const CHART_MODES = ["tokens", "requests", "errors", "cost"] as const;
type ChartMode = (typeof CHART_MODES)[number];
const CHART_LABEL: Record<ChartMode, string> = { tokens: "Tokens", requests: "Requests", errors: "Errors", cost: "Cost" };

export function OverviewPage({ data, cutoff, since, range, money, fx, onCurrency }: PageProps) {
  // `rangeView` and `requests()` build fresh objects each call, so both are memoized: switching the
  // chart mode re-renders this component, and re-folding every day table per click froze the page.
  const view = useMemo(() => rangeView(data, range, cutoff, since), [data, range, cutoff, since]);
  const [chartMode, setChartMode] = useState<ChartMode>("tokens");
  const totals = view.totals();
  const t = totals.tokens;
  const apiUsd = useMemo(() => sumNumbers(view.data.byDayApiUsd, view.cutoff), [view]);
  const savedUsd = useMemo(() => sumNumbers(view.data.byDaySavedUsd, view.cutoff), [view]);
  const measuredUsd = useMemo(() => sumNumbers(view.data.byDayCost, view.cutoff), [view]);
  const rows = useMemo(() => view.requests(), [view]);
  const avgElapsed = useMemo(() => meanValue(rows, (r) => r.d), [rows]);
  const avgTtft = useMemo(() => meanValue(rows, (r) => r.tf), [rows]);
  const elapsedCount = useMemo(() => rows.filter((r) => r.d !== undefined).length, [rows]);
  const ttftCount = useMemo(() => rows.filter((r) => r.tf !== undefined).length, [rows]);
  const series = useMemo(() => dailySeries(view.data, view.cutoff), [view]);
  const valueOf: Record<ChartMode, (d: SeriesDay) => number> = {
    tokens: (d) => d.tokens,
    requests: (d) => d.requests,
    errors: (d) => d.errors,
    cost: (d) => d.cost,
  };
  const formatOf: Record<ChartMode, (v: number) => string> = {
    tokens: (v) => `${fmt(v)} tokens`,
    requests: (v) => `${fmt(v)} requests`,
    errors: (v) => `${fmt(v)} errors`,
    cost: (v) => money(v),
  };
  const points = useMemo(
    () => series.map((d) => ({ day: d.day, value: valueOf[chartMode](d) })),
    [series, chartMode],
  );

  const modelRows = useMemo(
    () =>
      byModelLabeled(view.data.byDayModelTokens, view.cutoff, data.modelLabels)
        .slice(0, 7)
        .map(([label, b]) => {
          const base = b.input + b.cacheRead;
          return {
            label,
            value: tokensOf(b),
            display: fmtShort(tokensOf(b)),
            sub: base > 0 ? `${percent((b.cacheRead / base) * 100, 0)} hit` : undefined,
          };
        }),
    [view, data.modelLabels],
  );

  const providerRows = useMemo(
    () =>
      byProvider(view.data.byDayProvider, view.cutoff)
        .slice(0, 6)
        .map(([label, b]) => ({
          label,
          value: tokensOf(b),
          display: fmtShort(tokensOf(b)),
          sub: `${fmt(b.output)} out`,
        })),
    [view],
  );

  const latest = useMemo(() => rows.slice(0, 6), [rows]);

  return (
    <div className="grid gap-9">
      <StatStrip>
          <StripStat label="Tokens" value={fmtShort(tokensOf(t))} sub={`${fmt(t.input)} in · ${fmt(t.output)} out`} />
          <StripStat             label="API-equivalent"
            value={money(apiUsd)}
            sub={`${data.pricingCoverage.priced}/${data.pricingCoverage.total} models priced`}
          />
          <StripStat label="Measured" value={money(measuredUsd)} sub="vendor-reported" />
          <StripStat label="Runs" value={fmt(totals.runs)} sub={`${percent(totals.completionPct)} completed`} />
          <StripStat
            label="Avg elapsed"
            value={avgElapsed === null ? "N/A" : fmtMs(avgElapsed)}
            sub={`${fmt(elapsedCount)} measured`}
          />
          <StripStat label="TTFT" value={avgTtft === null ? "N/A" : fmtMs(avgTtft)} sub={`${fmt(ttftCount)} recorded`} />
          <StripStat label="Cache hit" value={percent(totals.cacheHitPct)} tone="accent" sub={`${fmtShort(t.cacheRead)} read`} />
          <StripStat             label="Errors"
            value={fmt(totals.errors)}
            tone={totals.errors > 0 ? "danger" : "default"}
            sub={`${fmt(totals.aborted)} aborted`}
          />
          <StripStat label="Cache saved" value={money(savedUsd)} tone="accent" sub="estimated" />
          <StripStat             label="Reasoning"
            value={fmtShort(data.reasoning)}
            sub={data.reasoning > 0 ? "billed as output" : "none recorded"}
          />
        </StatStrip>

      <Section
        title={`${CHART_LABEL[chartMode]} per ${view.short ? "bucket" : "day"}`}
        hint={`${RANGE_LABELS[range]} · local dates${chartMode === "cost" ? " · measured" : ""}`}
        actions={
          <Tabs value={chartMode} onValueChange={(value) => setChartMode(value as ChartMode)}>
            <TabsList className="h-auto rounded-[10px] border border-line bg-panel p-1">
              {CHART_MODES.map((id) => (
                <TabsTrigger key={id} value={id} className="h-auto px-3 py-1.5 text-xs">
                  {CHART_LABEL[id]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        }
      >
        {view.partial && (
          <Note tone="warn">
            The payload holds only the newest 2000 requests, so this range&apos;s figures are a lower bound.
          </Note>
        )}
        <TrendChart
          points={points}
          format={formatOf[chartMode]}
          emptyTitle="No daily records in this range"
          emptyBody="Choose a wider range, or run an agent session to record usage."
        />
      </Section>

      <div className="grid gap-9 lg:grid-cols-2">
        <Section title="Top models" hint="By tokens in range">
          <BarList rows={modelRows} empty="No model usage in this range." />
        </Section>
        <Section title="Top providers" hint="By tokens in range">
          <BarList rows={providerRows} empty="No provider recorded in this range." />
        </Section>
      </div>

      <Section title="Latest runs" hint={view.allTime ? "Newest recorded" : "Newest inside the range"}>        {latest.length === 0 ? (
          <Note>No runs fall inside {RANGE_LABELS[range]}.</Note>
        ) : (
          <ul className="m-0 grid list-none divide-y divide-line p-0">
            {latest.map((r, i) => (
              <li key={r.id ?? `${r.t}-${i}`} className="flex items-center gap-3 py-2">
                <span className="mono min-w-0 flex-1 truncate text-xs" title={r.m}>
                  {r.m}
                </span>
                <span className="mono hidden shrink-0 text-[11px] text-dim sm:inline">{r.h ?? "—"}</span>
                <span className="mono shrink-0 text-xs tabular-nums">{fmt(r.i + r.o)}</span>
                <StatusBadge r={r} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Calendar views have no range to obey, so these two keep all time and say so. */}
      <Section title="Heatmap and savings" hint="All time — a calendar does not follow the range">
        <Activity data={data} />
        <Savings data={data} fx={fx} money={money} onCurrency={onCurrency} />
        <Note>
          The heatmap is a fixed 182-day calendar and the savings breakdown is cumulative, so both
          ignore the range picker by design. Every figure above follows it.
        </Note>
      </Section>
    </div>
  );
}
