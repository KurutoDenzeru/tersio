// Tersio Dashboard. Same sections and data contract as cli/dashboard.ts:
// token strip, activity, top models, models, recent, command tools,
// settings, model detail, share, footer. Styled with Tailwind utilities over
// the tersio design tokens declared in index.css.
import { useEffect, useState } from "react";
import { useTheme } from "@/components/theme-provider";
import { useDashboardData, useFx } from "@/lib/data";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Dock, Hero } from "./components/hero";
import { Savings } from "./components/savings";
import { Activity } from "./components/activity";
import { Models } from "./components/models";
import { Recent } from "./components/recent";
import { Tools } from "./components/tools";
import { Footer, SettingsDialog, ShareDialog } from "./components/dialogs";
import { ToasterProvider } from "./components/toaster";

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

// Scroll reveal. Sections opt in with a `data-reveal` attribute and the
// matching utilities; this flips the attribute to "in" once the section
// enters the viewport, which is what the data-[reveal=in]: variants key off.
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

function DashboardLoading() {
  return (
    <div className="relative mx-auto max-w-7xl px-4 pb-16 sm:px-6" aria-busy="true" aria-label="Loading dashboard">
      <div className="grid min-h-72 place-items-center py-12">
        <div className="flex items-center gap-2 text-sm text-dim">
          <Spinner />
          Loading usage
        </div>
      </div>
      <div className="grid grid-cols-12 gap-3">
        <Skeleton className="col-span-12 min-h-72 rounded-xl bg-panel lg:col-span-7" />
        <Skeleton className="col-span-12 min-h-48 rounded-xl bg-panel lg:col-span-5" />
        <Skeleton className="col-span-6 min-h-40 rounded-xl bg-panel" />
        <Skeleton className="col-span-6 min-h-40 rounded-xl bg-panel" />
      </div>
      <div className="mt-8 flex flex-col gap-4 rounded-xl border border-line bg-panel p-5">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-32 w-full" />
      </div>
    </div>
  );
}

function Shell() {
  useDataThemeAttr();
  useReveal();
  const { data, loading } = useDashboardData();
  const { fx, money, applyCurrency } = useFx(data?.currency);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  return (
    <>
      <div
        className="pointer-events-none fixed inset-0 [background-image:linear-gradient(var(--grid)_1px,transparent_1px),linear-gradient(90deg,var(--grid)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_90%_70%_at_50%_0%,black_30%,transparent_75%)]"
        aria-hidden="true"
      />
      <main className="w-full max-w-full overflow-x-clip">
        <div className="relative mx-auto max-w-7xl px-4 pb-16 sm:px-6">
          <Dock onShare={() => setShareOpen(true)} onSettings={() => setSettingsOpen(true)} />
          {loading ? <DashboardLoading /> : (
            <>
              <Hero data={data} />
              <Savings data={data} fx={fx} money={money} onCurrency={applyCurrency} />
              <Activity data={data} />
              <Models data={data} money={money} />
              <Recent data={data} money={money} />
              <Tools data={data} />
              <Footer />
            </>
          )}
        </div>
      </main>
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
      <Shell />
    </ToasterProvider>
  );
}

export default App;
