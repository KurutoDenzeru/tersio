// Page primitives shared by every route. Density 8 per the plan: tight padding, 1px separators, and
// mono figures, so a data page reads as a table of numbers rather than a wall of cards.
import type { ReactNode } from "react";

import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/icon";

/**
 * One data panel. A shadcn Card, wearing Tersio's tokens rather than the palette defaults so the
 * panel sits on the page wash instead of introducing a second surface colour.
 */
export function Section({
  title,
  hint,
  actions,
  children,
}: {
  title: string;
  hint?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="gap-0 bg-panel py-0 ring-edge">
      <CardHeader className="border-b border-edge px-4 py-3 sm:px-5">
        <CardTitle className="text-[13px] font-semibold tracking-[-0.01em]">{title}</CardTitle>
        {hint && <CardDescription className="text-xs text-dim">{hint}</CardDescription>}
        {actions && <CardAction className="row-span-2 self-center">{actions}</CardAction>}
      </CardHeader>
      <CardContent className="grid gap-4 px-4 py-4 sm:px-5">{children}</CardContent>
    </Card>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">{children}</div>;
}

/**
 * A stat strip: one card, one cell per figure, divided by hairlines. This is the band the pages open
 * with, and it reads as one summary rather than four separate cards.
 */
export function StatStrip({ children }: { children: ReactNode }) {
  return (
    <Card className="gap-0 bg-panel py-0 ring-edge">
      <div className="grid grid-cols-1 gap-px bg-edge md:grid-cols-2 lg:grid-cols-4">
        {children}
      </div>
    </Card>
  );
}

/** One cell of a StatStrip. `spark` adds a small bar trend, as on a volume figure. */
export function StripStat({
  label,
  value,
  sub,
  spark,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  spark?: number[];
  /** Colours the figure only, so a failure count reads as one without shouting. */
  tone?: "default" | "accent" | "danger";
}) {
  const valueTone = tone === "accent" ? "text-accent" : tone === "danger" ? "text-danger" : "text-ink";
  return (
    <div className="grid min-w-0 content-start gap-1.5 bg-panel px-4 py-4 first:rounded-t-[inherit] last:rounded-b-[inherit]">
      <p className="m-0 text-[11px] text-dim">{label}</p>
      <p className={`m-0 truncate text-[26px] leading-tight font-bold tracking-[-0.02em] ${valueTone}`}>{value}</p>
      {sub && <p className="m-0 text-[11px] text-dim">{sub}</p>}
      {spark && spark.length > 1 && <MiniBars values={spark} className="mt-0.5 h-8 w-full" />}
    </div>
  );
}

/** One figure. No card: a hairline above is enough hierarchy, and cards here would be 12 boxes of noise. */
export function Stat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "accent" | "danger";
}) {
  const valueTone = tone === "accent" ? "text-accent" : tone === "danger" ? "text-danger" : "text-ink";
  return (
    <div className="grid min-w-0 gap-1 border-t border-line pt-2.5">
      <p className="m-0 text-[10px] tracking-[0.14em] text-dim uppercase">{label}</p>
      <p className={`mono m-0 truncate text-[19px] leading-tight font-bold ${valueTone}`}>{value}</p>
      {sub && <p className="m-0 text-[11px] text-dim">{sub}</p>}
    </div>
  );
}

export interface BarRow {
  label: string;
  value: number;
  display: string;
  sub?: string;
}

/** Ranked bars. Only the filled width carries colour, so one accent stays one accent. */
export function BarList({ rows, empty = "Nothing recorded yet." }: { rows: BarRow[]; empty?: string }) {
  if (!rows.length) return <EmptyState title="No data" body={empty} />;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="m-0 grid list-none gap-0 divide-y divide-line p-0">
      {rows.map((row) => (
        <li key={row.label} className="grid gap-1.5 py-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="mono min-w-0 truncate text-xs" title={row.label}>
              {row.label}
            </span>
            <span className="mono shrink-0 text-xs font-semibold">{row.display}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-track">
              <span className="block h-full rounded-full bg-accent" style={{ width: `${(row.value / max) * 100}%` }} />
            </span>
            {row.sub && <span className="mono shrink-0 text-[11px] text-dim">{row.sub}</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** A tiny CSS bar chart. Avoids a chart library for one shape. */
export function MiniBars({ values, className = "" }: { values: number[]; className?: string }) {
  const max = Math.max(...values, 1);
  return (
    <span className={`flex h-8 items-end gap-[2px] ${className}`} aria-hidden="true">
      {values.map((v, i) => (
        <span
          key={i}
          className="min-w-[2px] flex-1 rounded-[1px] bg-accent"
          style={{ height: `${Math.max(v ? 4 : 1, (v / max) * 100)}%`, opacity: v ? 0.85 : 0.25 }}
        />
      ))}
    </span>
  );
}

export function EmptyState({ title, body, icon }: { title: string; body: string; icon?: ReactNode }) {
  return (
    <div className="grid place-items-center gap-1.5 rounded-xl border border-dashed border-line px-4 py-8 text-center">
      {icon && <span className="mb-1 text-dim">{icon}</span>}
      <p className="m-0 text-[13px] font-semibold">{title}</p>
      <p className="m-0 max-w-[46ch] text-xs text-dim">{body}</p>
    </div>
  );
}

/** A caveat that changes how the numbers above should be read. Never decoration. */
export function Note({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "warn" }) {
  const cls = tone === "warn" ? "border-warn-border bg-warn-soft text-ink" : "border-line bg-panel text-dim";
  return <p className={`m-0 rounded-[10px] border px-3 py-2 text-[11px] leading-relaxed ${cls}`}>{children}</p>;
}

export function percent(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

/**
 * The one search field the table cards use. A single bordered box on the page wash, rather than a
 * bordered wrapper around an input that brings its own fill, which read as a box inside a box.
 */
export function TableFilter({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
}) {
  return (
    <label className="flex min-w-0 items-center gap-2 rounded-[10px] border border-edge bg-bg px-2.5 py-1.5 text-dim focus-within:border-accent sm:w-[240px]">
      <Icon name="search" className="size-3.5 shrink-0" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-dim [&::-webkit-search-cancel-button]:hidden"
      />
      {value !== "" && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear filter"
          className="grid size-4 shrink-0 place-items-center rounded text-dim hover:text-ink"
        >
          <Icon name="x" className="size-3" />
        </button>
      )}
    </label>
  );
}
