import { chmodSync, existsSync, mkdirSync, readlinkSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import { linkCodeGraphCli } from '../../cli/codegraph-bundle.ts';
import { withHome } from '../helpers/env.ts';

const version = '1.2.3';
const target = `${process.platform}-${process.arch}`;

/** A complete fake bundle in the temp home, so resolveCodeGraphLibrary() answers inside withHome. */
function fakeBundle(home: string): string {
  const bundle = path.join(home, '.tersio', 'codegraph', 'bundles', `${target}-${version}`);
  mkdirSync(path.join(bundle, 'lib', 'dist'), { recursive: true });
  mkdirSync(path.join(bundle, 'bin'), { recursive: true });
  writeFileSync(
    path.join(bundle, 'lib', 'dist', 'index.js'),
    'module.exports = { CodeGraph: class { static async init() {} static async open() {} } };',
  );
  writeFileSync(path.join(bundle, 'package.json'), JSON.stringify({ name: `@colbymchenry/codegraph-${target}`, version }));
  const bin = path.join(bundle, 'bin', process.platform === 'win32' ? 'codegraph.cmd' : 'codegraph');
  writeFileSync(bin, '#!/bin/sh\nexit 0\n');
  if (process.platform !== 'win32') chmodSync(bin, 0o755);
  return bin;
}

const linkPath = (home: string): string => path.join(home, '.local', 'bin', 'codegraph');

describe('the CodeGraph CLI link', () => {
  test.skipIf(process.platform === 'win32')('links the bundled bin into ~/.local/bin', async () => {
    withHome(async () => {
      const home = process.env.HOME!;
      const bin = fakeBundle(home);
      expect(await linkCodeGraphCli()).toBe('linked');
      expect(existsSync(linkPath(home))).toBe(true);
      expect(readlinkSync(linkPath(home))).toBe(bin);
      // A second run is a no-op.
      expect(await linkCodeGraphCli()).toBe('current');
    });
  });

  test.skipIf(process.platform === 'win32')('never touches a codegraph the user already has', async () => {
    withHome(async () => {
      const home = process.env.HOME!;
      fakeBundle(home);
      mkdirSync(path.dirname(linkPath(home)), { recursive: true });
      writeFileSync(linkPath(home), '#!/bin/sh\nexit 0\n');
      expect(await linkCodeGraphCli()).toBe('kept');
      expect(statSync(linkPath(home)).isFile(), 'regular file untouched').toBe(true);
    });
  });

  test.skipIf(process.platform === 'win32')('relinks a stale link from an older bundle', async () => {
    withHome(async () => {
      const home = process.env.HOME!;
      const bin = fakeBundle(home);
      mkdirSync(path.dirname(linkPath(home)), { recursive: true });
      symlinkSync('/tmp/gone-bundle/bin/codegraph', linkPath(home));
      expect(await linkCodeGraphCli()).toBe('linked');
      expect(readlinkSync(linkPath(home))).toBe(bin);
    });
  });
});
