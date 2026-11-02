// The machine caches live in the ledger, and the loose files an older build wrote move in on first read.
// Each case imports the module dynamically on purpose: the pricing and cache modules read the data home at
// call time and memoize their last answer, so a static import would freeze the first test's directory.
import { expect, test } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

async function withHome<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-cache-"));
  const prevHome = process.env.TERSIO_HOME;
  const prevFile = process.env.TERSIO_PRICES_FILE;
  const prevOverride = process.env.TERSIO_PRICES_OVERRIDE_FILE;
  process.env.TERSIO_HOME = dir;
  delete process.env.TERSIO_PRICES_FILE;
  delete process.env.TERSIO_PRICES_OVERRIDE_FILE;
  try {
    return await run(dir);
  } finally {
    if (prevHome === undefined) delete process.env.TERSIO_HOME; else process.env.TERSIO_HOME = prevHome;
    if (prevFile !== undefined) process.env.TERSIO_PRICES_FILE = prevFile;
    if (prevOverride !== undefined) process.env.TERSIO_PRICES_OVERRIDE_FILE = prevOverride;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the cache store round-trips a value and lists it by prefix", async () => {
  await withHome(async () => {
    const store = await import("../../extensions/shared/cache-store.ts");
    expect(store.cacheGet("k1")).toBe(null);
    expect(store.cachePut("k1", "line one\nline two\ttab")).toBe(true);
    expect(store.cacheGet("k1")).toBe("line one\nline two\ttab");
    expect(store.cacheKeys("k")).toEqual(["k1"]);
    expect(store.cacheStamp("k1")).toBeGreaterThan(0);
    store.cacheDelete("k1");
    expect(store.cacheGet("k1")).toBe(null);
    expect(store.cacheKeys("k")).toEqual([]);
  });
});

test("a loose prices cache moves into the ledger and the file goes", async () => {
  await withHome(async (dir) => {
    const file = path.join(dir, "prices.json");
    writeFileSync(file, JSON.stringify({ fetchedAt: Date.now(), exact: { "cache-move-model": [1, 2, 0.5, 1] } }), "utf8");
    const pricing = await import("../../extensions/shared/pricing.ts");
    const hit = pricing.priceFor("cache-move-model");
    expect(hit.known).toBe(true);
    expect(hit.price.input).toBe(1);
    expect(existsSync(file)).toBe(false);
    // The ledger answers on its own once the file is gone.
    expect(pricing.loadLivePrices()?.exact["cache-move-model"]?.[0]).toBe(1);
  });
});

test("legacy price overrides move into the settings store", async () => {
  await withHome(async (dir) => {
    const legacy = path.join(dir, "prices.local.json");
    writeFileSync(legacy, JSON.stringify({ "legacy-override-model": { input: 7, output: 8, cacheRead: 0.7, cacheWrite: 7 } }), "utf8");
    const pricing = await import("../../extensions/shared/pricing.ts");
    const hit = pricing.priceFor("legacy-override-model");
    expect(hit.price.input).toBe(7);
    expect(hit.tier).toBe("override");
    expect(existsSync(legacy)).toBe(false);
    // The block is stored where an operator now edits prices: the settings file.
    const settings = JSON.parse(readFileSync(path.join(dir, "settings.json"), "utf8")) as { prices?: Record<string, unknown> };
    expect(Object.keys(settings.prices ?? {})).toContain("legacy-override-model");
  });
});
