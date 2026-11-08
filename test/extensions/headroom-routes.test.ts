import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { withHome } from '../helpers/env.ts';
import { readHeadroomRoute } from '../../extensions/shared/headroom-routing.ts';
import {
  headroomRoutedHosts,
  hasNativeRoute,
  repairHeadroomRoute,
  installNativeRoute,
  inferCodexRootBackup,
  nativeProxyUrl,
  removeTomlSection,
  removeNativeRoute,
  restoreCodexRoot,
  setTomlSectionValue,
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

function headroomManifest(home: string, env: Record<string, string>): string {
  const deploy = path.join(home, '.headroom', 'deploy', 'init');
  mkdirSync(deploy, { recursive: true });
  const file = path.join(deploy, 'manifest.json');
  writeFileSync(file, JSON.stringify({ updated_at: '2026-01-01T00:00:00Z', base_env: env }), 'utf8');
  return file;
}

function piHome(home: string): void {
  piLikeHome(path.join(home, '.pi', 'agent'));
  headroomManifest(home, { OPENAI_TARGET_API_URL: 'http://127.0.0.1:3425/v1' });
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
  test('Codex unwrap restores the provider keys Headroom replaced', () => {
    const text = `model = "gpt-6-luna"

# --- Headroom init provider ---
model_provider = "headroom"
openai_base_url = "http://127.0.0.1:8787/v1"

[features]
hooks = true
`;
    expect(restoreCodexRoot(text, {
      modelProvider: null,
      modelProviderPresent: false,
      openaiBaseUrl: 'http://127.0.0.1:3425/backend-api/codex',
      openaiBaseUrlPresent: true,
    })).toBe(`model = "gpt-6-luna"

# --- Headroom init provider ---

openai_base_url = "http://127.0.0.1:3425/backend-api/codex"
[features]
hooks = true
`);
    expect(setTomlSectionValue(text, 'model_providers.magpie', 'base_url', 'http://127.0.0.1:8787/v1')).toContain(
      '[model_providers.magpie]\nbase_url = "http://127.0.0.1:8787/v1"',
    );
  });

  test('Codex never invents a reserved openai provider block', () => {
    const text = `model = "commandcode/deepseek/deepseek-v4.1-flash"
openai_base_url = "http://127.0.0.1:3425/backend-api/codex"

[features]
hooks = true
`;
    // No model_provider means Codex's built-in OpenAI route; `openai_base_url` is the only safe switch.
    expect(inferCodexRootBackup(text)).toMatchObject({
      modelProvider: null,
      modelProviderPresent: false,
      provider: null,
      providerBaseUrl: null,
    });
    expect(inferCodexRootBackup(text.replace('model =', 'model_provider = "openai"\nmodel ='))).toMatchObject({
      provider: null,
    });
    const invalid = `${text}\n[model_providers.openai]\nbase_url = "http://127.0.0.1:8787/v1"\n\n[features]\nhooks = true\n`;
    expect(removeTomlSection(invalid, 'model_providers.openai')).not.toContain('[model_providers.openai]');
  });

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

  test('routes a Pi model that names its own endpoint', () => withHome((home) => {
    piHome(home);
    const modelsFile = path.join(home, '.pi', 'agent', 'models.json');
    const data = JSON.parse(readFileSync(modelsFile, 'utf8'));
    // The model's own endpoint wins over the provider's, so it has to move too.
    data.providers.magpie.models = [{ id: 'commandcode/deepseek/deepseek-v4.1-flash', baseUrl: 'http://127.0.0.1:3425/v1' }];
    writeFileSync(modelsFile, JSON.stringify(data, null, 2), 'utf8');

    expect(readHeadroomRoute('pi', PROXY).routed).toBe(false);
    expect(installNativeRoute('pi', PROXY).ok).toBe(true);
    const routed = JSON.parse(readFileSync(modelsFile, 'utf8')).providers.magpie;
    expect(routed.baseUrl).toBe('http://127.0.0.1:8787/v1');
    expect(routed.models[0].baseUrl).toBe('http://127.0.0.1:8787/v1');
    expect(readHeadroomRoute('pi', PROXY).routed).toBe(true);

    expect(removeNativeRoute('pi').ok).toBe(true);
    const restored = JSON.parse(readFileSync(modelsFile, 'utf8')).providers.magpie;
    expect(restored.baseUrl).toBe('http://127.0.0.1:3425/v1');
    expect(restored.models[0].baseUrl).toBe('http://127.0.0.1:3425/v1');
  }));

  test('refuses a model endpoint that is a different service', () => withHome((home) => {
    piHome(home);
    const modelsFile = path.join(home, '.pi', 'agent', 'models.json');
    const data = JSON.parse(readFileSync(modelsFile, 'utf8'));
    data.providers.magpie.models = [{ id: 'commandcode/deepseek/deepseek-v4.1-flash', baseUrl: 'http://10.0.0.9:9999/v1' }];
    writeFileSync(modelsFile, JSON.stringify(data, null, 2), 'utf8');
    const refused = installNativeRoute('pi', PROXY);
    expect(refused.ok).toBe(false);
    expect(refused.detail).toContain('different service');
    expect(JSON.parse(readFileSync(modelsFile, 'utf8')).providers.magpie.baseUrl).toBe('http://127.0.0.1:3425/v1');
  }));

  test('a rewrite by another writer clears the record instead of fighting it', () => withHome((home) => {
    piHome(home);
    expect(installNativeRoute('pi', PROXY).ok).toBe(true);
    const modelsFile = path.join(home, '.pi', 'agent', 'models.json');
    const data = JSON.parse(readFileSync(modelsFile, 'utf8'));
    // A gateway reconnected and put its own endpoint back.
    data.providers.magpie.baseUrl = 'http://127.0.0.1:3425/v1';
    writeFileSync(modelsFile, JSON.stringify(data, null, 2), 'utf8');

    expect(removeNativeRoute('pi').ok).toBe(true);
    expect(hasNativeRoute('pi')).toBe(false);
    expect(JSON.parse(readFileSync(modelsFile, 'utf8')).providers.magpie.baseUrl).toBe('http://127.0.0.1:3425/v1');

    // The next install routes it again, so drift is one command away from repair.
    expect(installNativeRoute('pi', PROXY).ok).toBe(true);
    expect(readHeadroomRoute('pi', PROXY).routed).toBe(true);
  }));

  test('routes PiG from its own agent directory', () => withHome((home) => {
    const dir = path.join(home, '.pig', 'agent');
    const previousDir = process.env.PIG_CODING_AGENT_DIR;
    process.env.PIG_CODING_AGENT_DIR = dir;
    try {
      piLikeHome(dir);
      headroomManifest(home, { OPENAI_TARGET_API_URL: 'http://127.0.0.1:3425/v1' });
      const routed = installNativeRoute('pig', PROXY);
      expect(routed.ok).toBe(true);
      const modelsFile = path.join(dir, 'models.json');
      expect(JSON.parse(readFileSync(modelsFile, 'utf8')).providers.magpie.baseUrl).toBe('http://127.0.0.1:8787/v1');
      expect(readHeadroomRoute('pig', PROXY).routed).toBe(true);
      expect(removeNativeRoute('pig').ok).toBe(true);
      expect(JSON.parse(readFileSync(modelsFile, 'utf8')).providers.magpie.baseUrl).toBe('http://127.0.0.1:3425/v1');
    } finally {
      if (previousDir === undefined) delete process.env.PIG_CODING_AGENT_DIR;
      else process.env.PIG_CODING_AGENT_DIR = previousDir;
    }
  }));

  test('routes every dsh file that owns the active provider', () => withHome((home) => {
    dshHome(home);
    headroomManifest(home, { OPENAI_TARGET_API_URL: 'http://127.0.0.1:3425/v1' });
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

  test('refuses a route when Headroom forwards to another provider', () => withHome((home) => {
    piHome(home);
    expect(installNativeRoute('pi', PROXY).ok).toBe(true);
    expect(removeNativeRoute('pi').ok).toBe(true);

    headroomManifest(home, { OPENAI_TARGET_API_URL: 'http://127.0.0.1:9999/v1' });
    const refused = installNativeRoute('pi', PROXY);
    expect(refused.ok).toBe(false);
    expect(refused.detail).toContain('not Headroom');
    const models = JSON.parse(readFileSync(path.join(home, '.pi', 'agent', 'models.json'), 'utf8'));
    expect(models.providers.magpie.baseUrl).toBe('http://127.0.0.1:3425/v1');
  }));

  test('refuses an Anthropic route when Headroom names no Anthropic upstream', () => withHome((home) => {
    piHome(home);
    const modelsFile = path.join(home, '.pi', 'agent', 'models.json');
    const data = JSON.parse(readFileSync(modelsFile, 'utf8'));
    data.providers.magpie = { api: 'anthropic-messages', baseUrl: 'http://127.0.0.1:3425' };
    writeFileSync(modelsFile, JSON.stringify(data, null, 2), 'utf8');
    // The manifest only names the OpenAI upstream, so Anthropic traffic would leave for the default API.
    const refused = installNativeRoute('pi', PROXY);
    expect(refused.ok).toBe(false);
    expect(refused.detail).toContain('--anthropic-api-url');
    expect(JSON.parse(readFileSync(modelsFile, 'utf8')).providers.magpie.baseUrl).toBe('http://127.0.0.1:3425');

    headroomManifest(home, { ANTHROPIC_TARGET_API_URL: 'http://127.0.0.1:3425' });
    expect(installNativeRoute('pi', PROXY).ok).toBe(true);
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

test("a durable host with no headroom block is never invented by the repair", async () => {
  await withHome(async (home) => {
    const omp = path.join(home, ".omp", "agent");
    mkdirSync(omp, { recursive: true });
    // A gateway points the agent at itself and headroom never wrote a block here.
    writeFileSync(path.join(omp, "models.yml"), "providers:\n  magpie:\n    baseUrl: http://127.0.0.1:3425/v1\n    models:\n    - id: demo-model\n", "utf8");
    writeFileSync(path.join(omp, "config.yml"), "modelRoles:\n  default: magpie/demo-model\n", "utf8");
    const previousUrl = process.env.TERSIO_HEADROOM_PROXY_URL;
    process.env.TERSIO_HEADROOM_PROXY_URL = PROXY;
    try {
      const before = readFileSync(path.join(omp, "models.yml"), "utf8");
      const result = await repairHeadroomRoute("omp");
      expect(result.ok).toBe(false);
      expect(readFileSync(path.join(omp, "models.yml"), "utf8")).toBe(before);
    } finally {
      if (previousUrl === undefined) delete process.env.TERSIO_HEADROOM_PROXY_URL;
      else process.env.TERSIO_HEADROOM_PROXY_URL = previousUrl;
    }
  });
});

test('the machine knows which agents a shared proxy is already serving', () => withHome((home) => {
  piHome(home);
  expect(headroomRoutedHosts()).toEqual([]);
  expect(installNativeRoute('pi', PROXY).ok).toBe(true);
  expect(headroomRoutedHosts()).toEqual(['pi']);
  // A repointing change asks what it would break, not counting itself.
  expect(headroomRoutedHosts('pi')).toEqual([]);
  expect(removeNativeRoute('pi').ok).toBe(true);
  expect(headroomRoutedHosts()).toEqual([]);
}));
