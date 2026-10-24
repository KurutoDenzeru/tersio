// Brand mark catalog: names not bytes; Simple Icons files are CC0-1.0, marks remain their owners'.
const SIMPLE_ICONS = "https://cdn.jsdelivr.net/npm/simple-icons@16/icons";

/** Slug to mark URL. Only slugs named here resolve to a mark; the rest get a monogram. */
export const REMOTE_MARKS: Readonly<Record<string, string>> = {
  // Simple Icons, CC0-1.0.
  anthropic: `${SIMPLE_ICONS}/anthropic.svg`,
  // Claude Code ships its own mark; the Anthropic wordmark is a different product.
  claudecode: `${SIMPLE_ICONS}/claudecode.svg`,
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
  reddit: `${SIMPLE_ICONS}/reddit.svg`,
  // Owner-hosted, nominative use.
  groq: "https://groq.com/favicon.svg",
  poolside: "https://poolside.ai/favicon/favicon.svg",
  // AWS owns Kiro; Wikimedia hosts its vector, as AWS serves only a 16x16 ICO that cannot grow into a tile.
  amazonaws: "https://upload.wikimedia.org/wikipedia/commons/5/5c/AWS_Simple_Icons_AWS_Cloud.svg",
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
  // WorkBuddy's own favicon, a hashed asset on the Tencent CDN its page serves.
  workbuddy:
    "https://download.codebuddy.ai/web/workbuddy/913b2390aae396c66b937bd9143ae5259306d7d7/assets/logo.svg",
  // Trae's own favicon: a dark tile carrying its green mark, so the tile matches the artwork.
  trae: "https://lf16-web-neutral.traecdn.ai/obj/trae-ai-static/trae_website/favicon.png",
  // Kiro's own icon, a purple tile with the mark drawn inside it.
  kiro: "https://kiro.dev/icon.svg",
  // Meituan's own icon: its yellow tile with the logotype.
  meituan: "https://s3plus.meituan.net/v1/mss_e2821d7f0cfe4ac1bf9202ecf9590e67/cdn-prod/file:1040877d/favicon-mt.ico",
};

/** Tile fill per slug from the brand's own page, never a guess; an absent slug keeps the plain panel. */
export const MARK_BG: Readonly<Record<string, string>> = {
  // Simple Icons marks: the vendor's brand color, taken from its own brand page.
  anthropic: "#d97757",
  claudecode: "#d97757",
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
  reddit: "#ff4500",
  linkedin: "#0a66c2",
  // Owner-hosted marks match the asset's own square; art that already carries color takes a white tile.
  groq: "#f43e01",
  poolside: "#4137ff",
  cerebras: "#ffffff",
  typesafe: "#171717",
  charmhyper: "#ffffff",
  stepfun: "#ffffff",
  kilo: "#f7f576",
  opencode: "#131010",
  // The AWS cloud mark draws its own orange and its own white, so the tile stays plain white.
  amazonaws: "#ffffff",
  // The mark's own artwork is white, so the tile is white and the glyph is black.
  openai: "#ffffff",
  // Codex's mark is drawn by a component, so only the tile fill lives here.
  codex: "#ffffff",
  commandcode: "#ffffff",
  gmicloud: "#ffffff",
  magpie: "#0b0b0c",
  // WorkBuddy's mark is a full-bleed teal tile carrying its own white art.
  workbuddy: "#01c886",
  // The mark is a full-bleed tile, so the tile fill repeats the artwork's own background.
  trae: "#000000",
  kiro: "#9046ff",
  meituan: "#ffd100",
};

/** Glyph scale per slug over the tile clip; the measured ink box decides, and one is the default. */
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

/** The ink legible on a tile fill: luminance above 0.35 takes black, else white. */
export function contrastInk(hex: string): string {
  return luminance(hex) > 0.35 ? "#000000" : "#ffffff";
}

/** Marks carrying their own color or background; a filled-tile asset must draw as an image, not a mask. */
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
  // The ICO and inline PNGs are dark tiles with light art; flat-orange Groq draws as a mask instead.
  "gmicloud",
  "stealth",
  "cognition",
  // A full-bleed teal tile with its own white art, so a mask would flatten both into one ink.
  "workbuddy",
  // Each is a full-bleed brand tile with its own ink, so a mask would flatten both into one color.
  "trae",
  "kiro",
  "meituan",
  // Carries its own orange and its own white, so a mask would flatten both into one ink.
  "amazonaws",
]);

/** The URL a mark comes from, or null when the name has no hosted mark. */
export function markUrl(slug: string): string | null {
  return REMOTE_MARKS[slug] ?? null;
}

/** True when the mark carries its own color and must draw as an image. */
export function isColoredMark(slug: string): boolean {
  return COLORED_MARKS.has(slug);
}
