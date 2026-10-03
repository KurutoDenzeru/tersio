// Settings, share, and footer dialogs.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTheme, useResolvedTheme } from "@/components/theme-provider";
import { ACCENTS, ACCENT_IDS, accentSwatch, type AccentId } from "@/lib/accent";
import { fmt, fmtShort, fmtSnapshot, relAge } from "@/lib/format";
import { shareUrl } from "@/lib/share";
import {
  fetchDoctor,
  fetchHealth,
  isFileExport,
  postDoctorFix,
  postDoctorSchedule,
  postReset,
} from "@/lib/data";
import type { DoctorReport, HealthReport, UsageReport } from "@/lib/data";
import { useToast } from "./toaster";
import { CurrencyPicker } from "./savings";
import { HoverTip } from "./common";
import { Icon } from "./icon";
import { OmpLogo, OpencodeLogo, PiLogo } from "./agent-logos";

type Pane = "general" | "connection" | "diagnosis" | "data";

interface AgentRowProps {
  name: string;
  version: string | null;
  binPath: string | null;
  bin: string;
  docs: string;
  available: boolean;
  unavailable: boolean;
  logo: ReactNode;
}

function AgentRow({ name, version, binPath, bin, docs, available, unavailable, logo }: AgentRowProps) {
  const status = unavailable ? "Unavailable" : available ? "Available" : "Not detected on PATH";
  return (
    <a
      href={docs}
      target="_blank"
      rel="noreferrer"
      className="group flex min-w-0 items-center gap-3 py-3 transition-colors hover:bg-track/40 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
      aria-label={`Open ${name}`}
    >
      {/* text-ink keeps masked marks legible in both themes. */}
      <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-md bg-track p-1 text-ink transition-transform duration-500 ease-out group-hover:scale-105">
        {logo}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="truncate text-sm font-semibold">{name}</span>
          {version && <span className="mono text-xs whitespace-nowrap text-dim">{version}</span>}
        </div>
        <div className="mt-0.5 min-w-0 text-xs text-dim">
          {binPath ? (
            <HoverTip content={binPath}>
              <span className="mono block truncate">{binPath}</span>
            </HoverTip>
          ) : available ? (
            <span>Available as {bin} on PATH.</span>
          ) : unavailable ? (
            <span>Health information is unavailable.</span>
          ) : (
            <span>Not detected on PATH as {bin}.</span>
          )}
        </div>
      </div>
      <Badge variant={available ? "secondary" : unavailable ? "destructive" : "outline"} className="ml-auto shrink-0 gap-1.5 px-2 py-0.5 text-xs whitespace-nowrap">
        <span className={`size-1.5 rounded-full ${available ? "bg-accent" : unavailable ? "bg-danger" : "bg-track"}`} />
        {status}
      </Badge>
      <Icon name="chevron-right" className="size-4 shrink-0 text-dim" />
    </a>
  );
}

// Share destinations live in lib/share.ts so the host guarantee is testable.

function HealthPane() {
  const [health, setHealth] = useState<HealthReport | null | undefined>(undefined);
  const [refreshing, setRefreshing] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const load = useCallback(() => {
    setRefreshing(true);
    void fetchHealth().then((report) => {
      setHealth(report);
      if (report) setCheckedAt(Date.now());
      setRefreshing(false);
    });
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const unavailable = health === null;
  // Absent hosts still show their binary name and lookup path.
  const agents: AgentRowProps[] = [
    { name: "Oh My Pi", version: health?.omp ?? null, binPath: health?.ompPath ?? null, bin: "omp", docs: "https://omp.sh", available: !!health?.omp, unavailable, logo: <OmpLogo className="size-5" /> },
    { name: "Pi", version: health?.pi ?? null, binPath: health?.piPath ?? null, bin: "pi", docs: "https://pi.dev", available: !!health?.pi, unavailable, logo: <PiLogo className="size-5" /> },
    { name: "OpenCode", version: health?.opencode ?? null, binPath: health?.opencodePath ?? null, bin: "opencode", docs: "https://opencode.ai", available: !!health?.opencode, unavailable, logo: <OpencodeLogo className="size-5" /> },
  ];

  return (
    <div>
      <div className="flex items-start justify-between gap-3 border-b border-line pb-4">
        <div className="min-w-0">
          <p className="m-0 text-[13px] font-semibold">Coding agents</p>
          <p className="mt-0.5 mb-0 text-xs text-dim">Manage AI agent CLIs installed on this computer.</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={load} disabled={refreshing} aria-label="Refresh coding agent status">
          {refreshing ? <Spinner /> : <Icon name="refresh-cw" />}
          Refresh
        </Button>
      </div>
      {health === undefined ? (
        <div className="flex items-center gap-4 border-b border-line py-4" role="status">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-track">
            <Spinner />
          </span>
          <div className="grid gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
        </div>
      ) : (
        <div className="divide-y divide-line">
          {agents.map((agent) => (
            <AgentRow key={agent.name} {...agent} />
          ))}
        </div>
      )}
      {checkedAt && (
        <p className="mt-2.5 text-xs text-dim" role="status">
          Checked just now
        </p>
      )}
    </div>
  );
}

function DoctorPane() {
  const toast = useToast();
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [fixing, setFixing] = useState(false);
  useEffect(() => {
    void fetchDoctor(false).then((d) => d && setReport(d));
  }, []);
  const groups = (() => {
    const seen: string[] = [];
    (report?.rows ?? []).forEach((r) => {
      if (!seen.includes(r.group || "Other")) seen.push(r.group || "Other");
    });
    return seen;
  })();
  const schedule = report?.schedule ?? "manual";
  const scheduleLabel = `${schedule[0].toUpperCase()}${schedule.slice(1)}`;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="pr-2.5 pb-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-[13px] font-semibold">Auto-check</p>
          <p className="mt-0.5 mb-0 text-xs text-dim">{report?.checkedAt ? `Checked ${relAge(report.checkedAt)}.` : "Never checked."}</p>
        </div>
        <Select
          value={schedule}
          onValueChange={(v) => {
            if (isFileExport()) return;
            void postDoctorSchedule(v as DoctorReport["schedule"]).then((d) => d && setReport(d));
          }}
        >
          <SelectTrigger size="sm" aria-label="Diagnosis schedule">
            <SelectValue>{scheduleLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {["manual", "daily", "weekly", "monthly"].map((s) => (
                <SelectItem key={s} value={s}>
                  {s[0].toUpperCase() + s.slice(1)}{s === "weekly" ? " (Recommended)" : ""}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div className="mt-3.5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-[13px] font-semibold">Scan</p>
          <p className="mt-0.5 mb-0 text-xs text-dim">Runs every check fresh and refreshes the list below.</p>
        </div>
        <button
          type="button"
          className="mono flex shrink-0 items-center gap-2 text-xs pl-2.5 pr-3 py-2 rounded-xl border border-line text-ink [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96]"
          aria-label="Scan now"
          onClick={() => {
            void fetchDoctor(true).then((d) => {
              if (d) setReport(d);
              else if (isFileExport()) toast("Snapshot export", "Live scan needs tersio dashboard.", "scan-line");
            });
          }}
        >
          <Icon name="scan-line" className="size-3.5" />
          <span>Scan</span>
        </button>
      </div>
      <Table className="mt-4 border-y border-line">
        <TableCaption className="sr-only">Diagnosis check results</TableCaption>
        <TableHeader className="sticky top-0 z-10 bg-panel">
          <TableRow>
            <TableHead className="h-9 pl-3 text-[11px] tracking-[0.12em] text-dim uppercase">Check</TableHead>
            <TableHead className="h-9 w-28 pr-3 text-right text-[11px] tracking-[0.12em] text-dim uppercase">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {!report && Array.from({ length: 5 }).map((_, i) => (
            <TableRow key={i} aria-hidden="true">
              <TableCell className="py-3 pl-3">
                <Skeleton className="h-4 w-[42%]" />
                <Skeleton className="mt-1.5 h-3 w-[64%]" />
              </TableCell>
              <TableCell className="py-3 pr-3 text-right">
                <Skeleton className="ml-auto h-5 w-16 rounded-full" />
              </TableCell>
            </TableRow>
          ))}
          {groups.map((g) => [
            <TableRow key={`${g}-group`} className="hover:bg-transparent">
              <TableCell colSpan={2} className="bg-track/50 px-3 py-2 text-[10px] font-semibold tracking-[0.14em] text-dim uppercase">
                {g}
              </TableCell>
            </TableRow>,
            ...(report?.rows ?? [])
              .filter((r) => (r.group || "Other") === g)
              .map((r) => (
                <TableRow key={r.label}>
                  <TableCell className="py-3 pl-3">
                    <p className="m-0 font-semibold text-ink">{r.label}</p>
                    {r.detail && <p className="mono mt-0.5 mb-0 max-w-[480px] truncate text-xs text-dim">{r.detail}</p>}
                  </TableCell>
                  <TableCell className="py-3 pr-3 text-right">
                    <Badge variant={r.ok ? "success" : "destructive"}>
                      <span className={`size-1.5 rounded-full ${r.ok ? "bg-accent" : "bg-danger"}`} />
                      {r.ok ? "Pass" : "Fix"}
                    </Badge>
                  </TableCell>
                </TableRow>
              )),
          ])}
        </TableBody>
      </Table>
        </div>
      </ScrollArea>
      <div className="flex shrink-0 items-center justify-between gap-3 rounded-xl border border-warn-border bg-warn-soft px-3.5 py-3">
        <div className="min-w-0">
          <p className="m-0 text-[13px] font-semibold">Fix issues</p>
          <p className="mt-0.5 mb-0 text-xs text-dim">Repairs extension files, config registrations, and the bundled ponytail copy. RTK binary and CLI update stay manual.</p>
        </div>
        <button
          type="button"
          className="mono flex shrink-0 items-center gap-2 text-xs pl-2.5 pr-3 py-2 rounded-xl border border-line text-ink [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96]"
          aria-label="Fix diagnosed issues"
          disabled={fixing}
          onClick={() => {
            if (isFileExport()) {
              toast("Serve with tersio dashboard", "Fix runs on the live server only.", "wrench");
              return;
            }
            setFixing(true);
            void postDoctorFix()
              .then((d) => {
                if (!d) toast("Fix failed", "Could not reach the server.", "circle-alert");
                else if (d.failed.length) toast("Fix incomplete", d.failed.join(", "), "circle-alert");
                else toast("Fix done", "Repairs applied. Restart OMP.", "wrench");
                return fetchDoctor(true);
              })
              .then((d) => d && setReport(d))
              .finally(() => setFixing(false));
          }}
        >
          <Icon name="wrench" className="size-3.5" />
          <span>{fixing ? "Fixing…" : "Fix issues"}</span>
        </button>
      </div>
    </div>
  );
}

type ExportFormat = "json" | "jsonl" | "csv";
// Hints stay short: each sits right of its label on a single line.
const EXPORT_FORMATS: Array<{ id: ExportFormat; label: string; hint: string }> = [
  { id: "json", label: "JSON", hint: "Full report" },
  { id: "jsonl", label: "JSONL", hint: "One request per line" },
  { id: "csv", label: "CSV", hint: "Spreadsheet table" },
];

// Backups are the only way back when a source stops being walked.
const BACKUP_SCHEDULES_UI: Array<{ id: string; label: string; hint: string }> = [
  { id: "monthly", label: "Monthly", hint: "A snapshot a month is kept automatically" },
  { id: "weekly", label: "Weekly", hint: "A snapshot a week" },
  { id: "daily", label: "Daily", hint: "A snapshot a day" },
  { id: "manual", label: "Manual", hint: "Only when the mirror is rebuilt" },
];

// Restoring needs a button and a confirm: picking a row must not restore it.
function BackupRestore() {
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

function DataPane({ data, onReload }: { data: UsageReport | null; onReload: () => void }) {
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

const PANES: Array<{ id: Pane; label: string; icon: string }> = [
  { id: "general", label: "General", icon: "settings" },
  { id: "connection", label: "Connection", icon: "plug" },
  { id: "diagnosis", label: "Diagnosis", icon: "stethoscope" },
  { id: "data", label: "Data", icon: "database" },
];

const TITLES: Record<Pane, string> = {
  general: "General",
  connection: "Connection",
  diagnosis: "Diagnosis",
  data: "Data",
};

const SETTINGS_SEARCH: Array<{ pane: Pane; label: string; terms: string }> = [
  { pane: "general", label: "Combo preset", terms: "general default mode combo preset balanced max medium off new session resume start caveman rtk ponytail" },
  { pane: "general", label: "Theme", terms: "general appearance theme light dark system color scheme mode" },
  { pane: "general", label: "Accent color", terms: "general appearance accent color tint buttons links highlights palette emerald violet slate cyan rose amber orange charts background" },
  { pane: "general", label: "Currency", terms: "currency display cost usd euro" },
  { pane: "connection", label: "Coding agents", terms: "connection provider coding agents agent oh my pi omp status path version refresh ready available" },
  { pane: "diagnosis", label: "Auto-check schedule", terms: "diagnosis system health auto-check schedule manual daily weekly monthly" },
  { pane: "diagnosis", label: "Scan", terms: "diagnosis scan check" },
  { pane: "diagnosis", label: "Fix issues", terms: "diagnosis repair fix issues" },
  { pane: "data", label: "Reload data", terms: "data reload refresh statistics disk database usage db path" },
  { pane: "data", label: "Export data", terms: "data export download json jsonl csv spreadsheet format save file" },
  { pane: "data", label: "Reset statistics", terms: "data danger zone reset clear statistics" },
];

function HighlightMatch({ text, query, fullWhenAlias = false }: { text: string; query: string; fullWhenAlias?: boolean }) {
  if (!query) return text;
  const ranges = query
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const index = text.toLowerCase().indexOf(token);
      return index >= 0 ? { start: index, end: index + token.length } : null;
    })
    .filter((range): range is { start: number; end: number } => range !== null)
    .sort((a, b) => a.start - b.start);
  if (ranges.length === 0) return fullWhenAlias ? <mark className="rounded-[2px] bg-amber-300 px-0.5 text-inherit dark:bg-amber-300/40">{text}</mark> : text;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const [index, range] of ranges.entries()) {
    if (range.start < cursor) continue;
    if (range.start > cursor) parts.push(text.slice(cursor, range.start));
    parts.push(<mark key={`${range.start}-${index}`} className="rounded-[2px] bg-amber-300 px-0.5 text-inherit dark:bg-amber-300/40">{text.slice(range.start, range.end)}</mark>);
    cursor = range.end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

interface DefaultsPayload {
  comboDefault: string;
  cavemanDefault: string;
  rtkDefault: boolean;
  ponytailDefault: string;
}

const DEFAULT_ROWS_UI: Array<{ field: keyof DefaultsPayload; label: string; hint: string; options: Array<{ id: string; label: string }> }> = [
  {
    field: "comboDefault",
    label: "Combo preset",
    hint: "Sets caveman, RTK and Ponytail together.",
    options: [
      { id: "off", label: "Off" },
      { id: "medium", label: "Medium" },
      { id: "balanced", label: "Balanced (Recommended)" },
      { id: "max", label: "Max" },
    ],
  },
  {
    field: "cavemanDefault",
    label: "Caveman",
    hint: "Terse-reply mode for a new or resumed session.",
    options: [
      { id: "off", label: "Off" }, { id: "lite", label: "Lite" },
      { id: "full", label: "Full" }, { id: "ultra", label: "Ultra" },
      { id: "wenyan-lite", label: "Wenyan lite" }, { id: "wenyan-full", label: "Wenyan full" },
      { id: "wenyan-ultra", label: "Wenyan ultra" },
    ],
  },
  {
    field: "rtkDefault",
    label: "RTK",
    hint: "Rewrite eligible Bash calls through rtk.",
    options: [{ id: "on", label: "On" }, { id: "off", label: "Off" }],
  },
  {
    field: "ponytailDefault",
    label: "Ponytail",
    hint: "Lazy-code mode for a new or resumed session.",
    options: [
      { id: "off", label: "Off" }, { id: "lite", label: "Lite" },
      { id: "full", label: "Full" }, { id: "ultra", label: "Ultra" },
    ],
  },
];

// Session-start defaults mirror `tersio settings`; each row saves on its own.
function DefaultModes() {
  const toast = useToast();
  const [current, setCurrent] = useState<DefaultsPayload>({
    comboDefault: "off", cavemanDefault: "off", rtkDefault: false, ponytailDefault: "off",
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Partial<DefaultsPayload> | null) => { if (alive && d) setCurrent((c) => ({ ...c, ...d })); })
      .catch(() => { /* keep the defaults; the rows still save */ })
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);

  const save = (row: (typeof DEFAULT_ROWS_UI)[number], id: string): void => {
    const value: string | boolean = row.field === "rtkDefault" ? id === "on" : id;
    setCurrent((c) => ({ ...c, [row.field]: value }));
    void fetch("/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [row.field]: value }),
    })
      .then((r) => r.json())
      .then((d: { ok?: boolean; error?: string }) => {
        if (d?.ok) toast(`${row.label} saved`, `${id} applies to new sessions`, "check");
        else toast("Could not save", d?.error ?? "Unknown level", "circle-alert");
      })
      .catch(() => toast("Could not save", "The dashboard server did not answer.", "circle-alert"));
  };

  return (
    <div className="grid gap-6">
      {DEFAULT_ROWS_UI.map((row) => {
        const raw = current[row.field];
        const isRtk = row.field === "rtkDefault";
        const value = isRtk ? (raw ? "on" : "off") : String(raw ?? "off");
        // A live preset writes all three, so they are inert; Off makes them the only input.
        const presetOn = current.comboDefault !== "off";
        const locked = !loaded || (presetOn && row.field !== "comboDefault");
        if (isRtk) {
          return (
            <div key={row.field} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="m-0 text-[13px] font-semibold">{row.label}</p>
                <p className="mt-0.5 mb-0 text-xs text-dim">{row.hint}</p>
              </div>
              <Switch
                size="sm"
                checked={Boolean(raw)}
                onCheckedChange={(on: boolean) => save(row, on ? "on" : "off")}
                disabled={locked}
                aria-label={`${row.label} default`}
              />
            </div>
          );
        }
        return (
          <div key={row.field} className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="m-0 text-[13px] font-semibold">{row.label}</p>
              <p className="mt-0.5 mb-0 text-xs text-dim">{row.hint}</p>
            </div>
            <Select value={value} onValueChange={(v) => save(row, v ?? "off")} disabled={locked}>
              <SelectTrigger size="sm" className="w-[132px] shrink-0" aria-label={`${row.label} default`}>
                {/* SelectValue needs children or it shows the raw value. */}
                <SelectValue placeholder="Off">{row.options.find((o) => o.id === value)?.label ?? "Off"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {row.options.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        );
      })}
    </div>
  );
}

// Native radio group; each chip previews its resolved hex.
function AccentPicker({ accent, onPick }: { accent: AccentId; onPick: (id: AccentId) => void }) {
  const dark = useResolvedTheme() === "dark";
  return (
    <fieldset className="m-0 shrink-0 border-0 p-0">
      <legend className="sr-only">Accent color</legend>
      <div className="flex items-center gap-1.5">
        {ACCENT_IDS.map((id) => {
          const on = id === accent;
          const hex = accentSwatch(id, dark);
          return (
            <label key={id} className="grid size-7 cursor-pointer place-items-center rounded-full">
              <input
                type="radio"
                name="accent-color"
                value={id}
                checked={on}
                onChange={() => onPick(id)}
                className="peer absolute size-7 appearance-none rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              />
              <span
                aria-hidden="true"
                className="size-6 rounded-full peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
                style={{
                  background: hex,
                  // The selected chip rings twice; an unselected one never does.
                  ...(on ? { boxShadow: `0 0 0 2px var(--panel), 0 0 0 4px ${hex}` } : {}),
                }}
              />
              <span className="sr-only">{ACCENTS[id].label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function SettingsDialog({
  open,
  onClose,
  data,
  cur,
  onCurrency,
  onReload,
}: {
  open: boolean;
  onClose: () => void;
  data: UsageReport | null;
  cur: string;
  onCurrency: (code: string) => void;
  onReload: () => void;
}) {
  const toast = useToast();
  const { theme, setTheme, accent, setAccent } = useTheme();
  const [pane, setPane] = useState<Pane>("general");
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const matchesSettings = (terms: string): boolean => queryTokens.every((token) => terms.includes(token));
  const matches = normalizedQuery
    ? SETTINGS_SEARCH.filter((item) => matchesSettings(item.terms))
    : [];
  const matchingPanes = new Set(matches.map((item) => item.pane));
  const shown = PANES.filter((p) => !normalizedQuery || matchingPanes.has(p.id));
  const updateQuery = (value: string): void => {
    setQuery(value);
    const next = value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const match = SETTINGS_SEARCH.find((item) => next.every((token) => item.terms.includes(token)));
    if (match) setPane(match.pane);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="block h-[min(88vh,800px)] max-h-[calc(100dvh-2rem)] w-[min(920px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] sm:max-w-[920px] gap-0 overflow-hidden rounded-2xl border border-line bg-panel p-0 text-ink shadow-[0_16px_48px_rgba(0,0,0,.35)]" showCloseButton={false} aria-describedby={undefined}>
        <div className="grid h-full min-h-0 max-h-full grid-cols-[240px_minmax(0,1fr)] max-sm:grid-cols-1">
          <aside className="flex min-h-0 flex-col gap-2.5 border-r border-line bg-panel px-3 py-4 max-sm:border-r-0 max-sm:border-b" aria-label="Settings sections">
            <div className="flex items-center gap-2 rounded-[10px] border border-line px-2.5 py-2 text-dim">
              <Icon name="search" className="size-4" />
              <input
                type="search"
                placeholder="Search settings"
                aria-label="Search settings"
                aria-controls="settings-search-results"
                autoComplete="off"
                value={query}
                onChange={(e) => updateQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") updateQuery("");
                }}
                className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none [&::-webkit-search-cancel-button]:hidden"
              />
              {query && (
                <button
                  type="button"
                  className="grid size-5 place-items-center rounded-md text-dim hover:bg-track hover:text-ink"
                  aria-label="Clear settings search"
                  onClick={() => updateQuery("")}
                >
                  <Icon name="x" className="size-3" />
                </button>
              )}
            </div>
            <nav id="settings-search-results" className="grid gap-0.5 overflow-y-auto" aria-label="Settings">
              {shown.map((p) => {
                const paneMatches = matches.filter((item) => item.pane === p.id);
                return (
                  <div key={p.id} className="contents">
                    <button type="button" className={`flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13px] text-ink hover:bg-track ${pane === p.id ? "bg-track font-semibold" : "bg-transparent font-normal"}`} onClick={() => setPane(p.id)}>
                      <Icon name={p.icon} className="size-4" />
                      <span><HighlightMatch text={p.label} query={normalizedQuery} /></span>
                      {normalizedQuery && <span className="ml-auto text-[10px] text-dim">{paneMatches.length} match{paneMatches.length === 1 ? "" : "es"}</span>}
                    </button>
                    {normalizedQuery && paneMatches.map((item) => (
                      <button
                        key={`${item.pane}-${item.label}`}
                        type="button"
                        className="ml-7 mr-2 rounded-lg px-2 py-1.5 text-left text-xs text-dim hover:bg-track hover:text-ink"
                        onClick={() => setPane(item.pane)}
                      >
                        <HighlightMatch text={item.label} query={normalizedQuery} fullWhenAlias />
                      </button>
                    ))}
                  </div>
                );
              })}
              {normalizedQuery && shown.length === 0 && (
                <p className="px-2.5 py-3 text-xs text-dim">No matching settings</p>
              )}
            </nav>
            <p className="mono mt-auto px-2.5 text-[11px] text-dim">tersio v{data?.version ?? "?"}</p>
          </aside>
          <div className="relative flex min-h-0 min-w-0 flex-col">
            <div className="flex items-center justify-between gap-3 px-5 pt-4">
              <DialogTitle className="m-0 flex items-center gap-2 text-base font-bold tracking-[-0.01em]">
                <Icon name={PANES.find((p) => p.id === pane)?.icon ?? "settings"} className="size-4 shrink-0 text-dim" />
                {TITLES[pane]}
              </DialogTitle>
              <button
                type="button"
                className="flex shrink-0 items-center p-2 rounded-xl border border-line text-ink [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96]"
                aria-label="Close settings"
                onClick={onClose}
              >
                <Icon name="x" className="size-4" />
              </button>
            </div>
            <div className={`min-h-0 overscroll-contain px-5 pt-4 ${pane === "diagnosis" ? "flex flex-1 overflow-hidden pb-5" : "overflow-y-auto pb-5 [scrollbar-width:thin] [scrollbar-color:var(--line)_transparent]"}`}>
              {pane === "general" && (
                <section aria-label="General" className="grid gap-7">
                  <div className="grid gap-7">
                    <p className="m-0 text-[11px] uppercase tracking-[0.14em] text-dim">Appearance</p>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="m-0 text-[13px] font-semibold">Theme</p>
                        <p className="mt-0.5 mb-0 text-xs text-dim">Light, dark, or follow the system.</p>
                      </div>
                      <Tabs
                        value={theme}
                        onValueChange={(value) => {
                          if (value !== "light" && value !== "dark" && value !== "system") return;
                          setTheme(value);
                          toast(`Theme set to ${value}`, "Applies to this browser.", "sun");
                        }}
                        className="w-fit"
                      >
                        <TabsList className="rounded-[10px] border border-line bg-panel p-1">
                          {(
                            [
                              ["light", "sun", "Light"],
                              ["dark", "moon", "Dark"],
                              ["system", "monitor", "System"],
                            ] as const
                          ).map(([value, icon, label]) => (
                            <TabsTrigger key={value} value={value} aria-label={label} className="size-8 flex-none">
                              <Icon name={icon} />
                            </TabsTrigger>
                          ))}
                        </TabsList>
                      </Tabs>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="m-0 text-[13px] font-semibold">Accent color</p>
                        <p className="mt-0.5 mb-0 text-xs text-dim">Tint buttons, links, and charts.</p>
                      </div>
                      <AccentPicker
                        accent={accent}
                        onPick={(id) => {
                          setAccent(id);
                          toast(`Accent set to ${ACCENTS[id].label}`, "Applies to this browser.", "palette");
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="m-0 text-[13px] font-semibold">Currency</p>
                        <p className="mt-0.5 mb-0 text-xs text-dim">Display currency for cost figures. Persists to tersio settings.</p>
                      </div>
                      <CurrencyPicker cur={cur} onPick={(code) => { onCurrency(code); toast(`Currency set to ${code}`, "Cost figures update across the dashboard.", "check"); }} id="setCur" />
                    </div>
                  </div>
                  <div className="grid gap-7 border-t border-line pt-7">
                    <p className="m-0 text-[11px] uppercase tracking-[0.14em] text-dim">Modes</p>
                    <DefaultModes />
                  </div>
                </section>
              )}
              {pane === "connection" && (
                <section aria-label="Connection">
                  <HealthPane />
                </section>
              )}
              {pane === "diagnosis" && (
                <section className="min-h-0 flex-1" aria-label="Diagnosis">
                  <DoctorPane />
                </section>
              )}
              {pane === "data" && (
                <section aria-label="Data">
                  <DataPane data={data} onReload={onReload} />
                </section>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function streakOf(byDay: UsageReport["byDay"]): number {
  const key = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const cur = new Date();
  cur.setHours(0, 0, 0, 0);
  let k = key(cur);
  if (!byDay[k]) {
    cur.setDate(cur.getDate() - 1);
    k = key(cur);
    if (!byDay[k]) return 0;
  }
  let n = 0;
  while (byDay[k]) {
    n++;
    cur.setDate(cur.getDate() - 1);
    k = key(cur);
  }
  return n;
}

export function ShareDialog({
  open,
  onClose,
  data,
  money,
}: {
  open: boolean;
  onClose: () => void;
  data: UsageReport | null;
  money: (v: number) => string;
}) {
  const toast = useToast();
  const brandDataUrlRef = useRef<string | null>(null);
  const imageBlobRef = useRef<Blob | null>(null);
  const imageBlobPromiseRef = useRef<Promise<Blob> | null>(null);
  const t = data?.tokens ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const total = t.input + t.output + t.cacheRead + t.cacheWrite;
  const runs = data?.messages ?? 0;
  const byModel = data?.byModel ?? {};
  const byDay = data?.byDay ?? {};
  const models = Object.keys(byModel).length;
  const saved = data?.savedUsd ?? 0;
  const cost = data?.usd ?? 0;
  let best = 0;
  Object.values(byDay).forEach((b) => {
    const v = b.input + b.output + b.cacheRead + b.cacheWrite;
    if (v > best) best = v;
  });
  const streak = streakOf(byDay);
  const text = `${fmtShort(total)} tokens / ${fmt(runs)} runs / ${fmtShort(runs ? Math.round(total / runs) : 0)} per run. Saved ${money(saved)} via cache. ${streak}-day streak. My AI spend, tracked with Tersio.`;

  const createPngBlob = (): Promise<Blob> => new Promise((resolve, reject) => {
    const img = new Image();
    const svg = new Blob([svgCard()], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svg);
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 1200;
        canvas.height = 850;
        const context = canvas.getContext("2d");
        if (!context) {
          URL.revokeObjectURL(url);
          reject(new Error("Canvas is unavailable"));
          return;
        }
        context.drawImage(img, 0, 0, 1200, 850);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          if (blob) resolve(blob);
          else reject(new Error("PNG render failed"));
        }, "image/png");
      } catch (error) {
        URL.revokeObjectURL(url);
        reject(error);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Preview render failed"));
    };
    img.src = url;
  });

  const copyBlob = (blob: Blob): Promise<void> => {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      return Promise.reject(new Error("Image clipboard is unavailable"));
    }
    return navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  };

  const copyImage = (): Promise<void> => {
    const blob = imageBlobRef.current;
    if (blob) return copyBlob(blob);
    const pending = imageBlobPromiseRef.current;
    return pending ? pending.then(copyBlob) : Promise.reject(new Error("Preview image is not ready"));
  };

  useEffect(() => {
    imageBlobRef.current = null;
    imageBlobPromiseRef.current = null;
    if (!open) return undefined;
    const brandReady = brandDataUrlRef.current
      ? Promise.resolve(brandDataUrlRef.current)
      : fetch("brand.webp")
        .then((response) => response.blob())
        .then((blob) => new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error ?? new Error("Brand read failed"));
          reader.readAsDataURL(blob);
        }))
        .then((dataUrl) => {
          brandDataUrlRef.current = dataUrl;
          return dataUrl;
        });
    const pending = brandReady.then(() => createPngBlob()).then((blob) => {
      imageBlobRef.current = blob;
      return blob;
    }, (error: unknown) => {
      imageBlobPromiseRef.current = null;
      throw error;
    });
    imageBlobPromiseRef.current = pending;
    void pending.catch(() => undefined);
    return () => {
      imageBlobRef.current = null;
      imageBlobPromiseRef.current = null;
    };
  }, [open, data]);

  const copyText = (body: string, okMsg: string): void => {
    const done = (): void => toast("Copied", okMsg, "copy");
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(body).then(done, () => fallback());
    else fallback();
    function fallback(): void {
      try {
        const ta = document.createElement("textarea");
        ta.value = body;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        done();
      } catch {
        toast("Copy failed", "Select the text manually.", "circle-alert");
      }
    }
  };

  // Native links preserve cmd-click, announcements, and popup safety.
  const shareImage = (network: string): void => {
    void copyImage().then(
      () => toast("Image copied", `Paste it into the ${network} composer.`, "copy"),
      () => {
        copyText(text, "Image copy failed; share text copied instead.");
        toast("Image copy failed", "Share text copied instead.", "circle-alert");
      },
    );
  };

  const copyPreviewImage = (): void => {
    void copyImage().then(
      () => toast("Image copied", "Usage preview copied as PNG.", "copy"),
      () => toast("Image copy failed", "Use Download instead.", "circle-alert"),
    );
  };

  // PNG export rasterizes the profile card SVG at 1200x850.
  const svgCard = (): string => {
    const e = (x: string): string => x.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    // Canvas reads live tokens off <html> since it cannot resolve var().
    const computed = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string): string =>
      computed.getPropertyValue(name).trim() || fallback;
    const pal = {
      bg: token("--bg", "#09090b"),
      ink: token("--ink", "#f4f4f5"),
      dim: token("--dim", "#a1a1aa"),
      accent: token("--accent", "#34d399"),
    };
    const hv = cells;
    const cw = 32;
    const gap = 9;
    const step = cw + gap;
    const gx = 64;
    const gy = 340;
    let grid = "";
    for (let gd = 0; gd < 7; gd++) {
      for (let gw = 0; gw < 26; gw++) {
        const gv = hv.vals[gw * 7 + gd] ?? 0;
        const gs = hv.max ? Math.sqrt(gv / hv.max) : 0;
        const go = gv ? (0.45 + 0.55 * gs).toFixed(2) : 0.13;
        grid += `<rect x="${gx + gw * step}" y="${gy + gd * step}" width="${cw}" height="${cw}" rx="8" fill="${pal.accent}" opacity="${go}"/>`;
      }
    }
    const streakTxt = `${streak}${streak === 1 ? " day" : " days"}`;
    const logo = brandDataUrlRef.current
      ? `<defs><clipPath id="brandClip"><rect x="1012" y="40" width="124" height="124" rx="62"/></clipPath></defs>` +
        `<image x="1012" y="40" width="124" height="124" clip-path="url(#brandClip)" href="${brandDataUrlRef.current}"/>`
      : "";
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="850" viewBox="0 0 1200 850">' +
      `<rect width="1200" height="850" rx="28" fill="${pal.bg}"/>` +
      `<path d="M1090 700 L980 800 h70 l-8 60 80 -96 h-70 l8 -64 z" fill="none" stroke="${pal.accent}" stroke-width="14" opacity="0.08" stroke-linejoin="round"/>` +
      `<text x="64" y="80" font-family="monospace" font-size="26" letter-spacing="6" fill="${pal.accent}">TERSIO · USAGE PROFILE</text>` +
      `<text x="60" y="250" font-family="monospace" font-size="130" font-weight="bold" fill="${pal.ink}">${e(`${fmtShort(total)} tokens`)}</text>` +
      `<text x="64" y="300" font-family="monospace" font-size="30" fill="${pal.dim}">across ${e(fmt(runs))} agent runs</text>` +
      grid +
      `<text x="64" y="680" font-family="monospace" font-size="24" letter-spacing="3" fill="${pal.dim}">AVG / RUN</text>` +
      `<text x="64" y="725" font-family="monospace" font-size="40" font-weight="bold" fill="${pal.ink}">${e(`${fmtShort(runs ? Math.round(total / runs) : 0)} / run`)}</text>` +
      `<text x="430" y="680" font-family="monospace" font-size="24" letter-spacing="3" fill="${pal.dim}">SAVED</text>` +
      `<text x="430" y="725" font-family="monospace" font-size="40" font-weight="bold" fill="${pal.ink}">${e(money(saved))}</text>` +
      `<text x="830" y="680" font-family="monospace" font-size="24" letter-spacing="3" fill="${pal.dim}">DAY STREAK</text>` +
      `<text x="830" y="725" font-family="monospace" font-size="40" font-weight="bold" fill="${pal.ink}">${e(streakTxt)}</text>` +
      `<text x="64" y="775" font-family="monospace" font-size="24" letter-spacing="3" fill="${pal.dim}">BEST DAY</text>` +
      `<text x="64" y="820" font-family="monospace" font-size="40" font-weight="bold" fill="${pal.ink}">${e(fmtShort(best))}</text>` +
      `<text x="430" y="775" font-family="monospace" font-size="24" letter-spacing="3" fill="${pal.dim}">EST. COST</text>` +
      `<text x="430" y="820" font-family="monospace" font-size="40" font-weight="bold" fill="${pal.ink}">${e(money(cost))}</text>` +
      `<text x="830" y="775" font-family="monospace" font-size="24" letter-spacing="3" fill="${pal.dim}">MODELS</text>` +
      `<text x="830" y="820" font-family="monospace" font-size="40" font-weight="bold" fill="${pal.ink}">${e(String(models))}</text>` +
      logo +
      "</svg>"
    );
  };

  const downloadPng = (): void => {
    void createPngBlob().then((blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = "tersio-usage.png";
      link.href = url;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast("Saved", "Card downloaded as PNG.", "download");
    }, () => toast("Save failed", "Browser blocked the render.", "circle-alert"));
  };

  const cells = (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - 181);
    const vals: number[] = [];
    let max = 0;
    for (let i = 0; i < 182; i++) {
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const b = byDay[k];
      const v = b ? b.input + b.output + b.cacheRead + b.cacheWrite : 0;
      vals.push(v);
      if (v > max) max = v;
      d.setDate(d.getDate() + 1);
    }
    return { vals, max };
  })();
  const level = (v: number): string => {
    const s = cells.max ? Math.sqrt(v / cells.max) : 0;
    return !v ? "" : s >= 0.7 ? " l4" : s >= 0.45 ? " l3" : s >= 0.2 ? " l2" : " l1";
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="block w-[min(660px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] sm:max-w-[660px] gap-0 overflow-y-auto rounded-2xl border border-line bg-panel p-5 text-ink shadow-[0_16px_48px_rgba(0,0,0,.35)]" showCloseButton={false} aria-describedby={undefined}>
        <div className="pointer-events-none absolute top-0 left-1/2 h-[180px] w-[min(480px,90%)] -translate-x-1/2 -translate-y-[40%] bg-[radial-gradient(ellipse_at_center,var(--accent-soft)_0%,transparent_65%)]" aria-hidden="true" />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <DialogTitle className="m-0 text-base font-bold tracking-[-0.01em]">Share your usage</DialogTitle>
            <p className="mt-0.5 mb-0 text-xs text-dim">Copy the preview image or share your stats.</p>
          </div>
          <button
            type="button"
            className="flex shrink-0 items-center p-2 rounded-xl border border-line text-ink [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96]"
            aria-label="Close share"
            onClick={onClose}
          >
            <Icon name="x" className="size-4" />
          </button>
        </div>
        <div className="relative mt-3.5 overflow-hidden rounded-xl border border-line bg-bg p-5">
          <span className="pointer-events-none absolute right-[-8px] bottom-[-14px] h-[120px] w-[120px] text-dim opacity-[.06] select-none [&_svg]:block [&_svg]:size-[110px]" aria-hidden="true">
            <Icon name="zap" className="size-4" />
          </span>
          <img src="brand.webp" alt="" width="44" height="44" className="absolute top-4 right-4 size-11 rounded-xl" aria-hidden="true" />
          <p className="mono m-0 text-[11px] tracking-[0.18em] text-accent uppercase">tersio · usage profile</p>
          <p className="mono m-0 mt-1.5 text-[clamp(2rem,5vw,3rem)] font-extrabold tracking-[-0.03em] tabular-nums">{fmtShort(total)} tokens</p>
          <p className="mono m-0 mt-1 text-xs text-dim">across {fmt(runs)} agent runs</p>
          <div className="mt-4 grid grid-cols-[repeat(26,minmax(0,1fr))] gap-[3px]" aria-hidden="true">
            {Array.from({ length: 7 }).flatMap((_, d) =>
              Array.from({ length: 26 }).map((__, w) => {
                const l = level(cells.vals[w * 7 + d] ?? 0);
                return <span key={`${d}-${w}`} className={`aspect-square w-full min-w-0 cursor-pointer rounded-[3px] ${l === " l4" ? "bg-cell-4" : l === " l3" ? "bg-cell-3" : l === " l2" ? "bg-cell-2" : l === " l1" ? "bg-cell-1" : "bg-cell-0"}`} />;
              }),
            )}
          </div>
          <div className="mono mt-3.5 grid grid-cols-3 gap-2">
            <div>
              <p className="m-0 text-[10px] tracking-[0.14em] text-dim uppercase">avg / run</p>
              <p className="m-0 mt-0.5 truncate text-[15px] font-bold tabular-nums">{fmtShort(runs ? Math.round(total / runs) : 0)} / run</p>
            </div>
            <div>
              <p className="m-0 text-[10px] tracking-[0.14em] text-dim uppercase">saved</p>
              <p className="m-0 mt-0.5 truncate text-[15px] font-bold tabular-nums">{money(saved)}</p>
            </div>
            <div>
              <p className="m-0 text-[10px] tracking-[0.14em] text-dim uppercase">day streak</p>
              <p className="m-0 mt-0.5 truncate text-[15px] font-bold tabular-nums">{streak + (streak === 1 ? " day" : " days")}</p>
            </div>
            <div>
              <p className="m-0 text-[10px] tracking-[0.14em] text-dim uppercase">best day</p>
              <p className="m-0 mt-0.5 truncate text-[15px] font-bold tabular-nums">{fmtShort(best)}</p>
            </div>
            <div>
              <p className="m-0 text-[10px] tracking-[0.14em] text-dim uppercase">est. cost</p>
              <p className="m-0 mt-0.5 truncate text-[15px] font-bold tabular-nums">{money(cost)}</p>
            </div>
            <div>
              <p className="m-0 text-[10px] tracking-[0.14em] text-dim uppercase">models</p>
              <p className="m-0 mt-0.5 truncate text-[15px] font-bold tabular-nums">{String(models)}</p>
            </div>
          </div>
        </div>
        <div className="mono text-xs mt-4 flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-2">
            <HoverTip key="x" content="Share on X">
              <a
                href={shareUrl("x", { text: `${text} #Tersio` })}
                target="_blank"
                rel="noopener noreferrer width=560,height=460"
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] border border-line bg-transparent px-[9px] py-[7px] text-xs text-ink no-underline hover:border-accent [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96]"
                aria-label="Share on X"
                onClick={() => shareImage("X")}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
            </HoverTip>
            <HoverTip key="reddit" content="Share on Reddit">
            <a
              href={shareUrl("reddit", { title: "My Tersio usage profile", text })}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] border border-line bg-transparent px-[9px] py-[7px] text-xs text-ink no-underline hover:border-accent [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96]"
              aria-label="Share on Reddit"
              onClick={() => shareImage("Reddit")}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.688-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z" />
              </svg>
            </a>
            </HoverTip>
            <HoverTip key="linkedin" content="Share on LinkedIn">
            <a
              href={shareUrl("linkedin", {})}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] border border-line bg-transparent px-[9px] py-[7px] text-xs text-ink no-underline hover:border-accent [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96]"
              aria-label="Share on LinkedIn"
              onClick={() => shareImage("LinkedIn")}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
              </svg>
            </a>
            </HoverTip>
          </span>
          <span className="flex items-center gap-2 ml-auto">
            <button type="button" className="inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] border border-line bg-transparent px-3 py-[7px] text-xs text-ink hover:border-accent [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96]" aria-label="Copy usage preview as image" onClick={copyPreviewImage}>
              <Icon name="copy" className="size-3.5" />
              <span>Copy image</span>
            </button>
            <button type="button" className="inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] border border-line bg-transparent px-3 py-[7px] text-xs text-ink hover:border-accent [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96]" aria-label="Download card as PNG" onClick={downloadPng}>
              <Icon name="download" className="size-3.5" />
              <span>Download</span>
            </button>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function Footer() {
  return (
    <footer className="mono text-xs mt-12 pt-4 text-dim border-t border-line">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <span>© 2026 Tersio. KurutoDenzeru. All rights reserved.</span>
        <span className="ml-auto flex items-center gap-1 text-ink">
          <a href="https://github.com/KurutoDenzeru/tersio" target="_blank" rel="noopener" aria-label="GitHub" className="grid size-8 place-items-center rounded-lg text-ink hover:text-accent [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96]">
            <span className="size-4 bg-current" style={{ WebkitMaskImage: "url('https://cdn.jsdelivr.net/npm/simple-icons@v16/icons/github.svg')", WebkitMaskPosition: "center", WebkitMaskRepeat: "no-repeat", WebkitMaskSize: "contain" }} />
          </a>
          <a href="https://linkedin.com/in/kurtcalacday/" target="_blank" rel="noopener" aria-label="LinkedIn" className="grid size-8 place-items-center rounded-lg text-ink hover:text-accent [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96] [&_svg]:block [&_svg]:size-4">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
            </svg>
          </a>
          <a href="https://instagram.com/krtclcdy/" target="_blank" rel="noopener" aria-label="Instagram" className="grid size-8 place-items-center rounded-lg text-ink hover:text-accent [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96]">
            <span className="size-4 bg-current" style={{ WebkitMaskImage: "url('https://cdn.jsdelivr.net/npm/simple-icons@v16/icons/instagram.svg')", WebkitMaskPosition: "center", WebkitMaskRepeat: "no-repeat", WebkitMaskSize: "contain" }} />
          </a>
        </span>
      </div>
    </footer>
  );
}
