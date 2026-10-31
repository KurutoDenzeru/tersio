import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SERVING_CONCURRENCY,
  carbonParamsFor,
  co2GramsFor,
  footprintFor,
} from "../../extensions/shared/carbon.ts";
import {
  loadLivePrices,
  priceFor,
  refreshPrices,
} from "../../extensions/shared/pricing.ts";
import { sqliteEngine, sqliteExec, sqliteRead } from "../../extensions/shared/sqlite.ts";
import { canonicalModelId, usdCost } from "../../extensions/shared/usage-ledger.ts";
import { hasBun, hasSqlite } from "../helpers/env.ts";

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

test("unknown models fall back to the gpt-4o default", () => {
  const { paramSource: _a, ...fallback } = footprintFor("zzz-unknown-9", 1000);
  const { paramSource: _b, ...baseline } = footprintFor("gpt-4o", 1000);
  expect(fallback).toEqual(baseline);
  expect(carbonParamsFor("zzz-unknown-9").source).toBe("default");
});

test("registry models resolve with registry params", () => {
  expect(carbonParamsFor("claude-opus-4-99").source).toBe("registry");
  expect(carbonParamsFor("claude-opus-4-99").provider).toBe("anthropic");
  expect(carbonParamsFor("claude-sonnet-5").source).toBe("registry");
  expect(carbonParamsFor("gemini-2.5-flash").provider).toBe("google");
});

test("larger models cost more per output token", () => {
  const opus = co2GramsFor("claude-opus-4", 1000);
  const sonnet = co2GramsFor("claude-sonnet-5", 1000);
  const haiku = co2GramsFor("claude-haiku-4", 1000);
  expect(opus > sonnet && sonnet > haiku && haiku > 0, `${opus} > ${sonnet} > ${haiku} > 0`).toBeTruthy();
});

test("served figure uses the batch model; the ceiling stays single-stream", () => {
  const f = footprintFor("claude-sonnet-5", 10000);
  expect(f.concurrency).toBe(SERVING_CONCURRENCY);
  // EcoLogits 0.11 folds batching into the regression itself, so the served figure is smaller than the single-stream ceiling but is not a division of it.
  expect(f.gco2 > 0 && f.gco2Ceiling > f.gco2).toBeTruthy();
  expect(f.energyWh > 0).toBeTruthy();
});

test("zero output tokens yields zero footprint", () => {
  expect(footprintFor("gpt-4o", 0)).toEqual({
    energyWh: 0,
    gco2: 0,
    gco2Ceiling: 0,
    concurrency: SERVING_CONCURRENCY,
    provider: "openai",
    paramSource: "registry",
  });
});

test("priceFor reports unknown without a cache, live when cached", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-prices-"));
  const prev = setEnv({ TERSIO_PRICES_FILE: path.join(dir, "missing.json") });
  try {
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

// Two spellings of one model must group as a single row priced at zero.
test("the space-bunny aliases resolve to one free model", () => {
  const spellings = ["space-bunny", "Space-Bunny", "stealth/Space-Bunny-Alpha", "stealth/space-bunny-alpha", "opencode/kilo/stealth/space-bunny-alpha", "opencode/opencode/space-bunny"];
  for (const model of spellings) {
    expect(canonicalModelId(model), model).toBe("space-bunny");
  }
  // The feed keys it openrouter/stealth/space-bunny-alpha at zero.
  const live = { fetchedAt: Date.now(), exact: { "openrouter/stealth/space-bunny-alpha": [0, 0, 0, 0] as [number, number, number, number] } };
  // The feed only keys the alpha tail, so the plain prefixed id stays unpriced.
  const priced = spellings.filter((m) => m.toLowerCase() !== "opencode/opencode/space-bunny");
  for (const model of priced) {
    const hit = priceFor(model, live);
    expect(hit.known, `${model} should be priced from the feed`).toBe(true);
    expect(hit.price.output, model).toBe(0);
  }
});

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
    // The lookup folds case, so a case difference is not a guess; a provider-segment tier would be unreachable.
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
  // The model memo keys on the feed table alone, so an override edit was invisible until the next refresh.
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

// A reader keyed by column name collapses a repeated name and shifts every later cell, so the adapter must answer positionally, the way the sqlite3 CLI did.
test.skipIf(!hasSqlite())("the sqlite adapter keeps cells positional, whichever engine answers", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-sqlite-"));
  const db = path.join(dir, "shape.db");
  const before = process.env.TERSIO_SQLITE;
  const sql = "SELECT a, b AS first, b FROM t ORDER BY b;";
  try {
    delete process.env.TERSIO_SQLITE;
    sqliteExec(db, "CREATE TABLE t (a TEXT, b INTEGER); INSERT INTO t VALUES ('x', 1), (NULL, 2);");
    const viaEngine = sqliteRead(db, sql);
    // NULL is one empty cell, cells join on tabs, and the output ends in a single newline.
    expect(viaEngine).toBe("x\t1\t1\n\t2\t2\n");
    if (sqliteEngine() === "cli") return;
    process.env.TERSIO_SQLITE = "cli";
    // With the binary forced, only a host that actually has one still reports the CLI engine.
    if (sqliteEngine() !== "cli") return;
    expect(sqliteRead(db, sql)).toBe(viaEngine);
  } finally {
    if (before === undefined) delete process.env.TERSIO_SQLITE;
    else process.env.TERSIO_SQLITE = before;
    rmSync(dir, { recursive: true, force: true });
  }
});

// The adapter opens and closes a connection per call, so this holds a second one to stand in for the reader another process keeps: the dashboard reads the store while a sync writes to it.
function heldConnection(db: string): { exec(sql: string): void; rows(sql: string): number; close(): void } {
  const load = createRequire(import.meta.url);
  try {
    const { Database } = load("bun:sqlite") as {
      Database: new (db: string) => { exec(sql: string): void; query(sql: string): { all(): unknown[] }; close(): void };
    };
    const d = new Database(db);
    return { exec: (sql) => d.exec(sql), rows: (sql) => d.query(sql).all().length, close: () => d.close() };
  } catch { /* not Bun; Node carries the same engine */ }
  const { DatabaseSync } = load("node:sqlite") as {
    DatabaseSync: new (db: string) => { exec(sql: string): void; prepare(sql: string): { all(): unknown[] }; close(): void };
  };
  const d = new DatabaseSync(db);
  return { exec: (sql) => d.exec(sql), rows: (sql) => d.prepare(sql).all().length, close: () => d.close() };
}

// A reader must not block a writer and the write path must not move the store out of WAL: the pragma that flipped the mode made a sync throw after its rows had committed, and guarding it left the store in a mode where the next write never landed.
test.skipIf(sqliteEngine() !== "bun" && sqliteEngine() !== "node")(
  "a write commits while another connection holds a read transaction",
  () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-concurrent-"));
    const db = path.join(dir, "usage.db");
    try {
      sqliteExec(db, "PRAGMA journal_mode=WAL; CREATE TABLE t (a INTEGER); INSERT INTO t VALUES (1);");
      expect(sqliteRead(db, "PRAGMA journal_mode;").trim(), "the store is written in WAL").toBe("wal");
      const reader = heldConnection(db);
      try {
        reader.exec("BEGIN");
        expect(reader.rows("SELECT a FROM t;"), "the reader holds a snapshot of one row").toBe(1);
        // The row lands while that snapshot is held: a reader must never block a writer.
        sqliteExec(db, "INSERT INTO t VALUES (2);");
        expect(sqliteRead(db, "SELECT count(*) FROM t;").trim(), "the row committed").toBe("2");
        expect(reader.rows("SELECT a FROM t;"), "the reader keeps its own snapshot").toBe(1);
      } finally {
        reader.exec("COMMIT");
        reader.close();
      }
      expect(sqliteRead(db, "PRAGMA journal_mode;").trim(), "the write left the mode alone").toBe("wal");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

// Vitest runs its workers on Node even when Bun starts the suite, so the Bun engine, the one OMP users get in process, is only reachable by spawning Bun. Both rungs answer byte for byte.
test.skipIf(!hasBun() || !hasSqlite())("the Bun engine answers exactly as this suite's engine", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-bun-rung-"));
  const fixture = "CREATE TABLE t (a TEXT, b INTEGER); INSERT INTO t VALUES ('x', 1), (NULL, 2);";
  const sql = "SELECT a, b AS first, b FROM t ORDER BY b;";
  try {
    const localDb = path.join(dir, "local.db");
    sqliteExec(localDb, fixture);
    const local = sqliteRead(localDb, sql);
    const adapter = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../extensions/shared/sqlite.ts");
    const script = [
      `import { sqliteEngine, sqliteExec, sqliteRead } from ${JSON.stringify(adapter)};`,
      `const db = ${JSON.stringify(path.join(dir, "bun.db"))};`,
      `sqliteExec(db, ${JSON.stringify(fixture)});`,
      `console.log(JSON.stringify({ engine: sqliteEngine(), tsv: sqliteRead(db, ${JSON.stringify(sql)}) }));`,
    ].join("\n");
    const env = { ...process.env };
    // This test is about the Bun rung, not about whichever rung the suite forced for itself.
    delete env.TERSIO_SQLITE;
    const out = spawnSync("bun", ["-e", script], { encoding: "utf8", env });
    expect(out.status, out.stderr).toBe(0);
    const answered = JSON.parse(out.stdout) as { engine: string; tsv: string };
    expect(answered.engine, "Bun answers through bun:sqlite").toBe("bun");
    expect(answered.tsv, "the Bun rung returns what this suite's engine returns").toBe(local);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});