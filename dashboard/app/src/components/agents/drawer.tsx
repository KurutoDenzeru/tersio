// One agent request, in full: recorded fields only, never a guessed value.
import { useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { displayModel, fmt, fmtMs, hostOfSession, statusColor, statusLabel, tokensPerSecond, whenClock, whenShort, whenStamp } from "@/lib/format";
import type { AgentRequestRow } from "@/lib/data";
import { useAgentRequestEntry } from "@/lib/data";
import { ProviderMark, VendorMark } from "@/components/brand";
import { Icon } from "@/components/icon";

function SectionLabel({ icon, children }: { icon?: string; children: React.ReactNode }) {
  return (
    <p className="mono flex items-center gap-1.5 text-[10px] tracking-[0.14em] text-dim uppercase">
      {icon && <Icon name={icon} className="size-3.5" />}
      {children}
    </p>
  );
}

function DrawerStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-track/40 px-3 py-2.5">
      <p className="mono m-0 truncate text-[10px] tracking-[0.14em] text-dim uppercase">{label}</p>
      <p className="mono m-0 mt-1 truncate text-lg font-bold tabular-nums">{value}</p>
      {hint && <p className="mono m-0 mt-0.5 truncate text-[10px] text-dim">{hint}</p>}
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline gap-3 text-[13px]">
      <span className="mono w-28 shrink-0 text-[11px] tracking-[0.1em] text-dim uppercase">{label}</span>
      <span className="mono min-w-0 flex-1 text-right [overflow-wrap:break-word]">{children}</span>
    </div>
  );
}

function Chip({ children, tint, title }: { children: React.ReactNode; tint?: string; title?: string }) {
  return (
    <span
      title={title}
      className="mono inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[11px]"
      style={tint ? { color: tint } : undefined}
    >
      {children}
    </span>
  );
}

/** One block of raw JSON, with the byte count for size and one click to copy. */
function JsonBlock({ title, data, copy }: { title: string; data: unknown; copy?: string }) {
  const [copied, setCopied] = useState(false);
  const body = data === null || data === undefined ? "" : JSON.stringify(data, null, 2);
  const text = copy ?? body;
  return (
    <div className="grid gap-1.5 rounded-xl border border-line px-3.5 pt-3 pb-2">
      <div className="flex items-center gap-2">
        <SectionLabel>{title}</SectionLabel>
        {body && (
          <span className="mono text-[10px] text-dim">{(new TextEncoder().encode(body).length / 1024).toFixed(1)} KB</span>
        )}
        {text && (
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(text).then(
                () => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                },
                () => undefined,
              );
            }}
            aria-label={`Copy ${title}`}
            className="mono ml-auto inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-[11px] text-dim hover:border-accent hover:text-accent"
          >
            <Icon name={copied ? "check" : "copy"} className="size-3" />
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
      {body ? (
        <pre className="mono m-0 max-h-[420px] overflow-auto rounded-lg border border-line bg-track/40 p-3 text-xs leading-relaxed [overflow-wrap:anywhere]">{body}</pre>
      ) : (
        <p className="mono m-0 text-[11px] text-dim">No payload recorded for this entry.</p>
      )}
    </div>
  );
}

/** The longer payloads stay folded, so the drawer opens on the numbers. */
function Fold({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-xl border border-line px-3.5 pt-3 pb-2">
      <summary className="mono flex cursor-pointer list-none items-center gap-2 text-[10px] tracking-[0.14em] text-dim uppercase hover:text-ink">
        <Icon name="chevron-right" className="size-3 transition-transform group-open:rotate-90" />
        {title}
      </summary>
      <div className="mt-2.5 grid gap-2.5">{children}</div>
    </details>
  );
}

export function AgentRequestDrawer({
  row,
  money,
  onClose,
  onOpenSession,
}: {
  row: AgentRequestRow | null;
  money: (v: number) => string;
  onClose: () => void;
  onOpenSession: (sessionFile: string) => void;
}) {
  const { entry } = useAgentRequestEntry(row?.sessionFile ?? null, row?.entryId ?? null);
  if (!row) return null;
  const tps = tokensPerSecond(row.output, row.durationMs);
  const cost = row.unpriced ? null : row.costUsd;
  const perOutput = cost !== null && row.output > 0 ? cost / row.output : null;
  const state = row.stopReason === "error" ? "error" : row.stopReason;
  const tint = statusColor(state);
  const host = hostOfSession(row.sessionFile);

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-[760px]! max-w-[calc(100vw-2rem)]! gap-0 overflow-y-auto p-0" aria-describedby={undefined}>
        <SheetHeader className="border-b border-line">
          <div className="flex items-center gap-2.5">
            <VendorMark model={row.model} small />
            <SheetTitle className="font-display pr-8 text-lg tracking-tight">{displayModel(row.model)}</SheetTitle>
          </div>
          <SheetDescription className="mono text-xs text-dim">
            {whenStamp(row.ts)} · {row.provider}, {row.api || "unknown api"}
          </SheetDescription>
          <div className="mono mt-1 flex flex-wrap items-center gap-1.5">
            <Chip tint={tint}>
              <span className="size-1.5 rounded-full" style={{ background: tint }} />
              {statusLabel({ st: state })}
            </Chip>
            <Chip title={`Session written by ${host.label}`}>
              <Icon name="terminal" className="size-3 text-dim" />
              {host.label}
            </Chip>
            <button
              type="button"
              onClick={() => onOpenSession(row.sessionFile)}
              className="mono inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[11px] text-dim hover:border-accent hover:text-accent"
            >
              <Icon name="git-branch" className="size-3" />
              Trace
            </button>
          </div>
        </SheetHeader>

        <div className="grid gap-6 p-4">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <SectionLabel icon="coins">Tokens</SectionLabel>
              <p className="font-display m-0 text-4xl font-bold tracking-tight tabular-nums">{fmt(row.totalTokens)}</p>
            </div>
            <div className="mono grid shrink-0 gap-0.5 text-right text-[11px] text-dim">
              <span>{fmt(row.input)} in</span>
              <span>{fmt(row.output)} out</span>
              <span>{tps > 0 ? `${tps.toFixed(1)} tok/s` : "no speed"}</span>
            </div>
          </div>

          <section className="grid gap-2.5">
            <SectionLabel icon="timer">Timing</SectionLabel>
            <div className="grid grid-cols-2 gap-2.5">
              <DrawerStat label="Started" value={whenClock(row.ts)} hint={`${whenShort(row.ts)}, local time`} />
              <DrawerStat label="Duration" value={fmtMs(row.durationMs)} />
              <DrawerStat label="Time to first token" value={fmtMs(row.ttftMs)} />
              <DrawerStat label="Output tokens/s" value={tps > 0 ? `${tps.toFixed(1)}/s` : "n/a"} />
            </div>
          </section>

          <section className="grid gap-2.5">
            <SectionLabel icon="coins">Tokens</SectionLabel>
            <div className="grid grid-cols-2 gap-2.5">
              <DrawerStat label="Uncached input" value={fmt(row.input)} hint={row.totalTokens > 0 ? `${((row.input / row.totalTokens) * 100).toFixed(1)}% of the row` : undefined} />
              <DrawerStat label="Cache read" value={fmt(row.cacheRead)} hint={row.totalTokens > 0 ? `${((row.cacheRead / row.totalTokens) * 100).toFixed(1)}% of the row` : undefined} />
              <DrawerStat label="Cache write" value={fmt(row.cacheWrite)} hint={row.totalTokens > 0 ? `${((row.cacheWrite / row.totalTokens) * 100).toFixed(1)}% of the row` : undefined} />
              <DrawerStat label="Output" value={fmt(row.output)} hint={row.totalTokens > 0 ? `${((row.output / row.totalTokens) * 100).toFixed(1)}% of the row` : undefined} />
              <DrawerStat label="Total" value={fmt(row.totalTokens)} hint="the four buckets summed" />
              <DrawerStat label="Cache hit rate" value={row.input + row.cacheRead > 0 ? `${((row.cacheRead / (row.input + row.cacheRead)) * 100).toFixed(1)}%` : "n/a"} hint="reads over read + input" />
            </div>
          </section>

          <section className="grid gap-2.5">
            <SectionLabel icon="coins">API-equivalent cost</SectionLabel>
            <div className="grid grid-cols-2 gap-2.5">
              <DrawerStat label="Total" value={row.unpriced ? "unpriced" : money(row.costUsd)} />
              <DrawerStat label="Per output token" value={perOutput === null ? "n/a" : `$${perOutput.toFixed(5)}`} hint="total over output" />
            </div>
          </section>

          <section className="grid gap-2.5 rounded-xl border border-line px-3.5 pt-3 pb-2">
            <SectionLabel icon="bot">Agent</SectionLabel>
            <DetailRow label="Session host">
              <span className="inline-flex items-center gap-2">
                <Icon name="terminal" className="size-3.5 text-dim" />
                {host.label}
              </span>
            </DetailRow>
            <DetailRow label="Agent type">
              <span className="inline-flex items-center gap-2">
                <Icon name="bot" className="size-3.5 text-dim" />
                {row.agentType || "unknown agent"}
              </span>
            </DetailRow>
            <DetailRow label="Model">{row.model}</DetailRow>
            <DetailRow label="Thinking">{entry.agent.thinkingLevel ?? "not recorded"}</DetailRow>
            <DetailRow label="Mode">{entry.agent.mode ?? "not recorded"}</DetailRow>
            <DetailRow label="Fallback">{entry.agent.fallback === null ? "not recorded" : entry.agent.fallback ? "yes, resolved as a fallback" : "no"}</DetailRow>
            <DetailRow label="Provider">
              <span className="inline-flex items-center gap-2">
                <ProviderMark provider={row.provider} tiny />
                <span>{row.provider || "unknown provider"}</span>
              </span>
            </DetailRow>
          </section>

          <section className="grid gap-2.5 rounded-xl border border-line px-3.5 pt-3 pb-2">
            <SectionLabel icon="fingerprint">Identity</SectionLabel>
            <DetailRow label="Timestamp">{new Date(row.ts).toISOString()}</DetailRow>
            <DetailRow label="Entry id">{row.entryId || "unknown entry"}</DetailRow>
            <DetailRow label="Stop reason">{row.stopReason || "unknown stop"}</DetailRow>
            <DetailRow label="API">{row.api || "unknown api"}</DetailRow>
            <DetailRow label="Project">{row.project || "unknown project"}</DetailRow>
            <DetailRow label="Priced">{row.unpriced ? "no catalog price, subscription route" : "rate card"}</DetailRow>
            <DetailRow label="Session">
              <span className="text-[11px] text-dim">{row.sessionFile}</span>
            </DetailRow>
          </section>

          {row.errorMessage && (
            <div className="grid gap-2 rounded-xl border px-3.5 pt-3 pb-2" style={{ borderColor: "var(--danger-border)", background: "var(--danger-soft)" }}>
              <p className="mono m-0 text-[10px] tracking-[0.14em] uppercase" style={{ color: "var(--danger)" }}>
                {state === "aborted" ? "Aborted" : "Error"}
              </p>
              <p className="mono m-0 text-xs [overflow-wrap:anywhere]">{row.errorMessage}</p>
            </div>
          )}

          <section className="grid gap-2.5">
            <SectionLabel icon="braces">Payload</SectionLabel>
            <JsonBlock title="Output message" data={entry.output} />
            <Fold title="Session entry">
              <JsonBlock title="Journal entry" data={entry.entry} />
            </Fold>
            <Fold title="Stats row">
              <JsonBlock
                title="Recorded row"
                data={{
                  ts: row.ts,
                  provider: row.provider,
                  model: row.model,
                  project: row.project,
                  agentType: row.agentType,
                  api: row.api,
                  entryId: row.entryId,
                  sessionFile: row.sessionFile,
                  input: row.input,
                  output: row.output,
                  cacheRead: row.cacheRead,
                  cacheWrite: row.cacheWrite,
                  totalTokens: row.totalTokens,
                  costUsd: row.costUsd,
                  unpriced: row.unpriced,
                  durationMs: row.durationMs,
                  ttftMs: row.ttftMs,
                  stopReason: row.stopReason,
                  errorMessage: row.errorMessage,
                  tokensPerSecond: tps > 0 ? Number(tps.toFixed(2)) : null,
                  time: new Date(row.ts).toISOString(),
                }}
              />
            </Fold>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
