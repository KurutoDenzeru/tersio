import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const installer = path.join(root, 'dist', 'tersio.js');

function serverEnv(home: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    TERSIO_HOME: path.join(home, '.tersio'),
    TERSIO_USAGE_FILE: path.join(home, 'usage.jsonl'),
    TERSIO_SESSIONS_DIR: path.join(home, 'no-sessions'),
    TERSIO_RTK_DB: path.join(home, 'no-rtk.db'),
    TERSIO_USAGE_DB: path.join(home, 'no-usage.db'),
    TERSIO_RESET_FILE: path.join(home, 'reset.json'),
  };
}

// A real child process needs wall-clock watchdogs; fake timers cannot drive its startup or exit.
function startDashboard(home: string): Promise<{ child: ChildProcess; url: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let out = '';
    const done = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const child = spawn(process.execPath, [installer, 'dashboard', '--port', '0'], {
      cwd: root,
      env: serverEnv(home),
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      done(() => reject(new Error(`dashboard server did not come up: ${out}`)));
    }, 15_000);
    const watch = (chunk: unknown): void => {
      out += String(chunk);
      const match = /\[ok\] Dashboard live → (http:\/\/\S+)/.exec(out);
      const url = match?.[1];
      if (url) done(() => resolve({ child, url }));
    };
    child.stdout?.on('data', watch);
    child.stderr?.on('data', watch);
    child.on('error', (error) => done(() => reject(error)));
  });
}

function stopDashboard(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, 5_000);
    child.on('exit', done);
    child.kill('SIGKILL');
  });
}

test('dashboard saves CodeGraph defaults only for hosts that load its extension', async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'tersio-dashboard-codegraph-hosts-'));
  const settingsFile = path.join(home, '.tersio', 'settings.json');
  try {
    const { child, url } = await startDashboard(home);
    try {
      for (const host of ['omp', 'pi', 'pig', 'opencode']) {
        const response = await fetch(`${url}/settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ host, codegraphDefault: 'off' }),
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ ok: true, codegraphDefault: 'off' });
      }
      // Codex loads no extension, but its edit-sync hook rides the flag, so the toggle reaches it.
      const codexResponse = await fetch(`${url}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'codex', codegraphDefault: 'on' }),
      });
      expect(await codexResponse.json()).toMatchObject({ ok: true, codegraphDefault: 'on' });
      for (const host of ['claude']) {
        const before = readFileSync(settingsFile, 'utf8');
        const response = await fetch(`${url}/settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ host, codegraphDefault: 'on' }),
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          ok: false,
          error: `CodeGraph is not supported for ${host}`,
        });
        expect(readFileSync(settingsFile, 'utf8')).toBe(before);
      }
    } finally {
      await stopDashboard(child);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
