// Projects: usage per working directory, which is the only project identity the transcripts carry.
import { useMemo } from "react";
import { BarList, Note, Section, percent, StatStrip, StripStat } from "@/components/dash/composites";
import { byProject, rangeView, sumNumbers, tokensOf } from "@/lib/aggregate";
import { fmt, fmtShort } from "@/lib/format";
import { RANGE_LABELS } from "@/lib/route";
import type { PageProps } from "./types";

/** A path is identified by its tail, so truncate the front or every row looks identical. */
function shortPath(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.length <= 2 ? path : `…/${segments.slice(-2).join("/")}`;
}

export function ProjectsPage({ data, cutoff, since, range, money }: PageProps) {
  // `rangeView` returns a fresh object each call, so it is memoized on its inputs; otherwise every
  // memo below misses on each render and re-folds the day tables on each click.
  const view = useMemo(() => rangeView(data, range, cutoff, since), [data, range, cutoff, since]);
  const projects = useMemo(() => byProject(view.data.byDayProject, view.cutoff), [view]);
  const grand = useMemo(() => projects.reduce((n, [, b]) => n + tokensOf(b), 0), [projects]);
  const totals = useMemo(() => view.totals(), [view]);

  const rows = useMemo(
    () =>
      projects.slice(0, 12).map(([path, b]) => ({
        label: shortPath(path),
        value: tokensOf(b),
        display: fmtShort(tokensOf(b)),
        sub: `${percent(grand > 0 ? (tokensOf(b) / grand) * 100 : 0, 1)}`,
      })),
    [projects, grand],
  );

  return (
    <div className="grid gap-9">
      <StatStrip>
          <StripStat label="Projects" value={fmt(projects.length)} sub="working directories" />
          <StripStat label="Tokens" value={fmtShort(grand)} sub={`${fmt(totals.tokens.output)} out`} />
          <StripStat             label="Largest share"
            value={grand > 0 && projects.length ? percent((tokensOf(projects[0][1]) / grand) * 100) : "—"}
            sub={projects.length ? shortPath(projects[0][0]) : "—"}
          />
          <StripStat label="Measured spend" value={money(sumNumbers(view.data.byDayCost, view.cutoff))} sub="not attributable per project" />
        </StatStrip>

      <Section title="By project" hint="Tokens in range, largest first">
        {view.short && (
          <Note>
            Recent requests carry no working directory, so projects are only available for ranges of 7
            days or more.
          </Note>
        )}
        {rows.length === 0 ? (
          <Note>No project directory recorded in {RANGE_LABELS[range]}.</Note>
        ) : (
          <BarList rows={rows} empty="No project recorded in this range." />
        )}
      </Section>

      <Section title="Reading this page">
        <Note>
          A project is the session working directory, taken from each transcript&apos;s header. Only
          pi and OMP write one: OpenCode records no cwd, so its usage appears in every total except
          this page. Two checkouts of the same name in different parents stay separate, which is why
          only the tail of each path is shown.
        </Note>
        {projects.length > 12 && (
          <Note>Showing the top 12 of {fmt(projects.length)} projects in this range.</Note>
        )}
      </Section>
    </div>
  );
}
