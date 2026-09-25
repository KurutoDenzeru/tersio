// Command tools table: session tool calls + RTK-metered commands grouped
// by command, sortable, paged, with honest gaps (–) for unmetered rows.
import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmt, fmtMs, fmtShort } from "@/lib/format";
import type { UsageReport } from "@/lib/data";
import { EmptyState, HoverTip, PageButtons, PerPage, usePager } from "./common";
import { Icon } from "./icon";

interface CmdRow {
  name: string;
  count: number;
  saved: number | null;
  avgPct: number | null;
  avgMs: number | null;
}

type Key = "name" | "count" | "saved" | "avgPct" | "avgMs";

export function Tools({ data }: { data: UsageReport | null }) {
  const [page, setPage] = useState(1);
  const [per, setPer] = useState(15);
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 }>({ key: "count", dir: -1 });

  const { rows, scope } = useMemo(() => {
    const g = data?.rtkGain;
    const byName: Record<string, CmdRow> = {};
    const add = (name: string, count: number, saved: number | null, avgPct: number | null, avgMs: number | null): void => {
      const r = byName[name];
      if (!r) {
        byName[name] = { name, count, saved, avgPct, avgMs };
        return;
      }
      r.count += count;
      if (saved !== null) r.saved = (r.saved ?? 0) + saved;
    };
    (data?.byTool ?? []).forEach(([name, count]) => add(name, count, null, null, null));
    (g?.byCommand ?? []).forEach((r) => add(r.command, r.count, r.saved, r.avgPct, r.avgMs));
    const list = Object.values(byName);
    const { key: k, dir: d } = sort;
    list.sort((a, b) => {
      const av = a[k];
      const bv = b[k];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (av < bv) return -d;
      if (av > bv) return d;
      return b.count - a.count;
    });
    const scopeText = g?.commands
      ? `${fmt(list.length)} commands · ${fmt(g.commands)} runs · ${fmtShort(g.saved)} saved`
      : "tool calls in sessions";
    return { rows: list, scope: scopeText };
  }, [data, sort]);

  const { pages, page: p, range } = usePager(rows.length, per, page);
  const max = Math.max(1, ...rows.map((r) => r.count));
  const slice = rows.slice((p - 1) * per, p * per);

  const th = (label: string, key: Key, num?: boolean): React.ReactNode => {
    const on = sort.key === key;
    return (
      <TableHead aria-sort={on ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
        <button
          type="button"
          className={`[all:unset] inline-flex! cursor-pointer! items-center! gap-[5px]! hover:text-ink focus-visible:rounded-[4px] focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent${num ? " float-right!" : ""}`}
          data-sort={key}
          onClick={() => {
            setPage(1);
            setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "name" ? 1 : -1 }));
          }}
        >
          {label} <span className={on ? "text-[10px] text-accent" : "text-[10px] text-dim opacity-[.55]"}>{on ? (sort.dir === 1 ? "↑" : "↓") : "⇅"}</span>
        </button>
      </TableHead>
    );
  };

  return (
    <Card
      id="tools"
      data-reveal
      className="mt-8 translate-y-[26px] overflow-hidden border-line bg-panel opacity-0 transition-[opacity,transform] duration-700 ease-[cubic-bezier(.16,1,.3,1)] data-[reveal=in]:translate-y-0 data-[reveal=in]:opacity-100"
      style={{ scrollMarginTop: 90 }}
      aria-label="Command tools"
    >
      <CardHeader>
        <div className="flex items-center gap-2">
          <Icon name="terminal" className="size-4" />
          <CardTitle className="font-display text-xl tracking-tight">Command tools</CardTitle>
          <span className="mono ml-auto min-w-0 truncate text-xs text-dim">{scope}</span>
        </div>
        <CardDescription className="mono text-xs text-dim">count · tokens saved · weighted rate · avg time · share of executions</CardDescription>
        <div className="mono grid gap-2 border-y border-line py-3 text-xs text-dim sm:grid-cols-4">
          <span>Eligible RTK <strong className="text-accent">{(data?.rtkAdoption.adoptionPct ?? 0).toFixed(1)}%</strong></span>
          <span>RTK calls <strong className="text-ink">{fmt(data?.rtkAdoption.rtkCalls ?? 0)}</strong></span>
          <span>Missed <strong className="text-ink">{fmt(data?.rtkAdoption.missedCalls ?? 0)}</strong></span>
          <span>Recall <strong className="text-ink">{data?.rtkRecall.available ? `${data.rtkRecall.mode} · ${data.rtkRecall.entries}` : "unavailable"}</strong></span>
        </div>
      </CardHeader>
      <CardContent>
      {rows.length > 0 ? (
        <Table className="mono text-[13px]" id="cmdTable">
          <colgroup><col style={{ width: 40 }} /><col /><col style={{ width: 90 }} /><col style={{ width: 90 }} /><col style={{ width: 90 }} /><col style={{ width: 90 }} /><col style={{ width: 140 }} /></colgroup>
          <TableHeader className="[&_tr]:text-left [&_tr]:text-[11px] [&_tr]:uppercase [&_tr]:tracking-[0.14em] [&_tr]:text-dim">
            <TableRow>
              <TableHead className="w-10 py-2 pr-3 text-right font-normal">#</TableHead>
              {th("Tool / Command", "name")}
              {th("Count", "count", true)}
              {th("Saved", "saved", true)}
              {th("Avg%", "avgPct", true)}
              {th("Time", "avgMs", true)}
              <TableHead className="min-w-32 py-2 font-normal">Impact</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {slice.map((r, i) => (
              <TableRow key={r.name} className="cursor-pointer hover:bg-track hover:shadow-tersio">
                <TableCell className="w-10 py-2.5 pr-3 text-right text-xs text-dim">
                  {String((p - 1) * per + i + 1).padStart(2, "0")}
                </TableCell>
                <HoverTip content={r.name}>
                  <TableCell className="max-w-[280px] truncate py-2.5 pr-3">
                    {r.name}
                  </TableCell>
                </HoverTip>
                <TableCell className="py-2.5 pr-3 text-right font-bold">{fmt(r.count)}</TableCell>
                <TableCell className="py-2.5 pr-3 text-right font-bold">{r.saved === null ? "–" : fmtShort(r.saved)}</TableCell>
                <TableCell className="py-2.5 pr-3 text-right text-accent">
                  {r.avgPct === null ? "–" : `${r.avgPct.toFixed(1)}%`}
                </TableCell>
                <TableCell className="py-2.5 pr-3 text-right text-dim">
                  {r.avgMs === null ? "–" : fmtMs(r.avgMs)}
                </TableCell>
                <TableCell className="min-w-32 py-2.5">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-track">
                    <div className="h-full origin-left rounded-full bg-accent transition-[width] duration-1000 ease-[cubic-bezier(.16,1,.3,1)]" style={{ width: r.count ? `${Math.round((r.count / max) * 100)}%` : "0" }} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <EmptyState icon="wrench" title="No tool data yet" desc="Session tool calls and RTK measurements will appear here once recorded." />
      )}
        </CardContent>
        <CardFooter className="mono justify-between gap-4 border-t text-xs text-dim">
          <span>{range}</span>
          <div className="flex items-center gap-4">
            <PerPage options={[10, 15, 25, 50]} value={per} onPick={(n) => { setPer(n); setPage(1); }} label="Rows per page" />
            <PageButtons pages={pages} page={p} onPick={setPage} label="Pages" />
          </div>
        </CardFooter>
      </Card>
  );
}
