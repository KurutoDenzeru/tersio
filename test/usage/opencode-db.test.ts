import { expect, test } from "vitest";
import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { readUsageDb, syncUsageDb } from "../../extensions/shared/usage-store.ts";

// OpenCode v2 stores one row per message in sqlite and no longer writes the JSON tree.
function hasSqlite(): boolean {
  try {
    execSync("command -v sqlite3", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const SCHEMA = `CREATE TABLE message (id text PRIMARY KEY, session_id text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL);
CREATE TABLE session_message (id text PRIMARY KEY, session_id text NOT NULL, type text NOT NULL, seq integer NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL);`;

function seed(dir: string, rows: Array<{ id: string; created: number; data: Record<string, unknown> }>): string {
  const db = path.join(dir, "opencode.db");
  const sql = [SCHEMA];
  for (const r of rows) {
    sql.push(
      `INSERT INTO message VALUES ('${r.id}','ses_a',${r.created},${r.created},'${JSON.stringify(r.data).replace(/'/g, "''")}');`,
    );
  }
  execFileSync("sqlite3", [db, sql.join("")], { timeout: 30000 });
  return db;
}

// Same rows, current on-disk shape: role in `type`, model under data.model.
function seedCurrent(dir: string, rows: Array<{ id: string; created: number; data: Record<string, unknown> }>): string {
  const db = path.join(dir, "opencode-v2.db");
  const sql = [SCHEMA.split("\n")[1]];
  for (const r of rows) {
    const type = typeof r.data.role === "string" ? r.data.role : "assistant";
    sql.push(
      `INSERT INTO session_message VALUES ('${r.id}','ses_a','${type}',1,${r.created},${r.created},'${JSON.stringify(r.data).replace(/'/g, "''")}');`,
    );
  }
  execFileSync("sqlite3", [db, sql.join("")], { timeout: 30000 });
  return db;
}

// Current on-disk shape: no `role` key, model under data.model.
function assistantCurrent(id: string, created: number, tokens: Record<string, number>): { id: string; created: number; data: Record<string, unknown> } {
  return {
    id,
    created,
    data: {
      id,
      model: { id: "muse-spark-1.3-contributor-free", providerID: "opencode" },
      tokens: { input: tokens.input, output: tokens.output, cache: { read: tokens.cacheRead, write: 0 } },
      time: { created, completed: created + 5000 },
    },
  };
}

function withEnv(dir: string, fn: () => void): void {
  const previous = {
    db: process.env.TERSIO_USAGE_DB,
    sessions: process.env.TERSIO_SESSIONS_DIR,
    oc: process.env.TERSIO_OPENCODE_DB,
    reset: process.env.TERSIO_RESET_FILE,
  };
  process.env.TERSIO_USAGE_DB = path.join(dir, "usage.db");
  process.env.TERSIO_SESSIONS_DIR = path.join(dir, "sessions");
  process.env.TERSIO_RESET_FILE = path.join(dir, "reset.json");
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// Chart keys fold the `-free` suffix away.
const MODEL_KEY = "opencode/opencode/muse-spark-1.3-contributor";

function assistant(id: string, created: number, tokens: Record<string, number>): { id: string; created: number; data: Record<string, unknown> } {
  return {
    id,
    created,
    data: {
      id,
      role: "assistant",
      providerID: "opencode",
      modelID: "muse-spark-1.3-contributor-free",
      tokens: { input: tokens.input, output: tokens.output, cache: { read: tokens.cacheRead, write: 0 } },
      time: { created, completed: created + 5000 },
    },
  };
}

test.runIf(hasSqlite())("sqlite message rows land in the ledger under the opencode host", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-oc-db-"));
  try {
    mkdirSync(path.join(dir, "sessions"), { recursive: true });
    const db = seed(dir, [
      { id: "msg_user", created: 1789800000000, data: { id: "msg_user", role: "user", time: { created: 1789800000000 } } },
      assistant("msg_a1", 1789800001000, { input: 100, output: 10, cacheRead: 500 }),
      assistant("msg_a2", 1789800002000, { input: 200, output: 20, cacheRead: 0 }),
    ]);
    withEnv(dir, () => {
      process.env.TERSIO_OPENCODE_DB = db;
      expect(syncUsageDb()).toBe(true);
      const tokens = readUsageDb()?.tokens;
      expect(tokens?.messages).toBe(2);
      expect(tokens?.byHost[MODEL_KEY]?.opencode?.input).toBe(300);
      // The msg id is the row primary key, so a request drawer can find the row.
      expect(tokens?.recent.map((r: { id?: string }) => r.id).sort()).toEqual(["msg_a1", "msg_a2"]);
      expect(tokens?.byModel[MODEL_KEY].input).toBe(300);
      // A second sync re-reads the overlap window only; the row count must not double.
      expect(syncUsageDb()).toBe(true);
      expect(readUsageDb()?.tokens.messages).toBe(2);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.runIf(hasSqlite())("session_message rows (current shape) land under the opencode host", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-oc-db-v2-"));
  try {
    mkdirSync(path.join(dir, "sessions"), { recursive: true });
    const db = seedCurrent(dir, [
      { id: "msg_u", created: 1789800000000, data: { id: "msg_u", role: "user", time: { created: 1789800000000 } } },
      assistantCurrent("msg_n1", 1789800001000, { input: 300, output: 30, cacheRead: 700 }),
    ]);
    withEnv(dir, () => {
      process.env.TERSIO_OPENCODE_DB = db;
      expect(syncUsageDb()).toBe(true);
      const tokens = readUsageDb()?.tokens;
      // The user row is skipped; one assistant row, id kept for the request drawer.
      expect(tokens?.messages).toBe(1);
      expect(tokens?.byModel[MODEL_KEY].input).toBe(300);
      expect(tokens?.recent[0]?.id).toBe("msg_n1");
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.runIf(hasSqlite())("a zero-token message is skipped and a missing db is a no-op", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-oc-db-empty-"));
  try {
    mkdirSync(path.join(dir, "sessions"), { recursive: true });
    const db = seed(dir, [assistant("msg_zero", 1789800001000, { input: 0, output: 0, cacheRead: 0 })]);
    withEnv(dir, () => {
      process.env.TERSIO_OPENCODE_DB = db;
      expect(syncUsageDb()).toBe(true);
      expect(readUsageDb()?.tokens.messages).toBe(0);
      process.env.TERSIO_OPENCODE_DB = path.join(dir, "absent.db");
      expect(syncUsageDb()).toBe(true);
      expect(readUsageDb()?.tokens.messages).toBe(0);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
