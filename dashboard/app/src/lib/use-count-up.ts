// Animates a number up to its target. Honours reduced motion, which snaps instead of tweening.
import { useEffect, useState } from "react";

/** `dep` re-runs the count when the text changes but the number does not, e.g. a currency switch. */
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
