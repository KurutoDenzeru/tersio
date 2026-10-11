// Canvas palette for the trace flamegraph, read from the dashboard's own CSS tokens so the
// drawing follows the active theme and accent without a second palette to maintain.

import { useEffect, useState } from "react";

/** One colour per lane, plus the marks the axes and the selection need. */
export interface TraceTheme {
  /** Span fill per span kind. */
  category: Record<"turn" | "model" | "tool" | "background", string>;
  /** Left edge of a span that failed. */
  error: string;
  /** Marker diamond fill. */
  marker: string;
  /** Alternating band behind a turn. */
  turnBand: string;
  /** Ruler and lane hairlines. */
  grid: string;
  /** Ruler tick labels. */
  tick: string;
  /** Span label drawn inside a block. */
  spanText: string;
  /** Selection outline. */
  selection: string;
  /** Canvas backdrop. */
  panel: string;
  fonts: { sans: string; mono: string };
}

/** Which token paints each span kind is fixed in `readTheme`; a turn reads as the surface, a model as the accent. */
const TOKEN_NAMES = [
  "--track", "--dim", "--accent", "--warn-border", "--warn-soft", "--line",
  "--danger", "--ink", "--grid", "--panel", "--font-sans", "--font-mono",
] as const;

/** Read the tokens once. The app swaps theme and accent on the root element, so the read is cached. */
function readTheme(): TraceTheme {
  const styles = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string): string => styles.getPropertyValue(name).trim() || fallback;
  return {
    category: {
      turn: token("--dim", "#52525b"),
      model: token("--accent", "#047857"),
      tool: token("--warn-border", "rgba(217,119,6,.4)"),
      background: token("--line", "rgba(24,24,27,.12)"),
    },
    error: token("--danger", "#dc2626"),
    marker: token("--ink", "#18181b"),
    turnBand: token("--grid", "rgba(4,120,87,.07)"),
    grid: token("--line", "rgba(24,24,27,.12)"),
    tick: token("--dim", "#52525b"),
    spanText: token("--ink", "#18181b"),
    selection: token("--ink", "#18181b"),
    panel: token("--panel", "#ffffff"),
    fonts: {
      sans: token("--font-sans", "system-ui, sans-serif"),
      mono: token("--font-mono", "ui-monospace, monospace"),
    },
  };
}

/** The current palette, re-read whenever the theme or the accent changes. */
export function useTraceTheme(): TraceTheme {
  const [palette, setPalette] = useState<TraceTheme>(() => readTheme());

  // The tokens land on the root element, so watching it is exact: it catches the settings dialog,
  // the keyboard shortcut, and the system theme alike.
  useEffect(() => {
    const read = (): void => setPalette(readTheme());
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-accent", "class"],
    });
    return () => observer.disconnect();
  }, []);

  return palette;
}

/** Tokens this palette reads, listed for tests and for a future token audit. */
export const TRACE_THEME_TOKENS: readonly string[] = TOKEN_NAMES;
