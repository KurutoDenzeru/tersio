// Top models + Models table + model detail dialog. Ports renderModels(),
// renderModelDialog(), mdAreaChart(), mdDonut() and the tooltip builders in
// dashboard/charts.js. Shadcn Card/Dialog structure; the area chart and donut
// keep the original shadcn chart language (gradient area, dashed grid, and
// padded donut).
import { useMemo, useState } from "react";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { TooltipRow } from "@/components/ui/tooltip-surface";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Area, AreaChart as RechartsArea, Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import {
  displayModel,
  fmt,
  fmtShort,
  modelTotal,
  topModels,
  vendorOf,
} from "@/lib/format";
import type { UsageReport } from "@/lib/data";
import { BrandSilhouette, Brandmark } from "./brand";
import { EmptyState, HoverTip, PageButtons, PerPage, usePager } from "./common";
import { Icon } from "./icon";

function ModelTip({ m, data, money }: { m: string; data: UsageReport; money: (v: number) => string }) {
  const b = data.byModel[m] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const req = data.byModelMessages[m] ?? 0;
  const denom = b.input + b.cacheRead;
  const hit = denom ? `${((b.cacheRead / denom) * 100).toFixed(1)}%` : "-";
  const total = b.input + b.output + b.cacheRead + b.cacheWrite;
  const cb = data.byModelBucketUsd[m] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  return (
    <div className="grid gap-1.5">
      <div className="font-medium text-foreground">{displayModel(m)}</div>
      <div className="text-muted-foreground">
        {fmtShort(total)} total · {money(cb.input + cb.output + cb.cacheRead + cb.cacheWrite)}
      </div>
      <div className="grid gap-1.5">
        <TooltipRow color="var(--accent)" label="Input" value={`${fmt(b.input)} (${money(cb.input)})`} />
        <TooltipRow color="var(--dim)" label="Output" value={`${fmt(b.output)} (${money(cb.output)})`} />
        {b.cacheRead > 0 && <TooltipRow color="var(--dim)" label="Cache read" value={`${fmt(b.cacheRead)} (${money(cb.cacheRead)})`} />}
        {b.cacheWrite > 0 && <TooltipRow color="var(--dim)" label="Cache write" value={`${fmt(b.cacheWrite)} (${money(cb.cacheWrite)})`} />}
        <TooltipRow color="var(--dim)" label="Requests" value={fmt(req)} />
        <TooltipRow color="var(--dim)" label="Cache hit" value={hit} />
      </div>
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

function shortDay(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleString("en-US", { month: "short", day: "numeric" });
}

// Token volume as a shadcn chart (recharts under ChartContainer): gradient
// area, dashed horizontals only, end dot, custom hover card. Same language
// as the original mdAreaChart().
function AreaChart({ vals, days }: { vals: number[]; days: string[] }) {
  const chartData = vals.map((v, i) => ({ day: days[i], tokens: v }));
  return (
    <ChartContainer
      config={{ tokens: { label: "Tokens", color: "var(--accent)" } }}
      className="h-[190px] w-full"
    >
      <RechartsArea data={chartData} margin={{ top: 14, right: 8, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id="mdGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: "var(--accent)", stopOpacity: 0.32 }} />
            <stop offset="1" style={{ stopColor: "var(--accent)", stopOpacity: 0.02 }} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 4" />
        <XAxis dataKey="day" hide />
        <YAxis hide domain={[0, "dataMax"]} />
        <ChartTooltip
          cursor={{ stroke: "var(--line)" }}
          content={
            <ChartTooltipContent
              labelFormatter={(label) => typeof label === "string" ? shortDay(label) : String(label)}
              formatter={(value) => (
                <>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-[2px] bg-accent" />
                  Tokens
                  <span className="ml-auto font-mono font-medium text-foreground tabular-nums">
                    {fmtShort(Number(value))} <span className="font-normal text-muted-foreground">tokens</span>
                  </span>
                </>
              )}
            />
          }
        />
        <Area
          dataKey="tokens"
          type="monotone"
          fill="url(#mdGrad)"
          stroke="var(--accent)"
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 5, fill: "var(--accent)", stroke: "var(--panel)", strokeWidth: 2 }}
          isAnimationActive={false}
        />
      </RechartsArea>
    </ChartContainer>
  );
}

function TokenMixChart({ parts }: { parts: Array<{ label: string; v: number; color: string }> }) {
  const total = parts.reduce((sum, part) => sum + part.v, 0) || 1;
  const data = parts.map((part) => ({
    ...part,
    share: total ? (part.v / total) * 100 : 0,
  }));
  const config: ChartConfig = Object.fromEntries(parts.map((part) => [part.label, { label: part.label, color: part.color }]));
  return (
    <div className="grid gap-3">
      <ChartContainer config={config} className="h-[150px] w-full">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 8 }} accessibilityLayer>
          <CartesianGrid horizontal={false} stroke="var(--line)" strokeDasharray="3 4" />
          <XAxis type="number" domain={[0, 100]} hide />
          <YAxis
            type="category"
            dataKey="label"
            axisLine={false}
            tickLine={false}
            width={88}
            tick={{ fill: "var(--dim)", fontSize: 11, fontFamily: "var(--font-mono)" }}
          />
          <ChartTooltip
            cursor={{ fill: "var(--track)", opacity: 0.4 }}
            content={
              <ChartTooltipContent
                labelFormatter={(label) => String(label)}
                formatter={(value, name, item) => {
                  const part = item?.payload as { v: number; color: string; label: string } | undefined;
                  return (
                    <>
                      <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: part?.color }} />
                      {part?.label ?? name}
                      <span className="ml-auto font-mono font-medium text-foreground tabular-nums">
                        {fmtShort(part?.v ?? 0)} <span className="font-normal text-muted-foreground">({Number(value).toFixed(1)}%)</span>
                      </span>
                    </>
                  );
                }}
              />
            }
          />
          <Bar dataKey="share" radius={[0, 6, 6, 0]} isAnimationActive={false}>
            {data.map((part) => (
              <Cell key={part.label} fill={part.v > 0 ? part.color : "var(--track)"} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
      <div className="grid grid-cols-2 gap-x-5 gap-y-2 text-[11px]">
        {data.map((part) => (
          <div key={part.label} className="flex min-w-0 items-center gap-2">
            <span className="size-2 shrink-0 rounded-full" style={{ background: part.color }} />
            <span className="truncate text-dim">{part.label}</span>
            <span className="ml-auto font-mono tabular-nums text-foreground">{part.share.toFixed(1)}%</span>
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
  const kpi = (k: string, val: string, detail: string, up: boolean): React.ReactNode => (
    <Card size="sm" className="gap-0 bg-panel [--card-spacing:--spacing(3.5)]">
      <CardHeader>
        <CardTitle className="mono text-[10px] tracking-[.14em] text-dim uppercase">{k}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="m-0 text-[22px] font-extrabold tracking-[-0.02em] tabular-nums">{val}</p>
        <p className={`mt-[2px] mb-0 text-[11px] tabular-nums mono ${up ? "text-accent" : "text-dim"}`}>{detail}</p>
      </CardContent>
    </Card>
  );
  return (
    <Dialog open={m !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[min(880px,calc(100vw-32px))] max-w-[calc(100vw-2rem)] sm:max-w-[880px] [max-height:min(88vh,960px)] flex flex-col overflow-hidden border border-line bg-panel p-0 text-ink gap-0" showCloseButton={false} aria-describedby={undefined}>
        <div className="shrink-0 border-b border-line px-5 pb-4 pt-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Brandmark model={m} />
              <div className="min-w-0">
                <HoverTip content={m}>
                  <DialogTitle className="m-0 truncate text-base font-bold tracking-[-0.01em]">
                    {displayModel(m)}
                  </DialogTitle>
                </HoverTip>
                <p className="my-[2px] mb-0 text-xs text-dim mono">
                  {v.name} · {fmt(req)} requests · {((total / grand) * 100).toFixed(1)}% of volume
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="whitespace-nowrap rounded-full border border-line bg-accent-soft px-3 py-1 text-xs font-bold text-accent mono">#{rank ? String(rank).padStart(2, "0") : "–"}</span>
              <button
                type="button"
                onClick={onClose}
                className="flex shrink-0 items-center rounded-xl border border-line p-2 text-ink [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96]"
                aria-label="Close model details"
              >
                <Icon name="x" className="size-4" />
              </button>
            </div>
          </div>
        </div>
        <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto overscroll-contain px-5 pt-4 pb-5 [scrollbar-color:var(--line)_transparent] [scrollbar-width:thin]">
          <div className="grid grid-flow-dense grid-cols-2 gap-2 sm:grid-cols-4">
            {kpi("Tokens", fmtShort(total), range, true)}
            {kpi("Spend", money(usd), req ? `${money(usd / req)} / req` : "no requests", usd > 0)}
            {kpi("Cache hit", `${hit.toFixed(0)}%`, `${fmtShort(b.cacheRead)} cached`, hit >= 50)}
            {kpi("Requests", fmt(req), `${active} active days`, active > 0)}
          </div>
          <Card className="gap-0 bg-panel [--card-spacing:--spacing(3.5)]">
            <CardHeader>
              <CardTitle className="text-[13px] font-bold tracking-[-0.01em]">Token volume</CardTitle>
              <CardDescription className="mono text-[11px] uppercase tracking-[.12em] text-dim">{range}</CardDescription>
              <CardAction>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11px] font-bold mono ${trend.up ? "bg-accent-soft text-accent" : "bg-track text-dim"}`}>{trend.t}</span>
                  <ToggleGroup
                    value={[span]}
                    onValueChange={(v) => {
                      const next = v[v.length - 1];
                      if (next === "30" || next === "90" || next === "all") setSpan(next);
                    }}
                    className="mono rounded-[10px] border border-line p-1 text-xs"
                    aria-label="Chart range"
                  >
                    {(["30", "90", "all"] as Span[]).map((s) => (
                      <ToggleGroupItem key={s} value={s} className="h-auto cursor-pointer rounded-lg px-2.5 py-1 text-xs text-dim transition-[background,color] duration-200 hover:text-ink data-[state=on]:bg-accent-soft data-[state=on]:text-ink" aria-label={s === "all" ? "ALL" : `${s}D`}>
                        {s === "all" ? "ALL" : `${s}D`}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
              </CardAction>
            </CardHeader>
            <CardContent>
              <AreaChart vals={vals} days={days} />
              <div className="mt-1.5 flex justify-between text-[10px] uppercase tracking-[.12em] text-dim mono" aria-hidden="true">
                {monthTicks(days).map((t, i) => (
                  <span key={i}>{t}</span>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card className="gap-0 bg-panel [--card-spacing:--spacing(3.5)]">
            <CardHeader>
              <CardTitle className="text-[13px] font-bold tracking-[-0.01em]">Token mix</CardTitle>
              <CardDescription className="mono text-[11px] uppercase tracking-[.12em] text-dim">Input vs output vs cache</CardDescription>
            </CardHeader>
            <CardContent>
              <TokenMixChart
                parts={[
                  { label: "Input", v: b.input, color: "var(--accent)" },
                  { label: "Output", v: b.output, color: "#818cf8" },
                  { label: "Cache read", v: b.cacheRead, color: "#22d3ee" },
                  { label: "Cache write", v: b.cacheWrite, color: "var(--dim)" },
                ]}
              />
            </CardContent>
          </Card>
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
      <Card className="mt-8 border-line bg-panel dark:[color-scheme:dark]" aria-label="Top models">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Icon name="cpu" className="size-4" />
            <CardTitle className="font-display text-xl tracking-tight">Top models</CardTitle>
            <span className="mono ml-auto text-xs text-dim">usage across sessions</span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {tops.length === 0 && (
            <div className="flex flex-col items-center gap-[2px] rounded-xl border border-dashed border-line px-4 py-8 text-center md:col-span-3">
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
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setOpen(m);
                    }
                  }}
                  className="relative cursor-pointer gap-0 overflow-hidden rounded-xl border-line bg-panel p-4 transition-[background] duration-[250ms] hover:shadow-tersio"
                >
                  <BrandSilhouette model={m} />
                  <p className="pointer-events-none relative z-10 mb-2 text-xs leading-none text-dim mono">
                    0{i + 1}
                  </p>
                  <div className="relative z-10 flex items-center gap-3">
                    <Brandmark model={m} />
                    <div className="min-w-0 flex-1">
                       <p className="mono text-sm font-bold truncate">
                        {displayModel(m)}
                      </p>
                      <p className="mono text-xs truncate text-dim">
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
          </CardContent>
      </Card>

      <Card
        data-reveal
        className="mt-8 translate-y-[26px] overflow-hidden border-line bg-panel opacity-0 transition-[opacity,transform] duration-700 ease-[cubic-bezier(.16,1,.3,1)] data-[reveal=in]:translate-y-0 data-[reveal=in]:opacity-100 dark:[color-scheme:dark]"
        aria-label="All models"
      >
        <CardHeader>
          <div className="flex items-center gap-2">
            <Icon name="layers" className="size-4" />
            <CardTitle className="font-display text-xl tracking-tight">Models</CardTitle>
            <span className="mono ml-auto shrink-0 truncate text-xs text-dim">
              {tops.length ? `${tops.length} models` : ""}
            </span>
          </div>
          <CardDescription className="mono text-xs text-dim">ranked by tokens / top 10</CardDescription>
        </CardHeader>
        <CardContent>
        {tops.length > 0 ? (
          <div className="overflow-y-auto overscroll-contain [scrollbar-color:var(--line)_transparent] [scrollbar-width:thin]">
            <ol id="models" className="overflow-hidden">
              {rows.map((m, i) => {
                const mv = modelTotal(byModel, m);
                return (
                  <HoverTip key={m} content={data ? <ModelTip m={m} data={data} money={money} /> : "–"}>
                    <li
                      className={`transition-[background] duration-[250ms] hover:bg-track hover:shadow-tersio flex items-center gap-3 px-4 py-3 cursor-pointer${i < rows.length - 1 ? " border-b border-line" : ""}`}
                      onClick={() => setOpen(m)}
                    >
                      <span>
                        <Brandmark model={m} small />
                      </span>
                      <div className="min-w-0 flex-1">
                         <p className="mono text-sm truncate">
                          {displayModel(m)}
                        </p>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-track">
                          <div className="h-full origin-left rounded-full bg-accent transition-[width] duration-1000 ease-[cubic-bezier(.16,1,.3,1)]" style={{ width: `${Math.round((mv / max) * 100)}%` }} />
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="mono font-bold">{fmt(mv)}</p>
                        <p className="mono text-xs text-dim">
                          {money(data?.byModelUsd[m] ?? 0)}
                        </p>
                      </div>
                    </li>
                  </HoverTip>
                );
              })}
            </ol>
          </div>
        ) : (
          <EmptyState icon="boxes" title="No models yet" desc="Model token totals will appear here once sessions report tokens." />
        )}
        </CardContent>
        <CardFooter className="mono justify-between gap-4 border-t text-xs text-dim">
          <span>{range}</span>
          <div className="flex items-center gap-4">
            <PerPage options={[10, 15, 25, 50]} value={per} onPick={(n) => { setPer(n); setPage(1); }} label="Models per page" />
            <PageButtons pages={pages} page={p} onPick={setPage} label="Model pages" />
          </div>
        </CardFooter>
      </Card>

      {data && <ModelDialog m={open} data={data} money={money} onClose={() => setOpen(null)} />}
    </>
  );
}
