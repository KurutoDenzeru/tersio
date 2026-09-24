// Activity heatmap. Port of renderGraph() + bindGraphTabs() in
// dashboard/charts.js: trailing 12-month grid, Daily/Weekly/Cumulative
// modes, per-cell model breakdown tooltips, month labels. Shadcn Tooltip
// carries the hover cards.
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { PALETTE, dateHead, dayKey, dayTotal, fmtShort, mondayKey, topModels } from "@/lib/format";
import type { TokenBreakdown } from "@/lib/format";
import type { UsageReport } from "@/lib/data";
import { EmptyState, HoverTip, SegTabs } from "./common";
import { Icon } from "./icon";

type Mode = "daily" | "weekly" | "cumulative";

function dayRows(byDayModel: Record<string, Record<string, number>>, byModel: Record<string, TokenBreakdown>, key: string): Array<[string, number, string]> {
  const per = byDayModel[key] ?? {};
  const tops = topModels(byModel, 8);
  const rows: Array<[string, number, string]> = [];
  tops.forEach((m, i) => {
    const v = per[m] ?? 0;
    if (v) rows.push([m, v, PALETTE[i % PALETTE.length]]);
  });
  let other = 0;
  Object.keys(per).forEach((m) => {
    if (!tops.includes(m)) other += per[m];
  });
  if (other) rows.push(["Other", other, "var(--dim)"]);
  return rows;
}

function TipBody({ title, total, rows }: { title: string; total: number; rows: Array<[string, number, string]> }) {
  return (
    <div className="mono">
      <div className="tt">{title}</div>
      <div className="tv">{fmtShort(total)} total</div>
      {rows.map(([m, v, c]) => (
        <div key={m} className="tr">
          <span className="sw" style={{ background: c }} />
          <span className="tn">{m.length > 22 ? `${m.slice(0, 21)}...` : m}</span>
          <span className="tvr">{fmtShort(v)}</span>
        </div>
      ))}
    </div>
  );
}

export function Activity({ data }: { data: UsageReport | null }) {
  const [mode, setMode] = useState<Mode>("daily");
  const byDay = data?.byDay ?? {};
  const byDayModel = data?.byDayModel ?? {};
  const byModel = data?.byModel ?? {};

  const grid = useMemo(() => {
    const sums: Record<string, number> = {};
    Object.keys(byDay).forEach((d) => {
      sums[d] = dayTotal(byDay[d]);
    });
    const hasData = Object.keys(sums).some((k) => sums[k] > 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(start.getDate() - 52 * 7 - today.getDay());
    const dayKeys: string[] = [];
    for (let w = 0; w < 53; w++)
      for (let i = 0; i < 7; i++) {
        const dd = new Date(start);
        dd.setDate(dd.getDate() + w * 7 + i);
        dayKeys.push(dayKey(dd));
      }
    const weekTotal: Record<string, number> = {};
    const weekPer: Record<string, Record<string, number>> = {};
    const cellVal: Record<string, number> = {};
    let run = 0;
    dayKeys.forEach((k) => {
      if (mode === "weekly") {
        const dt = new Date(`${k}T12:00:00`);
        if (!isNaN(+dt)) {
          const mk = mondayKey(dt);
          weekTotal[mk] = (weekTotal[mk] || 0) + (sums[k] || 0);
          const per = byDayModel[k] ?? {};
          weekPer[mk] = weekPer[mk] ?? {};
          Object.keys(per).forEach((m) => {
            weekPer[mk][m] = (weekPer[mk][m] || 0) + per[m];
          });
        }
      }
      if (mode === "cumulative") {
        run += sums[k] || 0;
        cellVal[k] = run;
      }
    });
    let max = 1;
    if (mode === "weekly") Object.keys(weekTotal).forEach((k) => (max = Math.max(max, weekTotal[k])));
    else if (mode === "cumulative") max = Math.max(1, run);
    else Object.keys(sums).forEach((k) => (max = Math.max(max, sums[k])));

    const weeks: Array<{ cells: Array<{ key: string; v: number; title: string; total: number; rows: Array<[string, number, string]> }>; month: string }> = [];
    let lastMonth = "";
    for (let w = 0; w < 53; w++) {
      const cells: Array<{ key: string; v: number; title: string; total: number; rows: Array<[string, number, string]> }> = [];
      let month = "";
      for (let i = 0; i < 7; i++) {
        const cdt = new Date(start);
        cdt.setDate(cdt.getDate() + w * 7 + i);
        const key = dayKey(cdt);
        let v = 0;
        let title = key;
        let total = 0;
        let rows: Array<[string, number, string]> = [];
        if (mode === "weekly") {
          const mk = mondayKey(cdt);
          v = weekTotal[mk] || 0;
          const mon = new Date(`${mk}T12:00:00`);
          const sun = new Date(mon);
          sun.setDate(mon.getDate() + 6);
          title = `${mon.toLocaleString("en-US", { month: "short", day: "numeric" }).toUpperCase()} - ${sun.toLocaleString("en-US", { month: "short", day: "numeric" }).toUpperCase()}`;
          total = v;
          const tops = topModels(byModel, 8);
          tops.forEach((m, mi) => {
            const vv = weekPer[mk]?.[m] ?? 0;
            if (vv) rows.push([m, vv, PALETTE[mi % PALETTE.length]]);
          });
        } else if (mode === "cumulative") {
          v = cellVal[key] || 0;
          title = `THROUGH ${dateHead(key)}`;
          total = v;
          rows = dayRows(byDayModel, byModel, key);
        } else {
          v = sums[key] || 0;
          total = v;
          rows = dayRows(byDayModel, byModel, key);
        }
        cells.push({ key, v, title, total, rows: rows.length ? rows : [["no activity", 0, "var(--dim)"]] });
        if (i === 0) {
          const mm = cdt.toLocaleString("en-US", { month: "short" });
          month = mm !== lastMonth ? mm : "";
          lastMonth = mm;
        }
      }
      weeks.push({ cells, month });
    }
    return { hasData, weeks, start: dayKey(start), today: dayKey(today) };
  }, [byDay, byDayModel, byModel, mode]);

  const cap = mode === "weekly" ? "weekly totals / trailing 12 months" : mode === "cumulative" ? "running total / trailing 12 months" : "daily values / trailing 12 months";

  return (
    <section id="activity" className="rise mt-8" style={{ scrollMarginTop: 90 }} aria-label="Activity graph">
      <div className="flex items-center gap-2 mb-1">
        <Icon name="calendar-days" className="size-4" />
        <h2 className="display font-bold tracking-tight text-xl truncate min-w-0">Activity</h2>
        <SegTabs options={["daily", "weekly", "cumulative"] as Mode[]} value={mode} onPick={setMode} label="Graph range" />
      </div>
      <p className="mono text-xs mb-4 truncate" style={{ color: "var(--dim)" }}>
        <span>
          {grid.hasData ? `${grid.start} to ${grid.today}` : ""}
        </span>{" "}
        · <span>{grid.hasData ? cap : "no data in trailing 12 months"}</span>
      </p>
      <Card className="rounded-xl p-5 overflow-hidden" style={{ borderColor: "var(--line)", background: "var(--panel)" }}>
        {grid.hasData ? (
          <>
            <div className="pb-1">
              <div className="grid w-full" style={{ gridTemplateColumns: "repeat(53, minmax(0, 1fr))", gap: 3 }}>
                {grid.weeks.map((w, wi) => (
                  <div key={wi} style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                    {w.cells.map((c) => {
                      return (
                        <HoverTip key={c.key} content={<TipBody title={c.title} total={c.total} rows={c.rows} />}>
                          <span className={cellClass(c.v, maxOf(grid.weeks))} style={{ cursor: "default" }} />
                        </HoverTip>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
            <div className="mono text-[11px] mt-3 flex items-center gap-1.5" style={{ color: "var(--dim)" }}>
              <span>less</span>
              <span className="cell key" />
              <span className="cell key l1" />
              <span className="cell key l2" />
              <span className="cell key l3" />
              <span className="cell key l4" />
              <span>more</span>
            </div>
            <div className="heatmonth mono mt-2 grid w-full" style={{ color: "var(--dim)", gridTemplateColumns: "repeat(53, minmax(0, 1fr))", gap: 3 }}>
              {grid.weeks.map((w, wi) => (
                <span key={wi} style={{ minWidth: 0, overflow: "visible", whiteSpace: "nowrap" }}>
                  {w.month}
                </span>
              ))}
            </div>
          </>
        ) : (
          <EmptyState icon="calendar-x" title="No activity yet" desc="Daily token activity will chart here once sessions report tokens." />
        )}
      </Card>
    </section>
  );
}

function maxOf(weeks: Array<{ cells: Array<{ v: number }> }>): number {
  let max = 1;
  weeks.forEach((w) => w.cells.forEach((c) => (max = Math.max(max, c.v))));
  return max;
}

function cellClass(v: number, max: number): string {
  if (!v) return "cell";
  const lvl = Math.min(4, 1 + Math.floor((v / max) * 3.99));
  return `cell l${lvl}`;
}
