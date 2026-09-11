import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  loadLivePrices,
  priceFor,
  refreshPrices,
} from "../extensions/shared/pricing.js";

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

test("priceFor falls back to the built-in table without a cache", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-prices-"));
  const prev = setEnv({ TERSIO_PRICES_FILE: path.join(dir, "missing.json") });
  try {
    assert.equal(priceFor("claude-sonnet-5").price.input, 3);
    assert.equal(priceFor("claude-sonnet-5").known, true);
    assert.equal(priceFor("mystery-model-9").known, false);
  } finally {
    restoreEnv(prev);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("live cache wins by exact id and expires by TTL", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-prices-"));
  const file = path.join(dir, "prices.json");
  const prev = setEnv({ TERSIO_PRICES_FILE: file });
  try {
    writeFileSync(
      file,
      JSON.stringify({
        fetchedAt: Date.now(),
        exact: { "mystery-model-9": { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 1 } },
      }),
      "utf8",
    );
    const hit = priceFor("mystery-model-9");
    assert.equal(hit.price.input, 1);
    assert.equal(hit.known, true);
    assert.equal(hit.live, true);
    writeFileSync(
      file,
      JSON.stringify({ fetchedAt: 1, exact: { "mystery-model-9": { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 1 } } }),
      "utf8",
    );
    assert.equal(loadLivePrices(), null);
    assert.equal(priceFor("mystery-model-9").known, false);
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
    assert.equal(await refreshPrices(), true);
    assert.equal(priceFor("claude-sonnet-9").price.input, 4);
    assert.equal(priceFor("claude-sonnet-9").live, true);
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
    assert.equal(await refreshPrices(), false);
  } finally {
    restoreEnv(prev);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tersio usage prints per-model USD", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-sessions-"));
  mkdirSync(path.join(dir, "branch"), { recursive: true });
  writeFileSync(
    path.join(dir, "branch", "s1.jsonl"),
    '{"type":"message","id":"a","timestamp":"2026-09-01T10:01:00.000Z","message":{"role":"assistant","model":"claude-sonnet-5","usage":{"input":1000000,"output":0,"cacheRead":0,"cacheWrite":0}}}\n',
    "utf8",
  );
  const root = path.resolve("test", "..");
  const result = spawnSync(process.execPath, [path.join(root, "tersio.js"), "usage"], {
    encoding: "utf8",
    env: {
      ...process.env,
      TERSIO_SESSIONS_DIR: dir,
      TERSIO_USAGE_FILE: path.join(dir, "missing.jsonl"),
      TERSIO_PRICES_FILE: path.join(dir, "missing-prices.json"),
    },
  });
  rmSync(dir, { recursive: true, force: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /claude-sonnet-5: in 1,000,000.*\$3\.00/);
});
