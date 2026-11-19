import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  ensureInitializedAndWatching,
  exploreSymbol,
  findRepoRoot,
  getCodeGraph,
  getCodeGraphStatus,
  getComplexityScore,
  hasCodeGraphIndex,
  stopAllWatchers,
  stopWatching,
  syncCodeGraph,
} from '../../extensions/codegraph/shared.ts';
import { installGitHooks } from '../../extensions/codegraph/git-hooks.ts';
import { codegraphRegistry } from '../../extensions/codegraph/install.ts';
import { type CodeGraphTestFixture, createCodeGraphTestFixture } from '../helpers/codegraph.ts';

describe('CodeGraph Engine & Concurrency', () => {
  let fixture: CodeGraphTestFixture;
  let tmpDir: string;

  beforeAll(() => {
    fixture = createCodeGraphTestFixture();
    tmpDir = fixture.projectRoot;
  });

  afterAll(() => {
    stopAllWatchers();
    fixture.cleanup();
  });
  test('initializes and indexes a repository', async () => {
    fs.mkdirSync(path.join(tmpDir, '.git'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'service.ts'),
      `export function computeHash(val: string): string { return val + '_hash'; }
export function processJob(jobId: string) { return computeHash(jobId); }`,
    );

    const cg = await getCodeGraph(tmpDir, true);
    try {
      await cg.indexAll();
      const stats = await cg.getStats();
      expect(stats.fileCount).toBeGreaterThanOrEqual(1);
      expect(stats.nodeCount).toBeGreaterThan(0);
    } finally {
      cg.close();
    }
  });

  test('explores symbols and returns blast radius', async () => {
    const result = await exploreSymbol('computeHash', tmpDir);
    expect(result.symbols.length).toBeGreaterThan(0);
    const sym = result.symbols[0];
    expect(sym.node.name).toBe('computeHash');
    expect(sym.callers.length).toBeGreaterThan(0);
    expect(sym.blastRadius.affectedNodes).toBeGreaterThanOrEqual(1);

    const complexity = await getComplexityScore('computeHash', tmpDir);
    expect(complexity.maxBlastRadius).toBeGreaterThanOrEqual(1);
  });

  test('supports concurrent readers without SQLITE_BUSY', async () => {
    const p1 = exploreSymbol('computeHash', tmpDir);
    const p2 = exploreSymbol('processJob', tmpDir);
    const p3 = getComplexityScore('computeHash', tmpDir);

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1.symbols.length).toBeGreaterThan(0);
    expect(r2.symbols.length).toBeGreaterThan(0);
    expect(r3.maxBlastRadius).toBeGreaterThanOrEqual(1);
  });

  test('getCodeGraphStatus returns accurate graph metrics', async () => {
    const status = await getCodeGraphStatus(tmpDir);
    expect(status.initialized).toBe(true);
    expect(status.nodeCount).toBeGreaterThan(0);
    expect(status.fileCount).toBeGreaterThanOrEqual(1);
    expect(status.dbSizeBytes).toBeGreaterThan(0);
  });

  test('ensureInitializedAndWatching starts watching and stops cleanly', async () => {
    const started = await ensureInitializedAndWatching(tmpDir);
    expect(started).toBe(true);

    const statusWatching = await getCodeGraphStatus(tmpDir);
    expect(statusWatching.isWatching).toBe(true);

    // Modify a file and immediately sync
    fs.writeFileSync(
      path.join(tmpDir, 'service.ts'),
      `export function computeHash(val: string): string { return val + '_hash_v2'; }
export function processJob(jobId: string) { return computeHash(jobId); }
export function helper(): void {}`,
    );
    const syncStats = await syncCodeGraph(tmpDir);
    expect(syncStats).not.toBeNull();
    expect(syncStats?.fileCount).toBeGreaterThanOrEqual(1);

    stopWatching(tmpDir);
    const statusStopped = await getCodeGraphStatus(tmpDir);
    expect(statusStopped.isWatching).toBe(false);
  });

  test('initializes a placeholder .codegraph directory with a background index', async () => {
    const root = path.join(fixture.tempDir, 'placeholder-project');
    fs.mkdirSync(path.join(root, '.git'), { recursive: true });
    fs.mkdirSync(path.join(root, '.codegraph'), { recursive: true });
    fs.writeFileSync(path.join(root, '.codegraph', '.gitignore'), '*\n');
    fs.writeFileSync(path.join(root, 'placeholder.ts'), 'export function placeholder() {}');

    expect(hasCodeGraphIndex(root)).toBe(false);
    expect(fs.existsSync(path.join(root, '.codegraph', 'codegraph.db'))).toBe(false);
    expect(await ensureInitializedAndWatching(root)).toBe(true);

    const deadline = Date.now() + 2_000;
    let status = await getCodeGraphStatus(root);
    while (status.isIndexing && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      status = await getCodeGraphStatus(root);
    }

    expect(status.isIndexing).toBe(false);
    expect(status.error).toBeUndefined();
    expect(status.initialized).toBe(true);
    expect((await exploreSymbol('placeholder', root)).symbols[0]?.node.name).toBe('placeholder');
    expect(hasCodeGraphIndex(root)).toBe(true);
    stopWatching(root);
  });

  test('reopens an index in the directory selected by CODEGRAPH_DIR', async () => {
    const root = path.join(fixture.tempDir, 'custom-project');
    const previous = process.env.CODEGRAPH_DIR;
    fs.mkdirSync(path.join(root, '.git'), { recursive: true });
    fs.writeFileSync(path.join(root, 'custom.ts'), 'export function custom() {}');
    process.env.CODEGRAPH_DIR = '.codegraph-custom';
    try {
      const graph = await getCodeGraph(root);
      await graph.indexAll();
      graph.close();
      expect(hasCodeGraphIndex(root)).toBe(true);
      const reopened = await getCodeGraph(root);
      try {
        expect((await reopened.getNodesByName('custom'))[0]?.name).toBe('custom');
      } finally {
        reopened.close();
      }
    } finally {
      if (previous === undefined) delete process.env.CODEGRAPH_DIR;
      else process.env.CODEGRAPH_DIR = previous;
    }
  });

  test('installGitHooks installs hooks when .git/hooks exists', () => {
    const fakeRepo = path.join(os.tmpdir(), `test-git-hooks-${Date.now()}`);
    fs.mkdirSync(path.join(fakeRepo, '.git', 'hooks'), { recursive: true });

    const result = installGitHooks(fakeRepo);
    expect(result.success).toBe(true);
    expect(result.installed.length).toBe(3);
    expect(fs.existsSync(path.join(fakeRepo, '.git', 'hooks', 'post-commit'))).toBe(true);

    // Running again should skip already installed
    const rerun = installGitHooks(fakeRepo);
    expect(rerun.skipped.length).toBe(3);
    fs.rmSync(fakeRepo, { recursive: true, force: true });
  });

  test('installGitHooks runs before an existing hook that exits early and leaves non-shell hooks alone', () => {
    const fakeRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'test-git-hooks-existing-'));
    try {
      const hooks = path.join(fakeRepo, '.git', 'hooks');
      fs.mkdirSync(hooks, { recursive: true });
      fs.writeFileSync(path.join(hooks, 'post-commit'), '#!/bin/sh\necho mine\nexit 0\n', { mode: 0o755 });
      const node = '#!/usr/bin/env node\nconsole.log(1);\n';
      fs.writeFileSync(path.join(hooks, 'post-merge'), node, { mode: 0o755 });

      const result = installGitHooks(fakeRepo);
      expect(result.incompatible).toEqual(['post-merge']);
      expect(result.installed).toEqual(['post-commit', 'post-checkout']);

      const commit = fs.readFileSync(path.join(hooks, 'post-commit'), 'utf8');
      expect(commit.startsWith('#!/bin/sh\n# Tersio CodeGraph')).toBe(true);
      expect(commit.indexOf('tersio codegraph sync')).toBeLessThan(commit.indexOf('exit 0'));
      expect(commit).toContain('echo mine');
      expect(fs.readFileSync(path.join(hooks, 'post-merge'), 'utf8')).toBe(node);
    } finally {
      fs.rmSync(fakeRepo, { recursive: true, force: true });
    }
  });

  test('installGitHooks accepts env -S shell shebangs, skips binaries, and keeps foreign bytes', () => {
    const fakeRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'test-git-hooks-shebang-'));
    try {
      const hooks = path.join(fakeRepo, '.git', 'hooks');
      fs.mkdirSync(hooks, { recursive: true });
      fs.writeFileSync(path.join(hooks, 'post-commit'), '#!/usr/bin/env -S -u FOO bash\necho mine\n', { mode: 0o755 });
      const binary = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01]);
      fs.writeFileSync(path.join(hooks, 'post-merge'), binary, { mode: 0o755 });
      const latin1 = Buffer.concat([Buffer.from('#!/bin/sh\n# caf'), Buffer.from([0xe9]), Buffer.from('\n')]);
      fs.writeFileSync(path.join(hooks, 'post-checkout'), latin1, { mode: 0o755 });

      const result = installGitHooks(fakeRepo);
      expect(result.installed).toEqual(['post-commit', 'post-checkout']);
      expect(result.incompatible).toEqual(['post-merge']);
      expect(fs.readFileSync(path.join(hooks, 'post-merge')).equals(binary)).toBe(true);
      const kept = fs.readFileSync(path.join(hooks, 'post-checkout'));
      expect(kept.includes(Buffer.from([0xe9]))).toBe(true);
      expect(kept.includes(Buffer.from([0xef, 0xbf, 0xbd]))).toBe(false);
    } finally {
      fs.rmSync(fakeRepo, { recursive: true, force: true });
    }
  });

  test('installGitHooks refreshes an older block in place', () => {
    const fakeRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'test-git-hooks-refresh-'));
    try {
      const hooks = path.join(fakeRepo, '.git', 'hooks');
      fs.mkdirSync(hooks, { recursive: true });
      const old =
        '#!/bin/sh\necho before\n# Tersio CodeGraph automatic background sync hook\nold-command\nfi\necho after\n';
      for (const name of ['post-commit', 'post-merge', 'post-checkout']) {
        fs.writeFileSync(path.join(hooks, name), old, { mode: 0o755 });
      }
      const result = installGitHooks(fakeRepo);
      expect(result.installed.length).toBe(3);
      const text = fs.readFileSync(path.join(hooks, 'post-commit'), 'utf8');
      expect(text).toContain('tersio codegraph sync');
      expect(text).not.toContain('old-command');
      expect(text).toContain('echo before');
      expect(text).toContain('echo after');
      expect(installGitHooks(fakeRepo).skipped.length).toBe(3);
    } finally {
      fs.rmSync(fakeRepo, { recursive: true, force: true });
    }
  });
});

describe('syncCodeGraph on a repository with no index', () => {
  test('builds the index instead of reporting an empty sync', async () => {
    const fixture = createCodeGraphTestFixture();
    try {
      fs.mkdirSync(path.join(fixture.projectRoot, '.git'), { recursive: true });
      fs.writeFileSync(path.join(fixture.projectRoot, 'fresh.ts'), 'export function fresh() { return 1; }');
      const stats = await syncCodeGraph(fixture.projectRoot);
      expect(stats?.nodeCount ?? 0).toBeGreaterThan(0);
    } finally {
      stopAllWatchers();
      fixture.cleanup();
    }
  });
});

describe('codegraphRegistry', () => {
  test('defaults to npmjs and honours a mirror from the environment', () => {
    const previous = process.env.TERSIO_CODEGRAPH_REGISTRY;
    try {
      delete process.env.TERSIO_CODEGRAPH_REGISTRY;
      expect(codegraphRegistry()).toBe('https://registry.npmjs.org');
      process.env.TERSIO_CODEGRAPH_REGISTRY = 'https://npm.example.test/';
      expect(codegraphRegistry()).toBe('https://npm.example.test');
      process.env.TERSIO_CODEGRAPH_REGISTRY = 'not-a-url';
      expect(codegraphRegistry()).toBe('https://registry.npmjs.org');
    } finally {
      if (previous === undefined) delete process.env.TERSIO_CODEGRAPH_REGISTRY;
      else process.env.TERSIO_CODEGRAPH_REGISTRY = previous;
    }
  });
});

describe('findRepoRoot', () => {
  test('finds the nearest .git above a nested directory', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'test-cg-root-'));
    fs.mkdirSync(path.join(repo, '.git'));
    const nested = path.join(repo, 'src', 'deep');
    fs.mkdirSync(nested, { recursive: true });
    expect(findRepoRoot(nested)).toBe(repo);
  });

  test('returns null outside any repository', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'test-cg-bare-'));
    expect(findRepoRoot(bare)).toBeNull();
  });
});
