// One session transcript as a timeline: the entries omp wrote, in order, with their cost.
import { useMemo, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, PageHeader, QueryView, SearchInput, Segmented, Stat, StatGrid } from "@/components/charts";
import { ProviderMark, VendorMark } from "@/components/brand";
import { Icon } from "@/components/icon";
import { fmt, fmtMs, fmtShort, relAge, stampLocal } from "@/lib/format";
import { useSessionTrace } from "@/lib/data";
import type { OmpTranscriptEntry } from "@/lib/data";

type Kind = "all" | "user" | "assistant" | "tool";
const KIND_FILTERS: ReadonlyArray<{ value: Kind; label: string }> = [
  { value: "all", label: "All" },
  { value: "user", label: "Prompts" },
  { value: "assistant", label: "Assistant" },
  { value: "tool", label: "Tools" },
];

const KIND_ICON: Record<OmpTranscriptEntry["kind"], string> = {
  user: "user",
  assistant: "sparkles",
  tool: "wrench",
  system: "settings",
};

/** The transcript of one session, opened from the Traces page. */
export function SessionTrace({
  sessionFile,
  money,
  onClose,
}: {
  sessionFile: string;
  money: (v: number) => string;
  onClose: () => void;
}) {
  const { trace, loading } = useSessionTrace(sessionFile);
  const [kind, setKind] = useState<Kind>("all");
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (trace?.entries ?? []).filter((entry) => {
      if (kind !== "all" && entry.kind !== kind) return false;
      if (!needle) return true;
      return entry.detail.toLowerCase().includes(needle) || entry.label.toLowerCase().includes(needle) || entry.tool.toLowerCase().includes(needle);
    });
  }, [trace, kind, query]);

  const title = sessionFile.split("/").pop() ?? sessionFile;
  const totalTokens = (trace?.entries ?? []).reduce((sum, entry) => sum + entry.tokens, 0);
  const totalCost = (trace?.entries ?? []).reduce((sum, entry) => sum + entry.costUsd, 0);
  const failed = (trace?.entries ?? []).filter((entry) => entry.isError).length;
  const first = trace?.entries[0]?.ts ?? 0;

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4 px-4 py-5 sm:px-6">
      <PageHeader
        title="Session"
        description={
          <span className="mono break-all">
            {title}
            {trace ? ` · ${trace.project}` : ""}
          </span>
        }
        actions={
          <button
            type="button"
            onClick={onClose}
            className="mono flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-dim transition-[background,color] duration-200 hover:bg-accent-soft hover:text-ink"
          >
            <Icon name="arrow-left" className="size-3.5" />
            Back to traces
          </button>
        }
      />

      <QueryView loading={loading} empty={!loading && (trace?.entries.length ?? 0) === 0} emptyIcon="file-question" emptyTitle="Nothing to show" emptyDesc="This transcript has no message entries, or the file is no longer on disk.">
        <div className="flex flex-col gap-4">
          <StatGrid cols={4}>
            <Stat label="Entries" value={fmt(trace?.entries.length ?? 0)} hint={trace?.truncated ? "truncated to the newest entries" : "every entry in the file"} />
            <Stat label="Tokens" value={fmtShort(totalTokens)} />
            <Stat label="Cost" value={money(totalCost)} hint="Public rate card estimate" />
            <Stat label="Tool failures" value={fmt(failed)} tone={failed > 0 ? "bad" : undefined} hint={first ? `started ${relAge(first)}` : undefined} />
          </StatGrid>

          <Card
            title="Timeline"
            description={trace ? `${fmt(rows.length)} of ${fmt(trace.entries.length)} entries` : undefined}
            actions={
              <div className="flex items-center gap-2">
                <Segmented label="Entry kind" value={kind} options={KIND_FILTERS} onChange={setKind} />
                <SearchInput value={query} onChange={setQuery} placeholder="Filter entries" label="Filter entries" className="w-[200px]" />
              </div>
            }
          >
            <div className="overflow-x-auto overscroll-contain [scrollbar-color:var(--line)_transparent] [scrollbar-width:thin]">
              <Table className="mono min-w-[900px] text-[13px]">
                <TableHeader className="[&_tr]:border-line [&_tr]:text-left [&_tr]:text-[11px] [&_tr]:uppercase [&_tr]:tracking-[0.14em] [&_tr]:text-dim">
                  <TableRow>
                    <TableHead scope="col" className="h-9 px-3">When</TableHead>
                    <TableHead scope="col" className="h-9 px-3">Kind</TableHead>
                    <TableHead scope="col" className="h-9 px-3">Detail</TableHead>
                    <TableHead scope="col" className="h-9 px-3 text-right">Tokens</TableHead>
                    <TableHead scope="col" className="h-9 px-3 text-right">Elapsed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((entry, index) => (
                    <TableRow key={`${entry.ts}-${index}`} className="border-line align-top">
                      <TableCell className="whitespace-nowrap px-3 py-2 text-dim" title={stampLocal(entry.ts)}>
                        {stampLocal(entry.ts).slice(11)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-3 py-2">
                        <span className="inline-flex items-center gap-2">
                          <Icon name={KIND_ICON[entry.kind]} className="size-3.5" />
                          <span>{entry.kind === "tool" ? entry.label : entry.kind}</span>
                        </span>
                        {entry.model && (
                          <span className="ml-2 inline-flex items-center gap-1.5">
                            <VendorMark model={entry.model} small />
                          </span>
                        )}
                        {entry.provider && <ProviderMark provider={entry.provider} small />}
                      </TableCell>
                      <TableCell className="max-w-[520px] px-3 py-2">
                        <span className={entry.isError ? "text-danger" : undefined} title={entry.detail}>
                          {entry.detail || entry.tool || "–"}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-dim">
                        {entry.tokens > 0 ? fmtShort(entry.tokens) : "–"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-dim">
                        {fmtMs(entry.durationMs)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </div>
      </QueryView>
    </div>
  );
}
