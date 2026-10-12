import { expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  clearUsageDb,
  listUsageBackups,
  readUsageDb,
  reparseGuardReport,
  syncUsageDb,
  usageDbPath,
} from "../../extensions/shared/usage-store.ts";
import { markReset } from "../../extensions/shared/usage-ledger.ts";
import { hasSqlite } from "../helpers/env.ts";

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
      execFileSync("sqlite3", [process.env.TERSIO_USAGE_DB!, "UPDATE meta SET v='__old__' WHERE k='parser_version';"]);
      rmSync(path.join(dir, "sessions", "a.jsonl"));
      rmSync(path.join(dir, "sessions", "b.jsonl"));
      expect(syncUsageDb()).toBe(false);
      expect(readUsageDb()?.tokens.messages).toBe(6);
      expect(reparseGuardReport()).toMatch(/kept 2 of 6 rows/);
      process.env.TERSIO_FORCE_REPARSE = "1";
      expect(syncUsageDb()).toBe(true);
      expect(readUsageDb()?.tokens.messages).toBe(2);
      expect(execFileSync("sqlite3", [process.env.TERSIO_USAGE_DB!, "PRAGMA freelist_count;"], { encoding: "utf8" }).trim()).toBe("0");
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
      const backupsBefore = listUsageBackups().length;
      // A newer tersio wrote the store; this build cannot migrate it forward.
      execFileSync("sqlite3", [db, "UPDATE meta SET v='99' WHERE k='parser_version';"]);
      rmSync(path.join(dir, "sessions", "a.jsonl"));
      rmSync(path.join(dir, "sessions", "b.jsonl"));
      expect(syncUsageDb()).toBe(true);
      expect(readUsageDb()?.tokens.messages).toBe(6);
      expect(reparseGuardReport()).toMatch(/written by a newer tersio/);
      // No backup was taken and none was restored: the wipe path never ran.
      expect(listUsageBackups().length).toBe(backupsBefore);
      expect(execFileSync("sqlite3", [db, "SELECT v FROM meta WHERE k='parser_version';"], { encoding: "utf8" }).trim()).toBe("99");
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
      execFileSync("sqlite3", [db, [
        `CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);`,
        `CREATE TABLE files (path TEXT PRIMARY KEY, mtime REAL NOT NULL, size INTEGER NOT NULL);`,
        `CREATE TABLE messages (file TEXT NOT NULL, t REAL, model TEXT NOT NULL,` +
        ` i INTEGER NOT NULL, o INTEGER NOT NULL, d REAL, cr INTEGER NOT NULL, cw INTEGER NOT NULL,` +
        ` usd REAL, st TEXT NOT NULL, code REAL, note TEXT, tools TEXT NOT NULL DEFAULT '[]', h TEXT);`,
        `INSERT INTO files VALUES ('${file}',1,2);`,
        `INSERT INTO messages VALUES ('${file}',1,'m',10,1,NULL,0,0,NULL,'completed',NULL,NULL,'[]','pi');`,
        `INSERT INTO messages VALUES ('${file}',2,'m',20,2,NULL,0,0,NULL,'completed',NULL,NULL,'[]','pi');`,
        `INSERT INTO meta VALUES ('parser_version','9');`,
      ].join("")]);
      rmSync(file);
      expect(syncUsageDb()).toBe(true);
      expect(readUsageDb()?.tokens.messages).toBe(2);
      expect(reparseGuardReport()).toBe(null);
      const schema = execFileSync("sqlite3", [db, "SELECT sql FROM sqlite_master WHERE name='messages';"], { encoding: "utf8" });
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
      execFileSync("sqlite3", [db, [
        `CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);`,
        `CREATE TABLE files (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT UNIQUE NOT NULL, mtime REAL NOT NULL, size INTEGER NOT NULL);`,
        `CREATE TABLE messages (file_id INTEGER NOT NULL REFERENCES files(id), t REAL, model TEXT NOT NULL,` +
        ` i INTEGER NOT NULL, o INTEGER NOT NULL, d REAL, cr INTEGER NOT NULL, cw INTEGER NOT NULL,` +
        ` usd REAL, st TEXT NOT NULL, code REAL, note TEXT, tools TEXT NOT NULL DEFAULT '[]', h TEXT);`,
        `INSERT INTO files (path, mtime, size) VALUES ('${file}',1,2);`,
        `INSERT INTO messages (file_id, t, model, i, o, d, cr, cw, usd, st, code, note, tools, h)` +
        ` VALUES (1,1,'m',10,1,NULL,0,0,NULL,'completed',NULL,NULL,'[]','pi');`,
        `INSERT INTO meta VALUES ('parser_version','10');`,
      ].join("")]);
      rmSync(file);
      expect(syncUsageDb()).toBe(true);
      expect(readUsageDb()?.tokens.messages).toBe(1);
      const cols = execFileSync("sqlite3", [db, "PRAGMA table_info(messages);"], { encoding: "utf8" });
      expect(cols).toMatch(/[,|]id[,|]/);
      expect(reparseGuardReport()).toBe(null);
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
