// Accent catalog. index.css owns the live token values; these hexes only paint
// swatches, so keep them equal to the `html[data-accent=...]` blocks there.

export const ACCENT_IDS = ["emerald", "violet", "slate", "cyan", "rose", "amber", "orange"] as const;

export type AccentId = (typeof ACCENT_IDS)[number];

export const DEFAULT_ACCENT: AccentId = "emerald";

export const ACCENT_STORAGE_KEY = "tersio-accent";

interface Accent {
  label: string;
  light: string;
  dark: string;
}

// `satisfies` keeps the literal keys while still failing if one is missing.
export const ACCENTS = {
  emerald: { label: "Emerald", light: "#047857", dark: "#34d399" },
  violet: { label: "Violet", light: "#7c3aed", dark: "#a78bfa" },
  slate: { label: "Slate", light: "#5b6779", dark: "#94a3b8" },
  cyan: { label: "Cyan", light: "#0e7490", dark: "#22d3ee" },
  rose: { label: "Rose", light: "#be123c", dark: "#fb7185" },
  amber: { label: "Amber", light: "#b45309", dark: "#fbbf24" },
  orange: { label: "Orange", light: "#c2410c", dark: "#fb923c" },
} satisfies Record<AccentId, Accent>;

export function isAccentId(value: unknown): value is AccentId {
  return typeof value === "string" && Object.hasOwn(ACCENTS, value);
}

/** The hex a chip should paint: the ones this accent's tokens resolve to. */
export function accentSwatch(id: AccentId, dark: boolean): string {
  const accent = ACCENTS[id];
  return dark ? accent.dark : accent.light;
}