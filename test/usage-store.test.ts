import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  clearUsageDb,
  readUsageDb,
  syncUsageDb,
  usageDbPath,
} from "../extensions/shared/usage-store.js";
import { markReset } from "../extensions/shared/usage-ledger.js";

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
      assert.equal(readUsageDb(), null);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sync persists folded model rows and reads them back", { skip: !hasSqlite() }, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-usage-db-"));
  try {
    withEnv(dir, () => {
      seedSessions(dir);
      assert.equal(usageDbPath(), process.env.TERSIO_USAGE_DB);
      assert.equal(syncUsageDb(), true);
      const stored = readUsageDb();
      assert.ok(stored);
      assert.deepEqual(Object.keys(stored.tokens.byModel), ["deepseek-v4.1-flash"]);
      assert.deepEqual(stored.tokens.byModel["deepseek-v4.1-flash"], { input: 300, output: 30, cacheRead: 50, cacheWrite: 0 });
      assert.equal(stored.tokens.messages, 2);
      assert.equal(stored.tokens.recent.length, 2);
      assert.deepEqual(stored.tokens.byTool, { read: 1 });
      assert.ok(stored.syncedAt > 0);
      // Second sync is a no-op (mtime+size ledger matches).
      assert.equal(syncUsageDb(), true);
      // Reset watermark filters the stored view without touching the file.
      markReset(Date.parse("2026-09-01T10:30:00.000Z"));
      const filtered = readUsageDb();
      assert.equal(filtered?.tokens.messages, 1);
      assert.equal(existsSync(process.env.TERSIO_USAGE_DB!), true);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("clearUsageDb removes the store file", { skip: !hasSqlite() }, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-usage-db-"));
  try {
    withEnv(dir, () => {
      seedSessions(dir);
      assert.equal(syncUsageDb(), true);
      assert.equal(existsSync(process.env.TERSIO_USAGE_DB!), true);
      assert.equal(clearUsageDb(), 1);
      assert.equal(existsSync(process.env.TERSIO_USAGE_DB!), false);
      assert.equal(clearUsageDb(), 0);
      assert.equal(readUsageDb(), null);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
