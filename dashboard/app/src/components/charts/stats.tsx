// The page kit: header, card chrome, the stat band, meters. One look for every page.
import { cn } from "cn";
import type { ReactNode } from "react";
import { Card as CardShell, CardContent } from "@/components/ui/card";
import { Progress, ProgressIndicator, ProgressTrack } from "@/components/ui/progress";
import { HoverTip } from "@/components/common";
import { Sparkline } from "./series";
import { Icon } from "@/components/icon";

/** The page title block. Every routed page opens with one. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-2xl leading-tight tracking-tight">{title}</h1>
        <p className="mono mt-1 max-w-[70ch] text-xs leading-relaxed text-dim">{description}</p>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * A page block. `flush` drops the body padding so a table can span the card.
 * `footer` sits under the body as one strip, so a row stretched by a sibling pins it down.
 */
export function Card({
  title,
  icon,
  description,
  actions,
  footer,
  flush,
  children,
  className,
  id,
}: {
  title: string;
  /** Lucide glyph beside the title, from the same set the drawer sections use. */
  icon?: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  flush?: boolean;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <CardShell
      id={id}
      data-reveal
      className={cn(
        "translate-y-[18px] gap-0 overflow-hidden border-line bg-panel opacity-0 transition-[opacity,transform] duration-500 ease-[cubic-bezier(.16,1,.3,1)] data-[reveal=in]:translate-y-0 data-[reveal=in]:opacity-100 dark:[color-scheme:dark]",
        // The shell never pads: the header owns its top and the body owns its bottom, so a
        // flush table reaches the card edge and a normal card keeps one rhythm.
        "py-0",
        className,
      )}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b border-line px-3.5 pt-3 pb-2">
        <div className="min-w-0 flex-1">
          <h2 className="font-display flex items-center gap-2 truncate text-sm leading-tight font-bold tracking-tight">
            {icon && <Icon name={icon} className="size-3.5 shrink-0 text-dim" />}
            <span className="truncate">{title}</span>
          </h2>
          {description && <p className="mono mt-px text-[11px] leading-snug text-dim">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      <CardContent className={cn("min-w-0", flush ? "px-0 py-0" : "px-3.5 pt-2.5 pb-2")}>{children}</CardContent>
      {footer && (
        <div
          data-slot="card-footer"
          className="mt-auto flex items-center gap-2 border-t border-line px-3.5 pt-2 pb-2 text-xs"
        >
          {footer}
        </div>
      )}
    </CardShell>
  );
}

/** One labelled figure. `spark` draws its recent shape, `hint` explains it. */
export function Stat({
  label,
  title,
  value,
  hint,
  spark,
  tone,
  size = "md",
  className,
  icon,
}: {
  label: string;
  title?: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  spark?: number[];
  tone?: "good" | "warn" | "bad";
  size?: "md" | "sm";
  className?: string;
  /** Leading glyph, matching the token strip on the ledger cards. */
  icon?: string;
}) {
  const body = (
    <div className={cn("min-w-0 px-4 py-3", size === "sm" && "py-2.5", className)}>
      <p className="mono flex min-w-0 items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-dim">
        {icon && <Icon name={icon} className="size-3.5 shrink-0" />}
        <span className="truncate">{label}</span>
      </p>
      <p
        className={cn(
          "mono truncate font-bold tabular-nums",
          size === "sm" ? "mt-0.5 text-sm" : "mt-1 text-lg",
          tone === "bad" && "text-danger",
          tone === "warn" && "text-[var(--warn-border)]",
          tone === "good" && "text-accent",
        )}
      >
        {value}
      </p>
      {spark && spark.length > 1 && (
        <div className="mt-1.5 opacity-70">
          <Sparkline values={spark} />
        </div>
      )}
      {hint && <p className="mono mt-1 truncate text-[11px] text-dim">{hint}</p>}
    </div>
  );
  return title ? <HoverTip content={title}>{body}</HoverTip> : body;
}

export function StatGrid({
  cols = 4,
  children,
  className,
}: {
  cols?: 2 | 3 | 4 | 5 | 6 | 7;
  children: React.ReactNode;
  className?: string;
}) {
  const sizes: Record<number, string> = {
    2: "grid-cols-2",
    3: "grid-cols-2 sm:grid-cols-3",
    4: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
    5: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5",
    6: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6",
    7: "grid-cols-2 sm:grid-cols-4 lg:grid-cols-7",
  };
  // One solid band with a rule between cells, the same strip shape everywhere: no translucent
  // tiles, and one path, so a strip never falls back to loose tiles.
  const cells = (Array.isArray(children) ? children : [children]).filter((c): c is ReactNode => Boolean(c));
  // A cell takes a rule on its left unless it opens a row, and a rule above it unless it sits in
  // the first row, so the rule count follows the columns the tier draws: two below `sm`, three
  // (four for the seven-wide strip) from `sm`, and `cols` from `lg`. Each tier carries a `max-`
  // partner so exactly one tier claims a cell at any width; two tiers sharing a width disagree on
  // which cells open a row, and the later rule wins.
  //
  // The classes are written out per column count rather than built from `cols`, because Tailwind
  // reads class names out of the source at build time. A name assembled at runtime never reaches
  // its scanner, so the whole tier emits no CSS and the band draws no rules at that width — which
  // is how the seven-wide strip lost its dividers at a desktop width.
  const RULES: Record<number, string> = {
    // A strip that stays two per row at every width needs no breakpoint.
    2: "[&>*:not(:nth-child(2n+1))]:border-l [&>*:nth-child(n+3)]:border-t",
    3: "max-sm:[&>*:not(:nth-child(2n+1))]:border-l max-sm:[&>*:nth-child(n+3)]:border-t"
      + " sm:max-lg:[&>*:not(:nth-child(3n+1))]:border-l sm:max-lg:[&>*:nth-child(n+4)]:border-t"
      + " lg:[&>*:not(:nth-child(3n+1))]:border-l lg:[&>*:nth-child(n+4)]:border-t",
    4: "max-sm:[&>*:not(:nth-child(2n+1))]:border-l max-sm:[&>*:nth-child(n+3)]:border-t"
      + " sm:max-lg:[&>*:not(:nth-child(3n+1))]:border-l sm:max-lg:[&>*:nth-child(n+4)]:border-t"
      + " lg:[&>*:not(:nth-child(4n+1))]:border-l lg:[&>*:nth-child(n+5)]:border-t",
    5: "max-sm:[&>*:not(:nth-child(2n+1))]:border-l max-sm:[&>*:nth-child(n+3)]:border-t"
      + " sm:max-lg:[&>*:not(:nth-child(3n+1))]:border-l sm:max-lg:[&>*:nth-child(n+4)]:border-t"
      + " lg:[&>*:not(:nth-child(5n+1))]:border-l lg:[&>*:nth-child(n+6)]:border-t",
    6: "max-sm:[&>*:not(:nth-child(2n+1))]:border-l max-sm:[&>*:nth-child(n+3)]:border-t"
      + " sm:max-lg:[&>*:not(:nth-child(3n+1))]:border-l sm:max-lg:[&>*:nth-child(n+4)]:border-t"
      + " lg:[&>*:not(:nth-child(6n+1))]:border-l lg:[&>*:nth-child(n+7)]:border-t",
    // The seven-wide strip holds four per row from `sm`, not three.
    7: "max-sm:[&>*:not(:nth-child(2n+1))]:border-l max-sm:[&>*:nth-child(n+3)]:border-t"
      + " sm:max-lg:[&>*:not(:nth-child(4n+1))]:border-l sm:max-lg:[&>*:nth-child(n+5)]:border-t"
      + " lg:[&>*:not(:nth-child(7n+1))]:border-l lg:[&>*:nth-child(n+8)]:border-t",
  };
  // The columns each tier draws, which is what a short final row counts its leftover slots from.
  const perRow = [2, cols === 7 ? 4 : 3, cols];
  // A row that fills leaves nothing to merge, so an even split spans one slot like any cell.
  const mergeSpan = (slots: number): number => (cells.length % slots === 0 ? 1 : slots - (cells.length % slots) + 1);
  return (
    <div
      data-reveal
      data-stat-band={cols}
      className={cn(
        "translate-y-[18px] grid overflow-hidden rounded-xl border border-line bg-panel opacity-0 transition-[opacity,transform] duration-500 ease-[cubic-bezier(.16,1,.3,1)] data-[reveal=in]:translate-y-0 data-[reveal=in]:opacity-100",
        sizes[cols],
        RULES[cols] ?? RULES[2],
        className,
      )}
      // The merge spans arrive as custom properties, one per tier, because a class name built
      // from a count is invisible to Tailwind's scanner while a property value is not.
      style={{
        "--stat-band-span-sm": mergeSpan(perRow[0]),
        "--stat-band-span-md": mergeSpan(perRow[1]),
        "--stat-band-span-lg": mergeSpan(perRow[2]),
      } as React.CSSProperties}
    >
      {cells.map((cell, i) => (
        <div
          key={i}
          className={cn(
            "min-w-0",
            i > 0 && "border-line",
          )}
        >
          {cell}
        </div>
      ))}
    </div>
  );
}

/** A share of a limit, with the exact figure beside it. */
export function MeterCell({
  value,
  max,
  color = "var(--accent)",
  label,
}: {
  value: number;
  max: number;
  color?: string;
  label: string;
}) {
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div className="flex min-w-[92px] items-center gap-2">
      <Progress value={pct * 100} className="w-full gap-0" aria-label={label}>
        <ProgressTrack className="h-1.5 bg-track">
          <ProgressIndicator style={{ background: color }} />
        </ProgressTrack>
      </Progress>
      <span className="mono shrink-0 text-[11px] tabular-nums text-dim">{(pct * 100).toFixed(0)}%</span>
    </div>
  );
}

/** The page shell: header, then blocks stacked with one gap rhythm. */
export function Page({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4 px-4 py-5 sm:px-6">{children}</div>;
}
