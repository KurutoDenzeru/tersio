// Frustration: the interruption and recovery signals we can actually measure.
import { useMemo } from "react";
import { Note, Section, percent, StatStrip, StripStat } from "@/components/dash/composites";
import { StatusBadge } from "@/components/recent";
import { rangeView } from "@/lib/aggregate";
import { fmt } from "@/lib/format";
import { RANGE_LABELS } from "@/lib/route";
import type { PageProps } from "./types";

const RECOVERY_WINDOW_MS = 5 * 60 * 1000;

/**
 * A completed run for a model within five minutes of that model's own error. This is the one
 * frustration-adjacent signal the transcripts support: it needs only status, model, and time.
 */
function recoveries(rows: PageProps["data"]["recent"]): number {
  const ascending = [...rows].sort((a, b) => a.t - b.t);
  const lastError = new Map<string, number>();
  let count = 0;
  for (const row of ascending) {
    const failedAt = lastError.get(row.m);
    if (failedAt !== undefined && row.t - failedAt <= RECOVERY_WINDOW_MS && row.st === "completed") {
      count += 1;
      // Count each recovery once, not every later turn inside the window.
      lastError.delete(row.m);
    }
    if (row.st === "error") lastError.set(row.m, row.t);
  }
  return count;
}

export function FrustrationPage({ data, cutoff, since, range }: PageProps) {
  // `rangeView` and `requests()` build fresh objects each call, so both are memoized: sorting or
  // expanding a row re-renders this component, and re-sorting 2000 rows per click froze the page.
  const view = useMemo(() => rangeView(data, range, cutoff, since), [data, range, cutoff, since]);
  const totals = useMemo(() => view.totals(), [view]);
  const rows = useMemo(() => view.requests(), [view]);
  const aborted = useMemo(() => rows.filter((r) => r.st === "aborted"), [rows]);
  const recovered = useMemo(() => recoveries(rows), [rows]);
  const disturbed = totals.errors + totals.aborted;

  return (
    <div className="grid gap-9">
      <StatStrip>
          <StripStat             label="Interrupted"
            value={fmt(totals.aborted)}
            tone={totals.aborted > 0 ? "danger" : "default"}
            sub="runs you stopped"
          />
          <StripStat label="Failed" value={fmt(totals.errors)} tone={totals.errors > 0 ? "danger" : "default"} sub="runs that errored" />
          <StripStat             label="Disturbed share"
            value={totals.runs > 0 ? percent((disturbed / totals.runs) * 100) : "—"}
            sub={`of ${fmt(totals.runs)} runs`}
          />
          <StripStat label="Recovered" value={fmt(recovered)} tone="accent" sub="completed within 5 minutes of an error" />
        </StatStrip>
      <Section title="Disturbance" hint={RANGE_LABELS[range]}>
        {totals.countsPartial && (
          <Note tone="warn">Run counts read the newest 2000 requests, so these are lower bounds for the range.</Note>
        )}
      </Section>

      <Section title="Interrupted runs" hint="Newest first">
        {aborted.length === 0 ? (
          <Note>No interrupted runs in {RANGE_LABELS[range]}.</Note>
        ) : (
          <ul className="m-0 grid list-none divide-y divide-line p-0">
            {aborted.slice(0, 15).map((r, i) => (
              <li key={r.id ?? `${r.t}-${i}`} className="flex items-center gap-3 py-2">
                <span className="mono min-w-0 flex-1 truncate text-xs">{data.modelLabels[r.m] ?? r.m}</span>
                <span className="mono shrink-0 text-[11px] text-dim">
                  {new Date(r.t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
                <StatusBadge r={r} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Note>
          This is a set of signals, not a frustration score. OMP derives its version from correction
          patterns and mid-turn phrasing, which no host writes to these transcripts, so a number here
          would be invented. What is measured is narrow and checkable: a run you interrupted, a run
          that errored, and a completion for the same model within five minutes of that model&apos;s
          error. A high disturbance count has ordinary explanations, including a large refactor or a
          flaky network.
        </Note>
      
    </div>
  );
}
