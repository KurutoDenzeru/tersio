import { afterEach, expect, test, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import headroomExtension from '../../extensions/headroom/index.ts';
import type { AgentModel, ExtensionApi, ExtensionCtx } from '../../extensions/shared/types.ts';
import type * as HeadroomRuntime from '../../extensions/shared/headroom-runtime.ts';
import { sqliteExec } from '../../extensions/shared/sqlite.ts';
import { fakeExecutable, withHome } from '../helpers/env.ts';

const runtime = vi.hoisted(() => ({
  live: { anthropic: 'https://api.anthropic.com', openai: 'https://api.openai.com' },
  ensure: vi.fn<typeof HeadroomRuntime.ensureHeadroomRuntime>(async () => ({ ok: true, detail: 'ready' })),
}));
vi.mock('../../extensions/shared/headroom-runtime.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof HeadroomRuntime>()),
  ensureHeadroomRuntime: runtime.ensure,
  liveHeadroomUpstreams: () => runtime.live,
  touchHeadroomLease: vi.fn<typeof HeadroomRuntime.touchHeadroomLease>(),
}));

afterEach(() => {
  vi.restoreAllMocks();
  runtime.ensure.mockClear();
});

async function fixture(run: (dir: string) => Promise<void>): Promise<void> {
  await withHome(async (home) => {
    const dir = path.join(home, '.omp', 'agent');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'config.yml'), 'modelRoles:\n  default: commandcode/demo\n');
    writeFileSync(
      path.join(dir, 'models.yml'),
      'providers:\n  commandcode:\n    tersio-headroom-upstream: https://api.commandcode.ai/provider\n    baseUrl: http://127.0.0.1:8787/v1\n',
    );
    const models = [
      {
        id: 'demo',
        provider: 'commandcode',
        api: 'anthropic-messages',
        baseUrl: 'https://api.commandcode.ai/provider',
      },
      {
        id: 'fast',
        provider: 'commandcode',
        api: 'openai-completions',
        baseUrl: 'https://api.commandcode.ai/provider/v1',
      },
    ];
    const codex = [
      {
        id: 'codex-demo',
        provider: 'openai-codex',
        api: 'openai-codex-responses',
        baseUrl: 'https://chatgpt.com/backend-api',
      },
    ];
    const gemini = [
      {
        id: 'gemini-demo',
        provider: 'google-antigravity',
        api: 'google-gemini-cli',
        baseUrl: 'https://daily-cloudcode-pa.googleapis.com',
      },
    ];
    sqliteExec(
      path.join(dir, 'models.db'),
      `create table model_cache(provider_id text, models text); insert into model_cache values ('commandcode', '${JSON.stringify(models)}'), ('openai-codex', '${JSON.stringify(codex)}'), ('google-antigravity', '${JSON.stringify(gemini)}');`,
    );
    const previous = {
      agent: process.env.PI_CODING_AGENT_DIR,
      bin: process.env.TERSIO_HEADROOM_BIN,
      url: process.env.TERSIO_HEADROOM_PROXY_URL,
    };
    process.env.PI_CODING_AGENT_DIR = dir;
    process.env.TERSIO_HEADROOM_BIN = fakeExecutable(path.join(home, 'bin'), 'headroom', 'exit 0', 'exit /b 0');
    process.env.TERSIO_HEADROOM_PROXY_URL = 'http://127.0.0.1:8787/';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ready'));
    try {
      await run(dir);
    } finally {
      for (const [key, value] of [
        ['PI_CODING_AGENT_DIR', previous.agent],
        ['TERSIO_HEADROOM_BIN', previous.bin],
        ['TERSIO_HEADROOM_PROXY_URL', previous.url],
      ]) {
        if (value === undefined) delete process.env[key!];
        else process.env[key!] = value;
      }
    }
  });
}

function harness(initial: AgentModel | undefined, includeAbort = true) {
  let current = initial;
  const on = vi.fn<ExtensionApi['on']>();
  const setModel = vi.fn<NonNullable<ExtensionApi['setModel']>>(async (model) => {
    current = model;
    return true;
  });
  const notify = vi.fn<(message: string, level?: string) => void>();
  const setThinkingLevel = vi.fn<(level: string) => void>();
  const abort = vi.fn<() => void>();
  const ctx: ExtensionCtx & { abort?: () => void } = {
    model: initial,
    models: { current: () => current },
    ui: { notify },
    sessionManager: { getBranch: () => [{ type: 'custom', customType: 'headroom-mode', data: { mode: 'on' } }] },
  };
  if (includeAbort) ctx.abort = abort;
  headroomExtension({ hostId: 'omp', on, setModel, getThinkingLevel: () => 'high', setThinkingLevel });
  return {
    ctx,
    setModel,
    notify,
    setThinkingLevel,
    abort,
    select: (model: AgentModel) => {
      current = model;
    },
    emit: (event: string) => on.mock.calls.find(([name]) => name === event)?.[1]({ systemPrompt: ['base'] }, ctx),
  };
}

test('routes the live Codex selection without changing the saved CommandCode default or its upstream', async () => {
  await fixture(async (dir) => {
    const h = harness({
      id: 'demo',
      provider: 'commandcode',
      api: 'anthropic-messages',
      baseUrl: 'http://127.0.0.1:8787/v1',
    });
    await h.emit('session_start');
    h.select({
      id: 'codex-demo',
      provider: 'openai-codex',
      api: 'openai-codex-responses',
      baseUrl: 'https://chatgpt.com/backend-api',
      reasoning: true,
    });
    const result = await h.emit('before_agent_start');
    expect(h.setModel).toHaveBeenLastCalledWith(
      expect.objectContaining({ provider: 'openai-codex', baseUrl: 'http://127.0.0.1:8787/v1', reasoning: true }),
    );
    expect(h.setThinkingLevel).toHaveBeenLastCalledWith('high');
    const models = readFileSync(path.join(dir, 'models.yml'), 'utf8');
    expect(models).toContain('  openai-codex:\n');
    expect(models).toContain('api: openai-codex-responses');
    expect(models).not.toContain('# tersio-headroom-upstream: http://127.0.0.1:8787');
    expect(readFileSync(path.join(dir, 'config.yml'), 'utf8')).toBe('modelRoles:\n  default: commandcode/demo\n');
    expect(JSON.stringify(result)).toContain('openai-codex/codex-demo');
  });
});

test('routes a live Gemini CLI model through the shared proxy without changing its Google upstream', async () => {
  await fixture(async () => {
    const h = harness({
      id: 'demo',
      provider: 'commandcode',
      api: 'anthropic-messages',
      baseUrl: 'http://127.0.0.1:8787/v1',
    });
    await h.emit('session_start');
    h.select({
      id: 'gemini-demo',
      provider: 'google-antigravity',
      api: 'google-gemini-cli',
      baseUrl: 'https://daily-cloudcode-pa.googleapis.com',
    });
    h.setModel.mockClear();
    await h.emit('before_agent_start');
    expect(h.setModel).toHaveBeenLastCalledWith(
      expect.objectContaining({
        provider: 'google-antigravity',
        baseUrl: 'http://127.0.0.1:8787',
        headers: { 'x-headroom-base-url': 'https://daily-cloudcode-pa.googleapis.com' },
      }),
    );
    expect(h.notify).not.toHaveBeenCalledWith(expect.stringContaining('leaving its endpoint unchanged'), 'warning');
  });
});

test('routes a native fallback with its own upstream and preserves resolved authentication headers', async () => {
  await fixture(async (dir) => {
    writeFileSync(path.join(dir, 'config.yml'), 'modelRoles:\n  default: openai-codex/codex-demo\n');
    const primary: AgentModel = {
      id: 'codex-demo',
      provider: 'openai-codex',
      api: 'openai-codex-responses',
      baseUrl: 'https://chatgpt.com/backend-api',
    };
    const fallback: AgentModel = {
      id: 'fast',
      provider: 'commandcode',
      api: 'openai-completions',
      baseUrl: 'http://127.0.0.1:8787/v1',
      headers: { 'x-team': 'project' },
      resolveHeaders: async () => ({ authorization: 'fixture-token', 'x-headroom-base-url': 'https://wrong.invalid' }),
    };
    const h = harness(primary);
    await h.emit('session_start');
    h.select(fallback);
    await h.emit('retry_fallback_applied');
    const routed = h.ctx.models?.current();
    expect(routed?.baseUrl).toBe('http://127.0.0.1:8787/v1');
    expect(await routed?.resolveHeaders?.()).toEqual({
      'x-team': 'project',
      authorization: 'fixture-token',
      'x-headroom-base-url': 'https://api.commandcode.ai/provider',
    });
    const codex = h.setModel.mock.calls.find(([model]) => model.provider === 'openai-codex')?.[0];
    expect((await codex?.resolveHeaders?.())?.['x-headroom-base-url']).toBeUndefined();
    expect(readFileSync(path.join(dir, 'config.yml'), 'utf8')).toBe(
      'modelRoles:\n  default: openai-codex/codex-demo\n',
    );
  });
});

test('aborts a routed provider request when the Headroom executable is unavailable', async () => {
  await fixture(async (dir) => {
    const h = harness(undefined);
    await h.emit('session_start');
    h.select({ id: 'demo', provider: 'commandcode', api: 'anthropic-messages', baseUrl: 'http://127.0.0.1:8787/v1' });
    process.env.TERSIO_HEADROOM_BIN = path.join(dir, 'missing-headroom');

    await h.emit('before_provider_request');

    expect(h.abort).toHaveBeenCalledOnce();
    expect(h.notify).toHaveBeenCalledWith(
      expect.stringContaining('Headroom executable is unavailable; request aborted.'),
      'warning',
    );
  });
});

test('aborts a routed provider request when proxy readiness fails', async () => {
  await fixture(async () => {
    const h = harness(undefined);
    await h.emit('session_start');
    h.select({ id: 'demo', provider: 'commandcode', api: 'anthropic-messages', baseUrl: 'http://127.0.0.1:8787/v1' });
    runtime.ensure.mockResolvedValueOnce({ ok: false, detail: 'proxy offline' });

    await h.emit('before_provider_request');

    expect(h.abort).toHaveBeenCalledOnce();
    expect(h.notify).toHaveBeenCalledWith('Headroom: proxy offline; request aborted.', 'warning');
  });
});

test('aborts a fallback request when its API cannot route through Headroom', async () => {
  await fixture(async () => {
    const h = harness(undefined);
    await h.emit('session_start');
    h.select({ id: 'fallback', provider: 'custom', api: 'custom-api', baseUrl: 'https://api.example.com' });
    await h.emit('retry_fallback_applied');

    await h.emit('before_provider_request');

    expect(h.abort).toHaveBeenCalledOnce();
    expect(h.notify).toHaveBeenCalledWith(
      expect.stringContaining('active model is not routed through the Headroom proxy; request aborted.'),
      'warning',
    );
  });
});

test('reports when a host lacks the abort API instead of claiming the request was blocked', async () => {
  await fixture(async (dir) => {
    const h = harness(undefined, false);
    await h.emit('session_start');
    h.select({ id: 'demo', provider: 'commandcode', api: 'anthropic-messages', baseUrl: 'http://127.0.0.1:8787/v1' });
    process.env.TERSIO_HEADROOM_BIN = path.join(dir, 'missing-headroom');

    await h.emit('before_provider_request');

    expect(h.abort).not.toHaveBeenCalled();
    expect(h.notify).toHaveBeenCalledWith(
      expect.stringContaining('this host has no verified active-operation abort API, so the request may continue.'),
      'warning',
    );
  });
});
