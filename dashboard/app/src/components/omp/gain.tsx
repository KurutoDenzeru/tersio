// Gain: tokens snapcompact kept out of context, by day and by subsystem.
import { useMemo, useState } from "react";
import { Card, CellBar, Chart, DataTable, Legend, Page, PageHeader, QueryView, Stat, StatGrid, TimeChart } from "@/components/charts";
import type { Column, SeriesSpec } from "@/components/charts";
import { EmptyState } from "@/components/common";
import { OMP_RANGE_LABEL } from "@/lib/data";
import type { OmpGainTotals, OmpStats } from "@/lib/data";
import { fmt, fmtShort, PALETTE, pct, tsLabel } from "@/lib/format";

const DAY_MS = 86_400_000;

/** The reference estimates one token at four bytes. */
const BYTES_PER_TOKEN = 4;

/** The server buckets gain by UTC calendar day. */
const SOURCE_LABEL: Record<"snapcompact", string> = { snapcompact: "Snapcompact" };

interface SourceRow extends OmpGainTotals {
  source: "snapcompact";
  /** Share of all saved tokens (0-1). */
  share: number;
}

function formatBytes(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)} GB`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)} MB`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)} KB`;
  return `${value} B`;
}

export function GainPage({ omp }: { omp: OmpStats; money: (v: number) => string }) {
  const { overall, bySource, timeSeries } = omp.gain;
  const rangeLabel = OMP_RANGE_LABEL[omp.range];
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());

  const chart = useMemo(() => {
    let running = 0;
    const rows: Array<{ i: number; ts: number; daily: number; cumulative: number }> = [];
    for (const [i, point] of timeSeries.entries()) {
      running += point.snapcompact;
      rows.push({ i, ts: Date.parse(`${point.date}T00:00:00Z`), daily: point.snapcompact, cumulative: running });
    }
    return rows;
  }, [timeSeries]);

  const sourceRows = useMemo<SourceRow[]>(() => {
    const total = overall.savedTokens;
    const source = bySource.snapcompact;
    return [{ ...source, source: "snapcompact", share: total > 0 ? source.savedTokens / total : 0 }];
  }, [overall.savedTokens, bySource]);

  const legendItems: SeriesSpec[] = [
    { key: "daily", label: "Saved per day", color: PALETTE[0] },
    { key: "cumulative", label: "Cumulative", color: PALETTE[1] },
  ];
  const visibleKeys = new Set(legendItems.filter((item) => !hidden.has(item.key)).map((item) => item.key));
  const toggleSeries = (key: string): void => {
    setHidden((held) => {
      const next = new Set(held);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const tick = (i: number): string => tsLabel(chart[i]?.ts ?? 0, DAY_MS);

  const columns = useMemo<Array<Column<SourceRow>>>(
    () => [
      {
        key: "source",
        header: "Source",
        sort: (row) => row.source,
        render: (row) => <span className="text-ink">{SOURCE_LABEL[row.source]}</span>,
      },
      {
        key: "tokens",
        header: "Saved tokens",
        align: "right",
        sort: (row) => row.savedTokens,
        render: (row) => (
          <span className="flex flex-col items-end gap-1">
            <span className="mono text-xs tabular-nums" title={fmt(row.savedTokens)}>
              {fmtShort(row.savedTokens)}
            </span>
            <CellBar value={row.share} max={1} />
          </span>
        ),
      },
      {
        key: "share",
        header: "Share",
        align: "right",
        sort: (row) => row.share,
        render: (row) => <span className="mono text-xs tabular-nums text-dim">{pct(row.share)}</span>,
      },
      {
        key: "bytes",
        header: "Saved bytes",
        align: "right",
        sort: (row) => row.savedTokens * BYTES_PER_TOKEN,
        render: (row) => <span className="mono text-xs tabular-nums">{formatBytes(row.savedTokens * BYTES_PER_TOKEN)}</span>,
      },
      {
        key: "hits",
        header: "Hits",
        align: "right",
        sort: (row) => row.hits,
        render: (row) => <span className="mono text-xs tabular-nums">{fmt(row.hits)}</span>,
      },
      {
        key: "reduction",
        header: "Reduction",
        align: "right",
        sort: (row) => row.reductionPercent ?? -1,
        render: (row) => (
          <span className="mono text-xs tabular-nums">{row.reductionPercent !== null ? pct(row.reductionPercent) : "–"}</span>
        ),
      },
    ],
    [],
  );

  const empty = overall.hits === 0 && timeSeries.length === 0;

  return (
    <Page>
      <PageHeader title="Gain" description={`Tokens snapcompact kept out of context in ${rangeLabel}.`} />
      <QueryView
        empty={empty}
        emptyTitle={`No savings recorded in ${rangeLabel}`}
        emptyDesc={omp.range === "all" ? "Savings appear here once snapcompact compacts tool output." : "Try a longer range."}
      >
        <StatGrid cols={5}>
          <Stat
            label="Saved tokens"
            value={fmtShort(overall.savedTokens)}
            hint={fmt(overall.savedTokens)}
            spark={chart.map((point) => point.daily)}
          />
          <Stat label="Saved bytes" value={formatBytes(overall.savedTokens * BYTES_PER_TOKEN)} />
          <Stat
            label="Reduction"
            title="Saved bytes ÷ original bytes, when the original size is known"
            value={overall.reductionPercent !== null ? pct(overall.reductionPercent) : "–"}
            hint={overall.reductionPercent === null ? "original size not recorded" : undefined}
          />
          <Stat label="Hits" value={fmt(overall.hits)} />
          <Stat
            label="Saved per hit"
            value={overall.hits > 0 ? fmtShort(overall.savedTokens / overall.hits) : "–"}
            hint="tokens"
          />
        </StatGrid>

        <Card
          index={1}
          title="Savings over time"
          description="Tokens saved per UTC day, with the running total"
          actions={<Legend items={legendItems} active={visibleKeys} onToggle={toggleSeries} />}
        >
          <div className="flex flex-col gap-3">
            {!hidden.has("daily") && (
              <Chart
                data={chart}
                series={[legendItems[0]]}
                xKey="i"
                tick={tick}
                label={tick}
                valueFmt={fmtShort}
                summary="Bars show the tokens snapcompact saved on each UTC day."
                ariaLabel="Tokens saved per day"
              />
            )}
            {!hidden.has("cumulative") && (
              <TimeChart
                data={chart}
                series={[legendItems[1]]}
                xKey="i"
                tick={tick}
                label={tick}
                valueFmt={fmtShort}
                summary="A line rises with the total tokens snapcompact saved over the window."
                ariaLabel="Cumulative tokens saved"
              />
            )}
          </div>
        </Card>

        <Card index={2} title="By source" description="Savings per subsystem" flush>
          <DataTable
            columns={columns}
            rows={sourceRows}
            rowKey={(row) => row.source}
            ariaLabel="Savings by source"
            empty={<EmptyState icon="circle-slash" title="No savings by source" desc="Savings appear here once snapcompact compacts tool output." />}
          />
        </Card>
      </QueryView>
    </Page>
  );
}
