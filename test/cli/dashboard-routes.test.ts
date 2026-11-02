import { describe, expect, test } from 'vitest';
import { agentJson, shouldAutoWatch, lanUrls, resolveBind, healthJson, isHeadroomWrapTarget, isVendorTool, json, statusJson } from '../../cli/dashboard.ts';
import { withHome } from '../helpers/env.ts';

// The route handlers pass these names straight to a child process, so the guards are the boundary.
describe('dashboard route guards', () => {
  test('only headroom wrap targets reach the wrap command', () => {
    expect(isHeadroomWrapTarget('omp')).toBe(true);
    expect(isHeadroomWrapTarget('claude')).toBe(true);
    expect(isHeadroomWrapTarget('--force')).toBe(false);
    expect(isHeadroomWrapTarget('')).toBe(false);
  });

  test('only the two managed binaries reach the vendor routes', () => {
    expect(isVendorTool('headroom')).toBe(true);
    expect(isVendorTool('rtk')).toBe(true);
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

// Every interface is the default, so a phone can open it; `local` is the opt-out.
test('the dashboard binds every interface unless loopback is asked for', () => {
  expect(resolveBind(null)).toBe('0.0.0.0');
  expect(resolveBind('')).toBe('0.0.0.0');
  expect(resolveBind('lan')).toBe('0.0.0.0');
  expect(resolveBind('0.0.0.0')).toBe('0.0.0.0');
  expect(resolveBind('192.168.1.20')).toBe('192.168.1.20');
  expect(resolveBind('not an address')).toBe('0.0.0.0');
  expect(resolveBind('local')).toBe('127.0.0.1');
  expect(resolveBind('localhost')).toBe('127.0.0.1');
  expect(lanUrls(8080, '127.0.0.1')).toEqual([]);
  expect(lanUrls(8080, '192.168.1.20')).toEqual(['http://192.168.1.20:8080']);
});

// A source checkout on a terminal should hot-reload without a flag; exports and CI must not.
test('automatic watch needs a source checkout and a terminal', () => {
  expect(shouldAutoWatch(true, true, {})).toBe(true);
  expect(shouldAutoWatch(false, true, {})).toBe(false);
  expect(shouldAutoWatch(true, false, {})).toBe(false);
  expect(shouldAutoWatch(true, true, { TERSIO_NO_WATCH: '1' })).toBe(false);
  expect(shouldAutoWatch(true, true, { TERSIO_DASHBOARD_CHILD: '1' })).toBe(false);
});
