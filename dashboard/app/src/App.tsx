// Every page of the agent-stats dashboard, one hash route each.
import { useCallback, useEffect, useState } from "react";
import { useTheme } from "@/components/theme-provider";
import { useFx, useAgentData } from "@/lib/data";
import type { AgentRequestRow, AgentView } from "@/lib/data";
import { useHashRoute } from "@/lib/route";
import { EmptyState } from "@/components/common";
import { ChartSkeleton, Page, PageHeader } from "@/components/charts";
import { Shell, useShortcuts } from "./components/agents/shell";
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
import { SettingsDialog } from "./components/dialogs";
import { ShareDialog } from "./components/agents/share-dialog";

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

/** The page while its snapshot is on the way. */
function PageLoading({ title }: { title: string }) {
  return (
    <Page>
      <PageHeader title={title} description="Reading the agent databases…" />
      <ChartSkeleton height={240} />
      <ChartSkeleton height={160} />
    </Page>
  );
}

function Dashboard() {
  useDataThemeAttr();
  useReveal();
  const { fx, money, applyCurrency } = useFx();
  const { section, range, session, setSection, setRange, setSession } = useHashRoute();
  // The smallest view still answers "is there an agent database".
  const view: AgentView = section;
  const { agent, loading, stale } = useAgentData(range, view);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [request, setRequest] = useState<AgentRequestRow | null>(null);

  useShortcuts({ onRange: setRange, onSection: setSection });
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [section, session]);

  const openRequest = useCallback((row: AgentRequestRow) => setRequest(row), []);
  const closeRequest = useCallback(() => setRequest(null), []);
  const agentAvailable = agent?.available ?? false;
  const title = navItem(section).label;

  const page = (): React.ReactNode => {
    if (section === "traces" && session) {
      return <SessionTrace sessionFile={session} money={money} onClose={() => setSession(null)} />;
    }
    if (loading && !agent) return <PageLoading title={title} />;
    if (!agent || !agent.available) {
      // A fetch that never answered JSON means the page is newer than the server process, not
      // that the databases went away. Name it, so the fix is the obvious one.
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
        return <RequestsPage agent={agent} money={money} onOpenRequest={openRequest} />;
      case "errors":
        return <ErrorsPage agent={agent} money={money} onOpenRequest={openRequest} />;
      case "traces":
        return <TracesPage agent={agent} money={money} onOpenSession={setSession} />;
      case "tools":
        return <ToolsPage agent={agent} money={money} />;
      case "projects":
        return <ProjectsPage agent={agent} money={money} />;
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
        status={status}
        agentAvailable={agentAvailable}
        onSettings={() => setSettingsOpen(true)}
        onShare={() => setShareOpen(true)}
      >
        {page()}
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
        onClose={() => setSettingsOpen(false)}
        cur={fx.cur}
        onCurrency={applyCurrency}
      />
      <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} range={range} money={money} />
    </>
  );
}

export function App() {
  return <Dashboard />;
}

export default App;
