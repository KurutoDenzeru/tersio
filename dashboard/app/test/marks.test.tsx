// Guards the two mark rules: the dashboard never fetches a logo, and every mark it names is vendored.
import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { providerColor, providerMeta, vendorOf, displayModel } from "../src/lib/format";
import { hasMark, maskMark } from "../src/lib/marks";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

/** Hosts that serve a logo over the network. The exported file has to work with the network off. */
const LOGO_HOSTS = [
  "cdn.simpleicons.org",
  "cdn-avatars.huggingface.co",
  "cdn.jsdelivr.net/npm/simple-icons",
  "raw.githubusercontent.com",
  "unpkg.com/simple-icons",
];

/** Marks that live inline in the component rather than in lib/marks. */
const INLINE_SLUGS = new Set(["openai", "stealth", "cognition"]);

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

describe("vendored marks", () => {
  test("no source file references a remote logo host", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const host of LOGO_HOSTS) {
        if (text.includes(host)) offenders.push(`${path.relative(SRC, file)} -> ${host}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("every vendor slug resolves to a vendored or inline mark", () => {
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
    ];
    for (const [model, slug] of models) {
      expect(`${model} -> ${vendorOf(model).slug}`).toBe(`${model} -> ${slug}`);
      if (slug === "") continue;
      expect(`${slug} marked: ${hasMark(slug) || INLINE_SLUGS.has(slug)}`).toBe(`${slug} marked: true`);
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

  test("every provider mark is vendored, and a neutral gateway keeps its monogram", () => {
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
    ];
    for (const [provider, slug] of branded) {
      expect(`${provider} -> ${providerMeta(provider).slug}`).toBe(`${provider} -> ${slug}`);
      expect(hasMark(slug) || INLINE_SLUGS.has(slug)).toBe(true);
    }
    // Neutral gateways serve many vendors, so they carry no vendor mark.
    for (const gateway of ["commandcode", "opencode-zen", "b.ai", "magpie", "inferx", "9router", "kilo", "openrouter"]) {
      expect(`${gateway} -> ${providerMeta(gateway).slug}`).toBe(`${gateway} -> `);
      // A monogram still needs a stable tint per provider.
      expect(providerColor(gateway)).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  test("a masked mark is a self-contained data URI, never a hosted asset", () => {
    for (const slug of ["anthropic", "google", "meta", "deepseek", "qwen", "x", "nvidia", "amd", "kimi", "ollama", "cline", "github"]) {
      const mark = maskMark(slug);
      expect(mark?.startsWith("data:image/svg+xml,")).toBe(true);
      // The only http left is the SVG namespace, which no browser fetches.
      expect(mark).not.toMatch(/https?%3A%2F%2F(?!www\.w3\.org)/);
    }
    expect(maskMark("not-a-vendor")).toBeNull();
  });
});
