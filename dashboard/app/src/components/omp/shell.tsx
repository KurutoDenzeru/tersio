// The shell: a glass topbar (brand, live chip, range, theme) over a rail that jumps between pages,
// with the app's own Settings and Share actions in the rail's footer.
import { useEffect, useState } from "react";
import { cn } from "cn";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarInset, SidebarTrigger, SidebarRail,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Segmented } from "@/components/charts";
import { Icon } from "@/components/icon";
import { useTheme } from "@/components/theme-provider";
import { OMP_RANGES, isFileExport } from "@/lib/data";
import type { OmpRange } from "@/lib/data";
import { NAV, NAV_ITEMS, navItem } from "./nav";
import type { SectionId } from "./nav";

export const DEFAULT_RANGE: OmpRange = "24h";

const RANGE_TEXT: Record<OmpRange, string> = {
  "1h": "1h",
  "24h": "24h",
  "7d": "7d",
  "30d": "30d",
  "90d": "90d",
  all: "All",
};

const RANGE_TITLE: Record<OmpRange, string> = {
  "1h": "Last hour",
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All time",
};

/** The theme button in the topbar: cycles system, light, dark. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const next = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
  const label = theme === "system" ? "System theme" : theme === "light" ? "Light theme" : "Dark theme";
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`${label}. Click for ${next}.`}
      title={`${label} · click to switch`}
      className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg border border-line text-ink transition-[background] duration-200 hover:bg-accent-soft"
    >
      <Icon name={theme === "system" ? "monitor" : theme === "light" ? "sun" : "moon"} className="size-4" />
    </button>
  );
}

/** The window every page reads. An exported file carries one, so it is a label there. */
export function RangePicker({ range, onPick }: { range: OmpRange; onPick: (next: OmpRange) => void }) {
  if (isFileExport()) {
    return (
      <Badge variant="outline" className="mono h-7 rounded-lg border-line px-2 text-[11px] text-dim">
        {RANGE_TEXT[range]} · exported
      </Badge>
    );
  }
  return (
    <Segmented
      label="Time range"
      value={range}
      onChange={onPick}
      options={OMP_RANGES.map((value) => ({ value, label: RANGE_TEXT[value], title: RANGE_TITLE[value] }))}
    />
  );
}

export function LiveChip({ status }: { status: string | null }) {
  return (
    <Badge variant="outline" className="mono hidden h-7 max-w-[220px] gap-1.5 rounded-lg border-line px-2 text-[11px] text-dim md:inline-flex">
      <span className="inline-block size-1.5 shrink-0 animate-ping-soft rounded-full bg-accent" aria-hidden="true" />
      <span className="truncate">{status ?? "local only"}</span>
    </Badge>
  );
}

/** `1`-`6` pick a window, `g` then a letter opens a page. */
export function useShortcuts({
  onRange,
  onSection,
}: {
  onRange: (range: OmpRange) => void;
  onSection: (section: SectionId) => void;
}): void {
  useEffect(() => {
    if (isFileExport()) return;
    let armed = 0;
    const onKey = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const key = event.key.toLowerCase();
      if (armed && Date.now() - armed < 1200) {
        armed = 0;
        const item = NAV_ITEMS.find((candidate) => candidate.hotkey === key);
        if (item) {
          event.preventDefault();
          onSection(item.id);
        }
        return;
      }
      if (key === "g") {
        armed = Date.now();
        return;
      }
      const index = Number(key) - 1;
      if (Number.isInteger(index) && index >= 0 && index < OMP_RANGES.length) {
        event.preventDefault();
        onRange(OMP_RANGES[index]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onRange, onSection]);
}

function SidebarAction({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-dim transition-[background,color] duration-200 hover:bg-accent-soft hover:text-ink"
    >
      <Icon name={icon} className="size-4" />
      <span>{label}</span>
    </button>
  );
}

export function AppSidebar({
  section,
  onSection,
  ompAvailable,
  onSettings,
  onShare,
}: {
  section: SectionId;
  onSection: (section: SectionId) => void;
  ompAvailable: boolean;
  onSettings: () => void;
  onShare: () => void;
}) {
  return (
    <Sidebar collapsible="offcanvas" className="border-r border-line bg-panel text-ink">
      <SidebarHeader className="border-b border-line p-2">
        <div className="flex items-center gap-2.5 px-1.5 py-1">
          <img src="brand.webp" alt="" width="24" height="24" className="size-6 rounded-[8px]" />
          <span className="text-sm font-semibold tracking-tight">
            Tersio <span className="font-normal text-dim">stats</span>
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {NAV.map((group) => {
          const items = group.items.filter((item) => ompAvailable || !item.ompOnly);
          if (items.length === 0) return null;
          return (
            <SidebarGroup key={group.heading}>
              <SidebarGroupLabel className="mono text-[10px] uppercase tracking-[0.16em] text-dim">
                {group.heading}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        isActive={section === item.id}
                        tooltip={item.label}
                        onClick={() => onSection(item.id)}
                        className="mono text-[13px] text-dim hover:bg-accent-soft hover:text-ink data-[active]:bg-accent-soft data-[active]:font-bold data-[active]:text-ink"
                      >
                        <Icon name={item.icon} className="size-4" />
                        <span className="truncate">{item.label}</span>
                        <kbd className="mono ml-auto hidden shrink-0 text-[10px] opacity-70 group-data-[collapsible=offcanvas]:inline">
                          G {item.hotkey.toUpperCase()}
                        </kbd>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>
      <SidebarFooter className="gap-1 border-t border-line p-2">
        <SidebarAction icon="settings" label="Settings" onClick={onSettings} />
        <SidebarAction icon="share-2" label="Share" onClick={onShare} />
        <p className="mono mt-1 px-2 text-[10px] leading-relaxed text-dim">
          <kbd>1</kbd>-<kbd>6</kbd> window · <kbd>G</kbd> then a letter to jump
        </p>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

export function Topbar({
  section,
  range,
  onRange,
  status,
}: {
  section: SectionId;
  range: OmpRange;
  onRange: (range: OmpRange) => void;
  status: string | null;
}) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = (): void => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 flex items-center gap-2 border-b px-3 py-2 backdrop-blur-md transition-[background,border-color] duration-200",
        scrolled ? "border-line bg-panel/85" : "border-transparent bg-transparent",
      )}
    >
      <SidebarTrigger className="shrink-0 text-ink lg:hidden" aria-label="Toggle navigation" />
      <span className="mono hidden text-[13px] text-dim sm:inline">{navItem(section).label}</span>
      <div className="ml-auto flex min-w-0 items-center gap-2">
        <LiveChip status={status} />
        <RangePicker range={range} onPick={onRange} />
        <ThemeToggle />
      </div>
    </header>
  );
}

/** Rail plus topbar plus one routed page. */
export function Shell({
  section,
  onSection,
  range,
  onRange,
  status,
  ompAvailable,
  onSettings,
  onShare,
  children,
}: {
  section: SectionId;
  onSection: (section: SectionId) => void;
  range: OmpRange;
  onRange: (range: OmpRange) => void;
  status: string | null;
  ompAvailable: boolean;
  onSettings: () => void;
  onShare: () => void;
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider defaultOpen className="[--sidebar-width:13.5rem]">
      <AppSidebar
        section={section}
        onSection={onSection}
        ompAvailable={ompAvailable}
        onSettings={onSettings}
        onShare={onShare}
      />
      <SidebarInset className="min-w-0 bg-transparent">
        <div
          className="pointer-events-none fixed inset-0 [background-image:linear-gradient(var(--grid)_1px,transparent_1px),linear-gradient(90deg,var(--grid)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_90%_70%_at_50%_0%,black_30%,transparent_75%)]"
          aria-hidden="true"
        />
        <Topbar section={section} range={range} onRange={onRange} status={status} />
        <main className="relative w-full max-w-full overflow-x-clip">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
