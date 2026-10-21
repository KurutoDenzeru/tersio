// Every page of the agent-stats dashboard, one hash route each.
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "@/components/theme-provider";
import { isFileExport, useFx, useAgentData } from "@/lib/data";
import type { AgentRequestRow, AgentView } from "@/lib/data";
import { useDevMode } from "@/lib/dev-mode";
import { useHashRoute } from "@/lib/route";
import { useUpdate } from "@/lib/update-watch";
import { EmptyState } from "@/components/common";
import { Page, PageHeader, PageSkeleton } from "@/components/charts";
import { Shell, useShortcuts } from "./components/agents/shell";
import type { ModeState } from "./components/agents/shell";
import { navItem } from "./components/agents/nav";
import { AgentRequestDrawer } from "./components/agents/drawer";
import { SessionTrace } from "./components/agents/session";
import { OverviewPage } from "./components/agents/overview";
import { ModelsPage } from "./components/agents/models";
import { ProvidersPage } from "./components/agents/providers";
import { CostsPage } from "./components/agents/costs";
import { CarbonPage } from "./components/agents/carbon";
import { RequestsPage } from "./components/agents/requests";
import { ErrorsPage } from "./components/agents/errors";
import { TracesPage } from "./components/agents/traces";
import { ToolsPage } from "./components/agents/tools";
import { ProjectsPage } from "./components/agents/projects";
import { UpstreamPage } from "./components/agents/upstream";
import { SettingsDialog } from "@/components/dialogs";
import { ShareDialog } from "@/components/agents/share-dialog";
import { ToasterProvider } from "@/components/toaster";

function useDataThemeAttr(): void {
  const { theme } = useTheme();
  useEffect(() => {
    const root = document.documentElement;
    const apply = (): void => {
      const stored = (() => {
        try {
          return localStorage.getItem("tersio-theme");
        } catch {
          return null;
        }
      })();
      const v = stored ?? theme;
      if (v === "light" || v === "dark") root.setAttribute("data-theme", v);
      else root.removeAttribute("data-theme");
    };
    apply();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    window.addEventListener("storage", apply);
    return () => {
      mq.removeEventListener("change", apply);
      window.removeEventListener("storage", apply);
    };
  }, [theme]);
}

// data-reveal flips to "in" once a card enters the viewport.
function useReveal(): void {
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const reveal = (el: Element): void => {
      el.classList.add("in");
      if (el.hasAttribute("data-reveal")) el.setAttribute("data-reveal", "in");
    };
    if (reduce || !("IntersectionObserver" in window)) {
      document.querySelectorAll(".rise, [data-reveal]").forEach(reveal);
      return;
    }
    const seen = new WeakSet<Element>();
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting && !seen.has(e.target)) {
            seen.add(e.target);
            reveal(e.target);
            io.unobserve(e.target);
          }
        });
      },
      // Any visible pixel reveals: a card taller than the viewport can never reach a ratio threshold.
      { threshold: 0 },
    );
    const watch = (): void => {
      document.querySelectorAll(".rise, [data-reveal]").forEach((el) => {
        if (!seen.has(el)) io.observe(el);
      });
    };
    watch();
    const mo = new MutationObserver(watch);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, []);
}

/** The session-start modes the navbar banner names, from GET /settings; null for a file export. */
function useModeState(): readonly [ModeState | null, () => void] {
  const [modes, setModes] = useState<ModeState | null>(null);
  const alive = useRef(true);
  useEffect(() => () => {
    alive.current = false;
  }, []);

  const load = useCallback(() => {
    if (isFileExport() || typeof fetch !== "function") return;
    fetch("/settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((d: Partial<ModeState> | null) => {
        if (!alive.current || !d || typeof d.comboDefault !== "string") return;
        setModes({
          comboDefault: d.comboDefault,
          comboLevel: typeof d.comboLevel === "string" ? d.comboLevel : d.comboDefault,
          cavemanDefault: typeof d.cavemanDefault === "string" ? d.cavemanDefault : "off",
          rtkDefault: d.rtkDefault === true,
          ponytailDefault: typeof d.ponytailDefault === "string" ? d.ponytailDefault : "off",
          pstackDefault: typeof d.pstackDefault === "string" ? d.pstackDefault : "off",
        });
      })
      .catch(() => { /* no server: the banner stays hidden */ });
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  return [modes, load] as const;
}

function Dashboard() {
  useDataThemeAttr();
  useReveal();
  const { fx, money, applyCurrency } = useFx();
  const { section: route, range, session, setSection, setRange, setSession } = useHashRoute();
  // Upstream is a developer surface: the About switch hides it, and a bookmarked route lands on Overview.
  const dev = useDevMode();
  const section = route === "upstream" && !dev ? "overview" : route;
  // The smallest view still answers "is there an agent database".
  // Upstream is not an agent view: the scorecard has its own store, and the hook keeps the shell uniform.
  const view: AgentView = section === "upstream" ? "all" : section;
  // Only the request log pages through the range; every other view wants the newest rows.
  const [requestOffset, setRequestOffset] = useState(0);
  const { agent, loading, stale } = useAgentData(range, view, section === "requests" ? requestOffset : 0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The watcher runs on every page, so an available release is offered wherever the operator is.
  const update = useUpdate();
  const [shareOpen, setShareOpen] = useState(false);
  const [request, setRequest] = useState<AgentRequestRow | null>(null);
  // The session-start modes the navbar's banner names, reloaded when Settings closes.
  const [modes, reloadModes] = useModeState();

  useShortcuts({ onRange: setRange, onSection: setSection });
  // A new range renumbers the log, so a page held across the switch would point at different rows.
  useEffect(() => {
    setRequestOffset(0);
  }, [range]);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [section, session]);

  const openRequest = useCallback((row: AgentRequestRow) => setRequest(row), []);
  const closeRequest = useCallback(() => setRequest(null), []);
  const agentAvailable = agent?.available ?? false;
  const title = navItem(section).label;

  const page = (): React.ReactNode => {
    if (section === "traces" && session) {
      return <SessionTrace key={session} sessionFile={session} money={money} onClose={() => setSession(null)} />;
    }
    if (loading && !agent) return <PageSkeleton section={section} />;
    if (!agent || !agent.available) {
      // A fetch that never answered JSON means the page is newer than the server process, not a missing database.
      if (stale) {
        return (
          <Page>
            <PageHeader title={title} description="This page could not read the dashboard server." />
            <EmptyState
              icon="refresh-cw"
              title="Restart the dashboard"
              desc="The page is newer than the running server, so the data route did not answer. Stop the process and start `tersio dashboard` again; the databases are fine."
            />
          </Page>
        );
      }
      return (
        <Page>
          <PageHeader title={title} description="This page reads the agent databases." />
          <EmptyState
            icon="database-zap"
            title="No agent stats database"
            desc="These pages read the agent statistics databases, which one coding agent writes as it runs."
          />
        </Page>
      );
    }
    switch (section) {
      case "overview":
        return <OverviewPage agent={agent} money={money} onOpenRequest={openRequest} />;
      case "models":
        return <ModelsPage agent={agent} money={money} />;
      case "providers":
        return <ProvidersPage agent={agent} money={money} />;
      case "costs":
        return <CostsPage agent={agent} money={money} />;
      case "carbon":
        return <CarbonPage agent={agent} />;
      case "requests":
        return (
          <RequestsPage
            agent={agent}
            money={money}
            offset={requestOffset}
            onOffset={setRequestOffset}
            onOpenRequest={openRequest}
          />
        );
      case "errors":
        return <ErrorsPage agent={agent} money={money} onOpenRequest={openRequest} />;
      case "traces":
        return <TracesPage agent={agent} money={money} onOpenSession={setSession} />;
      case "tools":
        return <ToolsPage agent={agent} money={money} />;
      case "projects":
        return <ProjectsPage agent={agent} money={money} />;
      case "upstream":
        return <UpstreamPage />;
      default:
        return null;
    }
  };

  return (
    <>
      <Shell
        section={section}
        onSection={setSection}
        range={range}
        onRange={setRange}
        modes={modes}
        agentAvailable={agentAvailable}
        onSettings={() => setSettingsOpen(true)}
        onShare={() => setShareOpen(true)}
      >
        {/* A route change remounts the page, so the jump animation replays on every navigation. */}
        <Fragment key={`${section}:${session ?? ""}:${range}`}>{page()}</Fragment>
      </Shell>
      {request && (
        <AgentRequestDrawer
          row={request}
          money={money}
          onClose={closeRequest}
          onOpenSession={(file) => {
            closeRequest();
            setSession(file);
          }}
        />
      )}
      <SettingsDialog
        open={settingsOpen}
        update={update}
        onClose={() => {
          setSettingsOpen(false);
          reloadModes();
        }}
        cur={fx.cur}
        onCurrency={applyCurrency}
      />
      <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} range={range} money={money} />
    </>
  );
}

export function App() {
  // The provider makes useToast work; without it the no-op context default silently drops every toast.
  return (
    <ToasterProvider>
      <Dashboard />
    </ToasterProvider>
  );
}

export default App;
