// The scroll targets, in screen order. Ids match the agent-stats page names.
export type SectionId =
  | "overview"
  | "models"
  | "providers"
  | "costs"
  | "carbon"
  | "requests"
  | "errors"
  | "traces"
  | "tools"
  | "projects";

export interface NavItem {
  id: SectionId;
  label: string;
  icon: string;
  /** Second key of the `g <key>` jump. */
  hotkey: string;
  /** True when the section only has content with an agent stats database. */
  agentOnly: boolean;
}

export interface NavGroup {
  heading: string;
  items: readonly NavItem[];
}

export const NAV: readonly NavGroup[] = [
  {
    heading: "Usage",
    items: [
      { id: "overview", label: "Overview", icon: "layout-grid", hotkey: "o", agentOnly: false },
      { id: "models", label: "Models", icon: "cpu", hotkey: "m", agentOnly: false },
      { id: "providers", label: "Providers", icon: "plug-zap", hotkey: "p", agentOnly: true },
      { id: "costs", label: "Costs", icon: "coins", hotkey: "c", agentOnly: true },
      { id: "carbon", label: "Carbon", icon: "leaf", hotkey: "f", agentOnly: true },
    ],
  },
  {
    heading: "Activity",
    items: [
      { id: "requests", label: "Requests", icon: "activity", hotkey: "r", agentOnly: false },
      { id: "errors", label: "Errors", icon: "circle-alert", hotkey: "e", agentOnly: true },
      { id: "traces", label: "Traces", icon: "square-chart-gantt", hotkey: "t", agentOnly: true },
    ],
  },
  {
    heading: "Insights",
    items: [
      { id: "tools", label: "Tools", icon: "wrench", hotkey: "l", agentOnly: false },
      { id: "projects", label: "Projects", icon: "folder-git-2", hotkey: "j", agentOnly: true },
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
