// Shared dashboard primitives: empty states, pager, segmented tabs, and hover cards.
import React, { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "cn";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TooltipSurface } from "@/components/ui/tooltip-surface";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Icon } from "./icon";

export function EmptyState({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="flex flex-col items-center gap-[2px] rounded-xl border border-dashed border-line px-4 py-8 text-center">
      <span className="mb-2.5 grid size-10 place-items-center rounded-full bg-track text-dim">
        <Icon name={icon} className="size-5" />
      </span>
      <p className="m-0 text-sm font-semibold text-ink">{title}</p>
      <p className="m-0 max-w-[340px] text-xs text-dim">{desc}</p>
    </div>
  );
}

export function usePager(total: number, per: number, page: number): { pages: number; page: number; range: string } {
  return useMemo(() => {
    const pages = Math.max(1, Math.ceil(total / per));
    const p = Math.min(page, pages);
    const start = total ? (p - 1) * per + 1 : 0;
    return { pages, page: p, range: `Showing ${start}–${Math.min(total, p * per)} of ${total}` };
  }, [total, per, page]);
}

export function PageButtons({
  pages,
  page,
  onPick,
  label,
}: {
  pages: number;
  page: number;
  onPick: (p: number) => void;
  label: string;
}) {
  const nums = useMemo(() => {
    const out: Array<number | "…"> = [];
    for (let p = 1; p <= pages; p++) {
      if (p === 1 || p === pages || Math.abs(p - page) <= 1) out.push(p);
      else if (out[out.length - 1] !== "…") out.push("…");
    }
    return out;
  }, [pages, page]);
  const pgbtn =
    "inline-flex h-[26px] min-w-[26px] cursor-pointer items-center justify-center rounded-[7px] border border-line bg-transparent px-[7px] text-dim hover:not-disabled:border-accent hover:not-disabled:text-ink disabled:cursor-default disabled:opacity-35 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent";
  return (
    <span className="ml-auto flex items-center gap-1" role="navigation" aria-label={label}>
      <button
        type="button"
        className={cn(pgbtn, "mono")}
        aria-label="Previous page"
        disabled={page <= 1}
        onClick={() => onPick(page - 1)}
      >
        ‹
      </button>
      {nums.map((p, i) =>
        p === "…" ? (
          <span key={`e${i}`} style={{ padding: "0 2px" }}>
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            className={cn(pgbtn, "mono", p === page && "border-transparent bg-accent-soft font-bold text-accent")}
            onClick={() => onPick(p)}
          >
            {p}
          </button>
        ),
      )}
      <button
        type="button"
        className={cn(pgbtn, "mono")}
        aria-label="Next page"
        disabled={page >= pages}
        onClick={() => onPick(page + 1)}
      >
        ›
      </button>
    </span>
  );
}

export function PerPage({
  options,
  value,
  onPick,
  label,
}: {
  options: number[];
  value: number;
  onPick: (n: number) => void;
  label: string;
}) {
  return (
    <Select
      value={String(value)}
      onValueChange={(v) => {
        const n = Number(v);
        if (n !== value) onPick(n);
      }}
    >
      <SelectTrigger size="sm" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((n) => (
            <SelectItem key={n} value={String(n)}>
              {n} / page
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export function SegTabs<T extends string>({
  options,
  value,
  onPick,
  label,
}: {
  options: T[];
  value: T;
  onPick: (v: T) => void;
  label: string;
}) {
  return (
    <ToggleGroup
      value={[value]}
      onValueChange={(v) => {
        const next = v[v.length - 1] as T | undefined;
        if (next && next !== value) onPick(next);
      }}
      className="mono text-xs ml-auto p-1 rounded-[10px] border border-line bg-panel"
      aria-label={label}
    >
      {options.map((o) => (
        <ToggleGroupItem
          key={o}
          value={o}
          className="h-auto cursor-pointer rounded-lg text-dim transition-[background,color] duration-200 data-[state=on]:bg-accent-soft data-[state=on]:text-ink hover:text-ink px-3 py-1.5 text-xs"
          aria-label={o}
        >
          {o}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function HoverTip({ content, children }: { content: React.ReactNode; children: React.ReactElement }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [focused, setFocused] = useState(false);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ x: number; y: number } | null>(null);
  const id = `tooltip-${useId().replace(/:/g, "")}`;
  const measure = (x: number, y: number): { x: number; y: number } => {
    const gap = 12;
    const margin = 8;
    const width = surfaceRef.current?.offsetWidth || 0;
    const height = surfaceRef.current?.offsetHeight || 0;
    let left = x + gap;
    let top = y + gap;
    if (left + width > window.innerWidth - margin) left = x - width - gap;
    if (top + height > window.innerHeight - margin) top = y - height - gap;
    return {
      x: Math.max(margin, Math.min(left, Math.max(margin, window.innerWidth - width - margin))),
      y: Math.max(margin, Math.min(top, Math.max(margin, window.innerHeight - height - margin))),
    };
  };
  const move = (clientX: number, clientY: number): void => {
    anchor.current = { x: clientX, y: clientY };
    setPos(measure(clientX, clientY));
  };
  const focus = (event: React.FocusEvent): void => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setFocused(true);
    move(rect.right, rect.top);
  };
  const blur = (event: React.FocusEvent): void => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setFocused(false);
    if (!event.currentTarget.matches(":hover")) setPos(null);
  };
  useLayoutEffect(() => {
    if (!pos || !anchor.current || !surfaceRef.current) return;
    const next = measure(anchor.current.x, anchor.current.y);
    if (next.x !== pos.x || next.y !== pos.y) setPos(next);
  }, [pos, content]);

  const child = children as React.ReactElement<{
    "aria-describedby"?: string;
    onFocus?: (e: React.FocusEvent) => void;
    onBlur?: (e: React.FocusEvent) => void;
    onMouseEnter?: (e: React.MouseEvent) => void;
    onMouseMove?: (e: React.MouseEvent) => void;
    onMouseLeave?: (e: React.MouseEvent) => void;
  }>;
  const describedBy = [child.props["aria-describedby"], id].filter(Boolean).join(" ") || undefined;
  const el = React.cloneElement(child, {
    "aria-describedby": pos ? describedBy : child.props["aria-describedby"],
    onFocus: (e: React.FocusEvent) => {
      child.props.onFocus?.(e);
      focus(e);
    },
    onBlur: (e: React.FocusEvent) => {
      child.props.onBlur?.(e);
      blur(e);
    },
    onMouseEnter: (e: React.MouseEvent) => {
      child.props.onMouseEnter?.(e);
      move(e.clientX, e.clientY);
    },
    onMouseMove: (e: React.MouseEvent) => {
      child.props.onMouseMove?.(e);
      move(e.clientX, e.clientY);
    },
    onMouseLeave: (e: React.MouseEvent) => {
      child.props.onMouseLeave?.(e);
      if (!focused) {
        anchor.current = null;
        setPos(null);
      }
    },
  });
  return (
    <>
      {el}
      {pos &&
        createPortal(
          <TooltipSurface
            ref={surfaceRef}
            id={id}
            role="tooltip"
            className="pointer-events-none fixed z-100 max-w-[370px] text-foreground"
            style={{ left: pos.x, top: pos.y }}
          >
            {content}
          </TooltipSurface>,
          document.body,
        )}
    </>
  );
}
