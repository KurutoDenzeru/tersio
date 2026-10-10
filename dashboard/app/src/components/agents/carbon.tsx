// Carbon page: what the usage in range would emit. Every figure comes from the same EcoLogits
// port the same dashboard used to run in its usage dialog. Only output tokens carry
// a footprint; a cached range reads small, and no figure here is metered.
import { useMemo } from "react";
import { BarList, Card, CellBar, Page, PageHeader, PagedTable, Stat, StatGrid } from "@/components/charts";
import type { Column } from "@/components/charts";
import { VendorMark } from "@/components/brand";
import { Icon } from "@/components/icon";
import { carbonReportForAgents, fmtCo2, fmtEnergy, type CarbonRow } from "@/lib/carbon";
import { AGENT_RANGE_LABEL, type AgentStats } from "@/lib/data";
import { co2Zone, fmt, fmtShort, pct, providerColor } from "@/lib/format";

/** The bar list and the table read the ranked rows; past this count the rest fold into one line. */
const LIST_LIMIT = 8;

/** Grams of CO2 per 1k output tokens: the number that compares two models directly. */
function perKilo(gco2: number, output: number): number {
  return output > 0 ? (gco2 / output) * 1000 : 0;
}

function perKiloText(gco2: number, output: number): string {
  if (output <= 0) return "–";
  const v = perKilo(gco2, output);
  return v < 1 ? `${v.toFixed(2)} g` : `${v.toFixed(1)} g`;
}

const TONE: Record<string, "good" | "warn" | "bad"> = { good: "good", warn: "warn", bad: "bad" };

/** The Carbon page: what the usage in range would emit, in the same shape as the Costs page. */
export function CarbonPage({ agent }: { agent: AgentStats }) {
  const r = useMemo(() => carbonReportForAgents(agent), [agent]);
  const zone = co2Zone(r.totalG);
  const intensity = perKilo(r.totalG, r.outputTokens);
  const top = r.all[0];
  const range = AGENT_RANGE_LABEL[agent.range];

  const shown = r.all.slice(0, LIST_LIMIT);
  const hidden = r.all.slice(LIST_LIMIT);
  const hiddenG = hidden.reduce((sum, row) => sum + row.gco2, 0);

  const barRows = useMemo(
    () =>
      shown.map((row) => ({
        key: row.model,
        label: row.label,
        value: row.gco2,
        color: providerColor(row.provider),
        mark: <VendorMark model={row.model} row />,
      })),
    [shown],
  );

  const columns = useMemo<Array<Column<CarbonRow>>>(() => {
    return [
      {
        key: "model",
        header: "Model",
        sort: (row) => row.label,
        render: (row) => (
          <span className="flex min-w-0 items-center gap-2.5">
            <VendorMark model={row.model} row />
            <span className="grid min-w-0 leading-tight">
              <span className="mono truncate font-bold" title={`${row.model} (${row.provider})`}>{row.label}</span>
              <span className="mono truncate text-[10px] text-dim">{row.provider || "unknown provider"}</span>
            </span>
          </span>
        ),
      },
      {
        key: "output",
        header: "Output tokens",
        title: "Only output tokens carry a footprint",
        align: "right",
        sort: (row) => row.output,
        render: (row) => (
          <span className="tabular-nums" title={fmt(row.output)}>
            {fmtShort(row.output)}
          </span>
        ),
      },
      {
        key: "co2",
        header: "CO2",
        title: "Amortized over the serving concurrency",
        align: "right",
        sort: (row) => row.gco2,
        render: (row) => (
          <span className="flex flex-col items-end gap-1">
            <span className="tabular-nums">~{fmtCo2(row.gco2)}</span>
            <CellBar value={row.gco2} max={r.totalG} color={providerColor(row.provider)} />
          </span>
        ),
      },
      {
        key: "energy",
        header: "Energy",
        title: "Electricity the estimate attributes to this model",
        align: "right",
        sort: (row) => row.energyWh,
        render: (row) => <span className="tabular-nums">~{fmtEnergy(row.energyWh)}</span>,
      },
      {
        key: "share",
        header: "Share",
        align: "right",
        sort: (row) => row.share,
        render: (row) => <span className="tabular-nums">{pct(row.share)}</span>,
      },
      {
        key: "perKilo",
        header: "Per 1k out",
        title: "Grams of CO2 per 1k output tokens, so models compare directly",
        align: "right",
        sort: (row) => perKilo(row.gco2, row.output),
        render: (row) => <span className="tabular-nums">{perKiloText(row.gco2, row.output)}</span>,
      },
    ];
  }, [r.totalG]);

  return (
    <Page>
      <PageHeader
        title="Carbon"
        description={`What ${range} would emit, from the EcoLogits ${r.ecologits} port. Every figure is an estimate over ${r.servingConcurrency} concurrent requests at the provider's grid mix, never a metered reading.`}
      />

      <StatGrid cols={4}>
        <Stat
          label="Estimated CO2"
          title="Output tokens priced against the EcoLogits model port, amortized over serving concurrency"
          value={
            <span className="flex items-center gap-2">
              ~{fmtCo2(r.totalG)}
              <Icon name={zone[0]} className={`size-3.5 shrink-0 ${zone[2] === "good" ? "text-accent" : zone[2] === "bad" ? "text-danger" : "text-[var(--warn-border)]"}`} />
            </span>
          }
          tone={TONE[zone[2]]}
          hint={r.totalG > 0 ? zone[1] : "no output tokens yet"}
        />
        <Stat
          label="Energy"
          title="Electricity the estimate attributes to this range"
          value={`~${fmtEnergy(r.energyWh)}`}
          hint={`${fmt(r.outputTokens)} output tokens`}
        />
        <Stat
          label="Per 1k output tokens"
          title="Total CO2 divided by output tokens, so models and ranges compare directly"
          value={r.outputTokens > 0 ? `${intensity < 1 ? intensity.toFixed(2) : intensity.toFixed(1)} g` : "–"}
          hint="grams of CO2"
        />
        <Stat
          label="Top model"
          title={top ? `${top.model} (${top.provider})` : undefined}
          value={top ? top.label : "–"}
          hint={top ? `${pct(top.share)} of the estimate` : "nothing emitting yet"}
        />
      </StatGrid>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <Card
        title="Where the carbon sits" icon="leaf"
        description={`Per model, top ${LIST_LIMIT} of ${fmt(r.all.length)}. Intensity folds the model's parameters, the provider grid mix, and serving concurrency into one figure.`}
      >
        {barRows.length === 0 ? (
          <p className="text-xs text-dim">
            Only output tokens carry a footprint, and this range wrote none. Sessions that answer without output
            contribute nothing here.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <BarList rows={barRows} money={fmtCo2} limit={LIST_LIMIT} />
            <div className="flex items-center justify-between border-t border-line pt-2 text-xs">
              <span className="text-dim">Total</span>
              <span className="mono tabular-nums">~{fmtCo2(r.totalG)}</span>
            </div>
            {hidden.length > 0 && (
              <p className="mono text-[11px] text-dim">
                {fmt(hidden.length)} more model{hidden.length === 1 ? "" : "s"} hold the remaining ~{fmtCo2(hiddenG)}.
              </p>
            )}
          </div>
        )}
      </Card>

      <Card
        title="What that equals" icon="scale"
        description="Published averages, each with the rate used, so the arithmetic can be redone. None of them describes your own life."
      >
        {r.comparisons.length === 0 ? (
          <p className="text-xs text-dim">Nothing to compare yet.</p>
        ) : (
          /* One row per comparison, on the same 1.5rem row rhythm as the bar list beside it: the
             glyph and label sit left, the figure right, and the rate under the figure. A card
             inside a card would break that rhythm, so the tile is just hairlines. */
          <ul className="m-0 flex list-none flex-col p-0">
            {r.comparisons.map((c) => (
              <li key={c.label} className="flex items-baseline gap-3 border-b border-line py-2.5 last:border-b-0">
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <Icon name={c.icon} className="size-3.5 shrink-0 text-dim" />
                  <span className="truncate text-xs">{c.label}</span>
                </span>
                <span className="text-right">
                  <span className="mono block text-lg font-bold leading-none tracking-tight tabular-nums">{c.value}</span>
                  <span className="mono block text-[11px] leading-tight text-dim">{c.factor}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      </div>

      <Card
        title="By model" icon="table"
        description="Every model with a footprint in range, with the parameter provenance beside it. Borrowed and default counts widen the error bars." flush
      >
        <PagedTable
          columns={columns}
          rows={r.all}
          rowKey={(row) => row.model}
          initialSort={{ key: "co2", dir: "desc" }}
          perPage={20}
          empty={<p className="p-4 text-xs text-dim">No model wrote output tokens in this range.</p>}
          ariaLabel="Estimated CO2 by model"
        />
      </Card>
    </Page>
  );
}
