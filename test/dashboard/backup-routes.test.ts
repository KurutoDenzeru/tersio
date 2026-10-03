import { expect, test } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cliEnv } from "../helpers/env.ts";
import { syncUsageDb, usageDbPath } from "../../extensions/shared/usage-store.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(url: string, ms = 10000): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not listening yet */ }
    if (Date.now() - start > ms) throw new Error(`server never came up: ${url}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

test("backup create, list, and restore round-trips through the server", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-backup-routes-"));
  const prev = { db: process.env.TERSIO_USAGE_DB, sessions: process.env.TERSIO_SESSIONS_DIR, reset: process.env.TERSIO_RESET_FILE };
  process.env.TERSIO_USAGE_DB = path.join(home, "usage.db");
  process.env.TERSIO_SESSIONS_DIR = path.join(home, "sessions");
  process.env.TERSIO_RESET_FILE = path.join(home, "reset.json");
  let child: ChildProcess | null = null;
  try {
    mkdirSync(process.env.TERSIO_SESSIONS_DIR, { recursive: true });
    writeFileSync(
      path.join(process.env.TERSIO_SESSIONS_DIR, "s.jsonl"),
      `{"timestamp":"2026-09-01T10:00:00.000Z","type":"message","id":"a","message":{"role":"assistant","model":"m","usage":{"input":10,"output":1}}}\n`,
      "utf8",
    );
    expect(syncUsageDb()).toBe(true);
    const port = await freePort();
    child = spawn(process.execPath, [path.join(root, "tersio.js"), "dashboard", "--port", String(port)], {
      cwd: root,
      env: cliEnv(home, {
        TERSIO_USAGE_DB: process.env.TERSIO_USAGE_DB,
        TERSIO_SESSIONS_DIR: process.env.TERSIO_SESSIONS_DIR,
        TERSIO_RESET_FILE: process.env.TERSIO_RESET_FILE,
      }),
      stdio: "ignore",
    });
    const base = `http://127.0.0.1:${port}`;
    await waitFor(`${base}/backups`);
    const created = await (await fetch(`${base}/backups/create`, { method: "POST" })).json() as { ok?: boolean };
    expect(created.ok).toBe(true);
    const listed = await (await fetch(`${base}/backups`)).json() as { backups?: Array<{ file: string }> };
    expect(listed.backups).toHaveLength(1);
    unlinkSync(usageDbPath());
    const restored = await (await fetch(`${base}/backups/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: path.basename(listed.backups![0].file) }),
    })).json() as { ok?: boolean };
    expect(restored.ok).toBe(true);
    expect(existsSync(usageDbPath())).toBe(true);
  } finally {
    child?.kill();
    for (const [key, value] of [["TERSIO_USAGE_DB", prev.db], ["TERSIO_SESSIONS_DIR", prev.sessions], ["TERSIO_RESET_FILE", prev.reset]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(home, { recursive: true, force: true });
  }
}, 30000);
