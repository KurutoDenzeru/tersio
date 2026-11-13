import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import tersioCommandsExtension from '../../extensions/commands/index.ts';
import { readStatusVisible, saveStatusVisible } from '../../extensions/shared/plugin-settings.ts';
import { announceStatus, bindStatusHost } from '../../extensions/shared/status.ts';
import type { ExtensionApi, ExtensionCtx } from '../../extensions/shared/types.ts';

let home: string;
const prev = process.env.TERSIO_HOME;
beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), 'tersio-status-'));
  process.env.TERSIO_HOME = home;
});
afterEach(() => {
  if (prev === undefined) delete process.env.TERSIO_HOME;
  else process.env.TERSIO_HOME = prev;
  rmSync(home, { recursive: true, force: true });
});

test('status shows by default, hides per host, and repaints when shown again', () => {
  const calls: Array<string | undefined> = [];
  const ctx = { ui: { setStatus: (_k: string, v: string | undefined) => calls.push(v) } } as unknown as ExtensionCtx;
  bindStatusHost('omp');
  expect(readStatusVisible('omp')).toBe(true);
  announceStatus(ctx);
  expect(calls.at(-1)).toContain('OFF');

  expect(saveStatusVisible('omp', false)).toBe(true);
  expect(readStatusVisible('omp')).toBe(false);
  expect(readStatusVisible('pi')).toBe(true);
  announceStatus(ctx);
  expect(calls.at(-1)).toBeUndefined();

  saveStatusVisible('omp', true);
  announceStatus(ctx);
  expect(calls.at(-1)).toContain('OFF');
});

test('/tersio status off|on|toggle writes this host only and moves the footer line', async () => {
  const commands = new Map<string, (args: string, ctx: ExtensionCtx) => Promise<void> | void>();
  const pi = {
    hostId: 'omp',
    registerCommand: (name: string, def: { handler: (args: string, ctx: ExtensionCtx) => Promise<void> | void }) =>
      commands.set(name, def.handler),
    on() {},
  } as unknown as ExtensionApi;
  const calls: Array<string | undefined> = [];
  const ctx = {
    ui: { setStatus: (_k: string, v: string | undefined) => calls.push(v), notify() {} },
  } as unknown as ExtensionCtx;
  tersioCommandsExtension(pi);
  const run = commands.get('tersio')!;

  await run('status off', ctx);
  expect(readStatusVisible('omp')).toBe(false);
  expect(readStatusVisible('pi')).toBe(true);
  expect(calls.at(-1)).toBeUndefined();

  await run('status toggle', ctx);
  expect(readStatusVisible('omp')).toBe(true);
  expect(calls.at(-1)).toContain('OFF');

  await run('status off', ctx);
  await run('status on', ctx);
  expect(readStatusVisible('omp')).toBe(true);
});
