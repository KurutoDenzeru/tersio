// Errors: what failed, how often, and why.
import { useMemo } from "react";
import { BarList, Note, Section, percent, StatStrip, StripStat } from "@/components/dash/composites";
import { StatusBadge } from "@/components/recent";
import { countBy, rangeView, sumNumbers } from "@/lib/aggregate";
import { fmt } from "@/lib/format";
import { RANGE_LABELS } from "@/lib/route";
import type { PageProps } from "./types";

/** A failure group is its note, which is where the host puts the actual reason. */
function groupKey(note: string | undefined, code: number | undefined, status: string): string {
  if (note) return note;
  if (code !== undefined) return `HTTP ${code}`;
  return status === "aborted" ? "Interrupted" : "No reason recorded";
}

export function ErrorsPage({ data, cutoff, since, range }: PageProps) {
  // `rangeView` returns a fresh object each call, so it is memoized on its inputs; otherwise every
  // memo below misses on each render and re-folds the day tables on each click.
  const view = useMemo(() => rangeView(data, range, cutoff, since), [data, range, cutoff, since]);
  const totals = useMemo(() => view.totals(), [view]);
  const statusRows = countBy(view.data.byDayErrors, view.cutoff).map(([status, n]) => ({
    label: status === "error" ? "Error" : status === "aborted" ? "Aborted" : status,
    value: n,
    display: fmt(n),
    sub: totals.runs > 0 ? percent((n / totals.runs) * 100) : undefined,
  }));

  const failed = view.requests().filter((r) => r.st !== "completed");
  const groups = new Map<string, number>();
  for (const r of failed) {
    const key = groupKey(r.note, r.code, r.st);
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const groupRows = [...groups.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([label, n]) => ({ label, value: n, display: fmt(n) }));

  // Per-day error counts give a rate that follows the range without needing per-day run totals.
  const errorDays = Object.keys(view.data.byDayErrors).filter((d) => view.cutoff === null || d >= view.cutoff).length;

  return (
    <div className="grid gap-9">
      <StatStrip>
          <StripStat label="Errors" value={fmt(totals.errors)} tone={totals.errors > 0 ? "danger" : "default"} sub="runs that ended in error" />
          <StripStat label="Aborted" value={fmt(totals.aborted)} sub="interrupted mid-run" />
          <StripStat             label="Error rate"
            value={totals.runs > 0 ? percent((totals.errors / totals.runs) * 100) : "—"}
            tone={totals.errors > 0 ? "danger" : "default"}
            sub={`${fmt(totals.runs)} runs in range`}
          />
          <StripStat
            label={view.short ? "Buckets affected" : "Days affected"}
            value={fmt(errorDays)}
            sub={view.short ? "buckets with a failure" : "days with a failure"}
          />
        </StatStrip>
      <Section title="Failure rate" hint={RANGE_LABELS[range]}>
        {totals.countsPartial && (
          <Note tone="warn">Run counts read the newest 2000 requests, so this rate is a lower bound for the range.</Note>
        )}
      </Section>

      <Section title="By status" hint="How runs ended">
        {statusRows.length === 0 ? (
          <Note>No failures recorded in {RANGE_LABELS[range]}. Every run completed.</Note>
        ) : (
          <BarList rows={statusRows} empty="No failures in this range." />
        )}
      </Section>

      <Section title="Failure groups" hint="By recorded reason">
        {groupRows.length === 0 ? (
          <Note>Nothing failed in this range, so there is nothing to group.</Note>
        ) : (
          <BarList rows={groupRows} empty="No failures in this range." />
        )}
        {failed.some((r) => r.note === undefined) && (
          <Note>
            A host only writes a reason when it has one. Runs without one are grouped by status or
            HTTP code instead of being given an invented cause.
          </Note>
        )}
      </Section>

      <Section title="Recent failures" hint="Newest first">
        {failed.length === 0 ? (
          <Note>No failures in this range.</Note>
        ) : (
          <ul className="m-0 grid list-none divide-y divide-line p-0">
            {failed.slice(0, 12).map((r, i) => (
              <li key={r.id ?? `${r.t}-${i}`} className="grid gap-0.5 py-2">
                <div className="flex items-center gap-2">
                  <span className="mono min-w-0 flex-1 truncate text-xs">{data.modelLabels[r.m] ?? r.m}</span>
                  <span className="mono shrink-0 text-[11px] text-dim">
                    {new Date(r.t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <StatusBadge r={r} />
                </div>
                {r.note && <p className="mono m-0 truncate text-[11px] text-dim" title={r.note}>{r.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Note>
          {`Retries are not inferred. A run that failed and was retried by you appears as two rows, and
          counting them as one would be a guess. Total recorded cost of failures is not shown either:
          a failed run still bills for the tokens it produced, and those tokens are already counted in
          token totals. Error rows in range: ${fmt(failed.length)} of ${fmt(sumNumbers(view.data.byDayErrors.error ?? {}, view.cutoff))} recorded errors.`}
        </Note>
      
    </div>
  );
}
