// Shared dashboard primitives: empty states, pager, segmented tabs,
// hover cards. Same behavior as dashboard/charts.js paintPager +
// emptyState + showTip/moveTip/hideTip.
import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Icon } from "./icon";

export function EmptyState({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={icon} className="size-5" />
      </span>
      <p className="empty-title">{title}</p>
      <p className="empty-desc">{desc}</p>
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
  return (
    <span className="ml-auto flex items-center gap-1" role="navigation" aria-label={label}>
      <button
        type="button"
        className="pgbtn mono"
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
            className={`pgbtn mono${p === page ? " on" : ""}`}
            onClick={() => onPick(p)}
          >
            {p}
          </button>
        ),
      )}
      <button
        type="button"
        className="pgbtn mono"
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
      <SelectTrigger className="seg mono text-xs h-auto gap-1 p-1" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((n) => (
          <SelectItem key={n} value={String(n)}>
            {n} / page
          </SelectItem>
        ))}
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
      className="seg mono text-xs ml-auto p-1 rounded-[10px]"
      style={{ border: "1px solid var(--line)", background: "var(--panel)" }}
      aria-label={label}
    >
      {options.map((o) => (
        <ToggleGroupItem key={o} value={o} className="px-3 py-1.5" aria-label={o}>
          {o}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

// Hover card. Port of showTip/moveTip/hideTip in dashboard/core.js: a
// fixed card that follows the cursor, flipping inside the viewport.
// Handlers attach directly to the child (no wrapper node), so table rows
// and cards keep their exact DOM shape.
export function HoverTip({ content, children }: { content: React.ReactNode; children: React.ReactElement } ) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const move = (clientX: number, clientY: number): void => {
    const w = 300;
    const lx = clientX + 16 > window.innerWidth - w ? clientX - w - 12 : clientX + 16;
    const ly = clientY + 16 > window.innerHeight - 240 ? clientY - 232 : clientY + 16;
    setPos({ x: Math.max(8, lx), y: Math.max(8, ly) });
  };
  const child = children as React.ReactElement<{
    onMouseEnter?: (e: React.MouseEvent) => void;
    onMouseMove?: (e: React.MouseEvent) => void;
    onMouseLeave?: (e: React.MouseEvent) => void;
  }>;
  const el = React.cloneElement(child, {
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
      setPos(null);
    },
  });
  return (
    <>
      {el}
      {pos &&
        createPortal(
          <div id="tip" className="mono show" role="tooltip" style={{ left: pos.x, top: pos.y }}>
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
