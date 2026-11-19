import {afterAll, beforeAll, describe, expect, test} from 'vitest';
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
import {installGitHooks} from '../../extensions/codegraph/git-hooks.ts';
import {type CodeGraphTestFixture, createCodeGraphTestFixture} from '../helpers/codegraph.ts';

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
  });

  test('installGitHooks runs before an existing hook that exits early and leaves non-shell hooks alone', () => {
    const fakeRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'test-git-hooks-existing-'));
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
