// Gain: what Tersio actually saved, and how far it reached.
import { useMemo } from "react";
import { Note, Section, percent, StatStrip, StripStat } from "@/components/dash/composites";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { rangeView, sumNumbers } from "@/lib/aggregate";
import { fmt, fmtShort } from "@/lib/format";
import { RANGE_LABELS } from "@/lib/route";
import type { PageProps } from "./types";

export function GainPage({ data, cutoff, since, range, money }: PageProps) {
  // `rangeView` returns a fresh object each call, so it is memoized on its inputs; otherwise every
  // memo below misses on each render and re-sums the day tables on each click.
  const view = useMemo(() => rangeView(data, range, cutoff, since), [data, range, cutoff, since]);
  const cacheSaved = useMemo(() => sumNumbers(view.data.byDaySavedUsd, view.cutoff), [view]);
  const adoption = data.rtkAdoption;
  const gain = data.rtkGain;
  // RTK's own history carries no dates, so its total is all-time and is labelled as such.
  const commands = gain.byCommand.slice(0, 15);

  return (
    <div className="grid gap-9">
      <StatStrip>
          <StripStat label="Cache saved" value={money(cacheSaved)} tone="accent" sub={`${RANGE_LABELS[range]} · estimated`} />
          <StripStat label="RTK saved" value={`${fmtShort(gain.saved)} tokens`} tone="accent" sub="all time" />
          <StripStat label="RTK runs" value={fmt(gain.commands)} sub={`across ${fmt(gain.byCommand.length)} commands`} />
          <StripStat             label="Avg shrink"
            value={gain.avgPct > 0 ? percent(gain.avgPct) : "—"}
            tone="accent"
            sub="per RTK run"
          />
        </StatStrip>
      <Note>
          Cache savings come from the cache-read rate on priced models for the selected range. RTK
          savings are counted by RTK itself, are undated, and cannot be sliced by range. The two are
          reported side by side and never summed into one figure, because one is a rate estimate and
          the other is a measured byte count.
        </Note>
      {view.partial && (
        <Note tone="warn">
          The payload holds only the newest 2000 requests, so this range&apos;s cache savings are a lower bound.
        </Note>
      )}
      

      <Section title="RTK savings by command" hint="All time, largest share first">
        {commands.length === 0 ? (
          <Note>No RTK command history on this machine yet.</Note>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-0">Command</TableHead>
                  <TableHead className="text-right">Runs</TableHead>
                  <TableHead className="text-right">Saved</TableHead>
                  <TableHead className="text-right">Avg shrink</TableHead>
                  <TableHead className="pr-0 text-right">Share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {commands.map((c) => (
                  <TableRow key={c.command}>
                    <TableCell className="mono max-w-[320px] truncate pl-0 text-xs" title={c.command}>
                      {c.command}
                    </TableCell>
                    <TableCell className="mono text-right text-xs">{fmt(c.count)}</TableCell>
                    <TableCell className="mono text-right text-xs">{fmtShort(c.saved)}</TableCell>
                    <TableCell className="mono text-right text-xs">{percent(c.avgPct, 1)}</TableCell>
                    <TableCell className="mono pr-0 text-right text-xs">
                      {gain.saved > 0 ? percent((c.saved / gain.saved) * 100, 1) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      <StatStrip>
          <StripStat             label="Eligible calls"
            value={fmt(adoption.eligibleCalls)}
            sub={`of ${fmt(adoption.bashCalls)} shell calls`}
          />
          <StripStat label="Routed via RTK" value={fmt(adoption.rtkCalls)} tone="accent" sub={percent(adoption.adoptionPct)} />
          <StripStat             label="Missed"
            value={fmt(adoption.missedCalls)}
            tone={adoption.missedCalls > 0 ? "danger" : "default"}
            sub="eligible, not routed"
          />
          <StripStat             label="Recall index"
            value={data.rtkRecall.available ? fmt(data.rtkRecall.entries) : "—"}
            sub={data.rtkRecall.available ? data.rtkRecall.mode : "unavailable"}
          />
        </StatStrip>
      <Note>
          An eligible call is a shell command whose leading binary RTK has a rule for. RTK refuses
          some of those on purpose, for example when a later pipeline stage needs the raw output, so
          adoption below 100% is not automatically a miss. Sessions counted: {fmt(adoption.sessions)}.
        </Note>
      
    </div>
  );
}
