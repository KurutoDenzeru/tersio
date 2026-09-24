// Recent requests table. Port of renderRecent() + sortRecent() in
// dashboard/charts.js: newest-first default, every column sortable,
// measured vs modeled cost, status badges, per-row hover cards.
import { useMemo, useState } from "react";
import {
  costIsMeasured,
  displayCost,
  displayModel,
  fmt,
  speedText,
  stampLocal,
  statusColor,
  statusLabel,
  statusRank,
  vendorOf,
  whenStamp,
} from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TooltipRow } from "@/components/ui/tooltip-surface";
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
  return (
    <div className="grid gap-1.5">
      <div className="font-medium text-foreground">{displayModel(r.m)}</div>
      <div className="text-muted-foreground">{stampLocal(r.t)}</div>
      <div className="grid gap-1.5">
        <TooltipRow color="#fb923c" label="Input" value={fmt(r.i)} />
        <TooltipRow color="var(--accent)" label="Output" value={fmt(r.o)} />
        {(r.cr ?? 0) > 0 && <TooltipRow color="var(--dim)" label="Cache read" value={fmt(r.cr ?? 0)} />}
        {(r.cw ?? 0) > 0 && <TooltipRow color="var(--dim)" label="Cache write" value={fmt(r.cw ?? 0)} />}
        <TooltipRow color="var(--dim)" label="Elapsed" value={r.d !== undefined ? `${(r.d / 1000).toFixed(1)}s` : "–"} />
        <TooltipRow color="var(--dim)" label="Speed" value={r.d !== undefined ? `${tps < 10 ? tps.toFixed(1) : Math.round(tps)} tok/s` : "–"} />
        <TooltipRow color={statusColor(r.st)} label="Status" value={statusLabel(r)} />
        <TooltipRow color="var(--accent)" label={`Cost ${est ? "(est.)" : "(measured)"}`} value={`${est ? "~" : ""}${money(displayCost(r))}`} />
        {typeof r.usd === "number" && <TooltipRow color="var(--dim)" label="Charged" value={money(r.usd)} />}
      </div>
      {r.note && <div className="border-t pt-1.5 text-muted-foreground [overflow-wrap:break-word]">{r.note}</div>}
    </div>
  );
}

function StatusBadge({ r }: { r: RecentRequestRow }) {
  return (
    <Badge variant={r.st === "error" ? "destructive" : r.st === "aborted" ? "outline" : "success"}>
      {statusLabel(r)}
    </Badge>
  );
}

export function Recent({ data, money }: { data: UsageReport | null; money: (v: number) => string }) {
  const [page, setPage] = useState(1);
  const [per, setPer] = useState(15);
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

  const th = (label: string, key: Key, num?: boolean, explanation?: string): React.ReactNode => {
    const on = sort.key === key;
    const button = (
      <button
        type="button"
        className={`[all:unset] inline-flex! cursor-pointer! items-center! gap-[5px]! hover:text-ink focus-visible:rounded-[4px] focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent${num ? " float-right!" : ""}`}
        data-sort={key}
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
    );
    return (
      <TableHead aria-sort={on ? (sort.dir === 1 ? "ascending" : "descending") : "none"} className="sticky top-0 z-10 bg-panel">
        {explanation ? <HoverTip content={explanation}>{button}</HoverTip> : button}
      </TableHead>
    );
  };

  return (
    <Card
      data-reveal
      className="mt-8 translate-y-[26px] overflow-hidden border-line bg-panel opacity-0 transition-[opacity,transform] duration-700 ease-[cubic-bezier(.16,1,.3,1)] data-[reveal=in]:translate-y-0 data-[reveal=in]:opacity-100"
      style={{ scrollMarginTop: 90 }}
      aria-label="Recent requests"
    >
      <CardHeader>
        <div className="flex items-center gap-2">
          <Icon name="history" className="size-4" />
          <CardTitle className="font-display text-xl tracking-tight">Recent requests</CardTitle>
          <span className="mono ml-auto shrink-0 truncate text-xs text-dim">
            {rows.length ? `${rows.length} requests` : ""}
          </span>
        </div>
        <CardDescription className="mono text-xs text-dim">latest assistant messages · local time · sort any column · cost is measured when the host recorded it</CardDescription>
      </CardHeader>
      <CardContent>
      {rows.length > 0 ? (
        <Table className="mono table-fixed text-[13px]" id="recentTable">
            <colgroup><col /><col style={{ width: 96 }} /><col style={{ width: 96 }} /><col style={{ width: 120 }} /><col style={{ width: 116 }} /><col style={{ width: 120 }} /><col style={{ width: 158 }} /></colgroup>
            <TableHeader className="[&_tr]:text-left [&_tr]:text-[11px] [&_tr]:uppercase [&_tr]:tracking-[0.14em] [&_tr]:text-dim">
              <TableRow>
                {th("Model", "model")}
                {th("Input", "input", true)}
                {th("Output", "output", true)}
                {th("Time", "time", true, "Elapsed time with the model / output token speed")}
                {th("Status", "status")}
                {th("Cost", "cost", true)}
                {th("When", "when", true, "Local timestamp: month day, hour:minute:second")}
              </TableRow>
            </TableHeader>
            <TableBody>
              {slice.map((r, i) => {
                const v = vendorOf(r.m);
                const measured = costIsMeasured(r);
                return (
                  <HoverTip key={`${r.t}-${i}`} content={<RecentTip r={r} money={money} />}>
                    <TableRow className="cursor-pointer hover:bg-track hover:shadow-tersio">
                      <TableCell className="min-w-0 truncate py-2.5 pr-3">
                        <span className="mr-2 inline-block size-2 rounded-full" style={{ background: v.color }} />
                        {displayModel(r.m)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap py-2.5 pr-3 text-right text-[#fb923c]">
                        {fmt(r.i)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap py-2.5 pr-3 text-right text-accent">
                        {fmt(r.o)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap py-2.5 pr-3 text-right text-dim">
                        {speedText(r)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap py-2.5 pr-3">
                        <StatusBadge r={r} />
                      </TableCell>
                      <TableCell
                        className={`whitespace-nowrap py-2.5 pr-3 text-right ${measured ? "text-ink" : "text-dim"}`}
                      >
                        {(measured ? "" : "~") + money(displayCost(r))}
                      </TableCell>
                      <TableCell className="whitespace-nowrap py-2.5 text-right text-dim">
                        {whenStamp(r.t)}
                      </TableCell>
                    </TableRow>
                  </HoverTip>
                );
              })}
            </TableBody>
          </Table>
      ) : (
        <EmptyState icon="inbox" title="No requests yet" desc="Recent assistant messages will show here once sessions report tokens." />
      )}
        </CardContent>
        <CardFooter className="mono justify-between gap-4 border-t text-xs text-dim">
          <span>{range}</span>
          <div className="flex items-center gap-4">
            <PerPage options={[10, 15, 25, 50]} value={per} onPick={(n) => { setPer(n); setPage(1); }} label="Requests per page" />
            <PageButtons pages={pages} page={p} onPick={setPage} label="Recent pages" />
          </div>
        </CardFooter>
      </Card>
  );
}
