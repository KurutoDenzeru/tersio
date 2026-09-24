// Top models + Models table + model detail dialog. Ports renderModels(),
// renderModelDialog(), mdAreaChart(), mdBars(), mdDonut() and the tooltip
// builders in dashboard/charts.js. Shadcn Card/Table/Dialog structure;
// the SVG area chart, bars, and donut keep the original shadcn chart
// language (gradient area, dashed grid, rounded bars, padded donut).
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import {
  displayModel,
  fmt,
  fmtShort,
  modelTotal,
  shortName,
  topModels,
  vendorOf,
} from "@/lib/format";
import type { UsageReport } from "@/lib/data";
import { Brandmark } from "./brand";
import { EmptyState, HoverTip, PageButtons, PerPage, usePager } from "./common";
import { Icon } from "./icon";

function ModelTip({ m, data, money }: { m: string; data: UsageReport; money: (v: number) => string }) {
  const b = data.byModel[m] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const req = data.byModelMessages[m] ?? 0;
  const denom = b.input + b.cacheRead;
  const hit = denom ? `${((b.cacheRead / denom) * 100).toFixed(1)}%` : "-";
  const total = b.input + b.output + b.cacheRead + b.cacheWrite;
  const cb = data.byModelBucketUsd[m] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const row = (color: string, k: string, v: string): React.ReactNode => (
    <div className="tr">
      <span className="sw" style={{ background: color }} />
      <span className="tn">{k}</span>
      <span className="tvr">{v}</span>
    </div>
  );
  return (
    <div className="mono">
      <div className="tt">{shortName(m)}</div>
      <div className="tv">
        {fmtShort(total)} total ({money(cb.input + cb.output + cb.cacheRead + cb.cacheWrite)})
      </div>
      {row("var(--accent)", "input", `${fmt(b.input)} (${money(cb.input)})`)}
      {row("var(--dim)", "output", `${fmt(b.output)} (${money(cb.output)})`)}
      {b.cacheRead > 0 && row("var(--dim)", "cache read", `${fmt(b.cacheRead)} (${money(cb.cacheRead)})`)}
      {b.cacheWrite > 0 && row("var(--dim)", "cache write", `${fmt(b.cacheWrite)} (${money(cb.cacheWrite)})`)}
      {row("var(--dim)", "requests", fmt(req))}
      {row("var(--dim)", "cache hit", hit)}
    </div>
  );
}

type Span = "30" | "90" | "all";

function seriesFor(data: UsageReport, m: string): Array<{ day: string; v: number }> {
  const days = Array.from(
    new Set([...Object.keys(data.byDay ?? {}), ...Object.keys(data.byDayModel ?? {})]),
  ).sort();
  const per = data.byDayModel ?? {};
  return days.map((d) => ({ day: d, v: per[d]?.[m] ?? 0 }));
}

function AreaChart({ vals, days }: { vals: number[]; days: string[] }) {
  const W = 560;
  const H = 190;
  const max = Math.max(1, ...vals);
  const step = vals.length > 1 ? (W - 16) / (vals.length - 1) : 0;
  const X = (i: number): number => 8 + i * step;
  const Y = (p: number): number => 14 + (1 - p / max) * (H - 36);
  const d = vals.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(p).toFixed(1)}`).join(" ");
  const last = vals.length ? { x: X(vals.length - 1), y: Y(vals[vals.length - 1]) } : { x: 8, y: H - 22 };
  const [hover, setHover] = useState<number | null>(null);
  const shortDay = (day: string): string =>
    new Date(`${day}T12:00:00`).toLocaleString("en-US", { month: "short", day: "numeric" });
  return (
    <div className="relative">
      <svg
        id="mdSpark"
        viewBox="0 0 560 190"
        preserveAspectRatio="none"
        aria-hidden="true"
        style={{ width: "100%", height: 190, display: "block" }}
        onMouseMove={(ev) => {
          const r = (ev.target as SVGElement).ownerSVGElement?.getBoundingClientRect();
          if (!r || !vals.length) return;
          const fx = ((ev.clientX - r.left) / r.width) * W;
          setHover(Math.max(0, Math.min(vals.length - 1, Math.round((fx - 8) / (step || 1)))));
        }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="mdGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: "var(--accent)", stopOpacity: 0.32 }} />
            <stop offset="1" style={{ stopColor: "var(--accent)", stopOpacity: 0.02 }} />
          </linearGradient>
        </defs>
        {[1, 2, 3].map((i) => {
          const y = 14 + ((H - 36) * i) / 3;
          return <line key={i} className="grid" x1="8" y1={y} x2={W - 8} y2={y} strokeDasharray="3 4" />;
        })}
        {vals.length > 0 && <path className="area" d={`${d} L${last.x.toFixed(1)} ${H - 22} L8 ${H - 22} Z`} />}
        {vals.length > 0 && <path className="line" d={d} strokeWidth="2.5" />}
        {vals.length > 0 && <circle className="dot" cx={last.x} cy={last.y} r="5" />}
        {hover !== null && vals.length > 0 && <circle className="hoverdot" cx={X(hover)} cy={Y(vals[hover])} r="5" />}
      </svg>
      {hover !== null && vals.length > 0 && (
        <div className="md-tip mono" style={{ display: "block", left: `${(X(hover) / W) * 100}%`, top: 8, transform: "translate(-50%, 0)" }}>
          <div className="tt">{shortDay(days[hover])}</div>
          <div className="tv">{fmtShort(vals[hover])} tokens</div>
        </div>
      )}
    </div>
  );
}

function Bars({ vals, days }: { vals: number[]; days: string[] }) {
  const max = Math.max(1, ...vals);
  const shortDay = (day: string): string =>
    new Date(`${day}T12:00:00`).toLocaleString("en-US", { month: "short", day: "numeric" });
  const n = vals.length;
  const bucket = n > 90 ? Math.ceil(n / 90) : 1;
  const bars: Array<{ avg: number; sum: number; day: string; top: boolean }> = [];
  for (let i = 0; i < n; i += bucket) {
    let sum = 0;
    let c = 0;
    for (let j = i; j < Math.min(n, i + bucket); j++) {
      sum += vals[j];
      c++;
    }
    bars.push({ avg: sum / c, sum, day: days[i], top: false });
  }
  const peak = Math.max(0, ...bars.map((b) => b.avg));
  bars.forEach((b) => {
    b.top = b.avg > 0 && b.avg === peak;
  });
  return (
    <div className="md-bars" aria-hidden="true">
      {bars.map((b, i) => (
        <HoverTip
          key={i}
          content={
            <div className="mono">
              <div className="tt">{shortDay(b.day)}</div>
              <div className="tv">{fmtShort(Math.round(b.sum))} tokens</div>
            </div>
          }
        >
          <span
            className={b.avg === 0 ? "zero" : b.top ? "top" : undefined}
            style={{ height: `${Math.max(b.avg ? 5 : 2, Math.round((b.avg / max) * 100))}%` }}
          />
        </HoverTip>
      ))}
    </div>
  );
}

function Donut({ parts }: { parts: Array<{ label: string; v: number; color: string }> }) {
  const r = 54;
  const C = 2 * Math.PI * r;
  const total = parts.reduce((a, p) => a + p.v, 0) || 1;
  const live = parts.filter((p) => p.v > 0);
  const gap = live.length > 1 ? 4 : 0;
  let off = 0;
  const segs = parts.flatMap((p) => {
    const len = (p.v / total) * C;
    if (len <= 0) return [];
    const el = (
      <circle
        key={p.label}
        cx="70"
        cy="70"
        r={r}
        style={{ stroke: p.color }}
        strokeDasharray={`${Math.max(len - gap, 0.5).toFixed(1)} ${(C - len + gap).toFixed(1)}`}
        strokeDashoffset={(-off - gap / 2).toFixed(1)}
        strokeLinecap="butt"
      />
    );
    off += len;
    return [el];
  });
  return (
    <div>
      <div className="md-donut-wrap">
        <svg id="mdMix" viewBox="0 0 140 140" aria-hidden="true" style={{ width: 150, height: 150, display: "block", transform: "rotate(-90deg)" }}>
          <circle className="tk" cx="70" cy="70" r={r} />
          {segs}
        </svg>
        <div className="md-donut-center">
          <p className="mono">{fmtShort(total)}</p>
        </div>
      </div>
      <div className="md-legend mono">
        {live.map((p) => (
          <div key={p.label} className="row" title={`${fmtShort(p.v)} (${((p.v / total) * 100).toFixed(1)}%)`}>
            <span className="dot" style={{ background: p.color }} />
            <span>{p.label}</span>
            <span className="pct">
              {((p.v / total) * 100).toFixed(1)}% · {fmtShort(p.v)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function monthTicks(days: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  days.forEach((d) => {
    const t = d.slice(0, 7);
    if (!seen.has(t)) {
      seen.add(t);
      out.push(new Date(`${d}T12:00:00`).toLocaleString("en-US", { month: "short" }));
    }
  });
  return out.slice(-6);
}

function ModelDialog({ m, data, money, onClose }: { m: string | null; data: UsageReport; money: (v: number) => string; onClose: () => void }) {
  const [span, setSpan] = useState<Span>("all");
  if (!m) return null;
  const byModel = data.byModel;
  const tops = topModels(byModel, Object.keys(byModel).length);
  const rank = tops.indexOf(m) + 1;
  const b = byModel[m] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const total = modelTotal(byModel, m);
  const grand = 1 + tops.reduce((a, k) => a + modelTotal(byModel, k), 0);
  const v = vendorOf(m);
  const req = data.byModelMessages[m] ?? 0;
  const usd = data.byModelUsd[m] ?? 0;
  const denom = b.input + b.cacheRead;
  const hit = denom ? (b.cacheRead / denom) * 100 : 0;
  const full = seriesFor(data, m);
  const sliced = span === "all" ? full : full.slice(Math.max(0, full.length - Number(span)));
  const days = sliced.map((p) => p.day);
  const vals = sliced.map((p) => p.v);
  const active = vals.filter((x) => x > 0).length;
  const trend = (() => {
    const all = full.map((p) => p.v);
    if (all.length < 14) {
      const peak = Math.max(0, ...all);
      return peak ? { t: `peak ${fmtShort(peak)} in a day`, up: true } : { t: "no activity yet", up: false };
    }
    const a = all.slice(-14).reduce((x, y) => x + y, 0);
    const bb = all.slice(Math.max(0, all.length - 28), all.length - 14).reduce((x, y) => x + y, 0);
    if (!bb) return { t: `${fmtShort(a)} / 2 wks`, up: a > 0 };
    const pct = ((a - bb) / bb) * 100;
    return { t: `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}% vs prior 2 wks`, up: pct >= 0 };
  })();
  const range = days.length
    ? `${new Date(`${days[0]}T12:00:00`).toLocaleString("en-US", { month: "short", day: "numeric" }).toUpperCase()} → ${new Date(`${days[days.length - 1]}T12:00:00`).toLocaleString("en-US", { month: "short", day: "numeric" }).toUpperCase()}`
    : "–";
  const kpi = (k: string, val: string, d: string, up: boolean): React.ReactNode => (
    <div className="md-kpi">
      <p className="k mono">{k}</p>
      <p className="v">{val}</p>
      <p className={`d mono ${up ? "up" : "flat"}`}>{d}</p>
    </div>
  );
  const stat = (k: string, val: string, s?: string): React.ReactNode => (
    <div className="md-stat">
      <p className="k mono">{k}</p>
      <p className="v mono">{val}</p>
      {s && <p className="s mono">{s}</p>}
    </div>
  );
  return (
    <Dialog open={m !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="dlg mdlg max-w-none" showCloseButton={false} aria-describedby={undefined}>
        <DialogHeader className="dlg-head">
          <div className="min-w-0 flex items-center gap-3">
            <Brandmark model={m} />
            <div className="min-w-0">
              <DialogTitle className="dlg-title truncate" title={m}>
                {displayModel(m)}
              </DialogTitle>
              <p className="dlg-desc mono">
                {v.name} · {fmt(req)} requests · {((total / grand) * 100).toFixed(1)}% of volume
              </p>
            </div>
          </div>
          <span className="md-rankpill mono">#{rank ? String(rank).padStart(2, "0") : "–"}</span>
        </DialogHeader>
        <div className="md-body">
          <div className="md-kpis">
            {kpi("Tokens", fmtShort(total), range, true)}
            {kpi("Spend", money(usd), req ? `${money(usd / req)} / req` : "no requests", usd > 0)}
            {kpi("Cache hit", `${hit.toFixed(0)}%`, `${fmtShort(b.cacheRead)} cached`, hit >= 50)}
            {kpi("Requests", fmt(req), `${active} active days`, active > 0)}
          </div>
          <div className="md-chart">
            <div className="md-chart-head">
              <div className="min-w-0">
                <p className="md-chart-title">Token volume</p>
                <p className="md-chart-sub mono">{range}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={`md-trend mono${trend.up ? " up" : ""}`}>{trend.t}</span>
                <span className="seg mono text-xs flex items-center gap-1 p-1 rounded-[10px]" style={{ border: "1px solid var(--line)" }} role="group" aria-label="Chart range">
                  {(["30", "90", "all"] as Span[]).map((s) => (
                    <button key={s} type="button" role="button" className={`px-2.5 py-1${span === s ? " on" : ""}`} onClick={() => setSpan(s)}>
                      {s === "all" ? "ALL" : `${s}D`}
                    </button>
                  ))}
                </span>
              </div>
            </div>
            <AreaChart vals={vals} days={days} />
            <div className="md-months mono" aria-hidden="true">
              {monthTicks(days).map((t, i) => (
                <span key={i}>{t}</span>
              ))}
            </div>
          </div>
          <div className="md-cols">
            <div className="md-chart">
              <div className="md-chart-head">
                <div className="min-w-0">
                  <p className="md-chart-title">Daily activity</p>
                  <p className="md-chart-sub mono">tokens per day</p>
                </div>
                <span className={`md-trend mono${active ? " up" : ""}`}>
                  {active} / {days.length} days
                </span>
              </div>
              <Bars vals={vals} days={days} />
              <div className="md-months mono" aria-hidden="true">
                {monthTicks(days).map((t, i) => (
                  <span key={i}>{t}</span>
                ))}
              </div>
            </div>
            <div className="md-chart">
              <div className="md-chart-head">
                <div className="min-w-0">
                  <p className="md-chart-title">Token mix</p>
                  <p className="md-chart-sub mono">input vs output vs cache</p>
                </div>
              </div>
              <Donut
                parts={[
                  { label: "Input", v: b.input, color: "var(--accent)" },
                  { label: "Output", v: b.output, color: "#818cf8" },
                  { label: "Cache read", v: b.cacheRead, color: "#22d3ee" },
                  { label: "Cache write", v: b.cacheWrite, color: "var(--dim)" },
                ]}
              />
            </div>
          </div>
          <div className="md-grid">
            {stat("Input", fmtShort(b.input))}
            {stat("Output", fmtShort(b.output))}
            {stat("Cache read", fmtShort(b.cacheRead), `${hit.toFixed(0)}% hit`)}
            {stat("Cache write", fmtShort(b.cacheWrite))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function Models({ data, money }: { data: UsageReport | null; money: (v: number) => string }) {
  const [open, setOpen] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [per, setPer] = useState(10);
  const byModel = data?.byModel ?? {};
  const tops = useMemo(
    () => topModels(byModel, Object.keys(byModel).length).filter((m) => modelTotal(byModel, m) > 0),
    [byModel],
  );
  const max = Math.max(1, ...tops.map((m) => modelTotal(byModel, m)));
  const { pages, page: p, range } = usePager(tops.length, per, page);
  const rows = tops.slice((p - 1) * per, p * per);

  return (
    <>
      <section className="mt-8 modelsSection" aria-label="Top models">
        <div className="flex items-center gap-2 mb-1">
          <Icon name="cpu" className="size-4" />
          <h2 className="display font-bold tracking-tight text-xl truncate min-w-0">Top models</h2>
          <span className="mono text-xs ml-auto" style={{ color: "var(--dim)" }}>
            usage across sessions
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {tops.length === 0 && (
            <div className="empty md:col-span-3">
              <EmptyState icon="boxes" title="No models yet" desc="Model token totals will appear here once sessions report tokens." />
            </div>
          )}
          {tops.slice(0, 3).map((m, i) => {
            const v = vendorOf(m);
            return (
              <HoverTip key={m} content={data ? <ModelTip m={m} data={data} money={money} /> : "–"}>
                <Card
                  role="button"
                  tabIndex={0}
                  onClick={() => setOpen(m)}
                  onKeyDown={(e) => e.key === "Enter" && setOpen(m)}
                  className="modelcard relative p-4 rounded-xl overflow-hidden"
                  style={{ borderColor: "var(--line)", background: "var(--panel)", cursor: "pointer" }}
                >
                  <p className="mono text-xs mb-3" style={{ color: "var(--dim)" }}>
                    0{i + 1}
                  </p>
                  <div className="flex items-center gap-3">
                    <Brandmark model={m} />
                    <div className="min-w-0 flex-1">
                      <p className="mono text-sm font-bold truncate" title={m}>
                        {displayModel(m)}
                      </p>
                      <p className="mono text-xs truncate" style={{ color: "var(--dim)" }}>
                        {v.name}
                      </p>
                    </div>
                    <p className="mono font-bold text-lg shrink-0">{fmtShort(modelTotal(byModel, m))}</p>
                  </div>
                </Card>
              </HoverTip>
            );
          })}
        </div>
      </section>

      <section className="rise mt-8 rounded-xl p-5 overflow-hidden flex flex-col modelsSection" style={{ border: "1px solid var(--line)", background: "var(--panel)" }} aria-label="All models">
        <div className="flex items-center gap-2 mb-1">
          <Icon name="layers" className="size-4" />
          <h2 className="display font-bold tracking-tight text-xl truncate min-w-0">Models</h2>
          <span className="mono text-xs ml-auto truncate shrink-0" style={{ color: "var(--dim)" }}>
            {tops.length ? `${tops.length} models` : ""}
          </span>
        </div>
        <p className="mono text-xs mb-4" style={{ color: "var(--dim)" }}>
          ranked by tokens / top 10
        </p>
        {tops.length > 0 ? (
          <div className="scrollarea">
            <Table>
              <TableBody>
                {rows.map((m) => {
                  const mv = modelTotal(byModel, m);
                  return (
                    <HoverTip key={m} content={data ? <ModelTip m={m} data={data} money={money} /> : "–"}>
                      <TableRow className="mrow cursor-pointer" onClick={() => setOpen(m)}>
                        <TableCell>
                          <Brandmark model={m} small />
                        </TableCell>
                        <TableCell className="min-w-0">
                          <p className="mono text-sm truncate" title={m}>
                            {displayModel(m)}
                          </p>
                          <div className="bar-track mt-1.5 h-1.5 overflow-hidden">
                            <div className="bar-fill h-full" style={{ width: `${Math.round((mv / max) * 100)}%` }} />
                          </div>
                        </TableCell>
                        <TableCell className="shrink-0 text-right">
                          <p className="mono font-bold">{fmt(mv)}</p>
                          <p className="mono text-xs" style={{ color: "var(--dim)" }}>
                            {money(data?.byModelUsd[m] ?? 0)}
                          </p>
                        </TableCell>
                      </TableRow>
                    </HoverTip>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState icon="boxes" title="No models yet" desc="Model token totals will appear here once sessions report tokens." />
        )}
        <div className="mono text-xs mt-4 pt-4 flex flex-wrap items-center gap-x-4 gap-y-3 mt-auto" style={{ color: "var(--dim)", borderTop: "1px solid var(--line)" }}>
          <span>{range}</span>
          <PerPage options={[10, 15, 25, 50]} value={per} onPick={(n) => { setPer(n); setPage(1); }} label="Models per page" />
          <PageButtons pages={pages} page={p} onPick={setPage} label="Model pages" />
        </div>
      </section>

      {data && <ModelDialog m={open} data={data} money={money} onClose={() => setOpen(null)} />}
    </>
  );
}
