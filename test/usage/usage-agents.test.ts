import { expect, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  clearRtkAdoptionCache,
  importSessionTokens,
  readRtkAdoption,
} from "../../extensions/shared/usage-ledger.ts";
import {
  readUsageDb,
  syncUsageDb,
} from "../../extensions/shared/usage-store.ts";

// Fixture rows use 2026-09-01 timestamps — keep any host reset watermark
// (which would filter them out of the derived view) out of these tests.
process.env.TERSIO_RESET_FILE = path.join(os.tmpdir(), "tersio-tests-agents-no-reset-marker.json");
if (existsSync(process.env.TERSIO_RESET_FILE)) rmSync(process.env.TERSIO_RESET_FILE);

const T1 = Date.parse("2026-09-01T10:01:00.000Z");

function seedPi(dir: string): void {
  mkdirSync(path.join(dir, "proj"), { recursive: true });
  writeFileSync(
    path.join(dir, "proj", "s.jsonl"),
    [
      JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: "2026-09-01T10:00:00.000Z", cwd: "/tmp" }),
      JSON.stringify({ type: "model_change", id: "m1", timestamp: "2026-09-01T10:00:01.000Z", provider: "opencode", modelId: "kimi-k2.6" }),
      JSON.stringify({
        type: "message", id: "a", timestamp: "2026-09-01T10:01:00.000Z",
        message: {
          role: "assistant", model: "kimi-k2.6", provider: "opencode", stopReason: "toolUse",
          usage: { input: 1000, output: 200, cacheRead: 50, cacheWrite: 5, totalTokens: 1255, cost: { total: 0 } },
          content: [
            { type: "toolCall", name: "bash", arguments: { command: "rtk git status" } },
            { type: "toolCall", name: "bash", arguments: { command: "ls -la" } },
            { type: "toolCall", name: "read" },
          ],
        },
      }),
      // Pi emits an empty assistant row per turn before the real response.
      JSON.stringify({
        type: "message", id: "b", timestamp: "2026-09-01T10:02:00.000Z",
        message: {
          role: "assistant", model: "kimi-k2.6", provider: "opencode", stopReason: "stop",
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { total: 0 } },
          content: [],
        },
      }),
      JSON.stringify({ type: "message", id: "c", timestamp: "2026-09-01T10:03:00.000Z", message: { role: "user", content: [{ type: "text", text: "hi" }] } }),
      "not json at all",
    ].join("\n") + "\n",
    "utf8",
  );
}

function seedOpencode(dir: string): void {
  mkdirSync(path.join(dir, "ses1"), { recursive: true });
  writeFileSync(
    path.join(dir, "ses1", "msg1.json"),
    JSON.stringify({
      id: "msg1", sessionID: "ses1", role: "assistant",
      time: { created: T1, completed: T1 + 5000 },
      modelID: "gpt-4.1", providerID: "github-copilot", cost: 0,
      tokens: { input: 668, output: 12, reasoning: 0, cache: { read: 9088, write: 0 } },
      finish: "tool-calls",
    }),
    "utf8",
  );
  writeFileSync(
    path.join(dir, "ses1", "msg2.json"),
    JSON.stringify({ id: "msg2", sessionID: "ses1", role: "user", time: { created: T1 - 1000 } }),
    "utf8",
  );
  writeFileSync(
    path.join(dir, "ses1", "msg3.json"),
    JSON.stringify({
      id: "msg3", sessionID: "ses1", role: "assistant",
      time: { created: T1 + 60000, completed: T1 + 61000 },
      modelID: "gpt-4.1", providerID: "github-copilot", cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      finish: "stop",
    }),
    "utf8",
  );
}

function withIsolation(seeds: { pi?: boolean; oc?: boolean }, fn: (dirs: { sessions: string; pi: string; oc: string }) => void): void {
  const root = mkdtempSync(path.join(os.tmpdir(), "tersio-agents-"));
  const sessions = path.join(root, "sessions");
  const pi = path.join(root, "pi");
  const oc = path.join(root, "oc");
  mkdirSync(sessions, { recursive: true });
  if (seeds.pi !== false) seedPi(pi);
  else mkdirSync(pi, { recursive: true });
  if (seeds.oc !== false) seedOpencode(oc);
  else mkdirSync(oc, { recursive: true });
  const prev = {
    sessions: process.env.TERSIO_SESSIONS_DIR,
    pi: process.env.TERSIO_PI_DIR,
    oc: process.env.TERSIO_OPENCODE_DIR,
  };
  // Pointing the sessions override at an empty dir isolates the run from the
  // real home: only explicitly set sources are walked.
  process.env.TERSIO_SESSIONS_DIR = sessions;
  process.env.TERSIO_PI_DIR = pi;
  process.env.TERSIO_OPENCODE_DIR = oc;
  try {
    fn({ sessions, pi, oc });
  } finally {
    if (prev.sessions === undefined) delete process.env.TERSIO_SESSIONS_DIR;
    else process.env.TERSIO_SESSIONS_DIR = prev.sessions;
    if (prev.pi === undefined) delete process.env.TERSIO_PI_DIR;
    else process.env.TERSIO_PI_DIR = prev.pi;
    if (prev.oc === undefined) delete process.env.TERSIO_OPENCODE_DIR;
    else process.env.TERSIO_OPENCODE_DIR = prev.oc;
    rmSync(root, { recursive: true, force: true });
  }
}

test("importer reads pi transcripts: usage, tools, and skips empty rows", () => {
  withIsolation({ oc: false }, () => {
    const s = importSessionTokens();
    expect(s.byModel["kimi-k2.6"]).toEqual({ input: 1000, output: 200, cacheRead: 50, cacheWrite: 5 });
    expect(s.messages).toBe(1);
    expect(s.byTool).toEqual({ "bash:rtk": 1, "bash:ls": 1, read: 1 });
    expect(s.byModelMessages).toEqual({ "kimi-k2.6": 1 });
    expect(s.recent).toEqual([
      { m: "kimi-k2.6", i: 1000, o: 200, t: T1, d: undefined, cr: 50, cw: 5, usd: 0, st: "completed", code: undefined, note: undefined },
    ]);
  });
});

test("importer reads opencode message files under provider/model keys", () => {
  withIsolation({ pi: false }, () => {
    const s = importSessionTokens();
    const key = "opencode/github-copilot/gpt-4.1";
    expect(s.byModel[key]).toEqual({ input: 668, output: 12, cacheRead: 9088, cacheWrite: 0 });
    expect(s.byModelMessages[key]).toBe(1);
    expect(s.byDay["2026-09-01"]).toEqual({ input: 668, output: 12, cacheRead: 9088, cacheWrite: 0 });
    expect(s.byDayModel["2026-09-01"][key]).toBe(9768);
    expect(s.recent).toEqual([
      { m: key, i: 668, o: 12, t: T1, d: 5000, cr: 9088, cw: 0, usd: 0, st: "completed", code: undefined, note: undefined },
    ]);
  });
});

test("adoption counts pi bash tool calls, including rtk", () => {
  withIsolation({ oc: false }, () => {
    clearRtkAdoptionCache();
    const a = readRtkAdoption();
    expect(a.bashCalls).toBe(2);
    expect(a.eligibleCalls).toBe(2);
    expect(a.rtkCalls).toBe(1);
    expect(a.sessions).toBe(1);
  });
});

test("store sync persists pi and opencode rows where the dashboard reads them", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "tersio-agents-db-"));
  const sessions = path.join(root, "sessions");
  const pi = path.join(root, "pi");
  const oc = path.join(root, "oc");
  mkdirSync(sessions, { recursive: true });
  seedPi(pi);
  seedOpencode(oc);
  const prev = {
    db: process.env.TERSIO_USAGE_DB,
    sessions: process.env.TERSIO_SESSIONS_DIR,
    pi: process.env.TERSIO_PI_DIR,
    oc: process.env.TERSIO_OPENCODE_DIR,
    codex: process.env.TERSIO_CODEX_DIR,
  };
  process.env.TERSIO_USAGE_DB = path.join(root, "usage.db");
  process.env.TERSIO_SESSIONS_DIR = sessions;
  process.env.TERSIO_PI_DIR = pi;
  process.env.TERSIO_OPENCODE_DIR = oc;
  delete process.env.TERSIO_CODEX_DIR;
  try {
    expect(syncUsageDb()).toBe(true);
    const stored = readUsageDb();
    expect(stored).not.toBeNull();
    expect(stored!.tokens.byModel["kimi-k2.6"]).toEqual({ input: 1000, output: 200, cacheRead: 50, cacheWrite: 5 });
    expect(stored!.tokens.byModel["opencode/github-copilot/gpt-4.1"]).toEqual({ input: 668, output: 12, cacheRead: 9088, cacheWrite: 0 });
    expect(stored!.tokens.messages).toBe(2);
  } finally {
    if (prev.db === undefined) delete process.env.TERSIO_USAGE_DB;
    else process.env.TERSIO_USAGE_DB = prev.db;
    if (prev.sessions === undefined) delete process.env.TERSIO_SESSIONS_DIR;
    else process.env.TERSIO_SESSIONS_DIR = prev.sessions;
    if (prev.pi === undefined) delete process.env.TERSIO_PI_DIR;
    else process.env.TERSIO_PI_DIR = prev.pi;
    if (prev.oc === undefined) delete process.env.TERSIO_OPENCODE_DIR;
    else process.env.TERSIO_OPENCODE_DIR = prev.oc;
    if (prev.codex === undefined) delete process.env.TERSIO_CODEX_DIR;
    else process.env.TERSIO_CODEX_DIR = prev.codex;
    rmSync(root, { recursive: true, force: true });
  }
});
