// The Claude mod reads settings, writes stop phrases, and tells the model when a mode turns off.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { register } from '../../plugins/claude/hooks/register.ts';

interface FakeDollar {
  env: { get(name: string): Promise<unknown> };
  fs: {
    exists(file: string): Promise<boolean>;
    read(file: string): Promise<unknown>;
    write(file: string, text: string): Promise<unknown>;
  };
}

test('normal mode writes the off defaults and tells the model', async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'tersio-claude-hook-'));
  try {
    const tersio = path.join(home, '.tersio');
    const claude = path.join(home, '.claude');
    const plugin = path.join(home, 'plugin');
    mkdirSync(tersio, { recursive: true });
    mkdirSync(path.join(plugin, 'hooks'), { recursive: true });
    const settingsFile = path.join(tersio, 'settings.json');
    const files = new Map<string, string>([
      [
        settingsFile,
        JSON.stringify({
          hosts: { claude: { cavemanDefault: 'full', ponytailDefault: 'full', pstackDefault: 'on' } },
        }),
      ],
      [
        path.join(plugin, 'hooks', 'mode-context.json'),
        JSON.stringify({
          caveman: { full: 'CAVEMAN RULES' },
          ponytail: { full: 'PONYTAIL RULES' },
          pstack: 'PSTACK RULES',
        }),
      ],
    ]);
    const env: Record<string, string> = {
      HOME: home,
      TERSIO_HOME: tersio,
      CLAUDE_CONFIG_DIR: claude,
      CLAUDE_PLUGIN_ROOT: plugin,
    };
    const dollar: FakeDollar = {
      env: { get: async (name) => env[name] },
      fs: {
        exists: async (file) => files.has(file),
        read: async (file) => files.get(file),
        write: async (file, text) => {
          files.set(file, text);
        },
      },
    };
    const handlers: Record<string, unknown> = {};
    register(((event: string, matcherOrHook: unknown, maybeHook?: unknown) => {
      const handler = typeof maybeHook === 'function' ? maybeHook : matcherOrHook;
      if (typeof handler === 'function') handlers[event] = handler;
    }) as never);
    const prompt = handlers['prompt.submit'] as (
      dollar: FakeDollar,
      event: Record<string, unknown>,
      next: (value: unknown) => unknown,
    ) => Promise<unknown>;
    const first = await prompt(dollar, { text: 'hello' }, (value) => value);
    expect(JSON.stringify(first)).toContain('CAVEMAN RULES');
    const second = await prompt(dollar, { text: 'normal mode' }, (value) => value);
    expect(JSON.stringify(second)).toContain('now off');
    const saved = JSON.parse(files.get(settingsFile) ?? '{}') as {
      hosts?: { claude?: Record<string, string> };
    };
    expect(saved.hosts?.claude?.cavemanDefault).toBe('off');
    expect(saved.hosts?.claude?.ponytailDefault).toBe('off');
    expect(saved.hosts?.claude?.pstackDefault).toBe('off');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
