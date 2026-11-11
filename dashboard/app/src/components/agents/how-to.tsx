// Quick start: the pipeline as one canvas, drawn the way a workflow tool lays it out. Everything here mirrors docs/ARCHITECTURE.md: the hosts, the block order, and the turn it produces.
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/icon"
import { usePending } from "@/hooks/use-pending"
import { isFileExport } from "@/lib/data"
import { fetchHealth, fetchRoutes } from "@/lib/data"
import type { ModeState } from "./shell"
import { useToast } from "../toaster"
import { AddAgentDialog } from "./how-to-node-ui"
import { PipelineCanvas, PipelineSkeleton } from "./how-to-canvas"
import { quickStartLast, readHosts, versionOf } from "./pipeline-model"
import type { HostAction, HostState, NodeId } from "./pipeline-model"

export function HowToPage({
  modes,
  onModesChanged,
}: {
  modes: ModeState | null
  onModesChanged: () => void
}) {
  const toast = useToast()
  const [hostState, setHostState] = useState<HostState>(
    () =>
      quickStartLast.hostState ?? { installed: {}, present: {}, versions: {}, modeVersions: {} },
  )
  const [headroomRoutes, setHeadroomRoutes] = useState<Record<string, boolean>>(
    () => quickStartLast.routes ?? {},
  )
  const [busy, setBusy] = useState<NodeId | null>(null)
  const [hostsLoaded, setHostsLoaded] = useState(() => quickStartLast.hostState !== null)
  // The last read stands in while this page re-asks, so returning here never flashes a skeleton.
  const liveModes = modes ?? quickStartLast.modes
  // An exported file has no server: /settings never answers, so the documented every-node-lit reading holds there instead of a permanent skeleton.
  const pipelinePending = usePending(!hostsLoaded || (!isFileExport() && liveModes === null))
  // One picker serves both entries: the canvas's centered empty-state node, and the header button.
  const [addOpen, setAddOpen] = useState(false)

  useEffect(() => {
    const readRoutes = (): void => {
      void fetchRoutes().then((state) => {
        if (!state) return
        setHeadroomRoutes(
          Object.fromEntries(state.targets.map((target) => [target.name, target.routed])),
        )
      })
    }
    void readHosts()
      .then((rows) => {
        if (rows)
          setHostState((s) => ({
            ...s,
            installed: Object.fromEntries(rows.map((row) => [row.id, row.installed])),
          }))
      })
      .finally(() => setHostsLoaded(true))
    void fetchHealth().then((report) => {
      if (!report) return
      const versions = {
        omp: versionOf(report.omp),
        pi: versionOf(report.pi),
        pig: versionOf(report.pig),
        opencode: versionOf(report.opencode),
        dsh: versionOf(report.dsh),
        codex: versionOf(report.codex),
      }
      // Presence is the resolved binary, not the probe: a probe can fail while the harness is there.
      const paths = {
        omp: report.ompPath,
        pi: report.piPath,
        pig: report.pigPath,
        opencode: report.opencodePath,
        dsh: report.dshPath,
        codex: report.codexPath,
      }
      setHostState((s) => ({
        ...s,
        versions,
        present: Object.fromEntries(Object.entries(paths).map(([id, p]) => [id, Boolean(p)])),
        modeVersions: report.modeVersions ?? {},
      }))
    })
    readRoutes()
    window.addEventListener("tersio:wrap-changed", readRoutes)
    return () => window.removeEventListener("tersio:wrap-changed", readRoutes)
  }, [])

  // Keep the last read for the next mount, so leaving Quick start and coming back paints data.
  useEffect(() => {
    quickStartLast.hostState = hostState
  }, [hostState])
  useEffect(() => {
    quickStartLast.routes = headroomRoutes
  }, [headroomRoutes])
  useEffect(() => {
    if (modes) quickStartLast.modes = modes
  }, [modes])

  // A child started before this page unmounted still runs on the server, so the row keeps its spinner.
  useEffect(() => {
    void fetch("/api/hosts/action")
      .then((r) => (r.ok ? r.json() : null))
      .then((jobs: Array<{ host: string; action: HostAction; code: number | null }> | null) => {
        const running = jobs?.find((job) => job.code === null)
        if (!running) return
        setBusy(`host-${running.host}` as NodeId)
        watchHostJob(running.host, running.action)
      })
      .catch(() => {
        /* the first read already covers an unreachable server */
      })
  }, [])

  const save = (
    node: NodeId,
    field: string,
    value: string | boolean,
    host?: "omp" | "pi" | "pig" | "opencode" | "dsh" | "codex" | "claude",
  ): void => {
    setBusy(node)
    void fetch("/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value, ...(host ? { host } : {}) }),
    })
      .then((r) => r.json())
      .then((d: { ok?: boolean; error?: string } | null) => {
        if (d?.ok) {
          toast(
            `${node} ${typeof value === "boolean" ? (value ? "on" : "off") : value}`,
            "Applies to new sessions.",
            "check",
          )
          onModesChanged()
        } else {
          toast(
            "Could not save",
            d?.error ?? "The server refused the change.",
            "circle-exclamation-point",
          )
        }
      })
      .catch(() =>
        toast("Could not save", "The dashboard server did not answer.", "circle-exclamation-point"),
      )
      .finally(() => setBusy(null))
  }

  // The CLI runs install, uninstall, and update in its own process, so the page asks the server whether that child is still running instead of guessing from the tree on disk.
  /** Re-read what a finished job changed, so the row shows the new version without a reload. */
  const refreshAfterJob = (host: string): void => {
    void readHosts().then((rows) => {
      if (rows)
        setHostState((s) => ({
          ...s,
          installed: Object.fromEntries(rows.map((row) => [row.id, row.installed])),
        }))
    })
    void fetchHealth().then((report) => {
      if (!report) return
      const version = versionOf(report[host as "omp" | "pi" | "pig" | "opencode" | "codex"])
      if (version) setHostState((s) => ({ ...s, versions: { ...s.versions, [host]: version } }))
    })
    void fetchRoutes().then((state) => {
      if (!state) return
      setHeadroomRoutes(
        Object.fromEntries(state.targets.map((target) => [target.name, target.routed])),
      )
    })
  }

  // One watcher for a running job, so a page that unmounted mid-install can pick the same job back up.
  const watchHostJob = (host: string, action: HostAction): void => {
    const started = Date.now()
    const timer = window.setInterval(() => {
      void fetch("/api/hosts/action")
        .then((r) => (r.ok ? r.json() : null))
        .then((jobs: Array<{ host: string; action: string; code: number | null }> | null) => {
          const job = jobs?.find(
            (entry) => entry.host === host && entry.action === action && entry.code !== null,
          )
          // A child that never reports back still has to hand the menu back.
          if (!job && Date.now() - started < 120_000) return
          window.clearInterval(timer)
          setBusy(null)
          refreshAfterJob(host)
          if (job?.code === 0)
            toast(`${host}: ${action} done`, "The agent list is up to date.", "check")
          else if (job)
            toast(
              `${host}: ${action} failed`,
              `The command exited with code ${job.code}.`,
              "circle-exclamation-point",
            )
          else
            toast(
              `${host}: ${action} is still running`,
              "Reload the page in a moment to see the result.",
              "circle-exclamation-point",
            )
        })
        .catch(() => {
          /* the next tick tries again */
        })
    }, 1000)
  }

  // The CLI runs install, uninstall, and update in its own process, so the page asks the server whether that child is still running instead of guessing from the tree on disk.
  const hostAction = (node: NodeId, action: HostAction): void => {
    const host = node.slice("host-".length)
    setBusy(node)
    void fetch("/api/hosts/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host, action }),
    })
      .then((r) => r.json())
      .then((d: { ok?: boolean; error?: string } | null) => {
        if (!d?.ok) {
          toast(
            `Could not ${action} ${host}`,
            d?.error ?? "The server refused the request.",
            "circle-exclamation-point",
          )
          setBusy(null)
          return
        }
        toast(`${host}: ${action} started`, "It runs in the background.", "check")
        watchHostJob(host, action)
      })
      .catch(() => {
        toast(
          `Could not ${action} ${host}`,
          "The dashboard server did not answer. Restart it to load the host actions.",
          "circle-exclamation-point",
        )
        setBusy(null)
      })
  }

  return (
    // Fullscreen like a workflow tool: the canvas is the page, the chrome floats on top of it.
    <div className="relative h-[calc(100dvh-4.25rem)] w-full overflow-hidden">
      {pipelinePending ? null : (
        <div className="pointer-events-none absolute left-4 top-3 z-10 max-w-xl">
          <h1 className="font-display text-lg leading-tight font-bold tracking-tight">
            Quick start
          </h1>
          <p className="mono mt-1 hidden text-[11px] leading-snug text-dim max-sm:block">
            drag to pan · pinch to zoom · tap a node for options
          </p>
          <p className="mono mt-1 text-[11px] leading-snug text-dim max-sm:hidden">
            One package, six agents, five modes — the path a turn takes from your prompt to the
            reply. Drag the nodes, and the flow follows; click one for its options. A dimmed node is
            off or uninstalled.
          </p>
        </div>
      )}
      <div className="h-full">
        {pipelinePending ? (
          <PipelineSkeleton />
        ) : (
          <PipelineCanvas
            modes={liveModes}
            hostState={hostState}
            loaded={!pipelinePending}
            headroomRoutes={headroomRoutes}
            onSet={save}
            onHostAction={hostAction}
            busy={busy}
            onSaved={onModesChanged}
            onAddAgent={() => setAddOpen(true)}
          />
        )}
      </div>
      {!pipelinePending ? (
        <Button
          size="sm"
          variant="outline"
          className="absolute top-3 right-4 z-10 gap-1.5 bg-panel/90 backdrop-blur"
          onClick={() => setAddOpen(true)}
        >
          <Icon name="users" className="size-3.5" />
          Add Agent
        </Button>
      ) : null}

      <AddAgentDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        hostState={hostState}
        loaded={!pipelinePending}
        busy={busy}
        onInstall={(host) => hostAction(`host-${host}` as NodeId, "install")}
      />
    </div>
  )
}
