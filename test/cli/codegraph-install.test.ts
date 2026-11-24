import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from 'vitest';

import { installCodeGraphBundle } from '../../extensions/codegraph/install.ts';
import { resolveCodeGraphLibrary } from '../../extensions/codegraph/shared.ts';
import { fakeExecutable, withHome } from '../helpers/env.ts';

const version = '1.2.3';
const target = `${process.platform}-${process.arch}`;
const packageName = `@colbymchenry/codegraph-${target}`;

type NpmMode = 'install' | 'fail' | 'metadata' | 'smoke';

interface FakeNpm {
  bin: string;
  setMode(mode: NpmMode): void;
}

function fakeNpm(home: string): FakeNpm {
  const script = path.join(home, 'fake-npm.js');
  writeFileSync(
    script,
    `
const fs = require('node:fs');
const path = require('node:path');
if (process.env.CODEGRAPH_NPM_MODE === 'fail') process.exit(17);
const prefixIndex = process.argv.indexOf('--prefix');
if (prefixIndex < 0 || !process.argv[prefixIndex + 1]) process.exit(18);
const prefix = process.argv[prefixIndex + 1];
const root = path.join(prefix, 'node_modules', '@colbymchenry', 'codegraph-${target}');
fs.mkdirSync(path.join(root, 'lib', 'dist'), { recursive: true });
const metadata = {
  name: process.env.CODEGRAPH_NPM_MODE === 'metadata' ? 'wrong-package' : '${packageName}',
  version: '${version}',
};
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(metadata));
fs.writeFileSync(
  path.join(root, 'lib', 'dist', 'index.js'),
  process.env.CODEGRAPH_NPM_MODE === 'smoke' ? 'module.exports = { CodeGraph: {} };' : 'module.exports = { CodeGraph: class { static async init() { return new this(); } static async open() {} async indexAll() {} async sync() {} async getStats() { return { fileCount: 1 }; } async getNodesByName() {} async getCallers() {} async getImpactRadius() {} watch() {} unwatch() {} close() {} } };',
);
fs.copyFileSync(process.execPath, path.join(root, '${process.platform === 'win32' ? 'node.exe' : 'node'}'));
`,
    'utf8',
  );

  const quotePosix = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
  const quoteCmd = (value: string): string => `"${value.replaceAll('"', '""')}"`;
  const binDir = path.join(home, 'bin');
  const bin = fakeExecutable(
    binDir,
    'npm',
    `exec ${quotePosix(process.execPath)} ${quotePosix(script)} "$@"`,
    `${quoteCmd(process.execPath)} ${quoteCmd(script)} %*`,
  );
  return {
    bin,
    setMode: (mode) => {
      process.env.CODEGRAPH_NPM_MODE = mode;
    },
  };
}

async function withFakeNpm<T>(run: (home: string, bundlesDir: string, npm: FakeNpm) => Promise<T>): Promise<T> {
  return await withHome(async (home) => {
    const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
    const previousEnvironment = {
      path: process.env[pathKey],
      mode: process.env.CODEGRAPH_NPM_MODE,
      library: process.env.CODEGRAPH_LIB_PATH,
    };
    const npm = fakeNpm(home);
    const bundlesDir = path.join(process.env.TERSIO_HOME!, 'codegraph', 'bundles');
    process.env[pathKey] = [path.dirname(npm.bin), previousEnvironment.path].filter(Boolean).join(path.delimiter);
    delete process.env.CODEGRAPH_LIB_PATH;
    try {
      return await run(home, bundlesDir, npm);
    } finally {
      if (previousEnvironment.path === undefined) delete process.env[pathKey];
      else process.env[pathKey] = previousEnvironment.path;
      if (previousEnvironment.mode === undefined) delete process.env.CODEGRAPH_NPM_MODE;
      else process.env.CODEGRAPH_NPM_MODE = previousEnvironment.mode;
      if (previousEnvironment.library === undefined) delete process.env.CODEGRAPH_LIB_PATH;
      else process.env.CODEGRAPH_LIB_PATH = previousEnvironment.library;
    }
  });
}

test('installCodeGraphBundle installs an offline bundle resolvable at the requested version', async () => {
  await withFakeNpm(async (_home, bundlesDir) => {
    process.env.CODEGRAPH_NPM_MODE = 'install';
    expect(await installCodeGraphBundle(version)).toBe(version);
    const library = resolveCodeGraphLibrary();
    expect(library).toBe(path.join(bundlesDir, `${target}-${version}`, 'lib', 'dist', 'index.js'));
    expect(require(library!).CodeGraph.init).toBeTypeOf('function');
    expect(JSON.parse(readFileSync(path.join(bundlesDir, `${target}-${version}`, 'package.json'), 'utf8'))).toEqual({
      name: packageName,
      version,
    });
  });
});

test('installCodeGraphBundle reuses a valid bundle without invoking failing npm', async () => {
  await withFakeNpm(async (_home, bundlesDir, npm) => {
    npm.setMode('install');
    expect(await installCodeGraphBundle(version)).toBe(version);
    const bundle = path.join(bundlesDir, `${target}-${version}`);
    const before = readFileSync(path.join(bundle, 'lib', 'dist', 'index.js'), 'utf8');
    npm.setMode('fail');

    expect(await installCodeGraphBundle(version)).toBe(version);
    expect(readdirSync(bundlesDir)).toEqual([`${target}-${version}`]);
    expect(readFileSync(path.join(bundle, 'lib', 'dist', 'index.js'), 'utf8')).toBe(before);
    expect(resolveCodeGraphLibrary()).toBe(path.join(bundle, 'lib', 'dist', 'index.js'));
  });
});

test.each([
  ['metadata', 'Unexpected CodeGraph package name'],
  ['smoke', undefined],
] as const)('installCodeGraphBundle rejects %s package and removes its staging directory', async (mode, message) => {
  await withFakeNpm(async (_home, bundlesDir, npm) => {
    npm.setMode(mode);
    const installation = installCodeGraphBundle(version);
    if (message) await expect(installation).rejects.toThrow(message);
    else await expect(installation).rejects.toThrow('Command failed');
    expect(existsSync(bundlesDir)).toBe(true);
    expect(readdirSync(bundlesDir)).toEqual([]);
    expect(resolveCodeGraphLibrary()).toBeNull();
  });
});

test('installCodeGraphBundle rejects an invalid version before invoking npm', async () => {
  await withFakeNpm(async (_home, bundlesDir, npm) => {
    npm.setMode('fail');
    await expect(installCodeGraphBundle('1.2')).rejects.toThrow('Invalid CodeGraph version: 1.2');
    expect(existsSync(bundlesDir)).toBe(false);
  });
});

test('installCodeGraphBundle leaves CodeGraph telemetry off and deletes any pending queue', async () => {
  await withFakeNpm(async (home, bundlesDir, npm) => {
    npm.setMode('install');
    // A queue an earlier install sent nothing of: the opt-out must sweep it, not just stop writing.
    const upstream = path.join(home, '.codegraph');
    mkdirSync(upstream, { recursive: true });
    writeFileSync(path.join(upstream, 'telemetry-queue.jsonl'), '{"v":2,"d":"2026-01-01","k":"cli_command","n":"init","c":1,"e":0}\n');

    expect(await installCodeGraphBundle(version)).toBe(version);
    const config = JSON.parse(readFileSync(path.join(upstream, 'telemetry.json'), 'utf8')) as Record<string, unknown>;
    expect(config.enabled).toBe(false);
    expect(config.machine_id).toBeNull();
    expect(readdirSync(upstream)).toEqual(['telemetry.json']);
  });
});

test('installCodeGraphBundle overrides an explicit telemetry opt-in', async () => {
  await withFakeNpm(async (home, bundlesDir, npm) => {
    npm.setMode('install');
    const upstream = path.join(home, '.codegraph');
    mkdirSync(upstream, { recursive: true });
    writeFileSync(
      path.join(upstream, 'telemetry.json'),
      JSON.stringify({ enabled: true, machine_id: 'abc', consent_source: 'installer', first_run_notice_shown: true }),
    );

    expect(await installCodeGraphBundle(version)).toBe(version);
    const config = JSON.parse(readFileSync(path.join(upstream, 'telemetry.json'), 'utf8')) as Record<string, unknown>;
    expect(config.enabled).toBe(false);
    expect(config.machine_id).toBeNull();
  });
});
