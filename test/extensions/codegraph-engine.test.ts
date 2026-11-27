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
  hasCodeGraphIndex,
  stopAllWatchers,
  stopWatching,
  syncCodeGraph,
} from '../../extensions/codegraph/shared.ts';
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
  });

  test('supports concurrent readers without SQLITE_BUSY', async () => {
    const p1 = exploreSymbol('computeHash', tmpDir);
    const p2 = exploreSymbol('processJob', tmpDir);

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.symbols.length).toBeGreaterThan(0);
    expect(r2.symbols.length).toBeGreaterThan(0);
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

    expect(await hasCodeGraphIndex(root)).toBe(false);
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
    expect(await hasCodeGraphIndex(root)).toBe(true);
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
      expect(await hasCodeGraphIndex(root)).toBe(true);
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

  test('builds the index instead of reporting an empty sync', async () => {
    const fresh = createCodeGraphTestFixture();
    try {
      fs.mkdirSync(path.join(fresh.projectRoot, '.git'), { recursive: true });
      fs.writeFileSync(path.join(fresh.projectRoot, 'fresh.ts'), 'export function fresh() { return 1; }');
      const stats = await syncCodeGraph(fresh.projectRoot);
      expect(stats?.nodeCount ?? 0).toBeGreaterThan(0);
    } finally {
      stopAllWatchers();
      fresh.cleanup();
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
      process.env.TERSIO_CODEGRAPH_REGISTRY = 'HTTPS://npm.example.test/';
      expect(codegraphRegistry()).toBe('HTTPS://npm.example.test');
      // Not a URL, or carrying characters cmd.exe treats as syntax: refused, never passed to npm.
      for (const bad of ['not-a-url', 'ftp://npm.example.test', 'https://npm.example.test/?a=1&b=2']) {
        process.env.TERSIO_CODEGRAPH_REGISTRY = bad;
        expect(codegraphRegistry()).toBe('https://registry.npmjs.org');
      }
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
