import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  canonicalModelId,
  co2Grams,
  co2GramsFor,
  displayModelId,
  importSessionTokens,
  priceFor,
  usdCost,
} from "../extensions/shared/usage-ledger.js";

// Fixture rows use 2026-09-01 timestamps — keep any host reset watermark
// (which would filter them out of the derived view) out of these tests.
process.env.TERSIO_RESET_FILE = path.join(os.tmpdir(), "tersio-tests-no-reset-marker.json");
if (existsSync(process.env.TERSIO_RESET_FILE)) rmSync(process.env.TERSIO_RESET_FILE);

function fixtureDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-sessions-"));
  mkdirSync(path.join(dir, "branch"), { recursive: true });
  writeFileSync(
    path.join(dir, "branch", "s1.jsonl"),
    [
      '{"type":"session","version":3,"id":"s1","timestamp":"2026-09-01T10:00:00.000Z","cwd":"/tmp"}',
      '{"type":"message","id":"a","timestamp":"2026-09-01T10:01:00.000Z","message":{"role":"assistant","model":"claude-sonnet-5","duration":4200,"usage":{"input":1000,"output":200,"cacheRead":500,"cacheWrite":0,"cost":0.012},"content":[{"type":"toolCall","name":"bash","arguments":{"command":"cd /x && git status"}},{"type":"toolCall","name":"bash"},{"type":"text","text":"done"}]}}',
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
    assert.deepEqual(s.byModel["claude-sonnet-5"], { input: 1000, output: 200, cacheRead: 500, cacheWrite: 0 });
    assert.deepEqual(s.byDay["2026-09-01"], { input: 1000, output: 200, cacheRead: 500, cacheWrite: 0 });
    assert.deepEqual(s.byDay["2026-09-02"], { input: 100, output: 10, cacheRead: 0, cacheWrite: 0 });
    assert.deepEqual(s.byDayModel["2026-09-01"], { "claude-sonnet-5": 1700 });
    assert.deepEqual(s.byDayModel["2026-09-02"], { "mystery-model-9": 110 });
    assert.deepEqual(s.byModelMessages, { "claude-sonnet-5": 1, "mystery-model-9": 1 });
    assert.deepEqual(s.recent, [
      { m: "mystery-model-9", i: 100, o: 10, t: Date.parse("2026-09-02T10:01:00.000Z"), d: undefined, cr: 0, cw: 0, usd: undefined, st: "completed", code: undefined, note: undefined },
      { m: "claude-sonnet-5", i: 1000, o: 200, t: Date.parse("2026-09-01T10:01:00.000Z"), d: 4200, cr: 500, cw: 0, usd: 0.012, st: "completed", code: undefined, note: undefined },
    ]);
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

test("carries measured cost and run status through to recent rows", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-status-"));
  writeFileSync(
    path.join(dir, "s.jsonl"),
    [
      // Real OMP shape: usage.cost is an object with a total, and a failed run
      // carries the HTTP errorStatus plus the provider's message.
      '{"type":"message","id":"a","timestamp":"2026-09-03T10:00:00.000Z","message":{"role":"assistant","model":"glm-5.3-flash","stopReason":"error","errorStatus":404,"errorMessage":"404 model not found\\nsecond line","usage":{"input":10,"output":2,"cacheRead":0,"cacheWrite":0,"cost":{"input":0.0001,"output":0.0002,"total":0.0003}}}}',
      '{"type":"message","id":"b","timestamp":"2026-09-03T10:01:00.000Z","message":{"role":"assistant","model":"glm-5.3-flash","stopReason":"aborted","errorMessage":"Interrupted by user","usage":{"input":5,"output":1,"cacheRead":0,"cacheWrite":0,"cost":{"total":0.000187}}}}',
      '{"type":"message","id":"c","timestamp":"2026-09-03T10:02:00.000Z","message":{"role":"assistant","model":"glm-5.3-flash","stopReason":"toolUse","usage":{"input":7,"output":3,"cacheRead":0,"cacheWrite":0,"cost":{"total":0}}}}',
    ].join("\n") + "\n",
    "utf8",
  );
  const prev = process.env.TERSIO_SESSIONS_DIR;
  process.env.TERSIO_SESSIONS_DIR = dir;
  try {
    const s = importSessionTokens();
    assert.equal(s.recent.length, 3);
    const [c, b, a] = s.recent; // newest first
    assert.deepEqual([a.st, a.code, a.note], ["error", 404, "404 model not found"], "error keeps its status and first line only");
    assert.equal(a.usd, 0.0003, "object-shaped usage.cost is read, not skipped");
    assert.deepEqual([b.st, b.note], ["aborted", "Interrupted by user"]);
    assert.equal(b.usd, 0.000187);
    assert.equal(c.st, "completed", "toolUse is an ordinary completed turn");
    assert.equal(c.usd, 0, "a recorded zero is a measurement, not a missing value");
    // Previously always 0: the old check required usage.cost to be a number,
    // but the host writes an object, so measured cost never accumulated.
    assert.ok(Math.abs(s.costMeasured - (0.0003 + 0.000187)) < 1e-12, `costMeasured was ${s.costMeasured}`);
  } finally {
    if (prev === undefined) delete process.env.TERSIO_SESSIONS_DIR;
    else process.env.TERSIO_SESSIONS_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("usdCost flags unpriced models with priced=false", () => {
  const prev = process.env.TERSIO_PRICES_FILE;
  process.env.TERSIO_PRICES_FILE = path.join("test", "definitely-missing-home", "no-prices.json");
  try {
    const t = { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 };
    const unknown = usdCost(t, "some-future-model-99");
    assert.equal(unknown.usd, 2);
    assert.equal(unknown.priced, false);
    assert.equal(priceFor("some-future-model-99").known, false);
  } finally {
    if (prev === undefined) delete process.env.TERSIO_PRICES_FILE;
    else process.env.TERSIO_PRICES_FILE = prev;
  }
});

test("co2Grams defaults to the gpt-4o served figure", () => {
  assert.equal(co2Grams(5000), co2GramsFor("gpt-4o", 5000));
});
test("free suffix and case variants fold into one model row", () => {
  assert.equal(canonicalModelId("DeepSeek-V4.1-Flash"), canonicalModelId("deepseek-v4.1-flash:free"));
  assert.equal(canonicalModelId("muse-spark-1.3-contributor-free"), "muse-spark-1.3-contributor");
  assert.equal(displayModelId("deepseek-v4.1-flash"), "Deepseek-V4.1-Flash");
  assert.equal(displayModelId("deepseek-v4.1-flash:free"), "Deepseek-V4.1-Flash");
  assert.equal(displayModelId("meta/muse-spark-1.3-contributor"), "meta/Muse-Spark-1.3-Contributor");
  assert.equal(displayModelId("codex/openai"), "codex/OpenAI");
  assert.equal(displayModelId("gemma4:31b"), "Gemma4-31B");
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-modelfold-"));
  writeFileSync(
    path.join(dir, "s.jsonl"),
    [
      '{"timestamp":"2026-09-01T10:00:00.000Z","message":{"role":"assistant","model":"deepseek-v4.1-flash:free","usage":{"input":100,"output":10}}}',
      '{"timestamp":"2026-09-01T10:01:00.000Z","message":{"role":"assistant","model":"DeepSeek-V4.1-Flash","usage":{"input":200,"output":20}}}',
    ].join("\n") + "\n",
    "utf8",
  );
  const prev = process.env.TERSIO_SESSIONS_DIR;
  process.env.TERSIO_SESSIONS_DIR = dir;
  try {
    const s = importSessionTokens();
    assert.deepEqual(Object.keys(s.byModel), ["deepseek-v4.1-flash"]);
    assert.deepEqual(s.byModel["deepseek-v4.1-flash"], { input: 300, output: 30, cacheRead: 0, cacheWrite: 0 });
  } finally {
    if (prev === undefined) delete process.env.TERSIO_SESSIONS_DIR;
    else process.env.TERSIO_SESSIONS_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});
