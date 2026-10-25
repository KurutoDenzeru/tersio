// Usage and report surface: the ledger, store, hosts, tokens, backups, currency, and agent stats.
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs, { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  RECENT_LIMIT,
  appendUsage,
  canonicalModelId,
  clearRtkAdoptionCache,
  co2Grams,
  co2GramsFor,
  displayModelId,
  foldModelsByLabel,
  importSessionTokens,
  ingestSessionRow,
  ledgerPath,
  markReset,
  newSessionAccum,
  priceFor,
  readRtkAdoption,
  readResetWatermark,
  readUsage,
  usdCost,
} from "../../extensions/shared/usage-ledger.ts";
import {
  clearUsageDb,
  maybeScheduledBackup,
  readBackupSchedule,
  readUsageDb,
  reparseGuardReport,
  syncUsageDb,
  usageDbPath,
} from "../../extensions/shared/usage-store.ts";
import { errorSignature, readAgentStats, readSessionTrace } from "../../extensions/shared/agent-stats.ts";
import { sqliteAvailable, sqliteExec, sqliteRead } from "../../extensions/shared/sqlite.ts";
import {
  BACKUP_KEEP,
  backupDir,
  createDataBackup,
  dataSources,
  deleteDataBackup,
  listDataBackups,
  pruneBackups,
  readSnapshotMember,
  restoreDataBackup,
} from "../../extensions/shared/snapshots.ts";
import { resetCounts, resetStatistics } from "../../cli/reset.ts";
import { FX_SNAPSHOT_RATES, convertUsd, formatCurrency } from "../../cli/currency.ts";
import { offsetFrom } from "../../cli/dashboard.ts";
import { FX_SNAPSHOT } from "../../dashboard/app/src/lib/format.ts";
import { hasSqlite } from "../helpers/env.ts";
import { sessionPath, writeQuotaDb, writeSessionFixture, writeUsageStore } from "../helpers/omp-fixture.ts";

// Shared by the currency CLI tests and the dashboard currency server test.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const installer = path.join(root, "dist", "tersio.js");

// --- usage-backups: touch user data, so each test fails loudly. ---
/** Point every snapshot source at the sandbox, so a test snapshot never reads the developer's files. */
const SOURCE_ENV: ReadonlyArray<[string, string]> = [
  ["TERSIO_AGENT_STATS_DB", "stats.db"],
  ["TERSIO_AGENT_SESSIONS_DB", "agent.db"],
  ["TERSIO_RTK_DB", "rtk.db"],
];

function sandbox(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-backups-"));
  const keys = ["TERSIO_USAGE_DB", "TERSIO_HOME", "TERSIO_SESSIONS_DIR", ...SOURCE_ENV.map(([key]) => key)] as const;
  const prev = new Map<string, string | undefined>(keys.map((key) => [key, process.env[key]]));
  process.env.TERSIO_USAGE_DB = path.join(dir, "usage.db");
  process.env.TERSIO_SESSIONS_DIR = path.join(dir, "sessions");
  // Without this the schedule tests read the real ~/.tersio/settings.json.
  process.env.TERSIO_HOME = dir;
  for (const [key, name] of SOURCE_ENV) process.env[key] = path.join(dir, name);
  writeFileSync(path.join(dir, "usage.db"), "current");
  return {
    dir,
    cleanup: () => {
      for (const [key, value] of prev) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("a reset clears the ledger and writes the watermark the views read", () => {
  const box = sandbox();
  const prevFile = process.env.TERSIO_USAGE_FILE;
  const prevReset = process.env.TERSIO_RESET_FILE;
  try {
    const ledger = path.join(box.dir, "usage.jsonl");
    const marker = path.join(box.dir, "reset.json");
    process.env.TERSIO_USAGE_FILE = ledger;
    process.env.TERSIO_RESET_FILE = marker;
    writeFileSync(ledger, '{"ts":1,"kind":"command","detail":"x"}\n{"ts":2,"kind":"toggle","detail":"y"}\n', "utf8");

    expect(resetCounts().rows).toBe(2);
    const done = resetStatistics();

    expect(done.rows).toBe(2);
    expect(existsSync(ledger), "the ledger is emptied, not left behind").toBe(false);
    expect(readResetWatermark(), "the watermark is what the views read").toBe(done.ts);
    expect(resetCounts().rows).toBe(0);
  } finally {
    if (prevFile === undefined) delete process.env.TERSIO_USAGE_FILE; else process.env.TERSIO_USAGE_FILE = prevFile;
    if (prevReset === undefined) delete process.env.TERSIO_RESET_FILE; else process.env.TERSIO_RESET_FILE = prevReset;
    box.cleanup();
  }
});

function seedSnapshot(name: string, body: string): string {
  mkdirSync(backupDir(), { recursive: true });
  const full = path.join(backupDir(), name);
  writeFileSync(full, body);
  return full;
}

// --- export ---------------------------------------------------------------

// --- restore --------------------------------------------------------------

test.skipIf(!hasSqlite())("a restore puts a readable snapshot back over the live mirror", () => {
  const { cleanup } = sandbox();
  try {
    // sandbox seeds a placeholder db; a real one has to come from the transcripts.
    rmSync(usageDbPath(), { force: true });
    mkdirSync(process.env.TERSIO_SESSIONS_DIR!, { recursive: true });
    writeFileSync(
      path.join(process.env.TERSIO_SESSIONS_DIR!, "s.jsonl"),
      `{"timestamp":"2026-09-01T10:00:00.000Z","type":"message","id":"a","message":{"role":"assistant","model":"m","usage":{"input":10,"output":1}}}\n`,
      "utf8",
    );
    expect(syncUsageDb()).toBe(true);
    expect(readUsageDb()?.tokens.messages).toBe(1);
    // What the dashboard's "Backup now" does, over a db that already has rows.
    const made = createDataBackup();
    expect(clearUsageDb()).toBe(1);
    expect(readUsageDb()).toBe(null);
    expect(restoreDataBackup(made.name)).toBe(true);
    expect(readUsageDb()?.tokens.messages).toBe(1);
  } finally {
    cleanup();
  }
});

test("a restore rejects a name that is not a snapshot and leaves the mirror alone", () => {
  const { cleanup } = sandbox();
  try {
    writeFileSync(usageDbPath(), "untouched");
    expect(restoreDataBackup("data-20990101000000.snap")).toBe(false);
    expect(restoreDataBackup("")).toBe(false);
    expect(readFileSync(usageDbPath(), "utf8")).toBe("untouched");
  } finally {
    cleanup();
  }
});

// --- delete ---------------------------------------------------------------

test("a delete removes exactly one snapshot and keeps the rest", () => {
  const { cleanup } = sandbox();
  try {
    const first = createDataBackup();
    const second = createDataBackup();
    expect(deleteDataBackup(first.name)).toBe(true);
    expect(listDataBackups().map((x) => x.name)).toEqual([second.name]);
  } finally {
    cleanup();
  }
});

test("a delete never touches the live mirror", () => {
  const { cleanup } = sandbox();
  try {
    const made = createDataBackup();
    expect(deleteDataBackup(made.name)).toBe(true);
    expect(existsSync(usageDbPath())).toBe(true);
    expect(readFileSync(usageDbPath(), "utf8")).toBe("current");
  } finally {
    cleanup();
  }
});

test("a delete refuses a path outside the backup directory", () => {
  const { dir, cleanup } = sandbox();
  try {
    const outside = path.join(dir, "not-a-snapshot.snap");
    writeFileSync(outside, "precious");
    seedSnapshot("data-20260101000000.snap", "a");

    // Absolute, relative, and bare traversals all resolve to a basename, so none can leave the backup dir.
    for (const attempt of [outside, "../not-a-snapshot.snap", "../../etc/hosts", "/etc/hosts"]) {
      expect(deleteDataBackup(attempt), attempt).toBe(false);
    }
    expect(existsSync(outside), "the file outside the backup dir survives").toBe(true);
  } finally {
    cleanup();
  }
});

test("a restore also refuses a path outside the backup directory", () => {
  const { dir, cleanup } = sandbox();
  try {
    writeFileSync(path.join(dir, "not-a-snapshot.snap"), "not a snapshot");
    expect(restoreDataBackup(path.join(dir, "not-a-snapshot.snap"))).toBe(false);
    expect(restoreDataBackup("../../usage.db")).toBe(false);
    expect(readFileSync(usageDbPath(), "utf8")).toBe("current");
  } finally {
    cleanup();
  }
});

// --- schedule -------------------------------------------------------------

test("the backup schedule defaults to monthly", () => {
  const { cleanup } = sandbox();
  try {
    expect(readBackupSchedule()).toBe("monthly");
  } finally {
    cleanup();
  }
});

test("a manual schedule takes no snapshot even when one is overdue", () => {
  const { dir, cleanup } = sandbox();
  try {
    // Force the schedule without touching the user's real settings file.
    writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ backupSchedule: "manual" }));
    expect(readBackupSchedule()).toBe("manual");
    expect(maybeScheduledBackup()).toBe(false);
    expect(listDataBackups()).toHaveLength(0);
  } finally {
    cleanup();
  }
});

test("a monthly schedule snapshots an empty backup dir and skips while fresh", () => {
  const { dir, cleanup } = sandbox();
  try {
    writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ backupSchedule: "monthly" }));
    expect(maybeScheduledBackup(), "first run takes a snapshot").toBe(true);
    const made = listDataBackups();
    expect(made).toHaveLength(1);
    expect(readSnapshotMember(made[0], "usage.db")).toEqual(Buffer.from("current"));
    expect(maybeScheduledBackup(), "a fresh snapshot is not re-taken").toBe(false);
    expect(listDataBackups()).toHaveLength(1);
  } finally {
    cleanup();
  }
});

// --- usage-hosts: one mirror over every agent Tersio reads, omp and pi plus both OpenCode shapes. ---

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

/** A fixture home: HOME picks the transcript dirs and reset watermark the override vars point at. */
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
    sqliteExec(ocDb, "CREATE TABLE session_message (id text PRIMARY KEY, session_id text NOT NULL, type text NOT NULL, seq integer NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL);");
    const created = Date.parse("2026-03-04T10:00:00.000Z");
    sqliteExec(ocDb,
      `INSERT INTO session_message VALUES ('r1','s','assistant',1,${created},${created},'${JSON.stringify({
        model: { providerID: "kimi", id: "kimi-k2.5" },
        tokens: { input: 40, output: 25, cache: { read: 15, write: 0 } },
        time: { created },
        cost: 0.5,
      }).replace(/'/g, "''")}');`);

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
      const names = sqliteRead(
        usageDbPath(),
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_messages%';",
      ).split("\n").map((line) => line.trim()).filter(Boolean).toSorted();
      expect(names).toEqual(["idx_messages_file", "idx_messages_h_t", "idx_messages_model", "idx_messages_t"]);
      // The watermark the sync reads is the one the index serves.
      const plan = sqliteRead(
        usageDbPath(),
        "EXPLAIN QUERY PLAN SELECT MAX(t) FROM messages WHERE h='opencode';",
      );
      expect(plan).toMatch(/SEARCH messages USING (COVERING )?INDEX/);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.skipIf(!hasSqlite())("a tool call keeps its argument and result sizes and its error flag", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-toolfacts-"));
  try {
    const at = "2026-03-01T10:00:00.000Z";
    const file = path.join(dir, ".omp", "agent", "sessions", "-proj-a", "t.jsonl");
    mkdirSync(path.dirname(file), { recursive: true });
    const call = {
      role: "assistant",
      model: "commandcode/priced-model",
      usage: { input: 100, output: 50 },
      timestamp: at,
      stopReason: "toolUse",
      content: [
        { type: "toolCall", id: "c1", name: "edit", arguments: { path: "a.ts", old: "x" } },
        { type: "toolCall", id: "c2", name: "read", arguments: { path: "b.ts" } },
      ],
    };
    const result = (id: string, text: string, isError: boolean): Record<string, unknown> => ({
      role: "toolResult", toolCallId: id, toolName: "t", content: [{ type: "text", text }], isError,
    });
    writeFileSync(file, [
      { type: "session", version: 3, id: "t", timestamp: at, cwd: "/tmp/project" },
      { type: "message", id: "m1", timestamp: at, message: call },
      { type: "message", id: "m2", timestamp: at, message: result("c1", "ok", false) },
      { type: "message", id: "m3", timestamp: at, message: result("c2", "boom", true) },
    ].map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");

    withHome(dir, () => {
      expect(syncUsageDb()).toBe(true);
      const stats = readAgentStats("all");
      const edit = stats.tools.find((row) => row.tool === "edit");
      const read = stats.tools.find((row) => row.tool === "read");
      // The argument size is the serialized JSON the model sent, which is what the model paid for.
      expect(edit?.argsChars).toBe(JSON.stringify({ path: "a.ts", old: "x" }).length);
      expect(edit?.resultChars).toBe(2);
      expect(edit?.errors).toBe(0);
      // The error flag and the result size sit on the toolResult line, keyed by the call id.
      expect(read?.argsChars).toBe(JSON.stringify({ path: "b.ts" }).length);
      expect(read?.resultChars).toBe(4);
      expect(read?.errors).toBe(1);
      expect(stats.toolSeries.reduce((sum, point) => sum + point.errors, 0)).toBe(1);
      expect(stats.overall.requests).toBe(1);
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

// OpenCode records the first token in `time.streamed`, which is the only latency the page can show for it.
test.skipIf(!hasSqlite())("OpenCode first-token latency reaches the store", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-ttft-"));
  try {
    const created = Date.parse("2026-03-04T10:00:00.000Z");
    const streamed = created + 1200;
    const ocDb = path.join(dir, "opencode", "opencode.db");
    mkdirSync(path.dirname(ocDb), { recursive: true });
    sqliteExec(ocDb, "CREATE TABLE session_message (id text PRIMARY KEY, session_id text NOT NULL, type text NOT NULL, seq integer NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL);");
    sqliteExec(ocDb,
      `INSERT INTO session_message VALUES ('r1','s','assistant',1,${created},${created},'${JSON.stringify({
        model: { providerID: "deepseek", id: "deepseek-v4.1-flash" },
        tokens: { input: 40, output: 25, cache: { read: 15, write: 0 } },
        time: { created, streamed, completed: created + 4000 },
      }).replace(/'/g, "''")}');`);

    withHome(dir, () => {
      expect(syncUsageDb()).toBe(true);
      const row = readUsageDb()!.tokens.recent.find((r) => r.m.startsWith("opencode/deepseek/"));
      expect(row, "the OpenCode row reached the store").toBeDefined();
      expect(row!.tf, "first-token latency is the streamed gap, not the whole duration").toBe(1200);
      expect(row!.d, "duration stays its own measure").toBe(4000);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// pi writes no `ttft`; omp does. Ingest must carry whichever the host recorded, and null when neither did.
test("ingest carries first-token latency only when the host recorded one", () => {
  withNoReset(() => {
    const accum = newSessionAccum();
    const base = 3_000_000;
    ingestSessionRow(accum, "claude-opus-4", { input: 1, output: 1 }, base, 5000, undefined, undefined, "omp", "a", "main", 1234);
    ingestSessionRow(accum, "gpt-5", { input: 1, output: 1 }, base + 1, 6000, undefined, undefined, "pi", "b", "main");
    const byId = new Map(accum.recent.map((r) => [r.id, r]));
    expect(byId.get("a")!.tf, "a recorded latency is kept").toBe(1234);
    expect(byId.get("a")!.d, "duration stays separate from latency").toBe(5000);
    expect(byId.get("b")!.tf, "an absent latency stays null, never zero").toBeUndefined();
  });
});

// --- usage-ledger ---------------------------------------------------------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tersio-ledger-"));
process.env.TERSIO_USAGE_FILE = path.join(dir, "usage.jsonl");
// Keep the host's real reset watermark (if any) out of these tests.
process.env.TERSIO_RESET_FILE = path.join(dir, "reset.json");
test("ledger starts empty when the file is missing", () => {
  expect(ledgerPath()).toBe(process.env.TERSIO_USAGE_FILE);
  expect(readUsage()).toEqual([]);
});

test("appended rows round-trip in order", () => {
  appendUsage("command", "/caveman full");
  appendUsage("toggle", "caveman=full");
  const rows = readUsage();
  expect(rows.length).toBe(2);
  expect(rows[0].kind).toBe("command");
  expect(rows[0].detail).toBe("/caveman full");
  expect(typeof rows[0].ts).toBe("number");
  expect(rows[1].kind).toBe("toggle");
});

test("corrupt lines are skipped, valid rows survive", () => {
  fs.appendFileSync(process.env.TERSIO_USAGE_FILE!, "not json\n{\"ts\":\"x\",\"kind\":1}\n", "utf8");
  const rows = readUsage();
  expect(rows.length).toBe(2);
  expect(rows[0].detail).toBe("/caveman full");
});

test("clearUsageLedger removes the file and returns rows cleared", async () => {
  const { clearUsageLedger } = await import("../../extensions/shared/usage-ledger.ts");
  appendUsage("command", "/tersio reset");
  const cleared = clearUsageLedger();
  expect(cleared).toBe(3);
  expect(readUsage()).toEqual([]);
  expect(fs.existsSync(process.env.TERSIO_USAGE_FILE!)).toBe(false);
  expect(clearUsageLedger()).toBe(0);
});

test("reset watermark defaults to 0, writes and reads back", async () => {
  const { resetMarkerPath, readResetWatermark, markReset } = await import("../../extensions/shared/usage-ledger.ts");
  expect(fs.existsSync(resetMarkerPath())).toBe(false);
  expect(readResetWatermark()).toBe(0);
  const ts = markReset();
  expect(readResetWatermark()).toBe(ts);
  expect(fs.readFileSync(resetMarkerPath(), "utf8")).toMatch(/"ts":\d+/);
});

test("session stats honor the reset watermark without touching transcripts", async () => {
  const mod = await import("../../extensions/shared/usage-ledger.ts");
  const sessions = path.join(dir, "sessions");
  fs.mkdirSync(sessions, { recursive: true });
  const now = Date.now();
  const row = (iso: string) => JSON.stringify({ timestamp: iso, message: { role: "assistant", model: "m-test", usage: { input: 100, output: 10 }, content: [] } }) + "\n";
  fs.writeFileSync(path.join(sessions, "s.jsonl"), [
    row(new Date(now - 60_000).toISOString()), // before watermark
    row(new Date(now + 60_000).toISOString()), // after watermark
    JSON.stringify({ message: { role: "assistant", model: "m-test", usage: { input: 500, output: 5 } } }), // no timestamp
  ].join("\n"), "utf8");
  const prevSessions = process.env.TERSIO_SESSIONS_DIR;
  const prevReset = process.env.TERSIO_RESET_FILE;
  process.env.TERSIO_SESSIONS_DIR = sessions;
  try {
    process.env.TERSIO_RESET_FILE = path.join(dir, "no-marker.json");
    const unfiltered = mod.importSessionTokens();
    expect(unfiltered.messages).toBe(3);
    expect(unfiltered.totals.input).toBe(700);

    process.env.TERSIO_RESET_FILE = path.join(dir, "stats-reset.json");
    mod.markReset(now);
    const filtered = mod.importSessionTokens();
    expect(filtered.messages, "only post-watermark rows count").toBe(1);
    expect(filtered.totals.input).toBe(100);
    expect(filtered.totals.output).toBe(10);
    // The host-owned transcript file is untouched.
    expect(fs.existsSync(path.join(sessions, "s.jsonl"))).toBe(true);
  } finally {
    if (prevSessions === undefined) delete process.env.TERSIO_SESSIONS_DIR;
    else process.env.TERSIO_SESSIONS_DIR = prevSessions;
    if (prevReset === undefined) delete process.env.TERSIO_RESET_FILE;
    else process.env.TERSIO_RESET_FILE = prevReset;
  }
});

// --- usage-store ----------------------------------------------------------
function withEnv(dir: string, fn: () => void): void {
  const prevDb = process.env.TERSIO_USAGE_DB;
  const prevSessions = process.env.TERSIO_SESSIONS_DIR;
  const prevReset = process.env.TERSIO_RESET_FILE;
  process.env.TERSIO_USAGE_DB = path.join(dir, "usage.db");
  process.env.TERSIO_SESSIONS_DIR = path.join(dir, "sessions");
  process.env.TERSIO_RESET_FILE = path.join(dir, "reset.json");
  try {
    fn();
  } finally {
    if (prevDb === undefined) delete process.env.TERSIO_USAGE_DB;
    else process.env.TERSIO_USAGE_DB = prevDb;
    if (prevSessions === undefined) delete process.env.TERSIO_SESSIONS_DIR;
    else process.env.TERSIO_SESSIONS_DIR = prevSessions;
    if (prevReset === undefined) delete process.env.TERSIO_RESET_FILE;
    else process.env.TERSIO_RESET_FILE = prevReset;
  }
}

function seedSessions(dir: string): void {
  mkdirSync(path.join(dir, "sessions"), { recursive: true });
  writeFileSync(
    path.join(dir, "sessions", "s.jsonl"),
    [
      '{"timestamp":"2026-09-01T10:00:00.000Z","message":{"role":"assistant","model":"DeepSeek-V4.1-Flash","usage":{"input":200,"output":20,"cacheRead":50},"content":[{"type":"toolCall","name":"read"}]}}',
      '{"timestamp":"2026-09-01T11:00:00.000Z","message":{"role":"assistant","model":"deepseek-v4.1-flash:free","usage":{"input":100,"output":10}}}',
    ].join("\n") + "\n",
    "utf8",
  );
}

test("missing usage db reads null without throwing", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-usage-db-"));
  try {
    withEnv(dir, () => {
      expect(readUsageDb()).toBe(null);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.skipIf(!hasSqlite())("sync persists folded model rows and reads them back", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-usage-db-"));
  try {
    withEnv(dir, () => {
      seedSessions(dir);
      expect(usageDbPath()).toBe(process.env.TERSIO_USAGE_DB);
      expect(syncUsageDb()).toBe(true);
      const stored = readUsageDb();
      expect(stored).toBeTruthy();
      expect(Object.keys(stored.tokens.byModel)).toEqual(["deepseek-v4.1-flash"]);
      expect(stored.tokens.byModel["deepseek-v4.1-flash"]).toEqual({ input: 300, output: 30, cacheRead: 50, cacheWrite: 0 });
      expect(stored.tokens.messages).toBe(2);
      expect(stored.tokens.recent.length).toBe(2);
      expect(stored.tokens.byTool).toEqual({ read: 1 });
      expect(stored.syncedAt > 0).toBeTruthy();
      // Second sync is a no-op (mtime+size ledger matches).
      expect(syncUsageDb()).toBe(true);
      // Reset watermark filters the stored view without touching the file.
      markReset(Date.parse("2026-09-01T10:30:00.000Z"));
      const filtered = readUsageDb();
      expect(filtered?.tokens.messages).toBe(1);
      expect(existsSync(process.env.TERSIO_USAGE_DB!)).toBe(true);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.skipIf(!hasSqlite())("sync keeps rows for deleted transcripts", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-usage-db-"));
  try {
    withEnv(dir, () => {
      seedSessions(dir);
      expect(syncUsageDb()).toBe(true);
      expect(readUsageDb()?.tokens.messages).toBe(2);
      rmSync(path.join(dir, "sessions", "s.jsonl"));
      expect(syncUsageDb()).toBe(true);
      const stored = readUsageDb();
      expect(stored?.tokens.messages).toBe(2);
      expect(Object.keys(stored?.tokens.byModel ?? {})).toEqual(["deepseek-v4.1-flash"]);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.skipIf(!hasSqlite())("migration guard restores the backup when transcripts vanish mid-bump", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-usage-guard-"));
  const prevForce = process.env.TERSIO_FORCE_REPARSE;
  try {
    withEnv(dir, () => {
      const row = (id: string, input: number): string =>
        `{"timestamp":"2026-09-01T10:00:00.000Z","type":"message","id":"${id}","message":{"role":"assistant","model":"m","usage":{"input":${input},"output":1}}}`;
      mkdirSync(path.join(dir, "sessions"), { recursive: true });
      for (const n of ["a", "b", "c"]) {
        writeFileSync(path.join(dir, "sessions", `${n}.jsonl`), [row(`${n}1`, 10), row(`${n}2`, 20)].join("\n") + "\n", "utf8");
      }
      expect(syncUsageDb()).toBe(true);
      expect(readUsageDb()?.tokens.messages).toBe(6);
      sqliteExec(process.env.TERSIO_USAGE_DB!, "UPDATE meta SET v='__old__' WHERE k='parser_version';");
      rmSync(path.join(dir, "sessions", "a.jsonl"));
      rmSync(path.join(dir, "sessions", "b.jsonl"));
      expect(syncUsageDb()).toBe(false);
      expect(readUsageDb()?.tokens.messages).toBe(6);
      expect(reparseGuardReport()).toMatch(/kept 2 of 6 rows/);
      process.env.TERSIO_FORCE_REPARSE = "1";
      expect(syncUsageDb()).toBe(true);
      expect(readUsageDb()?.tokens.messages).toBe(2);
      expect(sqliteRead(process.env.TERSIO_USAGE_DB!, "PRAGMA freelist_count;").trim()).toBe("0");
    });
  } finally {
    if (prevForce === undefined) delete process.env.TERSIO_FORCE_REPARSE;
    else process.env.TERSIO_FORCE_REPARSE = prevForce;
    rmSync(dir, { recursive: true, force: true });
  }
});

test.skipIf(!hasSqlite())("a store from a newer tersio keeps its rows instead of re-parsing", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-usage-downgrade-"));
  const prevForce = process.env.TERSIO_FORCE_REPARSE;
  try {
    withEnv(dir, () => {
      const db = process.env.TERSIO_USAGE_DB!;
      const row = (id: string, input: number): string =>
        `{"timestamp":"2026-09-01T10:00:00.000Z","type":"message","id":"${id}","message":{"role":"assistant","model":"m","usage":{"input":${input},"output":1}}}`;
      mkdirSync(path.join(dir, "sessions"), { recursive: true });
      for (const n of ["a", "b", "c"]) {
        writeFileSync(path.join(dir, "sessions", `${n}.jsonl`), [row(`${n}1`, 10), row(`${n}2`, 20)].join("\n") + "\n", "utf8");
      }
      expect(syncUsageDb()).toBe(true);
      expect(readUsageDb()?.tokens.messages).toBe(6);
      const backupsBefore = listDataBackups().length;
      // A newer tersio wrote the store; this build cannot migrate it forward.
      sqliteExec(db, "UPDATE meta SET v='99' WHERE k='parser_version';");
      rmSync(path.join(dir, "sessions", "a.jsonl"));
      rmSync(path.join(dir, "sessions", "b.jsonl"));
      expect(syncUsageDb()).toBe(true);
      expect(readUsageDb()?.tokens.messages).toBe(6);
      expect(reparseGuardReport()).toMatch(/written by a newer tersio/);
      // No backup was taken and none was restored: the wipe path never ran.
      expect(listDataBackups().length).toBe(backupsBefore);
      expect(sqliteRead(db, "SELECT v FROM meta WHERE k='parser_version';").trim()).toBe("99");
      // The force switch still accepts the loss on demand.
      process.env.TERSIO_FORCE_REPARSE = "1";
      expect(syncUsageDb()).toBe(true);
      expect(readUsageDb()?.tokens.messages).toBe(2);
    });
  } finally {
    if (prevForce === undefined) delete process.env.TERSIO_FORCE_REPARSE;
    else process.env.TERSIO_FORCE_REPARSE = prevForce;
    rmSync(dir, { recursive: true, force: true });
  }
});

test.skipIf(!hasSqlite())("v9 databases migrate in place without re-parsing transcripts", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-usage-migrate-"));
  try {
    withEnv(dir, () => {
      const db = process.env.TERSIO_USAGE_DB!;
      mkdirSync(path.join(dir, "sessions"), { recursive: true });
      const file = path.join(dir, "sessions", "gone.jsonl");
      writeFileSync(
        file,
        [
          `{"timestamp":"2026-09-01T10:00:00.000Z","message":{"role":"assistant","model":"m","usage":{"input":10,"output":1}}}`,
          `{"timestamp":"2026-09-01T11:00:00.000Z","message":{"role":"assistant","model":"m","usage":{"input":20,"output":2}}}`,
        ].join("\n") + "\n",
        "utf8",
      );
      sqliteExec(db, [
        `CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);`,
        `CREATE TABLE files (path TEXT PRIMARY KEY, mtime REAL NOT NULL, size INTEGER NOT NULL);`,
        `CREATE TABLE messages (file TEXT NOT NULL, t REAL, model TEXT NOT NULL,` +
        ` i INTEGER NOT NULL, o INTEGER NOT NULL, d REAL, cr INTEGER NOT NULL, cw INTEGER NOT NULL,` +
        ` usd REAL, st TEXT NOT NULL, code REAL, note TEXT, tools TEXT NOT NULL DEFAULT '[]', h TEXT);`,
        `INSERT INTO files VALUES ('${file}',1,2);`,
        `INSERT INTO messages VALUES ('${file}',1,'m',10,1,NULL,0,0,NULL,'completed',NULL,NULL,'[]','pi');`,
        `INSERT INTO messages VALUES ('${file}',2,'m',20,2,NULL,0,0,NULL,'completed',NULL,NULL,'[]','pi');`,
        `INSERT INTO meta VALUES ('parser_version','9');`,
      ].join(""));
      rmSync(file);
      expect(syncUsageDb()).toBe(true);
      expect(readUsageDb()?.tokens.messages).toBe(2);
      expect(reparseGuardReport()).toBe(null);
      const schema = sqliteRead(db, "SELECT sql FROM sqlite_master WHERE name='messages';");
      expect(schema).toMatch(/file_id/);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.skipIf(!hasSqlite())("v10 databases gain the id column without re-parsing", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-usage-alter-"));
  try {
    withEnv(dir, () => {
      const db = process.env.TERSIO_USAGE_DB!;
      mkdirSync(path.join(dir, "sessions"), { recursive: true });
      const file = path.join(dir, "sessions", "s.jsonl");
      writeFileSync(
        file,
        `{"timestamp":"2026-09-01T10:00:00.000Z","type":"message","id":"row-1","message":{"role":"assistant","model":"m","usage":{"input":10,"output":1}}}\n`,
        "utf8",
      );
      sqliteExec(db, [
        `CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);`,
        `CREATE TABLE files (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT UNIQUE NOT NULL, mtime REAL NOT NULL, size INTEGER NOT NULL);`,
        `CREATE TABLE messages (file_id INTEGER NOT NULL REFERENCES files(id), t REAL, model TEXT NOT NULL,` +
        ` i INTEGER NOT NULL, o INTEGER NOT NULL, d REAL, cr INTEGER NOT NULL, cw INTEGER NOT NULL,` +
        ` usd REAL, st TEXT NOT NULL, code REAL, note TEXT, tools TEXT NOT NULL DEFAULT '[]', h TEXT);`,
        `INSERT INTO files (path, mtime, size) VALUES ('${file}',1,2);`,
        `INSERT INTO messages (file_id, t, model, i, o, d, cr, cw, usd, st, code, note, tools, h)` +
        ` VALUES (1,1,'m',10,1,NULL,0,0,NULL,'completed',NULL,NULL,'[]','pi');`,
        `INSERT INTO meta VALUES ('parser_version','10');`,
      ].join(""));
      rmSync(file);
      expect(syncUsageDb()).toBe(true);
      expect(readUsageDb()?.tokens.messages).toBe(1);
      const cols = sqliteRead(db, "PRAGMA table_info(messages);");
      expect(cols).toMatch(/\tid\t/);
      expect(reparseGuardReport()).toBe(null);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.skipIf(!hasSqlite())("v12 databases gain the ttft column and backfill it from the transcripts", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-usage-ttft-"));
  try {
    withEnv(dir, () => {
      const db = process.env.TERSIO_USAGE_DB!;
      mkdirSync(path.join(dir, "sessions"), { recursive: true });
      const file = path.join(dir, "sessions", "s.jsonl");
      writeFileSync(
        file,
        `{"timestamp":"2026-09-01T10:00:00.000Z","message":{"role":"assistant","model":"m","duration":4000,"ttft":900,"usage":{"input":10,"output":1}}}\n`,
        "utf8",
      );
      sqliteExec(db, [
        `CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);`,
        `CREATE TABLE files (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT UNIQUE NOT NULL, mtime REAL NOT NULL, size REAL NOT NULL);`,
        `CREATE TABLE messages (file_id INTEGER NOT NULL REFERENCES files(id), t REAL, model TEXT NOT NULL,` +
        ` i INTEGER NOT NULL, o INTEGER NOT NULL, d REAL, cr INTEGER NOT NULL, cw INTEGER NOT NULL,` +
        ` usd REAL, st TEXT NOT NULL, code REAL, note TEXT, tools TEXT NOT NULL DEFAULT '[]', h TEXT, a TEXT, id TEXT);`,
        `INSERT INTO files (path, mtime, size) VALUES ('${file}',1,2);`,
        `INSERT INTO messages (file_id, t, model, i, o, d, cr, cw, usd, st, code, note, tools, h, a, id)` +
        ` VALUES (1,1,'m',10,1,4000,0,0,NULL,'completed',NULL,NULL,'[]','pi','main','row-1');`,
        `INSERT INTO meta VALUES ('parser_version','12');`,
      ].join(""));

      // The column arrives and the transcript is re-read once so existing rows gain latency, not NULL.
      expect(syncUsageDb()).toBe(true);
      const cols = sqliteRead(db, "PRAGMA table_info(messages);");
      expect(cols).toMatch(/\ttf\t/);
      const latencies = sqliteRead(db, "SELECT CAST(tf AS INTEGER) FROM messages;").trim();
      expect(latencies).toBe("900");
      // No row is lost and the guard never trips: the ALTER moves nothing.
      expect(readUsageDb()?.tokens.messages).toBe(1);
      expect(reparseGuardReport()).toBe(null);
      // The marker closes the window, so the next sync does not re-read the transcript again.
      expect(syncUsageDb()).toBe(true);
      expect(readUsageDb()?.tokens.messages).toBe(1);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("usageDbPath migrates the legacy plugins copy into ~/.tersio", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-home-"));
  const prevHome = process.env.HOME;
  const prevProfile = process.env.USERPROFILE;
  const prevDb = process.env.TERSIO_USAGE_DB;
  delete process.env.TERSIO_USAGE_DB;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    const legacy = path.join(home, ".omp", "plugins", "tersio-usage.db");
    mkdirSync(path.dirname(legacy), { recursive: true });
    writeFileSync(legacy, "seed", "utf8");
    expect(usageDbPath()).toBe(path.join(home, ".tersio", "usage.db"));
    expect(existsSync(path.join(home, ".tersio", "usage.db"))).toBe(true);
    expect(existsSync(legacy)).toBe(false);
  } finally {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevProfile;
    if (prevDb === undefined) delete process.env.TERSIO_USAGE_DB;
    else process.env.TERSIO_USAGE_DB = prevDb;
    rmSync(home, { recursive: true, force: true });
  }
});

test.skipIf(!hasSqlite())("clearUsageDb removes the store file", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-usage-db-"));
  try {
    withEnv(dir, () => {
      seedSessions(dir);
      expect(syncUsageDb()).toBe(true);
      expect(existsSync(process.env.TERSIO_USAGE_DB!)).toBe(true);
      expect(clearUsageDb()).toBe(1);
      expect(existsSync(process.env.TERSIO_USAGE_DB!)).toBe(false);
      expect(clearUsageDb()).toBe(0);
      expect(readUsageDb()).toBe(null);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- usage-tokens: fixture rows use 2026-09-01 timestamps; keep the host reset watermark out. ---
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
      { m: "mystery-model-9", i: 100, o: 10, t: Date.parse("2026-09-02T10:01:00.000Z"), d: undefined, h: "pi", cr: 0, cw: 0, usd: undefined, st: "completed", code: undefined, note: undefined, id: "b" },
      { m: "claude-sonnet-5", i: 1000, o: 200, t: Date.parse("2026-09-01T10:01:00.000Z"), d: 4200, h: "pi", cr: 500, cw: 125, usd: 0.012, st: "completed", code: undefined, note: undefined, id: "a" },
    ]);
    expect(s.costMeasured).toBe(0.012);
  } finally {
    if (prev === undefined) delete process.env.TERSIO_SESSIONS_DIR;
    else process.env.TERSIO_SESSIONS_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("adoption reads executed Bash calls from both transcript shapes", () => {
  const dir = fixtureDir();
  appendFileSync(path.join(dir, "branch", "s1.jsonl"), [
    JSON.stringify({ type: "custom", customType: "tool_execution_start", data: { toolName: "bash", args: { command: "git status --short" } } }),
    JSON.stringify({ type: "custom", customType: "tool_execution_start", data: { toolName: "bash", args: { command: "rtk git status --short" } } }),
    JSON.stringify({ type: "custom", customType: "tool_execution_start", data: { toolName: "bash", args: { command: "python3 script.py" } } }),
  ].join("\n") + "\n", "utf8");
  const prev = process.env.TERSIO_SESSIONS_DIR;
  const prevHome = process.env.TERSIO_HOME;
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-adoption-home-"));
  process.env.TERSIO_SESSIONS_DIR = dir;
  process.env.TERSIO_HOME = home;
  try {
    clearRtkAdoptionCache();
    // The fixture's two message-shape calls are pi's executed record, so they count beside the custom rows.
    expect(readRtkAdoption()).toEqual({ sessions: 1, bashCalls: 5, eligibleCalls: 4, rtkCalls: 2, missedCalls: 2, adoptionPct: 50, byHost: { pi: { bashCalls: 5, eligibleCalls: 4, rtkCalls: 2, missedCalls: 2, adoptionPct: 50 } } });
    expect(readRtkAdoption()).toEqual({ sessions: 1, bashCalls: 5, eligibleCalls: 4, rtkCalls: 2, missedCalls: 2, adoptionPct: 50, byHost: { pi: { bashCalls: 5, eligibleCalls: 4, rtkCalls: 2, missedCalls: 2, adoptionPct: 50 } } });
    appendFileSync(path.join(dir, "branch", "s1.jsonl"), `${JSON.stringify({ type: "custom", customType: "tool_execution_start", data: { toolName: "bash", args: { command: "rtk git diff" } } })}\n`, "utf8");
    expect(readRtkAdoption()).toEqual({ sessions: 1, bashCalls: 6, eligibleCalls: 5, rtkCalls: 3, missedCalls: 2, adoptionPct: 60, byHost: { pi: { bashCalls: 6, eligibleCalls: 5, rtkCalls: 3, missedCalls: 2, adoptionPct: 60 } } });
  } finally {
    clearRtkAdoptionCache();
    if (prev === undefined) delete process.env.TERSIO_SESSIONS_DIR;
    else process.env.TERSIO_SESSIONS_DIR = prev;
    if (prevHome === undefined) delete process.env.TERSIO_HOME;
    else process.env.TERSIO_HOME = prevHome;
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test.skipIf(!sqliteAvailable())("adoption counts OpenCode bash calls from its own store", () => {
  const dir = fixtureDir();
  const empty = path.join(dir, "no-sessions");
  mkdirSync(empty, { recursive: true });
  const db = path.join(dir, "opencode.db");
  sqliteExec(db, "CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT, type TEXT, seq INTEGER, time_created INTEGER, time_updated INTEGER, data TEXT);");
  const message = JSON.stringify({
    time: { created: 1 },
    model: { id: "m", providerID: "opencode" },
    content: [
      { type: "reasoning", text: "plan" },
      { type: "tool", name: "shell", state: { input: { command: "git status --short" } } },
      { type: "tool", name: "bash", state: { input: { command: "rtk gh pr list" } } },
      { type: "tool", name: "read", state: { input: { path: "x" } } },
    ],
  });
  sqliteExec(db, `INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES ('m1', 's1', 'assistant', 1, 1, 1, '${message.replace(/'/g, "''")}');`);
  const prevSessions = process.env.TERSIO_SESSIONS_DIR;
  const prevDb = process.env.TERSIO_OPENCODE_DB;
  process.env.TERSIO_SESSIONS_DIR = empty;
  process.env.TERSIO_OPENCODE_DB = db;
  try {
    clearRtkAdoptionCache();
    expect(readRtkAdoption()).toEqual({ sessions: 1, bashCalls: 2, eligibleCalls: 2, rtkCalls: 1, missedCalls: 1, adoptionPct: 50, byHost: { opencode: { bashCalls: 2, eligibleCalls: 2, rtkCalls: 1, missedCalls: 1, adoptionPct: 50 } } });
  } finally {
    clearRtkAdoptionCache();
    if (prevSessions === undefined) delete process.env.TERSIO_SESSIONS_DIR;
    else process.env.TERSIO_SESSIONS_DIR = prevSessions;
    if (prevDb === undefined) delete process.env.TERSIO_OPENCODE_DB;
    else process.env.TERSIO_OPENCODE_DB = prevDb;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("adoption reads pi's message-shape bash calls and never double-counts", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-pi-shape-"));
  mkdirSync(path.join(dir, "branch"), { recursive: true });
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-adoption-home-"));
  const prevSessions = process.env.TERSIO_SESSIONS_DIR;
  const prevHome = process.env.TERSIO_HOME;
  process.env.TERSIO_SESSIONS_DIR = dir;
  process.env.TERSIO_HOME = home;
  try {
    clearRtkAdoptionCache();
    // pi records the call inside the assistant message; no custom row exists.
    appendFileSync(path.join(dir, "branch", "s1.jsonl"), [
      JSON.stringify({ type: "message", message: { role: "assistant", content: [
        { type: "toolCall", id: "call_1", name: "bash", arguments: { command: "git status --short" } },
        { type: "toolCall", id: "call_2", name: "read", arguments: { path: "x" } },
        { type: "toolCall", id: "call_3", name: "bash", arguments: { command: "rtk gh pr list" } },
      ] } }),
    ].join("\n") + "\n", "utf8");
    expect(readRtkAdoption()).toEqual({ sessions: 1, bashCalls: 2, eligibleCalls: 2, rtkCalls: 1, missedCalls: 1, adoptionPct: 50, byHost: { pi: { bashCalls: 2, eligibleCalls: 2, rtkCalls: 1, missedCalls: 1, adoptionPct: 50 } } });

    // A host that writes both shapes must still count the call once.
    appendFileSync(path.join(dir, "branch", "s2.jsonl"), [
      JSON.stringify({ type: "custom", customType: "tool_execution_start", data: { toolCallId: "call_9", toolName: "bash", args: { command: "git diff" } } }),
      JSON.stringify({ type: "message", message: { role: "assistant", content: [
        { type: "toolCall", id: "call_9", name: "bash", arguments: { command: "git diff" } },
        { type: "toolCall", id: "call_10", name: "bash", arguments: { command: "ls -la" } },
      ] } }),
    ].join("\n") + "\n", "utf8");
    expect(readRtkAdoption()).toEqual({ sessions: 2, bashCalls: 4, eligibleCalls: 4, rtkCalls: 1, missedCalls: 3, adoptionPct: 25, byHost: { pi: { bashCalls: 4, eligibleCalls: 4, rtkCalls: 1, missedCalls: 3, adoptionPct: 25 } } });
  } finally {
    clearRtkAdoptionCache();
    if (prevSessions === undefined) delete process.env.TERSIO_SESSIONS_DIR;
    else process.env.TERSIO_SESSIONS_DIR = prevSessions;
    if (prevHome === undefined) delete process.env.TERSIO_HOME;
    else process.env.TERSIO_HOME = prevHome;
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("carries measured cost and run status through to recent rows", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-status-"));
  writeFileSync(
    path.join(dir, "s.jsonl"),
    [
      // Real OMP shape: usage.cost is an object with a total; failed runs carry the HTTP errorStatus.
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
    // The old check required a numeric usage.cost, so object costs never accumulated.
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

// One model key answers for every host: a price belongs to the model, not the agent that ran it.
test("two hosts spelling one model share a single priced key", () => {
  // A feed of its own: a live-cache tier is machine state, so the assertion would pass or fail by host.
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-hostkey-"));
  const prevPrices = process.env.TERSIO_PRICES_FILE;
  process.env.TERSIO_PRICES_FILE = path.join(dir, "prices.json");
  writeFileSync(
    process.env.TERSIO_PRICES_FILE,
    JSON.stringify({ fetchedAt: Date.now(), exact: { "sail/deepseek-ai/DeepSeek-V4.1-Flash": [0.15, 0.6, 0.003, 0.375] } }),
    "utf8",
  );
  try {
    const accum = newSessionAccum();
    const stamp = 1_800_000_000_000; // past both windows; the watermark is out of these tests.
    for (const [host, model, input] of [
      ["omp", "deepseek/deepseek-v4.1-flash", 1000],
      ["pi", "deepseek/deepseek-v4.1-flash", 2000],
    ] as Array<[string, string, number]>) {
      ingestSessionRow(accum, model, { input, output: 0, cacheRead: 0, cacheWrite: 0 }, stamp, undefined, undefined, undefined, host);
    }
    ingestSessionRow(
      accum,
      "opencode/opencode/longcat-2.5-preview",
      { input: 10, output: 1, cacheRead: 0, cacheWrite: 0 },
      stamp,
      undefined,
      undefined,
      undefined,
      "opencode",
    );

    const keys = Object.keys(accum.byModel).toSorted();
    // Three rows across three hosts fold to two models, not three: the model is the key.
    expect(keys).toEqual(["deepseek/deepseek-v4.1-flash", "opencode/opencode/longcat-2.5-preview"]);
    expect(accum.byModel["deepseek/deepseek-v4.1-flash"].input).toBe(3000);
    // The per-host split survives the fold, so a report can still attribute tokens to an agent.
    expect(Object.keys(accum.byHost["deepseek/deepseek-v4.1-flash"] ?? {}).sort()).toEqual(["omp", "pi"]);
    // And one key is one price resolution, so the same model is never counted twice as a guess.
    expect(keys.map((k) => priceFor(k).tier)).toEqual(["tail", "default"]);
  } finally {
    if (prevPrices === undefined) delete process.env.TERSIO_PRICES_FILE;
    else process.env.TERSIO_PRICES_FILE = prevPrices;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a host-reported cost outranks the rate card, including when it is zero", () => {
  const accum = newSessionAccum();
  const stamp = 1_800_000_000_000;
  const usage = { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0 };
  // A free gateway reports the whole zero object, which is an explicit price, not an absent one.
  ingestSessionRow(accum, "space-bunny", { ...usage, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stamp, undefined, undefined, undefined, "omp");
  // A priced model reports its own figure, which beats the $2 Sonnet default by five times.
  ingestSessionRow(accum, "kilo/stepfun/step-5-preview", { ...usage, cost: { total: 69.08 } }, stamp, undefined, undefined, undefined, "omp");
  // A model with no reported cost stays an estimate.
  ingestSessionRow(accum, "nope-9", usage, stamp, undefined, undefined, undefined, "omp");

  expect(accum.byModelMeasured["space-bunny"]).toBe(0);
  expect(accum.byModelMeasured["kilo/stepfun/step-5-preview"]).toBe(69.08);
  expect(accum.byModelMeasured["nope-9"]).toBeUndefined();

  const free = usdCost(accum.byModel["space-bunny"], "space-bunny", accum.byModelMeasured["space-bunny"]);
  expect(free.usd).toBe(0);
  expect(free.tier).toBe("measured");
  expect(free.priced).toBe(true);

  const priced = usdCost(accum.byModel["kilo/stepfun/step-5-preview"], "kilo/stepfun/step-5-preview", accum.byModelMeasured["kilo/stepfun/step-5-preview"]);
  expect(priced.usd).toBe(69.08);
  expect(priced.tier).toBe("measured");

  const guess = usdCost(accum.byModel["nope-9"], "nope-9", accum.byModelMeasured["nope-9"]);
  expect(guess.tier).toBe("default");
  expect(guess.priced).toBe(false);
});

test("a partly measured model falls back to the rate card rather than zero", () => {
  const accum = newSessionAccum();
  const stamp = 1_800_000_000_000;
  ingestSessionRow(accum, "half-priced", { input: 1000, output: 0, cacheRead: 0, cacheWrite: 0, cost: 1 }, stamp, undefined, undefined, undefined, "omp");
  ingestSessionRow(accum, "half-priced", { input: 1000, output: 0, cacheRead: 0, cacheWrite: 0 }, stamp, undefined, undefined, undefined, "omp");

  expect(accum.byModelMessages["half-priced"]).toBe(2);
  expect(accum.byModelCostMessages["half-priced"]).toBe(1);
  // Not covered, so the caller must pass undefined and price the whole model from the card.
  const covered = (accum.byModelCostMessages["half-priced"] ?? 0) >= accum.byModelMessages["half-priced"]!;
  expect(covered).toBe(false);
  expect(usdCost(accum.byModel["half-priced"], "half-priced", covered ? accum.byModelMeasured["half-priced"] : undefined).tier).toBe("default");
});

test("co2Grams defaults to the gpt-4o served figure", () => {
  expect(co2Grams(5000)).toBe(co2GramsFor("gpt-4o", 5000));
});
test("opencode rows carry the msg file id and transcript rows carry row ids", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-ids-"));
  const prevSessions = process.env.TERSIO_SESSIONS_DIR;
  const prevOc = process.env.TERSIO_OPENCODE_DIR;
  process.env.TERSIO_SESSIONS_DIR = path.join(dir, "no-sessions");
  process.env.TERSIO_OPENCODE_DIR = path.join(dir, "oc");
  try {
    mkdirSync(path.join(dir, "oc", "ses_abc"), { recursive: true });
    writeFileSync(
      path.join(dir, "oc", "ses_abc", "msg_xyz.json"),
      JSON.stringify({ role: "assistant", modelID: "m", providerID: "p", tokens: { input: 10, output: 1 }, time: { created: 1788000000000 } }),
      "utf8",
    );
    mkdirSync(path.join(dir, "no-sessions"), { recursive: true });
    const s = importSessionTokens();
    expect(s.recent).toHaveLength(1);
    expect(s.recent[0].id).toBe("msg_xyz");
  } finally {
    if (prevSessions === undefined) delete process.env.TERSIO_SESSIONS_DIR;
    else process.env.TERSIO_SESSIONS_DIR = prevSessions;
    if (prevOc === undefined) delete process.env.TERSIO_OPENCODE_DIR;
    else process.env.TERSIO_OPENCODE_DIR = prevOc;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("gateway variants of one model fold into a single labeled row", () => {
  const folded = foldModelsByLabel(
    {
      "opencode/openai/gpt-5.2-codex": { input: 100, output: 10, cacheRead: 1000, cacheWrite: 0 },
      "opencode/github-copilot/gpt-5.2-codex": { input: 50, output: 5, cacheRead: 500, cacheWrite: 0 },
      "meta/muse-spark-1.3-contributor": { input: 7, output: 1, cacheRead: 0, cacheWrite: 0 },
    },
    {
      "opencode/openai/gpt-5.2-codex": 4,
      "opencode/github-copilot/gpt-5.2-codex": 2,
      "meta/muse-spark-1.3-contributor": 1,
    },
  );
  expect(Object.keys(folded.byModel).sort()).toEqual(["Meta - Muse-Spark-1.3-Contributor", "OpenAI - GPT-5.2-Codex"]);
  expect(folded.byModel["OpenAI - GPT-5.2-Codex"]).toEqual({ input: 150, output: 15, cacheRead: 1500, cacheWrite: 0 });
  expect(folded.byModelMessages["OpenAI - GPT-5.2-Codex"]).toBe(6);
  expect(folded.byModelMessages["Meta - Muse-Spark-1.3-Contributor"]).toBe(1);
});

test("free suffix and case variants fold into one model row", () => {
  expect(canonicalModelId("DeepSeek-V4.1-Flash")).toBe(canonicalModelId("deepseek-v4.1-flash:free"));
  expect(canonicalModelId("muse-spark-1.3-contributor-free")).toBe("muse-spark-1.3-contributor");
  expect(displayModelId("deepseek-v4.1-flash")).toBe("Deepseek-V4.1-Flash");
  expect(displayModelId("deepseek-v4.1-flash:free")).toBe("Deepseek-V4.1-Flash");
  expect(displayModelId("meta/muse-spark-1.3-contributor")).toBe("Meta - Muse-Spark-1.3-Contributor");
  expect(displayModelId("codex/openai")).toBe("OpenAI");
  // The Codex host and its provider id are not the model's author.
  expect(displayModelId("codex/openai/zcode/glm-5.3-flash")).toBe("Z.ai - GLM-5.3-Flash");
  expect(displayModelId("codex/openai/gpt-6-luna")).toBe("OpenAI - GPT-6-Luna");
  expect(displayModelId("gemma4:31b")).toBe("Google - Gemma4-31B");
  expect(displayModelId("opencode/Github-Copilot/grok-code-fast-1")).toBe("xAI - Grok-Code-Fast-1");
  expect(displayModelId("Swe-1-6-Slow")).toBe("Cognition - SWE-1-6-Slow");
  expect(displayModelId("opencode/nvidia/minimaxai/minimax-m2.7")).toBe("Minimax-M2.7");
  expect(displayModelId("opencode/nvidia/google/gemma-4-31b-it")).toBe("Google - Gemma-4-31B-IT");
  expect(displayModelId("opencode/kilo/stealth/space-bunny-alpha")).toBe("Stealth - Space-Bunny");
  expect(displayModelId("Anthropic - Claude - Haiku-4.5")).toBe("Anthropic - Claude - Haiku-4.5");
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

// Regression: the importer walked only the first session dir, hiding a host.
test("importer walks both hosts' session directories", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-both-hosts-"));
  const prevHome = process.env.HOME;
  const prevPiAgent = process.env.PI_CODING_AGENT_DIR;
  const prevPiFlag = process.env.PI_CODING_AGENT;
  const prevSessions = process.env.TERSIO_SESSIONS_DIR;
  const prevReset = process.env.TERSIO_RESET_FILE;
  const row = (id: string, ts: string, model: string, input: number): string =>
    `{"type":"message","id":"${id}","timestamp":"${ts}","message":{"role":"assistant","model":"${model}","usage":{"input":${input},"output":10,"cacheRead":0,"cacheWrite":0}}}`;
  try {
    for (const [host, model, input] of [["omp", "omp-model", 200], ["pi", "pi-model", 400]] as const) {
      const dir = path.join(home, `.${host}`, "agent", "sessions", "branch");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        path.join(dir, "s.jsonl"),
        [row("a", "2026-09-03T10:00:00.000Z", model, input)].join("\n") + "\n",
        "utf8",
      );
    }
    process.env.HOME = home;
    delete process.env.TERSIO_SESSIONS_DIR;
    process.env.PI_CODING_AGENT = "true";
    process.env.PI_CODING_AGENT_DIR = path.join(home, ".pi", "agent");
    process.env.TERSIO_RESET_FILE = path.join(home, "no-reset.json");
    clearRtkAdoptionCache();

    const s = importSessionTokens();
    expect(Object.keys(s.byModel).sort()).toEqual(["omp-model", "pi-model"]);
    expect(s.byModel["omp-model"].input).toBe(200);
    expect(s.byModel["pi-model"].input).toBe(400);
  } finally {
    for (const [key, value] of [["HOME", prevHome], ["PI_CODING_AGENT_DIR", prevPiAgent], ["PI_CODING_AGENT", prevPiFlag], ["TERSIO_SESSIONS_DIR", prevSessions], ["TERSIO_RESET_FILE", prevReset]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(home, { recursive: true, force: true });
  }
});

// --- data-backups: snapshots hold user files, so each test runs against a fake home. ---
let dataBackupsDir = "";
let previous: Record<string, string | undefined> = {};

/** Every source env var and the file it points at inside the sandbox. */
const SOURCE_FILES: ReadonlyArray<[string, string]> = [
  ["TERSIO_USAGE_DB", "usage.db"],
  ["TERSIO_AGENT_STATS_DB", "stats.db"],
  ["TERSIO_AGENT_SESSIONS_DB", "agent.db"],
  ["TERSIO_RTK_DB", "rtk.db"],
];

/** Point every data source at the sandbox, so no test can touch the developer's own files. */
function sandboxSources(): void {
  previous = {};
  previous.TERSIO_HOME = process.env.TERSIO_HOME;
  process.env.TERSIO_HOME = path.join(dataBackupsDir, ".tersio");
  for (const [key, name] of SOURCE_FILES) {
    previous[key] = process.env[key];
    process.env[key] = path.join(dataBackupsDir, name);
  }
  // Each source is written where it now resolves, so the pack finds one file per label.
  for (const source of dataSources()) {
    mkdirSync(path.dirname(source.source), { recursive: true });
    writeFileSync(source.source, `${source.label} body`);
  }
}

/** A database held open, so its committed rows still sit in the write-ahead log while the pack runs. */
function openLiveDb(file: string): { exec(sql: string): void; close(): void } | null {
  const req = createRequire(import.meta.url);
  for (const driver of ["node:sqlite", "bun:sqlite"]) {
    try {
      const mod = req(driver) as { DatabaseSync?: new (p: string) => { exec(sql: string): void; close(): void }; Database?: new (p: string) => { exec(sql: string): void; close(): void } };
      const Ctor = mod.DatabaseSync ?? mod.Database;
      if (Ctor) return new Ctor(file);
    } catch { /* this runtime has no in-process driver */ }
  }
  return null;
}

// The hooks stay scoped to this suite so the sandbox env never leaks into the other tests above.
describe("data backups", () => {
  beforeEach(() => {
    dataBackupsDir = mkdtempSync(path.join(os.tmpdir(), "tersio-data-"));
    sandboxSources();
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(dataBackupsDir, { recursive: true, force: true });
  });

  test("a snapshot packs every file the machine has into one file", () => {
    const made = createDataBackup();
    expect(path.basename(made.path)).toMatch(/^data-\d+\.snap$/);
    expect(existsSync(made.path), "one file on disk").toBe(true);
    const labels = made.members.map((entry) => entry.label);
    expect(labels).toContain("Usage ledger");
    expect(labels).toContain("Agent stats");
    expect(labels).toContain("State");
    expect(made.members.every((entry) => entry.source.startsWith(dataBackupsDir))).toBe(true);
    // Listing reads the snapshot alone, so nothing sits beside it.
    expect(readdirSync(backupDir()).filter((name) => name.startsWith("data-"))).toEqual([path.basename(made.path)]);
  });

  test("only the newest snapshots are kept", () => {
    for (let i = 0; i < BACKUP_KEEP + 2; i += 1) createDataBackup();
    const kept = listDataBackups();
    expect(kept.length).toBe(BACKUP_KEEP);
    const stamps = kept.map((entry) => entry.name.replace("data-", ""));
    expect(stamps).toEqual([...stamps].toSorted((a, b) => b.localeCompare(a)));
  });

  test("a damaged snapshot never displaces a readable one", () => {
    const bad = createDataBackup();
    const bytes = readFileSync(bad.path);
    bytes[bytes.length - 4] ^= 0xff;
    writeFileSync(bad.path, bytes);
    // Newest by a clear margin, so age alone would keep it and drop a readable snapshot.
    const ahead = new Date(Date.now() + 3_600_000);
    utimesSync(bad.path, ahead, ahead);
    const readable = Array.from({ length: BACKUP_KEEP }, () => createDataBackup().name);

    pruneBackups();

    expect(listDataBackups().length).toBe(BACKUP_KEEP);
    expect(readable.filter((name) => !existsSync(path.join(backupDir(), name)))).toEqual([]);
    expect(existsSync(bad.path)).toBe(false);
  });

  test("a snapshot keeps a row that still sits in the write-ahead log", () => {
    const ledger = path.join(dataBackupsDir, "usage.db");
    rmSync(ledger, { force: true });
    const live = openLiveDb(ledger);
    if (!live) return;
    try {
      live.exec("PRAGMA journal_mode=WAL; CREATE TABLE t(x); INSERT INTO t VALUES (1);");
      expect(existsSync(`${ledger}-wal`), "the row sits in the log, not the main file").toBe(true);
      const made = createDataBackup();
      const back = path.join(dataBackupsDir, "readback");
      mkdirSync(back, { recursive: true });
      // What a restore does: the main file, plus any sidecar the pack had to keep beside it.
      for (const name of ["usage.db", "usage.db-wal", "usage.db-shm"]) {
        const body = readSnapshotMember(made, name);
        if (body) writeFileSync(path.join(back, name), body);
      }
      expect(sqliteRead(path.join(back, "usage.db"), "SELECT x FROM t;").trim()).toBe("1");
    } finally {
      live.close();
    }
  });

  test("a restore puts the snapshot's files back and leaves the rest alone", () => {
    const made = createDataBackup();
    const ledger = path.join(dataBackupsDir, "usage.db");
    writeFileSync(ledger, "changed after the snapshot");
    const untouched = path.join(dataBackupsDir, "loose.txt");
    writeFileSync(untouched, "keep me");

    expect(restoreDataBackup(made.name)).toBe(true);
    expect(readFileSync(ledger, "utf8")).toBe("Usage ledger body");
    // The restore copies the live data first, so a restore of the wrong snapshot stays reversible.
    const after = listDataBackups();
    expect(after.length).toBe(2);
    expect(readSnapshotMember(after[0], "usage.db")).toEqual(Buffer.from("changed after the snapshot"));
    // A file the snapshot does not carry survives the restore.
    expect(readFileSync(untouched, "utf8")).toBe("keep me");
  });

  test("a restore refuses a damaged snapshot and leaves the live data alone", () => {
    const made = createDataBackup();
    const bytes = readFileSync(made.path);
    bytes[bytes.length - 4] ^= 0xff; // one flipped byte inside the packed body
    writeFileSync(made.path, bytes);
    const ledger = path.join(dataBackupsDir, "usage.db");
    writeFileSync(ledger, "still live");

    expect(restoreDataBackup(made.name)).toBe(false);
    expect(readFileSync(ledger, "utf8")).toBe("still live");
  });

  test("a restore refuses a name outside the backup directory", () => {
    createDataBackup();
    expect(restoreDataBackup("../usage.db")).toBe(false);
    expect(restoreDataBackup("/etc/passwd")).toBe(false);
    expect(restoreDataBackup("missing")).toBe(false);
  });

  test("a delete removes exactly one snapshot", () => {
    createDataBackup();
    createDataBackup();
    const all = listDataBackups();
    expect(deleteDataBackup(all[0].name)).toBe(true);
    const left = listDataBackups();
    expect(left.map((entry) => entry.name)).toEqual([all[1].name]);
    // The live data is untouched by a delete of its snapshot.
    expect(existsSync(path.join(dataBackupsDir, "usage.db"))).toBe(true);
  });

  test("a legacy mirror lists, restores the ledger, and retires once a snapshot carries it", () => {
    const legacyName = "usage-20260101000000.db";
    mkdirSync(backupDir(), { recursive: true });
    writeFileSync(path.join(backupDir(), legacyName), "the old mirror");
    const found = listDataBackups();
    expect(found.map((entry) => entry.name)).toContain(legacyName);
    expect(found.find((entry) => entry.name === legacyName)?.members.map((file) => file.label)).toEqual(["Usage ledger"]);

    const ledger = path.join(dataBackupsDir, "usage.db");
    writeFileSync(ledger, "changed");
    expect(restoreDataBackup(legacyName)).toBe(true);
    expect(readFileSync(ledger, "utf8")).toBe("the old mirror");
    // The restore's own safety snapshot carries the ledger, so the mirror is redundant afterwards.
    expect(listDataBackups().some((entry) => entry.name === legacyName)).toBe(false);
  });

  test("a delete removes a legacy mirror and never the live ledger", () => {
    const legacyName = "usage-20260101000000.db";
    mkdirSync(backupDir(), { recursive: true });
    writeFileSync(path.join(backupDir(), legacyName), "the old mirror");
    expect(deleteDataBackup(legacyName)).toBe(true);
    expect(listDataBackups().some((entry) => entry.name === legacyName)).toBe(false);
    expect(readFileSync(path.join(dataBackupsDir, "usage.db"), "utf8")).toBe("Usage ledger body");
  });
});

// --- gain-currency: the server owns display currency, a new origin each run, so a pick POSTs. ---
function serverEnv(home: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    TERSIO_USAGE_FILE: path.join(home, "usage.jsonl"),
    TERSIO_SESSIONS_DIR: path.join(home, "no-sessions"),
    TERSIO_RTK_DB: path.join(home, "no-rtk.db"),
    TERSIO_USAGE_DB: path.join(home, "no-usage.db"),
    TERSIO_RESET_FILE: path.join(home, "reset.json"),
  };
}

function startDashboard(home: string): Promise<{ child: ChildProcess; url: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn: () => void): void => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn();
      }
    };
    const child = spawn(process.execPath, [installer, "dashboard", "--port", "0"], {
      cwd: root,
      env: serverEnv(home),
    });
    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      done(() => { reject(new Error(`dashboard server did not come up: ${out}`)); });
    }, 15000);
    child.on("error", (err) => { done(() => { reject(err); }); });
    const watch = (chunk: unknown): void => {
      out += String(chunk);
      const match = /\[ok\] Dashboard live → (http:\/\/\S+)/.exec(out);
      if (match) done(() => { resolve({ child, url: match[1] }); });
    };
    child.stdout?.on("data", watch);
    child.stderr?.on("data", watch);
  });
}

function stopDashboard(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (): void => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    child.on("exit", done);
    child.kill("SIGKILL");
    setTimeout(done, 5000);
  });
}

async function postCurrency(url: string, body: string): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${url}/currency`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  return { status: res.status, json: await res.json() };
}

test("dashboard persists display currency across restarts", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-gain-cur-"));
  try {
    const first = await startDashboard(home);
    try {
      const bad = await postCurrency(first.url, JSON.stringify({ currency: "bogus" }));
      expect(bad.status).toBe(400);
      const ok = await postCurrency(first.url, JSON.stringify({ currency: "PHP" }));
      expect(ok.status).toBe(200);
      expect(ok.json).toEqual({ ok: true, currency: "PHP" });
      const malformed = await postCurrency(first.url, "{ not json");
      expect(malformed.status).toBe(400);
    } finally {
      await stopDashboard(first.child);
    }
    const stored = JSON.parse(
      readFileSync(path.join(home, ".tersio", "settings.json"), "utf8"),
    ) as { currency?: string };
    expect(stored.currency).toBe("PHP");

    const second = await startDashboard(home);
    try {
      const res = await fetch(`${second.url}/settings`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as { currency?: string };
      expect(data.currency, "reopened dashboard defaults to the saved currency").toBe("PHP");
    } finally {
      await stopDashboard(second.child);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// --- currency -------------------------------------------------------------
test("formatCurrency defaults to USD with magnitude-aware decimals", () => {
  expect(formatCurrency(1.5, "USD")).toBe("$1.50");
  expect(formatCurrency(0.000187, "USD")).toBe("$0.000187");
  expect(formatCurrency(0, "USD")).toBe("$0.00");
});

test("formatCurrency converts through the snapshot rates", () => {
  expect(convertUsd(1, "PHP")).toBe(58.7);
  expect(formatCurrency(1, "PHP")).toBe("₱58.70");
  expect(formatCurrency(1, "JPY")).toBe("¥150");
  expect(formatCurrency(2, "EUR")).toBe("€1.84");
});

function fixtureSessions(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-cur-sessions-"));
  mkdirSync(path.join(dir, "branch"), { recursive: true });
  writeFileSync(
    path.join(dir, "branch", "s1.jsonl"),
    [
      '{"type":"session","version":3,"id":"s1","timestamp":"2026-09-01T10:00:00.000Z","cwd":"/tmp"}',
      '{"type":"message","id":"a","timestamp":"2026-09-01T10:01:00.000Z","message":{"role":"assistant","model":"claude-sonnet-5","usage":{"input":1000,"output":200,"cacheRead":500,"cacheWrite":0,"cost":0.012},"content":[]}}',
    ].join("\n") + "\n",
    "utf8",
  );
  return dir;
}

function usageEnv(dir: string, sessions: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: dir,
    USERPROFILE: dir,
    TERSIO_USAGE_FILE: path.join(dir, "usage.jsonl"),
    TERSIO_SESSIONS_DIR: sessions,
    TERSIO_RESET_FILE: path.join(dir, "reset.json"),
    TERSIO_USAGE_DB: path.join(dir, "usage.db"),
    TERSIO_RTK_DB: path.join(dir, "no-rtk.db"),
  };
}

// Session defaults, including the display currency, live in ~/.tersio/settings.json.
function writeSettingsLock(home: string, tersio: Record<string, unknown>): void {
  const dir = path.join(home, ".tersio");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "settings.json"), JSON.stringify(tersio), "utf8");
}

test("dashboard --export bakes the requested currency into data.json", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-cur-gain-"));
  const out = path.join(dir, "dash.html");
  try {
    const result = spawnSync(process.execPath, [installer, "dashboard", "--export", out, "--currency", "PHP"], {
      encoding: "utf8",
      cwd: root,
      env: {
        ...process.env,
        TERSIO_USAGE_FILE: path.join(dir, "usage.jsonl"),
        TERSIO_SESSIONS_DIR: path.join(dir, "no-sessions"),
        TERSIO_RTK_DB: path.join(dir, "no-rtk.db"),
        TERSIO_USAGE_DB: path.join(dir, "no-usage.db"),
        TERSIO_RESET_FILE: path.join(dir, "reset.json"),
      },
    });
    expect(result.status, result.stderr).toBe(0);
    const body = readFileSync(out, "utf8");
    expect(body).toMatch(/"currency":"PHP"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The Dashboard cannot import CLI code, so each keeps an FX snapshot copy; a drift would price differently.
test("the CLI and Dashboard FX snapshots agree", () => {
  expect(FX_SNAPSHOT).toEqual(FX_SNAPSHOT_RATES as unknown as Record<string, number>);
});

// --- agent-offset: the param feeds a raw SQL OFFSET, so it floors to whole rows and refuses negatives. ---
const url = (query: string): string => `/api/agent?range=24h&view=requests&${query}`;

describe('agent offset param', () => {
  test('an absent or empty param reads as the newest rows', () => {
    expect(offsetFrom('/api/agent')).toBe(0);
    expect(offsetFrom('/api/agent?')).toBe(0);
    expect(offsetFrom(url('offset='))).toBe(0);
  });

  test('a whole number passes through and a negative one floors to zero', () => {
    expect(offsetFrom(url('offset=0'))).toBe(0);
    expect(offsetFrom(url('offset=400'))).toBe(400);
    // An OFFSET below zero is an error in SQL, so it reads as the newest rows instead.
    expect(offsetFrom(url('offset=-5'))).toBe(0);
    expect(offsetFrom(url('offset=-0.5'))).toBe(0);
  });

  test('a fraction floors to whole rows rather than rounding past them', () => {
    expect(offsetFrom(url('offset=3.7'))).toBe(3);
    expect(offsetFrom(url('offset=203.9'))).toBe(203);
  });

  test('a non-numeric value reads as the newest rows, not as a crash', () => {
    expect(offsetFrom(url('offset=abc'))).toBe(0);
    expect(offsetFrom(url('offset=1e5x'))).toBe(0);
    expect(offsetFrom(url('offset='))).toBe(0);
  });

  test('a value in a later param position is still read', () => {
    expect(offsetFrom(url('offset=250&view=requests'))).toBe(250);
  });
});

// --- omp-stats: pins the aggregate against a fixture store, one assertion per contract rule. ---
const HOUR = 3_600_000;
const DAY = 86_400_000;

let ompStatsDir = '';
let ompStatsPrevious: { stats?: string; agent?: string };

describe('omp stats', () => {
  beforeEach(() => {
    ompStatsDir = mkdtempSync(path.join(os.tmpdir(), 'tersio-omp-'));
    ompStatsPrevious = { stats: process.env.TERSIO_AGENT_STATS_DB, agent: process.env.TERSIO_AGENT_SESSIONS_DB };
  });

  afterEach(() => {
    for (const [key, value] of Object.entries({ TERSIO_AGENT_STATS_DB: ompStatsPrevious.stats, TERSIO_AGENT_SESSIONS_DB: ompStatsPrevious.agent })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(ompStatsDir, { recursive: true, force: true });
  });

  /** Five rows: two priced and cached, one free with no duration, one error, one aborted. */
  function seed(): { now: number } {
    const now = Date.now();
    const s1 = sessionPath(ompStatsDir, '-proj-a', 's1.jsonl');
    const s2 = sessionPath(ompStatsDir, '-proj-b', 's2.jsonl');
    process.env.TERSIO_AGENT_STATS_DB = writeUsageStore(path.join(ompStatsDir, 'usage.db'), {
      messages: [
        { session: s1, entry: 'e1', model: 'commandcode/priced-model', ts: now - 5 * HOUR, duration: 2000, ttft: 500, input: 1000, output: 500, cacheRead: 4000, cost: 0.10, tools: ['read', 'bash'] },
        { session: s1, entry: 'e2', model: 'commandcode/priced-model', ts: now - 4 * HOUR, duration: 4000, ttft: 1500, input: 2000, output: 1000, cacheRead: 8000, cost: 0.20 },
        { session: s2, entry: 'e3', model: 'magpie/free-model', ts: now - 3 * HOUR, duration: null, input: 100, output: 50, agentType: 'subagent' },
        { session: s2, entry: 'e4', model: 'xai-oauth/free-model', ts: now - 2 * HOUR, stop: 'error', error: '429 Too Many Requests retry-after-ms=37044000 req_abcdef123456', duration: 3000, input: 10, agentType: 'advisor' },
        { session: s1, entry: 'e5', model: 'xai-oauth/free-model-2', ts: now - 10 * 60_000, stop: 'aborted', duration: 1000, input: 20 },
      ],
    });
    process.env.TERSIO_AGENT_SESSIONS_DB = writeQuotaDb(path.join(ompStatsDir, 'agent.db'), [
      { ts: now - 3 * HOUR, provider: 'openai-codex', accountKey: 'oauth|a', email: 'a@example.com', limitId: 'openai-codex:primary', label: '30 days', windowLabel: '30 days', usedFraction: 0.2, status: 'ok', resetsAt: now + DAY },
      { ts: now - 2 * HOUR, provider: 'openai-codex', accountKey: 'oauth|a', email: 'a@example.com', limitId: 'openai-codex:primary', label: '30 days', windowLabel: '30 days', usedFraction: 0.6, status: 'ok', resetsAt: now + DAY },
    ]);
    return { now };
  }

  describe.skipIf(!hasSqlite())('omp aggregate', () => {
    test('matches the metric contract on every figure', () => {
      seed();
      const omp = readAgentStats('all');
      expect(omp.available).toBe(true);

      expect(omp.overall.requests).toBe(5);
      expect(omp.overall.failed).toBe(1);
      expect(omp.overall.successful).toBe(4);
      expect(omp.overall.errorRate).toBeCloseTo(1 / 5, 12);
      expect(omp.overall.input).toBe(3130);
      expect(omp.overall.output).toBe(1550);
      expect(omp.overall.cacheRead).toBe(12000);
      expect(omp.overall.cacheWrite).toBe(0);
      expect(omp.overall.total).toBe(16680);
      expect(omp.overall.cacheRate).toBeCloseTo(12000 / 15130, 12);
      expect(omp.overall.costUsd).toBeCloseTo(0.3, 12);
      // The store keeps only the host's reported cost, never a split, so nothing reads as an unpriced route.
      expect(omp.overall.unpricedRequests).toBe(0);
      expect(omp.overall.avgDurationMs).toBeCloseTo(2500, 9);
      // Two of the five rows carry a latency, so the average covers only those two: 500ms and 1500ms.
      expect(omp.overall.avgTtftMs).toBeCloseTo(1000, 9);
      expect(omp.overall.avgTokensPerSecond).toBeCloseTo(125, 9);
      // The fixture spans five hours, minus the ten minutes of the newest row.
      expect(omp.overall.lastTs! - omp.overall.firstTs!).toBe(5 * HOUR - 10 * 60_000);
    });

    test('reports the host cost whole, with no per-component split', () => {
      seed();
      const omp = readAgentStats('all');

      const mix = omp.byModel.find((row) => row.key === 'commandcode/priced-model')?.costMix;
      expect(mix?.input).toBe(0);
      expect(mix?.cacheRead).toBe(0);
      expect(mix?.cacheWrite).toBe(0);
      expect(mix?.total).toBeCloseTo(0.3, 12);
      expect(mix!.input + mix!.output + mix!.cacheRead + mix!.cacheWrite).toBeCloseTo(mix!.total, 12);
      expect(omp.overall.costMix.total).toBeCloseTo(0.3, 12);
    });

    test('the stored gateway wins over the model id prefix', () => {
      // `deepseek/deepseek-v4.1-flash` was served by commandcode; the model id alone would say deepseek.
      const dir = mkdtempSync(path.join(os.tmpdir(), 'tersio-gateway-'));
      const session = sessionPath(dir, '-proj-a', 'gw.jsonl');
      process.env.TERSIO_AGENT_STATS_DB = writeUsageStore(path.join(dir, 'usage.db'), {
        messages: [
          { session, entry: 'g1', model: 'deepseek/deepseek-v4.1-flash', gateway: 'commandcode', ts: Date.now() - HOUR, input: 10, output: 5 },
          { session, entry: 'g2', model: 'magpie/free-model', ts: Date.now() - HOUR, input: 10, output: 5 },
        ],
      });
      try {
        const byModel = readAgentStats('all').byModel;
        const routed = byModel.find((row) => row.key === 'deepseek/deepseek-v4.1-flash');
        expect(routed?.provider).toBe('commandcode');
        // A row with no stored gateway still reads from its model id.
        expect(byModel.find((row) => row.key === 'magpie/free-model')?.provider).toBe('magpie');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    test('groups by model and provider, by provider, by project, and by agent type', () => {
      seed();
      const omp = readAgentStats('all');

      expect(omp.byModel.map((row) => `${row.key}|${row.provider}`).toSorted()).toEqual([
        'commandcode/priced-model|commandcode',
        'magpie/free-model|magpie',
        'xai-oauth/free-model-2|xai-oauth',
        'xai-oauth/free-model|xai-oauth',
      ]);
      expect(omp.byModel[0].key).toBe('commandcode/priced-model');
      expect(omp.byModel[0].requests).toBe(2);
      expect(omp.byModel[0].costUsd).toBeCloseTo(0.3, 12);

      const byProvider = Object.fromEntries(omp.byProvider.map((row) => [row.key, row]));
      expect(byProvider.commandcode.requests).toBe(2);
      expect(byProvider.commandcode.models).toBe(1);
      expect(byProvider['xai-oauth'].models).toBe(2);
      expect(byProvider.magpie.failed).toBe(0);

      const byProject = Object.fromEntries(omp.byProject.map((row) => [row.key, row.requests]));
      expect(byProject['-proj-a']).toBe(3);
      expect(byProject['-proj-b']).toBe(2);

      const byAgent = Object.fromEntries(omp.byAgentType.map((row) => [row.agentType, row.requests]));
      expect(byAgent).toEqual({ main: 3, subagent: 1, advisor: 1 });
    });

    test('buckets the series by range and keeps the totals additive', () => {
      seed();
      for (const [range, bucketMs] of [['1h', 300_000], ['24h', HOUR], ['7d', DAY], ['30d', DAY], ['90d', DAY], ['all', DAY]] as const) {
        const omp = readAgentStats(range);
        expect(omp.bucketMs).toBe(bucketMs);
        expect(omp.series.reduce((sum, bucket) => sum + bucket.requests, 0)).toBe(omp.overall.requests);
        expect(omp.series.reduce((sum, bucket) => sum + bucket.tokens, 0)).toBe(omp.overall.total);
        for (const bucket of omp.series) expect(bucket.ts % bucketMs).toBe(0);
      }
      // A one hour window holds only the row written ten minutes ago.
      const hour = readAgentStats('1h');
      expect(hour.overall.requests).toBe(1);
      expect(hour.series.length).toBe(1);
    });

    test('splits provider and hour series, and fills every hour slot it has data for', () => {
      seed();
      const omp = readAgentStats('all');
      const providers = omp.seriesByProvider.map((series) => series.provider);
      // Every provider fits under the series cap here, ordered by cost, so commandcode leads.
      expect(providers.toSorted()).toEqual(['commandcode', 'magpie', 'xai-oauth']);
      expect(providers[0]).toBe('commandcode');
      const commandcode = omp.seriesByProvider.find((series) => series.provider === 'commandcode');
      expect(commandcode?.points.reduce((sum, point) => sum + point.requests, 0)).toBe(2);
      expect(commandcode?.points.every((point) => point.ts % DAY === 0)).toBe(true);

      expect(omp.hourOfDay.reduce((sum, slot) => sum + slot.requests, 0)).toBe(5);
      expect(omp.hourOfDay.every((slot) => slot.hour >= 0 && slot.hour < 24)).toBe(true);
      expect(omp.modelSeries.length).toBeGreaterThan(0);
    });

    test('reads the recent rows and groups failures by normalized signature', () => {
      seed();
      const omp = readAgentStats('all');
      expect(omp.recent.length).toBe(5);
      expect(omp.recent[0].entryId).toBe('e5');
      // e1 carries 500ms and e5 none, so a row reads its own latency or null, never a fill value.
      expect(omp.recent.find((row) => row.entryId === 'e1')?.ttftMs).toBe(500);
      expect(omp.recent.find((row) => row.entryId === 'e5')?.ttftMs).toBe(null);

      expect(omp.errorGroups.length).toBe(1);
      expect(omp.errorGroups[0].count).toBe(1);
      expect(omp.errorGroups[0].latest.entryId).toBe('e4');
      expect(omp.errorGroups[0].models).toEqual([{ model: 'xai-oauth/free-model', provider: 'xai-oauth', count: 1 }]);
      expect(omp.errorModels).toEqual([{ model: 'xai-oauth/free-model', provider: 'xai-oauth', count: 1 }]);
      expect(omp.errorGroups[0].signature).toBe('429 Too Many Requests retry-after-ms=N <id>');
    });

    test('averages throughput per model, provider, and bucket', () => {
      seed();
      const omp = readAgentStats('all', 'models');
      const priced = omp.modelPerformance.find((series) => series.model === 'commandcode/priced-model' && series.provider === 'commandcode');
      expect(priced).toBeDefined();
      // Rows an hour apart may straddle UTC midnight; assert only what holds either way: 250 tok/s each.
      expect(priced?.points.reduce((sum, point) => sum + point.requests, 0)).toBe(2);
      expect(priced?.points.every((point) => point.avgTokensPerSecond === 250)).toBe(true);
      // e1: 500/2000ms, e2: 1500/4000ms, both 250 tok/s. A point holds one row when the two land in different day buckets, so a per-point mean reads 500 or 1500; the request-weighted mean is 1000 either way.
      const ttftTotal = priced?.points.reduce((sum, point) => sum + (point.avgTtftMs ?? 0) * point.requests, 0) ?? 0;
      expect(ttftTotal / 2).toBe(1000);
      // A provider with no timed message carries null, not a zero that would draw a flat line.
      const magpie = omp.modelPerformance.find((series) => series.provider === 'magpie');
      expect(magpie?.points.every((p) => p.avgTokensPerSecond === null && p.avgTtftMs === null)).toBe(true);
      // The models view carries the group, and a view that does not need it skips it.
      expect(readAgentStats('all', 'traces').modelPerformance).toEqual([]);
    });

    test('counts a tool name as one whole call of its message', () => {
      seed();
      const omp = readAgentStats('all');
      const read = omp.tools.find((row) => row.tool === 'read');
      const bash = omp.tools.find((row) => row.tool === 'bash');
      expect(omp.tools.length).toBe(2);
      expect(read?.calls).toBe(1);
      expect(read?.model).toBe('commandcode/priced-model');
      // This row carries names only, so the sizes and the error flag read zero rather than a guess.
      expect(read?.totalTokensShare).toBeCloseTo(5500, 9);
      expect(read?.outputTokensShare).toBeCloseTo(500, 9);
      expect(read?.costShare).toBeCloseTo(0.10, 12);
      expect(read?.argsChars).toBe(0);
      expect(read?.resultChars).toBe(0);
      expect(read?.errors).toBe(0);
      expect(bash?.calls).toBe(1);
      expect(omp.tools[0].tool).toBe('read');
      expect(omp.toolsByModel.length).toBe(2);
      expect(omp.toolsByModel[0].model).toBe('commandcode/priced-model');
      expect(omp.toolSeries.reduce((sum, point) => sum + point.calls, 0)).toBe(2);
    });

    test('groups messages into session traces and counts their tool calls', () => {
      seed();
      const traces = readAgentStats('all').traces;
      expect(traces.length).toBe(2);
      const first = traces[0];
      expect(first.sessionFile).toBe(sessionPath(ompStatsDir, '-proj-a', 's1.jsonl'));
      expect(first.requests).toBe(3);
      expect(first.toolCalls).toBe(2);
      expect(first.lastTs).toBeGreaterThan(first.firstTs);
      expect(traces[1].project).toBe('-proj-b');
    });

    test('reads the quota windows, their accounts, and the peak utilization', () => {
      seed();
      const omp = readAgentStats('all', 'providers');
      expect(omp.windowInsights.length).toBe(1);
      const insight = omp.windowInsights[0];
      expect(insight.provider).toBe('openai-codex');
      expect(insight.windowKey).toBe('openai-codex:primary');
      expect(insight.windowLabel).toBe('30 days');
      expect(insight.accounts).toBe(1);
      expect(insight.cycles).toBe(0);
      expect(insight.fractionConsumed).toBeCloseTo(0.4, 9);
      expect(insight.peakConcurrentFraction).toBeCloseTo(0.6, 9);
      expect(insight.idealAccounts).toBe(1);
      expect(insight.exhaustedEvents).toBe(0);
      // No message in the fixture ran through openai-codex, so no window capacity can be extrapolated.
      expect(insight.estTokensPerWindow).toBeNull();
      expect(omp.usageSeries.length).toBe(1);
      expect(omp.usageSeries[0].accountLabel).toBe('a@example.com');
      expect(omp.usageSeries[0].points.map((point) => point.usedFraction)).toEqual([0.2, 0.6]);
    });

    test('runs only the query groups a view asks for', () => {
      seed();
      const projects = readAgentStats('all', 'projects');
      expect(projects.overall.requests).toBe(5);
      expect(projects.byModel).toEqual([]);
      expect(projects.traces).toEqual([]);

      const traces = readAgentStats('all', 'traces');
      expect(traces.traces.length).toBe(2);
      expect(traces.byModel).toEqual([]);
      expect(traces.overall.requests).toBe(0);
    });

    test('cuts a session transcript into spans, tracks, and totals', () => {
      const at = (s: string): number => Date.parse(`2026-01-01T00:00:${s}Z`);
      const file = writeSessionFixture(path.join(ompStatsDir, 'agent', 'sessions', '-proj-a', 's.jsonl'), [
        { role: 'user', timestamp: '2026-01-01T00:00:02.000Z', content: [{ type: 'text', text: 'hello there' }] },
        {
          role: 'assistant',
          timestamp: '2026-01-01T00:00:05.000Z',
          startedAt: at('03.500'),
          model: 'deepseek/deepseek-v4.1-flash',
          provider: 'commandcode',
          duration: 1500,
          stopReason: 'toolUse',
          content: [{ type: 'text', text: 'looking' }, { type: 'toolCall', id: 'call-1', name: 'read' }],
          usage: { totalTokens: 1200, cost: { total: 0.002 } },
        },
        {
          role: 'toolResult',
          timestamp: '2026-01-01T00:00:06.000Z',
          toolName: 'read',
          toolCallId: 'call-1',
          isError: true,
          content: [{ type: 'text', text: 'ENOENT: no such file' }],
        },
      ]);
      const trace = readSessionTrace(file);
      const spans = trace.tracks[0].spans;
      expect(spans.map((span) => span.kind)).toEqual(['turn', 'model', 'tool']);

      // The prompt runs to the next call; the model span runs back from its stamp by its duration.
      expect(spans[0]).toMatchObject({ label: 'Prompt', detail: 'hello there', start: at('02'), end: at('03.500') });
      expect(spans[1]).toMatchObject({ label: 'deepseek/deepseek-v4.1-flash', start: at('03.500'), end: at('05') });
      expect(spans[1].tokens).toBe(1200);
      expect(spans[1].costUsd).toBeCloseTo(0.002, 9);

      // The tool span opens at the message that emitted the call and closes on its result.
      expect(spans[2]).toMatchObject({ tool: 'read', isError: true, detail: 'ENOENT: no such file', start: at('05'), end: at('06') });

      expect(trace.summary).toMatchObject({
        wallMs: 4000, modelMs: 1500, toolMs: 1000, idleMs: 1500,
        turns: 1, requests: 1, toolCalls: 1, totalTokens: 1200,
      });
      expect(trace.summary.costUsd).toBeCloseTo(0.002, 9);
      expect(trace.toolStats[0]).toMatchObject({ tool: 'read', calls: 1, errors: 1, totalMs: 1000, avgMs: 1000, maxMs: 1000 });
      expect(trace.markers.map((marker) => marker.kind)).toEqual(['session']);
      expect(trace.truncated).toBe(false);
      expect(trace.project).toBe('-proj-a');
    });

    test('folds a subagent transcript into its root session row', () => {
      const now = Date.parse('2026-01-01T12:00:00.000Z');
      const root = sessionPath(ompStatsDir, '-proj-a', 'root.jsonl');
      const child = path.join(path.dirname(root), 'root', 'PageTile.jsonl');
      // The root file carries the session's own line and title, which the row reads from its head.
      writeSessionFixture(root, [
        { role: 'user', timestamp: '2026-01-01T11:00:00.000Z', content: [{ type: 'text', text: 'hello' }] },
      ]);
      mkdirSync(path.dirname(child), { recursive: true });
      writeFileSync(child, '');
      process.env.TERSIO_AGENT_STATS_DB = writeUsageStore(path.join(ompStatsDir, 'usage.db'), {
        messages: [
          { session: root, entry: 'e1', model: 'commandcode/priced-model', ts: now - 2 * HOUR, duration: 2000, input: 100, cost: 0.10, tools: ['read'] },
          { session: child, entry: 'e2', model: 'commandcode/sub-model', ts: now - 1 * HOUR, duration: 3000, input: 200, cost: 0.20, agentType: 'subagent', tools: ['edit'] },
        ],
      });

      const traces = readAgentStats('all', 'traces').traces;
      expect(traces).toHaveLength(1);
      const [row] = traces;
      // One row per root: the child's work, models, and tool calls fold into it.
      expect(row.sessionFile).toBe(root);
      expect(row.requests).toBe(2);
      expect(row.toolCalls).toBe(2);
      expect(row.subagents).toBe(1);
      expect(row.models).toEqual(['commandcode/priced-model', 'commandcode/sub-model']);
      expect(row.tokens).toBe(300);
      expect(row.costUsd).toBeCloseTo(0.3, 9);
      // The row's clock spans both files and counts the last message's duration.
      expect(row.firstTs).toBe(now - 2 * HOUR);
      expect(row.lastTs).toBe(now - 1 * HOUR + 3000);
    });

    test('degrades to an empty result instead of throwing when a source is gone', () => {
      process.env.TERSIO_AGENT_STATS_DB = path.join(ompStatsDir, 'missing.db');
      process.env.TERSIO_AGENT_SESSIONS_DB = path.join(ompStatsDir, 'missing-agent.db');
      const omp = readAgentStats('all');
      expect(omp.available).toBe(false);
      expect(omp.overall.requests).toBe(0);
      expect(omp.byModel).toEqual([]);
      expect(omp.windowInsights).toEqual([]);
      expect(omp.usageSeries).toEqual([]);
    });

    test('still reads the quota half when only stats.db is missing', () => {
      seed();
      process.env.TERSIO_AGENT_STATS_DB = path.join(ompStatsDir, 'missing.db');
      const omp = readAgentStats('all');
      expect(omp.available).toBe(false);
      expect(omp.windowInsights.length).toBe(1);
    });
  });

  /** An uncapped range once hid everything older than the newest page and reported the cap as its total. */
  describe.skipIf(!hasSqlite())('request log paging', () => {
    const CAP = 200;

    /** One transcript of `count` assistant rows, one minute apart, inside the last 24 hours. */
    function seedRows(count: number): number {
      const now = Date.now();
      const file = sessionPath(ompStatsDir, '-proj-a', 's.jsonl');
      process.env.TERSIO_AGENT_STATS_DB = writeUsageStore(path.join(ompStatsDir, 'usage.db'), {
        messages: Array.from({ length: count }, (_, k) => ({
          session: file,
          entry: `e${String(k).padStart(4, '0')}`,
          model: 'commandcode/paged-model',
          ts: now - (count - k) * 60_000,
          duration: 1000,
          input: 10,
          output: 5,
          cost: 0.01,
          // The oldest row is the one the cap used to hide; give it a name to look for.
          tools: k === 0 ? ['read'] : [],
        })),
      });
      return now;
    }

    test('reports the range total, not the shipped row cap', () => {
      seedRows(CAP + 50);
      const omp = readAgentStats('all', 'requests');
      // The aggregate row is exact over the range; the shipped rows stop at the cap.
      expect(omp.requestStats.requests).toBe(CAP + 50);
      expect(omp.recent.length).toBe(CAP);
      expect(omp.requestStats.shipped).toBe(CAP);
      // Tokens and cost come from the same aggregate, so they cover every row, not just these 200.
      expect(omp.requestStats.tokens).toBe((CAP + 50) * 15);
      expect(omp.requestStats.costUsd).toBeCloseTo((CAP + 50) * 0.01, 9);
    });

    test('pages back without a gap or an overlap, down to the row the cap used to hide', () => {
      seedRows(CAP + 50);
      const newest = readAgentStats('all', 'requests', Date.now(), 0).recent;
      const older = readAgentStats('all', 'requests', Date.now(), CAP).recent;

      // The two payloads are contiguous: the older one starts where the newer one ends.
      expect(older.length).toBe(CAP + 50 - CAP);
      expect(Math.max(...older.map((row) => row.ts))).toBeLessThanOrEqual(Math.min(...newest.map((row) => row.ts)));
      const last = older.reduce((a, b) => (a.ts <= b.ts ? a : b));
      expect(last.entryId).toBe('e0000');
      expect(last.input).toBe(10);
    });

    test('a negative or fractional offset floors to whole rows', () => {
      seedRows(CAP + 20);
      const bad = readAgentStats('all', 'requests', Date.now(), -5).recent;
      const good = readAgentStats('all', 'requests', Date.now(), 0).recent;
      expect(bad.map((row) => row.entryId)).toEqual(good.map((row) => row.entryId));
      // 3.7 floors to 3, so the run starts three rows in and keeps its full limit.
      const halfway = readAgentStats('all', 'requests', Date.now(), 3.7).recent;
      const overlap = good.slice(3);
      expect(halfway.slice(0, overlap.length).map((row) => row.entryId)).toEqual(overlap.map((row) => row.entryId));
      expect(halfway.length).toBe(overlap.length + 3);
      // Past the cap the floor still holds, and the run reaches the oldest row in the range.
      const past = readAgentStats('all', 'requests', Date.now(), CAP + 3 + 0.9).recent;
      expect(past.map((row) => row.entryId))
        .toEqual(readAgentStats('all', 'requests', Date.now(), CAP + 3).recent.map((row) => row.entryId));
      expect(past[past.length - 1].entryId).toBe('e0000');
    });

    test('an offset past the end of the range returns nothing but keeps the true total', () => {
      seedRows(30);
      const omp = readAgentStats('all', 'requests', Date.now(), 500);
      expect(omp.recent).toEqual([]);
      expect(omp.requestStats.requests).toBe(30);
      expect(omp.requestStats.shipped).toBe(0);
    });
  });

  describe('error signatures', () => {
    test('normalizes ids and counters but keeps an HTTP status', () => {
      expect(errorSignature('429 Too Many Requests retry-after-ms=37044000 req_abcdef123456'))
        .toBe('429 Too Many Requests retry-after-ms=N <id>');
      expect(errorSignature('session 01a121a3-819c-75b4-ac63-f912798f4f86 failed'))
        .toBe('session <id> failed');
      expect(errorSignature('body a1b2c3d4e5f60718 rejected')).toBe('body <hex> rejected');
      expect(errorSignature('rate limit after 1.5s')).toBe('rate limit after Ns');
    });

    test('names an empty message and clips a long one', () => {
      expect(errorSignature(null)).toBe('Unknown error');
      expect(errorSignature('   ')).toBe('Unknown error');
      expect(errorSignature('x'.repeat(400)).length).toBe(180);
      expect(errorSignature('x'.repeat(400)).endsWith('…')).toBe(true);
    });
  });
});

// This file holds what used to be ten files, and vitest isolated those by process: one section leaving TERSIO_* set, or a spawned CLI writing the reset watermark, would change what the next section reads. The snapshot keeps the file-scope defaults the sections above set.
const ENV_SNAPSHOT: NodeJS.ProcessEnv = { ...process.env };
const FIXTURE_RESET = process.env.TERSIO_RESET_FILE;
beforeEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ENV_SNAPSHOT)) delete process.env[key];
  }
  Object.assign(process.env, ENV_SNAPSHOT);
  // The fixture rows are dated 2026-09, so a watermark written mid-run would filter every one of them.
  if (FIXTURE_RESET !== undefined) rmSync(FIXTURE_RESET, { force: true });
});
