// Quick start data model: the pipeline graph, its tables, and every derivation the canvas and the dialogs read. No JSX here, so the host surfaces stay in the component modules.
import type {ModeState} from "./shell"

export type Point = readonly [number, number]

export type EdgeKey =
  | "hosts"
  | "omp"
  | "pi"
  | "pig"
  | "opencode"
  | "dsh"
  | "codex"
  | "claude"
  | "combo"
  | "headroom"
  | "caveman"
  | "pstack"
  | "rtk"
  | "ponytail"
  | "codegraph"
  | "group-modes"
  | "group-optional"
  | "group-hosts";
export type HostAction = "install" | "uninstall" | "update"

/** `null` means this page has no answer yet: an exported file reads no settings, so it draws every node as lit. */
export type Lit = boolean | null

export const isOff = (value: Lit): boolean => value === false

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export type NodeId =
  | "prompt"
  | "output"
  | "caveman"
  | "pstack"
  | "headroom"
  | "rtk"
  | "ponytail"
  | "codegraph"
  | `host-${string}`;

/** A dashed frame the canvas draws around member nodes; its edge starts at the frame, not a member. */
export type GroupId = "group-modes" | "group-optional" | "group-hosts"
export type GraphEndpoint = NodeId | GroupId
export interface GraphEdge {
  from: GraphEndpoint
  to: GraphEndpoint
}

/** The nodes one frame wraps. The prompt modes chain inside; the opt-in extras share their own band. */
export const MODE_GROUP: readonly NodeId[] = ["caveman", "rtk", "ponytail"]
export const OPTIONAL_GROUP: readonly NodeId[] = ["pstack", "headroom", "codegraph"]

/** The injection order: each block appends to the prompt in this sequence. */
export const CHAIN = ["caveman", "rtk", "ponytail"] as const
/** The turn order: the prompt modes chain member to member, and each band hands its work to the output with one line. */
export function pipelineGraph(installedHosts: ReadonlyArray<string>): {
  nodes: NodeId[]
  edges: GraphEdge[]
} {
  // The opt-in extras are nodes of their own: they hang off the band, not the prompt chain.
  const nodes: NodeId[] = ["prompt", ...CHAIN, "pstack", "headroom", "codegraph", "output"]
  for (const host of installedHosts) nodes.push(`host-${host}` as NodeId)
  const edges: GraphEdge[] = [
    { from: "prompt", to: "group-modes" },
    { from: "caveman", to: "rtk" },
    { from: "rtk", to: "ponytail" },
    { from: "group-modes", to: "output" },
    { from: "group-optional", to: "output" },
  ]
  // One connector for the whole band, so ten agents still draw a single line into the output.
  if (installedHosts.length > 0) edges.push({ from: "group-hosts", to: "output" })
  return { nodes, edges }
}

export const NODE_W = 224
export const NODE_H = 72

/** Everything lands on this grid, so nodes line up with the dot background and with each other. */
export const GRID_SNAP = 8

export function snapToGrid(value: number): number {
  return Math.round(value / GRID_SNAP) * GRID_SNAP
}

export type PortSide = "left" | "right" | "top" | "bottom"

/** The midpoint of one side: the port an edge leaves from or arrives at. */
export function portPoint(box: Box, side: PortSide): Point {
  if (side === "left") return [box.x, box.y + box.h / 2]
  if (side === "right") return [box.x + box.w, box.y + box.h / 2]
  if (side === "top") return [box.x + box.w / 2, box.y]
  return [box.x + box.w / 2, box.y + box.h]
}

/** The two ports an edge uses. The axis with the smaller clear gap wins, so a diagonal target never produces a hairpin: side-by-side cards keep a run of at least 24px, else the line turns vertical. */
export function edgePorts(s: Box, t: Box): { from: PortSide; to: PortSide } {
  const hGap = t.x >= s.x ? t.x - (s.x + s.w) : s.x - (t.x + t.w)
  const vGap = t.y >= s.y ? t.y - (s.y + s.h) : s.y - (t.y + t.h)
  const horizontal = hGap >= 24 && (vGap < 0 || hGap <= vGap)
  if (horizontal) return t.x >= s.x ? { from: "right", to: "left" } : { from: "left", to: "right" }
  return t.y >= s.y ? { from: "bottom", to: "top" } : { from: "top", to: "bottom" }
}

/** The ports a band edge uses: the frame faces the target by center direction, so a wide band never exits through its bottom when the target sits to its right. */
export function framePorts(s: Box, t: Box): { from: PortSide; to: PortSide } {
  const dx = t.x + t.w / 2 - (s.x + s.w / 2)
  const dy = t.y + t.h / 2 - (s.y + s.h / 2)
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? { from: "right", to: "left" } : { from: "left", to: "right" }
  return dy >= 0 ? { from: "bottom", to: "top" } : { from: "top", to: "bottom" }
}

const PORT_NORMAL: Record<PortSide, Point> = {
  left: [-1, 0],
  right: [1, 0],
  top: [0, -1],
  bottom: [0, 1],
}

/** How close a dragged edge or center must be to another node's before it snaps. */
export const ALIGN_THRESHOLD = 6

export interface GuideLine {
  /** The coordinate the line sits at (x for vertical, y for horizontal). */
  at: number
  /** The line's span across the other axis. */
  from: number
  to: number
}

export interface Alignment {
  box: Box
  vertical: GuideLine[]
  horizontal: GuideLine[]
}

/** Figma-style snapping: edges and centers snap to the other nodes within the threshold and return the guide lines. */
export function alignDrag(
  id: string,
  next: Box,
  boxes: ReadonlyArray<readonly [string, Box]>,
): Alignment {
  const pick = (axis: "x" | "y"): { delta: number; line: GuideLine } | null => {
    const size = axis === "x" ? next.w : next.h
    const origin = axis === "x" ? next.x : next.y
    const mine = [origin, origin + size / 2, origin + size]
    let best: { delta: number; line: GuideLine } | null = null
    for (const [otherId, b] of boxes) {
      if (otherId === id) continue
      const otherOrigin = axis === "x" ? b.x : b.y
      const otherSize = axis === "x" ? b.w : b.h
      for (const theirs of [otherOrigin, otherOrigin + otherSize / 2, otherOrigin + otherSize]) {
        for (const m of mine) {
          const delta = theirs - m
          if (Math.abs(delta) > ALIGN_THRESHOLD) continue
          if (best && Math.abs(delta) >= Math.abs(best.delta)) continue
          const cross =
            axis === "x"
              ? [Math.min(next.y, b.y), Math.max(next.y + next.h, b.y + b.h)]
              : [Math.min(next.x, b.x), Math.max(next.x + next.w, b.x + b.w)]
          best = { delta, line: { at: theirs, from: cross[0], to: cross[1] } }
        }
      }
    }
    return best
  }
  const vertical = pick("x")
  const horizontal = pick("y")
  return {
    box: { ...next, x: next.x + (vertical?.delta ?? 0), y: next.y + (horizontal?.delta ?? 0) },
    vertical: vertical ? [vertical.line] : [],
    horizontal: horizontal ? [horizontal.line] : [],
  }
}

/** The connector arcs around any card that sits between its ports, so long links stay smooth. */
/** Points along a cubic curve, enough to test every card the line could graze. */
function curveSamples(sp: Point, c1: Point, c2: Point, tp: Point, steps: number): Point[] {
  const out: Point[] = []
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    const u = 1 - t
    out.push([
      u * u * u * sp[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * tp[0],
      u * u * u * sp[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * tp[1],
    ])
  }
  return out
}

/** True when no card sits on the sampled curve; the gap keeps lines from grazing a border. */
function curveClears(
  points: ReadonlyArray<Point>,
  obstacles: ReadonlyArray<Box>,
  pad: number,
): boolean {
  for (const [x, y] of points) {
    for (const b of obstacles) {
      if (x > b.x - pad && x < b.x + b.w + pad && y > b.y - pad && y < b.y + b.h + pad) return false
    }
  }
  return true
}


/** The connector between two boxes, bowed around everything in `others`; `ports` pins the sides a band edge has already chosen. */
export function edgePath(
  s: Box,
  t: Box,
  others: ReadonlyArray<Box>,
  ports: { from: PortSide; to: PortSide } = edgePorts(s, t),
): string {
  const sp = portPoint(s, ports.from)
  const tp = portPoint(t, ports.to)
  const dx = tp[0] - sp[0]
  const dy = tp[1] - sp[1]
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const nx = -uy
  const ny = ux
  // A long reach bows a short gap into a loop; keep the handles proportional to the run.
  const reach = Math.min(96, Math.max(32, len * 0.35))
  const outFrom = PORT_NORMAL[ports.from]
  const outTo = PORT_NORMAL[ports.to]
  const at = (lift: number): { c1: Point; c2: Point } => ({
    c1: [sp[0] + outFrom[0] * reach + nx * lift, sp[1] + outFrom[1] * reach + ny * lift],
    c2: [tp[0] + outTo[0] * reach + nx * lift, tp[1] + outTo[1] * reach + ny * lift],
  })
  // Use the nearest curve that clears cards; routing around decorative group frames created oversized loops.
  const lifts = [0, 36, -36, 72, -72, 108, -108, 144, -144, 180, -180, 216, -216]
  let chosen = at(0)
  for (const lift of lifts) {
    const curve = at(lift)
    chosen = curve
    const points = curveSamples(sp, curve.c1, curve.c2, tp, 28)
    if (curveClears(points, others, 14)) break
  }
  return `M${sp[0]} ${sp[1]} C${chosen.c1[0]} ${chosen.c1[1]}, ${chosen.c2[0]} ${chosen.c2[1]}, ${tp[0]} ${tp[1]}`
}

/** The default view: the prompt band in the center, prompt left, the opt-in extras above, output right, hosts below. */
export function defaultPositions(installedHosts: ReadonlyArray<string>): Record<string, Box> {
  const HOST_COLUMNS = 3
  const HOST_ROW_STEP = NODE_H + 80
  const positions: Record<string, Box> = {
    prompt: { x: 40, y: 264, w: NODE_W, h: NODE_H },
    // Default Feedback: the three always-on prompt modes, one row.
    caveman: { x: 320, y: 264, w: NODE_W, h: NODE_H },
    rtk: { x: 592, y: 264, w: NODE_W, h: NODE_H },
    ponytail: { x: 864, y: 264, w: NODE_W, h: NODE_H },
    // Optional Feedback: the opt-in extras, one row above the feedback band.
    pstack: { x: 320, y: 56, w: NODE_W, h: NODE_H },
    headroom: { x: 592, y: 56, w: NODE_W, h: NODE_H },
    codegraph: { x: 864, y: 56, w: NODE_W, h: NODE_H },
    output: { x: 1136, y: 264, w: NODE_W, h: NODE_H },
  }
  // The agent band: the host card is taller because it lists its live modes, and a fourth host starts a new row under the first column.
  installedHosts.forEach((host, i) => {
    positions[`host-${host}`] = {
      x: 184 + (i % HOST_COLUMNS) * 272,
      y: 496 + Math.floor(i / HOST_COLUMNS) * HOST_ROW_STEP,
      w: NODE_W,
      h: NODE_H + 48,
    }
  })
  return positions
}

const POSITIONS_KEY = "tersio.pipeline.positions"
/** A layout saved before a grouping change fights the new frames, so the payload carries its own version. */
const POSITIONS_LAYOUT = 3

/** A stored box worth keeping: every field a Box needs. */
function isBox(value: unknown): value is Box {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Box).x === "number" &&
    typeof (value as Box).y === "number" &&
    typeof (value as Box).w === "number" &&
    typeof (value as Box).h === "number"
  )
}

/** Clean the boxes of a versioned payload, so a stale entry never pins a node. */
function boxesOf(payload: Record<string, unknown>): Record<string, Box> | null {
  if (payload.layout !== POSITIONS_LAYOUT) return null
  const raw = payload.boxes
  if (typeof raw !== "object" || raw === null) return null
  const clean: Record<string, Box> = {}
  for (const [id, box] of Object.entries(raw)) if (isBox(box)) clean[id] = box
  return Object.keys(clean).length > 0 ? clean : null
}

/** Node positions survive reloads; a corrupt, older, or missing store falls back to the default layout. */
export function loadPositions(): Record<string, Box> | null {
  try {
    const raw = localStorage.getItem(POSITIONS_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return null
    return boxesOf(parsed as Record<string, unknown>)
  } catch {
    return null
  }
}

export function savePositions(positions: Record<string, Box>): void {
  try {
    localStorage.setItem(POSITIONS_KEY, JSON.stringify({ layout: POSITIONS_LAYOUT, boxes: positions }))
  } catch {
    // Private mode: the layout just does not persist.
  }
}

/** The server copy of the same store: only a layout the client wrote back at this version merges. */
export function storedPositionsVersion(server: Record<string, unknown> | null): Record<string, Box> {
  if (!server) return {}
  return boxesOf(server) ?? {}
}

/** `/health` reports `omp/18.12.6` and `codex-cli 0.167.0-alpha.3.2`, so the node keeps only the version. */
export function versionOf(raw: string | null | undefined): string | null {
  if (!raw) return null
  const tail = raw.split("/").pop() ?? raw
  // Drop a leading tool name (`codex-cli `) and a leading `v` (`v2.1.3`), which is not part of a version.
  const version = tail
    .replace(/^[a-z][a-z-]*\s+/i, "")
    .replace(/^v(?=\d)/i, "")
    // Claude prints `<version> (Claude Code)`; the badge keeps the bare version.
    .replace(/\s*\([^)]*\)$/, "")
    .trim()
  return version || null
}

/** A 224px node cannot hold a full prerelease tag, so the badge drops the build tail: `0.167.0`. */
export function shortVersion(version: string | null): string | null {
  if (!version) return null
  return version.replace(/-.*$/, "")
}

/** The hosts, in the order the installer writes them. */
export const HOSTS = [
  { id: "omp", label: "Oh My Pi" },
  { id: "pi", label: "pi" },
  { id: "pig", label: "PiG" },
  { id: "opencode", label: "OpenCode" },
  { id: "dsh", label: "DeepSeek Harness" },
  { id: "codex", label: "Codex" },
  { id: "claude", label: "Claude Code" },
] as const

/**
 * Hosts whose CodeGraph reach is the shared MCP tool only: no extension to load and no edit hook to gate.
 * Codex left this list when its hook started reading the flag; DeepSeek Harness mounts the MCP tool too.
 */
export const NO_EXTENSION_HOSTS: Readonly<Record<string, true | undefined>> = {
  claude: true,
}

const HOST_FIELDS: Record<
  string,
  "cavemanDefault" | "rtkDefault" | "ponytailDefault" | "pstackDefault" | "headroomDefault" | "codegraphDefault"
> = {
  caveman: "cavemanDefault",
  rtk: "rtkDefault",
  headroom: "headroomDefault",
  ponytail: "ponytailDefault",
  pstack: "pstackDefault",
  codegraph: "codegraphDefault",
}

/** What each mode reads to for one agent: its own section first, the shared store underneath. */
export function agentModeRows(
  host: string,
  modes: ModeState | null,
  headroomRoute?: boolean,
): Array<{ key: string; glyph: string; label: string; on: boolean | null; title?: string }> {
  if (!modes) return []
  const section = (modes.hosts?.[host] ?? {}) as Partial<Record<string, string | boolean>>
  // SAFETY: ModeState carries the shared defaults at top level under these same field names, which its index signature does not declare.
  const shared = modes as unknown as Partial<Record<string, string | boolean>>
  const read = (key: string): string | boolean | undefined =>
    section[HOST_FIELDS[key]] ?? shared[HOST_FIELDS[key]]
  const headroom = String(read("headroom") ?? "off")
  // The saved default is what the user opted into, so the row shows it; a missing route is a title, not a different word.
  const headroomTitle =
    headroom !== "off" && headroomRoute === false
      ? "Saved on; this host has no live Headroom route yet."
      : "Compresses traffic below the shell."
  return [
    {
      key: "caveman",
      glyph: "🪨",
      label: String(read("caveman") ?? "off"),
      on: String(read("caveman") ?? "off") !== "off",
    },
    {
      key: "rtk",
      glyph: "🗜️",
      label: read("rtk") === true ? "on" : "off",
      on: read("rtk") === true,
    },
    { key: "headroom", glyph: "🍃", label: headroom, on: headroom !== "off", title: headroomTitle },
    {
      key: "ponytail",
      glyph: "🧠",
      label: String(read("ponytail") ?? "off"),
      on: String(read("ponytail") ?? "off") !== "off",
    },
    {
      key: "pstack",
      glyph: "🥔",
      label: String(read("pstack") ?? "off"),
      on: String(read("pstack") ?? "off") !== "off",
    },
    {
      key: "codegraph",
      glyph: "🕸️",
      label: NO_EXTENSION_HOSTS[host] ? "n/a" : String(read("codegraph") ?? "on"),
      on: !NO_EXTENSION_HOSTS[host] && String(read("codegraph") ?? "on") === "on",
    },
  ]
}

export const MODES = [
  {
    key: "caveman",
    glyph: "🪨",
    name: "caveman",
    role: "voice",
    note: "terse replies, filler gone",
  },
  {
    key: "pstack",
    glyph: "🥔",
    name: "pstack",
    role: "approach",
    note: "playbook, checks, design",
  },
  {
    key: "headroom",
    glyph: "🍃",
    name: "headroom",
    role: "compression",
    note: "compresses traffic below the shell",
  },
  {
    key: "rtk",
    glyph: "🗜️",
    name: "rtk",
    role: "tooling",
    note: "rewrites and condenses shell calls",
  },
  {
    key: "ponytail",
    glyph: "🧠",
    name: "ponytail",
    role: "size",
    note: "smallest complete change",
  },
  {
    key: "codegraph",
    glyph: "🕸️",
    name: "codegraph",
    role: "graph",
    note: "index for symbol search and blast radius",
  },
] as const
/** The nodes a click can set, the field each writes, and the levels that field takes. Every per-agent preset shares the combo entry. */
export const PICKER: Record<
  "combo" | "caveman" | "rtk" | "ponytail" | "pstack" | "headroom" | "codegraph",
  { field: string; options: ReadonlyArray<{ id: string; label: string }> }
> = {
  combo: {
    field: "comboDefault",
    options: [
      { id: "off", label: "Off" },
      { id: "lite", label: "Lite (recommended)" },
      { id: "balanced", label: "Balanced" },
      { id: "max", label: "Max" },
    ],
  },
  caveman: {
    field: "cavemanDefault",
    options: [
      { id: "off", label: "Off" },
      { id: "lite", label: "Lite" },
      { id: "full", label: "Full" },
      { id: "ultra", label: "Ultra" },
      { id: "megacave-lite", label: "Megacave lite" },
      { id: "megacave-full", label: "Megacave full" },
      { id: "megacave-ultra", label: "Megacave ultra" },
    ],
  },
  rtk: {
    field: "rtkDefault",
    options: [
      { id: "off", label: "Off" },
      { id: "on", label: "On" },
    ],
  },
  ponytail: {
    field: "ponytailDefault",
    options: [
      { id: "off", label: "Off" },
      { id: "lite", label: "Lite" },
      { id: "full", label: "Full" },
      { id: "ultra", label: "Ultra" },
    ],
  },
  pstack: {
    field: "pstackDefault",
    options: [
      { id: "off", label: "Off" },
      { id: "on", label: "On" },
    ],
  },
  headroom: {
    field: "headroomDefault",
    options: [
      { id: "off", label: "Off" },
      { id: "on", label: "On" },
    ],
  },
  codegraph: {
    field: "codegraphDefault",
    options: [
      { id: "off", label: "Off" },
      { id: "on", label: "On (auto-sync)" },
    ],
  },
}

/** The sync intervals the CodeGraph index can follow; `live` is the file watcher, the rest are timers. */
export const CODEGRAPH_SYNC_OPTIONS = [
  { id: "live", label: "Live (watcher)" },
  { id: "5m", label: "Every 5 min" },
  { id: "15m", label: "Every 15 min" },
  { id: "1h", label: "Hourly" },
  { id: "manual", label: "Manual" },
] as const

/** The session-start defaults one scope carries; `comboLevel` exists only on the shared store. */
export interface DefaultsPayload {
  comboDefault: string
  comboLevel: string
  cavemanDefault: string
  rtkDefault: boolean
  ponytailDefault: string
  pstackDefault: string
  headroomDefault: string
  codegraphDefault: string
  codegraphSync: string
}

export const DEFAULT_ROWS_UI: Array<{
  field: keyof DefaultsPayload
  label: string
  glyph: string
  hint: string
  options: Array<{ id: string; label: string }>
}> = [
    {
      field: "comboDefault",
      label: "Combo preset",
      glyph: "🧩",
      hint: "Sets caveman, RTK and Ponytail together. pstack is separate.",
      options: [
        { id: "off", label: "Off" },
        { id: "lite", label: "Lite (recommended)" },
        { id: "balanced", label: "Balanced" },
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
        { id: "off", label: "Off" },
        { id: "lite", label: "Lite" },
        { id: "full", label: "Full" },
        { id: "ultra", label: "Ultra" },
        { id: "megacave-lite", label: "Megacave lite" },
        { id: "megacave-full", label: "Megacave full" },
        { id: "megacave-ultra", label: "Megacave ultra" },
      ],
    },
    {
      field: "rtkDefault",
      label: "RTK",
      glyph: "🗜️",
      hint: "Rewrite eligible Bash calls through rtk.",
      options: [
        { id: "on", label: "On" },
        { id: "off", label: "Off" },
      ],
    },
    {
      field: "ponytailDefault",
      label: "Ponytail",
      glyph: "🧠",
      hint: "Lazy-code mode for a new or resumed session.",
      options: [
        { id: "off", label: "Off" },
        { id: "lite", label: "Lite" },
        { id: "full", label: "Full" },
        { id: "ultra", label: "Ultra" },
      ],
    },
    {
      field: "pstackDefault",
      label: "pstack",
      glyph: "🥔",
      hint: "Rigor mode. Opt-in, so no preset turns it on or off.",
      options: [
        { id: "off", label: "Off" },
        { id: "on", label: "On" },
      ],
    },
    {
      field: "codegraphDefault",
      label: "CodeGraph",
      glyph: "🕸️",
      hint: "On creates and syncs the local index. Off disables automatic indexing; manual CodeGraph tools remain available.",
      options: [
        { id: "off", label: "Off" },
        { id: "on", label: "On" },
      ],
    },
  ]

export const OFF_DEFAULTS: DefaultsPayload = {
  comboDefault: "off",
  comboLevel: "off",
  cavemanDefault: "off",
  rtkDefault: false,
  ponytailDefault: "off",
  pstackDefault: "off",
  headroomDefault: "off",
  codegraphDefault: "on",
  codegraphSync: "live",
}

/** What the option surface says about a node. */
export const ABOUT: Partial<Record<NodeId, string>> = {
  prompt: "Your message starts the turn. Every block below appends to it before the agent sees it.",
  "host-omp": "Oh My Pi loads the extensions from its plugin package.",
  "host-pi": "pi auto-discovers the same tree from its extensions directory.",
  "host-pig": "PiG loads the same tree from its own agent directory, the way pi does.",
  "host-opencode": "OpenCode loads the tree as one plugin, registered in opencode.json.",
  "host-dsh": "DeepSeek Harness loads Tersio as a bundle plugin mounted into its web profile.",
  "host-codex": "Codex loads Tersio's portable plugin, with MCP data and an always-on mode hook.",
  "host-claude":
    "Claude Code loads Tersio's portable plugin, with slash commands and an always-on mode hook.",
  caveman: "Voice. Terse replies; code, commands, paths, and errors stay exact.",
  pstack: "Approach. Picks the playbook, the checks, and the design.",
  headroom: "Compresses tool outputs and history below the shell; Tersio tracks the savings.",
  rtk: "Tooling. Rewrites a shell command and condenses its output before the model sees it.",
  ponytail: "Size. Caps the diff at the smallest complete change.",
  output: "The turn's result: what the agent answers after every block applied.",
  codegraph: "Indexes code structure for symbol search and blast-radius analysis; sync schedule is configured separately.",
}

export interface ModeVersionRow {
  installed: string | null
  upstream: string | null
  outdated: boolean | null
}

export interface HostState {
  installed: Record<string, boolean>
  /** The harness itself is on this machine, whatever state Tersio's tree is in. */
  present: Record<string, boolean>
  versions: Record<string, string | null>
  /** Each mode's shipped version against upstream, for the mode badges. */
  modeVersions: Record<string, ModeVersionRow>
}

/**
 * The last Quick start read, kept across unmount. Coming back from another page paints this instead
 * of a skeleton, and the refresh below overwrites it as soon as the server answers.
 */
export const quickStartLast: {
  hostState: HostState | null
  routes: Record<string, boolean> | null
  modes: ModeState | null
} = { hostState: null, routes: null, modes: null }

/** One definition of a node's live state, read by the canvas and the dialogs alike. */
export function edgeLit(key: EdgeKey, modes: ModeState | null, hostState: HostState): Lit {
  if (key === "hosts" || key === "group-hosts") {
    const installed = Object.values(hostState.installed)
    return installed.length ? installed.some(Boolean) : null
  }
  if (key === "group-modes") {
    if (!modes) return null
    return MODE_GROUP.some((id) => !isOff(edgeLit(id as EdgeKey, modes, hostState)))
  }
  if (key === "group-optional") {
    if (!modes) return null
    return OPTIONAL_GROUP.some((id) => !isOff(edgeLit(id as EdgeKey, modes, hostState)))
  }
  if (key === "omp" || key === "pi" || key === "opencode") {
    const installed = hostState.installed[key]
    return installed === undefined ? null : installed
  }
  if (key === "pig") {
    const installed = hostState.installed.pig
    return installed === undefined ? null : installed
  }
  if (key === "dsh") {
    const installed = hostState.installed.dsh
    return installed === undefined ? null : installed
  }
  if (key === "codex" || key === "claude") {
    const installed = hostState.installed[key]
    return installed === undefined ? null : installed
  }
  if (!modes) return null
  if (key === "rtk") return modes.rtkDefault
  if (key === "caveman") return modes.cavemanDefault !== "off"
  if (key === "ponytail") return modes.ponytailDefault !== "off"
  if (key === "headroom") return modes.headroomDefault !== "off"
  if (key === "codegraph") return modes.codegraphDefault !== "off"
  return modes.pstackDefault !== "off"
}

export function nodeTitle(id: NodeId): string {
  if (id.startsWith("host-")) return HOSTS.find((h) => `host-${h.id}` === id)?.label ?? id
  const mode = MODES.find((mm) => mm.key === id)
  if (mode) return mode.name
  if (id === "prompt") return "Prompt"
  return "Output"
}

export function nodeState(
  id: NodeId,
  modes: ModeState | null,
  hostState: HostState,
): { label: string; on: boolean | null } {
  if (id.startsWith("host-")) {
    const key = id.slice(5)
    const on = edgeLit(key as EdgeKey, modes, hostState)
    return { label: isOff(on) ? "not installed" : (versionOf(hostState.versions[key]) ?? ""), on }
  }
  if (id === "caveman" || id === "ponytail") {
    const on = edgeLit(id, modes, hostState)
    const level = id === "caveman" ? modes?.cavemanDefault : modes?.ponytailDefault
    return { label: isOff(on) ? "off" : level || "on", on }
  }
  if (id === "pstack" || id === "headroom" || id === "rtk") {
    const on = edgeLit(id, modes, hostState)
    return { label: isOff(on) ? "off" : "on", on }
  }
  if (id === "codegraph") {
    const on = edgeLit(id, modes, hostState)
    return { label: isOff(on) ? "off" : "on", on }
  }
  return { label: "", on: null }
}

export function nodeOff(id: NodeId, modes: ModeState | null, hostState: HostState): boolean {
  if (id.startsWith("host-")) return isOff(edgeLit(id.slice(5) as EdgeKey, modes, hostState))
  if (
    id === "caveman" ||
    id === "pstack" ||
    id === "headroom" ||
    id === "rtk" ||
    id === "ponytail" ||
    id === "codegraph"
  ) {
    return isOff(edgeLit(id, modes, hostState))
  }
  return false
}

/** What the node's control reads right now, in the scope the dialog writes to. */
export function nodeValue(
  id: NodeId,
  scope: "all" | "omp" | "pi" | "pig" | "opencode" | "dsh" | "codex" | "claude",
  modes: ModeState | null,
): string | null {
  if (!modes) return null
  if (id === "caveman") {
    if (scope !== "all") {
      const own = modes.hosts?.[scope]?.cavemanDefault
      if (typeof own === "string") return own
    }
    return modes.cavemanDefault
  }
  if (id === "ponytail") {
    if (scope !== "all") {
      const own = modes.hosts?.[scope]?.ponytailDefault
      if (typeof own === "string") return own
    }
    return modes.ponytailDefault
  }
  if (id === "pstack") {
    if (scope !== "all") {
      const own = modes.hosts?.[scope]?.pstackDefault
      if (typeof own === "string") return own
    }
    return modes.pstackDefault
  }
  if (id === "headroom") {
    if (scope !== "all") {
      const own = modes.hosts?.[scope]?.headroomDefault
      if (typeof own === "string") return own
    }
    return modes.headroomDefault
  }
  if (id === "rtk") {
    if (scope !== "all") {
      const own = modes.hosts?.[scope]?.rtkDefault
      if (own !== undefined) return own === true ? "on" : "off"
    }
    return modes.rtkDefault ? "on" : "off"
  }
  if (id === "codegraph") {
    if (scope !== "all") {
      const own = modes.hosts?.[scope]?.codegraphDefault
      if (typeof own === "string") return own
    }
    return modes.codegraphDefault
  }
  return null
}

export function nodeGlyph(id: NodeId): string | null {
  if (id === "prompt") return "▶"
  if (id === "output") return null
  return MODES.find((mm) => mm.key === id)?.glyph ?? null
}
export function readHosts(): Promise<Array<{ id: string; installed: boolean }> | null> {
  return fetch("/api/hosts")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
}

