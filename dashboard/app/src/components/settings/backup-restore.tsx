// Snapshot list with its schedule, backup, delete and restore actions.
import { useCallback, useEffect, useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtSnapshot } from "@/lib/format";
import { Icon } from "../icon";
import { useToast } from "../toaster";

// Backups are the only way back when a source stops being walked.
const BACKUP_SCHEDULES_UI: Array<{ id: string; label: string; hint: string }> = [
  { id: "monthly", label: "Monthly", hint: "A snapshot a month is kept automatically" },
  { id: "weekly", label: "Weekly", hint: "A snapshot a week" },
  { id: "daily", label: "Daily", hint: "A snapshot a day" },
  { id: "manual", label: "Manual", hint: "Only when the mirror is rebuilt" },
];

// Restoring needs a button and a confirm: picking a row must not restore it.
export function BackupRestore() {
  const toast = useToast();
  const [rows, setRows] = useState<Array<{ file: string; mtime: number; size: number }>>([]);
  const [schedule, setSchedule] = useState("monthly");
  const [chosen, setChosen] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [backing, setBacking] = useState(false);

  const load = useCallback(() => {
    fetch("/backups")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { backups?: Array<{ file: string; mtime: number; size: number }> } | null) => {
        setRows(d?.backups ?? []);
        setChosen((cur) => cur ?? d?.backups?.[0]?.file ?? null);
      })
      .catch(() => setRows([]));
    fetch("/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { backupSchedule?: string } | null) => { if (d?.backupSchedule) setSchedule(d.backupSchedule); })
      .catch(() => { /* keep the default shown */ });
  }, []);
  useEffect(() => { load(); }, [load]);

  const saveSchedule = (next: string): void => {
    setSchedule(next);
    void fetch("/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backupSchedule: next }),
    })
      .then((r) => r.json())
      .then((d: { ok?: boolean; error?: string }) => {
        if (!d?.ok) toast("Could not save", d?.error ?? "Unknown schedule", "circle-alert");
      })
      .catch(() => toast("Could not save", "The dashboard server did not answer.", "circle-alert"));
  };

  const restore = (file: string): void => {
    setBusy(true);
    setAsking(false);
    void fetch("/backups/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file }),
    })
      .then((r) => r.json())
      .then((d: { ok?: boolean; error?: string }) => {
        toast(d?.ok ? "Backup restored" : "Restore failed", d?.ok ? "Reload the dashboard to see the restored totals" : d?.error ?? "Unknown backup", d?.ok ? "check" : "circle-alert");
        if (d?.ok) load();
      })
      .catch(() => toast("Restore failed", "The dashboard server did not answer.", "circle-alert"))
      .finally(() => setBusy(false));
  };

  const remove = (file: string): void => {
    setDeleting(false);
    void fetch("/backups/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { ok?: boolean; error?: string }) => {
        if (d?.ok) { toast("Snapshot deleted", "Removed from disk. The live mirror is unchanged.", "check"); load(); }
        else toast("Delete failed", d?.error ?? "Unknown backup", "circle-alert");
      })
      .catch((e: Error) => toast("Delete failed", /HTTP/.test(e.message) ? "This dashboard build has no delete route — restart the server." : "The dashboard server did not answer.", "circle-alert"));
  };

  const target = rows.find((b) => b.file === chosen) ?? null;
  const scheduleHint = BACKUP_SCHEDULES_UI.find((o) => o.id === schedule)?.hint ?? "";

  return (
    <div className="mt-6 grid gap-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-[13px] font-semibold">Backups</p>
          <p className="mt-0.5 mb-0 text-xs text-dim">
            {BACKUP_SCHEDULES_UI.find((o) => o.id === schedule)?.label} — {scheduleHint}. Keeps the last 3.
          </p>
        </div>
        <Select value={schedule} onValueChange={(v) => saveSchedule(v ?? "monthly")}>
          <SelectTrigger size="sm" className="w-[124px] shrink-0" aria-label="Backup schedule">
            <SelectValue>{BACKUP_SCHEDULES_UI.find((o) => o.id === schedule)?.label ?? "Monthly"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {BACKUP_SCHEDULES_UI.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label}{o.id === "monthly" ? " (Recommended)" : ""}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      {rows.length === 0 ? (
        <p className="m-0 rounded-[10px] border border-line px-3 py-2.5 text-xs text-dim">
          No snapshots yet. One is taken before the mirror is rebuilt, and on the schedule above.
        </p>
      ) : (
        <div className="grid gap-2 overflow-hidden rounded-[10px] border border-line">
          <div className="flex items-baseline justify-between gap-3 border-b border-line px-3 py-2">
            <span className="mono text-[11px] uppercase tracking-[0.14em] text-dim">
              {rows.length} snapshot{rows.length === 1 ? "" : "s"}
            </span>
            <span className="mono text-[11px] text-dim">
              {fmtSnapshot(rows[rows.length - 1].mtime)} → {fmtSnapshot(rows[0].mtime)}
            </span>
          </div>

          {/* Bounded list so a daily schedule cannot push Restore off-screen. */}
          <ul
            className="m-0 max-h-[196px] list-none overflow-y-auto p-1 [scrollbar-width:thin] [scrollbar-color:var(--line)_transparent]"
            role="radiogroup"
            aria-label="Usage snapshots"
          >
            {rows.map((b) => (
              <li key={b.file}>
                <label
                  className={`flex cursor-pointer items-center gap-2.5 rounded-[7px] px-2 py-1.5 text-xs [transition:background_.15s] ${
                    chosen === b.file ? "bg-accent-soft" : "hover:bg-track"
                  }`}
                >
                  <input
                    type="radio"
                    name="usage-backup"
                    className="accent-[var(--accent)]"
                    checked={chosen === b.file}
                    onChange={() => setChosen(b.file)}
                  />
                  <span className="mono">{fmtSnapshot(b.mtime)}</span>
                  {chosen === b.file && <span className="text-dim">· selected</span>}
                  <span className="mono ml-auto shrink-0 text-dim">{(b.size / 1048576).toFixed(1)} MB</span>
                </label>
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between gap-3 border-t border-line px-3 py-2">
            <button
              type="button"
              disabled={backing}
              onClick={() => {
                setBacking(true);
                void fetch("/backups/create", { method: "POST" })
                  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
                  .then((d: { ok?: boolean; error?: string }) => {
                    if (d?.ok) { toast("Backup taken", "Snapshot saved.", "check"); load(); }
                    else toast("Backup failed", d?.error ?? "Unknown backup", "circle-alert");
                  })
                  .catch(() => toast("Backup failed", "The dashboard server did not answer.", "circle-alert"))
                  .finally(() => setBacking(false));
              }}
              aria-label="Back up usage now"
              className="mono flex shrink-0 items-center gap-2 rounded-xl border border-line px-3 py-1.5 text-xs text-ink [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96] disabled:opacity-50"
            >
              <Icon name="database-backup" className="size-3.5" />
              <span>{backing ? "Backing up…" : "Backup now"}</span>
            </button>
            <span className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                disabled={!target || busy}
                onClick={() => setDeleting(true)}
                aria-label="Delete the selected snapshot"
                className="mono flex items-center gap-2 rounded-xl border border-line px-3 py-1.5 text-xs text-[#f87171] [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96] disabled:opacity-50"
              >
                <Icon name="trash" className="size-3.5" />
                <span>Delete</span>
              </button>
              <button
                type="button"
                disabled={!target || busy}
                onClick={() => setAsking(true)}
                className="mono flex items-center gap-2 rounded-xl border border-line px-3 py-1.5 text-xs text-ink [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96] disabled:opacity-50"
              >
                <Icon name="rotate-ccw" className="size-3.5" />
                <span>Restore</span>
              </button>
            </span>
          </div>
        </div>
      )}

      <AlertDialog open={deleting} onOpenChange={(o) => !o && setDeleting(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this snapshot?</AlertDialogTitle>
            <AlertDialogDescription>
              {target ? `${fmtSnapshot(target.mtime)} will be removed from disk. The current usage mirror is not touched.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => target && remove(target.file)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={asking} onOpenChange={(o) => !o && setAsking(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this snapshot?</AlertDialogTitle>
            <AlertDialogDescription>
              {target ? `The usage mirror will be replaced with the snapshot from ${new Date(target.mtime).toLocaleString()}.` : ""}
              {" "}The current mirror is copied aside first, so this is reversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => target && restore(target.file)}>Restore</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
