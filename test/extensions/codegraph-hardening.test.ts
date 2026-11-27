import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { acquireSyncLock } from '../../extensions/codegraph/shared.ts';
import { pruneStaleWatcherStatuses, readWatcherStatus, writeWatcherStatus } from '../../extensions/codegraph/status-file.ts';

const homes: string[] = [];
const saved = { HOME: process.env.HOME, TERSIO_HOME: process.env.TERSIO_HOME };

afterEach(() => {
  process.env.HOME = saved.HOME;
  if (saved.TERSIO_HOME === undefined) delete process.env.TERSIO_HOME;
  else process.env.TERSIO_HOME = saved.TERSIO_HOME;
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

function fixture(): { home: string; root: string; statusDir: string } {
  const home = mkdtempSync(path.join(tmpdir(), 'tersio-cg-'));
  homes.push(home);
  process.env.HOME = home;
  process.env.TERSIO_HOME = path.join(home, '.tersio');
  const root = path.join(home, 'repo');
  mkdirSync(root, { recursive: true });
  return { home, root, statusDir: path.join(home, '.tersio', 'codegraph') };
}

// Each agent process writes <hash>-<pid>.json and nothing removed them, so the directory grew for good.
describe('stale status files are reclaimed', () => {
  test('read output is unchanged while a dead writer ages out on the write path', () => {
    const { root, statusDir } = fixture();
    writeWatcherStatus(root, { isWatching: true, isIndexing: false });
    const dir = path.join(statusDir, 'status');
    const written = readdirSync(dir).filter((n) => n.endsWith('.json'));
    expect(written).toHaveLength(1);
    expect(readWatcherStatus(root)?.isWatching).toBe(true);

    const dead = written[0]!.replace(/-\d+\.json$/, '-999999.json');
    writeFileSync(path.join(dir, dead), JSON.stringify({ updatedAt: Date.now() - 21_000, isWatching: true, isIndexing: false }));
    pruneStaleWatcherStatuses(root);
    expect(existsSync(path.join(dir, dead))).toBe(false);
    expect(readdirSync(dir).filter((n) => n.endsWith('.json'))).toHaveLength(1);
  });

  test('a fresh stamp from a dead writer is kept, so a mid-rename file is never lost', () => {
    const { root, statusDir } = fixture();
    writeWatcherStatus(root, { isWatching: true, isIndexing: false });
    const dir = path.join(statusDir, 'status');
    const fresh = readdirSync(dir).filter((n) => n.endsWith('.json'))[0]!;
    const dead = fresh.replace(/-\d+\.json$/, '-999999.json');
    writeFileSync(path.join(dir, dead), JSON.stringify({ updatedAt: Date.now(), isWatching: false, isIndexing: true }));
    pruneStaleWatcherStatuses(root);
    expect(existsSync(path.join(dir, dead))).toBe(true);
  });
});

// Two agent processes open the same repository: without one lock they are two SQLite writers.
describe('the sync lock is exclusive across processes', () => {
  test('a held lock blocks a second caller, and release frees it', () => {
    const { root, statusDir } = fixture();
    const first = acquireSyncLock(root);
    expect(first).not.toBeNull();
    expect(readdirSync(statusDir).some((n) => n.endsWith('.lock'))).toBe(true);
    expect(acquireSyncLock(root)).toBeNull();
    first!();
    expect(readdirSync(statusDir).filter((n) => n.endsWith('.lock'))).toHaveLength(0);
    const second = acquireSyncLock(root);
    expect(second).not.toBeNull();
    second!();
  });

  test('an abandoned lock is reclaimed once its stamp ages out', async () => {
    const { root, statusDir } = fixture();
    const held = acquireSyncLock(root)!;
    const lock = path.join(statusDir, readdirSync(statusDir).find((n) => n.endsWith('.lock'))!);
    held();
    // Age the lock past the 60s reclaim window without sleeping.
    writeFileSync(lock, '999999');
    const old = new Date(Date.now() - 61_000);
    const { utimesSync } = await import('node:fs');
    utimesSync(lock, old, old);
    const reclaimed = acquireSyncLock(root);
    expect(reclaimed).not.toBeNull();
    reclaimed!();
  });
});
