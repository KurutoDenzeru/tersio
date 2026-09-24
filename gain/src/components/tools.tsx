// Command tools table. Port of the renderCmd() union in
// dashboard/charts.js: session tool calls + RTK-metered commands grouped
// by command, sortable, paged, with honest gaps (–) for unmetered rows.
import { useMemo, useState } from "react";
import { fmt, fmtMs, fmtShort } from "@/lib/format";
import type { UsageReport } from "@/lib/data";
import { EmptyState, PageButtons, PerPage, usePager } from "./common";
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
      <th aria-sort={on ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
        <button
          type="button"
          className={`thsort${num ? " num" : ""}`}
          data-sort={key}
          onClick={() => {
            setPage(1);
            setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "name" ? 1 : -1 }));
          }}
        >
          {label} <span className="arr">{on ? (sort.dir === 1 ? "↑" : "↓") : "⇅"}</span>
        </button>
      </th>
    );
  };

  return (
    <section id="tools" className="rise mt-8 rounded-xl p-5 overflow-hidden" style={{ border: "1px solid var(--line)", background: "var(--panel)", scrollMarginTop: 90 }} aria-label="Command tools">
      <div className="flex items-center gap-2 mb-1">
        <Icon name="terminal" className="size-4" />
        <h2 className="display font-bold tracking-tight text-xl truncate min-w-0">Command tools</h2>
        <div className="flex items-center gap-2 ml-auto min-w-0">
          <span className="mono text-xs truncate min-w-0" style={{ color: "var(--dim)" }}>
            {scope}
          </span>
        </div>
      </div>
      <p className="mono text-xs mb-4 truncate" style={{ color: "var(--dim)" }}>
        count · tokens saved · avg rate · avg time · share of executions
      </p>
      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full mono text-[13px]" id="cmdTable">
            <colgroup><col style={{ width: 40 }} /><col /><col style={{ width: 90 }} /><col style={{ width: 90 }} /><col style={{ width: 90 }} /><col style={{ width: 90 }} /><col style={{ width: 140 }} /></colgroup>
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.14em]" style={{ color: "var(--dim)" }}>
                <th className="font-normal text-right pr-3 py-2 w-10">#</th>
                {th("Tool / Command", "name")}
                {th("Count", "count", true)}
                {th("Saved", "saved", true)}
                {th("Avg%", "avgPct", true)}
                {th("Time", "avgMs", true)}
                <th className="font-normal py-2 min-w-32">Impact</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((r, i) => (
                <tr key={r.name} className="mrow">
                  <td className="text-right pr-3 py-2.5 mono text-xs w-10" style={{ color: "var(--dim)" }}>
                    {String((p - 1) * per + i + 1).padStart(2, "0")}
                  </td>
                  <td className="py-2.5 pr-3 truncate" style={{ maxWidth: 280 }} title={r.name}>
                    {r.name}
                  </td>
                  <td className="text-right py-2.5 pr-3 font-bold">{fmt(r.count)}</td>
                  <td className="text-right py-2.5 pr-3 font-bold">{r.saved === null ? "–" : fmtShort(r.saved)}</td>
                  <td className="text-right py-2.5 pr-3" style={{ color: "var(--accent)" }}>
                    {r.avgPct === null ? "–" : `${r.avgPct.toFixed(1)}%`}
                  </td>
                  <td className="text-right py-2.5 pr-3" style={{ color: "var(--dim)" }}>
                    {r.avgMs === null ? "–" : fmtMs(r.avgMs)}
                  </td>
                  <td className="py-2.5 min-w-32">
                    <div className="bar-track h-1.5 overflow-hidden">
                      <div className="bar-fill h-full" style={{ width: r.count ? `${Math.round((r.count / max) * 100)}%` : "0" }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState icon="wrench" title="No tool data yet" desc="Session tool calls and RTK measurements will appear here once recorded." />
      )}
      <div className="mono text-xs mt-4 flex flex-wrap items-center gap-x-4 gap-y-3" style={{ color: "var(--dim)" }}>
        <span>{range}</span>
        <PerPage options={[10, 15, 25, 50]} value={per} onPick={(n) => { setPer(n); setPage(1); }} label="Rows per page" />
        <PageButtons pages={pages} page={p} onPick={setPage} label="Pages" />
      </div>
      <p className="mono text-[11px] mt-3" style={{ color: "var(--dim)" }}>
        bash commands run through the rtk-wired OMP hook meter automatically; rows without metering show –. caveman + ponytail gains are instruction-following, bench-measured in BENCHMARK.md.
      </p>
    </section>
  );
}
