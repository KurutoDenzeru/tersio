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
 */
export function Card({
  title,
  description,
  actions,
  flush,
  children,
  className,
  id,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
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
        className,
      )}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b border-line px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          <h2 className="font-display truncate text-sm font-bold tracking-tight">{title}</h2>
          {description && <p className="mono mt-0.5 text-[11px] leading-relaxed text-dim">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      <CardContent className={cn("min-w-0 py-3.5", flush ? "px-0 py-0" : "px-3.5")}>{children}</CardContent>
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
  /** Leading glyph, matching the token strip on the usage page. */
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
  cols?: 2 | 3 | 4 | 5 | 6;
  children: React.ReactNode;
  className?: string;
}) {
  const sizes: Record<number, string> = {
    2: "grid-cols-2",
    3: "grid-cols-2 sm:grid-cols-3",
    4: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
    5: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5",
    6: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6",
  };
  // One solid band with a rule between cells, the strip the usage page uses: no translucent
  // tiles, and one path, so a strip never falls back to loose tiles.
  const cells = (Array.isArray(children) ? children : [children]).filter((c): c is ReactNode => Boolean(c));
  return (
    <div
      data-reveal
      className={cn(
        "translate-y-[18px] grid overflow-hidden rounded-xl border border-line bg-panel opacity-0 transition-[opacity,transform] duration-500 ease-[cubic-bezier(.16,1,.3,1)] data-[reveal=in]:translate-y-0 data-[reveal=in]:opacity-100",
        sizes[cols],
        "[&>*+*]:border-line [&>*+*]:border-t",
        cols > 2 && "sm:[&>*+*]:border-t-0 sm:[&>*+*]:border-l",
        className,
      )}
    >
      {cells.map((cell, i) => (
        <div key={i} className={cn("min-w-0", i > 0 && "border-line")}>
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
