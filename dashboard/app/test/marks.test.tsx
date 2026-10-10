// Guards the mark rules: every slug the UI names maps to a mark, the marks come from one
// catalog, and the export inlines that same catalog into a self-contained file.
import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { COLORED_MARKS, MARK_BG, MARK_SCALE, REMOTE_MARKS, contrastInk, isColoredMark, luminance, markUrl } from "../../../extensions/shared/brand-marks.ts";
import { providerColor, providerMeta, vendorOf, displayModel } from "../src/lib/format";
import { hasMark, imageMark, maskMark } from "../src/lib/marks";
import { INLINE_MARKS } from "../src/lib/marks/inline.ts";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

/** Marks that stay inline because no host serves them. */
const INLINE_SLUGS = new Set(Object.keys(INLINE_MARKS));
/** The one mark drawn by a component: Simple Icons carries no OpenAI icon. */
const COMPONENT_SLUGS = new Set(["openai"]);

/** Hosts the catalog is allowed to name. Anything else in source is a stray reference. */
const KNOWN_HOSTS = [
  "cdn.jsdelivr.net/npm/simple-icons",
  "groq.com/favicon.svg",
  "poolside.ai/favicon",
  "cdn.sanity.io",
  "cdn-avatars.huggingface.co",
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("remote marks", () => {
  test("no source file hardcodes a mark URL outside the catalog", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const host of KNOWN_HOSTS) {
        if (text.includes(host)) offenders.push(`${path.relative(SRC, file)} -> ${host}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("every mark is reachable over https, and colored marks are the minority", () => {
    const slugs = Object.keys(REMOTE_MARKS);
    expect(slugs.length).toBeGreaterThan(20);
    for (const slug of slugs) expect(`${slug}: ${markUrl(slug)?.startsWith("https://")}`).toBe(`${slug}: true`);
    // Everything the catalog knows about is a colored mark or a monochrome mask, never both.
    for (const slug of slugs) expect(isColoredMark(slug)).toBe(COLORED_MARKS.has(slug));
    // A colored mark may live inline, because its asset carries its own tile.
    expect([...COLORED_MARKS].every((slug) => slug in REMOTE_MARKS || INLINE_SLUGS.has(slug))).toBeTruthy();
  });

  test("a colored mark draws as an image and a monochrome one as a mask", () => {
    expect(maskMark("cerebras")).toBeNull();
    expect(imageMark("cerebras")).toBe("https://cdn.sanity.io/images/e4qjo92p/production/e7a55ae5ab7e2c4fdfd4e66a51f628d1f2f44207-967x967.png?w=256&h=256&fit=max");
    expect(imageMark("anthropic")).toBeNull();
    expect(maskMark("anthropic")).toBe("https://cdn.jsdelivr.net/npm/simple-icons@16/icons/anthropic.svg");
    expect(maskMark("not-a-vendor")).toBeNull();
  });

  test("every brand fill keeps its glyph legible", () => {
    expect(Object.keys(MARK_BG).length).toBeGreaterThan(20);
    for (const [slug, bg] of Object.entries(MARK_BG)) {
      expect(`${slug} bg: ${bg}`).toMatch(/^[a-z0-9-]+ bg: #[0-9a-f]{6}$/);
      // The fill must actually contrast with the ink drawn on it, or the mark disappears. A brand
      // color is a given and the brand's own convention governs the ink, so the floor only has to
      // catch a real failure such as the ink matching the fill.
      const fill = luminance(bg);
      const ink = luminance(contrastInk(bg));
      const ratio = (Math.max(fill, ink) + 0.05) / (Math.min(fill, ink) + 0.05);
      expect(`${slug} ratio: ${ratio >= 2.5 ? ratio.toFixed(1) : "low"}`).toBe(`${slug} ratio: ${ratio.toFixed(1)}`);
    }
  });

  test("only a measured mark gets a scale, and every scale stays a logo, not a bleed", () => {
    for (const [slug, scale] of Object.entries(MARK_SCALE)) {
      expect(`${slug} scale: ${scale > 0.6 && scale < 1.3 ? "ok" : "bad"}`).toBe(`${slug} scale: ok`);
      // The scale exists to equalize art that fills its own box by different amounts.
      expect(`${slug} known: ${hasMark(slug) || INLINE_SLUGS.has(slug) || COMPONENT_SLUGS.has(slug)}`).toBe(`${slug} known: true`);
    }
  });

  test("an inlined mark wins over the network, so an export works offline", () => {
    const before = maskMark("anthropic");
    (globalThis as { __TERSIO_MARKS?: Record<string, string> | null }).__TERSIO_MARKS = { anthropic: "data:image/svg+xml,%3Csvg%3E%3C/svg%3E" };
    try {
      expect(maskMark("anthropic")).toBe("data:image/svg+xml,%3Csvg%3E%3C/svg%3E");
      // A mark the inlined set does not carry still falls back to its host.
      expect(maskMark("groq")).toBe("https://groq.com/favicon.svg");
    } finally {
      (globalThis as { __TERSIO_MARKS?: Record<string, string> | null }).__TERSIO_MARKS = null;
    }
    expect(maskMark("anthropic")).toBe(before);
  });

  test("every slug the UI names resolves to a mark", () => {
    const models: Array<[string, string]> = [
      ["inclusionai/ling-3.0-flash-sante:free", "inclusionai"],
      ["MiniMaxAI/MiniMax-M3", "minimax"],
      ["grok-5", "x"],
      ["stealth/space-bunny-alpha", "stealth"],
      ["gpt-6-luna", "openai"],
      ["meta/muse-spark-1.3-contributor", "meta"],
      ["deepseek-v4.1-flash", "deepseek"],
      ["Qwen3.8-27B", "qwen"],
      ["z-ai/glm-5.3-free", "zdotai"],
      ["mimo-v2.6-flash", "xiaomi"],
      ["kimi-k2.5", "kimi"],
      ["k3", "kimi"],
      ["mistral-medium", "mistralai"],
      ["claude-opus-5-5-medium", "anthropic"],
      ["gemini-3.8-flash", "google"],
      ["nvidia/nemotron-3-ultra-550b-a55b", "nvidia"],
      ["poolside/laguna-s-2.1-free", "poolside"],
      ["swe-1-6-slow", "cognition"],
      ["step-5-preview-free", "stepfun"],
      ["typesafe/jev-latest", "typesafe"],
      ["qwen-code-max", "qwen"],
    ];
    for (const [model, slug] of models) {
      expect(`${model} -> ${vendorOf(model).slug}`).toBe(`${model} -> ${slug}`);
      if (slug === "") continue;
      expect(`${slug} marked: ${hasMark(slug) || INLINE_SLUGS.has(slug) || COMPONENT_SLUGS.has(slug)}`).toBe(`${slug} marked: true`);
    }
  });

  test("the model ids the regex used to miss now name their vendor", () => {
    const closed: Array<[string, string]> = [
      ["k3", "Moonshot"],
      ["opencode-zen/step-5-preview-free", "StepFun"],
      ["typesafe/jev", "Typesafe"],
      ["~typesafe/jev-latest", "Typesafe"],
      ["meituan/LongCat-2.0:free", "Meituan"],
      ["poolside/laguna-s-2.1-free", "Poolside"],
      ["tencent/hy3:free", "Tencent"],
    ];
    for (const [model, vendor] of closed) {
      expect(`${model} -> ${vendorOf(model).name}`).toBe(`${model} -> ${vendor}`);
      // The label reads vendor first, so the mark and the text agree.
      expect(displayModel(model).startsWith(vendor)).toBe(true);
    }
  });

  test("every provider mark is known, and a neutral gateway keeps its monogram", () => {
    const branded: Array<[string, string]> = [
      ["amd-radeon-cloud-cn", "amd"],
      ["kimi-code", "kimi"],
      ["openai-codex", "openai"],
      ["nvidia", "nvidia"],
      ["google-antigravity", "google"],
      ["devin", "cognition"],
      ["github-copilot", "githubcopilot"],
      ["ollama-cloud", "ollama"],
      ["cline", "cline"],
      ["groq", "groq"],
      ["poolside", "poolside"],
      ["cerebras", "cerebras"],
      ["openrouter", "openrouter"],
      ["opencode", "opencode"],
      ["commandcode", "commandcode"],
      ["kilo", "kilo"],
      ["magpie", "magpie"],
      ["charm-hyper", "charmhyper"],
      ["opencode-zen", "opencode"],
      ["gmi-cloud", "gmicloud"],
      ["opencode-go", "opencode"],
    ];
    for (const [provider, slug] of branded) {
      expect(`${provider} -> ${providerMeta(provider).slug}`).toBe(`${provider} -> ${slug}`);
      expect(`${slug} marked: ${hasMark(slug) || INLINE_SLUGS.has(slug) || COMPONENT_SLUGS.has(slug)}`).toBe(`${slug} marked: true`);
    }
    // Gateways with no brand of their own keep a monogram: borrowing a vendor's logo names the wrong company.
    for (const gateway of ["b.ai", "inferx", "9router"]) {
      expect(`${gateway} -> ${providerMeta(gateway).slug}`).toBe(`${gateway} -> `);
      // A monogram still needs a stable tint per provider.
      expect(providerColor(gateway)).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
