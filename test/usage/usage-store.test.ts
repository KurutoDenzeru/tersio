import { expect, test } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  clearUsageDb,
  readUsageDb,
  syncUsageDb,
  usageDbPath,
} from "../../extensions/shared/usage-store.ts";
import { markReset } from "../../extensions/shared/usage-ledger.ts";

function hasSqlite(): boolean {
  try {
    execSync("command -v sqlite3", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function withEnv(dir: string, fn: () => void): void {
  const prevDb = process.env.TERSIO_USAGE_DB;
  const prevSessions = process.env.TERSIO_SESSIONS_DIR;
  const prevReset = process.env.TERSIO_RESET_FILE;
  const prevCodex = process.env.TERSIO_CODEX_DIR;
  delete process.env.TERSIO_CODEX_DIR;
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
    if (prevCodex === undefined) delete process.env.TERSIO_CODEX_DIR;
    else process.env.TERSIO_CODEX_DIR = prevCodex;
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
