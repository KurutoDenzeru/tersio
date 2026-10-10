// The one table for every page: column defs, sorting, row selection, and a scroll body.
import { Fragment, useMemo, useState } from "react";
import { cn } from "cn";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { HoverTip, PageButtons, PerPage, usePager } from "@/components/common";
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
  /** Render rows from this index, one page's worth. */
  offset?: number;
  /** Rows rendered before the pager takes over. */
  limit?: number;
  /**
   * Detail for a row, drawn under it and spanning every column. Returning null draws
   * nothing, so one table can carry a detail for some rows only.
   */
  detail?: (row: T) => React.ReactNode | null;
  /** Which row currently shows its detail. Controls the row's open state for assistive tech. */
  detailOpenFor?: (row: T) => boolean;
  empty?: React.ReactNode;
  className?: string;
  ariaLabel?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  initialSort,
  offset = 0,
  limit,
  detail,
  detailOpenFor,
  empty,
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
    const capped = limit && limit > 0 ? all.slice(offset, offset + limit) : offset > 0 ? all.slice(offset) : all;
    return capped;
  }, [rows, columns, sort, offset, limit]);

  const toggle = (column: Column<T>): void => {
    if (!column.sort) return;
    setSort((held) => (held?.key === column.key ? { key: column.key, dir: held.dir === "desc" ? "asc" : "desc" } : { key: column.key, dir: "desc" }));
  };

  if (rows.length === 0 && empty) return <>{empty}</>;

  return (
    // A page table chains its wheel to the page. It is a page-level table, not a nested scroller in
    // a modal, so `overscroll-contain` must stay off it: contain swallows the wheel and the page
    // above a table that cannot scroll stops scrolling.
    <div className={cn("overflow-auto [scrollbar-color:var(--line)_transparent] [scrollbar-width:thin]", className)}>
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
          {ordered.map((row) => {
            const extra = detail ? detail(row) : null;
            const open = detailOpenFor ? detailOpenFor(row) : false;
            return (
              <Fragment key={rowKey(row)}>
                <TableRow
                  className={cn("border-line", (onRowClick || extra) && "cursor-pointer hover:bg-track")}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  aria-expanded={extra ? open : undefined}
                  data-detail={extra ? (open ? "open" : "closed") : undefined}
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
                {extra && open && (
                  <TableRow className="border-line hover:bg-transparent">
                    <TableCell colSpan={columns.length} className="px-0 py-0 align-top">
                      {extra}
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
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

/**
 * A long table, one page at a time. The page size lives here, so a caller drops its `limit`
 * and the footer carries the count instead of the table clipping.
 */
export function PagedTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  initialSort,
  perPage = 25,
  perPageOptions = [10, 25, 50, 100],
  detail,
  detailOpenFor,
  empty,
  className,
  ariaLabel,
}: Omit<DataTableProps<T>, "limit" | "offset"> & {
  /** Rows per page before the reader asks for more. */
  perPage?: number;
  perPageOptions?: number[];
}) {
  const [per, setPer] = useState(perPage);
  const [page, setPage] = useState(1);
  const { pages, page: current, range } = usePager(rows.length, per, page);
  const short = rows.length <= per;
  const footer = (
    <div className="mono flex items-center gap-3 border-t border-line px-3.5 py-1.5 text-[11px] text-dim">
      <span>{range}</span>
      <PerPage options={perPageOptions} value={per} onPick={(n) => { setPer(n); setPage(1); }} label="Rows per page" />
      <PageButtons pages={pages} page={current} onPick={setPage} label={ariaLabel ?? "Table pages"} />
    </div>
  );
  return (
    <div className="flex flex-col">
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={rowKey}
        onRowClick={onRowClick}
        initialSort={initialSort}
        offset={(current - 1) * per}
        limit={per}
        detail={detail}
        detailOpenFor={detailOpenFor}
        empty={empty}
        ariaLabel={ariaLabel}
        className={className}
      />
      {!short && footer}
    </div>
  );
}
