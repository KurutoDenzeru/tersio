// The pipeline canvas: an infinite pan/zoom viewport of draggable node cards with bezier connectors, laid out in positions tersio stores so a restart keeps them.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AgentLogo } from "@/components/agent-logos";
import { Icon } from "@/components/icon";
import { Spinner } from "@/components/ui/spinner";
import { fetchPipelinePositions, postPipelinePositions, readStoredWraps } from "@/lib/data";
import { cn } from "cn";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { HeadroomDrawer, HostDrawer, ModeDrawer, RtkDrawer } from "./how-to-node-ui";
import {
  HOSTS, MODES, NODE_H, NODE_W, agentModeRows, alignDrag, defaultPositions, edgeLit, edgePath, edgePorts, isOff, loadPositions,
  nodeOff, nodeState, nodeTitle, pipelineGraph, portPoint, savePositions, snapToGrid, versionOf,
} from "./pipeline-model";
import type { Box, EdgeKey, HostAction, HostState, NodeId } from "./pipeline-model";
import type { Alignment, GuideLine } from "./pipeline-model";
import type { ModeState } from "./shell";

/** The rect a cluster frame draws: the band's nodes plus room for its label. */
function clusterBox(ids: NodeId[], boxes: Record<string, Box>): Box | null {
  const members = ids.map((id) => boxes[id]).filter(Boolean);
  if (!members.length) return null;
  const left = Math.min(...members.map((b) => b.x)) - 12;
  const top = Math.min(...members.map((b) => b.y)) - 30;
  const right = Math.max(...members.map((b) => b.x + b.w)) + 12;
  const bottom = Math.max(...members.map((b) => b.y + b.h)) + 12;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** A framed band of nodes; its label is the grip that moves the whole band. */
function ClusterFrame({
  label, ids, boxes, onPointerDown, onPointerMove, onPointerUp,
}: {
  label: string;
  ids: NodeId[];
  boxes: Record<string, Box>;
  onPointerDown: (event: React.PointerEvent<HTMLSpanElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLSpanElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLSpanElement>) => void;
}) {
  const frame = clusterBox(ids, boxes);
  if (!frame) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute rounded-2xl border border-dashed border-line bg-card"
      style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h }}
    >
      <span
        role="button"
        aria-label={`Move the ${label} group`}
        title={`Drag to move the ${label} group`}
        className="mono pointer-events-auto absolute left-2 top-1.5 flex cursor-grab touch-none items-center gap-1 rounded-md border border-line bg-panel px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em] text-dim active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <Icon name="grip-horizontal" className="size-3" />
        {label}
      </span>
    </div>
  );
}

function NodeButton({
  box,
  off,
  selected,
  accent,
  dashed,
  label,
  interactive,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onHover,
  onActivate,
  children,
}: {
  box: Box;
  off?: boolean;
  selected: boolean;
  accent?: boolean;
  dashed?: boolean;
  label: string;
  interactive: boolean;
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onHover: (on: boolean) => void;
  onActivate: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={selected ? "true" : undefined}
      data-canvas-node
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      // Keyboard activation: pointer selection is handled in the drag gesture, so Enter and Space ride onClick.
      onClick={(event) => { if (event.detail === 0 && interactive) onActivate(); }}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      className={cn(
        "howto-node absolute flex cursor-pointer flex-col overflow-hidden rounded-xl border border-line bg-panel text-left outline-none active:cursor-grabbing",
        "hover:border-accent/50 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40",
        dashed && "items-center border-2 border-dashed bg-panel text-dim hover:border-accent/50 hover:text-ink",
        off && "border-2 border-dashed opacity-55",
        accent && "border-accent/40",
        selected && "border-accent ring-2 ring-accent/30",
      )}
    >
      {children}
    </button>
  );
}

/** The status badge every card carries: a dot plus the level, the way a service list reads. */
function NodeBadge({ on, label }: { on: boolean | null; label: string }) {
  const off = isOff(on);
  return (
    <span
      className={cn(
        "mono ml-auto flex shrink-0 items-center gap-1 rounded border px-1 text-[9px] leading-none py-0.5",
        off ? "border-line text-dim" : "border-success/40 text-success",
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", off ? "bg-dim" : "bg-success")} />
      {label}
    </span>
  );
}

export function PipelineCanvas({
  modes,
  hostState,
  onSet,
  onHostAction,
  busy,
  onSaved,
  onAddAgent,
}: {
  modes: ModeState | null;
  hostState: HostState;
  onSet: (node: NodeId, field: string, value: string | boolean, host?: "omp" | "pi" | "pig" | "opencode" | "dsh") => void;
  onHostAction: (node: NodeId, action: HostAction) => void;
  busy: NodeId | null;
  onSaved: () => void;
  onAddAgent: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);
  const [containerH, setContainerH] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const [hovered, setHovered] = useState<NodeId | null>(null);
  const [selected, setSelected] = useState<NodeId | null>(null);
  const [guides, setGuides] = useState<{ vertical: GuideLine[]; horizontal: GuideLine[] } | null>(null);
  const [stored, setStored] = useState<Record<string, Box>>(() => loadPositions() ?? {});
  // Which tools the wrap drawer has integrated: the agent cards wear it, refreshed as a drawer closes.
  const [wrapped, setWrapped] = useState<Record<string, true>>(readStoredWraps);
  useEffect(() => {
    const sync = (): void => {
      setWrapped(readStoredWraps());
    };
    if (selected === null) sync();
    window.addEventListener("tersio:wrap-changed", sync);
    return () => window.removeEventListener("tersio:wrap-changed", sync);
  }, [selected]);
  // The server copy wins over localStorage: the layout belongs to the machine, not to one origin, so a dashboard restart on a new port keeps every node where the user placed it.
  useEffect(() => {
    let cancelled = false;
    void fetchPipelinePositions().then((server) => {
      if (cancelled || !server) return;
      setStored((current) => {
        const merged: Record<string, Box> = { ...current };
        for (const [id, box] of Object.entries(server)) {
          const candidate = box as Box;
          if (typeof candidate?.x === "number" && typeof candidate?.y === "number") merged[id] = candidate;
        }
        return merged;
      });
    });
    return () => { cancelled = true; };
  }, []);
  const panDrag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const nodeDrag = useRef<{ id: NodeId; px: number; py: number; origin: Box; moved: boolean } | null>(null);
  const groupDrag = useRef<{ ids: NodeId[]; px: number; py: number; origins: Record<string, Box>; moved: boolean } | null>(null);
  // Every finger on the canvas, so two of them pinch. Node drags capture their own pointer and never land here.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number; worldX: number; worldY: number } | null>(null);

  // An exported file reads no host list, so every host counts as present there. Only a host Tersio is installed into belongs to the pipeline; a bare harness has no rows to draw.
  const installedKey = HOSTS.filter((h) => hostState.installed[h.id] !== false).map((h) => h.id).join(",");
  const installed = useMemo(() => installedKey ? installedKey.split(",") : [], [installedKey]);
  const { nodes: nodeIds, edges } = useMemo(() => pipelineGraph(installed), [installed]);
  const noAgents = installed.length === 0;
  // Two bands read as groups: the modes Tersio applies, and the harnesses they feed. Headroom rides outside.
  const modeIds = useMemo(() => nodeIds.filter((id) => id !== "prompt" && id !== "output" && id !== "headroom" && !id.startsWith("host-")), [nodeIds]);
  const hostIds = useMemo(() => nodeIds.filter((id) => id.startsWith("host-")), [nodeIds]);

  const boxes = useMemo(() => {
    const defaults = defaultPositions(installed);
    const merged: Record<string, Box> = {};
    for (const id of nodeIds) {
      // The user owns where a node sits; the size is ours, so a stored box never pins a stale height.
      merged[id] = stored[id] ? { ...defaults[id], x: stored[id].x, y: stored[id].y } : defaults[id] ?? { x: 40, y: 296, w: NODE_W, h: NODE_H };
    }
    return merged;
  }, [nodeIds, stored, installed]);

  const groupBoxes = useMemo(
    () => [clusterBox(modeIds, boxes), clusterBox(hostIds, boxes)].filter((b): b is Box => b !== null),
    [modeIds, hostIds, boxes],
  );

  // The add-agent node rides the canvas center when no agent exists yet, so the empty state reads as an invitation instead of an empty grid.
  const addBox = useMemo<Box>(() => {
    const xs = nodeIds.map((id) => boxes[id]);
    const minX = Math.min(...xs.map((b) => b.x));
    const maxX = Math.max(...xs.map((b) => b.x + b.w));
    const maxY = Math.max(...xs.map((b) => b.y + b.h));
    return { x: snapToGrid((minX + maxX) / 2 - NODE_W / 2), y: snapToGrid(maxY + 72), w: NODE_W, h: NODE_H + 14 };
  }, [nodeIds, boxes]);

  // Fit the whole graph once per host set: the user's own pan and zoom take over from there.
  const fittedKey = useRef("");
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el || containerW === 0 || containerH === 0) return;
    const key = `${installedKey}`;
    if (fittedKey.current === key) return;
    fittedKey.current = key;
    const all = noAgents ? [...nodeIds.map((id) => boxes[id]), addBox] : nodeIds.map((id) => boxes[id]);
    const minX = Math.min(...all.map((b) => b.x)) - 12;
    const minY = Math.min(...all.map((b) => b.y)) - 30;
    const maxX = Math.max(...all.map((b) => b.x + b.w));
    const maxY = Math.max(...all.map((b) => b.y + b.h));
    const worldW = maxX - minX + 48;
    const worldH = maxY - minY + 48;
    // The intro floats over the canvas, so the fit centers in the space below it.
    const narrow = containerW < 640;
    const topInset = narrow ? 48 : 104;
    const fit = Math.min(1, (containerW - 24) / worldW, (containerH - topInset - 24) / worldH);
    // A phone cannot read a whole-graph fit, so it opens at a readable scale anchored to the top-left corner; pan and pinch cover the rest.
    const scaleToUse = narrow ? Math.max(fit, 0.9) : fit;
    setZoom(scaleToUse);
    setPan(narrow
      ? { x: 16 - minX * scaleToUse, y: topInset - minY * scaleToUse }
      : {
        x: (containerW - worldW * fit) / 2 - minX * fit,
        y: topInset + (containerH - topInset - worldH * fit) / 2 - minY * fit,
      });
  }, [containerW, containerH, installedKey, nodeIds, boxes, addBox, noAgents]);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = (): void => { setContainerW(el.clientWidth); setContainerH(el.clientHeight); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // One soft entrance for the node cards; drag and edges take over from there.
  useGSAP(() => {
    if (!boxRef.current) return;
    const nodes = boxRef.current.querySelectorAll("[data-canvas-node]");
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      gsap.set(nodes, { opacity: 1, y: 0, scale: 1 });
      return;
    }
    gsap.fromTo(
      nodes,
      { opacity: 0, y: 10, scale: 0.96 },
      { opacity: 1, y: 0, scale: 1, duration: 0.4, ease: "power3.out", stagger: 0.045, clearProps: "transform" },
    );
  }, { scope: boxRef, dependencies: [installedKey] });

  const scale = zoom;

  const lit = (key: EdgeKey): boolean | null => edgeLit(key, modes, hostState);

  const openNode = (id: NodeId): void => setSelected(id);

  const moveNode = (id: NodeId, box: Box): void => {
    setStored((current) => ({ ...current, [id]: box }));
  };

  // One writer for both stores: localStorage is the instant cache, the server copy is what survives a dashboard restart on a new port.
  const persist = (positions: Record<string, Box>): void => {
    savePositions(positions);
    void postPipelinePositions(positions);
  };

  const onNodePointerDown = (id: NodeId) => (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId);
    event.stopPropagation();
    nodeDrag.current = { id, px: event.clientX, py: event.clientY, origin: boxes[id], moved: false };
  };
  const onNodePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = nodeDrag.current;
    if (!drag) return;
    const dx = event.clientX - drag.px;
    const dy = event.clientY - drag.py;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect) return;
    const gridded = {
      ...drag.origin,
      x: Math.max(8, snapToGrid(drag.origin.x + dx / scale)),
      y: Math.max(8, snapToGrid(drag.origin.y + dy / scale)),
    };
    // Alignment wins over the grid: a near match with another node's edge or center takes the exact value.
    const aligned: Alignment = alignDrag(drag.id, gridded, Object.entries(boxes));
    moveNode(drag.id, aligned.box);
    setGuides({ vertical: aligned.vertical, horizontal: aligned.horizontal });
  };
  const onNodePointerUp = (id: NodeId) => (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = nodeDrag.current;
    nodeDrag.current = null;
    setGuides(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag && drag.moved) {
      setStored((current) => {
        const next = { ...current };
        persist(next);
        return next;
      });
      return;
    }
    if (interactiveNode(id)) openNode(id);
  };

  // The cluster label drags every node in its band, so a group keeps its shape.
  const onGroupPointerDown = (ids: NodeId[]) => (event: React.PointerEvent<HTMLSpanElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId);
    event.stopPropagation();
    const origins: Record<string, Box> = {};
    for (const id of ids) origins[id] = boxes[id];
    groupDrag.current = { ids, px: event.clientX, py: event.clientY, origins, moved: false };
  };
  const onGroupPointerMove = (event: React.PointerEvent<HTMLSpanElement>): void => {
    const drag = groupDrag.current;
    if (!drag) return;
    const dx = event.clientX - drag.px;
    const dy = event.clientY - drag.py;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    const shifted: Record<string, Box> = {};
    for (const id of drag.ids) {
      const origin = drag.origins[id];
      shifted[id] = {
        ...origin,
        x: Math.max(8, snapToGrid(origin.x + dx / scale)),
        y: Math.max(8, snapToGrid(origin.y + dy / scale)),
      };
    }
    setStored((current) => ({ ...current, ...shifted }));
  };
  const onGroupPointerUp = (event: React.PointerEvent<HTMLSpanElement>): void => {
    const drag = groupDrag.current;
    groupDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag?.moved) {
      setStored((current) => {
        const next = { ...current };
        persist(next);
        return next;
      });
    }
  };

  // The prompt node starts the turn; it moves but opens nothing.
  const interactiveNode = (id: NodeId): boolean => id !== "prompt";

  const resetLayout = (): void => {
    const defaults = defaultPositions(installed);
    setStored(defaults);
    persist(defaults);
    // The reset also restores the default view: clearing the key lets the fit run again on the fresh boxes.
    fittedKey.current = "";
  };

  const zoomBy = (factor: number): void => {
    setZoom((z) => Math.min(2.4, Math.max(0.4, Number((z * factor).toFixed(2)))));
  };

  const isNodeOff = (id: NodeId): boolean => nodeOff(id, modes, hostState);
  const focus = hovered ?? selected;
  const zoomed = zoom !== 1 || pan.x !== 0 || pan.y !== 0;

  const body = (id: NodeId): React.ReactNode => {
    const header = "flex items-center gap-1.5 border-b border-line bg-track/30 px-3 py-1.5";
    if (id === "prompt") {
      return (
        <>
          <span className={header}>
            <Icon name="message-square" className="size-3.5 shrink-0 text-dim" />
            <span className="text-[12px] font-semibold">Prompt</span>
          </span>
          <span className="mono flex flex-1 items-center px-3 py-1.5 text-[10px] text-dim">your message starts the turn</span>
        </>
      );
    }
    if (id === "output") {
      return (
        <>
          <span className={header}>
            <Icon name="arrow-right" className="size-3.5 shrink-0 text-dim" />
            <span className="text-[12px] font-semibold">Output</span>
            <NodeBadge on={true} label="on" />
          </span>
          <span className="mono flex flex-1 items-center px-3 py-1.5 text-[10px] text-dim">the turn's result</span>
        </>
      );
    }
    if (id.startsWith("host-")) {
      const host = HOSTS.find((h) => `host-${h.id}` === id);
      if (!host) return null;
      const off = isOff(lit(host.id));
      return (
        <>
          <span className={cn(header, "gap-2")}>
            <AgentLogo host={host.id} className="size-4 shrink-0" />
            <span className="truncate text-[13px] font-semibold">{host.label}</span>
            {off
              ? <NodeBadge on={false} label="not installed" />
              : wrapped[host.id]
                ? <NodeBadge on={true} label="🍃 wrapped" />
                : <NodeBadge on={true} label={versionOf(hostState.versions[host.id]) ?? "installed"} />}
          </span>
          {!off ? (
            <span className="grid flex-1 grid-cols-2 content-center gap-x-3 gap-y-1 px-3.5 py-2.5">
              {agentModeRows(host.id, modes).map((row) => (
                <span key={row.key} className={cn("mono flex items-center gap-1.5 text-[10px]", row.on ? "text-ink" : "text-dim")}>
                  <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", row.on ? "bg-accent" : "bg-line")} />
                  {row.glyph} {row.label}
                </span>
              ))}
            </span>
          ) : (
            <span className="mono flex flex-1 items-center px-3 py-1.5 text-[10px] text-dim">install to join the pipeline</span>
          )}
        </>
      );
    }
    const mode = MODES.find((m) => m.key === id);
    if (mode) {
      const off = isNodeOff(id);
      return (
        <>
          <span className={header}>
            <span aria-hidden="true" className="text-[12px]">{mode.glyph}</span>
            <span className="text-[13px] font-semibold">{mode.name}</span>
            <NodeBadge on={!off} label={off ? "off" : nodeState(id, modes, hostState).label} />
          </span>
          <span className="mono flex flex-1 items-start px-3 py-1.5 text-[10px] leading-snug text-dim">{mode.role} · {mode.note}</span>
        </>
      );
    }
    return null;
  };

  // The SVG world spans the laid-out graph; every connector reads its two nodes' current boxes, so a
  // drag replumbs the flow live.
  const worldBoxes = Object.values(boxes);
  const worldW = Math.max(...worldBoxes.map((b) => b.x + b.w), addBox.x + addBox.w) + 48;
  const worldH = Math.max(...worldBoxes.map((b) => b.y + b.h), addBox.y + addBox.h) + 48;

  return (
    <div className="relative h-full min-w-0">
      <div
        ref={boxRef}
        role="group"
        aria-label="Pipeline canvas"
        className={cn(
          "relative h-full touch-none overflow-hidden select-none",
          "[background-image:radial-gradient(circle_at_1px_1px,var(--line)_1px,transparent_0)] [background-size:16px_16px]",
        )}
        style={{ cursor: panning ? "grabbing" : "grab" }}
        onPointerDown={(event) => {
          const target = event.target as HTMLElement;
          if (target.closest("button")) return;
          if (selected) setSelected(null);
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          event.currentTarget.setPointerCapture(event.pointerId);
          if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()];
            const rect = event.currentTarget.getBoundingClientRect();
            const midX = (a.x + b.x) / 2 - rect.left;
            const midY = (a.y + b.y) / 2 - rect.top;
            pinch.current = {
              dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
              zoom,
              worldX: (midX - pan.x) / zoom,
              worldY: (midY - pan.y) / zoom,
            };
            panDrag.current = null;
            setPanning(false);
            return;
          }
          if (pointers.current.size !== 1) return;
          panDrag.current = { x: event.clientX, y: event.clientY, px: pan.x, py: pan.y };
          setPanning(true);
        }}
        onPointerMove={(event) => {
          if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          const pinchState = pinch.current;
          if (pinchState && pointers.current.size >= 2) {
            const [a, b] = [...pointers.current.values()];
            const rect = event.currentTarget.getBoundingClientRect();
            const midX = (a.x + b.x) / 2 - rect.left;
            const midY = (a.y + b.y) / 2 - rect.top;
            const factor = (Math.hypot(a.x - b.x, a.y - b.y) || 1) / pinchState.dist;
            const next = Math.min(2.4, Math.max(0.4, pinchState.zoom * factor));
            setZoom(next);
            setPan({ x: midX - pinchState.worldX * next, y: midY - pinchState.worldY * next });
            return;
          }
          const start = panDrag.current;
          if (!start) return;
          setPan({ x: start.px + (event.clientX - start.x), y: start.py + (event.clientY - start.y) });
        }}
        onPointerUp={(event) => {
          pointers.current.delete(event.pointerId);
          if (pointers.current.size < 2) pinch.current = null;
          if (pointers.current.size === 0) { panDrag.current = null; setPanning(false); }
        }}
        onPointerCancel={(event) => {
          pointers.current.delete(event.pointerId);
          if (pointers.current.size < 2) pinch.current = null;
          panDrag.current = null;
          setPanning(false);
        }}
        onWheel={(event) => {
          // The canvas owns the wheel: a bare wheel does nothing, and the page behind it never scrolls.
          event.preventDefault();
          if (!event.ctrlKey && !event.metaKey) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const px = event.clientX - rect.left;
          const py = event.clientY - rect.top;
          const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
          const next = Math.min(2.4, Math.max(0.4, zoom * factor));
          const ratio = next / zoom;
          setPan((p) => ({ x: px - (px - p.x) * ratio, y: py - (py - p.y) * ratio }));
          setZoom(next);
        }}
        onDragStart={(event) => event.preventDefault()}
      >
        <div
          className="absolute origin-top-left"
          style={{ width: worldW, height: worldH, transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}
        >
          <ClusterFrame
            label="Default Feedback"
            ids={modeIds}
            boxes={boxes}
            onPointerDown={onGroupPointerDown(modeIds)}
            onPointerMove={onGroupPointerMove}
            onPointerUp={onGroupPointerUp}
          />
          <ClusterFrame
            label="AI Agent Harness"
            ids={hostIds}
            boxes={boxes}
            onPointerDown={onGroupPointerDown(hostIds)}
            onPointerMove={onGroupPointerMove}
            onPointerUp={onGroupPointerUp}
          />
          <svg
            className="pointer-events-none absolute inset-0"
            width={worldW}
            height={worldH}
            viewBox={`0 0 ${worldW} ${worldH}`}
            aria-hidden="true"
          >
            <g fill="none" strokeLinejoin="round" strokeLinecap="round">
              {edges.map((edge) => {
                const from = boxes[edge.from];
                const to = boxes[edge.to];
                if (!from || !to) return null;
                // The path bows around any node the straight run would cross.
                const others = Object.entries(boxes).filter(([id]) => id !== edge.from && id !== edge.to).map(([, box]) => box);
                const ports = edgePorts(from, to);
                const sp = portPoint(from, ports.from);
                const tp = portPoint(to, ports.to);
                const off = isOff(lit(edge.from as EdgeKey));
                const touchesFocus = focus === null || focus === edge.from || focus === edge.to;
                return (
                  <g key={`${edge.from}->${edge.to}`}>
                    <path
                      d={edgePath(from, to, others, groupBoxes)}
                      className="howto-link"
                      stroke="var(--dim)"
                      strokeWidth={2.5}
                      strokeOpacity={touchesFocus ? (off ? 0.6 : 1) : 0.35}
                    />
                    {/* Every connector is a network cable; the moving dash runs only where the source is on. */}
                    <path
                      d={edgePath(from, to, others, groupBoxes)}
                      className="flow-line howto-link"
                      stroke="var(--accent)"
                      strokeWidth={1.5}
                      data-active={!off}
                      strokeOpacity={off ? 0.5 : touchesFocus ? 0.8 : 0.3}
                    />
                    <circle cx={sp[0]} cy={sp[1]} r={4} className="fill-panel stroke-[var(--line)]" strokeWidth={1.5} />
                    <circle cx={tp[0]} cy={tp[1]} r={4} className="fill-panel stroke-[var(--line)]" strokeWidth={1.5} />
                  </g>
                );
              })}
            </g>
          </svg>

          {guides ? (
            [...guides.vertical.map((line) => (
              <div key={`vg${line.at}`} aria-hidden="true" className="pointer-events-none absolute w-px bg-accent/70" style={{ left: line.at, top: line.from, height: line.to - line.from }} />
            )), ...guides.horizontal.map((line) => (
              <div key={`hg${line.at}`} aria-hidden="true" className="pointer-events-none absolute h-px bg-accent/70" style={{ top: line.at, left: line.from, width: line.to - line.from }} />
            ))]
          ) : null}

          {nodeIds.map((id) => {
            const box = boxes[id];
            const state = nodeState(id, modes, hostState);
            return (
              <NodeButton
                key={id}
                box={box}
                off={isNodeOff(id)}
                selected={selected === id}
                accent={id === "headroom"}
                interactive={interactiveNode(id)}
                label={`${nodeTitle(id)}, ${state.label}`.replace(/, $/, "")}
                onPointerDown={onNodePointerDown(id)}
                onActivate={() => openNode(id)}
                onPointerMove={onNodePointerMove}
                onPointerUp={onNodePointerUp(id)}
                onHover={(on) => setHovered(on ? id : null)}
              >
                {body(id)}
              </NodeButton>
            );
          })}

          {noAgents ? (
            <div style={{ position: "absolute", left: addBox.x, top: addBox.y, width: addBox.w }}>
              <button
                type="button"
                data-canvas-node
                onClick={onAddAgent}
                aria-label="Add your first agent"
                className="howto-node flex w-full cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed border-line bg-panel px-3 py-4 text-center outline-none transition-colors hover:border-accent/50 hover:text-ink focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <Icon name="plus" className="size-5 text-dim" />
                <span className="text-[13px] font-semibold">Add agent</span>
                <span className="mono text-[10px] leading-snug text-dim">no agent on this machine yet — install one to build the pipeline</span>
              </button>
            </div>
          ) : null}
        </div>

        <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded-lg border border-line bg-panel/90 p-1 backdrop-blur">
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
          <button
            type="button"
            onClick={resetLayout}
            aria-label="Reset the layout and fit the default view"
            title="Reset the layout and fit the default view"
            className="mono flex h-6 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[10px] text-dim hover:bg-track hover:text-ink"
          >
            <Icon name="rotate-ccw" className="size-3.5" />
            Default layout
          </button>
          {zoomed ? (
            <button
              type="button"
              onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
              aria-label="Reset the zoom and pan"
              title="Reset the zoom and pan"
              className="mono flex h-6 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[10px] text-dim hover:bg-track hover:text-ink"
            >
              <Icon name="maximize" className="size-3.5" />
              Reset view
            </button>
          ) : null}
        </div>
      </div>

      {selected === "headroom" ? (
        <HeadroomDrawer
          open
          onOpenChange={(open) => { if (!open) setSelected(null); }}
          modes={modes}
          busy={busy}
          onSet={onSet}
          onSaved={onSaved}
        />
      ) : null}
      {selected?.startsWith("host-") ? (
        <HostDrawer
          node={selected}
          open
          onOpenChange={(open) => { if (!open) setSelected(null); }}
          modes={modes}
          hostState={hostState}
          busy={busy}
          onSet={onSet}
          onHostAction={onHostAction}
          onSaved={onSaved}
        />
      ) : null}
      {selected === "rtk" ? (
        <RtkDrawer
          open
          onOpenChange={(open) => { if (!open) setSelected(null); }}
          modes={modes}
          busy={busy}
          onSet={onSet}
          onSaved={onSaved}
        />
      ) : null}
      {selected !== null && selected !== "headroom" && selected !== "rtk" && !selected.startsWith("host-") && selected !== "prompt" && selected !== "output" ? (
        <ModeDrawer
          node={selected}
          open
          onOpenChange={(open) => { if (!open) setSelected(null); }}
          modes={modes}
          hostState={hostState}
          busy={busy}
          onSet={onSet}
          onHostAction={onHostAction}
          onSaved={onSaved}
        />
      ) : null}
    </div>
  );
}

/** While the host list and modes are out, the canvas holds one quiet line instead of fake nodes. */
export function PipelineSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the pipeline" className="grid h-full place-items-center">
      <div className="flex items-center gap-2 text-dim">
        <Spinner className="size-4 text-accent" />
        <span className="mono text-[11px]">reading what this machine has on…</span>
      </div>
    </div>
  );
}