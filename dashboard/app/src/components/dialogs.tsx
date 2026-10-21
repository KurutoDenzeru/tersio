// Settings dialog: theme, accent, currency, doctor.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { setDevMode, useDevMode } from "@/lib/dev-mode";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTheme, useResolvedTheme } from "@/components/theme-provider";
import { ACCENTS, ACCENT_IDS, accentSwatch, type AccentId } from "@/lib/accent";
import { FLAGS, FX_SNAPSHOT, relAge } from "@/lib/format";
import {
  fetchDoctor,
  fetchHealth,
  isFileExport,
  postDoctorFix,
  postDoctorSchedule,
  requestReload,
  snapshotVersion,
} from "@/lib/data";
import type { DoctorReport, HealthReport, UpdateSchedule } from "@/lib/data";
import type { UpdateFeed } from "@/lib/update-watch";
import { useToast } from "./toaster";
import { cn } from "cn";
import { HoverTip } from "./common";
import { SocialLinks } from "./brand";
import { Icon } from "./icon";
import { AgentLogo } from "./agent-logos";
import { UPCOMING_AGENTS } from "@/lib/agents";
import { Card } from "./charts/stats";

type Pane = "general" | "connection" | "data" | "diagnosis" | "about";

interface AgentRowProps {
  name: string;
  version: string | null;
  binPath: string | null;
  dirPath: string | null;
  bin: string;
  docs: string;
  available: boolean;
  unavailable: boolean;
  /** True for an agent Tersio does not install into yet: the row names the plan, not a status. */
  soon?: boolean;
  logo: ReactNode;
}

function AgentRow({ name, version, binPath, dirPath, bin, docs, available, unavailable, soon, logo }: AgentRowProps) {
  const status = soon ? "Coming soon" : unavailable ? "Unavailable" : available ? "Available" : "Not detected on PATH";
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
          {/* PATH binary as secondary, config directory first when known. */}
          {soon ? (
            <span>Support is planned: Tersio does not install here yet.</span>
          ) : dirPath ? (
            <HoverTip content={dirPath}>
              <span className="mono block truncate">{dirPath}</span>
            </HoverTip>
          ) : binPath ? (
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
    { name: "Oh My Pi", version: health?.omp ?? null, binPath: health?.ompPath ?? null, dirPath: health?.ompDir ?? null, bin: "omp", docs: "https://omp.sh", available: !!health?.omp, unavailable, logo: <AgentLogo host="omp" className="size-5" /> },
    { name: "Pi", version: health?.pi ?? null, binPath: health?.piPath ?? null, dirPath: health?.piDir ?? null, bin: "pi", docs: "https://pi.dev", available: !!health?.pi, unavailable, logo: <AgentLogo host="pi" className="size-5" /> },
    { name: "OpenCode", version: health?.opencode ?? null, binPath: health?.opencodePath ?? null, dirPath: health?.opencodeDir ?? null, bin: "opencode", docs: "https://opencode.ai", available: !!health?.opencode, unavailable, logo: <AgentLogo host="opencode" className="size-5" /> },
    // The unwired agents close the list, so the rows above stay the ones you can install into today.
    ...UPCOMING_AGENTS.map((agent) => ({
      name: agent.name,
      version: null,
      binPath: null,
      dirPath: null,
      bin: agent.bin,
      docs: agent.docs,
      available: false,
      unavailable: false,
      soon: true,
      logo: <AgentLogo host={agent.id} className="size-5" />,
    })),
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

interface DataFile {
  label: string;
  source: string;
  bytes: number;
}

/** One snapshot: a `.snap` this build wrote, or the lone ledger file older builds wrote. */
interface DataBackupRow {
  name: string;
  mtime: number;
  bytes: number;
  members: DataFile[];
}

const SCHEDULE_OPTIONS: ReadonlyArray<{ id: string; label: string; hint: string }> = [
  { id: "monthly", label: "Monthly", hint: "one a month" },
  { id: "weekly", label: "Weekly", hint: "one a week" },
  { id: "daily", label: "Daily", hint: "one a day" },
  { id: "manual", label: "Manual", hint: "only on demand" },
];

/** The whole store in one line: `4.1M` for a copy the pane can name. */
function dataSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)}G`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)}M`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)}K`;
  return `${bytes}B`;
}

/** The snapshot label in words, not the directory's machine stamp; the hover tip keeps the raw name. */
function dataStamp(mtime: number): string {
  const d = new Date(mtime);
  const date = d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const clock = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
  return `${date} - ${clock}`;
}

/** The restore snapshots and their schedule; the list never restores alone, so a stray click cannot overwrite. */
function DataPane() {
  const toast = useToast();
  const [backups, setBackups] = useState<DataBackupRow[] | null>(null);
  const [schedule, setSchedule] = useState("monthly");
  const [keep, setKeep] = useState(3);
  const [dir, setDir] = useState("");
  /** The snapshot the footer works on. A name the list no longer holds reads as no pick. */
  const [picked, setPicked] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The reset confirm. The counts come from the data payload, so the dialog names them. */
  const [resetting, setResetting] = useState(false);
  const [counts, setCounts] = useState<{ rows: number; rtk: number } | null>(null);

  const load = useCallback(() => {
    fetch("/api/data")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { backups?: DataBackupRow[]; schedule?: string; keep?: number; dir?: string; reset?: { rows: number; rtk: number } } | null) => {
        setBackups(d?.backups ?? []);
        setCounts(d?.reset ?? null);
        if (d?.schedule) setSchedule(d.schedule);
        if (typeof d?.keep === "number") setKeep(d.keep);
        if (d?.dir) setDir(d.dir);
      })
      .catch(() => {
        setBackups([]);
      });
    fetch("/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { backupSchedule?: string } | null) => {
        if (d?.backupSchedule) setSchedule(d.backupSchedule);
      })
      .catch(() => { /* keep the default shown */ });
  }, []);
  useEffect(() => {
    load();
  }, [load]);

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

  const create = (): void => {
    if (isFileExport()) {
      toast("Snapshot export", "Live snapshots need tersio dashboard.", "scan-line");
      return;
    }
    setBusy(true);
    void fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create" }),
    })
      .then((r) => r.json())
      .then((d: { ok?: boolean; name?: string; error?: string }) => {
        if (d?.ok) {
          toast("Snapshot taken", `One file: ${d.name}.`, "check");
          if (d.name) setPicked(d.name);
          load();
          requestReload();
        } else toast("Backup failed", d?.error ?? "The server did not answer.", "circle-alert");
      })
      .catch(() => toast("Backup failed", "The dashboard server did not answer.", "circle-alert"))
      .finally(() => setBusy(false));
  };

  const restore = (name: string): void => {
    setBusy(true);
    setAsking(null);
    void fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "restore", name }),
    })
      .then((r) => r.json())
      .then((d: { ok?: boolean; error?: string }) => {
        if (d?.ok) {
          toast("Snapshot restored", "The pages read the restored data.", "check");
          load();
          requestReload();
        } else toast("Restore failed", d?.error ?? "Unknown snapshot", "circle-alert");
      })
      .catch(() => toast("Restore failed", "The dashboard server did not answer.", "circle-alert"))
      .finally(() => setBusy(false));
  };

  const remove = (name: string): void => {
    setConfirming(null);
    setPicked(null);
    void fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", name }),
    })
      .then((r) => r.json())
      .then((d: { ok?: boolean; error?: string }) => {
        if (d?.ok) {
          toast("Snapshot deleted", "Removed from disk. The live data is unchanged.", "check");
          load();
          requestReload();
        } else toast("Delete failed", d?.error ?? "Unknown snapshot", "circle-alert");
      })
      .catch(() => toast("Delete failed", "The dashboard server did not answer.", "circle-alert"));
  };

  const doReset = (): void => {
    // The action closes its own dialog, the way the snapshot confirms do.
    setResetting(false);
    void fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset" }),
    })
      .then((r) => r.json())
      .then((d: { ok?: boolean; rows?: number; db?: number; error?: string }) => {
        if (d?.ok) {
          toast("Statistics cleared", `${d.rows ?? 0} usage rows${(d.db ?? 0) > 0 ? " and usage.db" : ""}.`, "check");
          load();
          requestReload();
        } else toast("Reset failed", d?.error ?? "The server did not answer.", "circle-alert");
      })
      .catch(() => toast("Reset failed", "The dashboard server did not answer.", "circle-alert"));
  };

  const target = (backups ?? []).find((b) => b.name === asking) ?? null;
  const doomed = (backups ?? []).find((b) => b.name === confirming) ?? null;
  /** The footer works on the picked row, unless a restore confirm owns the screen. */
  const chosen = (backups ?? []).find((b) => b.name === picked) ?? null;
  const scheduleLabel = SCHEDULE_OPTIONS.find((o) => o.id === schedule)?.label ?? "Monthly";
  const scheduleHint = SCHEDULE_OPTIONS.find((o) => o.id === schedule)?.hint ?? "";

  return (
    <section aria-label="Data" className="grid gap-4">
      <Card
        title="Backup schedule"
        icon="clock"
        description={`Every file Tersio keeps. The newest ${keep} are kept.`}
        actions={
          <Select value={schedule} onValueChange={(v) => saveSchedule(v ?? "monthly")}>
            <SelectTrigger size="sm" className="w-[132px]" aria-label="Snapshot schedule">
              <SelectValue placeholder={scheduleLabel}>{scheduleLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {SCHEDULE_OPTIONS.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.label}{o.id === "monthly" ? " (Recommended)" : ""}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        }
      >
        {/* The label takes the slack, so the action sits on the header's own column. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <div className="min-w-0 flex-1">
            <p className="m-0 text-[13px] font-semibold">
              {scheduleLabel} <span className="text-xs font-normal text-dim">{scheduleHint}</span>
            </p>
            {dir && (
              <HoverTip content={dir}>
                <span className="mono mt-0.5 block truncate text-[11px] text-dim">{dir}</span>
              </HoverTip>
            )}
          </div>
          <Button
            size="sm"
            className="mono h-8 gap-1.5 rounded-xl"
            disabled={busy}
            onClick={create}
            aria-label="Take a snapshot now"
          >
            {busy ? <Spinner className="size-3.5" /> : <Icon name="database-backup" className="size-3.5" />}
            <span>Back up now</span>
          </Button>
        </div>
      </Card>

      <Card
        title="Snapshots"
        icon="layers"
        description="Newest first. One file each. A restore copies its contents over the live data."
        footer={
          (
            <>
              <span className="mono min-w-0 flex-1 truncate text-[11px] text-dim">
                {chosen ? dataStamp(chosen.mtime) : "Pick a snapshot to restore or delete it."}
              </span>
              <Button
                size="sm"
                className="mono h-8 gap-1.5 rounded-xl"
                disabled={!chosen || busy}
                onClick={() => chosen && setAsking(chosen.name)}
              >
                <Icon name="rotate-ccw" className="size-3.5" />
                Restore
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="mono h-8 gap-1.5 rounded-xl"
                disabled={!chosen}
                onClick={() => chosen && setConfirming(chosen.name)}
              >
                <Icon name="trash" className="size-3.5" />
                Delete
              </Button>
            </>
          )
        }
      >
        {backups === null ? (
          <Skeleton className="h-24 w-full" />
        ) : backups.length === 0 ? (
          <p className="m-0 py-2.5 text-xs text-dim">
            No snapshots yet. Take one above, or let the schedule take it.
          </p>
        ) : (
// Six rows at a time; the cap is a max-height, so a long history scrolls in the card and a short list stays tight.
          <div className="max-h-[19rem] overflow-y-auto">
            <div className="divide-y divide-line">
              {backups.map((b) => {
                const on = b.name === picked;
                return (
                  <button
                    key={b.name}
                    type="button"
                    aria-pressed={on}
                    className={cn(
                      "group flex w-full items-center gap-3 py-2 text-left transition-colors hover:bg-track/40 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent",
                      on && "bg-accent-soft",
                    )}
                    onClick={() => setPicked(on ? null : b.name)}
                  >
                    <div className="min-w-0 flex-1">
                      <HoverTip content={`${b.name} — ${b.members.map((f) => f.label).join(", ")}`}>
                        <p className="mono m-0 truncate text-xs text-ink">{dataStamp(b.mtime)}</p>
                      </HoverTip>
                      <p className="mono mt-0.5 mb-0 text-[11px] text-dim">
                        {dataSize(b.bytes)} · 1 file
                      </p>
                    </div>
                    {on && <Icon name="check" className="mr-1.5 size-3.5 shrink-0 text-accent" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      <Card
        title="Reset statistics"
        icon="rotate-ccw"
        description="Clears the ledger and every figure the pages derive from it."
        footer={
          <>
            <span className="mono min-w-0 flex-1 truncate text-[11px] text-dim">
              {counts && (counts.rows > 0 || counts.rtk > 0)
                ? `${counts.rows} ledger rows · ${counts.rtk} RTK rows`
                : "Nothing to clear yet."}
            </span>
            <Button
              size="sm"
              variant="destructive"
              className="mono h-8 gap-1.5 rounded-xl"
              onClick={() => setResetting(true)}
              aria-label="Reset statistics"
            >
              <Icon name="rotate-ccw" className="size-3.5" />
              Reset
            </Button>
          </>
        }
      >
        <p className="m-0 text-xs text-dim">
          Nothing leaves the disk: session transcripts, rtk history, snapshots, and prices stay. The ledger is
          emptied and its rows stop counting, so every page that derives from them starts empty.
        </p>
      </Card>

      <AlertDialog open={asking !== null} onOpenChange={(open) => { if (!open) setAsking(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this snapshot?</AlertDialogTitle>
            <AlertDialogDescription>
              {target
                ? `Everything in ${dataStamp(target.mtime)} is copied over the live data: ${target.members.map((f) => f.label).join(", ")}. A file the snapshot lacks is left alone, and the dashboard needs a reload afterwards.`
                : "That snapshot is no longer in the list."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy || !target} onClick={() => target && restore(target.name)}>
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirming !== null} onOpenChange={(open) => { if (!open) setConfirming(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this snapshot?</AlertDialogTitle>
            <AlertDialogDescription>
              {doomed
                ? `One file goes with it — ${doomed.members.map((f) => f.label).join(", ")}. The live data stays as it is, and the backup schedule only keeps ${keep} snapshots, so this one has to be taken by hand next time.`
                : "That snapshot is no longer in the list."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => doomed && remove(doomed.name)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={resetting} onOpenChange={setResetting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear Tersio statistics?</AlertDialogTitle>
            <AlertDialogDescription>
              {counts
                ? `${counts.rows} usage ledger rows and ${counts.rtk} RTK metered rows stop counting, and every page that derives from them starts empty.`
                : "Every page that derives from the ledger starts empty."} Session transcripts, rtk history, snapshots, and prices stay on disk.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={doReset}>
              Reset statistics
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
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

const PANES: Array<{ id: Pane; label: string; icon: string }> = [
  { id: "general", label: "General", icon: "settings" },
  { id: "connection", label: "Connection", icon: "plug" },
  { id: "data", label: "Data", icon: "database" },
  { id: "diagnosis", label: "Diagnosis", icon: "stethoscope" },
  { id: "about", label: "About", icon: "info" },
];

const TITLES: Record<Pane, string> = {
  general: "Settings",
  connection: "Connection",
  data: "Data",
  diagnosis: "Doctor",
  about: "About",
};

const SETTINGS_SEARCH: Array<{ pane: Pane; label: string; terms: string }> = [
  { pane: "general", label: "Combo preset", terms: "general default mode combo preset balanced max lite off new session resume start caveman rtk ponytail pstack poteto rigor" },
  { pane: "general", label: "Theme", terms: "general appearance theme light dark system color scheme mode" },
  { pane: "general", label: "Accent color", terms: "general appearance accent color tint buttons links highlights palette emerald violet slate cyan rose amber orange charts background" },
  { pane: "general", label: "Currency", terms: "currency display cost usd euro" },
  { pane: "data", label: "Snapshots", terms: "data snapshot backup restore copy mirror ledger settings price cache schedule keep size" },
  { pane: "connection", label: "Coding agents", terms: "connection provider coding agents agent oh my pi omp status path version refresh ready available" },
  { pane: "diagnosis", label: "Auto-check schedule", terms: "diagnosis system health auto-check schedule manual daily weekly monthly" },
  { pane: "diagnosis", label: "Scan", terms: "diagnosis scan check" },
  { pane: "diagnosis", label: "Fix issues", terms: "diagnosis repair fix issues" },
  { pane: "about", label: "Version", terms: "about version build release which installed node platform rtk binary" },
  { pane: "about", label: "Updates", terms: "about update upgrade check latest new version install schedule daily weekly monthly automatic remember remind skip" },
  { pane: "about", label: "Resources", terms: "about resources links github repository npm package changelog docs architecture issues socials follow" },
  { pane: "about", label: "Credits", terms: "about credits licence license authors upstream caveman rtk ponytail pstack port" },
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
  /** `custom` when the four modes no longer match the named preset. */
  comboLevel: string;
  cavemanDefault: string;
  rtkDefault: boolean;
  ponytailDefault: string;
  pstackDefault: string;
}

const DEFAULT_ROWS_UI: Array<{ field: keyof DefaultsPayload; label: string; glyph: string; hint: string; options: Array<{ id: string; label: string }> }> = [
  {
    field: "comboDefault",
    label: "Combo preset",
    glyph: "🧩",
    hint: "Sets caveman, RTK, Ponytail and pstack together.",
    options: [
      { id: "off", label: "Off" },
      { id: "lite", label: "Lite" },
      { id: "balanced", label: "Balanced (Recommended)" },
      { id: "max", label: "Max" },
      { id: "custom", label: "Custom" },
    ],
  },
  {
    field: "cavemanDefault",
    label: "Caveman",
    glyph: "🪨",
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
    glyph: "🗜️",
    hint: "Rewrite eligible Bash calls through rtk.",
    options: [{ id: "on", label: "On" }, { id: "off", label: "Off" }],
  },
  {
    field: "ponytailDefault",
    label: "Ponytail",
    glyph: "🧠",
    hint: "Lazy-code mode for a new or resumed session.",
    options: [
      { id: "off", label: "Off" }, { id: "lite", label: "Lite" },
      { id: "full", label: "Full" }, { id: "ultra", label: "Ultra" },
    ],
  },
  {
    field: "pstackDefault",
    label: "pstack",
    glyph: "🥔",
    hint: "Rigor mode. The lite, balanced, and max presets turn it on.",
    options: [{ id: "off", label: "Off" }, { id: "on", label: "On" }],
  },
];

// Session-start defaults mirror `tersio settings`; each row saves on its own.
function DefaultModes() {
  const toast = useToast();
  const [current, setCurrent] = useState<DefaultsPayload>({
    comboDefault: "off", comboLevel: "off", cavemanDefault: "off", rtkDefault: false, ponytailDefault: "off", pstackDefault: "off",
  });
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    fetch("/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Partial<DefaultsPayload> | null) => { if (d) setCurrent((c) => ({ ...c, ...d })); })
      .catch(() => { /* keep what is on screen; the rows still save */ })
      .finally(() => setLoaded(true));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

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
        if (d?.ok) {
          // One row writes more than its own field: a preset rewrites all four modes, and the
          // combo row reads the level derived from them. Read the saved state back.
          load();
          toast(`${row.label} saved`, `${id} applies to new sessions`, "check");
        } else {
          toast("Could not save", d?.error ?? "Unknown level", "circle-alert");
        }
      })
      .catch(() => toast("Could not save", "The dashboard server did not answer.", "circle-alert"));
  };

  return (
    <div className="grid gap-6">
      {DEFAULT_ROWS_UI.map((row) => {
        const raw = current[row.field];
        const isRtk = row.field === "rtkDefault";
        const value = row.field === "comboDefault"
          ? (current.comboLevel || current.comboDefault)
          : isRtk ? (raw ? "on" : "off") : String(raw ?? "off");
        // A live preset writes all four modes, so they are inert. A custom mix is the operator's
        // own, so those rows stay live and the preset row says so.
        const presetOn = current.comboLevel !== "off" && current.comboLevel !== "custom";
        const locked = !loaded || (presetOn && row.field !== "comboDefault");
        if (isRtk) {
          return (
            <div key={row.field} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="m-0 text-[13px] font-semibold">
                  <span aria-hidden="true" className="mr-1.5">{row.glyph}</span>{row.label}
                </p>
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
              <p className="m-0 text-[13px] font-semibold">
                <span aria-hidden="true" className="mr-1.5">{row.glyph}</span>{row.label}
              </p>
              <p className="mt-0.5 mb-0 text-xs text-dim">{row.hint}</p>
            </div>
            <Select value={value} onValueChange={(v) => save(row, v ?? "off")} disabled={locked}>
              <SelectTrigger size="sm" className="w-[132px] shrink-0" aria-label={`${row.label} default`}>
                {/* SelectValue needs children or it shows the raw value. */}
                <SelectValue placeholder="Off">{row.options.find((o) => o.id === value)?.label ?? "Off"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {/* Custom is what the four modes say, never a level to pick. */}
                  {row.options.map((o) => (
                    <SelectItem key={o.id} value={o.id} disabled={o.id === "custom"}>
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

function CurrencyPicker({ cur, onPick, id }: { cur: string; onPick: (code: string) => void; id: string }) {
  const toast = useToast();
  return (
    <div className="flex items-center gap-2">
      <Select value={cur} onValueChange={(next) => { if (next !== cur) { onPick(next as string); toast(`Currency set to ${next}`, "Cost figures update across the dashboard.", "check"); } }}>
        <SelectTrigger size="sm" aria-label="Display currency" className="text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {Object.keys(FX_SNAPSHOT).map((code) => (
              <SelectItem key={code} value={code}>
                <span className="flex items-center gap-2">
                  <span aria-hidden="true">{FLAGS[code] ?? ""}</span>
                  {code}
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <span id={id} className="sr-only">{cur}</span>
    </div>
  );
}

/** A wait, not an age: `6h`, `2d`. */
function untilText(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "under an hour";
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/** A momentary action beside the status it belongs to, so it costs no control of its own. */
function TextAction({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-accent underline-offset-4 hover:underline"
    >
      {children}
    </button>
  );
}

function LinkRow({ label, hint, href, glyph }: { label: string; hint: string; href: string; glyph?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 px-1 py-2.5 text-[13px] [transition:background_.2s] hover:bg-track"
    >
      <span className="min-w-0">
        <span className="block font-medium">
          {glyph ? <span aria-hidden="true" className="mr-1.5">{glyph}</span> : null}
          {label}
        </span>
        <span className="mono block truncate text-[11px] text-dim">{hint}</span>
      </span>
      <Icon name="arrow-up-right" className="ml-auto size-3.5 shrink-0 text-dim" />
    </a>
  );
}

/** The cadence the server honours, named the way the check itself is. */
const UPDATE_SCHEDULES: ReadonlyArray<{ id: UpdateSchedule; label: string; hint: string }> = [
  { id: "off", label: "Off", hint: "only when you ask" },
  { id: "daily", label: "Daily", hint: "one a day" },
  { id: "weekly", label: "Weekly", hint: "one a week" },
  { id: "monthly", label: "Monthly", hint: "one a month" },
];

/** Every mode is a port. The licences here are the upstream repos' own declarations. */
const CREDITS: ReadonlyArray<{ label: string; hint: string; href: string; glyph: string }> = [
  { label: "Caveman", glyph: "🪨", hint: "Julius Brussee, Apache-2.0", href: "https://github.com/JuliusBrussee/caveman" },
  { label: "RTK", glyph: "🗜️", hint: "rtk-ai, Apache-2.0", href: "https://github.com/rtk-ai/rtk" },
  { label: "Ponytail", glyph: "🧠", hint: "Dietrich Gebert, MIT", href: "https://github.com/DietrichGebert/ponytail" },
  { label: "pstack", glyph: "🥔", hint: "Lauren Tan, ported from cursor/plugins", href: "https://github.com/cursor/plugins" },
];

/** Two settings and the moment's action: how often the dashboard asks, and whether it installs alone. */
function AboutPane({ update }: { update: UpdateFeed }) {
  const toast = useToast();
  const dev = useDevMode();
  const view = update.view;
  const checking = view?.status === "checking";
  const installing = view?.status === "applying";
  const schedule = UPDATE_SCHEDULES.find((entry) => entry.id === view?.schedule) ?? UPDATE_SCHEDULES[1];

  const status: ReactNode = !view ? (
    <span className="text-dim">A static export cannot reach the registry, so updates stay manual here.</span>
  ) : installing ? (
    <span className="text-dim">Installing the release. The log below is the installer's own output.</span>
  ) : checking ? (
    <span className="text-dim">Asking npm and the release feed.</span>
  ) : view.available && view.latest ? (
    <span>
      Version <span className="mono font-semibold">{view.latest}</span> is available{view.source === "github" ? " on the release feed" : ""}. You run <span className="mono">{view.current}</span>.
      {view.source === "github" && view.npmLatest && view.npmLatest !== view.latest ? (
        <span className="text-dim"> npm serves {view.npmLatest}.</span>
      ) : null}
    </span>
  ) : (
    <span className="text-dim">
      Up to date at <span className="mono text-ink">{view.current}</span>.
    </span>
  );

  return (
    <section aria-label="About" className="grid gap-7">
      <div>
        <div className="divide-y divide-line border-y border-line">
          <div className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="m-0 text-[13px] font-semibold">Check for updates</p>
              <p className="mt-0.5 mb-0 text-xs text-dim">
                {schedule.id === "off" ? "Only when you ask." : `Asked ${schedule.hint}, while the dashboard is open.`}
              </p>
            </div>
            <Select
              value={view?.schedule ?? "daily"}
              onValueChange={(next) => {
                const picked = UPDATE_SCHEDULES.find((entry) => entry.id === (next ?? "daily")) ?? UPDATE_SCHEDULES[1];
                update.setSchedule(picked.id);
                toast(
                  `Update check set to ${picked.label}`,
                  picked.id === "off" ? "Only when you ask from now on." : `Asked ${picked.hint}, while the dashboard is open.`,
                  "refresh-cw",
                );
              }}
              disabled={!view}
            >
              <SelectTrigger size="sm" className="w-[118px] shrink-0" aria-label="Update check schedule">
                <SelectValue placeholder={schedule.label}>{schedule.label}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {UPDATE_SCHEDULES.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="m-0 text-[13px]">{status}</p>
          {view && !checking && !installing && (
            view.available && view.latest ? (
              <Button type="button" size="sm" onClick={update.apply}>
                {`Update to ${view.latest}`}
              </Button>
            ) : (
              <TextAction onClick={update.check}>Check now</TextAction>
            )
          )}
          {view && view.available && view.latest && view.prompt && (
            <TextAction onClick={update.skip}>Skip this version</TextAction>
          )}
        </div>
        {view && (
          <p className="mt-1.5 mb-0 text-xs text-dim">
            {view.lastCheck ? `Last checked ${relAge(view.lastCheck)}` : "Never checked"}
            {view.dueIn !== null ? `, next in ${untilText(view.dueIn)}` : ""}
            {view.snoozeIn ? `, quiet for ${untilText(view.snoozeIn)}` : ""}.
          </p>
        )}
        {view?.error && (
          <p className="mt-2 mb-0 flex items-start gap-2 text-xs text-danger">
            <Icon name="circle-alert" className="mt-px size-3.5 shrink-0" />
            <span>{view.error}</span>
          </p>
        )}
        {view && view.log.length > 0 && (
          <ScrollArea className="mt-3 max-h-[168px] rounded-xl border border-line bg-track/40">
            <pre aria-live="polite" className="mono m-0 p-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words text-dim">
              {view.log.join("\n")}
            </pre>
          </ScrollArea>
        )}
      </div>

      <div className="divide-y divide-line border-y border-line">
        <div className="flex items-center justify-between gap-3 py-3">
          <div className="min-w-0">
            <p className="m-0 text-[13px] font-semibold">Developer tools</p>
            <p className="mt-0.5 mb-0 text-xs text-dim">
              Show the Upstream page: every port beside the upstream project it tracks.
            </p>
          </div>
          <Switch size="sm" checked={dev} onCheckedChange={setDevMode} aria-label="Show developer tools" />
        </div>
      </div>

      <div>
        <div className="border-b border-line pb-4">
          <p className="m-0 text-[13px] font-semibold">Credits</p>
          <p className="mt-0.5 mb-0 text-xs text-dim">Tersio is MIT licensed. Every mode is a port, and each keeps its author named.</p>
        </div>
        <div className="divide-y divide-line">
          {CREDITS.map((row) => (
            <LinkRow key={row.label} {...row} />
          ))}
        </div>
      </div>
    </section>
  );
}

export function SettingsDialog({
  open,
  onClose,
  cur,
  onCurrency,
  update,
}: {
  open: boolean;
  onClose: () => void;
  cur: string;
  onCurrency: (code: string) => void;
  update: UpdateFeed;
}) {
  const toast = useToast();
  const { theme, setTheme, accent, setAccent } = useTheme();
  const [pane, setPane] = useState<Pane>("general");
  // The footer carries the version whether or not a server answered, so the export keeps it too.
  const version = update.view?.current ?? snapshotVersion();
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
        <div className="grid h-full min-h-0 max-h-full grid-cols-[276px_minmax(0,1fr)] max-sm:grid-cols-1">
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
            <div className="mono mt-auto flex items-center justify-between gap-2 px-2.5 text-[11px] text-dim">
              <span className="min-w-0 truncate">{version ? `v${version}` : "Tersio"}</span>
              <SocialLinks className="flex shrink-0 items-center gap-0.5" />
            </div>
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
              {pane === "data" && (
                <section aria-label="Data">
                  <DataPane />
                </section>
              )}
              {pane === "diagnosis" && (
                <section className="min-h-0 flex-1" aria-label="Diagnosis">
                  <DoctorPane />
                </section>
              )}
              {pane === "about" && <AboutPane update={update} />}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}


