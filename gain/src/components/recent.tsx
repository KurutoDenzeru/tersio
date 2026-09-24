// Recent requests table. Port of renderRecent() + sortRecent() in
// dashboard/charts.js: newest-first default, every column sortable,
// measured vs modeled cost, status badges, per-row hover cards.
import { useMemo, useState } from "react";
import {
  costIsMeasured,
  displayCost,
  displayModel,
  fmt,
  shortName,
  speedText,
  stampLocal,
  statusColor,
  statusLabel,
  statusRank,
  vendorOf,
  whenStamp,
} from "@/lib/format";
import type { RecentRequestRow, UsageReport } from "@/lib/data";
import { EmptyState, HoverTip, PageButtons, PerPage, usePager } from "./common";
import { Icon } from "./icon";

type Key = "model" | "input" | "output" | "time" | "status" | "cost" | "when";

function val(r: RecentRequestRow, key: Key): string | number | null {
  if (key === "model") return r.m.toLowerCase();
  if (key === "input") return r.i;
  if (key === "output") return r.o;
  if (key === "time") return r.d === undefined ? null : r.d;
  if (key === "status") return statusRank(r.st);
  if (key === "cost") return displayCost(r);
  return r.t;
}

function RecentTip({ r, money }: { r: RecentRequestRow; money: (v: number) => string }) {
  const tps = r.d !== undefined && r.d > 0 ? r.o / (r.d / 1000) : 0;
  const est = !costIsMeasured(r);
  const row = (color: string, k: string, v: string): React.ReactNode => (
    <div className="flex items-center gap-2.5 py-[3px] text-xs">
      <span className="size-[9px] shrink-0 rounded-[2.5px]" style={{ background: color }} />
      <span className="min-w-0 flex-1 truncate">{k}</span>
      <span className="shrink-0 whitespace-nowrap tabular-nums">{v}</span>
    </div>
  );
  return (
    <div className="mono">
      <div className="text-[11px] font-bold uppercase tracking-[.14em]">{shortName(r.m)}</div>
      <div className="my-[2px] mb-2 text-[13px]">{stampLocal(r.t)}</div>
      {row("#fb923c", "input", fmt(r.i))}
      {row("var(--accent)", "output", fmt(r.o))}
      {(r.cr ?? 0) > 0 && row("var(--dim)", "cache read", fmt(r.cr ?? 0))}
      {(r.cw ?? 0) > 0 && row("var(--dim)", "cache write", fmt(r.cw ?? 0))}
      {row("var(--dim)", "elapsed", r.d !== undefined ? `${(r.d / 1000).toFixed(1)}s` : "–")}
      {row("var(--dim)", "speed", r.d !== undefined ? `${tps < 10 ? tps.toFixed(1) : Math.round(tps)} tok/s` : "–")}
      {row(statusColor(r.st), "status", statusLabel(r))}
      {row("var(--accent)", `cost ${est ? "(est.)" : "(measured)"}`, `${est ? "~" : ""}${money(displayCost(r))}`)}
      {typeof r.usd === "number" && row("var(--dim)", "charged", money(r.usd))}
      {r.note && <div className="mt-2 border-t border-line pt-2 text-[11px] leading-normal text-dim [overflow-wrap:break-word]">{r.note}</div>}
    </div>
  );
}

function StatusBadge({ r }: { r: RecentRequestRow }) {
  const base = "inline-flex items-center whitespace-nowrap rounded-full border px-[9px] py-[2px] text-[11px] leading-[1.55]";
  const cls =
    r.st === "error"
      ? `${base} border-danger-border bg-danger-soft text-danger`
      : r.st === "aborted"
        ? `${base} border-line bg-transparent text-ink`
        : `${base} border-transparent bg-track text-dim`;
  const title = r.st === "error" ? `error${r.code ? ` ${r.code}` : ""}${r.note ? ` — ${r.note}` : ""}` : r.st === "aborted" ? r.note || "Interrupted by user" : r.note || "";
  return (
    <span className={cls} title={title || undefined}>
      {statusLabel(r)}
    </span>
  );
}

export function Recent({ data, money }: { data: UsageReport | null; money: (v: number) => string }) {
  const [page, setPage] = useState(1);
  const [per, setPer] = useState(25);
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 }>({ key: "when", dir: -1 });

  const rows = useMemo(() => {
    const all = (data?.recent ?? []).slice();
    const { key: k, dir: d } = sort;
    all.sort((a, b) => {
      const av = val(a, k);
      const bv = val(b, k);
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (av < bv) return -d;
      if (av > bv) return d;
      return b.t - a.t;
    });
    return all;
  }, [data, sort]);

  const { pages, page: p, range } = usePager(rows.length, per, page);
  const slice = rows.slice((p - 1) * per, p * per);

  const th = (label: string, key: Key, num?: boolean, title?: string): React.ReactNode => {
    const on = sort.key === key;
    return (
      <th aria-sort={on ? (sort.dir === 1 ? "ascending" : "descending") : "none"} className="sticky top-0 z-10 bg-panel">
        <button
          type="button"
          className={`[all:unset] inline-flex! cursor-pointer! items-center! gap-[5px]! hover:text-ink focus-visible:rounded-[4px] focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent${num ? " float-right!" : ""}`}
          data-sort={key}
          title={title}
          onClick={() => {
            setPage(1);
            setSort((s) =>
              s.key === key
                ? { key, dir: s.dir === 1 ? -1 : 1 }
                : { key, dir: key === "model" || key === "status" ? 1 : -1 },
            );
          }}
        >
          {label} <span className={on ? "text-[10px] text-accent" : "text-[10px] text-dim opacity-[.55]"}>{on ? (sort.dir === 1 ? "↑" : "↓") : "⇅"}</span>
        </button>
      </th>
    );
  };

  return (
    <section data-reveal className="mt-8 translate-y-[26px] rounded-xl border border-line bg-panel p-5 opacity-0 transition-[opacity,transform] duration-700 ease-[cubic-bezier(.16,1,.3,1)] data-[reveal=in]:translate-y-0 data-[reveal=in]:opacity-100 overflow-hidden flex flex-col" style={{ scrollMarginTop: 90 }} aria-label="Recent requests">
      <div className="flex items-center gap-2 mb-1">
        <Icon name="history" className="size-4" />
        <h2 className="font-display font-bold tracking-tight text-xl truncate min-w-0">Recent requests</h2>
        <span className="mono text-xs ml-auto truncate shrink-0 text-dim">
          {rows.length ? `${rows.length} requests` : ""}
        </span>
      </div>
      <p className="mono text-xs mb-4 truncate text-dim" title="Time = elapsed time with the model; Speed = output tokens per second">
        latest assistant messages · local time · sort any column · cost is measured when the host recorded it
      </p>
      {rows.length > 0 ? (
        <div className="overflow-y-auto overscroll-contain [scrollbar-color:var(--line)_transparent] [scrollbar-width:thin] overflow-x-auto" style={{ maxHeight: 560 }}>
          <table className="w-full mono text-[13px] table-fixed" id="recentTable">
            <colgroup><col /><col style={{ width: 96 }} /><col style={{ width: 96 }} /><col style={{ width: 120 }} /><col style={{ width: 116 }} /><col style={{ width: 120 }} /><col style={{ width: 158 }} /></colgroup>
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-dim">
                {th("Model", "model")}
                {th("Input", "input", true)}
                {th("Output", "output", true)}
                {th("Time", "time", true, "Elapsed time with the model / output token speed")}
                {th("Status", "status")}
                {th("Cost", "cost", true)}
                {th("When", "when", true, "Local timestamp: month day, hour:minute:second")}
              </tr>
            </thead>
            <tbody>
              {slice.map((r, i) => {
                const v = vendorOf(r.m);
                const measured = costIsMeasured(r);
                return (
                  <HoverTip key={`${r.t}-${i}`} content={<RecentTip r={r} money={money} />}>
                    <tr className="cursor-pointer transition-[background] duration-200 hover:bg-track hover:shadow-tersio">
                      <td className="py-2.5 pr-3 truncate" style={{ minWidth: 0 }}>
                        <span className="mr-2 inline-block size-2 rounded-full" style={{ background: v.color }} />
                        {displayModel(r.m)}
                      </td>
                      <td className="text-right py-2.5 pr-3 whitespace-nowrap text-[#fb923c]">
                        {fmt(r.i)}
                      </td>
                      <td className="text-right py-2.5 pr-3 whitespace-nowrap text-accent">
                        {fmt(r.o)}
                      </td>
                      <td className="text-right py-2.5 pr-3 whitespace-nowrap text-dim" title={`⏱ ${r.d !== undefined ? `${(r.d / 1000).toFixed(1)}s elapsed with the model, ⚡ ${r.o} output tokens` : "no duration recorded"}`}>
                        {speedText(r)}
                      </td>
                      <td className="py-2.5 pr-3 whitespace-nowrap">
                        <StatusBadge r={r} />
                      </td>
                      <td
                        className={`text-right py-2.5 pr-3 whitespace-nowrap ${measured ? "text-ink" : "text-dim"}`}
                        title={
                          measured
                            ? "measured — charged by the provider"
                            : typeof r.usd === "number"
                              ? `est. — provider charged ${money(r.usd)} (free or local), modeled from tokens`
                              : "est. — modeled from tokens"
                        }
                      >
                        {(measured ? "" : "~") + money(displayCost(r))}
                      </td>
                      <td className="text-right py-2.5 whitespace-nowrap text-dim">
                        {whenStamp(r.t)}
                      </td>
                    </tr>
                  </HoverTip>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState icon="inbox" title="No requests yet" desc="Recent assistant messages will show here once sessions report tokens." />
      )}
      <div className="mono text-xs mt-4 pt-4 flex flex-wrap items-center gap-x-4 gap-y-3 mt-auto text-dim border-t border-line">
        <span>{range}</span>
        <PerPage options={[10, 15, 25, 50]} value={per} onPick={(n) => { setPer(n); setPage(1); }} label="Requests per page" />
        <PageButtons pages={pages} page={p} onPick={setPage} label="Recent pages" />
      </div>
    </section>
  );
}
