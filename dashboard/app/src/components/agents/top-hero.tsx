// The "most used" heroes: one stat-band strip, three cells, each over a faded silhouette of its own brand.
import { BrandSilhouette, ProviderMark, VendorMark } from "@/components/brand"
import { fmt, fmtShort, pct, providerColor } from "@/lib/format"

export interface TopUsedEntry {
  /** Model id when kind is "model", provider id when it is "provider". */
  name: string
  /** The second line under the name: a model row names its provider, a provider row its volume. */
  detail?: string
  requests: number
  /** Tokens the row moved; the headline number, since the request count rides the line under it. */
  tokens: number
  /** The row's share of the range's requests, 0..1. */
  share: number
  /** Ink for the rank rule; a page passes its own chart color so the cell matches the charts. */
  color?: string
}

export function TopUsedCards({
  kind,
  entries,
}: {
  kind: "model" | "provider"
  entries: TopUsedEntry[]
}) {
  if (entries.length === 0) return null
  // Fewer than three entries merges the band: one entry spans full width, two split it in half.
  const cols =
    entries.length === 1
      ? "grid-cols-1"
      : entries.length === 2
        ? "sm:grid-cols-2"
        : "sm:grid-cols-3"
  return (
    <div
      className={`shine grid overflow-hidden rounded-xl border border-line bg-panel ${cols}`}
      data-reveal
    >
      {entries.map((entry, rank) => (
        <section
          key={entry.name}
          className={
            "relative min-w-0 overflow-hidden" +
            (rank > 0 ? " border-t border-line sm:border-t-0 sm:border-l" : "")
          }
          aria-label={`Rank ${rank + 1} ${kind}`}
        >
          {kind === "model" ? (
            <BrandSilhouette model={entry.name} />
          ) : (
            <BrandSilhouette provider={entry.name} />
          )}
          <div className="relative px-4 py-3">
            <p className="mono m-0 flex min-w-0 items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-dim">
              <span
                className="inline-block size-2 shrink-0 rounded-[2px]"
                style={{ background: entry.color ?? providerColor(entry.name) }}
                aria-hidden="true"
              />
              <span className="truncate">
                #{rank + 1} most used {kind}
              </span>
            </p>
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2.5">
                {kind === "model" ? (
                  <VendorMark model={entry.name} row />
                ) : (
                  <ProviderMark provider={entry.name} row />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold" title={entry.name}>
                    {entry.name}
                  </span>
                  {entry.detail !== undefined && (
                    <span className="mono block truncate text-[11px] text-dim">{entry.detail}</span>
                  )}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="mono block text-lg font-bold leading-tight tabular-nums">
                  {fmtShort(entry.tokens)}
                  <span className="ml-1 text-[10px] font-normal text-dim">tokens</span>
                </span>
                <span className="mono block text-[11px] text-dim tabular-nums">
                  {fmt(entry.requests)} · {pct(entry.share)} of requests
                </span>
              </span>
            </div>
          </div>
        </section>
      ))}
    </div>
  )
}
