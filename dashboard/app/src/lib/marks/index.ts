// Brand marks resolve to a URL: the dashboard serves a disk-cached copy, an export keeps the CDN one.
import { isColoredMark, markUrl } from "../../../../../extensions/shared/brand-marks.ts";
import { INLINE_MARKS } from "./inline.ts";

/** The export's inlined copies. The live dashboard never sets this. */
function embedded(): Record<string, string> {
const scope = globalThis as { __TERSIO_MARKS?: Record<string, string> | null };
return scope.__TERSIO_MARKS ?? {};
}

/** A remote mark is served by the dashboard, which keeps a copy in ~/.tersio/marks after the first fetch. An exported file has no server, so it keeps the CDN URL it was built with. */
function served(slug: string): string | null {
  const remote = markUrl(slug);
  if (!remote) return null;
  if (typeof window !== "undefined" && window.location.protocol === "file:") return remote;
  return `/api/mark?slug=${encodeURIComponent(slug)}`;
}

/** A maskable mark for the slug, or null when the mark is monochrome-otherwise or unknown. */
export function maskMark(slug: string): string | null {
  if (isColoredMark(slug)) return null;
  return embedded()[slug] ?? INLINE_MARKS[slug] ?? served(slug);
}

/** A full-color mark for the slug, or null when it is monochrome or unknown, so a slug resolves to one mark. */
export function imageMark(slug: string): string | null {
  const url = embedded()[slug] ?? INLINE_MARKS[slug] ?? served(slug);
  return isColoredMark(slug) ? url : null;
}

export function hasMark(slug: string): boolean {
  return imageMark(slug) !== null || maskMark(slug) !== null;
}