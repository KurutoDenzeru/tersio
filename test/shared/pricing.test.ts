import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { loadCatalog, priceFor, providerLabels, refreshPrices } from "../../extensions/shared/pricing.ts";
import { canonicalModelId } from "../../extensions/shared/usage-ledger.ts";

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

type Rates = [number, number, number, number];

/** The shipped shape: provider id to label and models, each model to [in, out, cacheRead, cacheWrite]. */
function writeCatalog(file: string, fetchedAt: number, providers: Record<string, Record<string, Rates>>): void {
  writeFileSync(
    file,
    JSON.stringify({
      fetchedAt,
      providers: Object.fromEntries(
        Object.entries(providers).map(([id, models]) => [id, { label: id, models }]),
      ),
    }),
    "utf8",
  );
}

test("an absent catalog prices nothing instead of guessing", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-prices-"));
  const prev = setEnv({ TERSIO_PRICES_FILE: path.join(dir, "missing.json") });
  try {
    // No catalog: unknown, and honestly flagged. No default rate is applied to a total.
    expect(priceFor("claude-sonnet-5").known).toBe(false);
    expect(priceFor("claude-sonnet-5").live).toBe(false);
    expect(priceFor("some-future-model-99").known).toBe(false);
  } finally {
    restoreEnv(prev);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rates resolve within the model's own provider first", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-prices-"));
  const file = path.join(dir, "prices.json");
  const prev = setEnv({ TERSIO_PRICES_FILE: file });
  try {
    writeCatalog(file, Date.now(), {
      anthropic: { "claude-sonnet-5": [3, 15, 0.3, 3.75] },
      // The same id resold elsewhere at a different rate must not win over the model's own provider.
      reseller: { "claude-sonnet-5": [9, 9, 9, 9] },
    });
    expect(priceFor("claude-sonnet-5").price.input).toBe(3);
    expect(priceFor("claude-sonnet-5").known).toBe(true);
    // A provider-prefixed id resolves through the same provider.
    expect(priceFor("anthropic/claude-sonnet-5").price.input).toBe(3);
    expect(priceFor("claude-sonnet-5").live).toBe(true);
  } finally {
    restoreEnv(prev);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a gateway id falls through to the provider that really serves the model", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-prices-"));
  const file = path.join(dir, "prices.json");
  const prev = setEnv({ TERSIO_PRICES_FILE: file });
  try {
    writeCatalog(file, Date.now(), { nvidia: { "deepseek-ai/deepseek-v4-flash": [0.2, 0.6, 0.05, 0.2] } });
    // opencode nests the real provider after its own namespace, so the agent namespace is skipped.
    expect(priceFor("opencode/nvidia/deepseek-ai/deepseek-v4-flash").price.output).toBe(0.6);
    expect(priceFor("nvidia/deepseek-ai/deepseek-v4-flash").price.output).toBe(0.6);
    // A bare tail is ambiguous: several providers can list the same model name, so it stays unknown
    // rather than picking one reseller's rate.
    expect(priceFor("deepseek-v4-flash").known).toBe(false);
  } finally {
    restoreEnv(prev);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a stale catalog stays readable", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-prices-"));
  const file = path.join(dir, "prices.json");
  const prev = setEnv({ TERSIO_PRICES_FILE: file });
  try {
    writeCatalog(file, 1, { anthropic: { "claude-sonnet-5": [1, 2, 0.5, 1] } });
    // Stale-while-revalidate: a stale file is still used rather than dropping to unknown.
    expect(loadCatalog()).not.toBe(null);
    expect(priceFor("claude-sonnet-5").known).toBe(true);
    // The object form of a rate is accepted too, so a shape bump never orphans the cache.
    writeFileSync(
      file,
      JSON.stringify({ fetchedAt: 1, providers: { anthropic: { label: "Anthropic", models: { "claude-sonnet-5": { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 1 } } } } }),
      "utf8",
    );
    expect(priceFor("claude-sonnet-5").price.input).toBe(1);
  } finally {
    restoreEnv(prev);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refreshPrices parses a models.dev payload and caches it", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-prices-"));
  // models.dev shape: provider id to a record with name and models, each model carrying a cost.
  const payload = encodeURIComponent(
    JSON.stringify({
      anthropic: {
        id: "anthropic",
        name: "Anthropic",
        models: {
          "claude-sonnet-9": { id: "claude-sonnet-9", cost: { input: 4, output: 20, cache_read: 0.4, cache_write: 5 } },
          // A model with no cost contributes no rate and must not become a zero-price entry.
          "claude-priceless": { id: "claude-priceless" },
        },
      },
      empty: { id: "empty", name: "Empty", models: {} },
    }),
  );
  const prev = setEnv({
    TERSIO_PRICES_FILE: path.join(dir, "prices.json"),
    TERSIO_PRICES_URL: `data:application/json,${payload}`,
  });
  try {
    expect(await refreshPrices()).toBe(true);
    // models.dev already quotes per million tokens, so no scaling is applied.
    expect(priceFor("claude-sonnet-9").price.input).toBe(4);
    expect(priceFor("claude-sonnet-9").price.output).toBe(20);
    expect(priceFor("claude-sonnet-9").live).toBe(true);
    expect(priceFor("claude-priceless").known).toBe(false);
    expect(providerLabels(loadCatalog()).map((p) => p.id)).toEqual(["anthropic"]);
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

test("tersio usage prices from the provider catalog", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-sessions-"));
  mkdirSync(path.join(dir, "branch"), { recursive: true });
  writeFileSync(
    path.join(dir, "branch", "s1.jsonl"),
    '{"type":"message","id":"a","timestamp":"2026-09-01T10:01:00.000Z","message":{"role":"assistant","model":"claude-sonnet-5","usage":{"input":1000000,"output":0,"cacheRead":0,"cacheWrite":0}}}\n',
    "utf8",
  );
  writeCatalog(path.join(dir, "prices.json"), Date.now(), { anthropic: { "claude-sonnet-5": [2, 10, 0.2, 2.5] } });
  const root = path.resolve("test", "..");
  const result = spawnSync(process.execPath, [path.join(root, "dist", "tersio.js"), "usage"], {
    encoding: "utf8",
    env: {
      ...process.env,
      // Isolate HOME so ambient settings can't leak into currency assertions.
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
  expect(result.stdout).toMatch(/Anthropic - Claude - Sonnet-5.*1,000,000.*\$2\.00/);
});

// Two spellings of one model must group as a single row priced at zero.
test("the space-bunny aliases resolve to one free model", () => {
  const spellings = ["space-bunny", "Space-Bunny", "stealth/Space-Bunny-Alpha", "stealth/space-bunny-alpha", "opencode/kilo/stealth/space-bunny-alpha", "opencode/opencode/space-bunny"];
  for (const model of spellings) {
    expect(canonicalModelId(model), model).toBe("space-bunny");
  }
  // The catalog lists the model under the stealth provider at zero, and only under its alpha tail.
  const live = {
    fetchedAt: Date.now(),
    providers: { stealth: { label: "Stealth", models: { "space-bunny-alpha": [0, 0, 0, 0] as Rates } } },
  };
  for (const model of spellings) {
    const hit = priceFor(model, live);
    expect(hit.known, `${model} should be priced from the catalog`).toBe(true);
    expect(hit.price.output, model).toBe(0);
  }
});
