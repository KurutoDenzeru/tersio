// The CO2 card's detail dialog, written to be read like a utility bill: one
// total, what it is worth, which models caused it, and what it cannot tell you.
// No parameters or grid intensities; the model lives in shared/carbon.ts.
import { useMemo } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { carbonReport, fmtCo2, fmtEnergy, type CarbonReport } from "@/lib/carbon";
import { fmtShort } from "@/lib/format";
import type { UsageReport } from "@/lib/data";
import { Icon } from "./icon";

function ModelShare({ rows, otherG, otherCount, totalG }: {
  rows: CarbonReport["rows"];
  otherG: number;
  otherCount: number;
  totalG: number;
}) {
  if (rows.length === 0) {
    return (
      <p className="m-0 rounded-xl border border-dashed border-line px-4 py-6 text-center text-xs text-dim">
        Nothing to split yet. This fills in once a session writes something back.
      </p>
    );
  }
  const tail = otherCount > 0;
  return (
    <ul className="m-0 grid list-none gap-2.5 p-0">
      {rows.map((r) => (
        <li key={r.model} className="grid gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-[13px] text-ink">{r.label}</span>
            <span className="mono shrink-0 text-xs tabular-nums text-dim">
              {(r.share * 100).toFixed(1)}%
            </span>
          </div>
          {/* Floored so a sliver of a share is still visible rather than a gap. */}
          <span className="block h-1 w-full overflow-hidden rounded-full bg-track">
            <span
              className="block h-full rounded-full bg-accent"
              style={{ width: `${Math.max(r.share * 100, 1.5)}%` }}
            />
          </span>
        </li>
      ))}
      {tail && (
        <li className="flex items-baseline justify-between gap-3 border-t border-line pt-2.5">
          <span className="text-[13px] text-dim">{otherCount} other models</span>
          <span className="mono shrink-0 text-xs tabular-nums text-dim">
            {totalG ? ((otherG / totalG) * 100).toFixed(1) : "0.0"}%
          </span>
        </li>
      )}
    </ul>
  );
}

export function CarbonDialog({ open, onClose, data }: {
  open: boolean;
  onClose: () => void;
  data: UsageReport | null;
}) {
  const r = useMemo(() => carbonReport(data), [data]);
  const driving = r.comparisons.find((c) => c.label === "Driving");
  const hasData = r.rows.length > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="block h-[min(88vh,860px)] max-h-[calc(100dvh-2rem)] w-[min(680px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] gap-0 overflow-hidden rounded-2xl border border-line bg-panel p-0 text-ink shadow-[0_16px_48px_rgba(0,0,0,.35)] sm:max-w-[680px]"
        showCloseButton={false}
        aria-describedby={undefined}
      >
        {/* DialogContent is display:block, so the header and the scroller have to
            be a column for the ScrollArea to get a bounded height. Without this
            the body sizes to its content and the lower half is unreachable. */}
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-4">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
                <Icon name="zap" className="size-4" />
              </span>
              <div className="min-w-0">
                <DialogTitle className="m-0 text-base font-bold tracking-[-0.01em]">Your carbon bill</DialogTitle>
                <p className="mt-0.5 mb-0 text-xs text-dim">One total, then what that total is worth.</p>
              </div>
            </div>
            <button
              type="button"
              className="flex shrink-0 items-center p-2 rounded-xl border border-line text-ink [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96] focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
              aria-label="Close CO2 details"
              onClick={onClose}
            >
              <Icon name="x" className="size-4" />
            </button>
          </div>

          <ScrollArea className="mt-3 min-h-0 flex-1">
            <div className="grid gap-5 overflow-x-hidden px-5 pt-1 pb-5">
              {hasData ? (
                <>
                  {/* The whole reading, lead with the number and the unit that
                      makes it mean something. */}
                  <div className="rounded-xl border border-line bg-bg px-4 py-4">
                    <p className="mono m-0 text-5xl leading-none font-bold tracking-tighter tabular-nums">
                      {fmtCo2(r.totalG)}
                    </p>
                    <p className="m-0 mt-2 max-w-[46ch] text-[13px] text-dim">
                      of carbon dioxide, from everything your coding agents wrote back.
                      That is roughly what driving {driving?.value ?? "0 km"} puts into the air.
                    </p>
                    <p className="mono m-0 mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-dim">
                      <span>Used {fmtEnergy(r.energyWh)} of electricity</span>
                      <span>{fmtShort(r.outputTokens)} words written back</span>
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {r.comparisons.map((c) => (
                      <div key={c.label} className="min-w-0 rounded-xl border border-line px-3 py-2.5">
                        <span className="flex items-center gap-1.5 text-dim">
                          <Icon name={c.icon} className="size-3.5 shrink-0" />
                          <span className="truncate text-[11px]">{c.label}</span>
                        </span>
                        <p className="mono m-0 mt-1.5 truncate text-lg font-bold tabular-nums">{c.value}</p>
                        <p className="m-0 mt-0.5 truncate text-[10px] text-dim">{c.factor}</p>
                      </div>
                    ))}
                  </div>

                  <div className="grid gap-3">
                    <h3 className="m-0 text-[13px] font-semibold">Which models caused it</h3>
                    <ModelShare rows={r.rows} otherG={r.otherG} otherCount={r.otherCount} totalG={r.totalG} />
                  </div>
                </>
              ) : (
                <p className="m-0 rounded-xl border border-dashed border-line px-4 py-6 text-center text-xs text-dim">
                  No readings yet. Open the card once a session has written something back.
                </p>
              )}

              <div className="grid gap-2.5 border-t border-line pt-4">
                <h3 className="m-0 flex items-center gap-1.5 text-[13px] font-semibold">
                  <Icon name="info" className="size-3.5 text-dim" />
                  Good to know
                </h3>
                <ul className="m-0 grid list-none gap-2 p-0 text-xs leading-relaxed text-dim">
                  <li className="flex gap-2">
                    <Icon name="minus" className="mt-[3px] size-3 shrink-0" />
                    <span>
                      We only count the words the AI wrote back. Caching is {r.cacheShare.toFixed(0)}% of your traffic
                      here, and re-reading cached text costs nothing in this estimate, so caching cuts your bill without
                      moving this number.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <Icon name="minus" className="mt-[3px] size-3 shrink-0" />
                    <span>
                      This is a calculation from published averages, not a meter reading. The real figure moves with where
                      the servers run and how busy they are.
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <Icon name="minus" className="mt-[3px] size-3 shrink-0" />
                    <span>
                      Every comparison above shows the rate it used, so you can redo the arithmetic yourself.
                    </span>
                  </li>
                </ul>
                <p className="m-0 text-xs text-dim">
                  Method and figures from{" "}
                  <a
                    href="https://github.com/mlco2/ecologits"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent [transition:background_.2s] hover:bg-accent-soft"
                  >
                    mlco2/ecologits
                  </a>{" "}
                  v{r.ecologits}, released under MPL-2.0.
                </p>
              </div>
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}