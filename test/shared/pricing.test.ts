import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  loadLivePrices,
  priceFor,
  refreshPrices,
} from "../../extensions/shared/pricing.ts";
import { canonicalModelId, usdCost } from "../../extensions/shared/usage-ledger.ts";

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
  // The feed keys it openrouter/stealth/space-bunny-alpha at zero.
  const live = { fetchedAt: Date.now(), exact: { "openrouter/stealth/space-bunny-alpha": [0, 0, 0, 0] } };
  // The feed only keys the alpha tail, so the plain prefixed id stays unpriced.
  const priced = spellings.filter((m) => m.toLowerCase() !== "opencode/opencode/space-bunny");
  for (const model of priced) {
    const hit = priceFor(model, live);
    expect(hit.known, `${model} should be priced from the feed`).toBe(true);
    expect(hit.price.output, model).toBe(0);
  }
});

// --- tiers, provider alignment, and the operator's override -----------------

/** A feed shaped like LiteLLM's: one model keyed under two providers at different rates. */
function twoProviderFeed(): { fetchedAt: number; exact: Record<string, [number, number, number, number]> } {
  return {
    fetchedAt: Date.now(),
    exact: {
      "meta/muse-spark-1.3-contributor": [1, 4, 0.2, 1],
      "opencode-zen/muse-spark-1.3-contributor": [2, 8, 0.4, 2],
    },
  };
}

function withFeed<T>(run: () => T): T {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-feed-"));
  const prev = setEnv({ TERSIO_PRICES_FILE: path.join(dir, "prices.json") });
  try {
    writeFileSync(process.env.TERSIO_PRICES_FILE!, JSON.stringify(twoProviderFeed()), "utf8");
    return run();
  } finally {
    restoreEnv(prev);
    rmSync(dir, { recursive: true, force: true });
  }
}

test("an id the feed holds verbatim reads tier exact", () => {
  withFeed(() => {
    expect(priceFor("opencode-zen/muse-spark-1.3-contributor").tier).toBe("exact");
  });
});

test("a bare tail under another provider reads tier tail, not exact", () => {
  withFeed(() => {
    const hit = priceFor("some-gateway/muse-spark-1.3-contributor");
    expect(hit.tier).toBe("tail");
    expect(hit.price.input).toBe(1);
  });
});

test("a differently cased id still reads exact, because the check folds case", () => {
  withFeed(() => {
    // The verbatim lookup tries the id and its lowercase form, so a case difference is not a
    // guess. This is also why a separate provider-segment tier would be unreachable: a key under
    // the id's own provider with the id's own tail is the id itself.
    const hit = priceFor("opencode-zen/Muse-Spark-1.3-Contributor");
    expect(hit.tier).toBe("exact");
    expect(hit.price.input).toBe(2);
  });
});

test("a third gateway with no row of its own falls to the tail, not the first provider", () => {
  withFeed(() => {
    // Two feed keys end in the same tail. The id names neither, so the tail is the honest answer.
    const hit = priceFor("third-party/muse-spark-1.3-contributor");
    expect(hit.tier).toBe("tail");
    expect(hit.price.input).toBe(1);
  });
});

test("the override file wins over the feed, exactly and by wildcard", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-override-"));
  const prev = setEnv({
    TERSIO_PRICES_FILE: path.join(dir, "prices.json"),
    TERSIO_PRICES_OVERRIDE_FILE: path.join(dir, "prices.local.json"),
  });
  try {
    writeFileSync(process.env.TERSIO_PRICES_FILE!, JSON.stringify(twoProviderFeed()), "utf8");
    writeFileSync(
      process.env.TERSIO_PRICES_OVERRIDE_FILE!,
      JSON.stringify({
        "opencode-zen/muse-spark-1.3-contributor": { input: 9, output: 9, cacheRead: 9, cacheWrite: 9 },
        "*free-tail": { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      }),
      "utf8",
    );
    const exact = priceFor("opencode-zen/muse-spark-1.3-contributor");
    expect(exact.tier).toBe("override");
    expect(exact.price.input).toBe(9);
    // A wildcard covers every gateway prefix, so three spellings share one entry.
    for (const model of ["free-tail", "kilo/stepfun/free-tail", "opencode-zen/free-tail"]) {
      const hit = priceFor(model);
      expect(hit.tier, model).toBe("override");
      expect(hit.price.input, model).toBe(0);
    }
  } finally {
    restoreEnv(prev);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("editing the override takes effect without a feed refresh", () => {
  // The model memo keys on the feed table alone, so an edit used to be invisible until the next
  // refresh. Both directions are pinned here.
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-override-"));
  const prev = setEnv({
    TERSIO_PRICES_FILE: path.join(dir, "prices.json"),
    TERSIO_PRICES_OVERRIDE_FILE: path.join(dir, "prices.local.json"),
  });
  try {
    writeFileSync(process.env.TERSIO_PRICES_FILE!, JSON.stringify(twoProviderFeed()), "utf8");
    const model = "opencode-zen/muse-spark-1.3-contributor";
    expect(priceFor(model).price.input).toBe(2);

    writeFileSync(
      process.env.TERSIO_PRICES_OVERRIDE_FILE!,
      JSON.stringify({ [model]: { input: 7, output: 7, cacheRead: 7, cacheWrite: 7 } }),
      "utf8",
    );
    expect(priceFor(model).tier).toBe("override");
    expect(priceFor(model).price.input).toBe(7);

    rmSync(process.env.TERSIO_PRICES_OVERRIDE_FILE!, { force: true });
    expect(priceFor(model).tier).toBe("exact");
    expect(priceFor(model).price.input).toBe(2);
  } finally {
    restoreEnv(prev);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("usdCost calls only a firm tier priced", () => {
  withFeed(() => {
    const t = { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 };
    const firm = usdCost(t, "opencode-zen/muse-spark-1.3-contributor");
    expect(firm.tier).toBe("exact");
    expect(firm.priced).toBe(true);
    expect(firm.usd).toBe(2);
    // A tail match is another provider's rate, so it is an estimate and must not read as a price.
    const guess = usdCost(t, "third-party/muse-spark-1.3-contributor");
    expect(guess.tier).toBe("tail");
    expect(guess.priced).toBe(false);
    // The default table is an estimate for the same reason.
    const missing = usdCost(t, "nope-9");
    expect(missing.tier).toBe("default");
    expect(missing.priced).toBe(false);
  });
});
