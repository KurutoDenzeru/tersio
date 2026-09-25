// test/gain-currency.test.ts — the dashboard owns the display currency:
// picking one POSTs to /currency, the server persists it in the plugin lock
// file, and a later `tersio dashboard` (a new origin each run, so localStorage
// alone cannot survive) defaults to it.
import { expect, test } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const installer = path.join(root, "tersio.js");

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
    const lock = JSON.parse(
      readFileSync(path.join(home, ".omp", "plugins", "omp-plugins.lock.json"), "utf8"),
    ) as { settings?: Record<string, { currency?: string }> };
    expect(lock.settings?.["@krtclcdy/tersio"]?.currency).toBe("PHP");

    const second = await startDashboard(home);
    try {
      const res = await fetch(`${second.url}/data.json`);
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
