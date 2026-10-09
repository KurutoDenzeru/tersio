// Chart primitives: one palette, one tooltip, one empty look, so no page draws its own.
// Geometry is the only new code here: everything else wraps the installed shadcn chart pieces.
import { cn } from "cn";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { fmtShort } from "@/lib/format";

export interface SeriesSpec {
  key: string;
  label: string;
  color: string;
}

const AXIS = { stroke: "var(--line)", tickLine: false, axisLine: false } as const;
const TICK_STYLE = { fill: "var(--dim)", fontSize: 11 } as const;

export interface SeriesChartProps<T extends object> {
  data: T[];
  series: SeriesSpec[];
  xKey: string;
  tick?: (value: number) => string;
  /** Tooltip title for the hovered bucket. */
  label?: (value: number) => string;
  height?: number;
  mode?: "area" | "bar";
  stacked?: boolean;
  valueFmt?: (value: number) => string;
  /** Plain-text alternative: what the chart shows, read out to a screen reader. */
  summary: string;
  ariaLabel: string;
  className?: string;
}

function SeriesChart<T extends object>({
  data, series, xKey, tick, label, height = 220, mode = "area", stacked = false,
  valueFmt = fmtShort, summary, ariaLabel, className,
}: SeriesChartProps<T>) {
  const config: ChartConfig = Object.fromEntries(
    series.map((s) => [s.key, { label: s.label, color: s.color }]),
  );
  const common = {
    data,
    margin: { top: 8, right: 8, bottom: 0, left: 0 },
  };
  const children = (
    <>
      <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 3" />
      <XAxis dataKey={xKey} {...AXIS} tick={TICK_STYLE} tickFormatter={tick} minTickGap={28} />
      <YAxis {...AXIS} tick={TICK_STYLE} width={46} tickFormatter={valueFmt} />
      <ChartTooltip
        content={<ChartTooltipContent labelFormatter={(v) => (label ? label(Number(v)) : String(v))} />}
      />
      {series.map((s) =>
        mode === "bar" ? (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={`var(--color-${s.key})`}
            stackId={stacked ? "all" : undefined}
            radius={stacked ? 0 : [3, 3, 0, 0]}
            isAnimationActive={false}
          />
        ) : (
          <Area
            key={s.key}
            dataKey={s.key}
            name={s.label}
            type="monotone"
            stroke={`var(--color-${s.key})`}
            fill={`var(--color-${s.key})`}
            fillOpacity={stacked ? 0.35 : 0.14}
            strokeWidth={1.6}
            stackId={stacked ? "all" : undefined}
            isAnimationActive={false}
          />
        ),
      )}
    </>
  );
  return (
    <figure className={cn("min-w-0", className)}>
      <ChartContainer config={config} className="w-full" style={{ height }} role="img" aria-label={ariaLabel}>
        {mode === "bar" ? (
          <BarChart {...common}>{children}</BarChart>
        ) : (
          <AreaChart {...common}>{children}</AreaChart>
        )}
      </ChartContainer>
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  );
}

/** A time series: buckets on a UTC-aligned axis. */
export function TimeChart<T extends object>(props: SeriesChartProps<T> & { mode?: "area" | "bar" }) {
  return <SeriesChart {...props} mode={props.mode ?? "area"} />;
}

/** A categorical series, such as hour of day. */
export function Chart<T extends object>(props: SeriesChartProps<T> & { mode?: "area" | "bar" }) {
  return <SeriesChart {...props} mode={props.mode ?? "bar"} />;
}

/** One row's shape over time. Plain SVG: a table can hold hundreds of these. */
export function Sparkline({ values, color = "var(--accent)", className }: { values: number[]; color?: string; className?: string }) {
  const points = values.filter((v) => Number.isFinite(v));
  if (points.length < 2) return <span className={cn("mono text-xs text-dim", className)}>–</span>;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const path = points
    .map((v, i) => `${((i / (points.length - 1)) * 100).toFixed(1)},${(28 - ((v - min) / span) * 26).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={cn("h-7 w-full", className)} aria-hidden="true">
      <polyline points={path} fill="none" stroke={color} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Series toggles. A clicked key drops out of `active`. */
export function Legend({
  items,
  active,
  onToggle,
  className,
}: {
  items: SeriesSpec[];
  active?: Set<string>;
  onToggle?: (key: string) => void;
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5", className)}>
      {items.map((s) => {
        const on = !active || active.has(s.key);
        const label = (
          <>
            <span className="size-2 shrink-0 rounded-[2px]" style={{ background: on ? s.color : "var(--track)" }} />
            <span className={on ? "" : "line-through"}>{s.label}</span>
          </>
        );
        return (
          <li key={s.key} className="flex items-center gap-1.5 text-[11px] text-dim">
            {onToggle ? (
              <button
                type="button"
                onClick={() => onToggle(s.key)}
                aria-pressed={on}
                className="flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 hover:text-ink"
              >
                {label}
              </button>
            ) : (
              label
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A single horizontal bar for a list row: volume against the largest value. */
export function BarList({
  rows,
  money,
  className,
  limit = 0,
}: {
  rows: Array<{ key: string; label: string; value: number; color?: string; mark?: React.ReactNode }>;
  money: (v: number) => string;
  className?: string;
  limit?: number;
}) {
  const shown = limit > 0 ? rows.slice(0, limit) : rows;
  const max = Math.max(1, ...shown.map((r) => r.value));
  if (shown.length === 0) return null;
  return (
    <ul className={cn("flex flex-col gap-2", className)}>
      {shown.map((r) => (
        <li key={r.key} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
          <div className="flex min-w-0 items-center gap-2">
            {r.mark}
            <span className="mono truncate text-xs" title={r.label}>{r.label}</span>
          </div>
          <span className="mono shrink-0 text-xs tabular-nums text-dim">{money(r.value)}</span>
          <div className="col-span-2 h-1.5 w-full overflow-hidden rounded-full bg-track" aria-hidden="true">
            <div className="h-full rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: r.color ?? "var(--accent)" }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** A coloured cell for a one-value table row: the shape of a share, at a glance. */
export function CellBar({ value, max, color = "var(--accent)" }: { value: number; max: number; color?: string }) {
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-track" aria-hidden="true">
      <span className="block h-full rounded-full" style={{ width: `${max > 0 ? Math.min(100, (value / max) * 100) : 0}%`, background: color }} />
    </span>
  );
}
