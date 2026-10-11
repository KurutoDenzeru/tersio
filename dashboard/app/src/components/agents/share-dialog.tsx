// The share card: one image of what the range holds, built from the agent statistics database.
// The card is an SVG so the canvas can rasterize it at 1200x850 for a PNG, and the text line
// beside it is plain so a network without image paste still gets the figures.
import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Icon } from "@/components/icon";
import { MarkGlyph } from "@/components/brand";
import { useToast } from "@/components/toaster";
import { useAgentData } from "@/lib/data";
import { shareUrl } from "@/lib/share";
import { AGENT_RANGE_LABEL } from "@/lib/data";
import { STRIP_MAX_WEEKS, graphOf, stripOf } from "@/lib/graph";
import type { ActivityBar, GraphCell } from "@/lib/graph";
import type { AgentRange, AgentStats } from "@/lib/data";
import type { ShareTarget } from "@/lib/share";
import { fmt, fmtShort, pct } from "@/lib/format";

/** The figures the card and the share text both read. */
interface Card {
  range: string;
  tokens: number;
  requests: number;
  costUsd: number;
  cacheRate: number;
  errorRate: number;
  models: number;
  providers: number;
  /** The weeks-by-weekday activity graph, for the contribution grid on the card. */
  graph: GraphCell[];
  /** The bar strip, for a window that spans too few weeks to read as a calendar. */
  strip: { unit: string; bars: ActivityBar[] };
  topModel: string;
}

function cardOf(agent: AgentStats): Card {
  const o = agent.overall;
  return {
    range: AGENT_RANGE_LABEL[agent.range],
    tokens: o.total,
    requests: o.requests,
    costUsd: o.costUsd,
    cacheRate: o.cacheRate,
    errorRate: o.errorRate,
    models: agent.byModel.length,
    providers: agent.byProvider.length,
    graph: graphOf(agent),
    strip: stripOf(agent),
    topModel: agent.byModel.slice().toSorted((a, b) => b.total - a.total)[0]?.key ?? "-",
  };
}

/** The 1200x850 card, rasterized for a PNG and inlined for the preview. */
function cardSvg(card: Card, money: (v: number) => string): string {
  const e = (x: string): string => x.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  // Canvas reads live tokens off <html> since it cannot resolve var().
  const computed = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string): string => computed.getPropertyValue(name).trim() || fallback;
  const bg = token("--bg", "#09090b");
  const ink = token("--ink", "#f4f4f5");
  const dim = token("--dim", "#a1a1aa");
  const accent = token("--accent", "#34d399");
  // The contribution grid, laid out like GitHub's own: rounded squares with a three pixel gap,
  // one column per week, Monday, Wednesday and Friday labeled on the left, the months above the
  // grid, and the less-to-more legend at the bottom right. The cells take the heatmap ramp, so
  // the empty level reads in both themes and every accent.
  const left = 64;
  const boxRight = 1136;
  // The weekday labels need a gutter, so the grid starts after them and the box ends at 1136.
  const gridLeft = left + 44;
  const top = 360;
  const gap = 3;
  const box = boxRight - gridLeft;
  const emptyInk = token("--cell-0", "rgba(24,24,27,.07)");
  const levelInk = [emptyInk, ...([1, 2, 3, 4].map((level) => token(`--cell-${level}`, accent)))];
  const weeks = card.graph.reduce((max, c) => Math.max(max, c.week + 1), 0);
  // A calendar needs columns to read. A window that spans a few weeks or less shows its buckets as
  // bars instead, so a 24 hour card is not two squares in the corner of a 1200 pixel card.
  const strip = weeks <= STRIP_MAX_WEEKS && card.strip.bars.length > 0 ? card.strip : null;
  let graph = "";
  let months = "";
  let legend = "";
  if (strip) {
    // One bar per slot, height against the busiest slot, and a faint stub where a slot is quiet.
    const slot = box / strip.bars.length;
    const width = Math.max(3, Math.floor(slot) - 2);
    const radius = Math.min(3, Math.round(width / 4));
    const baseY = top + 160;
    const peak = Math.max(...strip.bars.map((bar) => bar.tokens), 0);
    for (const [i, bar] of strip.bars.entries()) {
      const x = left + Math.round(i * slot + (slot - width) / 2);
      const height = bar.tokens <= 0 || peak <= 0 ? 2 : Math.max(3, Math.round((bar.tokens / peak) * 160));
      graph += `<g><title>${e(bar.label)}: ${fmtShort(bar.tokens)} tokens</title><rect x="${x}" y="${baseY - height}" width="${width}" height="${height}" rx="${radius}" fill="${bar.tokens > 0 ? levelInk[4] : emptyInk}"/></g>`;
    }
    // The two ends name the window, since a strip has no axis of its own.
    const first = strip.bars[0];
    const last = strip.bars[strip.bars.length - 1];
    const dayFormat = { month: "short", day: "numeric", timeZone: "UTC" } as const;
    const startText =
      strip.unit === "day"
        ? new Date(first.ts).toLocaleDateString("en-US", dayFormat)
        : new Date(first.ts).toISOString().slice(11, 16);
    const endText =
      strip.unit === "day"
        ? new Date(last.ts).toLocaleDateString("en-US", dayFormat)
        : new Date(last.ts).toISOString().slice(11, 16);
    months += `<text x="${left}" y="${baseY + 32}" font-family="monospace" font-size="18" letter-spacing="1" fill="${dim}">${e(startText)}</text>`;
    months += `<text x="${boxRight}" y="${baseY + 32}" text-anchor="end" font-family="monospace" font-size="18" letter-spacing="1" fill="${dim}">${e(endText)}</text>`;
  } else {
    const colWidth = Math.max(11, Math.min(22, Math.floor(box / Math.max(1, weeks))));
    const cell = colWidth - gap;
    const radius = Math.min(3, Math.round(cell / 5));
    // A short window keeps its cell size and centers, so the board never sits in one corner.
    const startLeft = gridLeft + Math.round((box - weeks * colWidth) / 2);
    const weekText = ["Mon", "Wed", "Fri"];
    // Monday, Wednesday and Friday carry a label, so the grid reads without one per row.
    for (const [i, row] of [1, 3, 5].entries()) {
      const y = top + row * (cell + gap) + Math.round(cell * 0.82);
      months += `<text x="${left}" y="${y}" font-family="monospace" font-size="15" letter-spacing="1" fill="${dim}">${e(weekText[i])}</text>`;
    }
    // Month labels hang above the column that opens the month. A label that would touch the
    // previous one is dropped, so the row never collides, as GitHub's own row does.
    const seenMonths = new Set<string>();
    let lastLabelX = -Infinity;
    for (const c of card.graph) {
      const x = startLeft + c.week * colWidth;
      const y = top + c.day * (cell + gap);
      const fill = levelInk[c.level] ?? levelInk[0];
      const at = new Date(c.ts);
      graph += `<g><title>${e(at.toISOString().slice(0, 10))}: ${fmtShort(c.tokens)} tokens</title><rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="${radius}" fill="${fill}"/></g>`;
      const monthKey = `${at.getUTCFullYear()}-${at.getUTCMonth()}`;
      if (c.day === 0 && !seenMonths.has(monthKey) && x - lastLabelX >= 48) {
        seenMonths.add(monthKey);
        lastLabelX = x;
        months += `<text x="${x}" y="${top - 10}" font-family="monospace" font-size="17" letter-spacing="1" fill="${dim}">${e(at.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }))}</text>`;
      }
    }
    // The legend sits at the bottom right, under the grid, as GitHub's own does.
    const legendY = top + 7 * colWidth + 18;
    // The group ends at the box's right edge: "less", the five swatches, then "more".
    const lessW = 46;
    const swatchW = 5 * (cell + gap);
    const moreW = 50;
    const legendLeft = boxRight - lessW - swatchW - moreW;
    const swatches = levelInk
      .map(
        (fill, level) =>
          `<rect x="${legendLeft + lessW + level * (cell + gap)}" y="${legendY - cell}" width="${cell}" height="${cell}" rx="${radius}" fill="${fill}"/>`,
      )
      .join("");
    legend =
      `<text x="${legendLeft}" y="${legendY}" font-family="monospace" font-size="16" letter-spacing="1" fill="${dim}">${e("less")}</text>` +
      swatches +
      `<text x="${legendLeft + lessW + swatchW + 8}" y="${legendY}" font-family="monospace" font-size="16" letter-spacing="1" fill="${dim}">${e("more")}</text>`;
  }
  const empty = graph
    ? ""
    : `<text x="${left}" y="${top + 30}" font-family="monospace" font-size="22" letter-spacing="2" fill="${dim}">${e("no activity in this range")}</text>`;
  // The busiest slot is the figure beside the graph, so it names the window's own unit.
  const peak = strip
    ? Math.max(...strip.bars.map((bar) => bar.tokens), 0)
    : card.graph.reduce((max, c) => Math.max(max, c.tokens), 0);
  const figure = (x: number, y: number, label: string, value: string): string =>
    `<text x="${x}" y="${y}" font-family="monospace" font-size="22" letter-spacing="3" fill="${dim}">${e(label)}</text>` +
    `<text x="${x}" y="${y + 44}" font-family="monospace" font-size="38" font-weight="bold" fill="${ink}">${e(value)}</text>`;
  // The note over the graph names what the window shows: bars for a short window, weeks for a long one.
  const note = strip
    ? `activity per ${strip.unit}`
    : weeks > 0
      ? `${weeks} ${weeks === 1 ? "week" : "weeks"} of activity`
      : "";
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="850" viewBox="0 0 1200 850">' +
    `<rect width="1200" height="850" rx="28" fill="${bg}"/>` +
    `<path d="M1090 700 L980 800 h70 l-8 60 80 -96 h-70 l8 -64 z" fill="none" stroke="${accent}" stroke-width="14" opacity="0.08" stroke-linejoin="round"/>` +
    `<text x="64" y="80" font-family="monospace" font-size="26" letter-spacing="6" fill="${accent}">${e(`TERSIO · ${card.range.toUpperCase()}`)}</text>` +
    `<text x="60" y="230" font-family="monospace" font-size="130" font-weight="bold" fill="${ink}">${e(`${fmtShort(card.tokens)} tokens`)}</text>` +
    `<text x="64" y="278" font-family="monospace" font-size="30" fill="${dim}">${e(`across ${fmt(card.requests)} agent requests`)}</text>` +
    (note
      ? `<text x="${boxRight}" y="330" text-anchor="end" font-family="monospace" font-size="20" letter-spacing="2" fill="${dim}">${e(note)}</text>`
      : "") +
    months +
    empty +
    graph +
    legend +
    figure(64, 580, "API-EQUIVALENT", money(card.costUsd)) +
    figure(380, 580, "CACHE RATE", pct(card.cacheRate)) +
    figure(696, 580, "ERROR RATE", pct(card.errorRate)) +
    figure(64, 720, "MODELS", String(card.models)) +
    figure(380, 720, "PROVIDERS", String(card.providers)) +
    figure(696, 720, strip ? "BUSIEST HOUR" : "BUSIEST DAY", fmtShort(peak)) +
    `<text x="64" y="830" font-family="monospace" font-size="22" fill="${dim}">${e(`Top model: ${card.topModel}`)}</text>` +
    "</svg>"
  );
}

function shareText(card: Card, money: (v: number) => string): string {
  return `${fmtShort(card.tokens)} tokens / ${fmt(card.requests)} requests / ${pct(card.cacheRate)} cached. ` +
    `Estimated ${money(card.costUsd)} at public rates over ${card.range}. My AI usage, tracked with Tersio.`;
}

export function ShareDialog({
  open,
  onClose,
  range,
  money,
}: {
  open: boolean;
  onClose: () => void;
  range: AgentRange;
  money: (v: number) => string;
}) {
  const toast = useToast();
  const { agent } = useAgentData(range, "overview");
  const [busy, setBusy] = useState(false);
  const svgRef = useRef<HTMLDivElement | null>(null);
  // Memoised so the raster effect runs once per range, not once per render.
  const card = useMemo(() => (agent ? cardOf(agent) : null), [agent]);
  const text = card ? shareText(card, money) : "";

  // Rasterize once per open, so both copy and download read the same bytes.
  useEffect(() => {
    if (!open || !card) return undefined;
    let live = true;
    const img = new Image();
    const url = URL.createObjectURL(new Blob([cardSvg(card, money)], { type: "image/svg+xml;charset=utf-8" }));
    img.onload = () => {
      if (!live) return;
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 850;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.drawImage(img, 0, 0, 1200, 850);
      if (svgRef.current) {
        // The same SVG the PNG rasterizes, scaled by the wrapper's aspect ratio.
        svgRef.current.innerHTML = cardSvg(card, money);
      }
    };
    img.onerror = () => undefined;
    img.src = url;
    return () => {
      live = false;
      URL.revokeObjectURL(url);
    };
  }, [open, card, money]);

  /** Renders the card to PNG bytes. Both copy and download read these bytes. */
  const raster = (): Promise<Blob | null> => {
    if (!card) return Promise.resolve(null);
    const { promise, resolve } = Promise.withResolvers<Blob | null>();
    const img = new Image();
    const url = URL.createObjectURL(new Blob([cardSvg(card, money)], { type: "image/svg+xml;charset=utf-8" }));
    const done = (blob: Blob | null): void => {
      URL.revokeObjectURL(url);
      resolve(blob);
    };
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 850;
      const context = canvas.getContext("2d");
      if (!context) {
        done(null);
        return;
      }
      context.drawImage(img, 0, 0, 1200, 850);
      canvas.toBlob(done, "image/png");
    };
    img.onerror = () => done(null);
    img.src = url;
    return promise;
  };

  const downloadPng = async (): Promise<void> => {
    if (!card) return;
    setBusy(true);
    const blob = await raster();
    setBusy(false);
    if (!blob) {
      toast("Save failed", "Browser blocked the render.", "circle-alert");
      return;
    }
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "tersio-usage.png";
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
    toast("Saved", "Card downloaded as PNG.", "download");
  };

  // The card is a picture, so the clipboard gets the picture. A browser with no image clipboard
  // still gets the file, which pastes into most hosts that take an image.
  const copyImage = async (): Promise<void> => {
    if (!card) return;
    setBusy(true);
    const blob = await raster();
    setBusy(false);
    if (!blob) {
      toast("Copy failed", "Browser blocked the render.", "circle-alert");
      return;
    }
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast("Copied", "Card copied as an image.", "image");
      return;
    } catch {
      await downloadPng();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="gap-0 overflow-hidden rounded-2xl border border-line bg-panel p-5 text-ink shadow-[0_16px_48px_rgba(0,0,0,.35)] sm:max-w-[660px]" showCloseButton={false} aria-describedby={undefined}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <DialogTitle className="m-0 flex items-center gap-2 text-base font-bold tracking-[-0.01em]">
              <Icon name="share-2" className="size-4 shrink-0 text-dim" />
              Share usage
            </DialogTitle>
            <p className="mono mt-1 text-xs text-dim">
              {card ? `${card.range} across ${fmt(card.requests)} requests` : "Reading the agent databases…"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-8 shrink-0 place-items-center rounded-lg border border-line text-dim hover:text-ink [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96]"
          >
            <Icon name="x" className="size-4" />
          </button>
        </div>

        <div ref={svgRef} aria-hidden="true" className="mt-4 aspect-[1200/850] w-full overflow-hidden rounded-xl border border-line bg-panel [&_svg]:block [&_svg]:h-full [&_svg]:w-full" />

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {(["x", "reddit", "linkedin"] as ShareTarget[]).map((target) => (
            <a
              key={target}
              href={card ? shareUrl(target, target === "linkedin" ? {} : { text, title: "My Tersio usage profile" }) : "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] border border-line bg-transparent px-3 py-[7px] text-xs text-ink no-underline hover:border-accent [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96]"
            >
              <MarkGlyph slug={target} className="size-3.5 shrink-0" />
              <span>{target === "x" ? "X" : target === "reddit" ? "Reddit" : "LinkedIn"}</span>
            </a>
          ))}
          <span className="ml-auto flex items-center gap-2">
            <button
              type="button"
              disabled={busy || !card}
              onClick={() => void copyImage()}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] border border-line bg-transparent px-3 py-[7px] text-xs text-ink hover:border-accent [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96] disabled:opacity-50"
            >
              <Icon name="image" className="size-3.5" />
              <span>Copy image</span>
            </button>
            <button
              type="button"
              disabled={busy || !card}
              onClick={downloadPng}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] border border-accent bg-accent-soft px-3 py-[7px] text-xs font-semibold text-accent hover:brightness-110 disabled:opacity-50 [transition:transform_.12s,background_.2s] active:scale-[.96]"
            >
              <Icon name="download" className="size-3.5" />
              <span>{busy ? "Rendering…" : "Download PNG"}</span>
            </button>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
