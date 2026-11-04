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
import { Input } from "@/components/ui/input";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTheme, useResolvedTheme } from "@/components/theme-provider";
import { AgentLogo } from "@/components/agent-logos";
import { ACCENTS, ACCENT_IDS, accentSwatch, type AccentId } from "@/lib/accent";
import { FLAGS, FX_SNAPSHOT, relAge } from "@/lib/format";
import {
  fetchDoctor,
  isFileExport,
  postDoctorFix,
  requestReload,
  snapshotVersion,
} from "@/lib/data";
import type { DoctorReport, UpdateSchedule } from "@/lib/data";
import type { UpdateFeed } from "@/lib/update-watch";
import { useToast } from "./toaster";
import { cn } from "cn";
import { HoverTip } from "./common";
import { SocialLinks } from "./brand";
import { Icon } from "./icon";
import { Card } from "./charts/stats";

type Pane = "general" | "data" | "diagnosis" | "about";

// Share destinations live in lib/share.ts so the host guarantee is testable.

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

/** How long usage rows survive. `0` keeps everything, which is the upgrade-safe default. */
const RETENTION_OPTIONS: ReadonlyArray<{ id: number; label: string; hint: string }> = [
  { id: 7, label: "7 days", hint: "one week of history" },
  { id: 14, label: "14 days", hint: "two weeks of history" },
  { id: 30, label: "30 days", hint: "one month of history" },
  { id: 90, label: "90 days", hint: "one quarter of history" },
  { id: 180, label: "180 days", hint: "half a year of history" },
  { id: 365, label: "365 days", hint: "one year of history" },
  { id: 0, label: "Forever", hint: "keep every row" },
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

type SyncMode = "webdav" | "s3" | "github";
interface SyncVersion { name: string; bytes: number; mtime: number }
interface SyncView {
  configured: boolean;
  mode: SyncMode | null;
  target: string;
  passphraseSet: boolean;
  fields: Record<string, Record<string, unknown>>;
  versions: SyncVersion[];
  error: string | null;
}

const SYNC_MODES: Array<{ id: SyncMode; label: string; icon?: string; hint: string }> = [
  { id: "webdav", label: "WebDAV", icon: "globe", hint: "Any WebDAV address, such as a NAS or a hosted box." },
  { id: "s3", label: "S3", icon: "database", hint: "AWS S3, Cloudflare R2, Backblaze B2, MinIO, and the like." },
  // No lucide brand mark, so the tab renders GithubMark instead of an Icon name.
  { id: "github", label: "GitHub", hint: "A private repository. Each backup is one commit." },
];

/** Lucide dropped brand marks, so the GitHub tab carries the mark itself. */
function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className} fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

const SYNC_FIELDS: Record<SyncMode, Array<{ key: string; label: string; placeholder: string; secret?: boolean }>> = {
  webdav: [
    { key: "address", label: "Address", placeholder: "https://example.com/dav/" },
    { key: "user", label: "User", placeholder: "user name" },
    { key: "password", label: "Password", placeholder: "password or app password", secret: true },
  ],
  s3: [
    { key: "endpoint", label: "Endpoint", placeholder: "https://<account>.r2.cloudflarestorage.com" },
    { key: "bucket", label: "Bucket", placeholder: "bucket name" },
    { key: "prefix", label: "Prefix", placeholder: "optional" },
    { key: "region", label: "Region", placeholder: "us-east-1, or auto for R2" },
    { key: "accessKey", label: "Access key", placeholder: "AKIA…" },
    { key: "secret", label: "Secret", placeholder: "secret access key", secret: true },
  ],
  github: [
    { key: "repository", label: "Repository", placeholder: "owner/repo" },
    { key: "branch", label: "Branch", placeholder: "default branch" },
    { key: "folder", label: "Folder", placeholder: "optional" },
    { key: "token", label: "Token", placeholder: "fine-grained token with contents write", secret: true },
  ],
};

function sizeText(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Settings → Data: where the sealed backups go, and every version that is already there. */
function SyncPanel() {
  const toast = useToast();
  const [view, setView] = useState<SyncView | null>(null);
  const [mode, setMode] = useState<SyncMode>("webdav");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pathStyle, setPathStyle] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  /** Which secret inputs are shown in clear; a revealed value is never sent anywhere different. */
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  const load = useCallback(() => {
    fetch("/api/sync")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: SyncView | null) => {
        if (!d) return;
        setView(d);
        const next = d.mode ?? "webdav";
        setMode(next);
        const saved = d.fields?.[next] ?? {};
        setFields(Object.fromEntries(Object.entries(saved).map(([key, value]) => [key, typeof value === "string" ? value : ""])));
        setPathStyle(saved.pathStyle === true);
        setPassphrase("");
      })
      .catch(() => setView(null));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const pick = (next: SyncMode): void => {
    setMode(next);
    const saved = view?.fields?.[next] ?? {};
    setFields(Object.fromEntries(Object.entries(saved).map(([key, value]) => [key, typeof value === "string" ? value : ""])));
    setPathStyle(saved.pathStyle === true);
  };

  /** A probe runs before trusting a target: it lists the folder, which proves both the credentials and the path. */
  const test = (): void => {
    setBusy("test");
    void post("/api/sync/test", { mode, target: { ...fields, pathStyle } })
      .then((d) => {
        const answer = d as { ok?: boolean; error?: string; count?: number } | null;
        if (answer?.ok) toast("Connected", `${answer.count ?? 0} backup${answer.count === 1 ? "" : "s"} found there.`, "check");
        else toast("Could not connect", answer?.error ?? "The remote did not answer.", "circle-alert");
      })
      .finally(() => setBusy(null));
  };

  const refresh = (): void => {
    setBusy("refresh");
    void fetch("/api/sync")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: SyncView | null) => {
        if (d) setView(d);
      })
      .catch(() => toast("Refresh failed", "The dashboard server did not answer.", "circle-alert"))
      .finally(() => setBusy(null));
  };

  const post = (url: string, body: unknown): Promise<{ ok?: boolean; error?: string; name?: string } | null> =>
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then((r) => r.json())
      .catch(() => null);

  const save = (): void => {
    setBusy("save");
    void post("/api/sync", { mode, passphrase, target: { ...fields, pathStyle } })
      .then((d) => {
        if (d?.ok) {
          toast("Sync target saved", "Passwords stay on this computer.", "check");
          load();
        } else toast("Could not save", d?.error ?? "The server refused the target.", "circle-alert");
      })
      .finally(() => setBusy(null));
  };

  const run = (): void => {
    setBusy("run");
    void post("/api/sync/run", {})
      .then((d) => {
        if (d?.ok) {
          toast("Backed up to the remote", d.name ? `One sealed file: ${d.name}.` : "One sealed file.", "check");
          load();
        } else toast("Backup failed", d?.error ?? "The remote did not answer.", "circle-alert");
      })
      .finally(() => setBusy(null));
  };

  const restore = (name: string): void => {
    setBusy("restore");
    setAsking(null);
    void post("/api/sync/restore", { name })
      .then((d) => {
        if (d?.ok) {
          toast("Restored", "The state before the restore was kept as a snapshot.", "check");
          requestReload();
        } else toast("Restore failed", d?.error ?? "The backup could not be opened.", "circle-alert");
      })
      .finally(() => setBusy(null));
  };

  const rows = SYNC_FIELDS[mode];
  const hint = SYNC_MODES.find((entry) => entry.id === mode)?.hint ?? "";

  return (
    <Accordion className="rounded-2xl border border-line bg-panel">
      <AccordionItem value="sync" className="border-0">
        <AccordionTrigger className="px-4 py-3 hover:no-underline">
          <span className="grid gap-0.5 text-left">
            <span className="flex items-center gap-2 text-[13px] font-semibold">
              <Icon name="cloud" className="size-4" />
              <span>Sync and backup</span>
              <Badge variant="outline" className="mono h-5 rounded-md border-line px-1.5 text-[10px] text-dim">{view?.configured ? "on" : "off"}</Badge>
            </span>
            <span className="text-xs font-normal text-dim">Send each snapshot off this computer, sealed with your passphrase.</span>
          </span>
        </AccordionTrigger>
        <AccordionContent className="pb-0">
          <div className="grid gap-3 px-4 pb-4">
            <Tabs value={mode} onValueChange={(v) => pick((v ?? "webdav") as SyncMode)}>
              <TabsList className="h-9 w-full justify-start gap-1 rounded-xl p-1">
                {SYNC_MODES.map((entry) => (
                  <TabsTrigger key={entry.id} value={entry.id} className="h-7 flex-1 gap-1.5 px-4 text-[12px]">
                    {entry.id === "github" ? <GithubMark className="size-3.5" /> : <Icon name={entry.icon ?? "globe"} className="size-3.5" />}
                    <span>{entry.label}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
        <p className="m-0 text-xs text-dim">{hint}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {rows.map((row) => (
            <label key={row.key} className="grid gap-1 text-[11px] text-dim">
              <span>{row.label}</span>
              {row.secret ? (
                <span className="relative">
                  <Input
                    type={revealed[row.key] ? "text" : "password"}
                    value={fields[row.key] ?? ""}
                    placeholder={view?.passphraseSet ? "saved" : row.placeholder}
                    className="pr-9"
                    onChange={(event) => setFields({ ...fields, [row.key]: event.target.value })}
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-1 grid w-7 place-items-center rounded-md text-dim hover:text-ink"
                    aria-label={revealed[row.key] ? `Hide ${row.label}` : `Show ${row.label}`}
                    onClick={() => setRevealed({ ...revealed, [row.key]: !revealed[row.key] })}
                  >
                    <Icon name={revealed[row.key] ? "eye-off" : "eye"} className="size-3.5" />
                  </button>
                </span>
              ) : (
                <Input
                  type="text"
                  value={fields[row.key] ?? ""}
                  placeholder={row.placeholder}
                  onChange={(event) => setFields({ ...fields, [row.key]: event.target.value })}
                />
              )}
            </label>
          ))}
          {mode === "s3" && (
            <label className="flex items-center gap-2 text-[11px] text-dim">
              <input type="checkbox" checked={pathStyle} onChange={(event) => setPathStyle(event.target.checked)} />
              <span>Path-style: the bucket in the path, not the host name</span>
            </label>
          )}
          <label className="grid gap-1 text-[11px] text-dim sm:col-span-2">
            <span>Passphrase</span>
            <span className="relative">
              <Input
                type={revealed.passphrase ? "text" : "password"}
                value={passphrase}
                placeholder={view?.passphraseSet ? "saved — type to replace" : "the same on every computer"}
                className="pr-9"
                onChange={(event) => setPassphrase(event.target.value)}
              />
              <button
                type="button"
                className="absolute inset-y-0 right-1 grid w-7 place-items-center rounded-md text-dim hover:text-ink"
                aria-label={revealed.passphrase ? "Hide the passphrase" : "Show the passphrase"}
                onClick={() => setRevealed({ ...revealed, passphrase: !revealed.passphrase })}
              >
                <Icon name={revealed.passphrase ? "eye-off" : "eye"} className="size-3.5" />
              </button>
            </span>
          </label>
        </div>
        <p className="m-0 text-xs text-dim">
          The file is sealed on this computer; the remote only ever sees it sealed. Keep the passphrase: without it a backup cannot be opened.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" className="mono h-8 gap-1.5 rounded-xl" disabled={busy !== null} onClick={save}>
            {busy === "save" ? <Spinner className="size-3.5" /> : <Icon name="check" className="size-3.5" />}
            <span>Save target</span>
          </Button>
          <Button size="sm" variant="outline" className="mono h-8 gap-1.5 rounded-xl" disabled={busy !== null} onClick={test}>
            {busy === "test" ? <Spinner className="size-3.5" /> : <Icon name="plug-zap" className="size-3.5" />}
            <span>Test connection</span>
          </Button>
          <Button size="sm" variant="outline" className="mono h-8 gap-1.5 rounded-xl" disabled={busy !== null || !view?.configured} onClick={run}>
            {busy === "run" ? <Spinner className="size-3.5" /> : <Icon name="cloud-upload" className="size-3.5" />}
            <span>Back up to remote</span>
          </Button>
          {view?.target && <span className="mono min-w-0 truncate text-[11px] text-dim">{view.target}</span>}
        </div>
        {view?.error && <p className="m-0 text-xs text-red-500">{view.error}</p>}
        <div className="grid gap-1">
          <div className="flex items-center gap-2">
            <p className="m-0 flex-1 text-[11px] text-dim">Versions on the remote</p>
            <Button size="sm" variant="ghost" className="mono h-7 gap-1.5 rounded-lg px-2" disabled={busy !== null || !view?.configured} onClick={refresh}>
              <Icon name="refresh-cw" className={cn("size-3.5", busy === "refresh" && "animate-spin")} />
              <span>Refresh</span>
            </Button>
          </div>
          {(view?.versions ?? []).length === 0 && <p className="m-0 text-xs text-dim">Nothing there yet.</p>}
          {(view?.versions ?? []).map((version) => (
            <div key={version.name} className="flex items-center gap-2 rounded-lg border border-line px-2 py-1">
              <span className="mono min-w-0 flex-1 truncate text-[11px]">{version.name}</span>
              <span className="mono text-[11px] text-dim">{sizeText(version.bytes)}</span>
              {asking === version.name ? (
                <>
                  <Button size="sm" variant="destructive" className="h-7 rounded-lg" disabled={busy !== null} onClick={() => restore(version.name)}>
                    Restore
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 rounded-lg" onClick={() => setAsking(null)}>Cancel</Button>
                </>
              ) : (
                <Button size="sm" variant="outline" className="h-7 rounded-lg" onClick={() => setAsking(version.name)}>Restore…</Button>
              )}
            </div>
          ))}
        </div>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

function DataPane() {
  const toast = useToast();
  const [backups, setBackups] = useState<DataBackupRow[] | null>(null);
  const [schedule, setSchedule] = useState("monthly");
  const [keep, setKeep] = useState(3);
  const [dir, setDir] = useState("");
  /** The snapshot the footer works on. A name the list no longer holds reads as no pick. */
  const [picked, setPicked] = useState<string | null>(null);
  /** Multi-select prunes several snapshots at once; restore still works on one. */
  const [selected, setSelected] = useState<string[]>([]);
  const [asking, setAsking] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The reset confirm. The counts come from the data payload, so the dialog names them. */
  const [resetting, setResetting] = useState(false);
  const [counts, setCounts] = useState<{ rows: number; rtk: number } | null>(null);
  const [retention, setRetention] = useState(0);
  const [advanced, setAdvanced] = useState(false);

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
      .then((d: { backupSchedule?: string; retentionDays?: number } | null) => {
        if (d?.backupSchedule) setSchedule(d.backupSchedule);
        if (typeof d?.retentionDays === "number") setRetention(d.retentionDays);
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

  const saveRetention = (next: number): void => {
    setRetention(next);
    void fetch("/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ retentionDays: next }),
    })
      .then((r) => r.json())
      .then((d: { ok?: boolean; error?: string }) => {
        if (!d?.ok) toast("Could not save", d?.error ?? "Unknown window", "circle-alert");
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

  const toggleSelected = (name: string): void => {
    setSelected((current) => (current.includes(name) ? current.filter((entry) => entry !== name) : [...current, name]));
  };

  const deleteSelected = (): void => {
    if (selected.length === 0) return;
    setBusy(true);
    void fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", names: selected }),
    })
      .then((r) => r.json())
      .then((d: { ok?: boolean; deleted?: string[]; error?: string }) => {
        if (d?.ok) {
          toast("Snapshots deleted", `${d.deleted?.length ?? selected.length} removed.`, "check");
          setSelected([]);
          setPicked(null);
          load();
        } else toast("Delete failed", d?.error ?? "The server did not answer.", "circle-alert");
      })
      .catch(() => toast("Delete failed", "The dashboard server did not answer.", "circle-alert"))
      .finally(() => setBusy(false));
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
  const retentionLabel = RETENTION_OPTIONS.find((o) => o.id === retention)?.label ?? "Forever";
  const retentionHint = RETENTION_OPTIONS.find((o) => o.id === retention)?.hint ?? "";
  const scheduleLabel = SCHEDULE_OPTIONS.find((o) => o.id === schedule)?.label ?? "Monthly";
  const scheduleHint = SCHEDULE_OPTIONS.find((o) => o.id === schedule)?.hint ?? "";

  return (
    <section aria-label="Data" className="grid gap-4">
      <SyncPanel />
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
        title="Data retention"
        icon="clock"
        description="How long usage history is kept. Older entries drop on the next sync."
        actions={
          <Select value={String(retention)} onValueChange={(v) => saveRetention(Number(v ?? 0))}>
            <SelectTrigger size="sm" className="w-[132px]" aria-label="Data retention">
              <SelectValue placeholder={retentionLabel}>{retentionLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {RETENTION_OPTIONS.map((o) => (
                  <SelectItem key={o.id} value={String(o.id)}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        }
      >
        <p className="m-0 text-xs text-dim">
          {retentionHint}. Session transcripts, rtk history, and snapshots keep their own copies.
        </p>
      </Card>

      <Card
        title="Snapshots"
        icon="layers"
        description="Newest first. One file each. A restore copies its contents over the live data."
        footer={
          (
            <>
              <span className="mono min-w-0 flex-1 truncate text-[11px] text-dim">
                {selected.length > 1
                  ? `${selected.length} selected`
                  : chosen ? `${dataStamp(chosen.mtime)} · ${dataSize(chosen.bytes)}` : "Pick a snapshot to restore or delete it."}
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
              {selected.length > 1 ? (
                <Button
                  size="sm"
                  variant="destructive"
                  className="mono h-8 gap-1.5 rounded-xl"
                  disabled={busy}
                  onClick={deleteSelected}
                >
                  <Icon name="trash" className="size-3.5" />
                  Delete {selected.length}
                </Button>
              ) : (
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
              )}
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
                const checked = selected.includes(b.name);
                return (
                  <div key={b.name} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-3.5 shrink-0 accent-accent"
                    aria-label={`Select ${dataStamp(b.mtime)}`}
                    checked={checked}
                    onChange={() => toggleSelected(b.name)}
                  />
                  <button
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
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      <Button
        variant="ghost"
        size="sm"
        className="mono h-8 w-fit gap-1.5 rounded-xl"
        aria-expanded={advanced}
        onClick={() => setAdvanced((open) => !open)}
      >
        <Icon name="chevron-right" className={`size-3.5 transition-transform ${advanced ? "rotate-90" : ""}`} />
        Advanced
      </Button>

      {advanced && (
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
      )}

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
  const [scanning, setScanning] = useState(false);
  const [askFix, setAskFix] = useState(false);
  useEffect(() => {
    void fetchDoctor().then((d) => d && setReport(d));
  }, []);
  const groups = (() => {
    const seen: string[] = [];
    (report?.rows ?? []).forEach((r) => {
      if (!seen.includes(r.group || "Other")) seen.push(r.group || "Other");
    });
    return seen;
  })();
  const fixIssues = (): void => {
    setAskFix(false);
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
        return fetchDoctor();
      })
      .then((d) => d && setReport(d))
      .finally(() => setFixing(false));
  };
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="min-w-0 pr-2.5 pb-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-[13px] font-semibold">Scan</p>
          <p className="mt-0.5 mb-0 text-xs text-dim">Runs every check fresh and refreshes the list below. {report?.checkedAt ? `(Last checked ${relAge(report.checkedAt)}.)` : "(Never checked.)"}</p>
        </div>
        <button
          type="button"
          className="mono flex shrink-0 items-center gap-2 text-xs pl-2.5 pr-3 py-2 rounded-xl border border-line text-ink [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96]"
          aria-label="Scan now"
          disabled={scanning}
          onClick={() => {
            setScanning(true);
            void fetchDoctor()
              .then((d) => {
                if (d) {
                  setReport(d);
                  if (d.rows.some((row) => !row.ok && !row.neutral)) setAskFix(true);
                } else if (isFileExport()) toast("Snapshot export", "Live scan needs tersio dashboard.", "scan-line");
              })
              .finally(() => setScanning(false));
          }}
        >
          <Icon name={scanning ? "loader-circle" : "scan-line"} className={`size-3.5 ${scanning ? "animate-spin" : ""}`} />
          <span>{scanning ? "Scanning" : "Scan"}</span>
        </button>
      </div>
      <Table className="mt-4 w-full table-fixed border-y border-line">
        <TableCaption className="sr-only">Diagnosis check results</TableCaption>
        <TableHeader className="sticky top-0 z-10 bg-panel">
          <TableRow>
            <TableHead className="h-9 pl-3 text-[11px] tracking-[0.12em] text-dim uppercase">Check</TableHead>
            <TableHead className="h-9 w-20 pr-3 text-right text-[11px] tracking-[0.12em] text-dim uppercase sm:w-28">Status</TableHead>
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
              .map((r, index) => (
                <TableRow key={`${r.label}-${index}`}>
                  <TableCell className="py-3 pl-3">
                    <div className="flex min-w-0 items-center gap-2">
                      {r.host && <AgentLogo host={r.host} className="size-4 shrink-0" />}
                      <div className="min-w-0">
                        <p className="m-0 font-semibold text-ink">{r.label}</p>
                        {r.detail && <p className="mono mt-0.5 mb-0 max-w-full truncate text-xs text-dim">{r.detail}</p>}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="py-3 pr-3 text-right">
                    <Badge variant={r.neutral ? "outline" : r.ok ? "success" : "destructive"}>
                      {!r.neutral && <span className={`size-1.5 rounded-full ${r.ok ? "bg-accent" : "bg-danger"}`} />}
                      {r.host ? (r.ok ? "Installed" : "Not installed") : r.neutral ? "—" : r.ok ? "Pass" : "Fix"}
                    </Badge>
                  </TableCell>
                </TableRow>
              )),
          ])}
        </TableBody>
      </Table>
        </div>
      </ScrollArea>
      <div className="flex shrink-0 items-center justify-between gap-3 rounded-xl border border-warn-border bg-warn-soft px-3.5 py-3 max-sm:flex-col max-sm:items-stretch max-sm:gap-2">
        <div className="min-w-0">
          <p className="m-0 text-[13px] font-semibold">Fix issues</p>
          <p className="mt-0.5 mb-0 text-xs text-dim">Repairs the checked items. RTK binary and CLI update stay manual.</p>
        </div>
        <button
          type="button"
          className="mono flex shrink-0 items-center gap-2 text-xs pl-2.5 pr-3 py-2 rounded-xl border border-line text-ink [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96] max-sm:w-full max-sm:justify-center"
          aria-label="Fix diagnosed issues"
          disabled={fixing}
          onClick={fixIssues}
        >
          <Icon name="wrench" className="size-3.5" />
          <span>{fixing ? "Fixing…" : "Fix issues"}</span>
        </button>
      </div>
      <AlertDialog open={askFix} onOpenChange={setAskFix}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fix these issues?</AlertDialogTitle>
            <AlertDialogDescription>
              Tersio found {report?.rows.filter((row) => !row.ok && !row.neutral).length ?? 0} issue(s). Repair them now? RTK binary and CLI updates stay manual.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not now</AlertDialogCancel>
            <AlertDialogAction onClick={fixIssues}>Fix issues</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const PANES: Array<{ id: Pane; label: string; icon: string }> = [
  { id: "general", label: "General", icon: "settings" },
  { id: "data", label: "Data", icon: "database" },
  { id: "diagnosis", label: "Diagnosis", icon: "stethoscope" },
  { id: "about", label: "About", icon: "info" },
];

const TITLES: Record<Pane, string> = {
  general: "Settings",
  data: "Data",
  diagnosis: "Doctor",
  about: "About",
};

const SETTINGS_SEARCH: Array<{ pane: Pane; label: string; terms: string }> = [
  { pane: "general", label: "Theme", terms: "general appearance theme light dark system color scheme mode" },
  { pane: "general", label: "Accent color", terms: "general appearance accent color tint buttons links highlights palette emerald violet slate cyan rose amber orange charts background" },
  { pane: "general", label: "Currency", terms: "currency display cost usd euro" },
  { pane: "data", label: "Snapshots", terms: "data snapshot backup restore copy mirror ledger settings price cache schedule keep size" },
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
  { label: "Headroom", glyph: "🍃", hint: "headroomlabs-ai — the compression Tersio wraps", href: "https://github.com/headroomlabs-ai/headroom" },
  { label: "EcoLogits", glyph: "🌍", hint: "mlco2 — informs the Carbon page's estimates", href: "https://github.com/mlco2/ecologits" },
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
      <DialogContent className="block h-[min(90vh,940px)] max-h-[calc(100dvh-2rem)] w-[min(1120px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] sm:max-w-[1120px] max-sm:h-dvh max-sm:max-h-dvh max-sm:w-screen max-sm:max-w-none max-sm:rounded-none max-sm:border-0 gap-0 overflow-hidden rounded-2xl border border-line bg-panel p-0 text-ink shadow-[0_16px_48px_rgba(0,0,0,.35)]" showCloseButton={false} aria-describedby={undefined}>
        <div className="grid h-full min-h-0 max-h-full grid-cols-[300px_minmax(0,1fr)] max-sm:grid-cols-1 max-sm:grid-rows-[auto_minmax(0,1fr)]">
          <aside className="settings-rail flex min-h-0 flex-col gap-2.5 border-r border-line px-3 py-4 max-sm:border-r-0 max-sm:border-b" aria-label="Settings sections">
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
              <button
                type="button"
                className="ml-1 grid size-7 shrink-0 place-items-center rounded-lg border border-line text-ink sm:hidden"
                aria-label="Close settings"
                onClick={onClose}
              >
                <Icon name="x" className="size-3.5" />
              </button>
            </div>
            <nav id="settings-search-results" className="grid gap-0.5 overflow-y-auto max-sm:flex max-sm:flex-row max-sm:gap-1 max-sm:overflow-x-auto max-sm:pb-1" aria-label="Settings">
              {shown.map((p) => {
                const paneMatches = matches.filter((item) => item.pane === p.id);
                return (
                  <div key={p.id} className="contents">
                    <button type="button" className={`flex w-full shrink-0 items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13px] text-ink hover:bg-track max-sm:w-auto max-sm:whitespace-nowrap ${pane === p.id ? "bg-track font-semibold" : "bg-transparent font-normal"}`} onClick={() => setPane(p.id)}>
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
            <div className="mono mt-auto flex items-center justify-between gap-2 px-2.5 text-[11px] text-dim max-sm:hidden">
              <span className="min-w-0 truncate">{version ? `v${version}` : "Tersio"}</span>
              <SocialLinks className="flex shrink-0 items-center gap-0.5" />
            </div>
          </aside>
          <div className="settings-surface relative flex min-h-0 min-w-0 flex-col">
            <div className="flex items-center justify-between gap-3 px-5 pt-4">
              <DialogTitle className="m-0 flex items-center gap-2 text-base font-bold tracking-[-0.01em]">
                <Icon name={PANES.find((p) => p.id === pane)?.icon ?? "settings"} className="size-4 shrink-0 text-dim" />
                {TITLES[pane]}
              </DialogTitle>
              <button
                type="button"
                className="flex shrink-0 items-center rounded-xl border border-line p-2 text-ink [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96] max-sm:hidden"
                aria-label="Close settings"
                onClick={onClose}
              >
                <Icon name="x" className="size-4" />
              </button>
            </div>
            <div className={`min-h-0 min-w-0 overscroll-contain px-5 pt-4 ${pane === "diagnosis" ? "flex flex-1 overflow-hidden pb-5" : "overflow-y-auto pb-5 [scrollbar-width:thin] [scrollbar-color:var(--line)_transparent]"}`}>
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
                </section>
              )}
              {pane === "data" && (
                <section aria-label="Data">
                  <DataPane />
                </section>
              )}
              {pane === "diagnosis" && (
                <section className="min-h-0 min-w-0 flex-1" aria-label="Diagnosis">
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


