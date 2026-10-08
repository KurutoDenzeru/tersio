// Costs: three numbers that are never blended — measured, API-equivalent, and cache savings.
import { useMemo } from "react";
import { BarList, Note, Section, percent, StatStrip, StripStat } from "@/components/dash/composites";
import { TrendChart } from "@/components/dash/trend";
import { byModelLabeled, modelUsd, rangeView, sumNumbers, tokensOf } from "@/lib/aggregate";
import { fmt, fmtShort } from "@/lib/format";
import type { PageProps } from "./types";

export function CostsPage({ data, cutoff, since, range, money }: PageProps) {
  // `rangeView` returns a fresh object each call, so it is memoized on its inputs; otherwise every
  // memo below misses on each render and re-sums the day tables on each click.
  const view = useMemo(() => rangeView(data, range, cutoff, since), [data, range, cutoff, since]);
  const apiUsd = useMemo(() => sumNumbers(view.data.byDayApiUsd, view.cutoff), [view]);
  const measuredUsd = useMemo(() => sumNumbers(view.data.byDayCost, view.cutoff), [view]);
  const savedUsd = useMemo(() => sumNumbers(view.data.byDaySavedUsd, view.cutoff), [view]);
  const totals = view.totals();
  const usdByModel = modelUsd(view.data.byDayModelUsd, view.cutoff);
  const coverage = data.pricingCoverage;

  const points = Object.keys(view.data.byDayApiUsd)
    .filter((day) => view.cutoff === null || day >= view.cutoff)
    .sort()
    .map((day) => ({ day, value: view.data.byDayApiUsd[day] }))
    .filter((p) => p.value > 0);

  const costRows = byModelLabeled(view.data.byDayModelTokens, view.cutoff, data.modelLabels)
    .map(([label, b]) => ({ label, b, usd: usdByModel.get(label) ?? 0 }))
    .filter((r) => r.usd > 0)
    .sort((a, b) => b.usd - a.usd)
    .slice(0, 10)
    .map((r) => ({
      label: r.label,
      value: r.usd,
      display: money(r.usd),
      sub: `${fmtShort(tokensOf(r.b))} tokens`,
    }));

  const unpricedRows = data.unpriced.slice(0, 10).map((u) => ({
    label: u.model,
    value: u.tokens,
    display: fmtShort(u.tokens),
    sub: `${fmt(u.messages)} runs · no price`,
  }));

  return (
    <div className="grid gap-9">
      <StatStrip>
          <StripStat             label="API-equivalent"
            value={money(apiUsd)}
            sub={`${coverage.priced}/${coverage.total} models priced`}
          />
          <StripStat label="Measured" value={money(measuredUsd)} sub="vendor-reported, may be zero on a plan" />
          <StripStat label="Cache saved" value={money(savedUsd)} tone="accent" sub="estimated from the read rate" />
          <StripStat             label="Cost per run"
            value={totals.runs > 0 ? money(apiUsd / totals.runs) : "—"}
            sub={`${fmt(totals.runs)} runs in range`}
          />
        </StatStrip>
      <Note>
          These are three separate figures and they are never added together. API-equivalent values
          priced usage at public API rates; measured is what a host reported; cache saved is what the
          cache reads avoided.{" "}
          {coverage.priced < coverage.total
            ? `${coverage.total - coverage.priced} of ${coverage.total} models have no public price, so their usage is excluded rather than estimated at a default rate.`
            : "Every model that ran had a public price."}
        </Note>
      

      <Section title={view.short ? "API-equivalent per bucket" : "API-equivalent per day"} hint="Priced models only">
        {view.partial && (
          <Note tone="warn">
            The payload holds only the newest 2000 requests, so this range&apos;s figures are a lower bound.
          </Note>
        )}
        <TrendChart
          points={points}
          format={(v) => money(v)}
          emptyTitle="No priced usage in this range"
          emptyBody="Nothing priced ran in this range, so there is no cost series to draw."
        />
      </Section>

      <Section title="Cost by model" hint="API-equivalent, largest first">
        <BarList rows={costRows} empty="No priced model ran in this range." />
      </Section>

      <Section
        title="Pricing coverage"
        hint={`${percent(coverage.total > 0 ? (coverage.priced / coverage.total) * 100 : 0, 0)} of models priced`}
      >
        {unpricedRows.length === 0 ? (
          <Note>Every model that ran resolved to a public price.</Note>
        ) : (
          <>
            <BarList rows={unpricedRows} empty="No unpriced models." />
            <Note tone="warn">
              These models carry usage but no public price, so they are excluded from every dollar
              figure on this page instead of being valued at a default rate. Their tokens still count
              on the token pages.
            </Note>
          </>
        )}
      </Section>
    </div>
  );
}
