// Savings bento and token strip with shadcn Card and Select structure.
import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TooltipRow } from "@/components/ui/tooltip-surface";
import { CURS, FLAGS, co2Zone, dayTotal, fmt, fmtShort, levZone, shareZone } from "@/lib/format";
import type { FxState, UsageReport } from "@/lib/data";
import { HoverTip } from "./common";
import { Icon } from "./icon";

// Zone faces: the tersio palette's own colour classes, per the mapping contract.
const ZFACE_CLS: Record<string, string> = { good: "text-accent", warn: "text-[#fbbf24]", bad: "text-[#f87171]" };

function TipRow({ color, k, v }: { color: string; k: string; v: string }) {
  return <TooltipRow color={color} label={k} value={v} />;
}

export function CurrencyPicker({
  cur,
  onPick,
  id,
}: {
  cur: string;
  onPick: (code: string) => void;
  id: string;
}) {
  return (
    <Select
      value={cur}
      onValueChange={(v) => {
        if (v) onPick(v);
      }}
    >
      <SelectTrigger id={id} size="sm" aria-label="Display currency">
        <SelectValue>{`${FLAGS[cur] ?? ""} ${cur}`}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {Object.keys(CURS).map((k) => (
            <SelectItem key={k} value={k}>
              {`${FLAGS[k]} ${k}`}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

const sparkChartConfig = {
  tokens: {
    label: "Tokens",
    color: "var(--accent)",
  },
} satisfies ChartConfig;

function Spark({ days, usd, money }: { days: Array<{ k: string; v: number }>; usd: number; money: (v: number) => string }) {
  const rate = usd && days.length ? usd / days.reduce((a, d) => a + d.v, 0) : 0;
  return (
    <ChartContainer config={sparkChartConfig} className="h-24 w-full">
      <AreaChart
        data={days}
        margin={{ top: 8, right: 4, bottom: 0, left: 4 }}
        accessibilityLayer
      >
        <defs>
          <linearGradient id="sparkArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-tokens)" stopOpacity={0.45} />
            <stop offset="95%" stopColor="var(--color-tokens)" stopOpacity={0.04} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 4" />
        <XAxis
          dataKey="k"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          interval={0}
          minTickGap={8}
          tickFormatter={(value) => new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        />
        <YAxis hide />
        <ChartTooltip
          cursor={{ stroke: "var(--line)" }}
          content={
            <ChartTooltipContent
              labelFormatter={(value) => new Date(`${String(value)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              formatter={(value) => {
                const tokens = Number(value);
                return (
                  <>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-[2px] bg-accent" />
                    Tokens
                    <span className="ml-auto font-mono font-medium text-foreground tabular-nums">{fmt(tokens)}</span>
                    <span className="basis-full text-right font-mono text-muted-foreground tabular-nums">~{money(rate * tokens)}</span>
                  </>
                );
              }}
            />
          }
        />
        <Area
          dataKey="v"
          name="tokens"
          type="natural"
          fill="url(#sparkArea)"
          stroke="var(--color-tokens)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: "var(--color-tokens)", stroke: "var(--panel)", strokeWidth: 2 }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}

export function Savings({
  data,
  fx,
  money,
  onCurrency,
}: {
  data: UsageReport | null;
  fx: FxState;
  money: (v: number) => string;
  onCurrency: (code: string) => void;
}) {
  const t = data?.tokens ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const total = t.input + t.output + t.cacheRead + t.cacheWrite;
  const usd = data?.usd ?? 0;
  const saved = data?.savedUsd ?? 0;
  const lev = usd ? saved / usd : 0;
  const levZ = levZone(lev);
  const co2 = data?.co2g ?? 0;
  const co2Z = co2Zone(co2);
  const share = total ? Math.round(((t.cacheRead + t.cacheWrite) / total) * 100) : 0;
  const shareZ = shareZone(share);

  const byDay = data?.byDay ?? {};
  const sparkDays = useMemo(() => {
    const days: Array<{ k: string; v: number }> = [];
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    for (let offset = 13; offset >= 0; offset -= 1) {
      const date = new Date(end);
      date.setDate(end.getDate() - offset);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      days.push({ k: key, v: byDay[key] ? dayTotal(byDay[key]) : 0 });
    }
    return days;
  }, [byDay]);
  const dayCount = sparkDays.length;
  const topDay = sparkDays.slice().sort((a, b) => b.v - a.v)[0];
  const rate = total ? usd / total : 0;

  const strip = useMemo(
    () =>
      (
        [
          ["input", t.input, "arrow-down-to-line"],
          ["output", t.output, "arrow-up-from-line"],
          ["cache read", t.cacheRead, "hard-drive-download"],
          ["cache write", t.cacheWrite, "hard-drive-upload"],
        ] as Array<[string, number, string]>
      ),
    [t],
  );

  // 7-day cache-share trend in percentage points, like the original.
  const trendPp = useMemo(() => {
    const keys = Object.keys(byDay).sort();
    const pctOf = (b: { cacheRead?: number; cacheWrite?: number; input?: number; output?: number }): number => {
      const s = dayTotal(b);
      return s ? (((b.cacheRead ?? 0) + (b.cacheWrite ?? 0)) / s) * 100 : 0;
    };
    let c = 0;
    let p = 0;
    let cn = 0;
    let pn = 0;
    keys.slice(-7).forEach((k) => {
      c += pctOf(byDay[k]);
      cn++;
    });
    keys.slice(-14, -7).forEach((k) => {
      p += pctOf(byDay[k]);
      pn++;
    });
    return (cn ? c / cn : 0) - (pn ? p / pn : 0);
  }, [byDay]);

  return (
    <>
    <section className="grid grid-cols-12 grid-flow-dense gap-3" aria-label="Savings">
        <Card className="col-span-12 justify-between border-line bg-panel lg:col-span-7 lg:row-span-2">
          <CardHeader>
            <CardTitle className="mono text-[11px] uppercase tracking-[0.14em] text-dim">
              {fx.cur.toLowerCase()} cost
            </CardTitle>
            <CardAction>
              <CurrencyPicker cur={fx.cur} onPick={onCurrency} id="fxCur" />
            </CardAction>
          </CardHeader>
          <CardContent>
            <p className="mono font-bold tracking-tighter leading-none text-6xl lg:text-7xl">{money(usd)}</p>
            <div className="mt-4">
              {sparkDays.length ? (
                <Spark days={sparkDays} usd={usd} money={money} />
              ) : (
                <div className="flex flex-col items-center gap-[2px] rounded-xl border border-dashed border-line px-4 py-8 text-center">
                  <span className="mb-2.5 grid size-10 place-items-center rounded-full bg-track text-dim">
                    <Icon name="trending-up" className="size-5" />
                  </span>
                  <p className="m-0 text-sm font-semibold text-ink">No cost data yet</p>
                  <p className="m-0 max-w-[340px] text-xs text-dim">Daily spend will spark here once sessions report tokens.</p>
                </div>
              )}
            </div>
             <div className="mono mt-3 flex gap-4 text-xs text-dim">
               <span>
                 avg <span className="text-ink">{money(usd / dayCount)}/day</span>
               </span>
               <span>
                 top <span className="text-ink">{topDay ? `${topDay.k.slice(5)} ~${money(rate * topDay.v)}` : "-"}</span>
               </span>
               <HoverTip content="Cache savings per $1 spent, vs full input price">
                 <span>
                   x<span className="text-accent">{usd ? lev.toFixed(1) : "-"}</span> cache leverage
                 </span>
               </HoverTip>
             </div>
          </CardContent>
        </Card>
        <div className="col-span-12 lg:col-span-5 lg:row-span-2 grid grid-cols-2 grid-flow-dense gap-3 h-full grid-rows-[auto_1fr]">
          <HoverTip
            content={
              <div className="grid gap-1.5">
                <div className="font-medium text-foreground">Saved by cache</div>
                <div className="text-muted-foreground">{money(saved)} est. vs full input price</div>
                <div className="grid gap-1.5">
                  <TipRow color="var(--accent)" k="zone" v={`${levZ[1]}`} />
                  <TipRow color="var(--accent)" k="leverage" v={`x${lev.toFixed(1)} per $1`} />
                  <TipRow color="var(--dim)" k="cache read" v={fmtShort(t.cacheRead)} />
                </div>
              </div>
            }
          >
            <Card className="col-span-2 border-line bg-panel">
              <CardHeader>
                <CardTitle className="mono text-[11px] uppercase tracking-[0.14em] text-dim">Saved by cache</CardTitle>
                <CardAction>
                  <span className="mono inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-track px-2.5 py-[3px] text-[11px] text-dim">est.</span>
                </CardAction>
              </CardHeader>
              <CardContent>
                <p className="mono font-bold text-3xl text-accent">{money(saved)}</p>
                <CardDescription className="mono mt-2 text-[11px] text-dim">est. vs full input price</CardDescription>
              </CardContent>
            </Card>
          </HoverTip>
          <HoverTip
            content={
              <div className="grid gap-1.5">
                <div className="font-medium text-foreground">CO2</div>
                <div className="text-muted-foreground">~{co2.toFixed(1)}g est. from output</div>
                <div className="grid gap-1.5">
                  <TipRow color="var(--accent)" k="zone" v={co2Z[1]} />
                  <TipRow color="var(--accent)" k="energy" v={`~${(data?.energyWh ?? 0).toFixed(1)} Wh`} />
                  <TipRow color="var(--dim)" k="served" v="÷32 concurrency" />
                </div>
              </div>
            }
          >
             <Card className="col-span-1 border-line bg-panel">
               <CardHeader>
                 <CardTitle className="mono text-[11px] uppercase tracking-[0.14em] text-dim">CO2</CardTitle>
               </CardHeader>
               <CardContent>
                 <p className="mono font-bold text-3xl">
                   ~{co2.toFixed(1)}g <Icon name={co2Z[0]} className={`inline-block size-3.5 align-[-2px] ${ZFACE_CLS[co2Z[2]] ?? ""}`} />
                 </p>
                <span className="mono mt-2 inline-flex w-fit rounded-full bg-track px-2.5 py-[3px] text-[11px] text-dim">served ÷32</span>
               </CardContent>
             </Card>
          </HoverTip>
          <HoverTip
            content={
              <div className="grid gap-1.5">
                <div className="font-medium text-foreground">Cache share</div>
                <div className="text-muted-foreground">{share}% of tokens cached</div>
                <div className="grid gap-1.5">
                  <TipRow color="var(--accent)" k="zone" v={shareZ[1]} />
                  <TipRow color="var(--dim)" k="read" v={fmtShort(t.cacheRead)} />
                  <TipRow color="var(--dim)" k="write" v={fmtShort(t.cacheWrite)} />
                  <TipRow color="var(--dim)" k="7d trend" v={`${trendPp >= 0 ? "+" : ""}${trendPp.toFixed(1)}pp`} />
                </div>
              </div>
            }
          >
             <Card className="col-span-1 border-line bg-panel">
               <CardHeader>
                 <CardTitle className="mono text-[11px] uppercase tracking-[0.14em] text-dim">Cache share</CardTitle>
               </CardHeader>
               <CardContent>
                 <p className="mono font-bold text-3xl">
                   {share}% <Icon name={shareZ[0]} className={`inline-block size-3.5 align-[-2px] ${ZFACE_CLS[shareZ[2]] ?? ""}`} />
                 </p>
                 <CardDescription className="mono mt-2 text-[11px] text-dim">of tokens cached</CardDescription>
               </CardContent>
             </Card>
          </HoverTip>
        </div>
      </section>

      <section
        data-reveal
        className="mt-3 grid translate-y-[26px] grid-cols-1 gap-3 opacity-0 transition-[opacity,transform] duration-700 ease-[cubic-bezier(.16,1,.3,1)] data-[reveal=in]:translate-y-0 data-[reveal=in]:opacity-100 sm:grid-cols-2 lg:grid-cols-4"
        aria-label="Tokens by bucket"
      >
        {strip.map(([label, v, icon]) => (
          <Card key={label} size="sm" className="min-w-0 cursor-pointer overflow-hidden border-line bg-panel transition-[background] duration-[250ms] hover:shadow-tersio">
            <CardHeader className="min-w-0">
              <CardTitle className="mono flex min-w-0 items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-dim">
                <Icon name={icon} className="size-3.5" />
                <span className="truncate">{label}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="min-w-0">
              <p className="mono truncate text-xl font-bold tabular-nums">{fmt(v)}</p>
            </CardContent>
          </Card>
        ))}
      </section>
    </>
  );
}
