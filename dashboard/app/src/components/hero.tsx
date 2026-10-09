// Compact live telemetry hero, first block of the Usage page.
import { useEffect, useState } from "react";
import { fmt } from "@/lib/format";
import type { UsageReport } from "@/lib/data";

// `dep` re-runs when the text changes but the number does not, e.g. a currency switch.
export function useCountUp(target: number, dep?: unknown): number {
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
  }, [target, dep]);

  return value;
}

export function Hero({ data }: { data: UsageReport | null }) {
  const t = data?.tokens ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const total = t.input + t.output + t.cacheRead + t.cacheWrite;
  const displayedTotal = useCountUp(total);
  return (
    <section className="mx-auto max-w-7xl pt-10 pb-6" aria-labelledby="hero-total">
      <div className="text-center">
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
        <p className="mono mt-2 text-xs text-dim">tokens observed</p>
      </div>
    </section>
  );
}
