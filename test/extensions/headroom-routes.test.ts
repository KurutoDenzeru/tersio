import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { withHome } from '../helpers/env.ts';
import { readHeadroomRoute } from '../../extensions/shared/headroom-routing.ts';
import {
  hasNativeRoute,
  installNativeRoute,
  nativeProxyUrl,
  removeNativeRoute,
} from '../../extensions/shared/headroom-routes.ts';

const PROXY = 'http://127.0.0.1:8787/';

function piLikeHome(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({
    defaultProvider: 'magpie',
    defaultModel: 'commandcode/deepseek/deepseek-v4.1-flash',
  }), 'utf8');
  writeFileSync(path.join(dir, 'models.json'), JSON.stringify({
    providers: { magpie: { api: 'openai-completions', baseUrl: 'http://127.0.0.1:3425/v1' } },
  }, null, 2), 'utf8');
}

function piHome(home: string): void {
  piLikeHome(path.join(home, '.pi', 'agent'));
}

function dshHome(home: string): void {
  const root = path.join(home, '.dsh');
  mkdirSync(path.join(root, 'profiles', 'desktop'), { recursive: true });
  writeFileSync(path.join(root, 'settings.yaml'), `llm-pi-ai:
  providers:
    magpie:
      api: openai-completions
      baseURL: http://127.0.0.1:3425/v1
`, 'utf8');
  writeFileSync(path.join(root, 'profiles', 'desktop', 'cordis.patch.yml'), `- id: agent-default-model # magpie
  config:
    provider: magpie
    model: auto/beam-free
- id: llm-pi-ai # magpie
  config:
    providers:
      magpie:
        api: openai-completions
        baseURL: http://127.0.0.1:3425/v1
`, 'utf8');
}

describe('native headroom routes', () => {
  test('routes Pi and puts the endpoint back', () => withHome((home) => {
    piHome(home);
    const routed = installNativeRoute('pi', PROXY);
    expect(routed.ok).toBe(true);
    const modelsFile = path.join(home, '.pi', 'agent', 'models.json');
    expect(JSON.parse(readFileSync(modelsFile, 'utf8')).providers.magpie.baseUrl).toBe('http://127.0.0.1:8787/v1');
    expect(readHeadroomRoute('pi', PROXY).routed).toBe(true);
    expect(hasNativeRoute('pi')).toBe(true);

    const removed = removeNativeRoute('pi');
    expect(removed.ok).toBe(true);
    expect(JSON.parse(readFileSync(modelsFile, 'utf8')).providers.magpie.baseUrl).toBe('http://127.0.0.1:3425/v1');
    expect(hasNativeRoute('pi')).toBe(false);
  }));

  test('routes PiG from its own agent directory', () => withHome((home) => {
    const dir = path.join(home, '.pig', 'agent');
    piLikeHome(dir);
    const routed = installNativeRoute('pig', PROXY);
    expect(routed.ok).toBe(true);
    const modelsFile = path.join(dir, 'models.json');
    expect(JSON.parse(readFileSync(modelsFile, 'utf8')).providers.magpie.baseUrl).toBe('http://127.0.0.1:8787/v1');
    expect(readHeadroomRoute('pig', PROXY).routed).toBe(true);
    expect(removeNativeRoute('pig').ok).toBe(true);
    expect(JSON.parse(readFileSync(modelsFile, 'utf8')).providers.magpie.baseUrl).toBe('http://127.0.0.1:3425/v1');
  }));

  test('routes every dsh file that owns the active provider', () => withHome((home) => {
    dshHome(home);
    const routed = installNativeRoute('dsh', PROXY);
    expect(routed.ok).toBe(true);
    const settings = readFileSync(path.join(home, '.dsh', 'settings.yaml'), 'utf8');
    const profile = readFileSync(path.join(home, '.dsh', 'profiles', 'desktop', 'cordis.patch.yml'), 'utf8');
    expect(settings).toContain('baseURL: http://127.0.0.1:8787/v1');
    expect(profile).toContain('baseURL: http://127.0.0.1:8787/v1');
    expect(readHeadroomRoute('dsh', PROXY).routed).toBe(true);

    const removed = removeNativeRoute('dsh');
    expect(removed.ok).toBe(true);
    expect(readFileSync(path.join(home, '.dsh', 'settings.yaml'), 'utf8')).toContain('baseURL: http://127.0.0.1:3425/v1');
    expect(readFileSync(path.join(home, '.dsh', 'profiles', 'desktop', 'cordis.patch.yml'), 'utf8')).toContain('baseURL: http://127.0.0.1:3425/v1');
  }));

  test('Anthropic providers use the proxy root', () => {
    expect(nativeProxyUrl('anthropic-messages', PROXY)).toBe('http://127.0.0.1:8787');
    expect(nativeProxyUrl('openai-completions', PROXY)).toBe('http://127.0.0.1:8787/v1');
  });

  test('leaves a hand-set route alone when Tersio has no record', () => withHome((home) => {
    piHome(home);
    const modelsFile = path.join(home, '.pi', 'agent', 'models.json');
    const data = JSON.parse(readFileSync(modelsFile, 'utf8'));
    data.providers.magpie.baseUrl = 'http://127.0.0.1:8787/v1';
    writeFileSync(modelsFile, JSON.stringify(data, null, 2), 'utf8');
    expect(removeNativeRoute('pi').ok).toBe(true);
    expect(JSON.parse(readFileSync(modelsFile, 'utf8')).providers.magpie.baseUrl).toBe('http://127.0.0.1:8787/v1');
  }));
});
