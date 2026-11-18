import {describe, expect, test} from 'vitest';
import http from 'node:http';
import net from 'node:net';
import {
    agentJson,
    dashboardRequestAllowed,
    healthJson,
    isVendorTool,
    json,
    lanUrls,
    resolveBind,
    shouldAutoWatch,
    statusJson,
} from '../../cli/dashboard.ts';
import {withHome} from '../helpers/env.ts';

// The route handlers pass these names straight to a child process, so the guards are the boundary.
describe('dashboard route guards', () => {
  test('only the binary Tersio manages reaches the vendor routes', () => {
    expect(isVendorTool('headroom')).toBe(true);
    // rtk installs and removes itself; a vendor route must never touch it.
    expect(isVendorTool('rtk')).toBe(false);
    expect(isVendorTool('caveman')).toBe(false);
    expect(isVendorTool('')).toBe(false);
  });
});

// These three build their own JSON string, and `json()` would double-encode one; the routes send them as text.
describe('dashboard payloads are serialized once', () => {
  test('health, status, and agent answers parse to objects, never to a string', async () => {
    await withHome(async () => {
      const health: unknown = JSON.parse(healthJson());
      expect(health).toBeTypeOf('object');
      expect(health).toHaveProperty('tersio');
      expect(health).toHaveProperty('headroom');

      const status: unknown = JSON.parse(await statusJson());
      expect(status).toBeTypeOf('object');
      expect(status).toHaveProperty('status');

      const agent: unknown = JSON.parse(agentJson('24h', 'overview', 0));
      expect(agent).toBeTypeOf('object');
      expect(agent).toHaveProperty('range', '24h');
      expect(agent).toHaveProperty('agent');
    });
  });
});

test('json refuses a pre-serialized string, so a folded route cannot double-encode', () => {
  const res = { writeHead: () => res, end: () => res };
  expect(() => json(res, 200, healthJson())).toThrow(/jsonText/);
});

// Local-only by default; LAN reads require an explicit bind.
test('the dashboard binds loopback unless a network address is requested', () => {
  expect(resolveBind(null)).toBe('127.0.0.1');
  expect(resolveBind('')).toBe('127.0.0.1');
  expect(resolveBind('lan')).toBe('0.0.0.0');
  expect(resolveBind('0.0.0.0')).toBe('0.0.0.0');
  expect(resolveBind('192.168.1.20')).toBe('192.168.1.20');
  expect(resolveBind('not an address')).toBe('127.0.0.1');
  expect(resolveBind('local')).toBe('127.0.0.1');
  expect(resolveBind('localhost')).toBe('127.0.0.1');
  expect(lanUrls(8080, '127.0.0.1')).toEqual([]);
  expect(lanUrls(8080, '192.168.1.20')).toEqual(['http://192.168.1.20:8080']);
});

test('dashboard rejects cross-origin writes and DNS rebinding', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(dashboardRequestAllowed(req) ? 200 : 403);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    expect((await fetch(`${base}/settings`, { method: 'POST', headers: { Origin: base } })).status).toBe(200);
    expect((await fetch(`${base}/settings`, { method: 'POST', headers: { Origin: 'https://attacker.example' } })).status).toBe(403);
    const rebound = await new Promise<number>((resolve, reject) => {
      const request = http.get(`${base}/settings`, { headers: { Host: `attacker.example:${address.port}` } }, (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      request.on('error', reject);
    });
    expect(rebound).toBe(403);
    expect((await fetch(`${base}/settings`, { method: 'POST', headers: { 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('explicit LAN access is read-only', () => {
  const socket = new net.Socket();
  Object.defineProperty(socket, 'localAddress', { value: '192.0.2.10' });
  Object.defineProperty(socket, 'remoteAddress', { value: '192.0.2.20' });
  const req = new http.IncomingMessage(socket);
  req.headers.host = '192.0.2.10:3456';
  req.method = 'GET';
  expect(dashboardRequestAllowed(req)).toBe(true);
  req.method = 'POST';
  expect(dashboardRequestAllowed(req)).toBe(false);
  socket.destroy();
});

// A source checkout on a terminal should hot-reload without a flag; exports and CI must not.
test('automatic watch needs a source checkout and a terminal', () => {
  expect(shouldAutoWatch(true, true, {})).toBe(true);
  expect(shouldAutoWatch(false, true, {})).toBe(false);
  expect(shouldAutoWatch(true, false, {})).toBe(false);
  expect(shouldAutoWatch(true, true, { TERSIO_NO_WATCH: '1' })).toBe(false);
  expect(shouldAutoWatch(true, true, { TERSIO_DASHBOARD_CHILD: '1' })).toBe(false);
});
