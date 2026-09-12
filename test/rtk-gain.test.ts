import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { readRtkGain, rtkDbPath } from "../extensions/shared/rtk-gain.js";

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
      assert.deepEqual(readRtkGain(), { commands: 0, saved: 0, input: 0, avgPct: 0, totalMs: 0, byCommand: [] });
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("aggregates per-command savings from history.db", { skip: !hasSqlite() }, () => {
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
      assert.equal(g.commands, 3);
      assert.equal(g.saved, 250);
      assert.equal(g.input, 1300);
      assert.ok(Math.abs(g.avgPct - (250 / 1300) * 100) < 1e-9);
      assert.equal(g.byCommand.length, 2);
      assert.deepEqual(g.byCommand[0], { command: "rtk git status", count: 2, saved: 150, avgPct: 50, avgMs: 30 });
      assert.deepEqual(g.byCommand[1], { command: "rtk grep", count: 1, saved: 100, avgPct: 10, avgMs: 600 });
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("default db path follows the platform", () => {
  withDb(undefined, () => {
    const p = rtkDbPath();
    assert.ok(p.endsWith("history.db"), p);
  });
});
