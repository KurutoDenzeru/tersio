import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { readOmpGateway, routeOmpGateway } from '../../extensions/shared/headroom-proxy.ts';
import { withHome } from '../helpers/env.ts';

const MODELS = `providers:
  magpie:
    api: openai-completions
    auth: none
    baseUrl: http://127.0.0.1:3425/v1
    headers:
      User-Agent: omp
    models:
    - id: model-one
  anthropic:
    baseUrl: http://127.0.0.1:8787
`;

// Two local gateways: only the role's own provider may move.
const TWO_GATEWAYS = `providers:
  lmstudio:
    api: openai-completions
    baseUrl: http://127.0.0.1:1234/v1
    models:
    - id: some-local-model
  magpie:
    api: openai-completions
    baseUrl: http://127.0.0.1:3425/v1
    models:
    - id: commandcode/deepseek/deepseek-v4.1-flash
`;

const CONFIG = `modelRoles:
  default: commandcode/deepseek/deepseek-v4.1-flash:high
  tiny: commandcode/poolside/laguna-s-2.1-free:minimal
`;

// A model block names its endpoint before its id, the way omp writes it.
const MODEL_OVERRIDE = `providers:
  magpie:
    api: openai-completions
    baseUrl: http://127.0.0.1:3425/v1
    models:
    - api: openai-completions
      baseUrl: http://127.0.0.1:3425
      contextWindow: 200000
      id: commandcode/deepseek/deepseek-v4.1-flash
    - api: openai-completions
      baseUrl: http://127.0.0.1:1234/v1
      id: other-model
`;

function writeOmp(home: string, models: string, config?: string): string {
  const file = path.join(home, '.omp', 'agent', 'models.yml');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, models, 'utf8');
  if (config) writeFileSync(path.join(home, '.omp', 'agent', 'config.yml'), config, 'utf8');
  return file;
}

test('the local OpenAI gateway is found and routed through Headroom', () => {
  withHome((home) => {
    const file = writeOmp(home, MODELS);
    expect(readOmpGateway(8787)).toEqual({ provider: 'magpie', baseUrl: 'http://127.0.0.1:3425/v1', model: null });
    expect(routeOmpGateway({ provider: 'magpie', baseUrl: 'http://127.0.0.1:3425/v1', model: null }, 8787)).toBe(true);
    const routed = readFileSync(file, 'utf8');
    expect(routed).toContain('baseUrl: http://127.0.0.1:8787/v1');
    expect(routed).toContain('# tersio-headroom-upstream: http://127.0.0.1:3425/v1');
    // The marker keeps the original gateway readable after the rewrite.
    expect(readOmpGateway(8787)).toEqual({ provider: 'magpie', baseUrl: 'http://127.0.0.1:3425/v1', model: null });
    // Reapplying is idempotent.
    expect(routeOmpGateway({ provider: 'magpie', baseUrl: 'http://127.0.0.1:3425/v1', model: null }, 8787)).toBe(true);
    expect((readFileSync(file, 'utf8').match(/tersio-headroom-upstream/g) ?? []).length).toBe(1);
  });
});

test('an already-routed config has no second local gateway to patch', () => {
  withHome((home) => {
    const file = writeOmp(home, MODELS.replace('http://127.0.0.1:3425/v1', 'http://127.0.0.1:8787/v1'));
    expect(readOmpGateway(8787)).toBeNull();
    expect(routeOmpGateway({ provider: 'magpie', baseUrl: 'http://127.0.0.1:3425/v1', model: null }, 8787)).toBe(true);
    expect(readFileSync(file, 'utf8')).toContain('baseUrl: http://127.0.0.1:8787/v1');
  });
});

test('the active role picks its own gateway, not the first one in the file', () => {
  withHome((home) => {
    writeOmp(home, TWO_GATEWAYS, CONFIG);
    expect(readOmpGateway(8787)).toEqual({
      provider: 'magpie',
      baseUrl: 'http://127.0.0.1:3425/v1',
      model: 'commandcode/deepseek/deepseek-v4.1-flash:high',
    });
  });
});

test('a model with its own endpoint is routed beside the provider line', () => {
  withHome((home) => {
    const file = writeOmp(home, MODEL_OVERRIDE, CONFIG);
    const gateway = readOmpGateway(8787);
    expect(gateway?.model).toBe('commandcode/deepseek/deepseek-v4.1-flash:high');
    expect(gateway && routeOmpGateway(gateway, 8787)).toBe(true);
    const routed = readFileSync(file, 'utf8');
    // Both the provider line and the active model's own endpoint reach the proxy.
    expect(routed.match(/baseUrl: http:\/\/127\.0\.0\.1:8787\/v1/g) ?? []).toHaveLength(2);
    // Another model's endpoint stays where it was.
    expect(routed).toContain('baseUrl: http://127.0.0.1:1234/v1');
  });
});
