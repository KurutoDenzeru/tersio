// Projects: usage one session folder at a time, the working directory a session ran in.
import { useDeferredValue, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { OMP_RANGE_LABEL } from "@/lib/data";
import type { OmpRow, OmpStats } from "@/lib/data";
import {
  BarList,
  Card,
  CellBar,
  DataTable,
  Page,
  PageHeader,
  QueryView,
  SearchInput,
  Stat,
  StatGrid,
} from "@/components/charts";
import type { Column } from "@/components/charts";
import { EmptyState } from "@/components/common";
import { PALETTE, fmt, fmtMs, fmtShort, pct, projectLabel, relAge, stampLocal } from "@/lib/format";

/** Rows rendered before the table stops; the reference caps a long list the same way. */
const ROW_LIMIT = 100;
/** Bars shown in the two top lists. */
const TOP_LIMIT = 8;

/** Session folders under a system temp location (`/tmp`, `/var/folders`), slugged into the key. */
const TEMP_FOLDER_RE = /^\/?-?(?:private-)?(?:tmp|var-folders)(?:[-/]|$)/;

interface FolderRow {
  row: OmpRow;
  requestShare: number;
  costShare: number;
  temporary: boolean;
}

export function ProjectsPage({ omp, money }: { omp: OmpStats; money: (v: number) => string }) {
  const [search, setSearch] = useState("");
  // Benchmarks and scratch sessions can leave thousands of one-off temp folders; hide them by default.
  const [hideTemporary, setHideTemporary] = useState(true);

  const view = useMemo(() => {
    let totalRequests = 0;
    let failedRequests = 0;
    let totalCost = 0;
    let unpricedRequests = 0;
    let conversationTokens = 0;
    let input = 0;
    let cacheRead = 0;
    let maxRequests = 0;
    let maxCost = 0;
    for (const row of omp.byProject) {
      totalRequests += row.requests;
      failedRequests += row.failed;
      totalCost += row.costUsd;
      unpricedRequests += row.unpricedRequests;
      conversationTokens += row.total;
      input += row.input;
      cacheRead += row.cacheRead;
      maxRequests = Math.max(maxRequests, row.requests);
      maxCost = Math.max(maxCost, row.costUsd);
    }
    let temporaryCount = 0;
    const rows: FolderRow[] = omp.byProject.map((row) => {
      const temporary = TEMP_FOLDER_RE.test(row.key);
      if (temporary) temporaryCount++;
      return {
        row,
        requestShare: totalRequests > 0 ? row.requests / totalRequests : 0,
        costShare: totalCost > 0 ? row.costUsd / totalCost : 0,
        temporary,
      };
    });
    return {
      rows,
      totalRequests,
      failedRequests,
      totalCost,
      unpricedRequests,
      conversationTokens,
      cacheRate: input + cacheRead > 0 ? cacheRead / (input + cacheRead) : 0,
      maxRequests,
      maxCost,
      temporaryCount,
    };
  }, [omp.byProject]);

  // Meter scales follow the whole range so a bar's length does not change while filtering.
  const columns = useMemo<Array<Column<FolderRow>>>(
    () => [
      {
        key: "folder",
        header: "Folder",
        render: ({ row, temporary }) => (
          <span className="flex min-w-0 items-center gap-2" title={row.key}>
            <span className="mono truncate">{projectLabel(row.key)}</span>
            {temporary && (
              <Badge variant="outline" className="mono h-4 shrink-0 border-line px-1 text-[10px] text-dim">
                temp
              </Badge>
            )}
          </span>
        ),
        sort: ({ row }) => row.key.toLowerCase(),
      },
      {
        key: "requests",
        header: "Requests",
        align: "right",
        width: 150,
        render: ({ row, requestShare }) => (
          <span className="flex flex-col items-end gap-1" title={`${pct(requestShare)} of all requests`}>
            <span className="mono tabular-nums">{fmt(row.requests)}</span>
            <CellBar value={row.requests} max={view.maxRequests} />
          </span>
        ),
        sort: ({ row }) => row.requests,
      },
      {
        key: "cost",
        header: "Cost",
        title: "API-equivalent cost at public API rates",
        align: "right",
        width: 160,
        render: ({ row, costShare }) => (
          <span className="flex flex-col items-end gap-1" title={`${pct(costShare)} of all cost`}>
            <span className="mono tabular-nums">{money(row.costUsd)}</span>
            <CellBar value={row.costUsd} max={view.maxCost} color={PALETTE[1]} />
          </span>
        ),
        sort: ({ row }) => row.costUsd,
      },
      {
        key: "tokens",
        header: "Tokens",
        title: "Uncached input + cache reads + cache writes + output",
        align: "right",
        render: ({ row }) => (
          <span className="mono tabular-nums" title={fmt(row.total)}>
            {fmtShort(row.total)}
          </span>
        ),
        sort: ({ row }) => row.total,
      },
      {
        key: "cacheRate",
        header: "Cache rate",
        title: "Cache reads ÷ (uncached input + cache reads)",
        align: "right",
        render: ({ row }) => <span className="mono tabular-nums">{pct(row.cacheRate)}</span>,
        sort: ({ row }) => row.cacheRate,
      },
      {
        key: "cacheSavings",
        header: "Cache savings",
        title: "Prompt-input cost saved versus billing the same tokens uncached",
        align: "right",
        render: ({ row }) => (
          <span className={row.cacheSavings < 0 ? "mono tabular-nums text-danger" : "mono tabular-nums text-dim"}>
            {pct(row.cacheSavings)}
          </span>
        ),
        sort: ({ row }) => row.cacheSavings,
      },
      {
        key: "errors",
        header: "Errors",
        align: "right",
        render: ({ row }) => (
          <span title={`${fmt(row.failed)} failed`}>
            <Badge
              variant={row.failed > 0 && row.errorRate >= 0.1 ? "destructive" : "outline"}
              className={
                row.failed > 0 && row.errorRate >= 0.1
                  ? "mono"
                  : `mono border-line ${row.failed > 0 ? "text-[var(--warn-border)]" : "text-dim"}`
              }
            >
              {pct(row.errorRate)}
            </Badge>
          </span>
        ),
        sort: ({ row }) => row.errorRate,
      },
      {
        key: "duration",
        header: "Avg duration",
        align: "right",
        render: ({ row }) => <span className="mono tabular-nums">{fmtMs(row.avgDurationMs)}</span>,
        sort: ({ row }) => row.avgDurationMs,
      },
      {
        key: "last",
        header: "Last active",
        align: "right",
        render: ({ row }) =>
          row.lastTs === null ? (
            <span className="text-dim">-</span>
          ) : (
            <span className="text-dim" title={stampLocal(row.lastTs)}>
              {relAge(row.lastTs)}
            </span>
          ),
        sort: ({ row }) => row.lastTs ?? 0,
      },
    ],
    [view.maxRequests, view.maxCost, money],
  );

  const scoped = useMemo(
    () => (hideTemporary ? view.rows.filter((r) => !r.temporary) : view.rows),
    [view.rows, hideTemporary],
  );
  // Filtering tens of thousands of folders should not block the keystroke that started it.
  const query = useDeferredValue(search.trim().toLowerCase());
  const matching = useMemo(
    () => (query ? scoped.filter((r) => projectLabel(r.row.key).toLowerCase().includes(query)) : scoped),
    [scoped, query],
  );

  const topCost = useMemo(
    () =>
      [...scoped]
        .toSorted((a, b) => b.row.costUsd - a.row.costUsd)
        .slice(0, TOP_LIMIT)
        .map((r) => ({ key: r.row.key, label: projectLabel(r.row.key), value: r.row.costUsd, color: PALETTE[1] })),
    [scoped],
  );
  const topRequests = useMemo(
    () =>
      [...scoped]
        .toSorted((a, b) => b.row.requests - a.row.requests)
        .slice(0, TOP_LIMIT)
        .map((r) => ({ key: r.row.key, label: projectLabel(r.row.key), value: r.row.requests })),
    [scoped],
  );

  const emptyTitle =
    view.rows.length === 0 ? "No project folders in this range" : "Only temporary folders in this range";

  return (
    <Page>
      <PageHeader
        title="Projects"
        description={`Usage by session folder in ${OMP_RANGE_LABEL[omp.range]}.`}
      />

      <StatGrid cols={5}>
        <Stat
          label="Folders"
          value={fmt(view.rows.length)}
          hint={view.temporaryCount > 0 ? `${fmt(view.temporaryCount)} temporary` : undefined}
        />
        <Stat
          label="Requests"
          value={fmt(view.totalRequests)}
          hint={`${fmt(view.failedRequests)} failed`}
        />
        <Stat
          label="API-equivalent cost"
          title="What this usage would cost at public API rates"
          value={money(view.totalCost)}
          hint={view.unpricedRequests > 0 ? `${fmt(view.unpricedRequests)} unpriced` : undefined}
        />
        <Stat
          label="Conversation tokens"
          title="Uncached input + cache reads + cache writes + output"
          value={fmtShort(view.conversationTokens)}
        />
        <Stat
          label="Cache rate"
          title="Cache reads ÷ (uncached input + cache reads), across every folder"
          value={pct(view.cacheRate)}
        />
      </StatGrid>

      <div className="grid gap-4 md:grid-cols-2">
        <Card index={1} title="Top by cost" description="Share of API-equivalent cost">
          <QueryView
            empty={topCost.length === 0}
            emptyIcon="folder-git-2"
            emptyTitle={emptyTitle}
            emptyDesc="Try a longer range."
          >
            <BarList rows={topCost} money={money} limit={TOP_LIMIT} />
          </QueryView>
        </Card>
        <Card index={2} title="Top by requests" description="Share of all requests">
          <QueryView
            empty={topRequests.length === 0}
            emptyIcon="folder-git-2"
            emptyTitle={emptyTitle}
            emptyDesc="Try a longer range."
          >
            <BarList rows={topRequests} money={fmt} limit={TOP_LIMIT} />
          </QueryView>
        </Card>
      </div>

      <Card
        index={3}
        title="Folders"
        description={
          matching.length === view.rows.length
            ? `${fmt(view.rows.length)} folders`
            : `${fmt(matching.length)} of ${fmt(view.rows.length)} folders`
        }
        actions={
          <>
            {view.temporaryCount > 0 && (
              <label
                className="mono flex cursor-pointer items-center gap-1.5 text-[11px] text-dim"
                title="Session folders under /tmp or /var/folders"
              >
                <input
                  type="checkbox"
                  className="size-3.5 accent-[var(--accent)]"
                  checked={hideTemporary}
                  onChange={(e) => setHideTemporary(e.target.checked)}
                />
                Hide temporary ({fmt(view.temporaryCount)})
              </label>
            )}
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Filter folders…"
              label="Filter folders"
              className="w-[240px]"
            />
          </>
        }
        flush
      >
        <DataTable
          columns={columns}
          rows={matching}
          rowKey={(r) => r.row.key}
          initialSort={{ key: "cost", dir: "desc" }}
          limit={ROW_LIMIT}
          ariaLabel="Project folders"
          empty={
            <EmptyState
              icon="folder-git-2"
              title={view.rows.length === 0 ? "No project folders in this range" : "No folders match"}
              desc={
                view.rows.length === 0
                  ? "Try a longer range."
                  : hideTemporary && view.temporaryCount > 0
                    ? "Temporary folders are hidden."
                    : "Clear the filter to see every folder."
              }
            />
          }
        />
      </Card>
    </Page>
  );
}
