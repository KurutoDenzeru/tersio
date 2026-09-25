import { expect, test } from "vitest";
import { appendFileSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  canonicalModelId,
  co2Grams,
  co2GramsFor,
  displayModelId,
  importSessionTokens,
  clearRtkAdoptionCache,
  priceFor,
  readRtkAdoption,
  usdCost,
} from "../../extensions/shared/usage-ledger.ts";

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
      '{"type":"message","id":"a","timestamp":"2026-09-01T10:01:00.000Z","message":{"role":"assistant","model":"claude-sonnet-5","duration":4200,"usage":{"input":1000,"output":200,"cacheRead":500,"cacheWrite":125,"cost":0.012},"content":[{"type":"toolCall","name":"bash","arguments":{"command":"rtk git status"}},{"type":"toolCall","name":"bash","arguments":{"command":"cd /x && git status"}},{"type":"toolCall","name":"read"}]}}',
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
    expect(s.byModel["claude-sonnet-5"]).toEqual({ input: 1000, output: 200, cacheRead: 500, cacheWrite: 125 });
    expect(s.byDay["2026-09-01"]).toEqual({ input: 1000, output: 200, cacheRead: 500, cacheWrite: 125 });
    expect(s.byDay["2026-09-02"]).toEqual({ input: 100, output: 10, cacheRead: 0, cacheWrite: 0 });
    expect(s.byDayModel["2026-09-01"]).toEqual({ "claude-sonnet-5": 1825 });
    expect(s.byDayModel["2026-09-02"]).toEqual({ "mystery-model-9": 110 });
    expect(s.byModelMessages).toEqual({ "claude-sonnet-5": 1, "mystery-model-9": 1 });
    expect(s.recent).toEqual([
      { m: "mystery-model-9", i: 100, o: 10, t: Date.parse("2026-09-02T10:01:00.000Z"), d: undefined, cr: 0, cw: 0, usd: undefined, st: "completed", code: undefined, note: undefined },
      { m: "claude-sonnet-5", i: 1000, o: 200, t: Date.parse("2026-09-01T10:01:00.000Z"), d: 4200, cr: 500, cw: 125, usd: 0.012, st: "completed", code: undefined, note: undefined },
    ]);
    expect(s.costMeasured).toBe(0.012);
  } finally {
    if (prev === undefined) delete process.env.TERSIO_SESSIONS_DIR;
    else process.env.TERSIO_SESSIONS_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("adoption reads executed Bash commands, not assistant tool-call intent", () => {
  const dir = fixtureDir();
  appendFileSync(path.join(dir, "branch", "s1.jsonl"), [
    JSON.stringify({ type: "custom", customType: "tool_execution_start", data: { toolName: "bash", args: { command: "git status --short" } } }),
    JSON.stringify({ type: "custom", customType: "tool_execution_start", data: { toolName: "bash", args: { command: "rtk git status --short" } } }),
    JSON.stringify({ type: "custom", customType: "tool_execution_start", data: { toolName: "bash", args: { command: "python3 script.py" } } }),
  ].join("\n") + "\n", "utf8");
  const prev = process.env.TERSIO_SESSIONS_DIR;
  process.env.TERSIO_SESSIONS_DIR = dir;
  try {
    clearRtkAdoptionCache();
    expect(readRtkAdoption()).toEqual({ sessions: 1, bashCalls: 3, eligibleCalls: 2, rtkCalls: 1, missedCalls: 1, adoptionPct: 50 });
    expect(readRtkAdoption()).toEqual({ sessions: 1, bashCalls: 3, eligibleCalls: 2, rtkCalls: 1, missedCalls: 1, adoptionPct: 50 });
    appendFileSync(path.join(dir, "branch", "s1.jsonl"), `${JSON.stringify({ type: "custom", customType: "tool_execution_start", data: { toolName: "bash", args: { command: "rtk git diff" } } })}\n`, "utf8");
    expect(readRtkAdoption()).toEqual({ sessions: 1, bashCalls: 4, eligibleCalls: 3, rtkCalls: 2, missedCalls: 1, adoptionPct: (2 / 3) * 100 });
  } finally {
    clearRtkAdoptionCache();
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
    expect(s.messages).toBe(1);
    expect(s.totals).toEqual({ input: 500, output: 50, cacheRead: 100, cacheWrite: 250 });
    expect(s.byModel["codex/openai"]).toEqual({ input: 500, output: 50, cacheRead: 100, cacheWrite: 250 });
    expect(s.byDayModel["2026-09-01"]).toEqual({ "codex/openai": 900 });
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
    expect(s.recent.length).toBe(3);
    const [c, b, a] = s.recent; // newest first
    expect([a.st, a.code, a.note], "error keeps its status and first line only").toEqual(["error", 404, "404 model not found"]);
    expect(a.usd, "object-shaped usage.cost is read, not skipped").toBe(0.0003);
    expect([b.st, b.note]).toEqual(["aborted", "Interrupted by user"]);
    expect(b.usd).toBe(0.000187);
    expect(c.st, "toolUse is an ordinary completed turn").toBe("completed");
    expect(c.usd, "a recorded zero is a measurement, not a missing value").toBe(0);
    // Previously always 0: the old check required usage.cost to be a number,
    // but the host writes an object, so measured cost never accumulated.
    expect(Math.abs(s.costMeasured - (0.0003 + 0.000187)) < 1e-12, `costMeasured was ${s.costMeasured}`).toBeTruthy();
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
    expect(unknown.usd).toBe(2);
    expect(unknown.priced).toBe(false);
    expect(priceFor("some-future-model-99").known).toBe(false);
  } finally {
    if (prev === undefined) delete process.env.TERSIO_PRICES_FILE;
    else process.env.TERSIO_PRICES_FILE = prev;
  }
});

test("co2Grams defaults to the gpt-4o served figure", () => {
  expect(co2Grams(5000)).toBe(co2GramsFor("gpt-4o", 5000));
});
test("free suffix and case variants fold into one model row", () => {
  expect(canonicalModelId("DeepSeek-V4.1-Flash")).toBe(canonicalModelId("deepseek-v4.1-flash:free"));
  expect(canonicalModelId("muse-spark-1.3-contributor-free")).toBe("muse-spark-1.3-contributor");
  expect(displayModelId("deepseek-v4.1-flash")).toBe("Deepseek-V4.1-Flash");
  expect(displayModelId("deepseek-v4.1-flash:free")).toBe("Deepseek-V4.1-Flash");
  expect(displayModelId("meta/muse-spark-1.3-contributor")).toBe("meta/Muse-Spark-1.3-Contributor");
  expect(displayModelId("codex/openai")).toBe("codex/OpenAI");
  expect(displayModelId("gemma4:31b")).toBe("Gemma4-31B");
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
    expect(Object.keys(s.byModel)).toEqual(["deepseek-v4.1-flash"]);
    expect(s.byModel["deepseek-v4.1-flash"]).toEqual({ input: 300, output: 30, cacheRead: 0, cacheWrite: 0 });
  } finally {
    if (prev === undefined) delete process.env.TERSIO_SESSIONS_DIR;
    else process.env.TERSIO_SESSIONS_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});
