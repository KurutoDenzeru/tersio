// Dock header + compact live telemetry hero.
import { useEffect, useState } from "react";
import { fmt } from "@/lib/format";
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

function useCountUp(target: number): number {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const frame = requestAnimationFrame(() => setValue(target));
      return () => cancelAnimationFrame(frame);
    }

    const startedAt = performance.now();
    let frame = 0;
    const tick = (now: number): void => {
      const progress = Math.min((now - startedAt) / 1400, 1);
      const eased = 1 - Math.pow(1 - progress, 4);
      setValue(Math.round(target * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return value;
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
  const displayedTotal = useCountUp(total);
  return (
    <section className="mx-auto max-w-7xl pt-10 pb-6" aria-labelledby="hero-total">
      <div>
        <div className="flex items-center justify-center gap-2">
          <span className="size-1.5 rounded-full bg-accent" aria-hidden="true" />
          <p className="mono text-[10px] tracking-[0.18em] text-dim uppercase">Live token telemetry</p>
        </div>
        <p
          id="hero-total"
          className="mono mt-4 bg-[linear-gradient(180deg,var(--ink)_58%,var(--accent)_125%)] bg-clip-text text-6xl leading-none font-bold tracking-[-0.06em] text-transparent tabular-nums sm:text-7xl md:text-8xl"
        >
          {fmt(displayedTotal)}
        </p>
        <p className="mono mt-2 text-center text-xs text-dim">tokens observed</p>
      </div>
    </section>
  );
}
