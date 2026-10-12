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
import { hasSqlite } from "../helpers/env.ts";

function sandbox(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-backups-"));
  const prevDb = process.env.TERSIO_USAGE_DB;
  const prevHome = process.env.TERSIO_HOME;
  const prevSessions = process.env.TERSIO_SESSIONS_DIR;
  process.env.TERSIO_USAGE_DB = path.join(dir, "usage.db");
  process.env.TERSIO_SESSIONS_DIR = path.join(dir, "sessions");
  // Without this the schedule tests read the real ~/.tersio/settings.json.
  process.env.TERSIO_HOME = dir;
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
