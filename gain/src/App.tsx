// Tersio gain dashboard. Same sections and data contract as
// dashboard/template.html + cli/dashboard.ts: dock, hero, savings bento,
// token strip, activity, top models, models, recent, command tools,
// settings, model detail, share, footer. Built on shadcn/ui primitives
// with the original design tokens in index.css.
import { useEffect, useState } from "react";
import { useTheme } from "@/components/theme-provider";
import { useDashboardData, useFx } from "@/lib/data";
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

function Shell() {
  useDataThemeAttr();
  const data = useDashboardData();
  const { fx, money, applyCurrency } = useFx(data?.currency);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  return (
    <>
      <div className="bg-blueprint pointer-events-none fixed inset-0" aria-hidden="true" />
      <main className="overflow-x-clip w-full max-w-full">
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 pb-16">
          <Dock onShare={() => setShareOpen(true)} onSettings={() => setSettingsOpen(true)} />
          <Hero data={data} />
          <Savings data={data} fx={fx} money={money} onCurrency={applyCurrency} />
          <Activity data={data} />
          <Models data={data} money={money} />
          <Recent data={data} money={money} />
          <Tools data={data} />
          <Footer />
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
