import http from 'node:http';
import { afterEach, describe, expect, test } from 'vitest';
import { headroomHostDurable, headroomHostSupported } from '../../extensions/shared/headroom-proxy.ts';
import {
  headroomFitsMachine,
  headroomProxyPids,
  headroomProxyPort,
  headroomProxyUrl,
  headroomRuntimeUp,
  proxyArgsForDeployment,
  reapProxies,
  releaseHeadroomLease,
  touchHeadroomLease,
} from '../../extensions/shared/headroom-runtime.ts';

describe('headroom runtime', () => {
  const before = process.env.TERSIO_HEADROOM_PROXY_URL;
  afterEach(() => {
    if (before === undefined) delete process.env.TERSIO_HEADROOM_PROXY_URL;
    else process.env.TERSIO_HEADROOM_PROXY_URL = before;
  });

  test('every host can route, while only Oh My Pi and OpenCode have writers', () => {
    for (const host of ['omp', 'pi', 'opencode', 'pig', 'dsh', 'codex']) expect(headroomHostSupported(host)).toBe(true);
    expect(headroomHostDurable('omp')).toBe(true);
    expect(headroomHostDurable('opencode')).toBe(true);
    expect(headroomHostDurable('pi')).toBe(false);
    expect(headroomHostDurable('pig')).toBe(false);
    expect(headroomHostDurable('dsh')).toBe(false);
    expect(headroomHostDurable('codex')).toBe(true);
  });

  test('the proxy URL override moves both the reader and the durable port', () => {
    process.env.TERSIO_HEADROOM_PROXY_URL = 'http://127.0.0.1:9911/';
    expect(headroomProxyUrl()).toBe('http://127.0.0.1:9911/');
    expect(headroomProxyPort()).toBe(9911);
  });

  test('a fallback start reuses the deployment mode and backend', () => {
    expect(
      proxyArgsForDeployment(
        ['--host', '127.0.0.1', '--port', '8787', '--mode', 'token', '--backend', 'anthropic'],
        9911,
      ),
    ).toEqual(['--host', '127.0.0.1', '--port', '9911', '--mode', 'token', '--backend', 'anthropic']);
    expect(proxyArgsForDeployment([], 9911)).toEqual(['--host', '127.0.0.1', '--port', '9911']);
    expect(proxyArgsForDeployment(['--mode', 'token'], 9911, 'http://127.0.0.1:3425/v1')).toEqual([
      '--mode',
      'token',
      '--port',
      '9911',
      '--host',
      '127.0.0.1',
      '--openai-api-url',
      'http://127.0.0.1:3425/v1',
    ]);
  });

  test('a shell that only mentions the pattern is not counted as a proxy', () => {
    // `pgrep -f` matches any command line containing the text, so a shell running this very test did
    // count as a proxy. Every pid must be a Python interpreter.
    for (const pid of headroomProxyPids()) {
      const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
      const comm = execFileSync('ps', ['-o', 'comm=', '-p', String(pid)], { encoding: 'utf8' }).trim();
      expect(comm).toMatch(/python/i);
    }
  });

  test('a second agent session keeps the proxy, and the last one releases it', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const home = mkdtempSync(path.join(os.tmpdir(), 'tersio-lease-'));
    const previous = {
      HOME: process.env.HOME,
      TERSIO_HOME: process.env.TERSIO_HOME,
      URL: process.env.TERSIO_HEADROOM_PROXY_URL,
    };
    process.env.HOME = home;
    process.env.TERSIO_HOME = path.join(home, '.tersio');
    // Port 1 refuses at once, so the test pays no start: only the lease decision is measured.
    process.env.TERSIO_HEADROOM_PROXY_URL = 'http://127.0.0.1:1/';
    try {
      // Two agents claim the proxy, like a Pi and a dsh session opened together.
      touchHeadroomLease('agent-a');
      touchHeadroomLease('agent-b');
      // The first to quit must leave it running for the other.
      const first = await releaseHeadroomLease('agent-a');
      expect(first.ok).toBe(true);
      expect(first.detail).toContain('another agent session');
      // The last one releases it, so the stop path runs instead of the early return.
      const last = await releaseHeadroomLease('agent-b');
      expect(last.detail).not.toContain('another agent session');
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        const key = name === 'URL' ? 'TERSIO_HEADROOM_PROXY_URL' : name;
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(home, { recursive: true, force: true });
    }
  }, 20_000);

  test('a machine too small for the proxy is reported, and the override wins', () => {
    const savedForce = process.env.TERSIO_HEADROOM_FORCE;
    try {
      delete process.env.TERSIO_HEADROOM_FORCE;
      const real = headroomFitsMachine();
      // The probe reads this machine, so only its shape is asserted here: a number or an honest null.
      expect(typeof real.fits).toBe('boolean');
      expect(real.detail.length).toBeGreaterThan(0);
      expect(real.totalMb === null || real.totalMb > 0).toBe(true);
      if (real.totalMb !== null) expect(real.fits).toBe(real.totalMb >= 2048);
      process.env.TERSIO_HEADROOM_FORCE = '1';
      expect(headroomFitsMachine().fits, 'an operator override is honored').toBe(true);
    } finally {
      if (savedForce === undefined) delete process.env.TERSIO_HEADROOM_FORCE;
      else process.env.TERSIO_HEADROOM_FORCE = savedForce;
    }
  });

  test('a live /readyz reads as up, and a closed port reads as down', async () => {
    const server = http.createServer((req, res) => {
      if (req.url === '/readyz') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ready":true}');
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    process.env.TERSIO_HEADROOM_PROXY_URL = `http://127.0.0.1:${port}/`;
    expect(await headroomRuntimeUp()).toBe(true);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(await headroomRuntimeUp()).toBe(false);
  });
});

test.skipIf(process.platform === 'win32')('a stray proxy is found and stopped', async () => {
  // A process whose argv names headroom's proxy: exactly what the scan looks for, at no cost.
  const { spawn } = await import('node:child_process');
  const stray = spawn('python3', ['-c', 'import time; time.sleep(30)', 'headroom.cli proxy', '--port', '65000'], {
    stdio: 'ignore',
  });
  try {
    expect(stray.pid).toBeTruthy();
    const found = headroomProxyPids();
    expect(found).toContain(stray.pid as number);
    reapProxies([stray.pid as number]);
    expect(headroomProxyPids()).not.toContain(stray.pid as number);
  } finally {
    try {
      stray.kill('SIGKILL');
    } catch {
      /* already stopped by the reap */
    }
  }
});

test('a held start lock is respected, and a stale one is taken over', async () => {
  const { mkdirSync, rmSync, utimesSync, writeFileSync } = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const home = await import('node:fs/promises').then((fs) => fs.mkdtemp(path.join(os.tmpdir(), 'tersio-lock-')));
  const previous = {
    HOME: process.env.HOME,
    TERSIO_HOME: process.env.TERSIO_HOME,
    WAIT: process.env.TERSIO_HEADROOM_WAIT_MS,
    URL: process.env.TERSIO_HEADROOM_PROXY_URL,
  };
  process.env.HOME = home;
  process.env.TERSIO_HOME = path.join(home, '.tersio');
  process.env.TERSIO_HEADROOM_WAIT_MS = '120';
  // Port 1 refuses instantly, so the wait window is the only thing a test pays for.
  process.env.TERSIO_HEADROOM_PROXY_URL = 'http://127.0.0.1:1/';
  try {
    const { ensureHeadroomRuntime } = await import('../../extensions/shared/headroom-runtime.ts');
    const lock = path.join(process.env.TERSIO_HOME, 'headroom-start.lock');
    mkdirSync(path.dirname(lock), { recursive: true });
    writeFileSync(lock, '999999', 'utf8');
    // node exits at once on an unknown script: a start that answers nothing, at no cost.
    const held = await ensureHeadroomRuntime(process.execPath);
    expect(held.ok).toBe(false);
    expect(held.detail).toContain('another tersio process');

    // Time, not content, decides staleness: an old file is a crashed start.
    const old = new Date(Date.now() - 120_000);
    utimesSync(lock, old, old);
    const taken = await ensureHeadroomRuntime(process.execPath);
    expect(taken.detail).not.toContain('another tersio process');
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      const key = name === 'WAIT' ? 'TERSIO_HEADROOM_WAIT_MS' : name === 'URL' ? 'TERSIO_HEADROOM_PROXY_URL' : name;
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(home, { recursive: true, force: true });
  }
});
