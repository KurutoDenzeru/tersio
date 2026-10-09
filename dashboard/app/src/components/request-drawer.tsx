// Side drawer for one recent request: recorded fields only, never guessed.
import { useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Icon } from "./icon";
import { AgentLogo } from "./agent-logos";
import { VendorMark } from "./brand";
import {
  costIsMeasured,
  displayCost,
  displayModel,
  fmt,
  fmtDur,
  hostMeta,
  statusColor,
  statusLabel,
  vendorOf,
  whenStamp,
} from "@/lib/format";
import type { RecentRequestRow } from "@/lib/data";

export function requestDetailJson(r: RecentRequestRow): Record<string, unknown> {
  const tps = r.d !== undefined && r.d > 0 ? r.o / (r.d / 1000) : null;
  return {
    id: r.id ?? null,
    model: displayModel(r.m),
    modelKey: r.m,
    vendor: vendorOf(r.m).name,
    agent: r.h ?? null,
    status: r.st,
    code: r.code ?? null,
    note: r.note ?? null,
    inputTokens: r.i,
    outputTokens: r.o,
    cacheReadTokens: r.cr ?? 0,
    cacheWriteTokens: r.cw ?? 0,
    costUsd: displayCost(r),
    costMeasured: costIsMeasured(r),
    elapsedMs: r.d ?? null,
    tokensPerSecond: tps,
    time: new Date(r.t).toISOString(),
  };
}

function Stat({ label, value, tint }: { label: string; value: string; tint: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-track/40 px-3 py-2.5">
      <p className="mono m-0 text-[10px] tracking-[0.14em] text-dim uppercase">{label}</p>
      <p className="mono m-0 mt-1 truncate text-lg font-bold tabular-nums" style={{ color: tint }}>
        {value}
      </p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline gap-3 text-[13px]">
      <span className="mono w-20 shrink-0 text-[11px] tracking-[0.1em] text-dim uppercase">{label}</span>
      <span className="mono min-w-0 flex-1 text-right [overflow-wrap:break-word]">{children}</span>
    </div>
  );
}

export function RequestDrawer({ row: r, money, onClose }: { row: RecentRequestRow; money: (v: number) => string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const measured = costIsMeasured(r);
  const total = r.i + r.o + (r.cr ?? 0) + (r.cw ?? 0);
  const json = (): string => JSON.stringify(requestDetailJson(r), null, 2);

  async function copyJson(): Promise<void> {
    const text = json();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function downloadJson(): void {
    const blob = new Blob([json()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `tersio-request-${r.t}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-[min(430px,calc(100vw-2rem))] gap-0 overflow-y-auto p-0 sm:max-w-[430px]" aria-describedby={undefined}>
        <SheetHeader className="border-b border-line">
          <div className="flex items-center gap-2.5">
            <VendorMark model={r.m} small />
            <SheetTitle className="font-display pr-8 text-lg tracking-tight">{displayModel(r.m)}</SheetTitle>
          </div>
          <SheetDescription>
            {whenStamp(r.t)}
            {r.d !== undefined ? ` · ${(r.d / 1000).toFixed(1)}s` : ""}
          </SheetDescription>
        </SheetHeader>
        <div className="grid gap-6 p-4">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="mono m-0 text-[10px] tracking-[0.14em] text-dim uppercase">Tokens</p>
              <p className="font-display m-0 text-4xl font-bold tracking-tight tabular-nums">{fmt(total)}</p>
            </div>
            <div className="shrink-0 pb-1 text-right">
              <span
                className="mono inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[11px]"
                style={{ color: statusColor(r.st) }}
              >
                <span className="size-1.5 rounded-full" style={{ background: statusColor(r.st) }} />
                {statusLabel(r)}
              </span>
              <p className="mono m-0 mt-1.5 text-sm font-bold tabular-nums text-accent">
                {measured ? "" : "~"}{money(displayCost(r))}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 grid-flow-dense gap-2">
            <Stat label="Input" value={fmt(r.i)} tint="#fb923c" />
            <Stat label="Output" value={fmt(r.o)} tint="var(--accent)" />
            <Stat label="Cache read" value={fmt(r.cr ?? 0)} tint="var(--dim)" />
            <Stat label="Cache write" value={fmt(r.cw ?? 0)} tint="var(--dim)" />
          </div>
          <section aria-label="Request" className="grid gap-2">
            <Row label="Status">{r.st}{r.code ? ` ${r.code}` : ""}</Row>
            <Row label="Agent">
              <span className="inline-flex items-center justify-end gap-1.5">
                {hostMeta(r.h).label}
                <span className="grid size-4 place-items-center text-ink" role="img" aria-label={hostMeta(r.h).label}>
                  <AgentLogo host={r.h} />
                </span>
              </span>
            </Row>
            <Row label="Elapsed">{fmtDur(r.d)}</Row>
            {r.id && <Row label="ID">{r.id}</Row>}
            {r.note && <p className="m-0 text-xs text-dim [overflow-wrap:break-word]">{r.note}</p>}
          </section>
          <section aria-label="Model" className="grid gap-2 border-t border-line pt-4">
            <Row label="Vendor">{vendorOf(r.m).name}</Row>
            <Row label="Key">{r.m}</Row>
          </section>
        </div>
        <div className="mt-auto flex gap-2 border-t border-line p-4">
          <button
            type="button"
            onClick={() => void copyJson()}
            className="mono flex flex-1 items-center justify-center gap-2 rounded-xl border border-line px-3 py-2 text-xs text-ink [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96]"
          >
            <Icon name={copied ? "check" : "copy"} className="size-3.5" />
            <span>{copied ? "Copied" : "Copy JSON"}</span>
          </button>
          <button
            type="button"
            onClick={downloadJson}
            className="mono flex flex-1 items-center justify-center gap-2 rounded-xl border border-line px-3 py-2 text-xs text-ink [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96]"
          >
            <Icon name="download" className="size-3.5" />
            <span>Download</span>
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
