// The share card: one image of what the range holds, built from the agent statistics database.
// The card is an SVG so the canvas can rasterize it at 1200x850 for a PNG, and the text line
// beside it is plain so a network without image paste still gets the figures.
import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Icon } from "@/components/icon";
import { useToast } from "@/components/toaster";
import { useAgentData } from "@/lib/data";
import { shareUrl } from "@/lib/share";
import { AGENT_RANGE_LABEL } from "@/lib/data";
import type { AgentRange, AgentStats } from "@/lib/data";
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
  /** Tokens per bucket across the range, for the strip along the bottom. */
  strip: number[];
  topModel: string;
}

function cardOf(agent: AgentStats): Card {
  const o = agent.overall;
  const strip = agent.series.map((b) => b.tokens);
  return {
    range: AGENT_RANGE_LABEL[agent.range],
    tokens: o.total,
    requests: o.requests,
    costUsd: o.costUsd,
    cacheRate: o.cacheRate,
    errorRate: o.errorRate,
    models: agent.byModel.length,
    providers: agent.byProvider.length,
    strip,
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
  const max = Math.max(1, ...card.strip);
  const cells = card.strip.slice(-26);
  const cell = 30;
  const gap = 8;
  const left = 64;
  let bars = "";
  cells.forEach((v, i) => {
    const h = v > 0 ? Math.max(3, Math.round((v / max) * 150)) : 3;
    const x = left + i * (cell + gap);
    bars += `<rect x="${x}" y="${420 - h}" width="${cell}" height="${h}" rx="7" fill="${accent}" opacity="${v > 0 ? "0.35" : "0.12"}"/>`;
  });
  const figure = (x: number, y: number, label: string, value: string): string =>
    `<text x="${x}" y="${y}" font-family="monospace" font-size="22" letter-spacing="3" fill="${dim}">${e(label)}</text>` +
    `<text x="${x}" y="${y + 44}" font-family="monospace" font-size="38" font-weight="bold" fill="${ink}">${e(value)}</text>`;
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="850" viewBox="0 0 1200 850">' +
    `<rect width="1200" height="850" rx="28" fill="${bg}"/>` +
    `<path d="M1090 700 L980 800 h70 l-8 60 80 -96 h-70 l8 -64 z" fill="none" stroke="${accent}" stroke-width="14" opacity="0.08" stroke-linejoin="round"/>` +
    `<text x="64" y="80" font-family="monospace" font-size="26" letter-spacing="6" fill="${accent}">${e(`TERSIO · ${card.range.toUpperCase()}`)}</text>` +
    `<text x="60" y="250" font-family="monospace" font-size="130" font-weight="bold" fill="${ink}">${e(`${fmtShort(card.tokens)} tokens`)}</text>` +
    `<text x="64" y="300" font-family="monospace" font-size="30" fill="${dim}">${e(`across ${fmt(card.requests)} agent requests`)}</text>` +
    bars +
    figure(64, 560, "API-EQUIVALENT", money(card.costUsd)) +
    figure(380, 560, "CACHE RATE", pct(card.cacheRate)) +
    figure(696, 560, "ERROR RATE", pct(card.errorRate)) +
    figure(64, 700, "MODELS", String(card.models)) +
    figure(380, 700, "PROVIDERS", String(card.providers)) +
    figure(696, 700, "BUSIEST", fmtShort(Math.max(0, ...card.strip))) +
    `<text x="64" y="810" font-family="monospace" font-size="22" fill="${dim}">${e(`Top model: ${card.topModel}`)}</text>` +
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

  const downloadPng = (): void => {
    if (!card) return;
    setBusy(true);
    const img = new Image();
    const url = URL.createObjectURL(new Blob([cardSvg(card, money)], { type: "image/svg+xml;charset=utf-8" }));
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 850;
      const context = canvas.getContext("2d");
      context?.drawImage(img, 0, 0, 1200, 850);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url);
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
      }, "image/png");
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setBusy(false);
      toast("Save failed", "Browser blocked the render.", "circle-alert");
    };
    img.src = url;
  };

  const copyText = (body: string): void => {
    const done = (): void => toast("Copied", "Share text copied.", "copy");
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(body).then(done, () => fallback());
    else fallback();
    function fallback(): void {
      try {
        const ta = document.createElement("textarea");
        ta.value = body;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        done();
      } catch {
        toast("Copy failed", "Select the text manually.", "circle-alert");
      }
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
          {(["x", "reddit", "linkedin"] as const).map((target) => (
            <a
              key={target}
              href={card ? shareUrl(target, target === "linkedin" ? {} : { text, title: "My Tersio usage profile" }) : "#"}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] border border-line bg-transparent px-3 py-[7px] text-xs text-ink no-underline hover:border-accent [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96]"
            >
              <span>{target === "x" ? "X" : target === "reddit" ? "Reddit" : "LinkedIn"}</span>
            </a>
          ))}
          <span className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => copyText(text)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] border border-line bg-transparent px-3 py-[7px] text-xs text-ink hover:border-accent [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96]"
            >
              <Icon name="copy" className="size-3.5" />
              <span>Copy text</span>
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
