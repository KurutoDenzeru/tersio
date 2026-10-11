// The store is one mirror over every agent Tersio can read: omp and pi transcripts, plus both
// on-disk shapes OpenCode has used. Each test points the env seams at a fixture home.
import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { readUsageDb, syncUsageDb, usageDbPath } from "../../extensions/shared/usage-store.ts";
import { RECENT_LIMIT, ingestSessionRow, newSessionAccum } from "../../extensions/shared/usage-ledger.ts";
import { hasSqlite } from "../helpers/env.ts";

/** Pure ingest needs no disk, only the absence of a reset marker. */
function withNoReset(fn: () => void): void {
  const prev = process.env.TERSIO_RESET_FILE;
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-reset-"));
  process.env.TERSIO_RESET_FILE = path.join(dir, "reset.json");
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.TERSIO_RESET_FILE;
    else process.env.TERSIO_RESET_FILE = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

const HOME_KEYS = ["HOME", "USERPROFILE", "TERSIO_USAGE_DB", "TERSIO_OPENCODE_DIR", "TERSIO_OPENCODE_DB", "TERSIO_RESET_FILE", "TERSIO_SESSIONS_DIR"] as const;

/**
 * A fixture home. HOME is what picks the two transcript dirs and the reset watermark, so the
 * override vars point at the same fixture: `~/.omp/agent/sessions` and `~/.pi/agent/sessions`,
 * OpenCode's JSON tree and its v2 db.
 */
function withHome(dir: string, fn: () => void): void {
  const prev = new Map<string, string | undefined>(HOME_KEYS.map((key) => [key, process.env[key]]));
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  delete process.env.TERSIO_SESSIONS_DIR;
  process.env.TERSIO_USAGE_DB = path.join(dir, "usage.db");
  process.env.TERSIO_RESET_FILE = path.join(dir, "reset.json");
  process.env.TERSIO_OPENCODE_DIR = path.join(dir, "opencode", "message");
  process.env.TERSIO_OPENCODE_DB = path.join(dir, "opencode", "opencode.db");
  try {
    fn();
  } finally {
    for (const [key, value] of prev) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** One assistant message in an omp or pi transcript, so the token buckets land in the store. */
function transcriptMessage(model: string, tokens: Record<string, number>, at: string): Record<string, unknown> {
  return {
    role: "assistant",
    model,
    content: [],
    usage: {
      input: tokens.input ?? 0,
      output: tokens.output ?? 0,
      cacheRead: tokens.cacheRead ?? 0,
      cacheWrite: tokens.cacheWrite ?? 0,
    },
    timestamp: at,
    stopReason: "completed",
  };
}

function writeTranscript(dir: string, name: string, model: string, tokens: Record<string, number>, at: string): void {
  const file = path.join(dir, name);
  mkdirSync(path.dirname(file), { recursive: true });
  const lines = [
    JSON.stringify({ type: "session", version: 3, id: name, timestamp: at, cwd: "/tmp/project" }),
    JSON.stringify({ type: "message", id: "m", timestamp: at, message: transcriptMessage(model, tokens, at) }),
  ];
  writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
}

test.skipIf(!hasSqlite())("the store records every agent Tersio can read", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-hosts-"));
  try {
    const at = "2026-03-01T10:00:00.000Z";
    // omp and pi transcripts, in the two directories the walker reads.
    writeTranscript(path.join(dir, ".omp", "agent", "sessions"), "omp-a.jsonl", "claude-opus-4", { input: 100, output: 50, cacheRead: 900 }, at);
    writeTranscript(path.join(dir, ".pi", "agent", "sessions"), "pi-b.jsonl", "gpt-5", { input: 10, output: 5 }, "2026-03-02T10:00:00.000Z");
    // OpenCode's pre-v2 layout: one JSON document per message.
    const ocDir = path.join(dir, "opencode", "message");
    mkdirSync(ocDir, { recursive: true });
    writeFileSync(path.join(ocDir, "oc-c.json"), JSON.stringify({
      role: "assistant",
      providerID: "deepseek",
      modelID: "deepseek-v4.1-flash",
      tokens: { input: 30, output: 20, cache: { read: 0, write: 7 } },
      time: { created: Date.parse("2026-03-03T10:00:00.000Z"), completed: Date.parse("2026-03-03T10:00:05.000Z") },
    }), "utf8");
    // OpenCode v2: rows in sqlite, both table shapes, read through their own path.
    const ocDb = path.join(dir, "opencode", "opencode.db");
    execFileSync("sqlite3", [ocDb, "CREATE TABLE session_message (id text PRIMARY KEY, session_id text NOT NULL, type text NOT NULL, seq integer NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL);"], { timeout: 30000 });
    const created = Date.parse("2026-03-04T10:00:00.000Z");
    execFileSync("sqlite3", [ocDb,
      `INSERT INTO session_message VALUES ('r1','s','assistant',1,${created},${created},'${JSON.stringify({
        model: { providerID: "kimi", id: "kimi-k2.5" },
        tokens: { input: 40, output: 25, cache: { read: 15, write: 0 } },
        time: { created },
        cost: 0.5,
      }).replace(/'/g, "''")}');`], { timeout: 30000 });

    withHome(dir, () => {
      expect(syncUsageDb()).toBe(true);
      const stored = readUsageDb();
      expect(stored, "sync wrote a store").not.toBeNull();
      // byHost is model -> host, so each host shows up as a second-level key.
      const byHost = stored!.tokens.byHost;
      expect(stored!.tokens.byHost["claude-opus-4"]?.omp?.output).toBe(50);
      expect(stored!.tokens.byHost["gpt-5"]?.pi?.output).toBe(5);
      // OpenCode reports under both on-disk shapes, the JSON tree and the v2 sqlite rows.
      const ocModels = Object.keys(byHost).filter((model) => model.startsWith("opencode/")).toSorted();
      expect(ocModels).toEqual(["opencode/deepseek/deepseek-v4.1-flash", "opencode/kimi/kimi-k2.5"]);
      expect(byHost["opencode/deepseek/deepseek-v4.1-flash"]?.opencode?.output).toBe(20);
      expect(byHost["opencode/kimi/kimi-k2.5"]?.opencode?.output).toBe(25);
      // Three hosts in total, one per fixture source, and no fourth.
      const names = new Set(Object.values(byHost).flatMap((hosts) => Object.keys(hosts)));
      expect([...names].toSorted()).toEqual(["omp", "opencode", "pi"]);
      expect(stored!.tokens.costMeasured).toBeCloseTo(0.5, 9);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.skipIf(!hasSqlite())("the reads the page needs are indexed", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-index-"));
  try {
    writeTranscript(path.join(dir, ".omp", "agent", "sessions"), "a.jsonl", "claude-opus-4", { input: 10, output: 5 }, "2026-03-01T10:00:00.000Z");
    withHome(dir, () => {
      expect(syncUsageDb()).toBe(true);
      const names = execFileSync(
        "sqlite3",
        ["-readonly", usageDbPath(), "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_messages%';"],
        { encoding: "utf8", timeout: 30000 },
      ).split("\n").map((line) => line.trim()).filter(Boolean).toSorted();
      expect(names).toEqual(["idx_messages_file", "idx_messages_h_t", "idx_messages_model", "idx_messages_t"]);
      // The watermark the sync reads is the one the index serves.
      const plan = execFileSync(
        "sqlite3",
        ["-readonly", usageDbPath(), "EXPLAIN QUERY PLAN SELECT MAX(t) FROM messages WHERE h='opencode';"],
        { encoding: "utf8", timeout: 30000 },
      );
      expect(plan).toMatch(/SEARCH messages USING (COVERING )?INDEX/);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the recent list stays bounded when the store holds far more", () => {
  // Ingest is pure, so this runs without sqlite3 and without touching the disk.
  withNoReset(() => {
  const accum = newSessionAccum();
  const floor = 1_000_000;
  for (let i = 0; i < RECENT_LIMIT * 4; i += 1) {
    ingestSessionRow(accum, "claude-opus-4", { input: 1, output: 1 }, floor + i);
  }
  expect(accum.recent).toHaveLength(RECENT_LIMIT);
  // The newest rows are the ones kept, and the oldest held row is the floor of the window.
  expect(accum.recent.at(-1)!.t).toBe(floor + RECENT_LIMIT * 4 - 1);
  expect(accum.recentFloor).toBe(floor + RECENT_LIMIT * 3);
  // The aggregate still counts every row, bounded or not.
  expect(accum.messages).toBe(RECENT_LIMIT * 4);
  });
});

test("an older row never displaces a newer one once the list is full", () => {
  withNoReset(() => {
  const accum = newSessionAccum();
  for (let i = 0; i < RECENT_LIMIT; i += 1) ingestSessionRow(accum, "claude-opus-4", { input: 1, output: 1 }, 2_000_000 + i);
  ingestSessionRow(accum, "claude-opus-4", { input: 1, output: 1 }, 1);
  expect(accum.recent).toHaveLength(RECENT_LIMIT);
  expect(accum.recentFloor).toBe(2_000_000);
  expect(accum.recent.at(-1)!.t).toBe(2_000_000 + RECENT_LIMIT - 1);
  });
});
