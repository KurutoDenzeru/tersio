// One omp request, in full: recorded fields only, never a guessed value.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { displayModel, fmt, fmtMs, statusColor, statusLabel, tokensPerSecond, whenStamp } from "@/lib/format";
import type { OmpRequestRow } from "@/lib/data";
import { ProviderMark, VendorMark } from "@/components/brand";
import { Icon } from "@/components/icon";

function DrawerStat({ label, value, tint }: { label: string; value: string; tint?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-track/40 px-3 py-2.5">
      <p className="mono m-0 text-[10px] tracking-[0.14em] text-dim uppercase">{label}</p>
      <p className="mono m-0 mt-1 truncate text-lg font-bold tabular-nums" style={tint ? { color: tint } : undefined}>
        {value}
      </p>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline gap-3 text-[13px]">
      <span className="mono w-24 shrink-0 text-[11px] tracking-[0.1em] text-dim uppercase">{label}</span>
      <span className="mono min-w-0 flex-1 text-right [overflow-wrap:break-word]">{children}</span>
    </div>
  );
}

export function OmpRequestDrawer({
  row,
  money,
  onClose,
}: {
  row: OmpRequestRow | null;
  money: (v: number) => string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  if (!row) return null;
  const tps = tokensPerSecond(row.output, row.durationMs);
  const json = (): string => JSON.stringify({ ...row, tokensPerSecond: tps, time: new Date(row.ts).toISOString() }, null, 2);

  async function copyJson(): Promise<void> {
    const text = json();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-[min(460px,calc(100vw-2rem))] gap-0 overflow-y-auto p-0 sm:max-w-[460px]" aria-describedby={undefined}>
        <SheetHeader className="border-b border-line">
          <div className="flex items-center gap-2.5">
            <VendorMark model={row.model} small />
            <SheetTitle className="font-display pr-8 text-lg tracking-tight">{displayModel(row.model)}</SheetTitle>
          </div>
          <SheetDescription className="mono text-xs text-dim">
            {whenStamp(row.ts)} · {row.stopReason} · {row.api || "unknown api"}
          </SheetDescription>
        </SheetHeader>
        <div className="grid gap-6 p-4">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="mono m-0 text-[10px] tracking-[0.14em] text-dim uppercase">Tokens</p>
              <p className="font-display m-0 text-4xl font-bold tracking-tight tabular-nums">{fmt(row.totalTokens)}</p>
            </div>
            <span
              className="mono inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[11px]"
              style={{ color: statusColor(row.stopReason === "error" ? "error" : row.stopReason) }}
            >
              <span className="size-1.5 rounded-full" style={{ background: statusColor(row.stopReason === "error" ? "error" : row.stopReason) }} />
              {statusLabel({ st: row.stopReason === "error" ? "error" : row.stopReason })}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <DrawerStat label="Input" value={fmt(row.input)} />
            <DrawerStat label="Output" value={fmt(row.output)} />
            <DrawerStat label="Cache read" value={fmt(row.cacheRead)} />
            <DrawerStat label="Cache write" value={fmt(row.cacheWrite)} />
            <DrawerStat label="Elapsed" value={fmtMs(row.durationMs)} />
            <DrawerStat label="First token" value={fmtMs(row.ttftMs)} />
            <DrawerStat label="Throughput" value={tps > 0 ? `${tps.toFixed(1)}/s` : "–"} />
            <DrawerStat label="Cost" value={row.unpriced ? "unpriced" : money(row.costUsd)} />
          </div>

          <div className="grid gap-2.5 rounded-xl border border-line p-3">
            <DetailRow label="Provider">
              <span className="inline-flex items-center gap-2">
                <ProviderMark provider={row.provider} small />
                <span>{row.provider || "–"}</span>
              </span>
            </DetailRow>
            <DetailRow label="Agent">{row.agentType || "–"}</DetailRow>
            <DetailRow label="Project">{row.project || "–"}</DetailRow>
            <DetailRow label="Entry">{row.entryId || "–"}</DetailRow>
            <DetailRow label="Priced">
              {row.unpriced ? "no catalog price, subscription route" : "rate card"}
            </DetailRow>
            <DetailRow label="Session">
              <span className="text-[11px] text-dim">{row.sessionFile}</span>
            </DetailRow>
          </div>

          {row.errorMessage && (
            <div className="grid gap-2 rounded-xl border p-3" style={{ borderColor: "var(--danger-border)", background: "var(--danger-soft)" }}>
              <p className="mono m-0 text-[10px] tracking-[0.14em] uppercase" style={{ color: "var(--danger)" }}>Error</p>
              <p className="mono m-0 text-xs [overflow-wrap:break-word]">{row.errorMessage}</p>
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={copyJson} className="mono gap-2 border-line text-xs">
              <Icon name={copied ? "check" : "copy"} className="size-3.5" />
              {copied ? "Copied" : "Copy JSON"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
