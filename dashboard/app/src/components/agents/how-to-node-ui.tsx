// Node option surfaces: shadcn dialogs for the mode levels, side drawers for hosts and the wrap center. Every control that used to live in the fold panel or the Modes tab lands here.
import { useCallback, useEffect, useState } from "react";
import { AgentLogo } from "@/components/agent-logos";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle,
} from "@/components/ui/drawer";
import { MarkGlyph } from "@/components/brand";
import { imageMark, maskMark } from "@/lib/marks";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { luminance, MARK_BG } from "../../../../../extensions/shared/brand-marks.ts";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "../toaster";
import { cn } from "cn";
import { UPCOMING_AGENTS } from "@/lib/agents";
import { checkVendor, fetchHeadroomProxy, fetchHeadroomWraps, fetchHealth, fetchWrapTargets, postHeadroomProxy, type HeadroomWrapTarget, postHeadroomWrap, postHeadroomWraps, postVendorAction, readStoredWraps, stopHeadroomProxy, storeWraps, type HeadroomProxyState, type HealthReport, type VendorRow } from "@/lib/data";
import {
  ABOUT, DEFAULT_ROWS_UI, HOSTS, MODES, OFF_DEFAULTS, PICKER, nodeGlyph, nodeTitle, nodeValue, versionOf,
} from "./pipeline-model";
import type { DefaultsPayload, HostAction, HostState, NodeId } from "./pipeline-model";
import type { ModeState } from "./shell";

type HostId = "omp" | "pi" | "pig" | "opencode";

export interface NodeSurfaceProps {
  node: NodeId;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modes: ModeState | null;
  hostState: HostState;
  busy: NodeId | null;
  onSet: (node: NodeId, field: string, value: string | boolean, host?: HostId) => void;
  onHostAction: (node: NodeId, action: HostAction) => void;
  onSaved: () => void;
}

/** The two addresses any agent needs to route through the shared proxy; the drawer copies them. */
const COPY_URLS: ReadonlyArray<{ label: string; value: string }> = [
  { label: "Anthropic", value: "ANTHROPIC_BASE_URL=http://127.0.0.1:8787" },
  { label: "OpenAI", value: "OPENAI_BASE_URL=http://127.0.0.1:8787/v1" },
];

/** One selectable level card: label, optional hint, and a check that pops in on select. */
function LevelCard({
  label, hint, active, disabled, onClick,
}: {
  label: string;
  hint?: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "group relative flex min-h-[52px] flex-col items-start justify-center gap-0.5 overflow-hidden rounded-lg border px-3 py-2 text-left transition-all duration-200",
        active
          ? "border-accent/60 bg-accent-soft"
          : "border-line hover:-translate-y-px hover:border-accent/40 hover:bg-track/40",
        disabled && "cursor-default opacity-50 hover:translate-y-0",
      )}
    >
      <span className={cn("mono truncate text-[11px] font-semibold", active ? "text-ink" : "text-dim group-hover:text-ink")}>{label}</span>
      {hint ? <span className="mono truncate text-[9px] text-dim">{hint}</span> : null}
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-2 right-2 grid size-3.5 place-items-center rounded-full border transition-transform duration-150",
          active ? "scale-100 border-accent bg-accent text-panel" : "scale-0 border-line",
        )}
      >
        <Icon name="check" className="size-2.5" />
      </span>
    </button>
  );
}

/** A settings row: the title and hint on the left, a switch on the right. */
function ToggleRow({
  title, hint, checked, disabled, onCheckedChange,
}: {
  title: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (on: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-line bg-track/20 px-3.5 py-3">
      <div className="min-w-0">
        <p className="m-0 text-[12px] font-semibold">{title}</p>
        <p className="m-0 mt-0.5 text-[10px] leading-snug text-dim">{hint}</p>
      </div>
      <Switch size="sm" checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  );
}

/** Shown when a vendor binary is not on the machine: configure nothing, install from the footer. */
function NotInstalledNote({ tool }: { tool: string }) {
  return (
    <Alert>
      <Icon name="circle-alert" className="size-4" />
      <AlertTitle className="mono text-[11px]">{tool} is not installed</AlertTitle>
      <AlertDescription className="text-[10px] leading-snug">
        Install it from the footer below to configure it and see its version.
      </AlertDescription>
    </Alert>
  );
}

function SurfaceHeader({ node, version }: { node: NodeId; version?: string | null }) {
  const glyph = nodeGlyph(node);
  return (
    <span className="flex items-center gap-2">
      {glyph ? <span aria-hidden="true" className="text-[13px] leading-none">{glyph}</span> : null}
      <span className="min-w-0 truncate text-sm font-semibold">{nodeTitle(node)}</span>
      {version ? <span className="mono ml-auto shrink-0 rounded border border-success/40 px-1.5 py-0.5 text-[9px] leading-none text-success">{version}</span> : null}
    </span>
  );
}

/** The mode levels for one agent's own section, which wins over the shared store it inherits from. */
function AgentModes({ host, onSaved }: { host: HostId; onSaved: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState<DefaultsPayload>(OFF_DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    fetch("/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: (Partial<DefaultsPayload> & { hosts?: Record<string, Partial<Record<string, string | boolean>>> }) | null) => {
        if (!d) return;
        const section: Partial<Record<string, string | boolean>> = d.hosts?.[host] ?? {};
        const pick = (key: keyof DefaultsPayload, fallback: string | boolean): string | boolean => section[key] ?? (d as Partial<Record<string, string | boolean>>)[key] ?? fallback;
        setCurrent({
          comboDefault: String(pick("comboDefault", "off")),
          comboLevel: "custom",
          cavemanDefault: String(pick("cavemanDefault", "off")),
          rtkDefault: typeof pick("rtkDefault", false) === "boolean" ? Boolean(pick("rtkDefault", false)) : false,
          ponytailDefault: String(pick("ponytailDefault", "off")),
          pstackDefault: String(pick("pstackDefault", "off")),
          headroomDefault: String(pick("headroomDefault", "off")),
        });
      })
      .catch(() => { /* keep what is on screen; the rows still save */ })
      .finally(() => setLoaded(true));
  }, [host]);
  useEffect(() => {
    load();
  }, [load]);

  const save = (row: (typeof DEFAULT_ROWS_UI)[number], id: string): void => {
    const value: string | boolean = row.field === "rtkDefault" ? id === "on" : id;
    setCurrent((c) => ({ ...c, [row.field]: value }));
    void fetch("/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [row.field]: value, host }),
    })
      .then((r) => r.json())
      .then((d: { ok?: boolean; error?: string }) => {
        if (d?.ok) {
          // A preset rewrites the three modes it owns, and the combo row reads the derived level; read the saved state back.
          load();
          onSaved();
          toast(`${row.label} saved`, `Applies to new ${host} sessions`, "check");
        } else {
          toast("Could not save", d?.error ?? "Unknown level", "circle-alert");
        }
      })
      .catch(() => toast("Could not save", "The dashboard server did not answer.", "circle-alert"));
  };

  return (
    <div className="grid gap-5">
      {DEFAULT_ROWS_UI.map((row) => {
        const raw = current[row.field];
        const isRtk = row.field === "rtkDefault";
        const value = String(raw ?? "off");
        const locked = !loaded;
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
                aria-label={`${row.label} default for ${host}`}
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
              <SelectTrigger size="sm" className="w-[132px] shrink-0" aria-label={`${row.label} default for ${host}`}>
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
      <p className="mono m-0 text-[10px] text-dim">
        Rows left off inherit the shared default — only what you set here belongs to {host}.
      </p>
    </div>
  );
}

/** Mode nodes open a side drawer: the level list, and the scope the level writes to. */
export function ModeDrawer({ node, open, onOpenChange, modes, hostState, busy, onSet }: NodeSurfaceProps) {
  const [health, setHealth] = useState<HealthReport | null>(null);
  useEffect(() => {
    if (open) void fetchHealth().then(setHealth);
  }, [open]);
  const key = (MODES.find((m) => m.key === node)?.key ?? "headroom") as keyof typeof PICKER;
  const picker = PICKER[key];
  const installed = HOSTS.filter((h) => hostState.installed[h.id] !== false).map((h) => h.id as HostId);
  const [scope, setScope] = useState<HostId | "all">("all");
  useEffect(() => {
    if (open) setScope("all");
  }, [open]);
  const current = nodeValue(node, scope, modes);
  const picked = picker.options.some((option) => option.id === current) ? current : null;
  // A scope without its own section inherits the shared value, so the row says so.
  const section = scope !== "all" ? (modes?.hosts?.[scope] ?? {}) as Partial<Record<string, string | boolean>> : undefined;
  const inherited = modes !== null && section !== undefined && section[picker.field as "comboDefault"] === undefined;

  return (
    <Drawer open={open} onOpenChange={onOpenChange} swipeDirection="right">
      <DrawerContent>
        <DrawerHeader className="border-b border-line pb-3.5 px-6 pt-4">
          <DrawerTitle><SurfaceHeader node={node} version={health?.modes?.[node as "caveman"] ?? null} /></DrawerTitle>
          <DrawerDescription className="text-[11px] leading-relaxed">{ABOUT[node] ?? ""}</DrawerDescription>
        </DrawerHeader>
        <div className="grid min-h-0 flex-1 content-start gap-1.5 overflow-y-auto px-6 py-4 pb-5">
          <div className="mb-1 flex items-center gap-2">
            <span className="mono text-[10px] tracking-[0.1em] text-dim uppercase">scope</span>
            <Select value={scope} onValueChange={(v) => setScope(v as HostId | "all")}>
              <SelectTrigger size="sm" className="ml-auto w-[170px]" aria-label="Who this level applies to">
                {/* SelectValue needs children or it shows the raw value. */}
                <SelectValue>{scope === "all" ? "All agents (shared)" : `${HOSTS.find((x) => x.id === scope)?.label ?? scope} only`}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">All agents (shared)</SelectItem>
                  {installed.map((h) => (
                    <SelectItem key={h} value={h}>{HOSTS.find((x) => x.id === h)?.label ?? h} only</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          {modes === null ? (
            <div className="grid gap-1.5" aria-busy="true" aria-hidden="true">
              <Skeleton className="h-8 w-full rounded-md" />
              <Skeleton className="h-8 w-full rounded-md" />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1.5 [&>*:last-child:nth-child(odd)]:col-span-2">
              {picker.options.map((option) => (
                <LevelCard
                  key={option.id}
                  label={option.label}
                  hint={inherited && current === option.id ? "inherited" : undefined}
                  active={current === option.id}
                  disabled={busy !== null || option.id === "custom"}
                  onClick={() => onSet(node, picker.field, picker.field === "rtkDefault" ? option.id === "on" : option.id, scope === "all" ? undefined : scope)}
                />
              ))}
            </div>
          )}
          <p className="mono m-0 mt-1 text-[9px] text-dim">
            {scope !== "all" ? `saves for ${scope} only` : "every agent reads this"}
            {picked ? ` · /${key} ${picked}` : ""}
          </p>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/** A host node opens the side drawer: install actions, then its own defaults rows. */
export function HostDrawer({ node, open, onOpenChange, hostState, busy, onHostAction, onSaved }: NodeSurfaceProps) {
  const hostId = node.slice("host-".length) as HostId;
  const host = HOSTS.find((h) => h.id === hostId);
  const installed = hostState.installed[hostId] !== false;
  const [running, setRunning] = useState<HostAction | null>(null);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (busy !== node) setRunning(null);
  }, [busy, node]);
  useEffect(() => {
    if (open) setConfirming(false);
  }, [open, node]);
  const start = (action: HostAction): void => {
    setRunning(action);
    onHostAction(node, action);
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange} swipeDirection="right">
      <DrawerContent>
        <DrawerHeader className="border-b border-line pb-3.5 px-6 pt-4">
          <DrawerTitle>
            <span className="flex items-center gap-2">
              <AgentLogo host={hostId} className="size-4 shrink-0" />
              <span className="min-w-0 truncate">{host?.label ?? hostId}</span>
              <span className={cn(
                "mono ml-auto shrink-0 rounded border px-1.5 py-0.5 text-[9px]",
                installed ? "border-success/40 text-success" : "border-line text-dim",
              )}
              >
                {installed ? versionOf(hostState.versions[hostId]) ?? "installed" : "not installed"}
              </span>
            </span>
          </DrawerTitle>
          <DrawerDescription className="text-[11px] leading-relaxed">{ABOUT[node] ?? ""}</DrawerDescription>
        </DrawerHeader>
        <div className="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto px-6 py-4">
          {installed ? (
            <div className="rounded-lg bg-track/40 p-4">
              <AgentModes host={hostId} onSaved={onSaved} />
            </div>
          ) : (
            <p className="m-0 text-[11px] leading-relaxed text-dim">
              Install writes the Tersio tree for this agent; its own defaults rows appear here once it runs.
            </p>
          )}
        </div>
        <DrawerFooter className="border-t border-line px-6 pb-4 pt-3.5">
          <div className={cn("grid w-full gap-2", installed && "grid-cols-2")}>
            {installed ? (
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => start("update")} className="w-full gap-1.5">
                {busy === node && running === "update" ? <Spinner className="size-3 text-accent" /> : <Icon name="circle-arrow-up" className="size-3.5" />}
                Update
              </Button>
            ) : (
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => start("install")} className="w-full gap-1.5">
                {busy === node && running === "install" ? <Spinner className="size-3 text-accent" /> : <Icon name="plus" className="size-3.5" />}
                Install
              </Button>
            )}
            {installed ? (
              confirming ? (
                <Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => start("uninstall")} className="w-full gap-1.5">
                  {busy === node && running === "uninstall" ? <Spinner className="size-3" /> : <Icon name="trash" className="size-3.5" />}
                  Confirm uninstall
                </Button>
              ) : (
                <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setConfirming(true)} className="w-full gap-1.5 text-dim">
                  <Icon name="trash" className="size-3.5" />
                  Uninstall
                </Button>
              )
            ) : null}
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

/** Agent ids AgentLogo renders natively, so wrap rows reuse the same marks the Upstream page shows. */
const AGENT_LOGO_IDS: ReadonlySet<string> = new Set(["claude-code", "codex"]);

/** The wrap targets the house mark system has a slug (and brand accent) for. */
const WRAP_SLUGS: Record<string, string> = {
  claude: "claudecode", copilot: "githubcopilot", cline: "cline",
  codex: "openai",
  commandcode: "commandcode", dsh: "deepseek",
  vscode: "vscode", aider: "aider", vibe: "mistralai",
  grok: "grok", cursor: "cursor",
  goose: "goose", openhands: "openhands", openclaw: "openclaw",
  kimi: "kimi", zcode: "zdotai",
};

function BrandMark({ name, className }: { name: string; className: string }) {
  const slug = WRAP_SLUGS[name];
  if (slug === undefined) return <Icon name="terminal" className={className} />;
  const image = imageMark(slug);
  if (image) return <img src={image} alt="" className={cn("shrink-0 object-contain", className)} />;
  const mask = maskMark(slug);
  if (!mask) return <Icon name="terminal" className={className} />;
  // A brand color near black or white disappears on the theme, so those marks fall back to the row's ink.
  const color = MARK_BG[slug];
  const lum = color === undefined ? 0 : luminance(color);
  return <MarkGlyph slug={slug} className={className} color={color !== undefined && lum >= 60 && lum <= 225 ? color : "currentColor"} />;
}

/** The footer under a vendor drawer: check the release feed, update, or remove the binary. */
export function VendorFooter({
  tool, source, open, installed, onAfter,
}: {
  tool: "headroom" | "rtk";
  source: "Headroom" | "RTK";
  open: boolean;
  installed: boolean;
  onAfter: () => void;
}) {
  const toast = useToast();
  const [phase, setPhase] = useState<"idle" | "checking" | "update" | "confirm-uninstall" | "busy">("idle");
  const [busyLabel, setBusyLabel] = useState("");
  const [row, setRow] = useState<VendorRow | null>(null);
  const [proxy, setProxy] = useState<HeadroomProxyState | null>(null);
  const [proxyBusy, setProxyBusy] = useState<"start" | "stop" | null>(null);
  useEffect(() => {
    if (!open) { setPhase("idle"); setRow(null); setProxy(null); }
  }, [open]);
  // The footer dot follows the proxy while the drawer is open, so a link opened elsewhere shows up here.
  useEffect(() => {
    if (!open || tool !== "headroom") return;
    let cancelled = false;
    const tick = (): void => { void fetchHeadroomProxy().then((state) => { if (!cancelled) setProxy(state); }); };
    tick();
    const timer = window.setInterval(tick, 4000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [open, tool]);
  const busy = phase === "busy";
  const updateReady = phase === "update";
  const confirming = phase === "confirm-uninstall";
  const dots = <Spinner aria-hidden="true" className="size-3.5" />;
  const check = async (): Promise<void> => {
    setPhase("checking");
    const found = await checkVendor(source);
    setRow(found);
    setPhase(found?.upstream && found.pin !== found.upstream ? "update" : "idle");
    // The answer reads as a toast: the footer no longer spends a permanent line on a transient fact.
    if (found?.pin) toast(`${source} ${found.pin}`, found.upstream && found.upstream !== found.pin ? `latest ${found.upstream}` : "up to date", "check");
    else toast(`${source} is not installed`, "Install it from the footer below.", "circle-alert");
  };
  const runVendor = async (action: "update" | "uninstall"): Promise<void> => {
    setBusyLabel(action === "uninstall" ? `Uninstalling ${tool}` : installed ? `Updating ${tool}` : `Installing ${tool}`);
    setPhase("busy");
    const result = await postVendorAction(tool, action);
    if (!result?.ok) {
      toast(result?.error ?? "the dashboard server did not answer", "Nothing changed.", "circle-alert");
      setPhase("idle");
      return;
    }
    toast(result.detail, "Runs in the background.", "check");
    // The job is detached, so the bar rides a health poll: it ends when the binary state flips.
    const key = tool === "headroom" ? "headroom" : "rtk";
    const wasVersion = row?.pin ?? null;
    for (let tick = 0; tick < 30; tick += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const report = await fetchHealth();
      const state = report?.[key];
      if (!state) continue;
      if (action === "uninstall" && !state.present) break;
      if (action === "update" && state.present && state.version !== wasVersion) break;
    }
    setPhase("idle");
    setRow(null);
    onAfter();
  };
  const updateLabel = row?.upstream ? `Update to ${row.upstream}` : "Update";
  const stopProxy = async (): Promise<void> => {
    const result = await stopHeadroomProxy();
    if (result?.stopped) toast("Headroom proxy stopped", "The dashboard link starts it again.", "check");
    else if (result?.ok) toast("Proxy kept running", result.kept ?? "it was not started by Tersio", "circle-alert");
    setProxy(await fetchHeadroomProxy());
  };
  const toggleProxy = async (): Promise<void> => {
    const action = proxy?.running ? "stop" : "start";
    setProxyBusy(action);
    try {
      if (action === "stop") {
        await stopProxy();
        return;
      }
      const res = await postHeadroomProxy("start");
      if (res?.ok) toast("Headroom proxy started", res.detail ?? "", "check");
      else toast("Could not start the proxy", res?.error ?? "the dashboard server did not answer", "circle-alert");
      setProxy(await fetchHeadroomProxy());
    } finally {
      setProxyBusy(null);
    }
  };
  const openDashboard = (): void => {
    // A plain navigation tab: the route probes (and may start) Headroom's proxy, so nothing is popup-blocked.
    const tab = window.open("/headroom/dashboard", "_blank");
    if (!tab) return;
    // Cross-origin tabs still report `closed`; the server only kills a proxy it started for this link.
    const timer = window.setInterval(() => {
      if (!tab.closed) return;
      window.clearInterval(timer);
      void fetch("/headroom/dashboard/stop", { method: "POST" });
    }, 2000);
  };
  return (
    <DrawerFooter className="border-t border-line px-6 pb-4 pt-3.5">
      {phase === "busy" ? <Progress value={null} className="w-full" /> : null}
      <div className="grid w-full grid-cols-2 gap-2">
        {installed ? (
          updateReady ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void runVendor("update")} className="w-full gap-1.5 border-accent/40 text-accent">
              {busy ? busyLabel : updateLabel}
              {busy ? dots : <Icon name="circle-arrow-up" className="size-3.5" />}
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled={busy || phase === "confirm-uninstall"} onClick={() => void check()} className="w-full gap-1.5">
              {phase === "checking" ? "Checking" : row ? "Check again" : "Check for updates"}
              {phase === "checking" ? dots : <Icon name="refresh-cw" className="size-3.5" />}
            </Button>
          )
        ) : (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void runVendor("update")} className="w-full gap-1.5">
            {busy ? busyLabel : "Install"}
            {busy ? dots : <Icon name="plus" className="size-3.5" />}
          </Button>
        )}
        {confirming ? (
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => void runVendor("uninstall")} className="w-full gap-1.5">
            {busy ? busyLabel : "Confirm uninstall"}
            {busy ? dots : <Icon name="trash" className="size-3.5" />}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || !installed}
            onClick={() => { setPhase("confirm-uninstall"); setRow(null); }}
            className="w-full gap-1.5 text-dim"
          >
            <Icon name="trash" className="size-3.5" />
            Uninstall
          </Button>
        )}
      </div>
      {tool === "headroom" && installed ? (
        <div className="flex w-full items-center gap-0.5 rounded-lg border border-line bg-panel p-0.5">
          <Button size="sm" variant="ghost" disabled={busy} onClick={openDashboard} className="min-w-0 flex-1 gap-1.5">
            <Icon name="gauge" className="size-3.5" />
            <span className="truncate">Headroom dashboard</span>
          </Button>
          <span
            aria-hidden="true"
            className={cn("mr-0.5 size-1 shrink-0 rounded-full", proxy?.running ? "bg-success" : "bg-line")}
          />
          <span className="sr-only">{proxy?.running ? "headroom proxy running" : "headroom proxy not running"}</span>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || proxyBusy !== null}
            onClick={() => void toggleProxy()}
            aria-label={proxy?.running ? "Stop the headroom proxy" : "Start the headroom proxy"}
            title={proxy?.running ? "Stop the headroom proxy" : "Start the headroom proxy"}
            className="shrink-0 gap-1.5"
          >
            {proxyBusy === "start" ? "starting\u2026" : proxyBusy === "stop" ? "stopping\u2026" : proxy?.running ? "Stop proxy" : "Start proxy"}
          </Button>
        </div>
      ) : null}

    </DrawerFooter>
  );
}

function VersionPill({ version }: { version: string | null }) {
  if (!version) return null;
  return <span className="mono ml-auto shrink-0 rounded border border-success/40 px-1.5 py-0.5 text-[9px] text-success">{version}</span>;
}

/** The plain-language announcement a switch flip makes: what changed for the agent, not how headroom did it. The env-var details live in the copy card below. */
export function wrapNotice(target: { label?: string; kind?: string; durable?: boolean } | undefined, name: string, on: boolean): { title: string; desc: string } {
  const label = target?.label ?? name;
  // Only pi and pig have their provider config rewritten for them; every other proxy host needs the pasted address.
  const configRewritten = name === "pi" || name === "pig";
  if (!on) {
    if (target?.kind === "proxy") return { title: `${label} no longer routes through the shared proxy.`, desc: configRewritten ? "Its provider settings are back the way they were." : "Remove the proxy address from its settings if you set one." };
    if (target?.durable) return { title: `${label} no longer has headroom built in.`, desc: "Its integration is undone." };
    return { title: `${label} no longer starts through headroom.`, desc: "It launches the way it did before." };
  }
  if (target?.kind === "proxy") return { title: `${label} routes through the shared proxy now.`, desc: configRewritten ? "Its provider settings now point at the proxy." : "Copy an address below into its settings." };
  if (target?.durable) return { title: `${label} has headroom built in now.`, desc: "It stays on across restarts." };
  return { title: `${label} starts through headroom now.`, desc: "The shared proxy rides along." };
}

/** The headroom node opens the wrap drawer: one switch per installed tool, run by Tersio itself. */
export function HeadroomDrawer({ open, onOpenChange, modes, busy, onSet, onSaved }: Omit<NodeSurfaceProps, "node" | "hostState" | "onHostAction">) {
  const toast = useToast();
  const [wrapTargets, setWrapTargets] = useState<Array<HeadroomWrapTarget> | null>(null);
  const [proxy, setProxy] = useState<{ running: boolean; port: number } | null>(null);
  const [proxyBusy, setProxyBusy] = useState<"start" | "stop" | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // The two accordions are exclusive: opening one closes the other.
  const [expanded, setExpanded] = useState<"installed" | "absent" | null>("installed");

  /** One tool row, shared by the durable list and the proxy list. */
  const renderRow = (target: HeadroomWrapTarget) => {
    const on = wrapped[target.name] === true;
    return (
      <div
        key={target.name}
        className={cn(
          "flex items-center gap-2.5 rounded-md border px-2.5 py-1.5 transition-colors",
          target.kind === "proxy" && "border-dashed",
          on ? "border-success/30 bg-success/5" : "border-line",
        )}
      >
        {HOSTS.some((h) => h.id === target.name)
          ? <AgentLogo host={target.name as "omp"} className="size-3.5 shrink-0" />
          : AGENT_LOGO_IDS.has(target.name)
            ? <AgentLogo host={target.name as "codex"} className="size-3.5 shrink-0" />
            : <BrandMark name={target.name} className={cn("size-3.5", on ? "" : "text-dim")} />}
        <span className={cn("mono min-w-0 flex-1 truncate text-[11px]", on ? "text-ink" : "text-dim", !target.available && "line-through opacity-60")}>{target.label ?? target.name}</span>
        <span className={cn("mono shrink-0 rounded border px-1 py-0.5 text-[9px]", on ? "border-success/40 text-success" : "border-line text-dim")}>
          {!target.available
            ? "not installed"
            : on
              ? target.kind === "proxy" ? "routed" : target.durable ? "durable" : "wrapped"
              : target.kind === "proxy" ? "via proxy" : "ready"}
        </span>
        <span className="relative inline-flex">
          <Switch
            size="sm"
            checked={on}
            disabled={!target.available || wrapBusy !== null || !headroomInstalled}
            onCheckedChange={(next: boolean) => toggleWrap(target.name, next)}
            aria-label={(target.kind === "proxy" ? "Route " : "Wrap ") + target.name + " through headroom"}
          />

        </span>
      </div>
    );
  };
  const [health, setHealth] = useState<HealthReport | null>(null);
  // Which durable integrations the dashboard has installed; optimistic, kept across drawer opens.
  const [wrapped, setWrapped] = useState<Record<string, true>>(readStoredWraps);
  const [wrapBusy, setWrapBusy] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    void fetchWrapTargets().then((state) => { setWrapTargets(state?.targets ?? null); setProxy(state?.proxy ?? null); });
    void fetchHealth().then(setHealth);
    void fetchHeadroomWraps().then((server) => {
      if (!server || typeof server !== 'object') return;
      const record = server as Record<string, true>;
      if (Object.keys(record).length > 0) {
        setWrapped(record);
        storeWraps(record);
      } else if (Object.keys(wrapped).length > 0) {
        // A record from before the server copy existed moves up once.
        void postHeadroomWraps(wrapped);
      }
    });
  }, [open]);
  const headroomInstalled = health?.headroom?.present ?? false;
  const picker = PICKER.headroom;
  const current = nodeValue("headroom", "all", modes);

  /** One switch flip: headroom's own command, then the shared record and every other browser. */
  const toggleWrap = (name: string, on: boolean): void => {
    setWrapBusy(name);
    const target = wrapTargets?.find((entry) => entry.name === name);
    const notice = wrapNotice(target, name, on);
    void postHeadroomWrap(name, on ? "wrap" : "unwrap")
      .then((result) => {
        if (result?.ok) {
          const next: Record<string, true> = { ...wrapped };
          if (on) next[name] = true; else delete next[name];
          setWrapped(next);
          storeWraps(next);
          void postHeadroomWraps(next);
          toast(notice.title, notice.desc, "check");
        } else {
          // The server's own error text is the payload here; the fallback covers a silent server.
          toast("The switch did not change.", result?.error ?? "The dashboard server did not answer.", "circle-alert");
        }
      })
      .catch(() => toast("The switch did not change.", "The dashboard server did not answer.", "circle-alert"))
      .finally(() => setWrapBusy(null));
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange} swipeDirection="right">
      <DrawerContent>
        <DrawerHeader className="border-b border-line pb-3.5 px-6 pt-4">
          <DrawerTitle>
            <span className="flex items-center gap-2">
              <span aria-hidden="true" className="text-[13px] leading-none">🍃</span>
              <span className="min-w-0 truncate">headroom</span>
              <VersionPill version={health?.headroom?.version ?? null} />
            </span>
          </DrawerTitle>
          <DrawerDescription className="text-[11px] leading-relaxed">{ABOUT.headroom}</DrawerDescription>
        </DrawerHeader>
        <div className="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto px-6 py-4 pb-5">
          <div className="grid gap-1.5">
            <p className="flex items-center gap-1.5 text-[13px] font-semibold">
              <Icon name="package" className="size-3.5 text-dim" /> Wrap an installed tool
              <span className="mono ml-auto shrink-0 rounded border border-accent/40 px-1.5 py-0.5 text-[9px] text-accent">recommended</span>
            </p>
            <p className="m-0 text-[10px] leading-relaxed text-dim">
              Two ways to route a tool: headroom's own durable integration where it exists, and one shared proxy for
              everything else. Every switch below runs the real command — nothing to copy by hand except the proxy addresses.
            </p>
            {wrapTargets === null ? (
              <Skeleton className="h-8 w-full rounded-md" />
            ) : (() => {
              const installed = wrapTargets.filter((target) => target.available);
              const absent = wrapTargets.filter((target) => !target.available);
              return (
                <div className="grid gap-2">
                  <details className="group rounded-xl border border-line" open={expanded === "installed"} onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) setExpanded("installed"); }}>
                    <summary className="mono flex cursor-pointer list-none items-center gap-2 pl-2.5 pr-5 py-2 text-[11px] font-semibold text-ink transition-colors hover:text-accent">
                      <Icon name="chevron-right" className="size-3 shrink-0 transition-transform group-open:rotate-90" />
                      Installed on this machine
                      <span className="mono ml-auto shrink-0 rounded border border-success/40 px-1.5 py-0.5 text-[9px] text-success">{installed.length}</span>
                    </summary>
                    <div className="grid gap-1 px-2.5 pb-2">
                      {installed.map((target) => renderRow(target))}
                    </div>
                  </details>
                  <details className="group rounded-xl border border-dashed border-line" open={expanded === "absent"} onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) setExpanded("absent"); }}>
                    <summary className="mono flex cursor-pointer list-none items-center gap-2 pl-2.5 pr-5 py-2 text-[11px] font-semibold text-dim transition-colors hover:text-ink">
                      <Icon name="chevron-right" className="size-3 shrink-0 transition-transform group-open:rotate-90" />
                      Not installed
                      <span className="mono ml-auto shrink-0 rounded border border-line px-1.5 py-0.5 text-[9px] text-dim">{absent.length}</span>
                    </summary>
                    <div className="grid gap-1 px-2.5 pb-2">
                      {absent.map((target) => renderRow(target))}
                    </div>
                  </details>
                  <div className="rounded-xl border border-line bg-track/20 p-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
                      <p className="mono m-0 flex items-center gap-1.5 text-[10px] text-dim">
                        <span aria-hidden="true" className={cn("size-1.5 rounded-full", proxy?.running ? "bg-success" : "bg-line")} />
                        shared proxy: {proxy?.running ? `running on port ${proxy.port}` : "not running"}
                      </p>
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={proxyBusy !== null || !headroomInstalled}
                        onClick={() => {
                          const action = proxy?.running ? "stop" : "start";
                          setProxyBusy(action);
                          void postHeadroomProxy(action)
                            .then(async (res) => {
                              if (res?.ok) toast(res.detail ?? (action === "start" ? "the shared proxy is live" : "the shared proxy is stopped"), "shared proxy", "check");
                              else toast(res?.error ?? "the dashboard server did not answer", "shared proxy", "circle-alert");
                              const state = await fetchWrapTargets();
                              setWrapTargets(state?.targets ?? null);
                              setProxy(state?.proxy ?? null);
                            })
                            .finally(() => setProxyBusy(null));
                        }}
                      >
                        {proxyBusy ? (proxyBusy === "start" ? "starting\u2026" : "stopping\u2026") : proxy?.running ? "Stop proxy" : "Start proxy"}
                      </Button>
                    </div>
                    <div className="mt-2 grid gap-1.5">
                      {COPY_URLS.map((entry) => (
                        <button
                          key={entry.label}
                          type="button"
                          onClick={() => {
                            void navigator.clipboard.writeText(entry.value).then(() => {
                              setCopied(entry.label);
                              setTimeout(() => setCopied((held) => (held === entry.label ? null : held)), 1500);
                            });
                          }}
                          className="mono flex min-w-0 items-center gap-1.5 rounded-md border border-line bg-panel px-2 py-1 text-left text-[10px] text-dim transition-colors hover:border-accent/40 hover:text-ink"
                          title={"Copy " + entry.value}
                          aria-label={"Copy " + entry.label}
                        >
                          <Icon name={copied === entry.label ? "check" : "copy"} className={cn("size-3 shrink-0", copied === entry.label ? "text-success" : "")} />
                          <span className="truncate">{entry.value}</span>
                          <span className="ml-auto shrink-0 text-[9px] text-dim">{copied === entry.label ? "copied" : entry.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}

            <p className="m-0 text-[13px] font-semibold">Session default</p>
            {health === null ? (
              <Skeleton className="h-8 w-full rounded-md" />
            ) : !headroomInstalled ? (
              <NotInstalledNote tool="headroom" />
            ) : modes === null ? (
              <Skeleton className="h-8 w-full rounded-md" />
            ) : (
              <ToggleRow
                title="Compress traffic for new sessions"
                hint="Tool outputs and history compress below the shell; Tersio tracks the savings."
                checked={current === "on"}
                disabled={busy !== null}
                onCheckedChange={(on: boolean) => { onSet("headroom", picker.field, on ? "on" : "off"); onSaved(); }}
              />
            )}
          </div>
        </div>
        <VendorFooter tool="headroom" source="Headroom" open={open} installed={headroomInstalled} onAfter={() => void fetchHealth().then(setHealth)} />
      </DrawerContent>
    </Drawer>
  );
}

/** The rtk node opens its own drawer: the on/off default plus the vendor release footer. */
export function RtkDrawer({ open, onOpenChange, modes, busy, onSet, onSaved }: Omit<NodeSurfaceProps, "node" | "hostState" | "onHostAction">) {
  const [health, setHealth] = useState<HealthReport | null>(null);
  useEffect(() => {
    if (!open) return;
    void fetchHealth().then(setHealth);
  }, [open]);
  const rtkInstalled = health?.rtk?.present ?? false;
  const picker = PICKER.rtk;
  const current = nodeValue("rtk", "all", modes);
  return (
    <Drawer open={open} onOpenChange={onOpenChange} swipeDirection="right">
      <DrawerContent>
        <DrawerHeader className="border-b border-line pb-3.5 px-6 pt-4">
          <DrawerTitle>
            <span className="flex items-center gap-2">
              <span aria-hidden="true" className="text-[13px] leading-none">🗜️</span>
              <span className="min-w-0 truncate">rtk</span>
              <VersionPill version={health?.rtk?.version ?? null} />
            </span>
          </DrawerTitle>
          <DrawerDescription className="text-[11px] leading-relaxed">{ABOUT.rtk ?? ""}</DrawerDescription>
        </DrawerHeader>
        <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-6 py-4 pb-5">
          {health === null ? (
            <Skeleton className="h-8 w-full rounded-md" />
          ) : !rtkInstalled ? (
            <NotInstalledNote tool="rtk" />
          ) : (
            <div className="grid gap-1.5">
              <p className="m-0 text-[13px] font-semibold">Session default</p>
              {modes === null ? (
                <Skeleton className="h-8 w-full rounded-md" />
              ) : (
                <ToggleRow
                  title="Rewrite Bash calls through rtk"
                  hint="Eligible shell calls are rewritten and their output condensed before the model sees it."
                  checked={current === "on"}
                  disabled={busy !== null}
                  onCheckedChange={(on: boolean) => { onSet("rtk", picker.field, on); onSaved(); }}
                />
              )}
            </div>
          )}
        </div>
        <VendorFooter tool="rtk" source="RTK" open={open} installed={rtkInstalled} onAfter={() => void fetchHealth().then(setHealth)} />
      </DrawerContent>
    </Drawer>
  );
}

/** The add-agent picker: only the harnesses found on this machine, plus the coming-soon teasers. */
export function AddAgentDialog({
  open, onOpenChange, hostState, busy, onInstall,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hostState: HostState;
  busy: NodeId | null;
  onInstall: (host: HostId) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="user-plus" className="size-4 text-dim" />
            Add an agent
          </DialogTitle>
          <DialogDescription className="text-[11px] leading-relaxed">
            The agent harnesses on this machine. Claude Code and Codex are coming soon.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          {HOSTS.map((host) => {
            const present = hostState.present[host.id] !== false;
            // Tersio's tree is what makes a host usable here, so a detected harness without it offers Install.
            const linked = hostState.installed[host.id] === true;
            const installing = busy === `host-${host.id}`;
            return (
              <div
                key={host.id}
                aria-disabled={!present}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-2.5 py-2",
                  present ? "border-line" : "border-dashed border-line opacity-55",
                )}
              >
                <AgentLogo host={host.id as "omp"} className={cn("size-4 shrink-0", !present && "grayscale")} />
                <span className="min-w-0 flex-1 truncate text-[12px]">{host.label}</span>
                {present && !linked ? (
                  <span className="mono shrink-0 text-[9px] text-dim">{versionOf(hostState.versions[host.id]) ?? ""}</span>
                ) : null}
                {linked ? (
                  <span className="mono flex shrink-0 items-center gap-1 rounded border border-success/40 px-1.5 py-0.5 text-[9px] text-success">
                    <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
                    {versionOf(hostState.versions[host.id]) ?? "installed"}
                  </span>
                ) : present ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => onInstall(host.id)}
                    className="h-6 shrink-0 gap-1 px-1.5 text-[10px]"
                  >
                    {installing ? <Spinner className="size-3" /> : <Icon name="plus" className="size-3" />}
                    Add Agent
                  </Button>
                ) : (
                  <span className="mono flex shrink-0 items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[9px] text-dim">
                    <span aria-hidden="true" className="size-1.5 rounded-full bg-dim" />
                    not installed
                  </span>
                )}
              </div>
            );
          })}
          {UPCOMING_AGENTS.map((agent) => (
            <div
              key={agent.id}
              aria-disabled="true"
              className="flex items-center gap-2 rounded-lg border border-dashed border-line px-2.5 py-2 opacity-55"
            >
              <AgentLogo host={agent.id} className="size-4 shrink-0 grayscale" />
              <span className="min-w-0 flex-1 truncate text-[12px]">{agent.name}</span>
              <span className="mono shrink-0 rounded border border-line px-1.5 py-0.5 text-[9px] text-dim">coming soon</span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}