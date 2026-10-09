// Overview: the range in figures, one burn chart, the two mixes, and the newest requests.
import { useState } from "react";
import { Card, Legend, Page, PageHeader, PagedTable, Segmented, Stat, StatGrid, TimeChart } from "@/components/charts";
import type { Column } from "@/components/charts";
import { ProviderMark, VendorMark } from "@/components/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import {
  PALETTE,
  agentTypeLabel,
  displayModel,
  fmt,
  fmtMs,
  fmtShort,
  pct,
  relAge,
  runStatusOf,
  tsFull,
  tsLabel,
  whenStamp,
} from "@/lib/format";
import type { OmpRequestRow, OmpStats } from "@/lib/data";

type ActivityMetric = "requests" | "tokens" | "cost";

const ACTIVITY_OPTIONS: ReadonlyArray<{ value: ActivityMetric; label: string }> = [
  { value: "requests", label: "Requests" },
  { value: "tokens", label: "Tokens" },
  { value: "cost", label: "Cost" },
];

// The reference window phrases, so the page copy reads like the one it mirrors.
const WINDOW: Record<OmpStats["range"], string> = {
  "1h": "the last hour",
  "24h": "the last 24 hours",
  "7d": "the last 7 days",
  "30d": "the last 30 days",
  "90d": "the last 90 days",
  all: "all time",
};

const MIX: ReadonlyArray<{ key: "input" | "cacheRead" | "cacheWrite" | "output"; label: string; color: string }> = [
  { key: "input", label: "Uncached input", color: PALETTE[1] },
  { key: "cacheRead", label: "Cache read", color: "var(--accent)" },
  { key: "cacheWrite", label: "Cache write", color: PALETTE[3] },
  { key: "output", label: "Output", color: PALETTE[2] },
];

/** A stacked share of one total, the shape the reference draws above its legend. */
function ShareBar({ segments }: { segments: Array<{ key: string; label: string; value: number; color: string }> }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) return null;
  return (
    <div
      className="flex h-2 w-full overflow-hidden rounded-full bg-track"
      role="img"
      aria-label={`Share of the total by ${segments.map((s) => s.label).join(", ")}`}
    >
      {segments.map((s) => (
        <span key={s.key} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
      ))}
    </div>
  );
}

export function OverviewPage({
  omp,
  money,
  onOpenRequest,
}: {
  omp: OmpStats;
  money: (v: number) => string;
  onOpenRequest: (row: OmpRequestRow) => void;
}) {
  const [metric, setMetric] = useState<ActivityMetric>("requests");
  const o = omp.overall;
  const windowLabel = WINDOW[omp.range];
  const points = omp.series;
  const bucket = omp.bucketMs < 3_600_000 ? "5 minutes" : omp.bucketMs < 86_400_000 ? "hour" : "day";

  const chartData = points.map((b) => ({
    ts: b.ts,
    ok: b.requests - b.errors,
    err: b.errors,
    tokens: b.tokens,
    cost: b.costUsd,
  }));
  const series =
    metric === "requests"
      ? [
          { key: "ok", label: "Succeeded", color: "var(--accent)" },
          { key: "err", label: "Failed", color: "var(--danger)" },
        ]
      : metric === "tokens"
        ? [{ key: "tokens", label: "Tokens", color: "var(--accent)" }]
        : [{ key: "cost", label: "API-equivalent", color: PALETTE[1] }];

  const mix = { input: o.input, cacheRead: o.cacheRead, cacheWrite: o.cacheWrite, output: o.output };
  const mixTotal = o.total;
  const agentTotal = omp.byAgentType.reduce((sum, row) => sum + row.total, 0);

  return (
    <Page>
      <PageHeader title="Overview" description={`Everything omp did across your sessions in ${windowLabel}.`} />

      <StatGrid cols={5}>
        <Stat
          label="API-equivalent cost"
          title="What this usage would cost at public API rates"
          value={money(o.costUsd)}
          hint={o.unpricedRequests > 0 ? `${fmt(o.unpricedRequests)} unpriced` : undefined}
          spark={points.map((b) => b.costUsd)}
        />
        <Stat
          label="Requests"
          value={fmt(o.requests)}
          hint={`${fmt(o.failed)} failed`}
          spark={points.map((b) => b.requests)}
        />
        <Stat
          label="Conversation tokens"
          title="Uncached input + cache reads + cache writes + output"
          value={fmtShort(o.total)}
          hint={`${fmtShort(o.output)} output`}
          spark={points.map((b) => b.tokens)}
        />
        <Stat
          label="Cache rate"
          title="Cache reads ÷ (uncached input + cache reads)"
          value={pct(o.cacheRate)}
          hint={`${pct(o.cacheSavings)} saved`}
        />
        <Stat
          label="Error rate"
          value={pct(o.errorRate)}
          hint={`${fmt(o.successful)} succeeded`}
          spark={points.map((b) => b.errors)}
        />
      </StatGrid>

      <StatGrid cols={7}>
        <Stat size="sm" icon="arrow-down-to-line" label="Uncached input" value={fmtShort(o.input)} hint={o.total > 0 ? pct(o.input / o.total) : "0%"} />
        <Stat size="sm" icon="hard-drive-download" label="Cache read" value={fmtShort(o.cacheRead)} hint={o.total > 0 ? pct(o.cacheRead / o.total) : "0%"} />
        <Stat size="sm" icon="hard-drive-upload" label="Cache write" value={fmtShort(o.cacheWrite)} hint={o.total > 0 ? pct(o.cacheWrite / o.total) : "0%"} />
        <Stat size="sm" icon="arrow-up-from-line" label="Output" value={fmtShort(o.output)} hint={o.total > 0 ? pct(o.output / o.total) : "0%"} />
        <Stat size="sm" icon="clock" label="Avg latency" value={fmtMs(o.avgDurationMs)} hint="wall clock per request" />
        <Stat size="sm" icon="timer" label="Avg TTFT" value={fmtMs(o.avgTtftMs)} hint="time to first token" />
        <Stat size="sm" icon="zap" label="Tokens/s" value={o.avgTokensPerSecond > 0 ? `${o.avgTokensPerSecond.toFixed(1)} tok/s` : "–"} hint="output tokens per second" />
      </StatGrid>


      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card
          title="Activity"
          description={`Per ${bucket}`}
          actions={<Segmented label="Activity metric" value={metric} options={ACTIVITY_OPTIONS} onChange={setMetric} />}
        >
          <TimeChart
            data={chartData}
            xKey="ts"
            series={series}
            height={260}
            tick={(v) => tsLabel(v, omp.bucketMs)}
            label={(v) => tsFull(v, omp.bucketMs)}
            valueFmt={(v) => (metric === "cost" ? money(v) : fmtShort(v))}
            ariaLabel={`Requests per ${bucket} in ${windowLabel}`}
            summary={`${metric === "requests" ? "Succeeded and failed requests" : metric === "tokens" ? "Tokens" : "API-equivalent cost"} per ${bucket} over ${windowLabel}.`}
          />
        </Card>

        <Card title="Token mix" description="Where conversation tokens went">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2.5">
              <ShareBar
                segments={MIX.map((t) => ({ key: t.key, label: t.label, value: mix[t.key], color: t.color }))}
              />
              <Legend
                items={MIX.map((t) => ({
                  key: t.key,
                  label: `${t.label} ${mixTotal > 0 ? pct(mix[t.key] / mixTotal, 0) : "–"}`,
                  color: t.color,
                }))}
              />
            </div>
            <div className="flex flex-col gap-2.5">
              <p className="mono m-0 text-[11px] uppercase tracking-[0.12em] text-dim">By agent</p>
              <ShareBar
                segments={omp.byAgentType.map((row, i) => ({
                  key: row.agentType,
                  label: agentTypeLabel(row.agentType),
                  value: row.total,
                  color: PALETTE[i % PALETTE.length],
                }))}
              />
              {omp.byAgentType.map((row, i) => (
                <div key={row.agentType} className="flex items-center justify-between gap-3 text-xs">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="size-2 shrink-0 rounded-[2px]"
                      style={{ background: PALETTE[i % PALETTE.length] }}
                    />
                    <span className="truncate">{agentTypeLabel(row.agentType)}</span>
                    <span className="mono shrink-0 text-dim">{fmt(row.requests)} req</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="mono text-dim">{fmtShort(row.total)}</span>
                    <span className="mono tabular-nums">{agentTotal > 0 ? pct(row.total / agentTotal) : "–"}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      <Card
        title="Latest requests"
        description="Most recent model calls across every session"
        actions={
          <Button variant="ghost" size="sm" render={<a href={`#/requests?range=${omp.range}`} aria-label="All requests" />}>
            All requests
            <Icon name="arrow-right" className="size-3.5" />
          </Button>
        }
        flush
      >
        <PagedTable
          columns={buildLatestColumns(money)}
          rows={omp.recent}
          rowKey={(row) => `${row.sessionFile}:${row.entryId}`}
          onRowClick={onOpenRequest}
          perPage={12}
          ariaLabel="Latest requests"
        />
      </Card>
    </Page>
  );
}

function buildLatestColumns(money: (v: number) => string): Array<Column<OmpRequestRow>> {
  return [
  {
    key: "model",
    header: "Model",
    render: (row) => (
      <span className="flex min-w-0 items-center gap-2">
        <VendorMark model={row.model} small />
        <span className="min-w-0">
          <span className="mono block truncate">{displayModel(row.model)}</span>
          <span className="flex items-center gap-1.5 text-[11px] text-dim">
            <ProviderMark provider={row.provider} small />
            <span className="truncate">{row.provider || "–"}</span>
          </span>
        </span>
      </span>
    ),
  },
  {
    key: "time",
    header: "When",
    render: (row) => (
      <span className="text-dim" title={whenStamp(row.ts)}>
        {relAge(row.ts)}
      </span>
    ),
  },
  { key: "tokens", header: "Tokens", align: "right", render: (row) => fmt(row.totalTokens) },
  {
    key: "cost",
    header: "Cost",
    title: "API-equivalent estimate",
    align: "right",
    render: (row) => money(row.costUsd),
  },
  { key: "duration", header: "Duration", align: "right", render: (row) => fmtMs(row.durationMs) },
  {
    key: "status",
    header: "Status",
    render: (row) =>
      runStatusOf(row.stopReason) === "error" ? (
        <Badge variant="destructive">Failed</Badge>
      ) : (
        <Badge variant="success">OK</Badge>
      ),
  },
  ];
}
