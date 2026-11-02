import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  defaultOmpModel,
  describeHeadroomRoute,
  ompModelRoute,
  readHeadroomRoute,
  sameProxyEndpoint,
} from '../../extensions/shared/headroom-routing.ts';

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
