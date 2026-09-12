import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  co2Grams,
  co2GramsFor,
  importSessionTokens,
  priceFor,
  usdCost,
} from "../extensions/shared/usage-ledger.js";

function fixtureDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-sessions-"));
  mkdirSync(path.join(dir, "branch"), { recursive: true });
  writeFileSync(
    path.join(dir, "branch", "s1.jsonl"),
    [
      '{"type":"session","version":3,"id":"s1","timestamp":"2026-09-01T10:00:00.000Z","cwd":"/tmp"}',
      '{"type":"message","id":"a","timestamp":"2026-09-01T10:01:00.000Z","message":{"role":"assistant","model":"claude-sonnet-5","usage":{"input":1000,"output":200,"cacheRead":500,"cacheWrite":0,"cost":0.012},"content":[{"type":"toolCall","name":"bash","arguments":{"command":"cd /x && git status"}},{"type":"toolCall","name":"bash"},{"type":"text","text":"done"}]}}',
      '{"type":"message","id":"b","timestamp":"2026-09-02T10:01:00.000Z","message":{"role":"assistant","model":"mystery-model-9","usage":{"input":100,"output":10,"cacheRead":0,"cacheWrite":0}}}',
      '{"type":"message","id":"c","timestamp":"2026-09-02T10:02:00.000Z","message":{"role":"user","text":"hi"}}',
      'not json at all',
    ].join("\n") + "\n",
    "utf8",
  );
  return dir;
}

test("importer aggregates assistant usage by model and day, skips the rest", () => {
  const dir = fixtureDir();
  const prev = process.env.TERSIO_SESSIONS_DIR;
  process.env.TERSIO_SESSIONS_DIR = dir;
  try {
    const s = importSessionTokens();
    assert.equal(s.messages, 2);
    assert.deepEqual(s.totals, { input: 1100, output: 210, cacheRead: 500, cacheWrite: 0 });
    assert.deepEqual(s.byModel["claude-sonnet-5"], { input: 1000, output: 200, cacheRead: 500, cacheWrite: 0 });
    assert.deepEqual(s.byDay["2026-09-01"], { input: 1000, output: 200, cacheRead: 500, cacheWrite: 0 });
    assert.deepEqual(s.byDay["2026-09-02"], { input: 100, output: 10, cacheRead: 0, cacheWrite: 0 });
    assert.deepEqual(s.byDayModel["2026-09-01"], { "claude-sonnet-5": 1700 });
    assert.deepEqual(s.byDayModel["2026-09-02"], { "mystery-model-9": 110 });
    assert.deepEqual(s.byModelMessages, { "claude-sonnet-5": 1, "mystery-model-9": 1 });
    assert.equal(s.costMeasured, 0.012);
  } finally {
    if (prev === undefined) delete process.env.TERSIO_SESSIONS_DIR;
    else process.env.TERSIO_SESSIONS_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});
test("importer captures codex cache-write tokens with provider label", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-codex-"));
  mkdirSync(path.join(dir, "2026"), { recursive: true });
  writeFileSync(
    path.join(dir, "2026", "rollout-test.jsonl"),
    [
      '{"timestamp":"2026-09-01T10:00:00.000Z","type":"session_meta","payload":{"model_provider":"openai"}}',
      '{"timestamp":"2026-09-01T10:01:00.000Z","type":"event_msg","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":500,"output_tokens":50,"cached_input_tokens":100,"cache_write_input_tokens":250,"total_tokens":900}}}}',
    ].join("\n") + "\n",
    "utf8",
  );
  const prevSessions = process.env.TERSIO_SESSIONS_DIR;
  const prevCodex = process.env.TERSIO_CODEX_DIR;
  process.env.TERSIO_SESSIONS_DIR = path.join("test", "definitely-missing-home", "no-sessions");
  process.env.TERSIO_CODEX_DIR = dir;
  try {
    const s = importSessionTokens();
    assert.equal(s.messages, 1);
    assert.deepEqual(s.totals, { input: 500, output: 50, cacheRead: 100, cacheWrite: 250 });
    assert.deepEqual(s.byModel["codex/openai"], { input: 500, output: 50, cacheRead: 100, cacheWrite: 250 });
    assert.deepEqual(s.byDayModel["2026-09-01"], { "codex/openai": 900 });
  } finally {
    if (prevSessions === undefined) delete process.env.TERSIO_SESSIONS_DIR;
    else process.env.TERSIO_SESSIONS_DIR = prevSessions;
    if (prevCodex === undefined) delete process.env.TERSIO_CODEX_DIR;
    else process.env.TERSIO_CODEX_DIR = prevCodex;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("usdCost prices known models, falls back with priced=false", () => {
  const prev = process.env.TERSIO_PRICES_FILE;
  process.env.TERSIO_PRICES_FILE = path.join("test", "definitely-missing-home", "no-prices.json");
  try {
    const t = { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 };
    assert.equal(usdCost(t, "claude-sonnet-5").usd, 3);
    assert.equal(priceFor("claude-sonnet-5").known, true);
    const unknown = usdCost(t, "mystery-model-9");
    assert.equal(unknown.usd, 3);
    assert.equal(unknown.priced, false);
  } finally {
    if (prev === undefined) delete process.env.TERSIO_PRICES_FILE;
    else process.env.TERSIO_PRICES_FILE = prev;
  }
});

test("co2Grams defaults to the gpt-4o served figure", () => {
  assert.equal(co2Grams(5000), co2GramsFor("gpt-4o", 5000));
});
