import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type http from 'node:http';
import { expect, test } from 'vitest';
import { withHome } from '../helpers/env.ts';
import { handleHeadroomRoutes } from '../../cli/dashboard-headroom.ts';
import type { HeadroomRouteCtx } from '../../cli/dashboard-headroom.ts';

const PROXY = 'http://127.0.0.1:8787/v1';

/** A repo's own config the way Pi writes it: a provider block and a default model that names it. */
function piHome(home: string): void {
  const dir = path.join(home, '.pi', 'agent');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
    defaultProvider: 'magpie',
    defaultModel: 'commandcode/deepseek/deepseek-v4.1-flash',
  }), 'utf8');
  writeFileSync(path.join(dir, 'models.json'), JSON.stringify({
    providers: { magpie: { api: 'openai-completions', baseUrl: 'http://127.0.0.1:3425/v1' } },
  }, null, 2), 'utf8');
  headroomManifest(home);
}

/** A headroom binary the test controls, pinned by path so a machine without one behaves the same. */
function pinHeadroom(home: string): () => void {
  const dir = path.join(home, 'bin');
  mkdirSync(dir, { recursive: true });
  const stub = path.join(dir, 'headroom');
  writeFileSync(stub, '#!/bin/sh\nexit 0\n', 'utf8');
  chmodSync(stub, 0o755);
  const previous = process.env.TERSIO_HEADROOM_BIN;
  process.env.TERSIO_HEADROOM_BIN = stub;
  return () => {
    if (previous === undefined) delete process.env.TERSIO_HEADROOM_BIN;
    else process.env.TERSIO_HEADROOM_BIN = previous;
  };
}

/** What headroom's own deploy manifest records: the provider it forwards to. */
function headroomManifest(home: string): void {
  const deploy = path.join(home, '.headroom', 'deploy', 'init');
  mkdirSync(deploy, { recursive: true });
  writeFileSync(path.join(deploy, 'manifest.json'), JSON.stringify({
    updated_at: '2026-01-01T00:00:00Z',
    base_env: { OPENAI_TARGET_API_URL: 'http://127.0.0.1:3425/v1' },
  }), 'utf8');
}

/** Both dsh profiles, so the test can prove the running one is the one written. */
function bothDshProfiles(home: string): void {
  const root = path.join(home, '.dsh');
  mkdirSync(root, { recursive: true });
  headroomManifest(home);
  const block = (indent: string): string => `${indent}magpie:
${indent}  api: openai-completions
${indent}  baseURL: http://127.0.0.1:3425/v1
`;
  writeFileSync(path.join(root, 'settings.yaml'), `llm-pi-ai:\n  providers:\n${block('    ')}`, 'utf8');
  for (const profile of ['desktop', 'web']) {
    mkdirSync(path.join(root, 'profiles', profile), { recursive: true });
    writeFileSync(path.join(root, 'profiles', profile, 'cordis.patch.yml'), `- id: agent-default-model # magpie
  config:
    provider: magpie
    model: auto/beam-free
- id: llm-pi-ai # magpie
  config:
    providers:
${block('      ')}`, 'utf8');
  }
}

function collector(): { sent: Array<{ code: number; body: Record<string, unknown> }>; ctx: HeadroomRouteCtx; body: { value: Record<string, unknown> } } {
  const sent: Array<{ code: number; body: Record<string, unknown> }> = [];
  const body = { value: {} as Record<string, unknown> };
  const ctx: HeadroomRouteCtx = {
    json: (res, code, value) => {
      res.writeHead(code);
      sent.push({ code, body: value as Record<string, unknown> });
    },
    bodyOf: async () => body.value,
    spawnHeadroomInstall: () => false,
    headroomInstallState: () => ({ startedAt: 0, code: null, error: null }),
    ensureRuntime: async () => ({ ok: true, detail: 'started' }),
  };
  return { sent, ctx, body };
}

const fakeMessage = (): http.IncomingMessage => ({} as http.IncomingMessage);
const fakeResponse = (): http.ServerResponse => ({ writeHead: () => undefined, end: () => undefined } as unknown as http.ServerResponse);

test('the route endpoint writes a route and takes it back', async () => {
  await withHome(async (home) => {
    const release = pinHeadroom(home);
    try {
    piHome(home);
    const { sent, ctx } = collector();
    const url = (): string => '/api/headroom/route';

    ctx.bodyOf = async () => ({ name: 'pi', on: true });
    expect(await handleHeadroomRoutes(Object.assign(fakeMessage(), { url: url(), method: 'POST' }), fakeResponse(), ctx)).toBe(true);
    expect(sent[0]?.body.ok, String(sent[0]?.body.error)).toBe(true);
    expect(readFileSync(path.join(home, '.pi', 'agent', 'models.json'), 'utf8')).toContain(PROXY);

    ctx.bodyOf = async () => ({ name: 'pi', on: false });
    await handleHeadroomRoutes(Object.assign(fakeMessage(), { url: url(), method: 'POST' }), fakeResponse(), ctx);
    expect(sent[1]?.body.ok).toBe(true);
    const restored = readFileSync(path.join(home, '.pi', 'agent', 'models.json'), 'utf8');
    expect(restored).toContain('http://127.0.0.1:3425/v1');
    expect(restored).not.toContain(PROXY);
    } finally { release(); }
  });
});

test('the route list is Tersio agents only, and a name outside it is refused', async () => {
  await withHome(async (home) => {
    const release = pinHeadroom(home);
    try {
    piHome(home);
    const { sent, ctx } = collector();
    await handleHeadroomRoutes(Object.assign(fakeMessage(), { url: '/api/headroom/route', method: 'GET' }), fakeResponse(), ctx);
    const targets = sent[0]?.body.targets as Array<{ name: string; routed: boolean }>;
    expect(targets.map((target) => target.name)).toContain('pi');
    expect(targets.find((target) => target.name === 'pi')?.routed).toBe(false);

    ctx.bodyOf = async () => ({ name: 'claude', on: true });
    await handleHeadroomRoutes(Object.assign(fakeMessage(), { url: '/api/headroom/route', method: 'POST' }), fakeResponse(), ctx);
    expect(sent[1]?.code).toBe(400);
    } finally { release(); }
  });
});

test('dsh routes the running profile, not the other one', async () => {
  const previous = process.env.DSH_PROFILE;
  // The harness names its own profile; a machine running `dsh web` must write web, not desktop.
  process.env.DSH_PROFILE = 'web';
  try {
    await withHome(async (home) => {
      const release = pinHeadroom(home);
      try {
      bothDshProfiles(home);
      const { sent, ctx } = collector();
      ctx.bodyOf = async () => ({ name: 'dsh', on: true });
      await handleHeadroomRoutes(Object.assign(fakeMessage(), { url: '/api/headroom/route', method: 'POST' }), fakeResponse(), ctx);
      expect(sent[0]?.body.ok, String(sent[0]?.body.error)).toBe(true);
      const web = readFileSync(path.join(home, '.dsh', 'profiles', 'web', 'cordis.patch.yml'), 'utf8');
      const desktop = readFileSync(path.join(home, '.dsh', 'profiles', 'desktop', 'cordis.patch.yml'), 'utf8');
      expect(web).toContain(PROXY);
      expect(desktop).toContain('http://127.0.0.1:3425/v1');
      } finally { release(); }
    });
  } finally {
    if (previous === undefined) delete process.env.DSH_PROFILE;
    else process.env.DSH_PROFILE = previous;
  }
});

/** An OpenCode config with one provider the active model names. */
function opencodeHome(home: string): void {
  const dir = path.join(home, '.config', 'opencode');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'opencode.json'), JSON.stringify({
    model: 'magpie/deepseek-v4.1',
    provider: { magpie: { options: { baseURL: 'http://127.0.0.1:3425/v1' } } },
  }, null, 2), 'utf8');
}

/** omp keeps its provider blocks in a YAML file and the default role in another. */
function ompHome(home: string): void {
  const dir = path.join(home, '.omp', 'agent');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'models.yml'), `providers:
  magpie:
    api: openai-completions
    baseUrl: http://127.0.0.1:3425/v1
    models:
    - id: commandcode/deepseek/deepseek-v4.1-flash
`, 'utf8');
  writeFileSync(path.join(dir, 'config.yml'), `modelRoles:
  default: commandcode/deepseek/deepseek-v4.1-flash:high
`, 'utf8');
}

test('opencode gets our own route, and our own restore', async () => {
  await withHome(async (home) => {
    const release = pinHeadroom(home);
    try {
      opencodeHome(home);
      const file = path.join(home, '.config', 'opencode', 'opencode.json');
      const { sent, ctx } = collector();
      ctx.bodyOf = async () => ({ name: 'opencode', on: true });
      await handleHeadroomRoutes(Object.assign(fakeMessage(), { url: '/api/headroom/route', method: 'POST' }), fakeResponse(), ctx);
      expect(sent[0]?.body.ok, String(sent[0]?.body.error)).toBe(true);
      expect(readFileSync(file, 'utf8')).toContain(PROXY);

      ctx.bodyOf = async () => ({ name: 'opencode', on: false });
      await handleHeadroomRoutes(Object.assign(fakeMessage(), { url: '/api/headroom/route', method: 'POST' }), fakeResponse(), ctx);
      expect(sent[1]?.body.ok, String(sent[1]?.body.error)).toBe(true);
      const restored = readFileSync(file, 'utf8');
      expect(restored).toContain('http://127.0.0.1:3425/v1');
      expect(restored).not.toContain(PROXY);
    } finally { release(); }
  });
});

test('omp gets our own route, and our own restore', async () => {
  await withHome(async (home) => {
    const release = pinHeadroom(home);
    try {
      ompHome(home);
      const file = path.join(home, '.omp', 'agent', 'models.yml');
      const { sent, ctx } = collector();
      ctx.bodyOf = async () => ({ name: 'omp', on: true });
      await handleHeadroomRoutes(Object.assign(fakeMessage(), { url: '/api/headroom/route', method: 'POST' }), fakeResponse(), ctx);
      expect(sent[0]?.body.ok, String(sent[0]?.body.error)).toBe(true);
      expect(readFileSync(file, 'utf8')).toContain('http://127.0.0.1:8787/v1');

      ctx.bodyOf = async () => ({ name: 'omp', on: false });
      await handleHeadroomRoutes(Object.assign(fakeMessage(), { url: '/api/headroom/route', method: 'POST' }), fakeResponse(), ctx);
      expect(sent[1]?.body.ok, String(sent[1]?.body.error)).toBe(true);
      const restored = readFileSync(file, 'utf8');
      expect(restored).toContain('http://127.0.0.1:3425/v1');
      expect(restored).not.toContain('tersio-headroom-upstream');
    } finally { release(); }
  });
});
