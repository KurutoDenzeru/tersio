// The page list, in one place. Eleven routes copied across a sidebar and a router drift apart.
export interface NavItem {
  id: string;
  label: string;
  icon: string;
  hint: string;
  /** Letter pressed after `g`, mirroring OMP's jump. Unique across all pages. */
  key: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: "Usage",
    items: [
      { id: "overview", key: "o", label: "Overview", icon: "layout-dashboard", hint: "Totals, trend, and the biggest contributors" },
      { id: "models", key: "m", label: "Models", icon: "cpu", hint: "Tokens, cost, and cache behaviour per model" },
      { id: "providers", key: "p", label: "Providers", icon: "plug-zap", hint: "Which provider served each call" },
      { id: "costs", key: "c", label: "Costs", icon: "circle-dollar-sign", hint: "Spend over time and pricing coverage" },
    ],
  },
  {
    label: "Activity",
    items: [
      { id: "requests", key: "r", label: "Requests", icon: "activity", hint: "Every recorded request" },
      { id: "errors", key: "e", label: "Errors", icon: "circle-alert", hint: "Failures and interruptions" },
      { id: "traces", key: "x", label: "Traces", icon: "scroll-text", hint: "Per-request timeline" },
    ],
  },
  {
    label: "Insights",
    items: [
      { id: "tools", key: "l", label: "Tools", icon: "wrench", hint: "Tool calls and RTK command coverage" },
      { id: "frustration", key: "f", label: "Frustration", icon: "frown", hint: "Interrupted and failed turns" },
      { id: "projects", key: "j", label: "Projects", icon: "folder-git-2", hint: "Usage per working directory" },
      { id: "gain", key: "g", label: "Gain", icon: "sparkles", hint: "What Tersio saved" },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV.flatMap((group) => group.items);

export function navItem(id: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.id === id);
}
