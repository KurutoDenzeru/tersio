// Request share: each model's share of requests per day, stacked to 100%, or the raw counts.
// Series are pre-grouped by the caller (top N plus an "Other" bucket), because a stacked bar with
// one colour per model is unreadable past about eight series and its legend stops fitting.
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartLegend, ChartLegendContent, type ChartConfig } from "@/components/ui/chart";
import { EmptyState } from "./composites";
import { dayLabel } from "./trend";

export interface ShareSeries {
  /** Legend and tooltip text. The caller may bake a share percentage into it. */
  label: string;
  /** One value per day, aligned with the `days` array. */
  values: number[];
  /** The remainder bucket, drawn in a neutral so it does not read as one more model. */
  isOther?: boolean;
}

export type ShareMode = "share" | "requests";

interface TooltipRow {
  dataKey?: string | number;
  name?: string | number;
  value?: string | number;
  color?: string;
}

function ShareTooltip({
  active,
  payload,
  label,
  mode,
}: {
  active?: boolean;
  payload?: TooltipRow[];
  label?: string | number;
  mode: ShareMode;
}) {
  if (!active || !payload || payload.length === 0) return null;
  // Biggest first, and a zero segment is noise rather than information.
  const rows = payload
    .filter((row) => Number(row.value) > 0)
    .sort((a, b) => Number(b.value) - Number(a.value));
  if (rows.length === 0) return null;
  return (
    <div className="rounded-lg border border-line bg-panel px-2.5 py-2 text-xs shadow-[0_8px_24px_rgba(0,0,0,.28)]">
      <p className="mono m-0 mb-1.5 text-[10px] tracking-[0.12em] text-dim uppercase">{dayLabel(String(label))}</p>
      <ul className="m-0 grid list-none gap-1 p-0">
        {rows.map((row) => (
          <li key={String(row.dataKey)} className="flex items-center gap-2">
            <span className="size-2 shrink-0 rounded-[2px]" style={{ background: row.color }} aria-hidden="true" />
            <span className="max-w-[200px] min-w-0 truncate">{String(row.name)}</span>
            <span className="mono ml-auto shrink-0 tabular-nums">
              {mode === "share" ? `${Number(row.value).toFixed(1)}%` : Number(row.value).toLocaleString("en-US")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ModelShareChart({
  days,
  series,
  mode,
}: {
  days: string[];
  series: ShareSeries[];
  mode: ShareMode;
}) {
  if (days.length === 0 || series.length === 0) {
    return (
      <EmptyState
        title="No model activity in this range"
        body="Nothing ran in the selected range, so there is no share to draw."
      />
    );
  }

  // Positional keys: a model label carries spaces and dots, which cannot become a CSS custom property.
  const config: ChartConfig = Object.fromEntries(
    series.map((entry, i) => [
      `s${i}`,
      { label: entry.label, color: entry.isOther ? "var(--dim)" : `var(--series-${(i % 8) + 1})` },
    ]),
  );

  const data = days.map((day, dayIndex) => {
    const sums = series.map((entry) => entry.values[dayIndex] ?? 0);
    const total = sums.reduce((a, b) => a + b, 0);
    const row: Record<string, number | string> = { day };
    series.forEach((_, i) => {
      row[`s${i}`] = mode === "share" ? (total > 0 ? (sums[i] / total) * 100 : 0) : sums[i];
    });
    return row;
  });

  return (
    <ChartContainer config={config} className="h-[300px] w-full">
      <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }} accessibilityLayer barCategoryGap="12%">
        <CartesianGrid vertical={false} strokeDasharray="3 4" />
        <XAxis
          dataKey="day"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          tickFormatter={dayLabel}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={44}
          tickFormatter={(value) => (mode === "share" ? `${Math.round(Number(value))}%` : Number(value).toLocaleString("en-US"))}
        />
        <Tooltip cursor={{ fill: "var(--track)" }} content={<ShareTooltip mode={mode} />} />
        <ChartLegend content={<ChartLegendContent nameKey="dataKey" className="flex-wrap" />} />
        {series.map((entry, i) => (
          <Bar
            key={entry.label}
            dataKey={`s${i}`}
            name={entry.label}
            stackId="share"
            fill={`var(--color-s${i})`}
            isAnimationActive={false}
            // A hairline in the panel colour keeps adjacent segments separable.
            stroke="var(--panel)"
            strokeWidth={0.5}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}
