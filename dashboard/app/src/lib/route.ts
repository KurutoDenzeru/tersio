// The dashboard lives in the URL hash, the same shape the omp-stats dashboard uses:
// `#/models?range=7d`, plus `&s=<sessionFile>` for a deep-linked trace.
import { useCallback, useEffect, useState } from "react";
import { isOmpRange } from "./data";
import type { OmpRange } from "./data";
import { SECTIONS } from "@/components/omp/nav";
import type { SectionId } from "@/components/omp/nav";

export interface HashRoute {
  section: SectionId;
  range: OmpRange;
  /** Deep-linked trace session file. */
  session: string | null;
}

export function parseHash(hash: string): HashRoute {
  const [path, query] = hash.replace(/^#\/?/, "").split("?");
  const section = (SECTIONS as readonly string[]).includes(path) ? (path as SectionId) : "overview";
  const params = new URLSearchParams(query ?? "");
  const range = params.get("range");
  return {
    section,
    range: isOmpRange(range) ? range : "24h",
    session: params.get("s"),
  };
}

export function buildHash({ section, range, session }: HashRoute): string {
  return `#/${section}?range=${range}${session ? `&s=${encodeURIComponent(session)}` : ""}`;
}

/**
 * Setters update state synchronously and push a history entry, so the view never waits on the
 * `hashchange` round trip. Back and forward still work through the listener.
 */
export function useHashRoute(): HashRoute & {
  setSection: (section: SectionId) => void;
  setRange: (range: OmpRange) => void;
  setSession: (session: string | null) => void;
} {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));

  useEffect(() => {
    const sync = (): void => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    // Canonicalize a partial hash without adding a history entry.
    const canonical = buildHash(parseHash(window.location.hash));
    if (window.location.hash !== canonical) history.replaceState(null, "", canonical);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);

  const navigate = useCallback((next: HashRoute) => {
    setRoute(next);
    const hash = buildHash(next);
    if (window.location.hash !== hash) history.pushState(null, "", hash);
  }, []);

  const setSection = useCallback(
    (section: SectionId) => navigate({ ...route, section, session: section === "traces" ? route.session : null }),
    [route, navigate],
  );
  const setRange = useCallback((range: OmpRange) => navigate({ ...route, range }), [route, navigate]);
  const setSession = useCallback((session: string | null) => navigate({ ...route, session }), [route, navigate]);

  return { ...route, setSection, setRange, setSession };
}
