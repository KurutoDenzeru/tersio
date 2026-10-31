// The shell: a glass topbar (brand, mode banner, range, theme) over a page-jumping rail whose footer holds Settings.
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "cn";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarInset, SidebarTrigger, SidebarRail, useSidebar,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Segmented } from "@/components/charts";
import { Icon } from "@/components/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { SocialLinks } from "@/components/brand";
import { useTheme } from "@/components/theme-provider";
import { AGENT_RANGES, isFileExport } from "@/lib/data";
import type { AgentRange } from "@/lib/data";
import { useDevMode } from "@/lib/dev-mode";
import { useIsMobile } from "@/hooks/use-mobile";
import { NAV, NAV_ITEMS } from "./nav";
import type { SectionId } from "./nav";

export const DEFAULT_RANGE: AgentRange = "24h";

/** The rail's drag handle; browser storage bridges a reload, tersio settings bridge a new port. */
const SIDEBAR_WIDTH_KEY = "tersio-sidebar-width";
const SIDEBAR_OPEN_KEY = "tersio-sidebar-open";
/** ASCII plus-grid tile for the content card, and film grain for the bar/rail surface. */
const clampSidebarWidth = (px: number): number => Math.min(420, Math.max(180, Math.round(px)));

const RANGE_TEXT: Record<AgentRange, string> = {
  "1h": "1h",
  "24h": "24h",
  "7d": "7d",
  "30d": "30d",
  "90d": "90d",
  all: "All",
};

const RANGE_TITLE: Record<AgentRange, string> = {
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

/** The six session-start mode fields the banner reads, plus the per-host sections the folders write. */
export interface ModeState {
  comboDefault: string;
  /** The level the banner may claim: `custom` once the three modes stop matching the preset. */
  comboLevel: string;
  cavemanDefault: string;
  rtkDefault: boolean;
  ponytailDefault: string;
  pstackDefault: string;
  headroomDefault: string;
  hosts?: Record<string, Record<string, string | boolean>>;
}

/** One glyph and one short name per mode, in the order the combo names them; the opt-in modes trail the three. */
const MODE_GLYPHS = [
  { key: "caveman", glyph: "🪨", label: "caveman", level: (m: ModeState) => (m.cavemanDefault ?? "off").toUpperCase() },
  { key: "rtk", glyph: "🗜️", label: "rtk", level: (m: ModeState) => (m.rtkDefault ? "ON" : "OFF") },
  { key: "headroom", glyph: "🍃", label: "headroom", level: (m: ModeState) => (m.headroomDefault ?? "off").toUpperCase() },
  { key: "ponytail", glyph: "🧠", label: "ponytail", level: (m: ModeState) => (m.ponytailDefault ?? "off").toUpperCase() },
  { key: "pstack", glyph: "🥔", label: "pstack", level: (m: ModeState) => (m.pstackDefault ?? "off").toUpperCase() },
] as const;

/** The combo preset this machine starts sessions with and the modes under it; a click opens the Quick start. */
export function ModeBanner({ modes, onOpen, loading, full }: { modes: ModeState | null; onOpen: () => void; loading?: boolean; full?: boolean }) {
  const level = modes?.comboLevel ?? modes?.comboDefault ?? "off";
  const on = level !== "off";
  const label = on ? `COMBO ${level.toUpperCase()}` : "COMBO OFF";
  const boxRef = useRef<HTMLSpanElement>(null);
  const trackRef = useRef<HTMLSpanElement>(null);
  const [scroll, setScroll] = useState(false);
  // The mode row scrolls only when it cannot fit, so a short row stays still. The first copy alone is measured: the loop's duplicate would otherwise double the width it compares.
  useEffect(() => {
    const box = boxRef.current;
    const track = trackRef.current;
    if (!box || !track) return;
    const measure = (): void => {
      const first = track.firstElementChild as HTMLElement | null;
      setScroll(first !== null && first.offsetWidth > box.clientWidth + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [modes]);
  // The five modes are unknown until /settings answers; a strip of OFF would read as a real state.
  if (loading) {
    return (
      <span
        aria-hidden="true"
        className="mono flex h-8 w-[284px] max-w-[45vw] shrink-0 items-center gap-2 rounded-lg border border-line bg-panel/60 px-2.5"
      >
        <Skeleton className="size-3.5 shrink-0 rounded-[4px]" />
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-28" />
      </span>
    );
  }
  const row = (key: string): ReactNode => (
    <span key={key} className="flex shrink-0 items-center">
      {MODE_GLYPHS.map((m, i) => (
        <span key={m.key} className="inline-flex items-center">
          {i > 0 && <span className="mr-1.5 text-dim">|</span>}
          <span className="mr-1.5 inline-flex items-center gap-0.5">
            <span className="text-[12px]">{m.glyph}</span>
            <span className="text-dim">{m.label}=</span>
            <span className={on ? "font-semibold text-ink" : "text-dim"}>{modes ? m.level(modes) : "OFF"}</span>
          </span>
        </span>
      ))}
    </span>
  );
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${label}: ${MODE_GLYPHS.map((m) => `${m.label}=${modes ? m.level(modes) : "OFF"}`).join(", ")}. Open the Quick start to change it.`}
      className={cn(
        "mono flex h-8 min-w-0 max-w-[540px] cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-[11px] transition-[background,border-color] duration-200 hover:bg-track",
        full && "w-full max-w-none",
        on ? "border-ink/25 bg-panel" : "border-line bg-panel/60",
      )}
    >
      <span className="shrink-0 text-[13px]">🧩</span>
      <span className={cn("shrink-0", on ? "font-semibold text-ink" : "text-dim")}>{label}:</span>
      {/* The modes ride a marquee: shown from `sm` up, scrolling only when the row outgrows the bar.
          Reduced motion freezes the row, and the button's title still names every mode. */}
      <span ref={boxRef} className={cn("min-w-0 overflow-hidden", full ? "block" : "hidden sm:block")}>
        <span ref={trackRef} className={cn("flex w-max items-center", scroll && "animate-tick")}>
          {row("single")}
          {scroll && row("loop")}
        </span>
      </span>
    </button>
  );
}

/** The window every page reads. An exported file carries one, so it is a label there. */
export function RangePicker({ range, onPick }: { range: AgentRange; onPick: (next: AgentRange) => void }) {
// Too narrow on a phone for six ranges beside the banner and buttons, so two drop out; `1`-`6` still pick all.
  const compact = useIsMobile();
  const options = AGENT_RANGES.filter((value) => !compact || value === "1h" || value === "24h" || value === "7d" || value === "all");
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
      options={options.map((value) => ({ value, label: RANGE_TEXT[value], title: RANGE_TITLE[value] }))}
    />
  );
}

/** `1`-`6` pick a window, `g` then a letter opens a page. */
export function useShortcuts({
  onRange,
  onSection,
}: {
  onRange: (range: AgentRange) => void;
  onSection: (section: SectionId) => void;
}): void {
  const dev = useDevMode();
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
        const item = NAV_ITEMS.find((candidate) => candidate.hotkey === key && (dev || !candidate.devOnly));
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
      if (Number.isInteger(index) && index >= 0 && index < AGENT_RANGES.length) {
        event.preventDefault();
        onRange(AGENT_RANGES[index]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dev, onRange, onSection]);
}

function SidebarAction({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-[13px] text-dim transition-[background,color] duration-200 hover:bg-track hover:text-ink group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0"
    >
      <Icon name={icon} className="size-4 shrink-0 group-data-[collapsible=icon]:size-5" />
      <span className="group-data-[collapsible=icon]:hidden">{label}</span>
    </button>
  );
}

export function AppSidebar({
  section,
  onSection,
  agentAvailable,
  agentPending,
  modes,
  modesLoaded,
  onQuickStart,
  onSettings,
  onResize,
}: {
  section: SectionId;
  onSection: (section: SectionId) => void;
  agentAvailable: boolean;
  agentPending: boolean;
  modes: ModeState | null;
  modesLoaded: boolean;
  onQuickStart: () => void;
  onSettings: () => void;
  onResize?: (width: number, final: boolean) => void;
}) {
  // A hidden developer page must not keep its slot in the rail, and the hotkey map follows it.
  const dev = useDevMode();
  // z-30 keeps the rail under the fixed topbar, which paints the brand over the rail's top strip.
  return (
    // The rail merges with the page bg and starts below the fixed topbar, like the OMP stats reference.
    <Sidebar collapsible="icon" className="z-30 bg-transparent text-ink [&>[data-slot=sidebar-inner]]:rounded-tl-xl [&>[data-slot=sidebar-inner]]:rounded-bl-xl">
      {/* The brand lives in the topbar, which spans the rail; this spacer keeps nav rows below that bar. */}
      <SidebarHeader className="relative h-12 shrink-0 px-3 md:px-0">
        <div aria-hidden="true" className="chrome-texture pointer-events-none absolute inset-0 md:hidden" />
        {/* The drawer keeps the brand row the fixed topbar shows on desktop. */}
        <div className="relative flex h-full items-center gap-2.5 md:hidden">
          <img src="brand.webp" alt="" width="24" height="24" className="size-6 shrink-0 rounded-[8px]" />
          <span className="min-w-0 truncate text-sm font-semibold tracking-tight">
            Tersio <span className="font-normal text-dim">Dashboard</span>
          </span>
          <SidebarTrigger className="ml-auto size-8 shrink-0 text-dim hover:text-ink" aria-label="Close navigation" />
        </div>
      </SidebarHeader>
      <SidebarContent className="relative">
        <div
          aria-hidden="true"
          className="chrome-texture pointer-events-none absolute inset-0"
        />
        {NAV.map((group, groupIndex) => {
          // Every item stays visible: an item whose agent data is still missing renders dimmed and unclickable instead of vanishing, so the rail never degrades to bare labels and lines.
          const items = group.items.filter((item) => dev || !item.devOnly);
          // A pending read draws the full count this rail would have, so no item arrives late.
          const pending = group.items.filter((item) => dev || !item.devOnly);
          if (items.length === 0) return null;
          return (
            <Fragment key={group.heading}>
              {/* Group headings and spacing carry the rhythm; no hairlines, which render as red lines
                  under some browser themes. */}
              <SidebarGroup
                className={cn(
                  "pb-1",
                  groupIndex > 0 && "group-data-[collapsible=icon]:mt-2 group-data-[collapsible=icon]:border-t group-data-[collapsible=icon]:border-line group-data-[collapsible=icon]:pt-2",
                )}
              >
                <SidebarGroupLabel className="mono text-[10px] uppercase tracking-[0.16em] text-dim">
                  {group.heading}
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {agentPending ? pending.map((item) => (
                      <SidebarMenuItem key={item.id}>
                        <div
                          aria-hidden="true"
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
                        >
                          <Skeleton className="size-4 shrink-0 rounded-[4px]" />
                          <Skeleton className="h-3 w-20 group-data-[collapsible=icon]:hidden" />
                        </div>
                      </SidebarMenuItem>
                    )) : items.map((item) => {
                      const dimmed = !agentAvailable && item.agentOnly;
                      return (
                        <SidebarMenuItem key={item.id}>
                          <SidebarMenuButton
                            isActive={!dimmed && section === item.id}
                            tooltip={dimmed ? `${item.label} — waiting for agent data` : item.label}
                            disabled={dimmed}
                            onClick={() => { if (!dimmed) onSection(item.id); }}
                            className={cn(
                              "mono text-[13px] text-dim hover:bg-track hover:text-ink data-[active]:bg-track data-[active]:font-bold data-[active]:text-ink",
                              // The collapsed rail is 64px while the button is 32px, so it centers instead of hugging the left.
                              "group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:!pl-1.5",
                              dimmed && "cursor-default opacity-40 hover:bg-transparent",
                            )}
                          >
                            <Icon name={item.icon} className="size-4 group-data-[collapsible=icon]:size-5" />
                            <span className="truncate">{item.label}</span>
                            <kbd className="mono ml-auto hidden shrink-0 text-[10px] opacity-70 group-data-[collapsible=offcanvas]:inline">
                              G {item.hotkey.toUpperCase()}
                            </kbd>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </Fragment>
          );
        })}
      </SidebarContent>
      <SidebarFooter className="relative gap-2 overflow-hidden rounded-bl-xl border-t border-line p-2">
        <div aria-hidden="true" className="chrome-texture pointer-events-none absolute inset-0" />
        <div className="md:hidden">
          <ModeBanner modes={modes} onOpen={onQuickStart} loading={!modesLoaded} full />
        </div>
        {agentPending ? (
          <div aria-hidden="true" className="flex h-8 items-center gap-2 rounded-md px-2">
            <Skeleton className="size-4 shrink-0 rounded-[4px]" />
            <Skeleton className="h-3 w-16" />
          </div>
        ) : (
          <SidebarAction icon="settings" label="Settings" onClick={onSettings} />
        )}
        {/* The collapsed rail is an icon strip, so the credits, the marks, and the shortcut hint
            hide there. Each of them would run past the 48 pixel rail and clip mid-word. */}
        {agentPending ? (
          <div aria-hidden="true" className="flex items-center gap-1 px-1">
            <Skeleton className="h-3 w-24" />
            <span className="ml-auto flex items-center gap-0.5">
              <Skeleton className="size-3 rounded-[3px]" />
              <Skeleton className="size-3 rounded-[3px]" />
              <Skeleton className="size-3 rounded-[3px]" />
            </span>
          </div>
        ) : (
          <div className="mono flex items-center gap-1 px-1 text-[10px] text-dim group-data-[collapsible=icon]:hidden">
            <span className="truncate">© 2026 Tersio</span>
            <SocialLinks className="ml-auto flex items-center gap-0.5 text-ink" />
          </div>
        )}
        <p className="mono hidden px-1 text-[10px] leading-relaxed text-dim group-data-[collapsible=offcanvas]:block">
          <kbd>1</kbd>-<kbd>6</kbd> window · <kbd>G</kbd> then a letter to jump
        </p>
      </SidebarFooter>
      <SidebarRail onResize={onResize} />
    </Sidebar>
  );
}

export function Topbar({
  range,
  onRange,
  modes,
  modesLoaded,
  onShare,
  onQuickStart,
}: {
  range: AgentRange;
  onRange: (range: AgentRange) => void;
  modes: ModeState | null;
  modesLoaded: boolean;
  onShare: () => void;
  onQuickStart: () => void;
}) {
  const { state, isMobile } = useSidebar();
  return (
    <header
      className={cn(
        // Fixed across the whole window like the OMP stats reference: the brand section sits over the rail, so bar and sidebar share one surface and one color.
        "fixed top-0 right-0 left-0 z-40 flex h-12 items-center gap-2 overflow-hidden px-3 max-md:h-14",
        "bar-veil",
        "grain",
      )}
    >
      <div
        aria-hidden="true"
        className="chrome-texture pointer-events-none absolute inset-0"
      />
      {/* The brand section spans the rail's width, so the nav rows below it line up under the wordmark. */}
      <div
        className={cn(
          "flex h-full shrink-0 items-center gap-2.5",
          isMobile ? "w-auto" : state === "collapsed" ? "-ml-3 w-16 justify-center gap-1 px-0" : "-ml-3 w-(--sidebar-width) pl-4 pr-3",
        )}
      >
        {state === "collapsed" && !isMobile ? (
          // The rail shows the mark; hovering swaps it for the expand control, the way Loom's rail behaves.
          <div className="group/rail relative grid size-8 shrink-0 place-items-center">
            <img
              src="brand.webp"
              alt=""
              width="24"
              height="24"
              className="size-5 rounded-[8px] transition-opacity duration-150 group-hover/rail:opacity-0"
            />
            <SidebarTrigger
              className="absolute inset-0 size-8 text-dim opacity-0 transition-opacity duration-150 hover:text-ink group-hover/rail:opacity-100 focus-visible:opacity-100 [&_svg]:!size-5"
              aria-label="Expand navigation"
            />
          </div>
        ) : (
          <>
            <img src="brand.webp" alt="" width="24" height="24" className="size-6 shrink-0 rounded-[8px]" />
            {modesLoaded ? (
              <span className={cn("min-w-0 truncate text-sm font-semibold tracking-tight", isMobile && "hidden")}>
                Tersio <span className="font-normal text-dim">Dashboard</span>
              </span>
            ) : (
              <Skeleton className={cn("h-3.5 w-28 rounded-[4px]", isMobile && "hidden")} />
            )}
            {modesLoaded ? (
              <SidebarTrigger className="ml-auto size-8 shrink-0 text-dim hover:text-ink" aria-label="Collapse navigation" />
            ) : (
              <Skeleton className="ml-auto size-8 shrink-0 rounded-lg" />
            )}
          </>
        )}
      </div>
      {/* The banner names the modes; the rail's nav rows start below this bar. On phones it moves
          into the drawer footer, above Settings. */}
      <div className="min-w-0 max-md:hidden">
        <ModeBanner modes={modes} onOpen={onQuickStart} loading={!modesLoaded} />
      </div>
      {/* The right group never shrinks: it holds the three buttons a narrow viewport still needs,
          and the banner truncates instead. */}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {modesLoaded ? (
          <RangePicker range={range} onPick={onRange} />
        ) : (
          <Skeleton className="h-7 w-44 rounded-lg" />
        )}
        {modesLoaded ? (
          <button
            type="button"
            onClick={onShare}
            aria-label="Share usage"
            title="Share usage"
            className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg border border-line text-ink transition-[background] duration-200 hover:bg-accent-soft"
          >
            <Icon name="share-2" className="size-4" />
          </button>
        ) : (
          <Skeleton className="size-8 rounded-lg" />
        )}
        {modesLoaded ? <ThemeToggle /> : <Skeleton className="size-8 rounded-lg" />}
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
  modes,
  modesLoaded,
  agentAvailable,
  agentPending,
  onSettings,
  onShare,
  children,
}: {
  section: SectionId;
  onSection: (section: SectionId) => void;
  range: AgentRange;
  onRange: (range: AgentRange) => void;
  modes: ModeState | null;
  modesLoaded: boolean;
  agentAvailable: boolean;
  agentPending: boolean;
  onSettings: () => void;
  onShare: () => void;
  children: React.ReactNode;
}) {
  // The rail keeps its last choice; a narrow window collapses on its own, and crossing the breakpoint reapplies it.
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem(SIDEBAR_OPEN_KEY);
    if (stored === "0" || stored === "1") return stored === "1";
    return !window.matchMedia("(max-width: 1023px)").matches;
  });
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    let first = true;
    const apply = (): void => {
      if (first) { first = false; return; }
      setOpen(!mq.matches);
    };
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    return Number.isFinite(stored) && stored > 0 ? clampSidebarWidth(stored) : 216;
  });

  // The width and the open state live in tersio settings, because the dashboard binds a new origin each run.
  useEffect(() => {
    void fetch("/settings")
      .then((response) => (response.ok ? response.json() : null))
      .then((saved: { sidebarWidth?: unknown; sidebarOpen?: unknown } | null) => {
        if (typeof saved?.sidebarWidth === "number") {
          const next = clampSidebarWidth(saved.sidebarWidth);
          localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next));
          setSidebarWidth(next);
        }
        if (typeof saved?.sidebarOpen === "boolean") {
          localStorage.setItem(SIDEBAR_OPEN_KEY, saved.sidebarOpen ? "1" : "0");
          setOpen(saved.sidebarOpen);
        }
      })
      .catch(() => { /* an exported file keeps the stored layout */ });
  }, []);

  const persistOpen = useCallback((next: boolean): void => {
    setOpen(next);
    localStorage.setItem(SIDEBAR_OPEN_KEY, next ? "1" : "0");
    void fetch("/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sidebarOpen: next }),
    }).catch(() => { /* the page keeps the choice for this run */ });
  }, []);

  const resizeSidebar = useCallback((next: number, final: boolean): void => {
    const clamped = clampSidebarWidth(next);
    setSidebarWidth(clamped);
    if (!final) return;
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(clamped));
    void fetch("/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sidebarWidth: clamped }),
    }).catch(() => { /* the page keeps the width for this run */ });
  }, []);

  return (
    <SidebarProvider open={open} onOpenChange={persistOpen} style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}>
      <AppSidebar
        section={section}
        onSection={onSection}
        agentAvailable={agentAvailable}
        agentPending={agentPending || !modesLoaded}
        modes={modes}
        modesLoaded={modesLoaded}
        onQuickStart={() => onSection("how-to")}
        onSettings={onSettings}
        onResize={resizeSidebar}
      />
      <SidebarInset className="min-w-0 bg-transparent px-2 pb-2 pt-14 max-md:pt-16">
        {/* Fillets at the bar/content corners: the same layers as the bar itself, placed behind the
            card so only the crescent outside the card's radius shows. The inner disc is repainted
            with the page color, which keeps the 8px gutter ring. */}
        {(["left", "right"] as const).map((side) => (
          <div
            key={side}
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute top-12 z-0 size-[22px] bar-veil grain max-md:top-14",
              side === "left" ? "left-0" : "right-0",
            )}
          >
            <div aria-hidden="true" className="chrome-texture pointer-events-none absolute inset-0" />
            <div
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute inset-0 bg-(--bg)",
                side === "left"
                  ? "[mask-image:radial-gradient(circle_at_100%_100%,black_21.5px,transparent_22px)]"
                  : "[mask-image:radial-gradient(circle_at_0%_100%,black_21.5px,transparent_22px)]",
              )}
            />
          </div>
        ))}
        <div className="shine relative min-h-[calc(100dvh-4rem)] overflow-clip rounded-xl border border-line bg-panel">
          <div
            className="pointer-events-none absolute inset-0 [background-image:linear-gradient(var(--grid)_1px,transparent_1px),linear-gradient(90deg,var(--grid)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_90%_80%_at_50%_0%,black_40%,transparent_88%)]"
            aria-hidden="true"
          />
          <main className="relative w-full max-w-full overflow-x-clip">{children}</main>
          <div aria-hidden="true" className={cn("noise-veil", section === "how-to" && "hidden")} />
        </div>
      </SidebarInset>
      <Topbar
        range={range}
        onRange={onRange}
        modes={modes}
        modesLoaded={modesLoaded}
        onShare={onShare}
        onQuickStart={() => onSection("how-to")}
      />
    </SidebarProvider>
  );
}