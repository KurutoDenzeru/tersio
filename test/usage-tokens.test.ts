import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CO2_G_PER_1K_OUTPUT,
  co2Grams,
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
    assert.deepEqual(s.byTool, { "bash:git": 1, "bash:bash": 1 });
    assert.equal(s.costMeasured, 0.012);
  } finally {
    if (prev === undefined) delete process.env.TERSIO_SESSIONS_DIR;
    else process.env.TERSIO_SESSIONS_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("usdCost prices known models, falls back with priced=false", () => {
  const t = { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 };
  assert.equal(usdCost(t, "claude-sonnet-5").usd, 3);
  assert.equal(priceFor("claude-sonnet-5").known, true);
  const unknown = usdCost(t, "mystery-model-9");
  assert.equal(unknown.usd, 3);
  assert.equal(unknown.priced, false);
});

test("co2Grams scales linearly on the documented factor", () => {
  assert.equal(co2Grams(5000), 5 * CO2_G_PER_1K_OUTPUT);
});
