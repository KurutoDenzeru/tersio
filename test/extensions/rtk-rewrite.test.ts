import { describe, expect, test } from 'vitest';
import { isRtkCommand, rewriteThroughRtk, rewriteToolArguments } from '../../extensions/shared/rtk-rewrite.ts';

const rewriteTo = (next: string) => async () => next;

describe('rtk rewrite adapter', () => {
  test('rewrites a plain bash command when the mode is on', async () => {
    const replaced = await rewriteToolArguments(
      ['bash'],
      'bash',
      { command: 'git status' },
      true,
      rewriteTo('rtk git status'),
    );
    expect(replaced).toEqual({ command: 'rtk git status' });
  });

  test('keeps every other argument untouched', async () => {
    const replaced = await rewriteToolArguments(
      ['bash'],
      'bash',
      { command: 'git status', timeoutMs: 10 },
      true,
      rewriteTo('rtk git status'),
    );
    expect(replaced).toEqual({ command: 'rtk git status', timeoutMs: 10 });
  });

  test('does nothing when the mode is off, the tool is not listed, or the command is empty', async () => {
    await expect(
      rewriteToolArguments(['bash'], 'bash', { command: 'git status' }, false, rewriteTo('rtk git status')),
    ).resolves.toBeNull();
    await expect(
      rewriteToolArguments(['bash'], 'read', { command: 'git status' }, true, rewriteTo('rtk git status')),
    ).resolves.toBeNull();
    await expect(
      rewriteToolArguments(['bash'], 'bash', { command: '  ' }, true, rewriteTo('rtk git status')),
    ).resolves.toBeNull();
    await expect(rewriteToolArguments(['bash'], 'bash', {}, true, rewriteTo('rtk git status'))).resolves.toBeNull();
    await expect(rewriteToolArguments(['bash'], 'bash', null, true, rewriteTo('rtk git status'))).resolves.toBeNull();
  });

  test('never nests rtk inside rtk, and never rewrites to the same text', async () => {
    await expect(
      rewriteToolArguments(['bash'], 'bash', { command: 'rtk git status' }, true, rewriteTo('rtk rtk git status')),
    ).resolves.toBeNull();
    await expect(isRtkCommand('  rtk git status')).toBe(true);
    await expect(
      rewriteToolArguments(['bash'], 'bash', { command: 'git status' }, true, rewriteTo('git status')),
    ).resolves.toBeNull();
  });

  test('a failed rewrite leaves the command alone', async () => {
    const broken = async () => {
      throw new Error('rtk is missing');
    };
    await expect(rewriteToolArguments(['bash'], 'bash', { command: 'git status' }, true, broken)).resolves.toBeNull();
  });
});

describe('asking rtk for a rewrite', () => {
  const host = { RTK_REWRITE_HOST: 'sample' };

  test('accepts the exit-3 rewrite an ask rule produces', async () => {
    const exec = async () => {
      throw Object.assign(new Error('ask'), { code: 3, stdout: 'rtk git status\n' });
    };
    await expect(rewriteThroughRtk('git status', { bin: '/bin/rtk', exec, host: 'h' })).resolves.toBe('rtk git status');
  });

  test('treats passthrough, deny and absence as no rewrite', async () => {
    const pass = async () => {
      throw Object.assign(new Error('none'), { code: 1, stdout: '' });
    };
    const deny = async () => {
      throw Object.assign(new Error('deny'), { code: 2, stdout: '' });
    };
    await expect(rewriteThroughRtk('git status', { bin: '/bin/rtk', exec: pass })).resolves.toBeNull();
    await expect(rewriteThroughRtk('git status', { bin: '/bin/rtk', exec: deny })).resolves.toBeNull();
    await expect(rewriteThroughRtk('git status', { bin: null })).resolves.toBeNull();
  });

  test("passes the host id to rtk's rules and never rewrites an already-routed command", async () => {
    let seen: NodeJS.ProcessEnv | undefined;
    const exec = async (_bin: string, _args: string[], opts: { env?: NodeJS.ProcessEnv }) => {
      seen = opts.env;
      return { stdout: 'rtk git status' };
    };
    await expect(rewriteThroughRtk('git status', { bin: '/bin/rtk', exec, host: 'sample' })).resolves.toBe(
      'rtk git status',
    );
    expect(seen).toMatchObject(host, { RTK_REWRITE_HOST: 'sample' });
    await expect(rewriteThroughRtk('rtk git status', { bin: '/bin/rtk', exec })).resolves.toBeNull();
  });
});
