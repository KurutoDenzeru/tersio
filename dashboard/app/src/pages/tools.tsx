// Tools: which tools ran, and how far RTK reached into shell commands.
import { useMemo } from "react";
import { BarList, Note, Section, percent, StatStrip, StripStat } from "@/components/dash/composites";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { countBy, rangeView } from "@/lib/aggregate";
import { fmt, fmtShort } from "@/lib/format";
import { RANGE_LABELS } from "@/lib/route";
import type { PageProps } from "./types";

function millis(ms: number): string {
  if (!ms) return "—";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function ToolsPage({ data, cutoff, since, range }: PageProps) {
  // `rangeView` returns a fresh object each call, so it is memoized on its inputs; otherwise every
  // memo below misses on each render and re-folds the day tables on each click.
  const view = useMemo(() => rangeView(data, range, cutoff, since), [data, range, cutoff, since]);
  const tools = useMemo(() => countBy(view.data.byDayTool, view.cutoff), [view]);
  const toolRows = useMemo(
    () => tools.slice(0, 12).map(([name, n]) => ({ label: name, value: n, display: fmt(n) })),
    [tools],
  );
  const totalCalls = useMemo(() => tools.reduce((n, [, c]) => n + c, 0), [tools]);

  // RTK history is machine-wide and undated, so it cannot be sliced by range.
  const commands = data.rtkGain.byCommand.slice(0, 15);

  return (
    <div className="grid gap-9">
      <StatStrip>
          <StripStat label="Calls" value={fmt(totalCalls)} sub="tool invocations in range" />
          <StripStat label="Distinct tools" value={fmt(tools.length)} sub="names seen" />
          <StripStat             label="RTK calls"
            value={fmt(data.rtkAdoption.rtkCalls)}
            sub={`of ${fmt(data.rtkAdoption.eligibleCalls)} eligible`}
          />
          <StripStat             label="RTK adoption"
            value={percent(data.rtkAdoption.adoptionPct)}
            tone="accent"
            sub="all time"
          />
        </StatStrip>

      <Section title="By tool" hint="Largest first">
        {view.partial && (
          <Note tone="warn">
            The payload holds only the newest 2000 requests, so this range&apos;s counts are a lower bound.
          </Note>
        )}
        {toolRows.length === 0 ? (
          <Note>No tool calls recorded in {RANGE_LABELS[range]}.</Note>
        ) : (
          <BarList rows={toolRows} empty="No tool calls in this range." />
        )}
        <Note>
          A shell call is recorded as <span className="mono">bash:&lt;command&gt;</span> so the leading
          binary is visible without exposing the full command line.
        </Note>
      </Section>

      <Section title="RTK commands" hint="All time — RTK history is undated">
        {commands.length === 0 ? (
          <Note>No RTK command history found on this machine.</Note>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-0">Command</TableHead>
                    <TableHead className="text-right">Runs</TableHead>
                    <TableHead className="text-right">Tokens saved</TableHead>
                    <TableHead className="text-right">Avg shrink</TableHead>
                    <TableHead className="pr-0 text-right">Avg time</TableHead>
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
                      <TableCell className="mono pr-0 text-right text-xs">{millis(c.avgMs)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Note>
              {`${fmt(data.rtkGain.commands)} command groups, ${fmtShort(data.rtkGain.saved)} tokens saved across ${fmt(data.rtkGain.byCommand.length)} recorded commands. RTK keeps this history outside the session transcripts, so it has no date to filter by.`}
            </Note>
          </>
        )}
      </Section>
    </div>
  );
}
