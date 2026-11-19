import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { clearWatcherStatus, readWatcherStatus, writeWatcherStatus } from '../../extensions/codegraph/status-file.ts';
import { withHome } from '../helpers/env.ts';

test('watcher status combines live processes and ignores stale status files', () => {
  withHome((home) => {
    const root = path.join(home, 'project');
    mkdirSync(root);
    writeWatcherStatus(root, { isWatching: true, isIndexing: false });
    expect(readWatcherStatus(root)).toEqual({ isWatching: true, isIndexing: false });

    const directory = path.join(home, '.tersio', 'codegraph', 'status');
    const prefix = createHash('sha256').update(realpathSync(root)).digest('hex');
    const other = path.join(directory, `${prefix}-999999.json`);
    writeFileSync(other, JSON.stringify({ updatedAt: Date.now(), isWatching: false, isIndexing: true }));
    expect(readWatcherStatus(root)).toEqual({ isWatching: true, isIndexing: true });

    clearWatcherStatus(root);
    expect(existsSync(other)).toBe(true);
    expect(readWatcherStatus(root)).toEqual({ isWatching: false, isIndexing: true });
    writeFileSync(other, JSON.stringify({ updatedAt: Date.now() - 21_000, isWatching: true, isIndexing: false }));
    expect(readWatcherStatus(root)).toBeNull();
    expect(readdirSync(directory)).toEqual([path.basename(other)]);
  });
});
