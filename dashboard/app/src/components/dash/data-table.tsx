// shadcn/ui data table over TanStack Table: sortable headers, a text filter, and paging. Long
// reports go through this so a 2000-row payload stays navigable instead of becoming one giant list.
import { Fragment, useState, type ReactNode } from "react";
import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
} from "@tanstack/react-table";

import { Icon } from "../icon";
import { EmptyState } from "./composites";
import { Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  /** Column the filter narrows. Pair it with `filterValue`, which the header renders. */
  filterColumn?: string;
  /** Controlled filter text. The card header owns the field, so the table renders no filter row. */
  filterValue?: string;
  pageSize?: number;
  onRowClick?: (row: T) => void;
  /** Renders an inline detail panel under the row. Supplying it enables expanding. */
  renderExpanded?: (row: T) => ReactNode;
  /** Screen-reader caption; every table needs one. */
  caption?: string;
  emptyTitle?: string;
  emptyBody?: string;
}

export function DataTable<T>({
  columns,
  data,
  filterColumn,
  filterValue,
  pageSize = 25,
  onRowClick,
  renderExpanded,
  caption,
  emptyTitle = "Nothing to show",
  emptyBody = "No rows fall inside the selected range.",
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const columnFilters: ColumnFiltersState =
    filterColumn && filterValue ? [{ id: filterColumn, value: filterValue }] : [];

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getRowCanExpand: () => Boolean(renderExpanded),
    initialState: { pagination: { pageSize } },
  });

  const rows = table.getRowModel().rows;
  const total = table.getFilteredRowModel().rows.length;
  const pageCount = Math.max(table.getPageCount(), 1);

  return (
    <div className="grid gap-3">
      {rows.length === 0 ? (
        <EmptyState title={emptyTitle} body={emptyBody} />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            {caption && <caption className="sr-only">{caption}</caption>}
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const sorted = header.column.getIsSorted();
                    const canSort = header.column.getCanSort();
                    return (
                      <TableHead key={header.id} className="whitespace-nowrap">
                        {header.isPlaceholder ? null : canSort ? (
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            className="mono inline-flex items-center gap-1 rounded-md text-[11px] tracking-[0.1em] text-dim uppercase hover:text-ink"
                            aria-label={`Sort by ${String(header.column.columnDef.header ?? header.id)}`}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            <Icon
                              name={sorted === "asc" ? "arrow-up" : sorted === "desc" ? "arrow-down" : "chevrons-up-down"}
                              className={`size-3 ${sorted ? "text-accent" : "opacity-40"}`}
                            />
                          </button>
                        ) : (
                          <span className="mono text-[11px] tracking-[0.1em] text-dim uppercase">
                            {flexRender(header.column.columnDef.header, header.getContext())}
                          </span>
                        )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <Fragment key={row.id}>
                  <TableRow
                    onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                    className={onRowClick ? "cursor-pointer hover:bg-track/50" : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                    onKeyDown={
                      onRowClick
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onRowClick(row.original);
                            }
                          }
                        : undefined
                    }
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="py-2">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                  {renderExpanded && row.getIsExpanded() && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={row.getVisibleCells().length} className="bg-track/30 p-0">
                        {renderExpanded(row.original)}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="mono m-0 text-[11px] text-dim">
            {total === data.length ? `${total} rows` : `${total} of ${data.length} rows`}
            {pageCount > 1 ? ` · page ${table.getState().pagination.pageIndex + 1} of ${pageCount}` : ""}
          </p>
          {pageCount > 1 && (
            <Pagination className="mx-0 w-auto justify-end">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    text="Newer"
                    aria-disabled={!table.getCanPreviousPage()}
                    className={table.getCanPreviousPage() ? undefined : "pointer-events-none opacity-40"}
                    onClick={(e) => {
                      e.preventDefault();
                      table.previousPage();
                    }}
                  />
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext
                    text="Older"
                    aria-disabled={!table.getCanNextPage()}
                    className={table.getCanNextPage() ? undefined : "pointer-events-none opacity-40"}
                    onClick={(e) => {
                      e.preventDefault();
                      table.nextPage();
                    }}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </div>
      )}
    </div>
  );
}
