import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import codegraphExtension from '../../extensions/codegraph/omp.ts';
import { ensureInitializedAndWatching } from '../../extensions/codegraph/client.ts';
import type { ExtensionApi, ExtensionCtx } from '../../extensions/shared/types.ts';
import { withHome } from '../helpers/env.ts';

vi.mock('../../extensions/codegraph/client.ts', () => ({
  ensureInitializedAndWatching: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
  exploreSymbol: vi.fn<() => void>(),
  getCodeGraphStatus: vi.fn<() => void>(),
  indexCodeGraph: vi.fn<() => void>(),
  onToolFinished: vi.fn<() => void>(),
  stopWatching: vi.fn<() => void>(),
  syncCodeGraph: vi.fn<() => void>(),
}));

test('OMP respects its own CodeGraph setting over the global setting', async () => {
  await withHome(async (home) => {
    const project = path.join(home, 'project');
    const settings = path.join(home, '.tersio', 'settings.json');
    mkdirSync(path.join(project, '.git'), { recursive: true });
    mkdirSync(path.dirname(settings), { recursive: true });
    const handlers = new Map<string, (event: unknown, ctx: ExtensionCtx) => unknown>();
    const pi: ExtensionApi = {
      zod: { z: {} },
      on<E>(event: string, handler: (event: E, ctx: ExtensionCtx) => unknown) {
        handlers.set(event, (value, ctx) => handler(value as E, ctx));
      },
    };
    codegraphExtension(pi);
    const start = handlers.get('session_start');
    if (!start) throw new Error('session_start was not registered');
    const ctx: ExtensionCtx = { cwd: project };

    writeFileSync(settings, JSON.stringify({ codegraphDefault: 'on', hosts: { omp: { codegraphDefault: 'off' } } }));
    await start({}, ctx);
    expect(ensureInitializedAndWatching).not.toHaveBeenCalled();

    writeFileSync(settings, JSON.stringify({ codegraphDefault: 'off', hosts: { omp: { codegraphDefault: 'on' } } }));
    await start({}, ctx);
    expect(ensureInitializedAndWatching).toHaveBeenCalledOnce();
  });
});
