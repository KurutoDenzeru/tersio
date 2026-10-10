// Brand mark catalog: names, not bytes. One list serves both consumers — the dashboard draws
// from it at runtime, and the CLI export inlines the same URLs so a single-file dashboard keeps
// its logos with the network off.
//
// Sources. Simple Icons files are CC0-1.0; the marks stay their owners' property and the
// dashboard uses them nominatively, to name the service that served a request. A vendor with no
// Simple Icons entry keeps its owner-hosted mark, and a vendor with no hosted mark anywhere is
// drawn inline in the dashboard (`dashboard/app/src/lib/marks/inline.ts`).
//
// Pinned release. Bump `SIMPLE_ICONS` once and every Simple Icons entry moves with it.
const SIMPLE_ICONS = "https://cdn.jsdelivr.net/npm/simple-icons@16/icons";

/** Slug to mark URL. Only slugs named here resolve to a mark; the rest get a monogram. */
export const REMOTE_MARKS: Readonly<Record<string, string>> = {
  // Simple Icons, CC0-1.0.
  anthropic: `${SIMPLE_ICONS}/anthropic.svg`,
  google: `${SIMPLE_ICONS}/google.svg`,
  meta: `${SIMPLE_ICONS}/meta.svg`,
  deepseek: `${SIMPLE_ICONS}/deepseek.svg`,
  qwen: `${SIMPLE_ICONS}/qwen.svg`,
  x: `${SIMPLE_ICONS}/x.svg`,
  mistralai: `${SIMPLE_ICONS}/mistralai.svg`,
  minimax: `${SIMPLE_ICONS}/minimax.svg`,
  zdotai: `${SIMPLE_ICONS}/zdotai.svg`,
  xiaomi: `${SIMPLE_ICONS}/xiaomi.svg`,
  kimi: `${SIMPLE_ICONS}/kimi.svg`,
  moonshotai: `${SIMPLE_ICONS}/moonshotai.svg`,
  nvidia: `${SIMPLE_ICONS}/nvidia.svg`,
  amd: `${SIMPLE_ICONS}/amd.svg`,
  ollama: `${SIMPLE_ICONS}/ollama.svg`,
  cline: `${SIMPLE_ICONS}/cline.svg`,
  githubcopilot: `${SIMPLE_ICONS}/githubcopilot.svg`,
  openrouter: `${SIMPLE_ICONS}/openrouter.svg`,
  github: `${SIMPLE_ICONS}/github.svg`,
  instagram: `${SIMPLE_ICONS}/instagram.svg`,
  // Owner-hosted, nominative use.
  groq: "https://groq.com/favicon.svg",
  poolside: "https://poolside.ai/favicon/favicon.svg",
  cerebras:
    "https://cdn.sanity.io/images/e4qjo92p/production/e7a55ae5ab7e2c4fdfd4e66a51f628d1f2f44207-967x967.png?w=256&h=256&fit=max",
  inclusionai: "https://cdn-avatars.huggingface.co/v1/production/uploads/662e1f9da266499277937d33/fyKuazRifqiaIO34xrhhm.jpeg",
  // Owner avatars: the vendor or gateway posts no standalone icon, so its account picture stands in.
  stepfun: "https://cdn-avatars.huggingface.co/v1/production/uploads/644f7e6233ac8f46fa0b9e26/CmF2ocXhkr2UtHXgmwq7-.png",
  // typesafe.ai serves one full-bleed tile: a dark square with pink art inside it.
  typesafe: "https://framerusercontent.com/images/aNFzSFxM4fjICmnibw7npfZjcQ.png",
  // A gateway's own brand, which names the service that served the request. Never another vendor's logo.
  opencode: "https://opencode.ai/favicon.svg",
  commandcode: "https://commandcode.ai/favicon.ico",
  kilo: "https://kilo.ai/favicon.ico",
  magpie: "https://usemagpie.ai/favicon.png",
  gmicloud: "https://gmicloud.ai/favicon.ico",
  charmhyper: "https://github.com/charmbracelet.png?size=80",
};

/**
 * Tile fill, not text. A mark whose tile carries its brand color reads as the brand, and a mark
 * whose logo already fills its own box never shows the fill. Values come from the brand (the
 * service's own page or its own asset), never from a guess; a slug absent here keeps the plain
 * panel and the theme ink.
 */
export const MARK_BG: Readonly<Record<string, string>> = {
  // Simple Icons marks: the vendor's brand color, taken from its own brand page.
  anthropic: "#d97757",
  meta: "#0082fb",
  google: "#4285f4",
  deepseek: "#4d6bfe",
  qwen: "#6950ef",
  mistralai: "#ff7000",
  minimax: "#e11d48",
  // Kimi's own favicon carries this blue, not the Moonshot violet.
  kimi: "#1782fe",
  xiaomi: "#ff6900",
  nvidia: "#76b900",
  amd: "#ed1c24",
  x: "#000000",
  ollama: "#000000",
  zdotai: "#2d2d2d",
  github: "#181717",
  githubcopilot: "#181717",
  cline: "#9f58fa",
  openrouter: "#03080a",
  instagram: "#e4405f",
  // Owner-hosted marks: the tile matches the asset's own square, and a slug whose artwork already
  // carries its own color takes a white tile so the art reads.
  groq: "#f43e01",
  poolside: "#4137ff",
  cerebras: "#ffffff",
  typesafe: "#171717",
  charmhyper: "#ffffff",
  stepfun: "#ffffff",
  kilo: "#f7f576",
  opencode: "#131010",
  // The mark's own artwork is white, so the tile is white and the glyph is black.
  openai: "#ffffff",
  commandcode: "#ffffff",
  gmicloud: "#ffffff",
  magpie: "#0b0b0c",
};

/**
 * Glyph scale per slug, applied to the glyph box the tile clips. Simple Icons art fills its 24
 * box by very different amounts, so the measured ink box decides the scale: a mark whose logo
 * runs to the edge of its box shrinks, and a mark with an invisible margin inside its own asset
 * grows. One is the default, so a slug absent here draws at full box.
 */
export const MARK_SCALE: Readonly<Record<string, number>> = {
  kimi: 0.72,
  zdotai: 0.72,
  openrouter: 0.9,
  magpie: 1.15,
};

/** WCAG relative luminance of a `#rrggbb` string. */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/**
 * The glyph color that stays legible on a tile fill. The cut sits at 0.35, which keeps white ink
 * on a brand color: Meta blue, DeepSeek blue, Xiaomi orange, Mistral orange, and Kimi blue all
 * carry a white logo, which is how their own brand sheets print them. Only a light neutral takes
 * black: Kilo yellow, StepFun teal, and Lightbend orange.
 */
export function contrastInk(hex: string): string {
  return luminance(hex) > 0.35 ? "#000000" : "#ffffff";
}

/**
 * Marks that carry their own color or their own background. Everything else is opaque black, so
 * it draws as an alpha mask filled with the chosen ink instead of an image. A slug whose asset is
 * a filled tile must draw as an image, or the mask paints one flat block and the logo vanishes.
 */
export const COLORED_MARKS: ReadonlySet<string> = new Set([
  "cerebras",
  "inclusionai",
  "typesafe",
  "opencode",
  "commandcode",
  "kilo",
  "magpie",
  "charmhyper",
  "stepfun",
  // The ICO and the two inline PNGs are dark tiles with light art drawn inside them. The Groq
  // favicon is one flat orange, so it draws as a mask instead: a masked glyph on a Groq-orange
  // tile is a logo, and the same art as an image on the same orange tile is a blank tile.
  "gmicloud",
  "stealth",
  "cognition",
]);

/** The URL a mark comes from, or null when the name has no hosted mark. */
export function markUrl(slug: string): string | null {
  return REMOTE_MARKS[slug] ?? null;
}

/** True when the mark carries its own color and must draw as an image. */
export function isColoredMark(slug: string): boolean {
  return COLORED_MARKS.has(slug);
}
