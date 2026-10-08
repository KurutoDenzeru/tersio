// Hash routing: #/<page>?range=<id>&session=<file>. A router dependency would buy four fields and cost a bundle.
import { useCallback, useEffect, useState } from "react";

export const RANGE_IDS = ["1h", "24h", "7d", "30d", "90d", "all"] as const;
export type RangeId = (typeof RANGE_IDS)[number];

export const RANGE_LABELS: Record<RangeId, string> = {
  "1h": "1 hour",
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  all: "All time",
};

export const DEFAULT_PAGE = "overview";
export const DEFAULT_RANGE: RangeId = "24h";

function isRange(value: string | null): value is RangeId {
  return value !== null && (RANGE_IDS as readonly string[]).includes(value);
}

export interface Route {
  page: string;
  range: RangeId;
  /** Transcript file of the selected session trace; null when no session is open. */
  session: string | null;
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, "");
  const [path, query] = raw.split("?");
  const page = path && /^[a-z][a-z-]*$/.test(path) ? path : DEFAULT_PAGE;
  const params = new URLSearchParams(query ?? "");
  const range = params.get("range");
  const session = params.get("session");
  return { page, range: isRange(range) ? range : DEFAULT_RANGE, session: session || null };
}

export function buildHash(page: string, range: RangeId, session: string | null = null): string {
  const params = new URLSearchParams({ range });
  if (session) params.set("session", session);
  return `#/${page}?${params.toString()}`;
}

export function useRoute(): Route & { navigate: (next: Partial<Route>) => void } {
  const [route, setRoute] = useState<Route>(() => {
    const initial = parseHash(window.location.hash);
    // A bare load still gets a shareable URL, without firing hashchange.
    if (!window.location.hash) window.history.replaceState(null, "", buildHash(initial.page, initial.range, initial.session));
    return initial;
  });

  useEffect(() => {
    const sync = (): void => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  // Reads the live hash rather than the rendered route, so a fast double-click cannot drop a change.
  const navigate = useCallback((next: Partial<Route>) => {
    const current = parseHash(window.location.hash);
    // `session: null` clears the param; leaving it out keeps the current one.
    const session = next.session === undefined ? current.session : next.session;
    window.location.hash = buildHash(next.page ?? current.page, next.range ?? current.range, session);
  }, []);

  return { page: route.page, range: route.range, session: route.session, navigate };
}

/** Range picker shortcut, matching OMP's number keys. */
export function rangeForKey(key: string): RangeId | null {
  const index = Number(key) - 1;
  return Number.isInteger(index) && index >= 0 && index < RANGE_IDS.length ? RANGE_IDS[index] : null;
}
