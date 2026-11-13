import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import {
  readOmpGateway,
  restoreOmpGateway,
  routeOmpDefaultModel,
  routeOmpGateway,
  routeOmpModel,
} from '../../extensions/shared/headroom-proxy.ts';
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

test('an Anthropic provider moves to the proxy root', () => {
  withHome((home) => {
    const file = writeOmp(
      home,
      'providers:\n  anthropic:\n    baseUrl: http://127.0.0.1:3425\n',
      'modelRoles:\n  default: anthropic/claude-haiku-5-5\n',
    );
    const gateway = readOmpGateway(8787);
    expect(gateway).toEqual({
      provider: 'anthropic',
      baseUrl: 'http://127.0.0.1:3425',
      model: 'anthropic/claude-haiku-5-5',
    });
    expect(gateway && routeOmpGateway(gateway, 8787)).toBe(true);
    const routed = readFileSync(file, 'utf8');
    expect(routed).toContain('baseUrl: http://127.0.0.1:8787\n');
    expect(routed).not.toContain('baseUrl: http://127.0.0.1:8787/v1');
    expect(restoreOmpGateway(8787)).toBe(true);
  });
});

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

test('turning the route off puts the gateway line back and drops the marker', () => {
  withHome((home) => {
    const file = writeOmp(home, MODELS);
    expect(routeOmpGateway({ provider: 'magpie', baseUrl: 'http://127.0.0.1:3425/v1', model: null }, 8787)).toBe(true);
    expect(restoreOmpGateway(8787)).toBe(true);
    const restored = readFileSync(file, 'utf8');
    expect(restored).toContain('baseUrl: http://127.0.0.1:3425/v1');
    expect(restored).not.toContain('tersio-headroom-upstream');
    // A second switch-off finds nothing of ours to move.
    expect(restoreOmpGateway(8787)).toBe(false);
  });
});

test('a gateway the user moved after routing is left alone', () => {
  withHome((home) => {
    const file = writeOmp(home, MODELS);
    expect(routeOmpGateway({ provider: 'magpie', baseUrl: 'http://127.0.0.1:3425/v1', model: null }, 8787)).toBe(true);
    // Something else rewrote the line after Tersio: the marker is stale, so the value wins.
    writeFileSync(
      file,
      readFileSync(file, 'utf8').replace('baseUrl: http://127.0.0.1:8787/v1', 'baseUrl: http://127.0.0.1:5555/v1'),
      'utf8',
    );
    expect(restoreOmpGateway(8787)).toBe(false);
    expect(readFileSync(file, 'utf8')).toContain('http://127.0.0.1:5555/v1');
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

test('routeOmpDefaultModel creates models.yml scaffold when missing and routes the provider', () => {
  withHome((home) => {
    const configDir = path.join(home, '.omp', 'agent');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      path.join(configDir, 'config.yml'),
      'modelRoles:\n  default: anthropic/claude-haiku-5-5\n',
      'utf8',
    );
    const modelsFile = path.join(configDir, 'models.yml');
    expect(existsSync(modelsFile)).toBe(false);
    routeOmpDefaultModel(8787);
    expect(existsSync(modelsFile)).toBe(true);
    expect(readFileSync(modelsFile, 'utf8')).toContain('providers:\n');
  });
});

test('routeOmpDefaultModel re-routes an existing provider block whose baseUrl is not yet the proxy', () => {
  withHome((home) => {
    const file = writeOmp(
      home,
      'providers:\n  anthropic:\n    api: anthropic-messages\n    baseUrl: https://api.anthropic.com\n',
      'modelRoles:\n  default: anthropic/claude-haiku-5-5\n',
    );
    expect(routeOmpDefaultModel(8787)).toBe(true);
    const routed = readFileSync(file, 'utf8');
    expect(routed).toContain('baseUrl: http://127.0.0.1:8787\n');
    expect(routed).toContain('# tersio-headroom-upstream: https://api.anthropic.com');
  });
});

test('routeOmpDefaultModel universally routes across dialects: gemini-cli, anthropic, openai-completions, openai-responses', () => {
  withHome((home) => {
    const file = writeOmp(
      home,
      `providers:
  google-antigravity:
    api: google-gemini-cli
    baseUrl: https://daily-cloudcode-pa.googleapis.com
  commandcode:
    api: anthropic-messages
    baseUrl: https://api.commandcode.ai/provider
  kilo:
    api: openai-completions
    baseUrl: https://api.kilo.ai/api/gateway
  opencode-go:
    api: openai-responses
    baseUrl: https://opencode.ai/zen/go/v1
`,
      `modelRoles:
  default: commandcode/claude-sonnet-5-5:medium
  image: google-antigravity/gemini-3.8-flash
  code: kilo/claude-3-7-sonnet
  fast: opencode-go/deepseek-r1
`,
    );
    expect(routeOmpDefaultModel(8787)).toBe(true);
    const routed = readFileSync(file, 'utf8');
    // Anthropic and Gemini route to proxy root (empty proxy path)
    expect(routed).toContain('# tersio-headroom-upstream: https://daily-cloudcode-pa.googleapis.com');
    expect(routed).toContain('# tersio-headroom-upstream: https://api.commandcode.ai/provider');
    expect((routed.match(/baseUrl: http:\/\/127\.0\.0\.1:8787\n/g) ?? []).length).toBe(2);
    // OpenAI-completions and OpenAI-responses route to /v1
    expect(routed).toContain('# tersio-headroom-upstream: https://api.kilo.ai/api/gateway');
    expect(routed).toContain('# tersio-headroom-upstream: https://opencode.ai/zen/go/v1');
    expect((routed.match(/baseUrl: http:\/\/127\.0\.0\.1:8787\/v1\n/g) ?? []).length).toBe(2);

    // Restore puts all four upstream URLs back and drops all markers
    expect(restoreOmpGateway(8787)).toBe(true);
    const restored = readFileSync(file, 'utf8');
    expect(restored).toContain('baseUrl: https://daily-cloudcode-pa.googleapis.com');
    expect(restored).toContain('baseUrl: https://api.commandcode.ai/provider');
    expect(restored).toContain('baseUrl: https://api.kilo.ai/api/gateway');
    expect(restored).toContain('baseUrl: https://opencode.ai/zen/go/v1');
    expect(restored).not.toContain('tersio-headroom-upstream');
  });
});

test('routeOmpModel routes an ad-hoc model on demand without touching config.yml', () => {
  withHome((home) => {
    const file = writeOmp(
      home,
      `providers:
  commandcode:
    api: anthropic-messages
    baseUrl: http://127.0.0.1:8787
`,
    );
    // An ad-hoc model from a provider not yet in models.yml
    expect(routeOmpModel('kilo/any-future-model', 8787)).toBe(false); // models.db is empty in test fixture without seeding
    // But with an existing block, it safely re-routes to proxy
    writeFileSync(
      file,
      `providers:
  new-provider:
    api: openai-completions
    baseUrl: https://api.future-provider.ai/v1
`,
      'utf8',
    );
    expect(routeOmpModel('new-provider/some-model', 8787)).toBe(true);
    const routed = readFileSync(file, 'utf8');
    expect(routed).toContain('baseUrl: http://127.0.0.1:8787/v1\n');
    expect(routed).toContain('# tersio-headroom-upstream: https://api.future-provider.ai/v1');
  });
});
