// Data pane: reload, export, snapshots, and the reset control.
import { useEffect, useState } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { isFileExport, postReset } from "@/lib/data";
import type { UsageReport } from "@/lib/data";
import { HoverTip } from "../common";
import { Icon } from "../icon";
import { useToast } from "../toaster";
import { BackupRestore } from "./backup-restore";

type ExportFormat = "json" | "jsonl" | "csv";
// Hints stay short: each sits right of its label on a single line.
const EXPORT_FORMATS: Array<{ id: ExportFormat; label: string; hint: string }> = [
  { id: "json", label: "JSON", hint: "Full report" },
  { id: "jsonl", label: "JSONL", hint: "One request per line" },
  { id: "csv", label: "CSV", hint: "Spreadsheet table" },
];


export function DataPane({ data, onReload }: { data: UsageReport | null; onReload: () => void }) {
  const toast = useToast();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(id);
  }, [armed]);
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-[13px] font-semibold">Reload</p>
          <p className="mt-0.5 mb-0 text-xs text-dim">Re-read statistics from disk.</p>
        </div>
        <button
          type="button"
          className="mono flex shrink-0 items-center gap-2 text-xs pl-2.5 pr-3 py-2 rounded-xl border border-line text-ink [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96]"
          aria-label="Reload data"
          onClick={() => { onReload(); toast("Reloaded", "Statistics re-read from disk.", "refresh-cw"); }}
        >
          <Icon name="refresh-cw" className="size-3.5" />
          <span>Reload</span>
        </button>
      </div>
      <BackupRestore />
      {/* Export shares the Usage DB row since it is the same data. */}
      <div className="mt-3">
        <div className="flex items-center justify-between gap-3 overflow-hidden rounded-[10px] border border-line px-3 py-2">
          <div className="min-w-0">
            <p className="m-0 text-[13px] font-semibold">
              Usage DB <span className="text-[11px] font-normal text-dim">tersio-owned · local hosted</span>
            </p>
            <HoverTip content={data?.paths.usageDb ?? "–"}>
              <p className="mono mt-1 mb-0 truncate text-[11px] text-dim">
                {data?.paths.usageDb ?? "–"}
              </p>
            </HoverTip>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="mono flex shrink-0 items-center gap-1.5 rounded-[10px] border border-line px-2.5 py-1.5 text-xs text-ink [transition:transform_.12s,background_.2s] hover:border-accent hover:bg-accent-soft active:scale-[.96] focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
                  aria-label="Export usage data"
                />
              }
            >
              <Icon name="download" className="size-3.5" />
              <span>Export</span>
              <Icon name="chevron-down" className="size-3 text-dim" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[248px] bg-panel text-ink">
              <DropdownMenuGroup>
                {EXPORT_FORMATS.map((f) => (
                  <DropdownMenuItem
                    key={f.id}
                    className="justify-between whitespace-nowrap"
                    onClick={() => {
                      const a = document.createElement("a");
                      a.href = `/export?format=${f.id}`;
                      a.download = "";
                      document.body.appendChild(a);
                      a.click();
                      a.remove();
                      toast(`Exported ${f.label}`, `${data?.recent.length ?? 0} requests downloaded`, "download");
                    }}
                  >
                    <span className="font-medium">{f.label}</span>
                    <span className="pl-4 text-[11px] text-dim">{f.hint}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="mt-4 rounded-xl border border-danger-border bg-danger-soft p-3">
        <p className="m-0 mb-2.5 text-[11px] tracking-[0.14em] text-danger uppercase">Danger zone</p>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="m-0 text-[13px] font-semibold">Reset statistics</p>
            <p className="mt-0.5 mb-0 text-xs text-dim">Clears tersio statistics. Host-owned files stay intact. Click twice to confirm.</p>
          </div>
          <button
            type="button"
            className="mono flex shrink-0 items-center gap-2 text-xs pl-2.5 pr-3 py-2 rounded-xl border border-danger-border text-danger [transition:transform_.12s,background_.2s,box-shadow_.2s] hover:bg-accent-soft hover:shadow-[0_0_14px_var(--danger-border)] active:scale-[.96]"
            aria-label="Reset tersio statistics"
            disabled={busy}
            onClick={() => {
              if (isFileExport()) return;
              if (!armed) {
                setArmed(true);
                return;
              }
              setArmed(false);
              setBusy(true);
              void postReset()
                .then((ok) => {
                  if (ok) {
                    onReload();
                    toast("Statistics reset", "The usage statistics view now starts fresh. Transcripts and RTK history were never touched.", "rotate-ccw");
                  } else {
                    toast("Reset failed", "Could not reach the server. Try again.", "circle-alert");
                  }
                })
                .finally(() => setBusy(false));
            }}
          >
            <Icon name="rotate-ccw" className="size-3.5" />
            <span>{busy ? "Clearing…" : armed ? "Sure?" : "Reset"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
