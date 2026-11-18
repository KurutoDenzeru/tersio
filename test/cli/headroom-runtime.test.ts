import http from 'node:http';
import {existsSync, readFileSync} from 'node:fs';
import {execFileSync, spawn} from 'node:child_process';
import {afterEach, describe, expect, test} from 'vitest';
import {headroomHostDurable, headroomHostSupported} from '../../extensions/shared/headroom-proxy.ts';
import {cacheGet} from '../../extensions/shared/cache-store.ts';
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

  test('every host can route, while only the durable hosts keep their own block', () => {
    for (const host of ['omp', 'pi', 'opencode', 'pig', 'dsh', 'codex', 'claude'])
      expect(headroomHostSupported(host)).toBe(true);
    expect(headroomHostDurable('omp')).toBe(true);
    expect(headroomHostDurable('opencode')).toBe(true);
    expect(headroomHostDurable('pi')).toBe(false);
    expect(headroomHostDurable('pig')).toBe(false);
    expect(headroomHostDurable('dsh')).toBe(false);
    expect(headroomHostDurable('codex')).toBe(true);
    expect(headroomHostDurable('claude')).toBe(true);
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
    ).toEqual([
      '--host',
      '127.0.0.1',
      '--port',
      '9911',
      '--mode',
      'token',
      '--backend',
      'anthropic',
      '--disable-kompress',
    ]);
    expect(proxyArgsForDeployment([], 9911)).toEqual(['--host', '127.0.0.1', '--port', '9911', '--disable-kompress']);
    expect(proxyArgsForDeployment(['--mode', 'token'], 9911, { openai: 'http://127.0.0.1:3425/v1' })).toEqual([
      '--mode',
      'token',
      '--port',
      '9911',
      '--host',
      '127.0.0.1',
      '--openai-api-url',
      'http://127.0.0.1:3425/v1',
      '--disable-kompress',
    ]);
  });

  // The model is off by default, not forced off: a deployment that turned Kompress back on keeps it.
  test('a deployment that enables kompress keeps it', () => {
    const args = proxyArgsForDeployment(['--mode', 'token', '--enable-kompress'], 9911);
    expect(args).toContain('--enable-kompress');
    expect(args).not.toContain('--disable-kompress');
  });

  test.skipIf(process.platform === 'win32')('a shell that only mentions the pattern is not counted as a proxy', () => {
    // The launcher can set `comm` to `headroom`; argv must still name Python and the proxy command.
    for (const pid of headroomProxyPids()) {
      const argv =
        process.platform === 'linux'
          ? readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\u0000').join(' ')
          : execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });
      expect(argv).toMatch(/python.*headroom(?:\.cli)? proxy/i);
    }
  });

  test('releasing either session preserves the proxy for persistent model routes', async () => {
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
      await releaseHeadroomLease('agent-a');
      expect(Object.keys(JSON.parse(cacheGet('headroom.leases') ?? '{}'))).toEqual(['agent-b']);
      await releaseHeadroomLease('agent-b');
      expect(JSON.parse(cacheGet('headroom.leases') ?? '{}')).toEqual({});
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        const key = name === 'URL' ? 'TERSIO_HEADROOM_PROXY_URL' : name;
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(home, { recursive: true, force: true });
    }
  }, 20_000);

  test('releasing a session returns within the shutdown handler budget without stopping the shared proxy', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const home = mkdtempSync(path.join(os.tmpdir(), 'tersio-fast-lease-'));
    const previous = {
      HOME: process.env.HOME,
      TERSIO_HOME: process.env.TERSIO_HOME,
      URL: process.env.TERSIO_HEADROOM_PROXY_URL,
    };
    process.env.HOME = home;
    process.env.TERSIO_HOME = path.join(home, '.tersio');
    process.env.TERSIO_HEADROOM_PROXY_URL = 'http://127.0.0.1:1/';
    try {
      const started = Date.now();
      const result = await releaseHeadroomLease('agent-fast');
      expect(result.ok).toBe(true);
      // The host allows only two seconds for its shutdown handler.
      expect(Date.now() - started).toBeLessThan(1_500);
    } finally {
      for (const [name, value] of Object.entries(previous)) {
        const key = name === 'URL' ? 'TERSIO_HEADROOM_PROXY_URL' : name;
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(home, { recursive: true, force: true });
    }
  }, 5_000);

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

test.skipIf(process.platform === 'win32')('finds module and console-script proxy launchers', async () => {
  // Both invocations run under Python but expose different argv spellings.
  const moduleProxy = spawn('python3', ['-c', 'import time; time.sleep(30)', 'headroom.cli proxy', '--port', '65000'], {
    stdio: 'ignore',
  });
  const scriptProxy = spawn('python3', ['-c', 'import time; time.sleep(30)', 'headroom proxy', '--port=65001'], {
    stdio: 'ignore',
  });
  const pids = [moduleProxy.pid, scriptProxy.pid].filter((pid): pid is number => pid !== undefined);
  try {
    expect(pids).toHaveLength(2);
    expect(headroomProxyPids()).toEqual(expect.arrayContaining(pids));
    expect(headroomProxyPids(65000)).toContain(moduleProxy.pid);
    expect(headroomProxyPids(65000)).not.toContain(scriptProxy.pid);
    expect(headroomProxyPids(65001)).toContain(scriptProxy.pid);
    reapProxies(pids);
    expect(headroomProxyPids()).not.toEqual(expect.arrayContaining(pids));
  } finally {
    for (const proxy of [moduleProxy, scriptProxy]) {
      try {
        proxy.kill('SIGKILL');
      } catch {
        /* already stopped by the reap */
      }
    }
  }
});

test('a live start lock survives an old timestamp, orphaned reclaimer gates fail closed, and cleanup preserves replacements', async () => {
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
  const lock = path.join(process.env.TERSIO_HOME, 'headroom-start.lock');
  let replaceOwner = false;
  let requests = 0;
  const server = http.createServer((_req, res) => {
    requests += 1;
    let contents = '';
    try {
      contents = readFileSync(lock, 'utf8');
    } catch {
      /* preflight can run before a lock exists */
    }
    if (contents.startsWith(`${process.pid}:`)) {
      if (replaceOwner) {
        writeFileSync(lock, `${process.ppid}:replacement-owner`, 'utf8');
        replaceOwner = false;
      }
      res.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
      res.end('{"ready":true}');
      return;
    }
    res.writeHead(503, { connection: 'close' });
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  expect(port).toBeGreaterThan(0);
  process.env.TERSIO_HEADROOM_PROXY_URL = `http://127.0.0.1:${port}/`;
  try {
    const { ensureHeadroomRuntime } = await import('../../extensions/shared/headroom-runtime.ts');
    mkdirSync(path.dirname(lock), { recursive: true });
    const old = new Date(Date.now() - 120_000);

    writeFileSync(lock, String(process.pid), 'utf8');
    utimesSync(lock, old, old);
    const requestsBeforeWait = requests;
    const held = await ensureHeadroomRuntime(process.execPath);
    expect(requests - requestsBeforeWait).toBeGreaterThanOrEqual(3);
    expect(held.ok).toBe(false);
    expect(held.detail).toContain('another tersio process');
    expect(readFileSync(lock, 'utf8')).toBe(String(process.pid));

    const staleOwner = String(Number.MAX_SAFE_INTEGER);
    const reclaim = `${lock}.reclaim`;
    writeFileSync(lock, staleOwner, 'utf8');
    utimesSync(lock, old, old);
    mkdirSync(reclaim);
    writeFileSync(path.join(reclaim, 'owner'), staleOwner, 'utf8');
    utimesSync(reclaim, old, old);
    const gated = await ensureHeadroomRuntime(process.execPath);
    expect(gated.ok).toBe(false);
    expect(gated.detail).toContain(`headroom recovery is blocked by ${reclaim}`);
    expect(readFileSync(lock, 'utf8')).toBe(staleOwner);
    expect(readFileSync(path.join(reclaim, 'owner'), 'utf8')).toBe(staleOwner);
    rmSync(reclaim, { recursive: true, force: true });

    const recovered = await ensureHeadroomRuntime(process.execPath);
    expect(recovered.ok).toBe(true);
    expect(existsSync(lock)).toBe(false);
    expect(existsSync(reclaim)).toBe(false);

    replaceOwner = true;
    const replaced = await ensureHeadroomRuntime(process.execPath);
    expect(replaced.ok).toBe(true);
    expect(readFileSync(lock, 'utf8')).toBe(`${process.ppid}:replacement-owner`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const [name, value] of Object.entries(previous)) {
      const key = name === 'WAIT' ? 'TERSIO_HEADROOM_WAIT_MS' : name === 'URL' ? 'TERSIO_HEADROOM_PROXY_URL' : name;
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(home, { recursive: true, force: true });
  }
}, 20_000);
