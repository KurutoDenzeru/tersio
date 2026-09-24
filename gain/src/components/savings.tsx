// Savings bento + token strip. Port of renderMain() savings block,
// renderSpark(), and renderStrip() in dashboard/charts.js. Shadcn Card +
// Select carry the structure; the sparkline, zone faces, and money rules
// stay identical to the original.
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CURS,
  FLAGS,
  co2Zone,
  dateHead,
  dayTotal,
  fmt,
  levZone,
  shareZone,
} from "@/lib/format";
import type { FxState } from "@/lib/data";
import type { UsageReport } from "@/lib/data";
import { Icon } from "./icon";

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
      <SelectTrigger id={id} className="pill mono fxbtn h-auto border-0" aria-label="Display currency">
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
      <div className="spark h-16">
        {days.map((d) => (
          <span
            key={d.k}
            className={top && d.k === top.k && d.v > 0 ? "top" : undefined}
            style={{ height: d.v ? `${Math.max(4, Math.round((d.v / max) * 100))}%` : "0" }}
            onMouseEnter={() => setTip(d)}
            onMouseLeave={() => setTip(null)}
            title={`${d.k} · ~${money(rate * d.v)}`}
          />
        ))}
      </div>
      {tip && (
        <div className="mono absolute z-10 rounded-lg border px-3 py-2 text-[11px]" style={{ background: "var(--panel)", borderColor: "var(--line)", top: -8, left: "50%", transform: "translate(-50%, -110%)" }}>
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
          ["input", t.input],
          ["output", t.output],
          ["cache read", t.cacheRead],
          ["cache write", t.cacheWrite],
        ] as Array<[string, number]>
      ).filter((b) => b[1] > 0),
    [t],
  );

  return (
    <>
    <section className="grid grid-cols-12 grid-flow-dense gap-3" aria-label="Savings">
        <Card className="col-span-12 lg:col-span-7 lg:row-span-2 flex flex-col justify-between p-6" style={{ borderColor: "var(--line)", background: "var(--panel)" }}>
          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="mono text-[11px] uppercase tracking-[0.14em]" style={{ color: "var(--dim)" }}>
                {fx.cur.toLowerCase()} cost
              </p>
              <CurrencyPicker cur={fx.cur} onPick={onCurrency} id="fxCur" />
            </div>
            <p className="mono font-bold tracking-tighter leading-none mt-2 text-6xl lg:text-7xl">{money(usd)}</p>
          </div>
          <div className="mt-4">
            {sparkDays.length ? (
              <Spark days={sparkDays} usd={usd} money={money} />
            ) : (
              <div className="empty">
                <span className="empty-icon">
                  <Icon name="trending-up" className="size-5" />
                </span>
                <p className="empty-title">No cost data yet</p>
                <p className="empty-desc">Daily spend will spark here once sessions report tokens.</p>
              </div>
            )}
            <div className="flex gap-4 mt-3 mono text-xs" style={{ color: "var(--dim)" }}>
              <span>
                avg <span style={{ color: "var(--ink)" }}>{money(usd / dayCount)}/day</span>
              </span>
              <span>
                top <span style={{ color: "var(--ink)" }}>{topDay ? `${topDay.k.slice(5)} ~${money(rate * topDay.v)}` : "-"}</span>
              </span>
              <span title="Cache savings per $1 spent, vs full input price">
                x<span style={{ color: "var(--accent)" }}>{usd ? lev.toFixed(1) : "-"}</span> cache leverage
              </span>
            </div>
          </div>
          <p className="mono text-[11px] mt-3" style={{ color: "var(--dim)" }} title={`Cache leverage x${lev.toFixed(1)} — cache savings per $1 spent, vs full input price`}>
            {(data?.priced ? "per-model price table" : "incl. default pricing") + (fx.live ? " · fx live" : " · fx snapshot") + " · "}
            <Icon name={levZ[0]} className={`zface ${levZ[2]}`} /> {levZ[1]}
          </p>
        </Card>
        <div className="col-span-12 lg:col-span-5 lg:row-span-2 grid grid-cols-2 grid-flow-dense gap-3 h-full grid-rows-[auto_1fr]">
          <Card className="col-span-2 p-5" style={{ borderColor: "var(--line)", background: "var(--panel)" }}>
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="mono text-[11px] uppercase tracking-[0.14em]" style={{ color: "var(--dim)" }}>
                  saved by cache
                </p>
                <p className="mono font-bold text-3xl mt-1" style={{ color: "var(--accent)" }}>
                  {money(saved)}
                </p>
              </div>
              <span className="pill flat mono" title="Modeled estimate, not measured">
                est.
              </span>
            </div>
            <p className="mono text-[11px] mt-2" style={{ color: "var(--dim)" }}>
              est. vs full input price
            </p>
          </Card>
          <Card className="col-span-1 p-5" style={{ borderColor: "var(--line)", background: "var(--panel)" }} title={`${co2Z[1]} footprint (est.)`}>
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="mono text-[11px] uppercase tracking-[0.14em]" style={{ color: "var(--dim)" }}>
                  co2
                </p>
                <p className="mono font-bold text-3xl mt-1">
                  ~{co2.toFixed(1)}g <Icon name={co2Z[0]} className={`zface ${co2Z[2]}`} />
                </p>
                <p className="mt-2">
                  <span className="pill flat mono" title="Single-stream ceiling divided by 32-way served concurrency">
                    served ÷32
                  </span>
                </p>
              </div>
            </div>
            <p className="mono text-[11px] mt-2" style={{ color: "var(--dim)" }}>
              est. from output
            </p>
          </Card>
          <Card className="col-span-1 p-5" style={{ borderColor: "var(--line)", background: "var(--panel)" }} title={`${shareZ[1]} cache share`}>
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="mono text-[11px] uppercase tracking-[0.14em]" style={{ color: "var(--dim)" }}>
                  cache share
                </p>
                <p className="mono font-bold text-3xl mt-1">
                  {share}% <Icon name={shareZ[0]} className={`zface ${shareZ[2]}`} />
                </p>
              </div>
            </div>
            <p className="mono text-[11px] mt-2" style={{ color: "var(--dim)" }}>
              of tokens cached
            </p>
          </Card>
        </div>
      </section>

      <section className="rise mt-3 flex rounded-xl overflow-hidden" style={{ border: "1px solid var(--line)", background: "var(--panel)" }} aria-label="Tokens by bucket">
        {strip.map(([label, v], i) => (
          <div key={label} className={`stripcell flex-1 px-4 py-4${i > 0 ? " sm:border-l" : ""}`} style={{ borderColor: "var(--line)" }}>
            <div className="flex items-center gap-2 mono text-[11px] uppercase tracking-[0.14em]" style={{ color: "var(--dim)" }}>
              <span>{label}</span>
            </div>
            <p className="mono font-bold text-3xl mt-1">{fmt(v)}</p>
          </div>
        ))}
      </section>
    </>
  );
}
