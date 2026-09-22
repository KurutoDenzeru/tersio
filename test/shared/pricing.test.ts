import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  loadLivePrices,
  priceFor,
  refreshPrices,
} from "../../extensions/shared/pricing.js";

function setEnv(vars: Record<string, string | undefined>): Record<string, string | undefined> {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    prev[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k] as string;
  }
  return prev;
}

function restoreEnv(prev: Record<string, string | undefined>): void {
  for (const k of Object.keys(prev)) {
    if (prev[k] === undefined) delete process.env[k];
    else process.env[k] = prev[k] as string;
  }
}

test("priceFor reports unknown without a cache, live when cached", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-prices-"));
  const prev = setEnv({ TERSIO_PRICES_FILE: path.join(dir, "missing.json") });
  try {
    // No cache: every model is unknown, default-priced, honestly flagged.
    expect(priceFor("claude-sonnet-5").known).toBe(false);
    expect(priceFor("claude-sonnet-5").live).toBe(false);
    expect(priceFor("some-future-model-99").known).toBe(false);
  } finally {
    restoreEnv(prev);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("live cache wins by exact id and stays usable when stale", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-prices-"));
  const file = path.join(dir, "prices.json");
  const prev = setEnv({ TERSIO_PRICES_FILE: file });
  try {
    writeFileSync(
      file,
      JSON.stringify({
        fetchedAt: Date.now(),
        exact: { "uncached-test-model": [1, 2, 0.5, 1] },
      }),
      "utf8",
    );
    const hit = priceFor("uncached-test-model");
    expect(hit.price.input).toBe(1);
    expect(hit.known).toBe(true);
    expect(hit.live).toBe(true);
    // Stale cache stays readable (stale-while-revalidate); old object shape too.
    writeFileSync(
      file,
      JSON.stringify({ fetchedAt: 1, exact: { "uncached-test-model": [1, 2, 0.5, 1] } }),
      "utf8",
    );
    expect(loadLivePrices()).not.toBe(null);
    expect(priceFor("uncached-test-model").known).toBe(true);
    writeFileSync(
      file,
      JSON.stringify({ fetchedAt: 1, exact: { "uncached-test-model": { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 1 } } }),
      "utf8",
    );
    expect(priceFor("uncached-test-model").price.input).toBe(1);
    // Provider-prefixed ids resolve from the bare model name.
    writeFileSync(
      file,
      JSON.stringify({ fetchedAt: Date.now(), exact: { "azure/gpt-4o": [2.5, 10, 1.25, 2.5] } }),
      "utf8",
    );
    expect(priceFor("gpt-4o").price.input).toBe(2.5);
    expect(priceFor("gpt-4o").live).toBe(true);
  } finally {
    restoreEnv(prev);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refreshPrices parses a LiteLLM payload and caches it", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-prices-"));
  const payload = encodeURIComponent(
    JSON.stringify({
      "claude-sonnet-9": {
        input_cost_per_token: 0.000004,
        output_cost_per_token: 0.00002,
        cache_read_input_token_cost: 0.0000004,
        cache_creation_input_token_cost: 0.000005,
      },
      "unrelated-thing": { nope: true },
    }),
  );
  const prev = setEnv({
    TERSIO_PRICES_FILE: path.join(dir, "prices.json"),
    TERSIO_PRICES_URL: `data:application/json,${payload}`,
  });
  try {
    expect(await refreshPrices()).toBe(true);
    expect(priceFor("claude-sonnet-9").price.input).toBe(4);
    expect(priceFor("claude-sonnet-9").live).toBe(true);
  } finally {
    restoreEnv(prev);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refreshPrices returns false on fetch failure", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-prices-"));
  const prev = setEnv({
    TERSIO_PRICES_FILE: path.join(dir, "prices.json"),
    TERSIO_PRICES_URL: "http://127.0.0.1:1/definitely-not-here.json",
  });
  try {
    expect(await refreshPrices()).toBe(false);
  } finally {
    restoreEnv(prev);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tersio usage prices from the live cache", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-sessions-"));
  mkdirSync(path.join(dir, "branch"), { recursive: true });
  writeFileSync(
    path.join(dir, "branch", "s1.jsonl"),
    '{"type":"message","id":"a","timestamp":"2026-09-01T10:01:00.000Z","message":{"role":"assistant","model":"claude-sonnet-5","usage":{"input":1000000,"output":0,"cacheRead":0,"cacheWrite":0}}}\n',
    "utf8",
  );
  writeFileSync(
    path.join(dir, "prices.json"),
    JSON.stringify({ fetchedAt: Date.now(), exact: { "claude-sonnet-5": [2, 10, 0.2, 2.5] } }),
    "utf8",
  );
  const root = path.resolve("test", "..");
  const result = spawnSync(process.execPath, [path.join(root, "tersio.js"), "usage"], {
    encoding: "utf8",
    env: {
      ...process.env,
      // Isolate HOME: usage display currency falls back to the stored plugin
      // default, so an ambient lock file would otherwise leak into assertions.
      HOME: dir,
      USERPROFILE: dir,
      TERSIO_SESSIONS_DIR: dir,
      TERSIO_USAGE_FILE: path.join(dir, "missing.jsonl"),
      TERSIO_PRICES_FILE: path.join(dir, "prices.json"),
      TERSIO_RESET_FILE: path.join(dir, "missing-reset.json"),
    },
  });
  rmSync(dir, { recursive: true, force: true });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(/Claude-Sonnet-5.*1,000,000.*\$2\.00/);
});
