// Every page of the omp-stats dashboard, one hash route each, over Tersio's own usage ledger.
import { useCallback, useEffect, useState } from "react";
import { useTheme } from "@/components/theme-provider";
import { useDashboardData, useFx, useOmpData } from "@/lib/data";
import type { OmpRequestRow, OmpView } from "@/lib/data";
import { useHashRoute } from "@/lib/route";
import { EmptyState } from "@/components/common";
import { ChartSkeleton, Page, PageHeader } from "@/components/charts";
import { Shell, useShortcuts } from "./components/omp/shell";
import { navItem } from "./components/omp/nav";
import { OmpRequestDrawer } from "./components/omp/drawer";
import { SessionTrace } from "./components/omp/session";
import { OverviewPage } from "./components/omp/overview";
import { ModelsPage } from "./components/omp/models";
import { ProvidersPage } from "./components/omp/providers";
import { CostsPage } from "./components/omp/costs";
import { RequestsPage } from "./components/omp/requests";
import { ErrorsPage } from "./components/omp/errors";
import { TracesPage } from "./components/omp/traces";
import { ToolsPage } from "./components/omp/tools";
import { FrustrationPage } from "./components/omp/frustration";
import { ProjectsPage } from "./components/omp/projects";
import { GainPage } from "./components/omp/gain";
import { UsagePage } from "./components/tersio/usage";
import { Footer, SettingsDialog, ShareDialog } from "./components/dialogs";
import { ToasterProvider } from "./components/toaster";
import { StatusBanner } from "./components/status-banner";

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
      <PageHeader title={title} description="Reading the omp databases…" />
      <ChartSkeleton height={240} />
      <ChartSkeleton height={160} />
    </Page>
  );
}

function Dashboard() {
  useDataThemeAttr();
  useReveal();
  const { data, status } = useDashboardData();
  const { fx, money, applyCurrency } = useFx(data?.currency);
  const { section, range, session, setSection, setRange, setSession } = useHashRoute();
  // The usage page is Tersio's own; it only needs the availability flag, which every view carries.
  const view: OmpView = section === "usage" ? "gain" : section;
  const { omp, loading } = useOmpData(range, view);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [request, setRequest] = useState<OmpRequestRow | null>(null);

  useShortcuts({ onRange: setRange, onSection: setSection });
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [section, session]);

  const openRequest = useCallback((row: OmpRequestRow) => setRequest(row), []);
  const closeRequest = useCallback(() => setRequest(null), []);
  const ompAvailable = omp?.available ?? false;
  const title = navItem(section).label;

  const page = (): React.ReactNode => {
    if (section === "usage") {
      return <UsagePage data={data} fx={fx} money={money} onCurrency={applyCurrency} />;
    }
    if (section === "traces" && session) {
      return <SessionTrace sessionFile={session} money={money} onClose={() => setSession(null)} />;
    }
    if (loading && !omp) return <PageLoading title={title} />;
    if (!omp || !omp.available) {
      return (
        <Page>
          <PageHeader title={title} description="This page reads the omp databases." />
          <EmptyState
            icon="database-zap"
            title="No omp stats database"
            desc="The pages on this route read ~/.omp/stats.db. Run omp once, or open the Usage page for Tersio's own ledger."
          />
        </Page>
      );
    }
    switch (section) {
      case "overview":
        return <OverviewPage omp={omp} money={money} onOpenRequest={openRequest} />;
      case "models":
        return <ModelsPage omp={omp} money={money} />;
      case "providers":
        return <ProvidersPage omp={omp} money={money} />;
      case "costs":
        return <CostsPage omp={omp} money={money} />;
      case "requests":
        return <RequestsPage omp={omp} money={money} onOpenRequest={openRequest} />;
      case "errors":
        return <ErrorsPage omp={omp} money={money} onOpenRequest={openRequest} />;
      case "traces":
        return <TracesPage omp={omp} money={money} onOpenSession={setSession} />;
      case "tools":
        return <ToolsPage omp={omp} money={money} />;
      case "frustration":
        return <FrustrationPage omp={omp} />;
      case "projects":
        return <ProjectsPage omp={omp} money={money} />;
      case "gain":
        return <GainPage omp={omp} money={money} />;
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
        ompAvailable={ompAvailable}
        onSettings={() => setSettingsOpen(true)}
        onShare={() => setShareOpen(true)}
      >
        {page()}
        <Footer />
      </Shell>
      {request && <OmpRequestDrawer row={request} money={money} onClose={closeRequest} />}
      <StatusBanner status={status} />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        data={data}
        cur={fx.cur}
        onCurrency={applyCurrency}
        onReload={() => window.dispatchEvent(new Event("tersio:reload"))}
      />
      <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} data={data} money={money} />
    </>
  );
}

export function App() {
  return (
    <ToasterProvider>
      <Dashboard />
    </ToasterProvider>
  );
}

export default App;
