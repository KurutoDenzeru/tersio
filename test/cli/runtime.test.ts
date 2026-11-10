import { describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { cliEnv } from '../helpers/env.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cli = path.join(root, 'dist', 'tersio.js');
const { version } = createRequire(import.meta.url)('../../package.json');

// The bun hand-off: the installed bin's shebang names node, so the entry re-runs itself under bun when bun is on PATH.

function fakeBun(): { dir: string; log: string; home: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tersio-bun-bin-'));
  const home = mkdtempSync(path.join(os.tmpdir(), 'tersio-bun-home-'));
  const log = path.join(dir, 'bun-args.log');
  writeFileSync(
    path.join(dir, 'bun'),
    `#!/bin/sh\necho "bun $*" >> "${log}"\nif [ "$1" = "--version" ]; then echo "1.99.0"; exit 0; fi\nexit 7\n`,
    'utf8',
  );
  chmodSync(path.join(dir, 'bun'), 0o755);
  return { dir, log, home };
}

function run(args: string[], dir: string, home: string, extra: Record<string, string> = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    timeout: 20000,
    env: cliEnv(home, { PATH: `${dir}${path.delimiter}${process.env.PATH || ''}`, ...extra }),
  });
}

describe.skipIf(process.platform === 'win32')('bun runtime hand-off', () => {
  test('re-runs the CLI under bun when bun is on PATH', () => {
    const { dir, log, home } = fakeBun();
    try {
      const result = run(['--version'], dir, home);
      // The fake bun answers the probe, then runs the CLI and its own exit code comes back.
      expect(result.status, result.stderr).toBe(7);
      const calls = readFileSync(log, 'utf8');
      expect(calls).toMatch(/^bun --version$/m);
      expect(calls).toMatch(new RegExp(`^bun ${cli.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} --version$`, 'm'));
      // The node parent never printed the command's own output.
      expect(result.stdout).not.toContain(version);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('runs the command itself when TERSIO_RUNTIME=node', () => {
    const { dir, log, home } = fakeBun();
    try {
      const result = run(['--version'], dir, home, { TERSIO_RUNTIME: 'node' });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe(version);
      expect(existsSync(log)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('does not hand off twice from the bun child', () => {
    const { dir, log, home } = fakeBun();
    try {
      const result = run(['--version'], dir, home, { TERSIO_BUN_CHILD: '1' });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe(version);
      expect(existsSync(log)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});
