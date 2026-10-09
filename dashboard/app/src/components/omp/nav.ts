// The scroll targets, in screen order. Ids match the omp-stats page names.
export type SectionId =
  | "overview"
  | "models"
  | "providers"
  | "costs"
  | "requests"
  | "errors"
  | "traces"
  | "tools"
  | "frustration"
  | "projects"
  | "gain"
  | "usage";

export interface NavItem {
  id: SectionId;
  label: string;
  icon: string;
  /** Second key of the `g <key>` jump. */
  hotkey: string;
  /** True when the section only has content with an omp stats database. */
  ompOnly: boolean;
}

export interface NavGroup {
  heading: string;
  items: readonly NavItem[];
}

export const NAV: readonly NavGroup[] = [
  {
    heading: "Usage",
    items: [
      { id: "overview", label: "Overview", icon: "layout-grid", hotkey: "o", ompOnly: false },
      { id: "models", label: "Models", icon: "cpu", hotkey: "m", ompOnly: false },
      { id: "providers", label: "Providers", icon: "plug-zap", hotkey: "p", ompOnly: true },
      { id: "costs", label: "Costs", icon: "coins", hotkey: "c", ompOnly: true },
    ],
  },
  {
    heading: "Activity",
    items: [
      { id: "requests", label: "Requests", icon: "activity", hotkey: "r", ompOnly: false },
      { id: "errors", label: "Errors", icon: "circle-alert", hotkey: "e", ompOnly: true },
      { id: "traces", label: "Traces", icon: "square-chart-gantt", hotkey: "t", ompOnly: true },
    ],
  },
  {
    heading: "Insights",
    items: [
      { id: "tools", label: "Tools", icon: "wrench", hotkey: "l", ompOnly: false },
      { id: "frustration", label: "Frustration", icon: "frown", hotkey: "f", ompOnly: true },
      { id: "projects", label: "Projects", icon: "folder-git-2", hotkey: "j", ompOnly: true },
      { id: "gain", label: "Gain", icon: "sparkles", hotkey: "g", ompOnly: false },
    ],
  },
  {
    heading: "Tersio",
    items: [
      { id: "usage", label: "Usage", icon: "gauge", hotkey: "u", ompOnly: false },
    ],
  },
];

/** Every item, in screen order. */
export const NAV_ITEMS: readonly NavItem[] = NAV.flatMap((group) => group.items);

/** Page ids, in screen order: the router validates against these. */
export const SECTIONS: readonly SectionId[] = NAV_ITEMS.map((item) => item.id);

export function isSectionId(v: unknown): v is SectionId {
  return typeof v === "string" && (SECTIONS as readonly string[]).includes(v);
}

/** The rail entry for a section, for the page title. */
export function navItem(section: SectionId): NavItem {
  return NAV_ITEMS.find((item) => item.id === section) ?? NAV_ITEMS[0];
}
