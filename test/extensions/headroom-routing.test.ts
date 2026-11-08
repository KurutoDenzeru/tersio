import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  defaultOmpModel,
  codexRouteFrom,
  describeHeadroomRoute,
  dshProviderBaseUrls,
  dshRouteFrom,
  ompModelRoute,
  piRouteFrom,
  readHeadroomRoute,
  sameProxyEndpoint,
} from '../../extensions/shared/headroom-routing.ts';
import { routeOmpDefaultModel } from '../../extensions/shared/headroom-proxy.ts';
import { ensureAgentProviderRoute } from '../../extensions/shared/headroom-agent.ts';
import { sqliteAvailable, sqliteExec } from '../../extensions/shared/sqlite.ts';

const PROXY = 'http://127.0.0.1:8787/';
const MODELS = `providers:
  magpie:
    api: openai-completions
    baseUrl: http://127.0.0.1:3425/v1
    models:
    - contextWindow: 100000
      id: commandcode/deepseek/deepseek-v4.1-flash
      maxTokens: 384000
    - api: anthropic-messages
      baseUrl: http://127.0.0.1:3425
      id: kiro/claude-haiku-4.5
  anthropic:
    baseUrl: http://127.0.0.1:8787
    models:
    - id: claude-sonnet-4-5
`;

const CONFIG = `autoResume: true
modelRoles:
  default: commandcode/deepseek/deepseek-v4.1-flash:high
  task: claude-sonnet-4-5:low
`;

const previousAgentDir = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
});

function tempAgentDir(models: string, config: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tersio-headroom-routing-'));
  writeFileSync(path.join(dir, 'models.yml'), models, 'utf8');
  writeFileSync(path.join(dir, 'config.yml'), config, 'utf8');
  process.env.PI_CODING_AGENT_DIR = dir;
  return dir;
}

describe('omp route parsing', () => {
  test('reads provider and model-level base URLs for one model', () => {
    expect(ompModelRoute(MODELS, 'commandcode/deepseek/deepseek-v4.1-flash')).toEqual({ provider: 'magpie', baseUrl: 'http://127.0.0.1:3425/v1' });
    expect(ompModelRoute(MODELS, 'kiro/claude-haiku-4.5')).toEqual({ provider: 'magpie', baseUrl: 'http://127.0.0.1:3425' });
    expect(ompModelRoute(MODELS, 'claude-sonnet-4-5')).toEqual({ provider: 'anthropic', baseUrl: 'http://127.0.0.1:8787' });
  });

  test('reads the default role and strips an effort suffix only for lookup', () => {
    expect(defaultOmpModel(CONFIG)).toBe('commandcode/deepseek/deepseek-v4.1-flash:high');
    expect(ompModelRoute(MODELS, 'commandcode/deepseek/deepseek-v4.1-flash:high')?.provider).toBe('magpie');
    // The role may prefix the provider id; models.yml stores it without.
    expect(ompModelRoute(MODELS, 'magpie/commandcode/deepseek/deepseek-v4.1-flash:high')?.provider).toBe('magpie');
    expect(ompModelRoute(MODELS, 'claude-sonnet-4-5:max')?.provider).toBe('anthropic');
  });

  test('two loopback spellings on the same port are the same endpoint', () => {
    expect(sameProxyEndpoint('http://localhost:8787/v1', 'http://127.0.0.1:8787/')).toBe(true);
    expect(sameProxyEndpoint('http://127.0.0.1:3425', 'http://127.0.0.1:8787/')).toBe(false);
  });
});

describe('manual route parsing', () => {
  const piSettings = JSON.stringify({ defaultProvider: 'magpie', defaultModel: 'commandcode/deepseek/deepseek-v4.1-flash' });
  const piModels = JSON.stringify({ providers: { magpie: { baseUrl: 'http://127.0.0.1:3425/v1' } } });

  test('reads the Pi provider from its settings and model list', () => {
    const route = piRouteFrom(piSettings, piModels, 'pi', PROXY);
    expect(route.measured).toBe(true);
    expect(route.routed).toBe(false);
    expect(route.provider).toBe('magpie');
    expect(describeHeadroomRoute(route)).toContain('not routed');
  });

  test('falls back to the model prefix when no provider is named', () => {
    const route = piRouteFrom(JSON.stringify({ defaultModel: 'magpie/auto/beam-free' }), piModels, 'pi', PROXY);
    expect(route.provider).toBe('magpie');
    expect(route.measured).toBe(true);
  });

  test('reads dsh provider endpoints and the active profile provider', () => {
    const settings = `llm-pi-ai:
  providers:
    magpie:
      api: openai-completions
      baseURL: http://127.0.0.1:3425/v1
    headroom:
      api: openai-completions
      baseURL: http://127.0.0.1:8787/v1
`;
    const profile = `- id: agent-default-model # magpie
  config:
    provider: headroom
    model: auto/beam-free
- id: llm-pi-ai # magpie
  config:
    providers:
      headroom:
        baseURL: http://127.0.0.1:8787/v1 # the proxy
`;
    expect([...dshProviderBaseUrls(settings)]).toEqual([
      ['magpie', 'http://127.0.0.1:3425/v1'],
      ['headroom', 'http://127.0.0.1:8787/v1'],
    ]);
    expect([...dshProviderBaseUrls(profile)]).toEqual([['headroom', 'http://127.0.0.1:8787/v1']]);
    const route = dshRouteFrom(settings, profile, PROXY);
    expect(route.measured).toBe(true);
    expect(route.routed).toBe(true);
    expect(route.provider).toBe('headroom');
    expect(route.model).toBe('auto/beam-free');
  });

  test('reports an unmeasured dsh route when the profile names no provider', () => {
    const route = dshRouteFrom('llm-pi-ai:\n  providers:\n    magpie:\n      baseURL: http://127.0.0.1:3425/v1\n', '', PROXY);
    expect(route.measured).toBe(false);
    expect(describeHeadroomRoute(route)).toContain('route unknown');
  });
});

describe('Codex route parsing', () => {
  const config = `model = "commandcode/deepseek/deepseek-v4.1-flash"
openai_base_url = "http://127.0.0.1:3425/backend-api/codex"

[model_providers.headroom]
name = "OpenAI"
base_url = "http://127.0.0.1:8787/v1"
wire_api = "responses"
`;

  test('reads the active endpoint and recognizes the proxy', () => {
    expect(codexRouteFrom(`model = "gpt-6-luna"
model_provider = "headroom"
openai_base_url = "http://127.0.0.1:8787/v1"

[model_providers.headroom]
name = "OpenAI"
base_url = "http://127.0.0.1:8787/v1"
wire_api = "responses"
`, PROXY)).toMatchObject({
      model: 'gpt-6-luna',
      provider: 'headroom',
      baseUrl: 'http://127.0.0.1:8787/v1',
      routed: true,
    });
    const gateway = codexRouteFrom(config, PROXY);
    expect(gateway).toMatchObject({
      model: 'commandcode/deepseek/deepseek-v4.1-flash',
      provider: 'commandcode',
      baseUrl: 'http://127.0.0.1:3425/backend-api/codex',
      routed: false,
    });
  });
});

describe('readHeadroomRoute', () => {
  test('reports the default model as unrouted when its provider bypasses the proxy', () => {
    tempAgentDir(MODELS, CONFIG);
    const route = readHeadroomRoute('omp', PROXY);
    expect(route.measured).toBe(true);
    expect(route.routed).toBe(false);
    expect(route.provider).toBe('magpie');
    expect(describeHeadroomRoute(route)).toContain('not routed');
    expect(describeHeadroomRoute(route)).toContain('commandcode/deepseek/deepseek-v4.1-flash:high');
  });

  test('reports the default model as routed when its provider points at the proxy', () => {
    tempAgentDir(MODELS, 'modelRoles:\n  default: claude-sonnet-4-5\n');
    const route = readHeadroomRoute('omp', PROXY);
    expect(route.measured).toBe(true);
    expect(route.routed).toBe(true);
    expect(describeHeadroomRoute(route)).toContain('routed');
  });

  test('reports unknown when the agent config is absent', () => {
    process.env.PI_CODING_AGENT_DIR = path.join(os.tmpdir(), 'definitely-missing-headroom-route');
    const route = readHeadroomRoute('omp', PROXY);
    expect(route.measured).toBe(false);
    expect(describeHeadroomRoute(route)).toContain('route unknown');
  });

  test('reads the active OpenCode model and its provider base URL', () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'tersio-opencode-route-'));
    const previousHome = process.env.HOME;
    const previousProfile = process.env.USERPROFILE;
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    try {
      mkdirSync(path.join(home, '.config', 'opencode'), { recursive: true });
      writeFileSync(path.join(home, '.config', 'opencode', 'opencode.json'), JSON.stringify({
        model: 'headroom/gpt-4o',
        provider: { headroom: { options: { baseURL: 'http://127.0.0.1:8787/v1' } } },
      }), 'utf8');
      const route = readHeadroomRoute('opencode', PROXY);
      expect(route.measured).toBe(true);
      expect(route.routed).toBe(true);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousProfile;
    }
  });
});

describe('pi providers from the agent catalog', () => {
  const CATALOG = JSON.stringify({
    opencode: {
      models: [
        { id: 'beam-free', name: 'Beam Free', api: 'openai-completions', baseUrl: 'https://opencode.ai/inference/v1' },
      ],
    },
  });

  function tempPiHome(providers: Record<string, unknown>): string {
    const home = mkdtempSync(path.join(os.tmpdir(), 'tersio-pi-catalog-'));
    mkdirSync(path.join(home, '.pi', 'agent'), { recursive: true });
    writeFileSync(path.join(home, '.pi', 'agent', 'settings.json'), JSON.stringify({ defaultProvider: 'opencode', defaultModel: 'beam-free' }), 'utf8');
    writeFileSync(path.join(home, '.pi', 'agent', 'models.json'), JSON.stringify({ providers }), 'utf8');
    writeFileSync(path.join(home, '.pi', 'agent', 'models-store.json'), CATALOG, 'utf8');
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    return home;
  }

  const previousHome = process.env.HOME;
  const previousProfile = process.env.USERPROFILE;

  afterEach(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousProfile;
  });

  test('reads the catalog endpoint when models.json has no block for the provider', () => {
    tempPiHome({});
    const route = readHeadroomRoute('pi', PROXY);
    expect(route.measured).toBe(true);
    expect(route.provider).toBe('opencode');
    expect(route.baseUrl).toBe('https://opencode.ai/inference/v1');
    expect(route.routed).toBe(false);
    expect(describeHeadroomRoute(route)).toContain('not routed');
  });

  test('writes the provider block from the catalog so the switch can route it', () => {
    const home = tempPiHome({});
    expect(ensureAgentProviderRoute('pi', 8787)).toEqual({ ok: true, detail: 'pi: opencode written from its catalog' });
    const models = JSON.parse(readFileSync(path.join(home, '.pi', 'agent', 'models.json'), 'utf8')) as {
      providers: Record<string, { api: string; baseUrl: string; models: Array<{ id: string }> }>;
    };
    expect(models.providers.opencode?.api).toBe('openai-completions');
    expect(models.providers.opencode?.baseUrl).toBe('https://opencode.ai/inference/v1');
    expect(models.providers.opencode?.models.map((entry) => entry.id)).toEqual(['beam-free']);
    expect(ensureAgentProviderRoute('pi', 8787)).toEqual({ ok: true, detail: '' });
  });
});

describe('omp built-in providers', () => {
  const CACHE_SCHEMA = `create table model_cache (
  provider_id text primary key, version integer not null, updated_at integer not null,
  authoritative integer not null default 0, static_fingerprint text not null default '',
  models text not null, header_omitted_model_ids text not null default '[]',
  unrestorable_header_model_ids text not null default '[]', header_restore_version integer not null default 0,
  materialization_policy text not null default '', models_hash text not null default '');
insert into model_cache (provider_id, version, updated_at, models) values ('commandcode', 1, 0,
  '[{"id":"deepseek/deepseek-v4.1-flash","provider":"commandcode","api":"openai-completions","baseUrl":"https://api.commandcode.ai/provider/v1"}]');`;

  test('reads the provider from the omp catalog when models.yml has no block for it', () => {
    if (!sqliteAvailable()) return;
    const dir = tempAgentDir(MODELS, CONFIG);
    sqliteExec(path.join(dir, 'models.db'), CACHE_SCHEMA);
    const route = readHeadroomRoute('omp', PROXY);
    expect(route.measured).toBe(true);
    expect(route.provider).toBe('commandcode');
    expect(route.baseUrl).toBe('https://api.commandcode.ai/provider/v1');
    expect(route.routed).toBe(false);
  });

  test('writes the override block omp needs for a provider it keeps built-in', () => {
    if (!sqliteAvailable()) return;
    const dir = tempAgentDir(MODELS, CONFIG);
    sqliteExec(path.join(dir, 'models.db'), CACHE_SCHEMA);
    expect(routeOmpDefaultModel(8787)).toBe(true);
    const written = readFileSync(path.join(dir, 'models.yml'), 'utf8');
    expect(written).toContain('  commandcode:\n    api: openai-completions\n');
    expect(written).toContain('# tersio-headroom-upstream: https://api.commandcode.ai/provider/v1');
    expect(readHeadroomRoute('omp', PROXY).routed).toBe(true);
  });
});
