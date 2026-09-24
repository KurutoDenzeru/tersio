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
    <header className="sticky top-3 z-50 mt-4 flex w-full items-center gap-2 rounded-[20px] border border-transparent px-3 py-2 [background:linear-gradient(var(--panel),var(--panel))_padding-box,linear-gradient(120deg,var(--accent-soft),var(--line)_30%,var(--line)_70%,var(--accent-soft))_border-box] [box-shadow:0_1px_2px_rgba(0,0,0,.08)]">
      <a href="#" className="flex shrink-0 items-center gap-2.5 pl-1 pr-2" aria-label="Tersio dashboard home">
        <img src="brand.webp" alt="Tersio" width="32" height="32" className="size-8 rounded-[10px]" />
        <span className="text-left leading-tight">
          <span className="block text-sm font-bold tracking-tight">TERSIO</span>
          <span className="mono block text-[11px] text-dim">dashboard</span>
        </span>
      </a>
      <span className="mono ml-auto hidden shrink-0 items-center gap-2 px-2 text-xs text-dim sm:flex">
        <span className="inline-block size-2 rounded-full bg-accent" />
        <span>{clock}</span>
      </span>
      <span className="hidden h-5 w-px shrink-0 bg-line sm:block" aria-hidden="true" />
      <button
        type="button"
        onClick={onShare}
        className="flex shrink-0 items-center rounded-xl border border-line p-2 text-ink [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96]"
        aria-label="Share your usage"
      >
        <Icon name="share-2" className="size-4" />
      </button>
      <button
        type="button"
        onClick={onSettings}
        className="flex shrink-0 items-center rounded-xl border border-line p-2 text-ink [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96]"
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
    <section className="relative mx-auto max-w-6xl pt-14 pb-10 text-center">
      <div
        className="pointer-events-none absolute top-[44%] left-1/2 h-[300px] w-[min(720px,90vw)] -translate-x-1/2 -translate-y-1/2 animate-breathe bg-[radial-gradient(ellipse_at_center,var(--accent-soft)_0%,transparent_65%)]"
        aria-hidden="true"
      />
      <p className="mono relative mb-4 text-[11px] tracking-[0.22em] text-accent uppercase">Live token feed</p>
      <p className="mono relative bg-[linear-gradient(180deg,var(--ink)_55%,var(--accent)_130%)] bg-clip-text text-7xl leading-none font-bold tracking-tighter text-transparent md:text-8xl">
        {fmt(total)}
      </p>
      <div
        className="relative mt-6 overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_12%,black_88%,transparent)]"
        aria-hidden="true"
      >
        <div className="mono inline-block animate-tick text-xs whitespace-nowrap text-dim [will-change:transform] hover:[animation-play-state:paused]">
          {parts.length ? `${half}   ◆   ${half}` : ""}
        </div>
      </div>
    </section>
  );
}
