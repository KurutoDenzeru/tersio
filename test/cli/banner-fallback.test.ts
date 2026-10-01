// The banner must carry the stored combo on every menu, not just the one that
// owns a live status source — a blank last row looks like a broken feature.
import { afterEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// These modules read process.argv at import time, so load them by URL rather
// than letting this runner's arguments reach the flag parsers.
const url = (rel: string): string => new URL("file:///" + path.join(root, rel).replace(/\\/g, "/")).href;

const { setBannerFallback, setBannerStatus, bannerLine } = await import(url("cli/interactive.ts")) as {
  setBannerFallback: (line: string) => void;
  setBannerStatus: (get: (() => string) | undefined) => void;
  bannerLine: () => string;
};

interface ProfileShape {
  comboDefault: string;
  cavemanDefault: string;
  rtkDefault: boolean;
  ponytailDefault: string;
}

const { storedProfile, formatCliStatus } = await import(url("cli/profile.ts")) as {
  storedProfile: () => Promise<ProfileShape>;
  formatCliStatus: (profile: ProfileShape) => string;
};

const MAX = '🧩 combo MAX: 🪨caveman=ULTRA ⚡rtk=ON 🦥ponytail=ULTRA';

afterEach(() => {
  setBannerStatus(undefined);
  setBannerFallback('');
});

test("the banner paints the fallback when no command supplies a live status", () => {
  setBannerFallback('🧩 combo BALANCED: 🪨caveman=FULL ⚡rtk=ON 🦥ponytail=FULL');
  expect(bannerLine()).toContain('combo BALANCED');
});

test("an empty live status must not blank a populated fallback", () => {
  setBannerFallback(MAX);
  // Settings registers its source at import time and returns '' until the first
  // answer. `??` skips only undefined, so an empty string used to win and
  // every other menu drew an empty last row.
  setBannerStatus(() => '');
  expect(bannerLine()).toBe(MAX);
});

test("a live status wins once it has a value", () => {
  setBannerFallback('🧩 combo OFF');
  setBannerStatus(() => '🧩 combo MEDIUM: 🪨caveman=LITE ⚡rtk=ON 🦥ponytail=LITE');
  expect(bannerLine()).toContain('combo MEDIUM');
});

test("the stored defaults reach a menu that opens no live source", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-banner-"));
  const previous = process.env.TERSIO_HOME;
  process.env.TERSIO_HOME = dir;
  try {
    writeFileSync(path.join(dir, "settings.json"), JSON.stringify({
      comboDefault: "max", cavemanDefault: "ultra", rtkDefault: true, ponytailDefault: "ultra",
    }), "utf8");
    setBannerStatus(undefined);
    setBannerFallback(formatCliStatus(await storedProfile()));
    expect(bannerLine()).toBe(MAX);
  } finally {
    if (previous === undefined) delete process.env.TERSIO_HOME;
    else process.env.TERSIO_HOME = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});