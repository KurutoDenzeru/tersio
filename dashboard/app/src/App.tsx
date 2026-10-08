// Dashboard shell: sidebar navigation, hash routing, and the routed page body.
import { useEffect, useMemo, useState } from "react";
import { AppSidebar } from "@/components/app/app-sidebar";
import { NAV_ITEMS, navItem } from "@/components/app/nav";
import { RangePicker } from "@/components/app/range-picker";
import { Footer, SettingsDialog, ShareDialog } from "@/components/dialogs";
import { EmptyState } from "@/components/dash/composites";
import { StatusBanner } from "@/components/status-banner";
import { ToasterProvider } from "@/components/toaster";
import { useTheme, useResolvedTheme } from "@/components/theme-provider";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Icon } from "@/components/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { cutoffDay, rangeWindow } from "@/lib/aggregate";
import { useDashboardData, useFx } from "@/lib/data";
import { rangeForKey, useRoute } from "@/lib/route";
import type { Route } from "@/lib/route";
import { PageBody } from "@/pages";

// Tersio's own tokens switch on data-theme; shadcn's switch on the class ThemeProvider sets.
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

// data-reveal flips to "in" once a section enters the viewport.
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
      { threshold: 0.12 },
    );
    const watch = (): void => {
      document.querySelectorAll(".rise, [data-reveal]").forEach((el) => {
        if (!seen.has(el)) io.observe(el);
      });
    };
    watch();
    const mo = new MutationObserver(watch);
    mo.observe(document.getElementById("root") ?? document.body, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, []);
}

// Digits pick a range, `g` then a letter jumps to a page, mirroring OMP.
function useShortcuts(navigate: (next: Partial<Route>) => void): void {
  useEffect(() => {
    let awaitingPage = false;
    const typing = (target: EventTarget | null): boolean =>
      target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select, [contenteditable='true']") !== null);

    const onKey = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat || typing(event.target)) return;
      const key = event.key.toLowerCase();
      if (awaitingPage) {
        awaitingPage = false;
        const target = NAV_ITEMS.find((item) => item.key === key);
        if (target) {
          event.preventDefault();
          navigate({ page: target.id });
        }
        return;
      }
      if (key === "g") {
        awaitingPage = true;
        return;
      }
      const next = rangeForKey(key);
      if (next) {
        event.preventDefault();
        navigate({ range: next });
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);
}

/** Light/dark toggle. `system` stays reachable in Settings, so the header button just flips. */
function ThemeToggle() {
  const { setTheme } = useTheme();
  const resolved = useResolvedTheme();
  const next = resolved === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Switch to the ${next} theme`}
      title={`Theme: ${resolved}`}
      className="flex shrink-0 items-center rounded-[10px] border border-line p-2 text-ink [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96]"
    >
      <Icon name={resolved === "dark" ? "moon" : "sun"} className="size-4" />
    </button>
  );
}

function PageLoading() {
  return (
    <div className="grid gap-8" aria-busy="true" aria-label="Loading usage">
      <div className="flex items-center gap-2 text-sm text-dim">
        <Spinner />
        Loading usage
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-lg bg-panel" />
        ))}
      </div>
      <Skeleton className="h-56 w-full rounded-xl bg-panel" />
    </div>
  );
}

function Shell() {
  useDataThemeAttr();
  useReveal();
  const { page, range, session, navigate } = useRoute();
  const { data, loading, status } = useDashboardData();
  const { fx, money, applyCurrency } = useFx(data?.currency);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  useShortcuts(navigate);

  const item = navItem(page);
  const cutoff = cutoffDay(range);
  // One window per range, not one per render: a shifting `since` would redraw the short-range charts.
  const since = useMemo(() => rangeWindow(range).since, [range]);

  return (
    <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen}>
      <AppSidebar
        page={page}
        range={range}
        status={status}
        version={data?.version ?? null}
        onOpen={(id) => navigate({ page: id })}
        onShare={() => setShareOpen(true)}
        onSettings={() => setSettingsOpen(true)}
      />
      <SidebarInset>
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-bg/85 px-4 py-3 backdrop-blur sm:px-6">
          <SidebarTrigger aria-label="Toggle navigation" />
          <div className="min-w-0 flex-1">
            <h1 className="m-0 truncate text-sm font-semibold tracking-[-0.01em]">{item?.label ?? page}</h1>
            <p className="m-0 truncate text-[11px] text-dim">{item?.hint ?? "Unknown page"}</p>
          </div>
          <RangePicker range={range} onPick={(next) => navigate({ range: next })} />
          <ThemeToggle />
        </header>

        <div className="px-4 py-6 sm:px-6">
          {loading ? (
            <PageLoading />
          ) : data ? (
            <PageBody
              page={page}
              data={data}
              cutoff={cutoff}
              since={since}
              range={range}
              session={session}
              onSession={(file) => navigate({ session: file })}
              money={money}
              fx={fx}
              onCurrency={applyCurrency}
            />
          ) : (
            <EmptyState
              title="No usage data"
              body="The dashboard server did not return a report. Open the served dashboard with tersio dashboard, or check the server log."
            />
          )}
        </div>
        <div className="px-4 sm:px-6">
          <Footer />
        </div>
      </SidebarInset>

      {/* Outside SidebarInset: its clipping would become the containing block for these. */}
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
    </SidebarProvider>
  );
}

export function App() {
  return (
    <ToasterProvider>
      <Shell />
    </ToasterProvider>
  );
}

export default App;
