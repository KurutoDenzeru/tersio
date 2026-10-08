// Shared time-series chart. Wraps the project's recharts setup so every page shows one shape.
import { useId } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { EmptyState, Note } from "./composites";

export interface TrendPoint {
  day: string;
  value: number;
}

/** Series colours in stack order, so a page's own bars match the chart's bands. */
export function seriesColor(index: number, isOther = false): string {
  return isOther ? "var(--dim)" : `var(--series-${(index % 8) + 1})`;
}

const trendConfig = {
  value: { label: "Value", color: "var(--accent)" },
} satisfies ChartConfig;

export function dayLabel(day: string): string {
  // A short range's buckets carry a time (`YYYY-MM-DDTHH:MM`), so the label keeps it rather than
  // collapsing every bucket of one day onto the same tick.
  const [date, time] = day.split("T");
  const label = new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return time ? `${label} ${time}` : label;
}

export function TrendChart({
  points,
  format,
  emptyTitle = "No activity in this range",
  emptyBody = "Pick a wider range, or run an agent session to record some usage.",
}: {
  points: TrendPoint[];
  format: (value: number) => string;
  emptyTitle?: string;
  emptyBody?: string;
}) {
  // Several charts can share one page, and a duplicated gradient id paints the wrong fill.
  const gradientId = `trend-${useId().replace(/:/g, "")}`;

  if (points.length < 2) {
    return <EmptyState title={emptyTitle} body={emptyBody} />;
  }

  return (
    <ChartContainer config={trendConfig} className="h-56 w-full">
      <AreaChart data={points} margin={{ top: 8, right: 6, bottom: 0, left: 6 }} accessibilityLayer>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-value)" stopOpacity={0.4} />
            <stop offset="95%" stopColor="var(--color-value)" stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 4" />
        <XAxis
          dataKey="day"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          tickFormatter={dayLabel}
        />
        <YAxis hide />
        <ChartTooltip
          cursor={{ stroke: "var(--line)" }}
          content={
            <ChartTooltipContent
              labelFormatter={(value) => dayLabel(String(value))}
              formatter={(value) => (
                <>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-[2px] bg-accent" />
                  <span className="ml-auto font-mono font-medium tabular-nums">{format(Number(value))}</span>
                </>
              )}
            />
          }
        />
        <Area
          dataKey="value"
          type="monotone"
          stroke="var(--color-value)"
          strokeWidth={1.5}
          fill={`url(#${gradientId}`}
          // Only the first paint animates: re-running the draw on every range or mode change is what
          // made clicking a chart tab feel like a freeze.
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}

/** Says plainly when a series covers only part of the selected range. */
export function SeriesNote({ days, range }: { days: number; range: string }) {
  if (days > 0) return null;
  return <Note tone="warn">{`No daily records fall inside ${range}. The aggregates below still cover all time.`}</Note>;
}

export interface StackedSeries {
  /** Legend and tooltip text. */
  label: string;
  /** One value per bucket, aligned with the `buckets` array. */
  values: number[];
  /** The remainder bucket, drawn in a neutral so it does not read as one more series. */
  isOther?: boolean;
}

/**
 * A stacked area over bucket keys: one band per series in `--series-N` order, the remainder last in
 * the muted tone. The chart's own config keys are positional, because a label with spaces and dots
 * cannot become a CSS custom property.
 */
export function StackedTrendChart({
  buckets,
  series,
  format,
  emptyTitle = "No activity in this range",
  emptyBody = "Pick a wider range, or run an agent session to record some usage.",
}: {
  buckets: string[];
  series: StackedSeries[];
  format: (value: number) => string;
  emptyTitle?: string;
  emptyBody?: string;
}) {
  if (buckets.length < 2 || series.length === 0) {
    return <EmptyState title={emptyTitle} body={emptyBody} />;
  }

  const config: ChartConfig = Object.fromEntries(
    series.map((entry, i) => [`s${i}`, { label: entry.label, color: seriesColor(i, entry.isOther) }]),
  );
  const data = buckets.map((bucket, index) => {
    const row: Record<string, number | string> = { bucket };
    series.forEach((entry, i) => {
      row[`s${i}`] = entry.values[index] ?? 0;
    });
    return row;
  });

  return (
    <ChartContainer config={config} className="h-[280px] w-full">
      <AreaChart data={data} margin={{ top: 8, right: 6, bottom: 0, left: 6 }} accessibilityLayer>
        <CartesianGrid vertical={false} strokeDasharray="3 4" />
        <XAxis
          dataKey="bucket"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          tickFormatter={dayLabel}
        />
        <YAxis tickLine={false} axisLine={false} width={52} tickFormatter={(value) => format(Number(value))} />
        <ChartTooltip
          cursor={{ stroke: "var(--line)" }}
          content={
            <ChartTooltipContent
              labelFormatter={(value) => dayLabel(String(value))}
              formatter={(value, name) => (
                <>
                  <span className="max-w-[160px] truncate text-muted-foreground">{String(name)}</span>
                  <span className="ml-auto font-mono font-medium tabular-nums">{format(Number(value))}</span>
                </>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent nameKey="dataKey" className="flex-wrap" />} />
        {series.map((entry, i) => (
          <Area
            key={entry.label}
            dataKey={`s${i}`}
            name={entry.label}
            stackId="burn"
            type="monotone"
            stroke={`var(--color-s${i})`}
            strokeWidth={1}
            fill={`var(--color-s${i})`}
            fillOpacity={0.45}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ChartContainer>
  );
}
