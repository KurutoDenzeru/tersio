// Backup ops touch user data, so each test fails loudly.
import { expect, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  backupUsageDb,
  backupUsageDir,
  clearUsageDb,
  deleteUsageBackup,
  listUsageBackups,
  maybeScheduledBackup,
  readBackupSchedule,
  readUsageDb,
  restoreUsageBackup,
  syncUsageDb,
  usageDbPath,
} from "../../extensions/shared/usage-store.ts";
import { csvCell, EXPORT_FORMATS, exportBody, exportRows } from "../../cli/dashboard.ts";
import type { UsageReport } from "../../cli/usage.ts";
import { hasSqlite } from "../helpers/env.ts";

// A real report shape; export must not depend on anything else being present.
const report = {
  version: "2.24.0",
  recent: [
    { m: "space-bunny", i: 100, o: 20, t: Date.parse("2026-09-01T10:00:00Z"), d: 1500, cr: 30, cw: 0, usd: 1.5, st: "completed" },
    { m: "openai/gpt-5.2-codex", i: 10, o: 5, t: Date.parse("2026-09-02T10:00:00Z"), h: "omp" },
  ],
} as unknown as UsageReport;

function sandbox(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-backups-"));
  const prevDb = process.env.TERSIO_USAGE_DB;
  const prevHome = process.env.TERSIO_HOME;
  const prevSessions = process.env.TERSIO_SESSIONS_DIR;
  process.env.TERSIO_USAGE_DB = path.join(dir, "usage.db");
  process.env.TERSIO_SESSIONS_DIR = path.join(dir, "sessions");
  writeFileSync(path.join(dir, "usage.db"), "current");
  return {
    dir,
    cleanup: () => {
      for (const [key, value] of [
        ["TERSIO_USAGE_DB", prevDb],
        ["TERSIO_HOME", prevHome],
        ["TERSIO_SESSIONS_DIR", prevSessions],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function seedSnapshot(name: string, body: string): string {
  mkdirSync(backupUsageDir(), { recursive: true });
  const full = path.join(backupUsageDir(), name);
  writeFileSync(full, body);
  return full;
}

// --- export ---------------------------------------------------------------

test("export offers json, jsonl and csv and nothing else", () => {
  expect([...EXPORT_FORMATS].sort()).toEqual(["csv", "json", "jsonl"]);
});

test("export rows carry the agent, both timestamps, tokens and cost", () => {
  const rows = exportRows(report);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ model: "space-bunny", input: 100, output: 20, cacheRead: 30, costUsd: 1.5, elapsedMs: 1500, status: "completed" });
  expect(rows[0].timestamp).toBe("2026-09-01T10:00:00.000Z");
  // The declared host is exported; a row without one defaults rather than
  // going blank.
  expect(rows[1].agent).toBe("omp");
  expect(rows[1].elapsedMs).toBeUndefined();
});

test("export json is the whole report and valid json", () => {
  const { body, type } = exportBody("json", report);
  expect(type).toBe("application/json");
  const parsed = JSON.parse(body) as { version: string; report: { recent: unknown[] } };
  expect(parsed.report.recent).toHaveLength(2);
  expect(parsed.version).toBeTruthy();
});

test("export jsonl is one row per line, each independently parseable", () => {
  const { body, type } = exportBody("jsonl", report);
  expect(type).toBe("application/x-ndjson");
  const lines = body.trim().split("\n");
  expect(lines).toHaveLength(2);
  for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
});

test("export csv quotes commas so the local-time column cannot shift the row", () => {
  const { body, type } = exportBody("csv", report);
  expect(type).toContain("text/csv");
  const [head, first] = body.trim().split("\n");
  expect(head).toBe("timestamp,local,agent,model,input,output,cacheRead,cacheWrite,costUsd,elapsedMs,status");
  // "9/1/2026, 10:00:00 AM" contains a comma and must survive as one cell.
  expect(first).toMatch(/"[^"]*,\s*[^"]*"/);
});

test("csv quoting escapes embedded quotes and leaves plain cells alone", () => {
  expect(csvCell("a,b")).toBe('"a,b"');
  expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  expect(csvCell("plain")).toBe("plain");
  expect(csvCell(undefined)).toBe("");
  expect(csvCell(null)).toBe("");
});

// --- restore --------------------------------------------------------------

test.skipIf(!hasSqlite())("restore puts a readable snapshot back over the live mirror", () => {
  const { dir, cleanup } = sandbox();
  try {
    // TERSIO_HOME keeps the schedule away from the developer's real settings.
    process.env.TERSIO_HOME = dir;
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
    backupUsageDb(usageDbPath());
    const [snapshot] = listUsageBackups();
    expect(clearUsageDb()).toBe(1);
    expect(readUsageDb()).toBe(null);
    expect(restoreUsageBackup(path.basename(snapshot.file))).toBe(true);
    expect(readUsageDb()?.tokens.messages).toBe(1);
  } finally {
    cleanup();
  }
});

test("restore rejects an unknown or missing snapshot and leaves the mirror alone", () => {
  const { cleanup } = sandbox();
  try {
    writeFileSync(usageDbPath(), "untouched");
    expect(restoreUsageBackup("usage-20990101000000.db")).toBe(false);
    expect(restoreUsageBackup("")).toBe(false);
    expect(readFileSync(usageDbPath(), "utf8")).toBe("untouched");
  } finally {
    cleanup();
  }
});

// --- delete ---------------------------------------------------------------

test("delete removes exactly one snapshot and keeps the rest", () => {
  const { cleanup } = sandbox();
  try {
    seedSnapshot("usage-20260101000000.db", "a");
    seedSnapshot("usage-20260102000000.db", "b");
    expect(deleteUsageBackup("usage-20260101000000.db")).toBe(true);
    expect(listUsageBackups().map((x) => path.basename(x.file))).toEqual(["usage-20260102000000.db"]);
  } finally {
    cleanup();
  }
});

test("delete never touches the live mirror", () => {
  const { cleanup } = sandbox();
  try {
    seedSnapshot("usage-20260101000000.db", "a");
    expect(deleteUsageBackup("usage-20260101000000.db")).toBe(true);
    expect(existsSync(usageDbPath())).toBe(true);
    expect(readFileSync(usageDbPath(), "utf8")).toBe("current");
  } finally {
    cleanup();
  }
});

test("delete refuses a path outside the backup directory", () => {
  const { dir, cleanup } = sandbox();
  try {
    const outside = path.join(dir, "not-a-snapshot.db");
    writeFileSync(outside, "precious");
    seedSnapshot("usage-20260101000000.db", "a");

    // Absolute, relative traversal, and a bare traversal all resolve to a
    // basename, so none of them can leave the backup dir.
    for (const attempt of [outside, "../not-a-snapshot.db", "../../etc/hosts", "/etc/hosts"]) {
      expect(deleteUsageBackup(attempt), attempt).toBe(false);
    }
    expect(existsSync(outside), "the file outside the backup dir survives").toBe(true);
  } finally {
    cleanup();
  }
});

test("restore also refuses a path outside the backup directory", () => {
  const { dir, cleanup } = sandbox();
  try {
    writeFileSync(path.join(dir, "not-a-snapshot.db"), "not a db");
    expect(restoreUsageBackup(path.join(dir, "not-a-snapshot.db"))).toBe(false);
    expect(restoreUsageBackup("../../usage.db")).toBe(false);
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
    process.env.TERSIO_HOME = dir;
    expect(readBackupSchedule()).toBe("manual");
    expect(maybeScheduledBackup(usageDbPath())).toBe(false);
    expect(listUsageBackups()).toHaveLength(0);
  } finally {
    delete process.env.TERSIO_HOME;
    cleanup();
  }
});

test("a monthly schedule snapshots an empty backup dir and skips while fresh", () => {
  const { dir, cleanup } = sandbox();
  try {
    writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ backupSchedule: "monthly" }));
    process.env.TERSIO_HOME = dir;
    expect(maybeScheduledBackup(usageDbPath()), "first run takes a snapshot").toBe(true);
    const made = listUsageBackups();
    expect(made).toHaveLength(1);
    expect(readFileSync(made[0].file, "utf8")).toBe("current");
    expect(maybeScheduledBackup(usageDbPath()), "a fresh snapshot is not re-taken").toBe(false);
    expect(listUsageBackups()).toHaveLength(1);
  } finally {
    delete process.env.TERSIO_HOME;
    cleanup();
  }
});
