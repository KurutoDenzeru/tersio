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
import { STRIP_MAX_WEEKS, BAND_MAX_WEEKS, dayFactsOf, graphOf, graphWeeks, monthBandsOf, stripOf, streaksOf } from "@/lib/graph";
import type { ActivityBar, GraphCell, GraphStreaks, MonthBand } from "@/lib/graph";
import type { AgentRange, AgentStats } from "@/lib/data";
import type { ShareTarget } from "@/lib/share";
import { fmt, fmtElapsed, fmtShort, pct } from "@/lib/format";

/** The figures the card and the share text both read. */
interface Card {
  range: string;
  tokens: number;
  requests: number;
  costUsd: number;
  cacheRate: number;
  errorRate: number;
  /** Which activity picture the window earns: a bar strip, month bands, the calendar, or none. */
  kind: "empty" | "strip" | "bands" | "calendar";
  /** The bar strip, for a window that spans too few weeks to read as a calendar. */
  strip: { unit: string; bars: ActivityBar[] };
  /** The weeks-by-weekday calendar, for a window wide enough to need one. */
  graph: GraphCell[];
  /** How many week columns the calendar spans. */
  weeks: number;
  /** One row per calendar month, for a window of a few months. */
  bands: MonthBand[];
  /** The streak and peak figures read off the same day grid. */
  streaks: GraphStreaks;
  /** The longest single request in the range; null when none carries a duration. */
  maxDurationMs: number | null;
}

function cardOf(agent: AgentStats): Card {
  const facts = dayFactsOf(agent);
  const graph = graphOf(agent);
  const weeks = graphWeeks(graph);
  const bands = monthBandsOf(facts, facts.peakTokens);
  const strip = stripOf(agent);
  // A window that holds no activity at all draws the empty state rather than a picture of it.
  const quiet = bands.every((band) => band.cells.every((cell) => cell.tokens <= 0));
  return {
    range: AGENT_RANGE_LABEL[agent.range],
    tokens: agent.overall.total,
    requests: agent.overall.requests,
    costUsd: agent.overall.costUsd,
    cacheRate: agent.overall.cacheRate,
    errorRate: agent.overall.errorRate,
    kind: quiet
      ? "empty"
      : weeks <= STRIP_MAX_WEEKS && strip.bars.length > 0
        ? "strip"
        : weeks <= BAND_MAX_WEEKS && bands.length > 0
          ? "bands"
          : "calendar",
    strip,
    graph,
    weeks,
    bands,
    streaks: streaksOf(facts),
    maxDurationMs: agent.overall.maxDurationMs,
  };
}

/** The days a live streak covers, so the graph can ring them. */
function streakDays(streaks: GraphStreaks): Set<number> {
  const set = new Set<number>();
  const { current } = streaks;
  if (current.days <= 0 || current.endTs === null) return set;
  for (let ts = (current.startTs ?? current.endTs); ts <= current.endTs; ts += 86_400_000) set.add(ts);
  return set;
}

/** The 1200x850 card, rasterized for a PNG and inlined for the preview. */
function cardSvg(card: Card, money: (v: number) => string, brand: string | null): string {
  const e = (x: string): string => x.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  // Canvas reads live tokens off <html> since it cannot resolve var().
  const computed = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string): string => computed.getPropertyValue(name).trim() || fallback;
  const bg = token("--bg", "#09090b");
  const ink = token("--ink", "#f4f4f5");
  const dim = token("--dim", "#a1a1aa");
  const accent = token("--accent", "#34d399");
  const left = 64;
  const boxRight = 1136;
  const gridLeft = left + 44;
  const emptyInk = token("--cell-0", "rgba(24,24,27,.07)");
  const levelInk = [emptyInk, ...([1, 2, 3, 4].map((level) => token(`--cell-${level}`, accent)))];
  const ring = streakDays(card.streaks);
  const s = card.streaks;
  const figure = (x: number, y: number, label: string, value: string): string =>
    `<text x="${x}" y="${y}" font-family="monospace" font-size="20" letter-spacing="3" fill="${dim}">${e(label)}</text>` +
    `<text x="${x}" y="${y + 44}" font-family="monospace" font-size="38" font-weight="bold" fill="${ink}">${e(value)}</text>`;

  // --- the activity picture -------------------------------------------------
  let graph = "";
  let months = "";
  let legend = "";
  let note = "";
  const empty = (): string =>
    `<text x="${left}" y="430" font-family="monospace" font-size="22" letter-spacing="2" fill="${dim}">${e("no activity in this range")}</text>`;

  if (card.kind === "empty") {
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="850" viewBox="0 0 1200 850">' +
      `<rect width="1200" height="850" rx="28" fill="${bg}"/>` +
      `<path d="M1090 700 L980 800 h70 l-8 60 80 -96 h-70 l8 -64 z" fill="none" stroke="${accent}" stroke-width="14" opacity="0.08" stroke-linejoin="round"/>` +
      `<text x="64" y="80" font-family="monospace" font-size="26" letter-spacing="6" fill="${accent}">${e(`TERSIO · ${card.range.toUpperCase()}`)}</text>` +
      empty() +
      "</svg>"
    );
  } else if (card.kind === "strip") {
    // One bar per slot, height against the busiest slot, and a faint stub where a slot is quiet.
    const { bars } = card.strip;
    const box = boxRight - left;
    const slot = box / bars.length;
    const width = Math.max(3, Math.floor(slot) - 2);
    const radius = Math.min(3, Math.round(width / 4));
    const top = 372;
    const baseY = top + 170;
    const peak = Math.max(...bars.map((bar) => bar.tokens), 0);
    for (const [i, bar] of bars.entries()) {
      const x = left + Math.round(i * slot + (slot - width) / 2);
      const height = bar.tokens <= 0 || peak <= 0 ? 2 : Math.max(3, Math.round((bar.tokens / peak) * 170));
      graph += `<g><title>${e(bar.label)}: ${fmtShort(bar.tokens)} tokens</title><rect x="${x}" y="${baseY - height}" width="${width}" height="${height}" rx="${radius}" fill="${bar.tokens > 0 ? levelInk[4] : emptyInk}"/></g>`;
    }
    // The two ends name the window, since a strip has no axis of its own.
    const first = bars[0]!;
    const last = bars[bars.length - 1]!;
    const dayFormat = { month: "short", day: "numeric", timeZone: "UTC" } as const;
    const startText =
      card.strip.unit === "day"
        ? new Date(first.ts).toLocaleDateString("en-US", dayFormat)
        : new Date(first.ts).toISOString().slice(11, 16);
    const endText =
      card.strip.unit === "day"
        ? new Date(last.ts).toLocaleDateString("en-US", dayFormat)
        : new Date(last.ts).toISOString().slice(11, 16);
    months =
      `<text x="${left}" y="${baseY + 34}" font-family="monospace" font-size="18" letter-spacing="1" fill="${dim}">${e(startText)}</text>` +
      `<text x="${boxRight}" y="${baseY + 34}" text-anchor="end" font-family="monospace" font-size="18" letter-spacing="1" fill="${dim}">${e(endText)}</text>`;
    note = `activity per ${card.strip.unit}`;
  } else if (card.kind === "bands") {
    // One row per calendar month, every day of the month as a cell, the current month last.
    // A three month window reads as three even rows, where a fourteen column grid would leave
    // most of a 1200 pixel card empty.
    const maxCells = Math.max(...card.bands.map((band) => band.cells.length), 1);
    const gap = 3;
    const labelW = 92;
    const bandLeft = left + labelW;
    const cell = Math.max(8, Math.floor((boxRight - bandLeft - (maxCells - 1) * gap) / maxCells));
    const rowGap = 34;
    const top = 366;
    for (const [i, band] of card.bands.entries()) {
      const y = top + i * (cell + rowGap);
      // The row label, with its year under it, so the eye follows the row's start.
      months +=
        `<text x="${left}" y="${y + Math.round(cell * 0.82)}" font-family="monospace" font-size="20" font-weight="bold" letter-spacing="2" fill="${ink}">${e(band.label.toUpperCase())}</text>` +
        `<text x="${left}" y="${y + cell + 15}" font-family="monospace" font-size="13" letter-spacing="1" fill="${dim}">${e(String(band.year))}</text>`;
      const ringed: number[] = [];
      for (const [d, c] of band.cells.entries()) {
        const x = bandLeft + d * (cell + gap);
        // A day before the window opened is still a box, at a lower weight, so the row keeps
        // the length of its month and the range boundary stays visible.
        const fill = c.level > 0 ? levelInk[c.level] : emptyInk;
        const opacity = c.inWindow ? 1 : 0.3;
        if (ring.has(c.ts)) ringed.push(d);
        graph += `<g><title>${e(band.title)} ${new Date(c.ts).getUTCDate()}: ${fmtShort(c.tokens)} tokens${c.inWindow ? "" : " (outside the range)"}</title><rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="${Math.min(4, Math.round(cell / 5))}" fill="${fill}" opacity="${opacity}"/></g>`;
      }
      // One outline around the whole live run, rather than one per cell: nine overlapping
      // boxes read as a scalloped bracket instead of a band.
      if (ringed.length > 0) {
        const x0 = bandLeft + ringed[0]! * (cell + gap) - 3;
        const x1 = bandLeft + ringed[ringed.length - 1]! * (cell + gap) + cell + 3;
        graph += `<rect x="${x0}" y="${y - 3}" width="${x1 - x0}" height="${cell + 6}" rx="${Math.min(7, Math.round(cell / 3))}" fill="none" stroke="${accent}" stroke-width="2"/>`;
      }
    }
    // The legend sits at the bottom right of the graph region, as GitHub's own does.
    const legendY = top + card.bands.length * (cell + rowGap) + 4;
    const lessW = 46;
    const swatchW = 5 * (cell + gap);
    const moreW = 50;
    const legendLeft = boxRight - lessW - swatchW - moreW;
    const swatches = levelInk
      .map(
        (fill, level) =>
          `<rect x="${legendLeft + lessW + level * (cell + gap)}" y="${legendY - cell}" width="${cell}" height="${cell}" rx="${Math.min(4, Math.round(cell / 5))}" fill="${fill}"/>`,
      )
      .join("");
    legend =
      `<text x="${legendLeft}" y="${legendY}" font-family="monospace" font-size="16" letter-spacing="1" fill="${dim}">${e("less")}</text>` +
      swatches +
      `<text x="${legendLeft + lessW + swatchW + 8}" y="${legendY}" font-family="monospace" font-size="16" letter-spacing="1" fill="${dim}">${e("more")}</text>`;
    note = `${s.activeDays} active days across ${card.bands.length} months`;
  } else if (card.kind === "calendar") {
    // The grid keeps the GitHub proportions: rounded squares with a three pixel gap, one column
    // per week, Monday, Wednesday and Friday labeled on the left, and the months above the grid.
    const top = 366;
    const gap = 3;
    const box = boxRight - gridLeft;
    const colWidth = Math.max(10, Math.min(22, Math.floor(box / Math.max(1, card.weeks))));
    const cell = colWidth - gap;
    const radius = Math.min(3, Math.round(cell / 5));
    // A short window keeps its cell size and centers, so the board never sits in one corner.
    const startLeft = gridLeft + Math.round((box - card.weeks * colWidth) / 2);
    const weekText = ["Mon", "Wed", "Fri"];
    for (const [i, row] of [1, 3, 5].entries()) {
      const y = top + row * (cell + gap) + Math.round(cell * 0.82);
      months += `<text x="${left}" y="${y}" font-family="monospace" font-size="15" letter-spacing="1" fill="${dim}">${e(weekText[i]!)}</text>`;
    }
    // Month labels hang above the column that opens the month. A label that would touch the
    // previous one is dropped, so the row never collides, as GitHub's own row does.
    const seenMonths = new Set<string>();
    let lastLabelX = -Infinity;
    // The live run's first and last column, so one outline can wrap it.
    let ringFrom = -1;
    let ringTo = -1;
    for (const [i, c] of card.graph.entries()) {
      const x = startLeft + c.week * colWidth;
      const y = top + c.day * (cell + gap);
      const fill = levelInk[c.level] ?? levelInk[0]!;
      const at = new Date(c.ts);
      graph += `<g><title>${e(at.toISOString().slice(0, 10))}: ${fmtShort(c.tokens)} tokens</title><rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="${radius}" fill="${fill}"/></g>`;
      if (ring.has(c.ts)) {
        if (ringFrom < 0) ringFrom = i;
        ringTo = i;
      }
      if (c.day === 0 && !seenMonths.has(c.month) && x - lastLabelX >= 48) {
        seenMonths.add(c.month);
        lastLabelX = x;
        months += `<text x="${x}" y="${top - 10}" font-family="monospace" font-size="17" letter-spacing="1" fill="${dim}">${e(at.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }))}</text>`;
      }
    }
    // One outline around the run, not one per cell.
    if (ringFrom >= 0) {
      const first = card.graph[ringFrom]!;
      const last = card.graph[ringTo]!;
      const x0 = startLeft + first.week * colWidth - 3;
      const x1 = startLeft + last.week * colWidth + cell + 3;
      const y0 = top + Math.min(first.day, last.day) * (cell + gap) - 3;
      const y1 = top + Math.max(first.day, last.day) * (cell + gap) + cell + 3;
      graph += `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" rx="${Math.min(7, Math.round(cell / 3))}" fill="none" stroke="${accent}" stroke-width="2"/>`;
    }
    const legendY = top + 7 * colWidth + 18;
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
    note = `${card.weeks} ${card.weeks === 1 ? "week" : "weeks"} of activity`;
  }

  // The brand mark, so the card carries the same face the app and the CLI do. The corners are
  // rounded with a clip path, because `rx` is not an attribute of `<image>`. It ends on
  // `boxRight`, the same gutter the rest of the card keeps. A browser that refuses the data URL
  // still gets the rest of the card.
  const avatar =
    brand === null
      ? ""
      : `<defs><clipPath id="tersio-brand"><rect x="1040" y="40" width="96" height="96" rx="22"/></clipPath></defs>` +
        `<image href="${brand}" x="1040" y="40" width="96" height="96" preserveAspectRatio="xMidYMid slice" clip-path="url(#tersio-brand)"/>`;

  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="850" viewBox="0 0 1200 850">' +
    `<rect width="1200" height="850" rx="28" fill="${bg}"/>` +
    `<path d="M1090 700 L980 800 h70 l-8 60 80 -96 h-70 l8 -64 z" fill="none" stroke="${accent}" stroke-width="14" opacity="0.08" stroke-linejoin="round"/>` +
    `<text x="64" y="80" font-family="monospace" font-size="26" letter-spacing="6" fill="${accent}">${e(`TERSIO · ${card.range.toUpperCase()}`)}</text>` +
    `<text x="60" y="230" font-family="monospace" font-size="130" font-weight="bold" fill="${ink}">${e(`${fmtShort(card.tokens)} tokens`)}</text>` +
    `<text x="64" y="278" font-family="monospace" font-size="30" fill="${dim}">${e(`across ${fmt(card.requests)} agent requests`)}</text>` +
    (note ? `<text x="${boxRight}" y="330" text-anchor="end" font-family="monospace" font-size="20" letter-spacing="2" fill="${dim}">${e(note)}</text>` : "") +
    avatar +
    months +
    graph +
    legend +
    figure(64, 664, "API-EQUIVALENT", money(card.costUsd)) +
    figure(448, 664, "CACHE RATE", pct(card.cacheRate)) +
    figure(832, 664, "ERROR RATE", pct(card.errorRate)) +
    figure(64, 754, "PEAK DAY", fmtShort(s.peakTokens)) +
    figure(320, 754, "LONGEST TASK", fmtElapsed(card.maxDurationMs)) +
    figure(576, 754, "LONGEST STREAK", `${s.longest.days}d`) +
    figure(832, 754, "CURRENT STREAK", `${s.current.days}d`) +
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
  // The brand mark, read once as a data URL so the card and its PNG stay self-contained.
  const [brand, setBrand] = useState<string | null>(null);
  const svgRef = useRef<HTMLDivElement | null>(null);
  // Memoised so the raster effect runs once per range, not once per render.
  const card = useMemo(() => (agent ? cardOf(agent) : null), [agent]);
  const text = card ? shareText(card, money) : "";

  useEffect(() => {
    let live = true;
    // A missing or blocked mark leaves the card without it; every other figure still draws.
    fetch("brand.webp")
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (!live || blob === null) return;
        const reader = new FileReader();
        // addEventListener rather than onload: assigning replaces any handler already set.
        reader.addEventListener("load", () => {
          if (live && typeof reader.result === "string") setBrand(reader.result);
        });
        reader.readAsDataURL(blob);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  // Rasterize once per open, so both copy and download read the same bytes.
  useEffect(() => {
    if (!open || !card) return undefined;
    let live = true;
    const img = new Image();
    const url = URL.createObjectURL(new Blob([cardSvg(card, money, brand)], { type: "image/svg+xml;charset=utf-8" }));
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
        svgRef.current.innerHTML = cardSvg(card, money, brand);
      }
    };
    img.onerror = () => undefined;
    img.src = url;
    return () => {
      live = false;
      URL.revokeObjectURL(url);
    };
  }, [open, card, money, brand]);

  /** Renders the card to PNG bytes. Both copy and download read these bytes. */
  const raster = (): Promise<Blob | null> => {
    if (!card) return Promise.resolve(null);
    const { promise, resolve } = Promise.withResolvers<Blob | null>();
    const img = new Image();
    const url = URL.createObjectURL(new Blob([cardSvg(card, money, brand)], { type: "image/svg+xml;charset=utf-8" }));
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
