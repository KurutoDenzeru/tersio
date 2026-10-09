// The one table for every page: column defs, sorting, row selection, and a scroll body.
import { useMemo, useState } from "react";
import { cn } from "cn";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { HoverTip } from "@/components/common";
import { Icon } from "@/components/icon";

export interface Column<T> {
  key: string;
  /** Column label. */
  header: string;
  /** Hover tip explaining the number. */
  title?: string;
  align?: "left" | "right";
  /** Fixed width in px. */
  width?: number;
  /** Sort value. A column without one is not sortable. */
  sort?: (row: T) => number | string;
  render: (row: T) => React.ReactNode;
}

export interface DataTableProps<T> {
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Sort on mount. */
  initialSort?: { key: string; dir: "asc" | "desc" };
  /** Render only the first N rows, the way the reference caps a long table. */
  limit?: number;
  empty?: React.ReactNode;
  /** Rows already on screen when the table is inside a card that clips. */
  maxHeight?: number;
  className?: string;
  ariaLabel?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  initialSort,
  limit,
  empty,
  maxHeight,
  className,
  ariaLabel,
}: DataTableProps<T>) {
  const [sort, setSort] = useState(initialSort ?? null);

  const ordered = useMemo(() => {
    const column = sort ? columns.find((c) => c.key === sort.key) : undefined;
    const compare = column?.sort;
    const all = compare
      ? [...rows].toSorted((a, b) => {
          const av = compare(a);
          const bv = compare(b);
          const diff = typeof av === "string" || typeof bv === "string" ? String(av).localeCompare(String(bv)) : av - bv;
          return sort!.dir === "desc" ? -diff : diff;
        })
      : rows;
    return limit && limit > 0 ? all.slice(0, limit) : all;
  }, [rows, columns, sort, limit]);

  const toggle = (column: Column<T>): void => {
    if (!column.sort) return;
    setSort((held) => (held?.key === column.key ? { key: column.key, dir: held.dir === "desc" ? "asc" : "desc" } : { key: column.key, dir: "desc" }));
  };

  if (rows.length === 0 && empty) return <>{empty}</>;

  return (
    <div
      className={cn("overflow-auto overscroll-contain [scrollbar-color:var(--line)_transparent] [scrollbar-width:thin]", className)}
      style={maxHeight ? { maxHeight } : undefined}
    >
      <Table className="mono text-[13px]" aria-label={ariaLabel}>
        <TableHeader className="sticky top-0 z-10 bg-panel [&_tr]:border-line [&_tr]:text-left [&_tr]:text-[11px] [&_tr]:uppercase [&_tr]:tracking-[0.14em] [&_tr]:text-dim">
          <TableRow>
            {columns.map((column) => {
              const active = sort?.key === column.key;
              const head = (
                <span className={cn("inline-flex items-center gap-1", column.align === "right" && "w-full justify-end")}>
                  {column.header}
                  {column.sort && (
                    <Icon
                      name={active ? (sort?.dir === "asc" ? "chevron-up" : "chevron-down") : "chevrons-up-down"}
                      className={cn("size-3", active ? "text-accent" : "opacity-40")}
                    />
                  )}
                </span>
              );
              return (
                <TableHead
                  key={column.key}
                  scope="col"
                  style={column.width ? { width: column.width } : undefined}
                  aria-sort={active ? (sort?.dir === "asc" ? "ascending" : "descending") : "none"}
                  className={cn("relative h-9 px-3", column.align === "right" && "text-right")}
                >
                  {column.title ? <HoverTip content={column.title}>{head}</HoverTip> : head}
                  {column.sort && (
                    <button
                      type="button"
                      onClick={() => toggle(column)}
                      className="absolute inset-0 cursor-pointer"
                      aria-label={`Sort by ${column.header}`}
                    />
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {ordered.map((row) => (
            <TableRow
              key={rowKey(row)}
              className={cn("border-line", onRowClick && "cursor-pointer hover:bg-track")}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((column) => (
                <TableCell
                  key={column.key}
                  className={cn("px-3 py-2 align-middle", column.align === "right" && "text-right tabular-nums")}
                >
                  {column.render(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function TableSkeleton({ rows = 8, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2 p-3.5", className)} aria-busy="true" aria-label="Loading table">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-6 w-full bg-track/60" />
      ))}
    </div>
  );
}
