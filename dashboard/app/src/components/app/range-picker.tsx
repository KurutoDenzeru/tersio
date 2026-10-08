// Range picker. One control, one meaning: it changes what every page aggregates.
import { RANGE_IDS, RANGE_LABELS } from "@/lib/route";
import type { RangeId } from "@/lib/route";

export function RangePicker({ range, onPick }: { range: RangeId; onPick: (range: RangeId) => void }) {
  return (
    <div
      className="mono flex shrink-0 items-center gap-0.5 rounded-[10px] border border-line bg-panel p-0.5"
      role="radiogroup"
      aria-label="Time range"
    >
      {RANGE_IDS.map((id) => {
        const active = id === range;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onPick(id)}
            className={`rounded-lg px-2.5 py-1 text-[11px] [transition:background_.15s,color_.15s] active:scale-[.97] ${
              active ? "bg-accent-soft font-semibold text-accent" : "text-dim hover:bg-track hover:text-ink"
            }`}
          >
            {RANGE_LABELS[id]}
          </button>
        );
      })}
    </div>
  );
}
