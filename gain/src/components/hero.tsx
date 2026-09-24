// Dock header + hero. Port of the template.html dock and hero section:
// sticky dock with brand, live clock, share + settings buttons; centered
// total with ticker of top models.
import { useEffect, useState } from "react";
import { fmt, fmtShort, modelTotal, topModels } from "@/lib/format";
import type { UsageReport } from "@/lib/data";
import { Icon } from "./icon";

function useClock(): string {
  const [now, setNow] = useState("--:--");
  useEffect(() => {
    const tick = (): void => {
      setNow(new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function Dock({ onShare, onSettings }: { onShare: () => void; onSettings: () => void }) {
  const clock = useClock();
  return (
    <header className="dock mt-4 flex w-full items-center gap-2 px-3 py-2">
      <a href="#" className="flex shrink-0 items-center gap-2.5 pl-1 pr-2" aria-label="Tersio dashboard home">
        <img src="brand.webp" alt="Tersio" width="32" height="32" className="brand size-8 rounded-full" />
        <span className="leading-tight text-left">
          <span className="block font-bold tracking-tight text-sm">TERSIO DASHBOARD</span>
          <span className="mono block text-[11px]" style={{ color: "var(--dim)" }}>
            live token number feed
          </span>
        </span>
      </a>
      <span className="mono hidden shrink-0 sm:flex items-center gap-2 text-xs px-2 ml-auto" style={{ color: "var(--dim)" }}>
        <span className="live-dot inline-block size-2 rounded-full" />
        <span>{clock}</span>
      </span>
      <span className="hidden sm:block w-px h-5 shrink-0" style={{ background: "var(--line)" }} aria-hidden="true" />
      <button
        type="button"
        onClick={onShare}
        className="btn-push flex shrink-0 items-center p-2 rounded-xl"
        style={{ border: "1px solid var(--line)", color: "var(--ink)" }}
        aria-label="Share your usage"
      >
        <Icon name="share-2" className="size-4" />
      </button>
      <button
        type="button"
        onClick={onSettings}
        className="btn-push flex shrink-0 items-center p-2 rounded-xl"
        style={{ border: "1px solid var(--line)", color: "var(--ink)" }}
        aria-label="Open settings"
      >
        <Icon name="settings" className="size-4" />
      </button>
    </header>
  );
}

export function Hero({ data }: { data: UsageReport | null }) {
  const t = data?.tokens ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const total = t.input + t.output + t.cacheRead + t.cacheWrite;
  const tops = data ? topModels(data.byModel, 5) : [];
  const parts = tops.map((m) => {
    const v = modelTotal(data?.byModel ?? {}, m);
    const nm = m
      .toUpperCase()
      .replace(/-(FREE|CONTRIBUTOR.*|NEXT|LATEST)$/, "")
      .replace(/[-.]?\d[\d.]*/, "")
      .replace(/-V(?=-|$)/, "");
    return `${nm} ${fmtShort(v)}`;
  });
  const half = parts.join("   ◆   ");
  return (
    <section className="mx-auto max-w-6xl text-center pt-14 pb-10 relative">
      <div className="hero-glow" aria-hidden="true" />
      <p className="hero-in mono text-[11px] uppercase tracking-[0.22em] mb-4 relative" style={{ color: "var(--accent)" }}>
        Live token feed
      </p>
      <p className="hero-in mono font-bold tracking-tighter leading-none text-7xl md:text-8xl relative herototal">
        {fmt(total)}
      </p>
      <div
        className="hero-in relative mt-6 overflow-hidden"
        aria-hidden="true"
        style={{ maskImage: "linear-gradient(90deg, transparent, black 12%, black 88%, transparent)" }}
      >
        <div className="ticker mono text-xs whitespace-nowrap inline-block" style={{ color: "var(--dim)" }}>
          {parts.length ? `${half}   ◆   ${half}` : ""}
        </div>
      </div>
    </section>
  );
}
