import { expect, test } from "vitest";
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { readRtkGain, rtkDbPath } from "../../extensions/shared/rtk-gain.js";

function withDb(db: string | undefined, fn: () => void): void {
  const prev = process.env.TERSIO_RTK_DB;
  if (db === undefined) delete process.env.TERSIO_RTK_DB;
  else process.env.TERSIO_RTK_DB = db;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.TERSIO_RTK_DB;
    else process.env.TERSIO_RTK_DB = prev;
  }
}

function hasSqlite(): boolean {
  try {
    execSync("command -v sqlite3", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

test("missing rtk db returns empty gain without throwing", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-rtk-"));
  try {
    withDb(path.join(dir, "nope.db"), () => {
      expect(readRtkGain()).toEqual({ commands: 0, saved: 0, input: 0, avgPct: 0, totalMs: 0, byCommand: [] });
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.skipIf(!hasSqlite())("aggregates per-command savings from history.db", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-rtk-"));
  const db = path.join(dir, "history.db");
  try {
    execFileSync("sqlite3", [db, [
      "CREATE TABLE commands (id INTEGER PRIMARY KEY, timestamp TEXT NOT NULL,",
      "original_cmd TEXT NOT NULL, rtk_cmd TEXT NOT NULL, input_tokens INTEGER NOT NULL,",
      "output_tokens INTEGER NOT NULL, saved_tokens INTEGER NOT NULL, savings_pct REAL NOT NULL,",
      "exec_time_ms INTEGER DEFAULT 0, project_path TEXT DEFAULT '');",
      "INSERT INTO commands VALUES (1,'2026-09-01T00:00:00Z','git status','rtk git status',100,50,50,50.0,20,'/tmp');",
      "INSERT INTO commands VALUES (2,'2026-09-01T00:01:00Z','git status','rtk git status',200,100,100,50.0,40,'/tmp');",
      "INSERT INTO commands VALUES (3,'2026-09-01T00:02:00Z','grep foo','rtk grep',1000,900,100,10.0,600,'/tmp');",
    ].join(" ")]);
    withDb(db, () => {
      const g = readRtkGain();
      expect(g.commands).toBe(3);
      expect(g.saved).toBe(250);
      expect(g.input).toBe(1300);
      expect(Math.abs(g.avgPct - (250 / 1300) * 100) < 1e-9).toBeTruthy();
      expect(g.byCommand.length).toBe(2);
      expect(g.byCommand[0]).toEqual({ command: "rtk git status", count: 2, saved: 150, avgPct: 50, avgMs: 30 });
      expect(g.byCommand[1]).toEqual({ command: "rtk grep", count: 1, saved: 100, avgPct: 10, avgMs: 600 });
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.skipIf(!hasSqlite())("cutoff filters the view without touching the db", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-rtk-"));
  const db = path.join(dir, "history.db");
  try {
    execFileSync("sqlite3", [db, [
      "CREATE TABLE commands (id INTEGER PRIMARY KEY, timestamp TEXT NOT NULL,",
      "original_cmd TEXT NOT NULL, rtk_cmd TEXT NOT NULL, input_tokens INTEGER NOT NULL,",
      "output_tokens INTEGER NOT NULL, saved_tokens INTEGER NOT NULL, savings_pct REAL NOT NULL,",
      "exec_time_ms INTEGER DEFAULT 0, project_path TEXT DEFAULT '');",
      "INSERT INTO commands VALUES (1,'2026-09-01T00:00:00Z','git status','rtk git status',100,50,50,50.0,20,'/tmp');",
      "INSERT INTO commands VALUES (2,'2026-09-01T00:01:00Z','git status','rtk git status',200,100,100,50.0,40,'/tmp');",
      "INSERT INTO commands VALUES (3,'2026-09-13T12:00:00Z','grep foo','rtk grep',1000,900,100,10.0,600,'/tmp');",
    ].join(" ")]);
    withDb(db, () => {
      const cutoff = Date.parse("2026-09-13T00:00:00Z");
      const g = readRtkGain(10, cutoff);
      expect(g.commands, "only post-cutoff rows in the view").toBe(1);
      expect(g.saved).toBe(100);
      expect(g.byCommand.length).toBe(1);
      // The database itself is untouched.
      const all = readRtkGain();
      expect(all.commands).toBe(3);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("default db path follows the platform", () => {
  withDb(undefined, () => {
    const p = rtkDbPath();
    expect(p.endsWith("history.db"), p).toBeTruthy();
  });
});

test.skipIf(!hasSqlite())("multi-line commands stay one row", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-rtk-"));
  const db = path.join(dir, "history.db");
  try {
    execFileSync("sqlite3", [db, [
      "CREATE TABLE commands (id INTEGER PRIMARY KEY, timestamp TEXT NOT NULL,",
      "original_cmd TEXT NOT NULL, rtk_cmd TEXT NOT NULL, input_tokens INTEGER NOT NULL,",
      "output_tokens INTEGER NOT NULL, saved_tokens INTEGER NOT NULL, savings_pct REAL NOT NULL,",
      "exec_time_ms INTEGER DEFAULT 0, project_path TEXT DEFAULT '');",
      // heredoc-style command: real rows look like this, newlines and all
      "INSERT INTO commands VALUES (1,'2026-09-01T00:00:00Z','node -e','rtk fallback: node -e",
      "const a = 1;",
      "const b = 2;',300,100,200,66.0,10,'/repos/multi');",
      "INSERT INTO commands VALUES (2,'2026-09-01T00:01:00Z','git status','rtk git status',100,50,50,50.0,20,'/repos/multi');",
    ].join(" ")]);
    withDb(db, () => {
      const g = readRtkGain(50);
      expect(g.byCommand.length, "one row per command, not one per physical line").toBe(2);
      for (const r of g.byCommand) {
        expect(!r.command.includes("\n"), "commands are flattened for the table").toBeTruthy();
      }
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.skipIf(!hasSqlite())("same command across repos folds into one row", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-rtk-"));
  const db = path.join(dir, "history.db");
  try {
    execFileSync("sqlite3", [db, [
      "CREATE TABLE commands (id INTEGER PRIMARY KEY, timestamp TEXT NOT NULL,",
      "original_cmd TEXT NOT NULL, rtk_cmd TEXT NOT NULL, input_tokens INTEGER NOT NULL,",
      "output_tokens INTEGER NOT NULL, saved_tokens INTEGER NOT NULL, savings_pct REAL NOT NULL,",
      "exec_time_ms INTEGER DEFAULT 0, project_path TEXT DEFAULT '');",
      "INSERT INTO commands VALUES (1,'2026-09-01T00:00:00Z','grep foo','rtk grep',100,50,50,50.0,20,'/repos/busy');",
      "INSERT INTO commands VALUES (2,'2026-09-01T00:01:00Z','grep foo','rtk grep',100,50,50,50.0,20,'/repos/busy');",
      "INSERT INTO commands VALUES (3,'2026-09-01T00:02:00Z','grep foo','rtk grep',100,50,50,50.0,20,'/repos/quiet');",
      "INSERT INTO commands VALUES (4,'2026-09-01T00:03:00Z','bun run build','rtk bun run build (passthrough)',100,0,0,0.0,5,'/repos/quiet');",
      `INSERT INTO commands VALUES (5,'2026-09-01T00:04:00Z','ls','rtk ls -d ${"x".repeat(400)}',100,0,0,0.0,5,'/repos/quiet');`,
    ].join(" ")]);
    withDb(db, () => {
      const g = readRtkGain(50);
      expect(g.commands, "totals stay machine-wide").toBe(5);
      const grep = g.byCommand.filter((r) => r.command === "rtk grep");
      expect(grep.length, "same command in two repos is one row").toBe(1);
      expect(grep[0].count).toBe(3);
      // A zero-saving command still reaches the table; the old rows were
      // ranked by tokens saved and capped at 10, which dropped these entirely.
      expect(g.byCommand.some((r) => r.command === "rtk bun run build (passthrough)")).toBeTruthy();
      expect(g.byCommand.find((r) => r.command.startsWith("rtk ls -d "))?.command.length).toBe(200);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
