// Savings bento + token strip. Port of renderMain() savings block,
// renderSpark(), and renderStrip() in dashboard/charts.js. Shadcn Card +
// Select carry the structure; the sparkline, zone faces, and money rules
// stay identical to the original.
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CURS, FLAGS, co2Zone, dateHead, dayTotal, fmt, fmtShort, levZone, shareZone } from "@/lib/format";
import type { FxState } from "@/lib/data";
import type { UsageReport } from "@/lib/data";
import { HoverTip } from "./common";
import { Icon } from "./icon";

// Zone faces: the tersio palette's own colour classes, per the mapping contract.
const ZFACE_CLS: Record<string, string> = { good: "text-accent", warn: "text-[#fbbf24]", bad: "text-[#f87171]" };

function TipRow({ color, k, v }: { color: string; k: string; v: string }) {
  return (
    <div className="flex items-center gap-2.5 py-[3px] text-xs">
      <span className="size-[9px] shrink-0 rounded-[2.5px]" style={{ background: color }} />
      <span className="min-w-0 flex-1 truncate">{k}</span>
      <span className="shrink-0 whitespace-nowrap tabular-nums">{v}</span>
    </div>
  );
}

export function CurrencyPicker({
  cur,
  onPick,
  id,
  variant = "select",
}: {
  cur: string;
  onPick: (code: string) => void;
  id: string;
  variant?: "pill" | "select";
}) {
  return (
    <Select
      value={cur}
      onValueChange={(v) => {
        if (v) onPick(v);
      }}
    >
      <SelectTrigger
        id={id}
        className={
          variant === "pill"
            ? "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11px] mono cursor-pointer border-0 bg-track dark:bg-track text-ink gap-1.5 hover:bg-accent-soft focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent [&_svg]:transition-transform [&_svg]:duration-150 aria-expanded:[&_svg]:rotate-180 h-auto"
            : "inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] border border-line bg-panel dark:bg-panel px-2.5 py-[7px] text-xs text-ink hover:border-accent [&_svg]:transition-transform [&_svg]:duration-150 aria-expanded:[&_svg]:rotate-180 mono h-auto"
        }
        aria-label="Display currency"
      >
        <SelectValue>{`${FLAGS[cur] ?? ""} ${cur}`}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {Object.keys(CURS).map((k) => (
          <SelectItem key={k} value={k}>
            {`${FLAGS[k]} ${k}`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Spark({ days, usd, money }: { days: Array<{ k: string; v: number }>; usd: number; money: (v: number) => string }) {
  const max = Math.max(1, ...days.map((d) => d.v));
  const rate = usd && days.length ? usd / days.reduce((a, d) => a + d.v, 0) : 0;
  const top = days.slice().sort((a, b) => b.v - a.v)[0];
  const [tip, setTip] = useState<{ k: string; v: number } | null>(null);
  return (
    <div className="relative">
      <div className="flex items-end gap-[3px] h-16">
        {days.map((d) => (
          <span
            key={d.k}
            className={`min-w-[3px] flex-1 rounded-t-[2px] bg-accent ${top && d.k === top.k && d.v > 0 ? "opacity-100 [box-shadow:0_0_8px_var(--accent-soft)]" : "opacity-45"}`}
            style={{ height: d.v ? `${Math.max(4, Math.round((d.v / max) * 100))}%` : "0" }}
            onMouseEnter={() => setTip(d)}
            onMouseLeave={() => setTip(null)}
            title={`${d.k} · ~${money(rate * d.v)}`}
          />
        ))}
      </div>
      {tip && (
        <div className="mono absolute z-10 rounded-lg border border-line bg-panel px-3 py-2 text-[11px]" style={{ top: -8, left: "50%", transform: "translate(-50%, -110%)" }}>
          <div className="uppercase tracking-widest opacity-70">{dateHead(tip.k)}</div>
          <div className="font-bold">~{money(rate * tip.v)}</div>
          <div className="opacity-70">{fmt(tip.v)} tokens</div>
        </div>
      )}
    </div>
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
  const sparkDays = useMemo(() => Object.keys(byDay).sort().slice(-30).map((k) => ({ k, v: dayTotal(byDay[k]) })), [byDay]);
  const dayCount = sparkDays.length || 1;
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
      ).filter((b) => b[1] > 0),
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
        <Card className="col-span-12 lg:col-span-7 lg:row-span-2 flex flex-col justify-between p-6 border-line bg-panel">
          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="mono text-[11px] uppercase tracking-[0.14em] text-dim">
                {fx.cur.toLowerCase()} cost
              </p>
              <CurrencyPicker cur={fx.cur} onPick={onCurrency} id="fxCur" variant="pill" />
            </div>
            <p className="mono font-bold tracking-tighter leading-none mt-2 text-6xl lg:text-7xl">{money(usd)}</p>
          </div>
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
            <div className="flex gap-4 mt-3 mono text-xs text-dim">
              <span>
                avg <span className="text-ink">{money(usd / dayCount)}/day</span>
              </span>
              <span>
                top <span className="text-ink">{topDay ? `${topDay.k.slice(5)} ~${money(rate * topDay.v)}` : "-"}</span>
              </span>
              <span title="Cache savings per $1 spent, vs full input price">
                x<span className="text-accent">{usd ? lev.toFixed(1) : "-"}</span> cache leverage
              </span>
            </div>
          </div>
          <p className="mono text-[11px] mt-3 text-dim" title={`Cache leverage x${lev.toFixed(1)} — cache savings per $1 spent, vs full input price`}>
            {(data?.priced ? "per-model price table" : "incl. default pricing") + (fx.live ? " · fx live" : " · fx snapshot") + " · "}
            <Icon name={levZ[0]} className={`inline-block size-3.5 align-[-2px] ${ZFACE_CLS[levZ[2]] ?? ""}`} /> {levZ[1]}
          </p>
        </Card>
        <div className="col-span-12 lg:col-span-5 lg:row-span-2 grid grid-cols-2 grid-flow-dense gap-3 h-full grid-rows-[auto_1fr]">
          <HoverTip
            content={
              <div className="mono">
                <div className="text-[11px] font-bold uppercase tracking-[.14em]">Saved by cache</div>
                <div className="my-[2px] mb-2 text-[13px]">{money(saved)} est.</div>
                <TipRow color="var(--accent)" k="zone" v={`${levZ[1]}`} />
                <TipRow color="var(--accent)" k="leverage" v={`x${lev.toFixed(1)} per $1`} />
                <TipRow color="var(--dim)" k="cache read" v={fmtShort(t.cacheRead)} />
              </div>
            }
          >
            <Card className="col-span-2 p-5 border-line bg-panel">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="mono text-[11px] uppercase tracking-[0.14em] text-dim">
                    saved by cache
                  </p>
                  <p className="mono font-bold text-3xl mt-1 text-accent">
                    {money(saved)}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11px] bg-track text-dim mono" title="Modeled estimate, not measured">
                  est.
                </span>
              </div>
              <p className="mono text-[11px] mt-2 text-dim">
                est. vs full input price
              </p>
            </Card>
          </HoverTip>
          <HoverTip
            content={
              <div className="mono">
                <div className="text-[11px] font-bold uppercase tracking-[.14em]">CO2</div>
                <div className="my-[2px] mb-2 text-[13px]">~{co2.toFixed(1)}g est.</div>
                <TipRow color="var(--accent)" k="zone" v={co2Z[1]} />
                <TipRow color="var(--accent)" k="energy" v={`~${(data?.energyWh ?? 0).toFixed(1)} Wh`} />
              </div>
            }
          >
            <Card className="col-span-1 p-5 border-line bg-panel" title={`${co2Z[1]} footprint (est.)`}>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="mono text-[11px] uppercase tracking-[0.14em] text-dim">
                    co2
                  </p>
                  <p className="mono font-bold text-3xl mt-1">
                    ~{co2.toFixed(1)}g <Icon name={co2Z[0]} className={`inline-block size-3.5 align-[-2px] ${ZFACE_CLS[co2Z[2]] ?? ""}`} />
                  </p>
                  <p className="mt-2">
                    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11px] bg-track text-dim mono" title="Single-stream ceiling divided by 32-way served concurrency">
                      served ÷32
                    </span>
                  </p>
                </div>
              </div>
              <p className="mono text-[11px] mt-2 text-dim">
                est. from output
              </p>
            </Card>
          </HoverTip>
          <HoverTip
            content={
              <div className="mono">
                <div className="text-[11px] font-bold uppercase tracking-[.14em]">Cache share</div>
                <div className="my-[2px] mb-2 text-[13px]">{share}%</div>
                <TipRow color="var(--accent)" k="zone" v={shareZ[1]} />
                <TipRow color="var(--accent)" k="read" v={fmtShort(t.cacheRead)} />
                {(t.cacheWrite ?? 0) > 0 && <TipRow color="var(--dim)" k="write" v={fmtShort(t.cacheWrite)} />}
                <TipRow color="var(--dim)" k="7d trend" v={`${trendPp >= 0 ? "+" : ""}${trendPp.toFixed(1)}pp`} />
              </div>
            }
          >
            <Card className="col-span-1 p-5 border-line bg-panel" title={`${shareZ[1]} cache share`}>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="mono text-[11px] uppercase tracking-[0.14em] text-dim">
                    cache share
                  </p>
                  <p className="mono font-bold text-3xl mt-1">
                    {share}% <Icon name={shareZ[0]} className={`inline-block size-3.5 align-[-2px] ${ZFACE_CLS[shareZ[2]] ?? ""}`} />
                  </p>
                </div>
              </div>
              <p className="mono text-[11px] mt-2 text-dim">
                of tokens cached
              </p>
            </Card>
          </HoverTip>
        </div>
      </section>

      <section data-reveal className="mt-3 flex rounded-xl overflow-hidden border border-line bg-panel translate-y-[26px] opacity-0 transition-[opacity,transform] duration-700 ease-[cubic-bezier(.16,1,.3,1)] data-[reveal=in]:translate-y-0 data-[reveal=in]:opacity-100" aria-label="Tokens by bucket">
        {strip.map(([label, v, icon], i) => (
          <div key={label} className={`flex-1 px-4 py-4 border-line transition-[background] duration-[250ms] hover:shadow-tersio cursor-pointer${i > 0 ? " sm:border-l" : ""}`}>
            <div className="flex items-center gap-2 mono text-[11px] uppercase tracking-[0.14em] text-dim">
              <Icon name={icon} className="size-3.5" />
              <span>{label}</span>
            </div>
            <p className="mono font-bold text-3xl mt-1">{fmt(v)}</p>
          </div>
        ))}
      </section>
    </>
  );
}
