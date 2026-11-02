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

test('the local OpenAI gateway is found and routed through Headroom', () => {
  withHome((home) => {
    const file = path.join(home, '.omp', 'agent', 'models.yml');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, MODELS, 'utf8');
    expect(readOmpGateway(8787)).toEqual({ provider: 'magpie', baseUrl: 'http://127.0.0.1:3425/v1' });
    expect(routeOmpGateway({ provider: 'magpie', baseUrl: 'http://127.0.0.1:3425/v1' }, 8787)).toBe(true);
    const routed = readFileSync(file, 'utf8');
    expect(routed).toContain('baseUrl: http://127.0.0.1:8787/v1');
    expect(routed).toContain('# tersio-headroom-upstream: http://127.0.0.1:3425/v1');
    // The marker keeps the original gateway readable after the rewrite.
    expect(readOmpGateway(8787)).toEqual({ provider: 'magpie', baseUrl: 'http://127.0.0.1:3425/v1' });
    // Reapplying is idempotent.
    expect(routeOmpGateway({ provider: 'magpie', baseUrl: 'http://127.0.0.1:3425/v1' }, 8787)).toBe(true);
    expect((readFileSync(file, 'utf8').match(/tersio-headroom-upstream/g) ?? []).length).toBe(1);
  });
});

test('an already-routed config has no second local gateway to patch', () => {
  withHome((home) => {
    const file = path.join(home, '.omp', 'agent', 'models.yml');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, MODELS.replace('http://127.0.0.1:3425/v1', 'http://127.0.0.1:8787/v1'), 'utf8');
    expect(readOmpGateway(8787)).toBeNull();
    expect(routeOmpGateway({ provider: 'magpie', baseUrl: 'http://127.0.0.1:3425/v1' }, 8787)).toBe(true);
  });
});
