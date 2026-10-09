// Vendored brand marks. The dashboard and its exported file never fetch a logo at runtime.
// Files come from `scripts/fetch-marks.ts`; see SOURCES.md beside them for the origin of each.
// Simple Icons paths carry no fill, so a mask against them follows the theme ink through alpha.
import anthropic from "./anthropic.svg?raw";
import google from "./google.svg?raw";
import meta from "./meta.svg?raw";
import deepseek from "./deepseek.svg?raw";
import qwen from "./qwen.svg?raw";
import x from "./x.svg?raw";
import mistralai from "./mistralai.svg?raw";
import minimax from "./minimax.svg?raw";
import zdotai from "./zdotai.svg?raw";
import xiaomi from "./xiaomi.svg?raw";
import kimi from "./kimi.svg?raw";
import moonshotai from "./moonshotai.svg?raw";
import nvidia from "./nvidia.svg?raw";
import amd from "./amd.svg?raw";
import ollama from "./ollama.svg?raw";
import cline from "./cline.svg?raw";
import githubcopilot from "./githubcopilot.svg?raw";
import openrouter from "./openrouter.svg?raw";
import github from "./github.svg?raw";
import instagram from "./instagram.svg?raw";

import groqUrl from "./groq.svg";
import poolsideUrl from "./poolside.svg";
import cerebrasUrl from "./cerebras.png";
import inclusionaiUrl from "./inclusionai.webp";

/** Monochrome files, drawn as a CSS mask filled with `currentColor`. */
const MASKED: Record<string, string> = {
  anthropic, google, meta, deepseek, qwen, x, mistralai, minimax, zdotai, xiaomi,
  kimi, moonshotai, nvidia, amd, ollama, cline, githubcopilot, openrouter, github, instagram,
};

/** Files that carry their own color, drawn as an image inside a neutral tile. */
export const MARK_IMAGES: Record<string, string> = {
  groq: groqUrl,
  poolside: poolsideUrl,
  cerebras: cerebrasUrl,
  inclusionai: inclusionaiUrl,
};

const DATA_URIS = new Map<string, string>(
  Object.entries(MASKED).map(([slug, svg]) => [slug, `data:image/svg+xml,${encodeURIComponent(svg.trim())}`]),
);

/** A maskable mark for the slug, or null when the mark is not vendored. */
export function maskMark(slug: string): string | null {
  return DATA_URIS.get(slug) ?? null;
}

/** A full-color mark for the slug, or null when the mark is not vendored. */
export function imageMark(slug: string): string | null {
  return slug in MARK_IMAGES ? MARK_IMAGES[slug] : null;
}

export function hasMark(slug: string): boolean {
  return DATA_URIS.has(slug) || slug in MARK_IMAGES;
}
