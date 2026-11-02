// Logs page: every change Tersio made on this machine, newest first, in a terminal window.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Page, PageHeader, PagedTable, Segmented } from "@/components/charts";
import type { Column } from "@/components/charts";
import { EmptyState } from "@/components/common";
import { Icon } from "@/components/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { usePending } from "@/hooks/use-pending";
import { cn } from "cn";

type Kind = "mode" | "agent" | "file" | "doctor";

interface Entry {
  at: number;
  kind: Kind;
  title: string;
  detail?: string;
  ok?: boolean;
}

const KIND_LABEL: Record<Kind, string> = {
  mode: "mode",
  agent: "agent",
  file: "file",
  doctor: "doctor",
};

const FILTERS: ReadonlyArray<{ value: "all" | Kind; label: string }> = [
  { value: "all", label: "All" },
  { value: "mode", label: "Modes" },
  { value: "agent", label: "Agents" },
  { value: "file", label: "Files" },
  { value: "doctor", label: "Doctor" },
];

/** The window controls, in the order macOS draws them. Each one does something real here. */
const TRAFFIC = [
  { key: "close", color: "#ff5f57", glyph: "x", label: "Close the log" },
  { key: "minimize", color: "#febc2e", glyph: "minus", label: "Collapse the log" },
  { key: "zoom", color: "#28c840", glyph: "plus", label: "Larger text" },
] as const;

function clock(at: number): string {
  return new Date(at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function stamp(at: number): string {
  const d = new Date(at);
  const date = d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
  return `${date} · ${time}`;
}

/** How long ago, so a wall of timestamps also reads as recent or old at a glance. */
function ago(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function LogsPage({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | Kind>("all");
  const [collapsed, setCollapsed] = useState(false);
  const [large, setLarge] = useState(false);
  const pending = usePending(loading && entries.length === 0);

  const load = useCallback((): void => {
    void fetch("/api/logs?limit=500")
      .then((r) => (r.ok ? r.json() : null))
      .then((rows: Entry[] | null) => { if (Array.isArray(rows)) setEntries(rows); })
      .catch(() => { /* keep what is on screen */ })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    // The CLI writes to the same file from another process, so the page rereads it while open.
    const timer = window.setInterval(load, 10_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const rows = useMemo(
    () => (filter === "all" ? entries : entries.filter((entry) => entry.kind === filter)),
    [entries, filter],
  );

  const filters = (
    <Segmented
      value={filter}
      onChange={setFilter}
      options={FILTERS.map((option) => ({ value: option.value, label: option.label }))}
      label="Filter the log"
    />
  );

  const columns: Array<Column<Entry>> = [
    {
      key: "at",
      header: "date",
      width: 232,
      sort: (row) => row.at,
      render: (row) => (
        <span className="whitespace-nowrap text-dim" title={ago(row.at)}>{stamp(row.at)}</span>
      ),
    },
    {
      key: "kind",
      header: "kind",
      width: 76,
      // A phone keeps time and the event; the kind and the path would only truncate there.
      className: "hidden sm:table-cell",
      render: (row) => (
        <span className="text-dim">{KIND_LABEL[row.kind] ?? row.kind}</span>
      ),
    },
    {
      key: "status",
      header: "status",
      width: 74,
      className: "hidden sm:table-cell",
      render: (row) => (
        <span className={cn(row.ok === false ? "text-destructive" : row.ok === true ? "text-success" : "text-dim")}>
          {row.ok === false ? "failed" : row.ok === true ? "ok" : "—"}
        </span>
      ),
    },
    {
      key: "title",
      header: "event",
      sort: (row) => row.title,
      render: (row) => (
        <span className={cn("block truncate", row.ok === false ? "text-destructive" : "text-ink")}>{row.title}</span>
      ),
    },
    {
      key: "detail",
      header: "detail",
      className: "hidden md:table-cell",
      render: (row) => (
        <span className="block truncate text-dim" title={row.detail}>{row.detail ?? ""}</span>
      ),
    },
  ];

  return (
    <Page>
      <PageHeader
        title="Logs"
        description="Every change Tersio makes on this machine, newest first, with the full date, the status, and what happened."
      />

      <section className="terminal-window" aria-label="Tersio activity log">
        <div className="terminal-bar flex h-10 items-center gap-3 px-3">
          <div className="flex items-center gap-2">
            {TRAFFIC.map((light) => (
              <button
                key={light.key}
                type="button"
                aria-label={light.label}
                title={light.label}
                aria-pressed={light.key === "zoom" ? large : undefined}
                onClick={() => {
                  if (light.key === "close") onClose();
                  if (light.key === "minimize") setCollapsed((open) => !open);
                  if (light.key === "zoom") setLarge((big) => !big);
                }}
                className="group grid size-3 cursor-pointer place-items-center rounded-full shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.2)]"
                style={{ backgroundColor: light.color }}
              >
                <Icon
                  name={light.glyph}
                  className="size-2 text-black/55 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                />
              </button>
            ))}
          </div>

          <span className="pointer-events-none absolute inset-x-0 hidden justify-center sm:flex">
            <span className="mono text-[11px] text-dim">~/.tersio/activity.jsonl</span>
          </span>

          <div className="ml-auto flex items-center gap-2">
            <span className="max-sm:hidden">{filters}</span>
            <button
              type="button"
              onClick={load}
              aria-label="Refresh log"
              title="Refresh log"
              className="grid size-6 cursor-pointer place-items-center rounded-md text-dim transition-colors duration-200 hover:bg-track hover:text-ink"
            >
              <Icon name="refresh-cw" className="size-3.5" />
            </button>
          </div>
        </div>

        <div className="border-b border-line px-3 py-2 sm:hidden">{filters}</div>

        {collapsed ? (
          <p className="mono m-0 px-3.5 py-3 text-[11px] text-dim">
            {rows.length} entries{rows[0] ? `, newest ${clock(rows[0].at)}` : ""}
          </p>
        ) : loading && entries.length === 0 ? (
          // A fast local read settles before this draws, so a skeleton never flicks on and off.
          pending ? (
            <div className="grid gap-2.5 px-3.5 py-3" aria-busy="true" aria-label="Loading log">
              {Array.from({ length: 8 }, (_, index) => (
                <div key={index} className="flex items-center gap-3">
                  <Skeleton className="h-3 w-14 shrink-0" />
                  <Skeleton className="h-3 w-10 shrink-0" />
                  <Skeleton className="h-3 flex-1" />
                </div>
              ))}
            </div>
          ) : null
        ) : (
          <div className={cn("mono", large ? "text-[14px]" : "text-[13px]")}>
            <PagedTable
              columns={columns}
              rows={rows}
              rowKey={(row) => `${row.at}:${row.kind}:${row.title}:${row.detail ?? ""}`}
              initialSort={{ key: "at", dir: "desc" }}
              perPage={25}
              empty={(
                <EmptyState
                  icon="scroll-text"
                  title="No activity yet"
                  desc="Change a mode, install or update an agent, or run the doctor. Every change lands here."
                />
              )}
              ariaLabel="Tersio activity"
            />
          </div>
        )}
      </section>
    </Page>
  );
}
