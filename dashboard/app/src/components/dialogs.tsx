// Settings dialog: theme, accent, currency, doctor.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTheme, useResolvedTheme } from "@/components/theme-provider";
import { ACCENTS, ACCENT_IDS, accentSwatch, type AccentId } from "@/lib/accent";
import { FX_SNAPSHOT, relAge } from "@/lib/format";
import {
  fetchDoctor,
  fetchHealth,
  isFileExport,
  postDoctorFix,
  postDoctorSchedule,
} from "@/lib/data";
import type { DoctorReport, HealthReport } from "@/lib/data";
import { useToast } from "./toaster";
import { HoverTip } from "./common";
import { Icon } from "./icon";
import { OmpLogo, OpencodeLogo, PiLogo } from "./agent-logos";

type Pane = "general" | "connection" | "diagnosis";

interface AgentRowProps {
  name: string;
  version: string | null;
  binPath: string | null;
  dirPath: string | null;
  bin: string;
  docs: string;
  available: boolean;
  unavailable: boolean;
  logo: ReactNode;
}

function AgentRow({ name, version, binPath, dirPath, bin, docs, available, unavailable, logo }: AgentRowProps) {
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
          {/* PATH binary as secondary, config directory first when known. */}
          {dirPath ? (
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
    { name: "Oh My Pi", version: health?.omp ?? null, binPath: health?.ompPath ?? null, dirPath: health?.ompDir ?? null, bin: "omp", docs: "https://omp.sh", available: !!health?.omp, unavailable, logo: <OmpLogo className="size-5" /> },
    { name: "Pi", version: health?.pi ?? null, binPath: health?.piPath ?? null, dirPath: health?.piDir ?? null, bin: "pi", docs: "https://pi.dev", available: !!health?.pi, unavailable, logo: <PiLogo className="size-5" /> },
    { name: "OpenCode", version: health?.opencode ?? null, binPath: health?.opencodePath ?? null, dirPath: health?.opencodeDir ?? null, bin: "opencode", docs: "https://opencode.ai", available: !!health?.opencode, unavailable, logo: <OpencodeLogo className="size-5" /> },
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


/** The three panes the dialog offers. */
const PANES: Array<{ id: Pane; label: string; icon: string }> = [
  { id: "general", label: "General", icon: "settings" },
  { id: "connection", label: "Connection", icon: "plug" },
  { id: "diagnosis", label: "Diagnosis", icon: "stethoscope" },
];

/** One title per pane, so the header names the pane in force. */
const TITLES: Record<Pane, string> = {
  general: "Settings",
  connection: "Connection",
  diagnosis: "Doctor",
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

function CurrencyPicker({ cur, onPick, id }: { cur: string; onPick: (code: string) => void; id: string }) {
  const toast = useToast();
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-dim">Currency</span>
      <Select value={cur} onValueChange={(next) => { if (next !== cur) { onPick(next as string); toast(`Currency set to ${next}`, "Cost figures update across the dashboard.", "check"); } }}>
        <SelectTrigger size="sm" aria-label="Display currency" className="text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {Object.keys(FX_SNAPSHOT).map((code) => (
              <SelectItem key={code} value={code}>{code}</SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <span id={id} className="sr-only">{cur}</span>
    </div>
  );
}

export function SettingsDialog({
  open,
  onClose,
  cur,
  onCurrency,
}: {
  open: boolean;
  onClose: () => void;
  cur: string;
  onCurrency: (code: string) => void;
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
            <p className="mono mt-auto px-2.5 text-[11px] text-dim">Tersio dashboard</p>
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
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}


