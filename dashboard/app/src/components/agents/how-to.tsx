// Quick start: the pipeline as one canvas, drawn the way a workflow tool lays it out.
// Everything here mirrors docs/ARCHITECTURE.md: the hosts, the block order, and the turn it produces.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Card, Page, PageHeader } from "@/components/charts";
import { AgentLogo } from "@/components/agent-logos";
import { Icon } from "@/components/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { usePending } from "@/hooks/use-pending";
import { fetchHealth } from "@/lib/data";
import type { ModeState } from "./shell";
import { useToast } from "../toaster";
import { cn } from "cn";

type Point = readonly [number, number];
type EdgeKey = "hosts" | "omp" | "pi" | "opencode" | "codex" | "combo" | "caveman" | "pstack" | "rtk" | "ponytail";

type HostAction = "install" | "uninstall" | "update";

/** `null` means this page has no answer yet: an exported file reads no settings, so it draws every node as lit. */
type Lit = boolean | null;

const isOff = (value: Lit): boolean => value === false;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Link {
  p: ReadonlyArray<Point>;
  k?: EdgeKey;
  arrow?: boolean;
}

type NodeId =
  | "hosts"
  | "host-omp"
  | "host-pi"
  | "host-opencode"
  | "host-codex"
  | "combo"
  | "caveman"
  | "pstack"
  | "rtk"
  | "ponytail"
  | "output"
  | "add-host";

interface Caption {
  x: number;
  y: number;
  text: string;
  anchor?: "start" | "end";
}

interface Layout {
  w: number;
  h: number;
  nodes: ReadonlyArray<readonly [NodeId, Box]>;
  links: readonly Link[];
  captions: readonly Caption[];
}

/**
 * Three design spaces, one per class of screen. Each is drawn at its own coordinates and then scaled to
 * the card width, so the diagram is the same diagram at every size and never clips a node.
 */
type LayoutKey = "wide" | "medium" | "narrow";

/** The wide canvas scales from this width; its height is fixed at 400. */
const WIDE_W = 1040;

const LAYOUTS: Record<Exclude<LayoutKey, "wide">, Layout> = {
  medium: {
    w: 780,
    h: 360,
    nodes: [
      ["hosts", { x: 16, y: 16, w: 212, h: 72 }],
      ["combo", { x: 16, y: 104, w: 212, h: 56 }],
      ["add-host", { x: 16, y: 176, w: 212, h: 44 }],
      ["caveman", { x: 252, y: 16, w: 230, h: 64 }],
      ["pstack", { x: 252, y: 96, w: 230, h: 64 }],
      ["rtk", { x: 252, y: 176, w: 230, h: 64 }],
      ["ponytail", { x: 252, y: 256, w: 230, h: 64 }],
      ["output", { x: 520, y: 136, w: 240, h: 64 }],
    ],
    links: [
      { p: [[228, 52], [240, 52]], k: "hosts" },
      { p: [[228, 132], [240, 132], [240, 52]], k: "combo" },
      { p: [[240, 52], [252, 52]], k: "caveman", arrow: true },
      { p: [[367, 80], [367, 96]], k: "pstack", arrow: true },
      { p: [[367, 160], [367, 176]], k: "rtk", arrow: true },
      { p: [[367, 240], [367, 256]], k: "ponytail", arrow: true },
      { p: [[482, 288], [500, 288], [500, 168], [520, 168]], k: "ponytail", arrow: true },
    ],
    captions: [{ x: 252, y: 344, text: "appended in this order, one block each" }],
  },
  narrow: {
    w: 440,
    h: 640,
    nodes: [
      ["hosts", { x: 20, y: 48, w: 190, h: 88 }],
      ["add-host", { x: 20, y: 144, w: 190, h: 44 }],
      ["combo", { x: 230, y: 64, w: 190, h: 56 }],
      ["caveman", { x: 20, y: 204, w: 400, h: 64 }],
      ["pstack", { x: 20, y: 276, w: 400, h: 64 }],
      ["rtk", { x: 20, y: 348, w: 400, h: 64 }],
      ["ponytail", { x: 20, y: 420, w: 400, h: 64 }],
      ["output", { x: 20, y: 512, w: 400, h: 64 }],
    ],
    links: [
      { p: [[210, 92], [220, 92], [220, 204]], k: "hosts", arrow: true },
      { p: [[325, 120], [325, 204]], k: "combo", arrow: true },
      { p: [[220, 268], [220, 276]], k: "pstack", arrow: true },
      { p: [[220, 340], [220, 348]], k: "rtk", arrow: true },
      { p: [[220, 412], [220, 420]], k: "ponytail", arrow: true },
      { p: [[220, 484], [220, 512]], k: "ponytail", arrow: true },
    ],
    captions: [{ x: 20, y: 620, text: "appended in this order, one block each" }],
  },
};

/**
 * The wide canvas, drawn around the agents this machine actually has. An agent that is not installed
 * leaves the column, and the preset and the bus re-centre on what remains.
 */
function wideLayout(hosts: ReadonlyArray<{ id: string }>): Layout {
  const top = 48;
  const step = 68; // 56 tall, 12 apart
  const bottom = hosts.length ? top + (hosts.length - 1) * step + 56 : 0;
  const addY = hosts.length ? bottom + 12 : top;
  const center = hosts.length ? (top + bottom) / 2 : addY + 22;
  const nodes: Array<readonly [NodeId, Box]> = hosts.map((host, i) => [
    `host-${host.id}` as NodeId,
    { x: 20, y: top + i * step, w: 190, h: 56 },
  ]);
  nodes.push(
    ["add-host", { x: 20, y: addY, w: 190, h: 44 }],
    ["combo", { x: 246, y: center - 29, w: 200, h: 58 }],
    ["caveman", { x: 486, y: 24, w: 230, h: 62 }],
    ["pstack", { x: 486, y: 102, w: 230, h: 62 }],
    ["rtk", { x: 486, y: 180, w: 230, h: 62 }],
    ["ponytail", { x: 486, y: 258, w: 230, h: 62 }],
    ["output", { x: 752, y: 140, w: 240, h: 64 }],
  );
  const links: Link[] = hosts.map((host, i) => ({
    p: [[210, top + i * step + 28], [230, top + i * step + 28]],
    k: host.id as EdgeKey,
  }));
  if (hosts.length > 1) links.push({ p: [[230, top + 28], [230, bottom - 28]] });
  links.push(
    // One bus collects the agents and the preset, then enters the block column once.
    { p: [[230, center], [466, center]] },
    { p: [[346, center - 29], [346, center]], k: "combo" },
    { p: [[466, center], [466, 55], [486, 55]], k: "caveman", arrow: true },
    { p: [[601, 86], [601, 102]], k: "pstack", arrow: true },
    { p: [[601, 164], [601, 180]], k: "rtk", arrow: true },
    { p: [[601, 242], [601, 258]], k: "ponytail", arrow: true },
    { p: [[716, 289], [734, 289], [734, 172], [752, 172]], k: "ponytail", arrow: true },
  );
  return {
    w: WIDE_W,
    h: 400,
    nodes,
    links,
    captions: [{ x: 486, y: 344, text: "appended in this order, one block each" }],
  };
}

/** An orthogonal route through these points, with every corner rounded by `radius`. */
function ortho(points: ReadonlyArray<Point>, radius = 8): string {
  const [first, ...rest] = points;
  let d = `M${first[0]} ${first[1]}`;
  for (let i = 0; i < rest.length; i += 1) {
    const [x, y] = rest[i];
    if (i === rest.length - 1) {
      d += ` L${x} ${y}`;
      break;
    }
    const [px, py] = points[i];
    const [nx, ny] = rest[i + 1];
    const inX = Math.sign(x - px);
    const inY = Math.sign(y - py);
    const outX = Math.sign(nx - x);
    const outY = Math.sign(ny - y);
    // A straight run has no corner to round.
    if ((inX !== 0 && outX !== 0) || (inY !== 0 && outY !== 0)) {
      d += ` L${x} ${y}`;
      continue;
    }
    d += ` L${x - inX * radius} ${y - inY * radius}`;
    d += ` Q${x} ${y} ${x + outX * radius} ${y + outY * radius}`;
  }
  return d;
}

/** `/health` reports `omp/18.12.6` and `opencode/opencode v2.1.3`, so the node keeps only the version. */
function versionOf(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const tail = raw.split("/").pop() ?? raw;
  const version = tail.replace(/^(omp|pi|opencode|codex)\s+/i, "").trim();
  return version || null;
}

/** The four hosts, in the order the installer lists them. */
const HOSTS = [
  { id: "omp", label: "Oh My Pi" },
  { id: "pi", label: "pi" },
  { id: "opencode", label: "OpenCode" },
  { id: "codex", label: "Codex" },
] as const;

const MODES = [
  { key: "caveman", glyph: "🪨", name: "caveman", role: "voice", note: "terse replies, filler gone" },
  { key: "pstack", glyph: "🥔", name: "pstack", role: "approach", note: "playbook, checks, design" },
  { key: "rtk", glyph: "🗜️", name: "rtk", role: "tooling", note: "rewrites and condenses shell" },
  { key: "ponytail", glyph: "🧠", name: "ponytail", role: "size", note: "smallest complete change" },
] as const;

const TURN = [
  { id: "output", icon: "arrow-right", title: "Output", note: "the turn's result" },
] as const;

/** The nodes a click can set, the field each writes, and the levels that field takes. */
const PICKER: Partial<Record<NodeId, { field: string; options: ReadonlyArray<{ id: string; label: string }> }>> = {
  combo: {
    field: "comboDefault",
    options: [
      { id: "off", label: "Off" }, { id: "lite", label: "Lite" },
      { id: "balanced", label: "Balanced" }, { id: "max", label: "Max" },
    ],
  },
  caveman: {
    field: "cavemanDefault",
    options: [
      { id: "off", label: "Off" }, { id: "lite", label: "Lite" }, { id: "full", label: "Full" },
      { id: "ultra", label: "Ultra" }, { id: "megacave-lite", label: "Megacave lite" },
      { id: "megacave-full", label: "Megacave full" }, { id: "megacave-ultra", label: "Megacave ultra" },
    ],
  },
  rtk: { field: "rtkDefault", options: [{ id: "off", label: "Off" }, { id: "on", label: "On" }] },
  ponytail: {
    field: "ponytailDefault",
    options: [
      { id: "off", label: "Off" }, { id: "lite", label: "Lite" },
      { id: "full", label: "Full" }, { id: "ultra", label: "Ultra" },
    ],
  },
  pstack: { field: "pstackDefault", options: [{ id: "off", label: "Off" }, { id: "on", label: "On" }] },
};

/** What the detail panel says about a node. */
const ABOUT: Record<NodeId, string> = {
  hosts: "Every agent reads the same modes. OMP, pi, and OpenCode load one extension tree; Codex loads a plugin with one prompt hook.",
  "host-omp": "Oh My Pi loads the extensions from its plugin package.",
  "host-pi": "pi auto-discovers the same tree from its extensions directory.",
  "host-opencode": "OpenCode loads the tree as one plugin, registered in opencode.json.",
  "host-codex": "Codex loads Tersio as a plugin; its prompt hook keeps the modes active.",
  combo: "One preset for caveman, RTK, and Ponytail. pstack keeps its own switch.",
  caveman: "Voice. Terse replies; code, commands, paths, and errors stay exact.",
  pstack: "Approach. Picks the playbook, the checks, and the design.",
  rtk: "Tooling. Rewrites a shell command and condenses its output before the model sees it.",
  ponytail: "Size. Caps the diff at the smallest complete change.",
  output: "One turn, start to finish: the prompt blocks go in, the model runs, and the reply comes back.",
  "add-host": "Tersio installs one extension tree per agent. Pick an agent to add it.",
};

const STEPS = [
  {
    title: "Install into an agent",
    body: "One package installs into the agent you pick. The extension hosts share one tree; Codex gets a plugin with the same modes.",
    command: "tersio install --host omp|pi|opencode|codex",
  },
  {
    title: "Pick a preset",
    body: "Combo sets caveman, RTK, and Ponytail together. It leaves pstack where you had it, because pstack is opt-in.",
    command: "/combo balanced · Codex: $tersio-combo",
  },
  {
    title: "Turn a mode on its own",
    body: "Each mode answers to its own command, and a switch reaches every sibling through the shared bridge without a reload.",
    command: "/pstack on · Codex: $tersio-pstack",
  },
  {
    title: "Check what ran",
    body: "This dashboard reads the one store every host feeds. Doctor checks the install, and upstream compares the ported bodies to their pins.",
    command: "tersio doctor",
  },
  {
    title: "Codex: trust the hooks",
    body: "Codex does not run an untrusted hook. Open /hooks in Codex, review the two Tersio entries, and trust them, or the mode block and the RTK rewrite stay off.",
    command: "codex → /hooks → trust Tersio",
  },
] as const;

/** Each host's own install path, so the guide never sends a Codex user to the extension tree. */
const INSTALL_METHODS = [
  {
    host: "omp",
    label: "Oh My Pi",
    commands: ["omp plugin install @krtclcdy/tersio"],
    note: "Loads the shared extension tree from the plugin package.",
  },
  {
    host: "pi",
    label: "pi",
    commands: ["pi install npm:@krtclcdy/tersio"],
    note: "Auto-discovers the same tree from its extensions directory.",
  },
  {
    host: "opencode",
    label: "OpenCode",
    commands: ["opencode plugin add @krtclcdy/tersio"],
    note: "Registers the tree in opencode.json.",
  },
  {
    host: "codex",
    label: "Codex",
    commands: ["codex plugin marketplace add KurutoDenzeru/tersio", "codex plugin add tersio@tersio"],
    note: "Then trust the Tersio entries in /hooks. tersio install --host codex runs both steps and falls back to a local plugin.",
  },
] as const;

interface HostState {
  installed: Record<string, boolean>;
  versions: Record<string, string | null>;
}

function NodeButton({
  box,
  off,
  selected,
  accent,
  dashed,
  label,
  onSelect,
  onHover,
  children,
}: {
  box: Box;
  off?: boolean;
  selected: boolean;
  accent?: boolean;
  dashed?: boolean;
  label: string;
  onSelect: () => void;
  onHover: (on: boolean) => void;
  children: React.ReactNode;
}) {
  // A mode switch or a finished install changes the label; that change gets one soft ring.
  const [pulse, setPulse] = useState<string | null>(null);
  const previous = useRef(label);
  useEffect(() => {
    if (previous.current === label) return;
    previous.current = label;
    setPulse(label);
    const timer = window.setTimeout(() => setPulse(null), 600);
    return () => window.clearTimeout(timer);
  }, [label]);

  return (
    <button
      type="button"
      aria-label={label}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      className={cn(
        "howto-node absolute flex cursor-pointer flex-col justify-center gap-0.5 overflow-hidden rounded-xl border border-line bg-panel px-3 py-2 text-left outline-none",
        "hover:border-accent/50 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40",
        dashed && "items-center border-2 border-dashed bg-panel text-dim hover:border-accent/50 hover:text-ink",
        off && "border-2 border-dashed opacity-55",
        accent && "border-accent/40",
        selected && "border-accent ring-2 ring-accent/30",
      )}
    >
      {pulse ? <span key={pulse} aria-hidden="true" className="howto-pulse pointer-events-none absolute inset-0 rounded-xl ring-2 ring-accent/50" /> : null}
      {children}
    </button>
  );
}

/** One small action in the node menu: a level, a host command, or an install. */
function MenuAction({ onClick, disabled, danger, children }: {
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "mono cursor-pointer rounded-md border px-1.5 py-1 text-[10px] transition-colors disabled:cursor-default disabled:opacity-40",
        danger
          ? "border-destructive/50 text-destructive hover:bg-destructive/10"
          : "border-line text-dim hover:border-accent/50 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function PipelineCanvas({
  modes,
  hostState,
  onSet,
  onHostAction,
  busy,
}: {
  modes: ModeState | null;
  hostState: HostState;
  onSet: (node: NodeId, field: string, value: string | boolean) => void;
  onHostAction: (node: NodeId, action: HostAction) => void;
  busy: NodeId | null;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<{ key: LayoutKey; fit: number }>({ key: "wide", fit: 1 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [selected, setSelected] = useState<NodeId | null>(null);
  const [confirming, setConfirming] = useState<NodeId | null>(null);
  const [panning, setPanning] = useState(false);
  const [hovered, setHovered] = useState<NodeId | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const lastKey = useRef<LayoutKey>("wide");

  // Pick the design space that suits the width, then stretch it to fill. A layout change is a new
  // canvas, so the pan and zoom start over with it.
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = (): void => {
      const width = el.clientWidth;
      if (width <= 0) return;
      const key: LayoutKey = width < 560 ? "narrow" : width < 900 ? "medium" : "wide";
      if (key !== lastKey.current) {
        lastKey.current = key;
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }
      setView({ key, fit: width / (key === "wide" ? WIDE_W : LAYOUTS[key].w) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const lit = (key: EdgeKey): Lit => {
    if (key === "hosts") {
      const installed = Object.values(hostState.installed);
      return installed.length ? installed.some(Boolean) : null;
    }
    if (key === "omp" || key === "pi" || key === "opencode") {
      const installed = hostState.installed[key];
      return installed === undefined ? null : installed;
    }
    if (!modes) return null;
    if (key === "combo") return (modes.comboLevel || modes.comboDefault) !== "off";
    if (key === "rtk") return modes.rtkDefault;
    if (key === "caveman") return modes.cavemanDefault !== "off";
    if (key === "ponytail") return modes.ponytailDefault !== "off";
    return modes.pstackDefault !== "off";
  };
  // An unknown host stays on the canvas: an exported file reads no host list.
  const shownHosts = HOSTS.filter((host) => hostState.installed[host.id] !== false);
  const missingHosts = HOSTS.filter((host) => isOff(lit(host.id)));
  const layoutKey = view.key;
  const base = layoutKey === "wide" ? wideLayout(shownHosts) : LAYOUTS[layoutKey];
  // Nothing left to install, so the dashed slot goes with it.
  const layout: Layout = missingHosts.length === 0
    ? { ...base, nodes: base.nodes.filter(([id]) => id !== "add-host") }
    : base;
  const scale = view.fit * zoom;

  const isNodeOff = (id: NodeId): boolean => {
    if (id === "hosts") return hostState.installed && !Object.values(hostState.installed).some(Boolean);
    if (id.startsWith("host-")) return isOff(lit(id.slice(5) as EdgeKey));
    if (id === "combo" || id === "caveman" || id === "pstack" || id === "rtk" || id === "ponytail") return isOff(lit(id));
    return false;
  };

  /** The boxes a point sits on, so a link can name the nodes it joins without a second table. */
  const nodeAt = (p: Point): NodeId | null => {
    for (const [id, b] of layout.nodes) {
      if (p[0] >= b.x - 1 && p[0] <= b.x + b.w + 1 && p[1] >= b.y - 1 && p[1] <= b.y + b.h + 1) return id;
    }
    return null;
  };
  const touches = (points: ReadonlyArray<Point>, id: NodeId): boolean =>
    nodeAt(points[0]) === id || nodeAt(points[points.length - 1]) === id;

  const focus = hovered ?? selected;
  const zoomed = zoom !== 1 || pan.x !== 0 || pan.y !== 0;

  const body = (id: NodeId): React.ReactNode => {
    if (id === "hosts") {
      return (
        <>
          {shownHosts.length === 0 ? <span className="mono text-[10px] text-dim">no agent yet</span> : null}
          {shownHosts.map((host) => {
            const off = isOff(lit(host.id));
            return (
              <span key={host.id} className={cn("flex min-w-0 items-center gap-1.5", off && "opacity-45")}>
                <AgentLogo host={host.id} className="size-3 shrink-0" />
                <span className="min-w-0 truncate text-[11px] font-semibold">{host.label}</span>
                <span className="mono ml-auto shrink-0 text-[9px] text-dim">
                  {off ? "not installed" : versionOf(hostState.versions[host.id]) ?? "installed"}
                </span>
              </span>
            );
          })}
        </>
      );
    }
    if (id.startsWith("host-")) {
      const host = HOSTS.find((h) => `host-${h.id}` === id);
      if (!host) return null;
      const off = isOff(lit(host.id));
      return (
        <>
          <span className="flex items-center gap-2">
            <AgentLogo host={host.id} className="size-4 shrink-0" />
            <span className="truncate text-[13px] font-semibold">{host.label}</span>
          </span>
          <span className="mono text-[10px] text-dim">
            {off ? "not installed" : versionOf(hostState.versions[host.id]) ?? "installed"}
          </span>
        </>
      );
    }
    if (id === "combo") {
      const off = isOff(lit("combo"));
      return (
        <>
          <span className="flex items-center gap-1.5 text-[13px] font-semibold">
            <span aria-hidden="true">🧩</span> Combo preset
          </span>
          <span className="mono text-[10px] text-dim">{off ? "off" : "caveman · RTK · Ponytail"}</span>
        </>
      );
    }
    const mode = MODES.find((m) => m.key === id);
    if (mode) {
      const off = isOff(lit(mode.key));
      return (
        <>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="text-[12px]">
              {mode.glyph}
            </span>
            <span className="text-[13px] font-semibold">{mode.name}</span>
            <span
              className={cn(
                "mono ml-auto rounded border px-1 text-[9px]",
                off ? "border-line text-dim" : "border-accent/40 text-accent",
              )}
            >
              {off ? "off" : mode.role}
            </span>
          </span>
          <span className="mono truncate text-[10px] text-dim">{mode.note}</span>
        </>
      );
    }
    if (id === "add-host") {
      return (
        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-dim">
          <Icon name="plus" className="size-3.5 shrink-0" /> Add agent
        </span>
      );
    }
    return (
      <>
        <span className="flex items-center gap-1.5 text-[13px] font-semibold">
          <Icon name="arrow-right" className="size-3.5 shrink-0 text-dim" /> Output
        </span>
        <span className="mono truncate text-[10px] text-dim">the turn's result</span>
      </>
    );
  };

  const titleOf = (id: NodeId): string => {
    if (id === "hosts") return "Agents";
    if (id.startsWith("host-")) return HOSTS.find((h) => `host-${h.id}` === id)?.label ?? id;
    if (id === "combo") return "Combo preset";
    if (id === "add-host") return "Add agent";
    const mode = MODES.find((m) => m.key === id);
    if (mode) return mode.name;
    return TURN.find((t) => t.id === id)?.title ?? id;
  };

  const stateOf = (id: NodeId): { label: string; on: boolean | null } => {
    if (id.startsWith("host-")) {
      const key = id.slice(5);
      const on = lit(key as EdgeKey);
      return { label: isOff(on) ? "not installed" : versionOf(hostState.versions[key]) ?? "installed", on };
    }
    if (id === "hosts") {
      const count = Object.values(hostState.installed).filter(Boolean).length;
      return { label: `${count} of ${HOSTS.length} installed`, on: count > 0 };
    }
    if (id === "combo") {
      const on = lit("combo");
      return { label: isOff(on) ? "off" : modes?.comboLevel || modes?.comboDefault || "on", on };
    }
    if (id === "caveman" || id === "ponytail") {
      const on = lit(id);
      const level = id === "caveman" ? modes?.cavemanDefault : modes?.ponytailDefault;
      return { label: isOff(on) ? "off" : level || "on", on };
    }
    if (id === "pstack") {
      const on = lit("pstack");
      return { label: isOff(on) ? "off" : "on", on };
    }
    if (id === "rtk") {
      const on = lit("rtk");
      return { label: isOff(on) ? "off" : "on", on };
    }
    if (id === "add-host") return { label: "", on: null };
    return { label: "on", on: true };
  };

  const selectedState = selected ? stateOf(selected) : null;
  const MENU_W = 264;
  const MENU_H = 200;
  const viewportW = layout.w * view.fit;
  const viewportH = layout.h * view.fit;
  const selectedBox = selected ? layout.nodes.find(([id]) => id === selected)?.[1] ?? null : null;
  const hostId = selected?.startsWith("host-") ? selected.slice("host-".length) : null;
  const hostInstalled = hostId !== null && !isOff(lit(hostId as EdgeKey));
  // The menu hangs off the node in screen space, so it keeps its type size at any zoom.
  const menu = selectedBox
    ? {
      left: Math.min(Math.max(8, selectedBox.x * scale + pan.x), Math.max(8, viewportW - MENU_W - 8)),
      top: (selectedBox.y + selectedBox.h) * scale + pan.y + MENU_H <= viewportH
        ? (selectedBox.y + selectedBox.h) * scale + pan.y + 8
        : Math.max(8, selectedBox.y * scale + pan.y - MENU_H - 8),
    }
    : null;
  const picker = selected ? PICKER[selected] : undefined;
  const currentValue = (id: NodeId): string | null => {
    if (!modes) return null;
    if (id === "combo") return modes.comboLevel || modes.comboDefault;
    if (id === "caveman") return modes.cavemanDefault;
    if (id === "ponytail") return modes.ponytailDefault;
    if (id === "pstack") return modes.pstackDefault;
    if (id === "rtk") return modes.rtkDefault ? "on" : "off";
    return null;
  };
  const current = selected ? currentValue(selected) : null;
  // `custom` is what the three modes say, so it matches no preset button and names no command.
  const picked = picker && current !== null && picker.options.some((option) => option.id === current) ? current : null;

  useEffect(() => {
    if (!selected) return;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selected]);

  const zoomBy = (factor: number): void => {
    setZoom((z) => Math.min(2.4, Math.max(0.6, Number((z * factor).toFixed(2)))));
  };

  return (
    <div className="relative">
      <div
        ref={boxRef}
        role="group"
        aria-label="Pipeline canvas"
        className={cn(
          // A drag pans the canvas; it never selects a label or a file path on the way.
          "relative touch-none overflow-hidden rounded-lg border border-line select-none",
          "[background-image:radial-gradient(circle_at_1px_1px,var(--line)_1px,transparent_0)] [background-size:16px_16px]",
        )}
        style={{ height: layout.h * view.fit, cursor: panning ? "grabbing" : "grab" }}
        onPointerDown={(event) => {
          const target = event.target as HTMLElement;
          if (target.closest("button")) return;
          setSelected(null);
          if (event.pointerType !== "mouse") return;
          drag.current = { x: event.clientX, y: event.clientY, px: pan.x, py: pan.y };
          setPanning(true);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start) return;
          setPan({ x: start.px + (event.clientX - start.x), y: start.py + (event.clientY - start.y) });
        }}
        onPointerUp={() => { drag.current = null; setPanning(false); }}
        onPointerCancel={() => { drag.current = null; setPanning(false); }}
        onWheel={(event) => {
          // A bare wheel belongs to the page; the canvas only takes it with the zoom modifier.
          if (!event.ctrlKey && !event.metaKey) return;
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          const px = event.clientX - rect.left;
          const py = event.clientY - rect.top;
          const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
          const next = Math.min(2.4, Math.max(0.6, zoom * factor));
          const ratio = next / zoom;
          setPan((p) => ({ x: px - (px - p.x) * ratio, y: py - (py - p.y) * ratio }));
          setZoom(next);
        }}
        onPointerLeave={() => { drag.current = null; setPanning(false); }}
        onDragStart={(event) => event.preventDefault()}
      >
        <div
          className="absolute origin-top-left"
          style={{ width: layout.w, height: layout.h, transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}
        >
          <svg
            className="pointer-events-none absolute inset-0"
            width={layout.w}
            height={layout.h}
            viewBox={`0 0 ${layout.w} ${layout.h}`}
            aria-hidden="true"
          >
            <defs>
              <marker
                id="howto-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="8"
                markerHeight="8"
                markerUnits="userSpaceOnUse"
                orient="auto-start-reverse"
              >
                <path d="M0 0 L10 5 L0 10 z" fill="var(--dim)" />
              </marker>
            </defs>
            <g fill="none" strokeLinejoin="round" strokeLinecap="round">
              {layout.links.map((link) => {
                const off = link.k ? isOff(lit(link.k)) : false;
                // A focused node keeps its own routes readable and lets the rest recede.
                const dim = focus !== null && !touches(link.p, focus);
                return (
                  <path
                    key={ortho(link.p)}
                    d={ortho(link.p)}
                    className="howto-link"
                    stroke="var(--line)"
                    strokeWidth={1.5}
                    strokeOpacity={dim ? 0.4 : off ? 0.45 : 1}
                    markerEnd={link.arrow && !off && !dim ? "url(#howto-arrow)" : undefined}
                  />
                );
              })}
              {layout.links
                .filter((link) => !(link.k && isOff(lit(link.k))))
                .map((link) => (
                  <path
                    key={`flow-${ortho(link.p)}`}
                    d={ortho(link.p)}
                    className="flow-line howto-link"
                    stroke="var(--accent)"
                    strokeWidth={1.5}
                    // A focused node keeps its own dashes bright; the rest stay readable, just quiet.
                    strokeOpacity={focus === null || touches(link.p, focus) ? 0.75 : 0.3}
                  />
                ))}
</g>
            {layout.captions.map((caption) => (
              <text
                key={caption.text}
                x={caption.x}
                y={caption.y}
                textAnchor={caption.anchor ?? "start"}
                fontSize={10}
                fill="var(--dim)"
                className="mono"
              >
                {caption.text}
              </text>
            ))}
          </svg>

          {layout.nodes.map(([id, box]) => {
            const state = stateOf(id);
            return (
              <NodeButton
                key={id}
                box={box}
                off={isNodeOff(id)}
                selected={selected === id}
                dashed={id === "add-host"}
                label={`${titleOf(id)}, ${state.label}`.replace(/, $/, "")}
                onSelect={() => { setSelected((open) => (open === id ? null : id)); setConfirming(null); }}
                onHover={(on) => setHovered(on ? id : null)}
              >
                {body(id)}
              </NodeButton>
            );
          })}
        </div>

        <div className="absolute top-2 right-2 flex items-center gap-1 rounded-lg border border-line bg-panel/90 p-1 backdrop-blur">
          <button
            type="button"
            onClick={() => zoomBy(1 / 1.2)}
            aria-label="Zoom out"
            className="grid size-6 cursor-pointer place-items-center rounded-md text-dim hover:bg-track hover:text-ink"
          >
            <Icon name="zoom-out" className="size-3.5" />
          </button>
          <span className="mono w-9 text-center text-[10px] text-dim">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            onClick={() => zoomBy(1.2)}
            aria-label="Zoom in"
            className="grid size-6 cursor-pointer place-items-center rounded-md text-dim hover:bg-track hover:text-ink"
          >
            <Icon name="zoom-in" className="size-3.5" />
          </button>
          {zoomed ? (
            <button
              type="button"
              onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
              aria-label="Reset the view"
              className="mono grid h-6 cursor-pointer place-items-center rounded-md px-1.5 text-[10px] text-dim hover:bg-track hover:text-ink"
            >
              reset
            </button>
          ) : null}
        </div>
      </div>

      {selected && selectedState && menu ? (
        <div
          role="dialog"
          aria-label={`${titleOf(selected)} options`}
          style={{ left: menu.left, top: menu.top, width: MENU_W }}
          className="absolute z-20 grid gap-1.5 rounded-xl border border-line bg-panel p-2.5 shadow-lg"
        >
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold">{titleOf(selected)}</span>
            {selectedState.label ? (
              <span className="mono rounded border border-line px-1 text-[9px] text-dim">{selectedState.label}</span>
            ) : null}
            <button
              type="button"
              onClick={() => setSelected(null)}
              aria-label="Close options"
              className="ml-auto grid size-5 cursor-pointer place-items-center rounded text-dim hover:bg-track hover:text-ink"
            >
              <Icon name="x" className="size-3" />
            </button>
          </div>
          <p className="m-0 text-[10px] leading-relaxed text-dim">{ABOUT[selected]}</p>
          {busy === selected ? <p className="mono m-0 text-[10px] text-accent">Working</p> : null}
          {hostId ? (
            <div className="flex flex-wrap items-center gap-1">
              {hostInstalled ? (
                <MenuAction disabled={busy !== null} onClick={() => onHostAction(selected, "update")}>Update</MenuAction>
              ) : (
                <MenuAction disabled={busy !== null} onClick={() => onHostAction(selected, "install")}>Install</MenuAction>
              )}
              {hostInstalled ? (
                confirming === selected ? (
                  <MenuAction danger disabled={busy !== null} onClick={() => onHostAction(selected, "uninstall")}>Confirm uninstall</MenuAction>
                ) : (
                  <MenuAction disabled={busy !== null} onClick={() => setConfirming(selected)}>Uninstall</MenuAction>
                )
              ) : null}
            </div>
          ) : null}
          {selected === "add-host" ? (
            <div className="grid gap-1">
              {missingHosts.map((host) => (
                <div key={host.id} className="flex items-center gap-2">
                  <AgentLogo host={host.id} className="size-3.5 shrink-0" />
                  <span className="truncate text-[11px]">{host.label}</span>
                  <span className="ml-auto">
                    <MenuAction disabled={busy !== null} onClick={() => onHostAction(`host-${host.id}`, "install")}>
                      Install
                    </MenuAction>
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          {picker ? (
            <>
              <div className="grid grid-cols-2 gap-1">
                {picker.options.map((option) => {
                  const active = current === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={active}
                      disabled={busy !== null}
                      onClick={() => onSet(selected, picker.field, picker.field === "rtkDefault" ? option.id === "on" : option.id)}
                      className={cn(
                        "mono cursor-pointer rounded-md border px-1.5 py-1 text-[10px] transition-colors",
                        active ? "border-accent bg-accent-soft text-ink" : "border-line text-dim hover:border-accent/50 hover:text-ink",
                        busy !== null && "opacity-50",
                      )}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              {picked ? (
                <code className="mono w-fit rounded bg-track/40 px-1.5 py-0.5 text-[10px] text-ink">/{selected} {picked}</code>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
      <p className="mono m-0 mt-2 text-[10px] text-dim">
        Click a node for its options. Drag to pan, and use the controls to zoom.
      </p>
    </div>
  );
}

/** The canvas's shape while the host list is still out: agent column, mode column, output. */
function PipelineSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading the pipeline"
      className="flex min-h-[260px] flex-wrap items-center gap-6 rounded-lg border border-line p-4"
    >
      <div className="grid gap-3">
        {[0, 1, 2].map((row) => <Skeleton key={row} className="h-12 w-40 rounded-xl" />)}
      </div>
      <div className="grid gap-3">
        {[0, 1, 2, 3].map((row) => <Skeleton key={row} className="h-12 w-44 rounded-xl" />)}
      </div>
      <Skeleton className="h-16 w-52 rounded-xl" />
    </div>
  );
}

/** An exported file has no server, so a failed read leaves the hosts unknown and every node lit. */
function readHosts(): Promise<Array<{ id: string; installed: boolean }> | null> {
  return fetch("/api/hosts")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
}

export function HowToPage({ modes, onModesChanged }: { modes: ModeState | null; onModesChanged: () => void }) {
  const toast = useToast();
  const [hostState, setHostState] = useState<HostState>({ installed: {}, versions: {} });
  const [busy, setBusy] = useState<NodeId | null>(null);
  const [hostsLoaded, setHostsLoaded] = useState(false);
  const pipelinePending = usePending(!hostsLoaded);

  useEffect(() => {
    void readHosts()
      .then((rows) => {
        if (rows) setHostState((s) => ({ ...s, installed: Object.fromEntries(rows.map((row) => [row.id, row.installed])) }));
      })
      .finally(() => setHostsLoaded(true));
    void fetchHealth().then((report) => {
      if (!report) return;
      setHostState((s) => ({
        ...s,
        versions: {
          omp: versionOf(report.omp),
          pi: versionOf(report.pi),
          opencode: versionOf(report.opencode),
          codex: versionOf(report.codex),
        },
      }));
    });
  }, []);

  const save = (node: NodeId, field: string, value: string | boolean): void => {
    setBusy(node);
    void fetch("/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    })
      .then((r) => r.json())
      .then((d: { ok?: boolean; error?: string } | null) => {
        if (d?.ok) {
          toast(`${node} ${typeof value === "boolean" ? (value ? "on" : "off") : value}`, "Applies to new sessions.", "check");
          onModesChanged();
        } else {
          toast("Could not save", d?.error ?? "The server refused the change.", "circle-alert");
        }
      })
      .catch(() => toast("Could not save", "The dashboard server did not answer.", "circle-alert"))
      .finally(() => setBusy(null));
  };

  // The CLI runs install, uninstall, and update in its own process, so the page asks the server
  // whether that child is still running instead of guessing from the tree on disk.
  const hostAction = (node: NodeId, action: HostAction): void => {
    const host = node.slice("host-".length);
    setBusy(node);
    void fetch("/api/hosts/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host, action }),
    })
      .then((r) => r.json())
      .then((d: { ok?: boolean; error?: string } | null) => {
        if (!d?.ok) {
          toast(`Could not ${action} ${host}`, d?.error ?? "The server refused the request.", "circle-alert");
          setBusy(null);
          return;
        }
        toast(`${host}: ${action} started`, "It runs in the background.", "check");
        const started = Date.now();
        const timer = window.setInterval(() => {
          void fetch("/api/hosts/action")
            .then((r) => (r.ok ? r.json() : null))
            .then((jobs: Array<{ host: string; action: string; code: number | null }> | null) => {
              const job = jobs?.find((entry) => entry.host === host && entry.action === action && entry.code !== null);
              // A child that never reports back still has to hand the menu back.
              if (!job && Date.now() - started < 120_000) return;
              window.clearInterval(timer);
              setBusy(null);
              void readHosts().then((rows) => {
                if (rows) setHostState((s) => ({ ...s, installed: Object.fromEntries(rows.map((row) => [row.id, row.installed])) }));
              });
              void fetchHealth().then((report) => {
                if (!report) return;
                const version = versionOf(report[host as "omp" | "pi" | "opencode" | "codex"]);
                if (version) setHostState((s) => ({ ...s, versions: { ...s.versions, [host]: version } }));
              });
              if (job?.code === 0) {
                toast(`${host}: ${action} done`, "The agent list is up to date.", "check");
              } else if (job) {
                toast(`${host}: ${action} failed`, `The command exited with code ${job.code}.`, "circle-alert");
              } else {
                toast(`${host}: ${action} is still running`, "Reload the page in a moment to see the result.", "circle-alert");
              }
            })
            .catch(() => { /* the next tick tries again */ });
        }, 1000);
      })
      .catch(() => {
        toast(`Could not ${action} ${host}`, "The dashboard server did not answer. Restart it to load the host actions.", "circle-alert");
        setBusy(null);
      });
  };

  return (
    <Page>
      <PageHeader
        title="Quick start"
        description="One package, four agents, four modes. This is the path a turn takes from your prompt to the reply, drawn from what this machine has on."
      />

      <Card
        title="The pipeline"
        icon="workflow"
        description="The host loads the extensions. Each mode appends one block to the prompt, then RTK rewrites and filters what the model runs. A dimmed node is off, or not installed. Click a node for its options; a mode switches straight from its menu."
      >
        {pipelinePending ? <PipelineSkeleton /> : (
          <PipelineCanvas modes={modes} hostState={hostState} onSet={save} onHostAction={hostAction} busy={busy} />
        )}
      </Card>

      <Card title="Start here" icon="list-ordered" description="Five steps from a fresh machine to a session that reports itself.">
        <ol className="m-0 grid list-none gap-2 p-0 md:grid-cols-2">
          {STEPS.map((step, i) => (
            <li key={step.title} className="grid gap-1 rounded-xl border border-line px-3 py-2.5">
              <span className="flex items-center gap-2">
                <span className="mono grid size-5 shrink-0 place-items-center rounded-full border border-line text-[10px] text-dim">
                  {i + 1}
                </span>
                <span className="text-[13px] font-semibold">{step.title}</span>
              </span>
              <span className="text-[11px] leading-relaxed text-dim">{step.body}</span>
              <code className="mono mt-0.5 block truncate rounded bg-track/40 px-2 py-1 text-[10px] text-ink">
                {step.command}
              </code>
            </li>
          ))}
        </ol>
      </Card>

      <Card
        title="Install into an agent"
        icon="download"
        description="Each host's own command. Use the Tersio command or the native one, never both for the same host."
      >
        <div className="grid gap-2 md:grid-cols-2">
          {INSTALL_METHODS.map((method) => (
            <div key={method.host} className="grid gap-1 rounded-xl border border-line px-3 py-2.5">
              <span className="flex items-center gap-2">
                <AgentLogo host={method.host} className="size-4 shrink-0" />
                <span className="text-[13px] font-semibold">{method.label}</span>
              </span>
              {method.commands.map((command) => (
                <code key={command} className="mono block truncate rounded bg-track/40 px-2 py-1 text-[10px] text-ink">
                  {command}
                </code>
              ))}
              <span className="text-[11px] leading-relaxed text-dim">{method.note}</span>
            </div>
          ))}
        </div>
      </Card>
    </Page>
  );
}
