import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { isRecord, tersioHome } from '../shared/utils.ts';
import type { CodeGraphStatus } from './types.ts';

const MAX_AGE_MS = 20_000;
const MAX_FUTURE_MS = 5_000;

type WatcherStatus = Pick<CodeGraphStatus, 'isWatching' | 'isIndexing' | 'error'>;
interface StoredStatus extends WatcherStatus {
  updatedAt: number;
}
interface StatusLocation {
  directory: string;
  prefix: string;
  file: string;
}

function statusPath(root: string): StatusLocation {
  const hash = createHash('sha256').update(realpathSync(root)).digest('hex');
  const directory = path.join(tersioHome(), 'codegraph', 'status');
  const prefix = `${hash}-`;
  return { directory, prefix, file: path.join(directory, `${hash}-${process.pid}.json`) };
}

function parseStatus(value: unknown): StoredStatus | null {
  if (!isRecord(value)) return null;
  if (typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt)) return null;
  if (typeof value.isWatching !== 'boolean' || typeof value.isIndexing !== 'boolean') return null;
  if (value.error !== undefined && typeof value.error !== 'string') return null;
  return {
    updatedAt: value.updatedAt,
    isWatching: value.isWatching,
    isIndexing: value.isIndexing,
    ...(typeof value.error === 'string' ? { error: value.error } : {}),
  };
}

export function writeWatcherStatus(root: string, status: WatcherStatus): void {
  const { directory, file } = statusPath(root);
  try {
    pruneStaleWatcherStatuses(root);
  } catch {
    /* a failed sweep must not stop the write */
  }
  const temporary = `${file}.tmp`;
  mkdirSync(directory, { recursive: true });
  try {
    writeFileSync(
      temporary,
      JSON.stringify({
        updatedAt: Date.now(),
        isWatching: status.isWatching,
        isIndexing: status.isIndexing,
        ...(status.error === undefined ? {} : { error: status.error }),
      } satisfies StoredStatus),
      { mode: 0o600 },
    );
    chmodSync(temporary, 0o600);
    renameSync(temporary, file);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

/** Whether the pid in `<hash>-<pid>.json` can still write. EPERM means it lives on. */
function ownerAlive(name: string): boolean {
  const pid = Number(name.match(/-(\d+)\.json$/)?.[1]);
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}

/** Drop files whose writer is gone and whose stamp aged out. Read output is unchanged. */
export function pruneStaleWatcherStatuses(root: string): void {
  let location: StatusLocation;
  let files: string[];
  try {
    location = statusPath(root);
    files = readdirSync(location.directory);
  } catch {
    return;
  }
  const now = Date.now();
  for (const name of files) {
    if (!name.startsWith(location.prefix) || !name.endsWith('.json')) continue;
    const file = path.join(location.directory, name);
    try {
      const status = parseStatus(JSON.parse(readFileSync(file, 'utf8')));
      if (!status || status.updatedAt >= now - MAX_AGE_MS) continue;
      if (ownerAlive(name)) continue;
      rmSync(file, { force: true });
    } catch {
      // A concurrently removed file is already gone.
    }
  }
}

export function readWatcherStatus(root: string): WatcherStatus | null {
  let location: StatusLocation;
  try {
    location = statusPath(root);
    if (!existsSync(location.directory)) return null;
  } catch {
    return null;
  }

  const now = Date.now();
  const statuses: StoredStatus[] = [];
  let files: string[];
  try {
    files = readdirSync(location.directory);
  } catch {
    return null;
  }

  for (const name of files) {
    if (!name.startsWith(location.prefix) || !name.endsWith('.json')) continue;
    try {
      const status = parseStatus(JSON.parse(readFileSync(path.join(location.directory, name), 'utf8')));
      if (status && status.updatedAt >= now - MAX_AGE_MS && status.updatedAt <= now + MAX_FUTURE_MS)
        statuses.push(status);
    } catch {
      // A malformed or concurrently removed process file does not invalidate other statuses.
    }
  }

  if (statuses.length === 0) return null;
  const latestError = statuses
    .filter((status) => status.error !== undefined)
    .toSorted((a, b) => b.updatedAt - a.updatedAt)[0]?.error;
  return {
    isWatching: statuses.some((status) => status.isWatching),
    isIndexing: statuses.some((status) => status.isIndexing),
    ...(latestError === undefined ? {} : { error: latestError }),
  };
}

export function clearWatcherStatus(root: string): void {
  try {
    const { file } = statusPath(root);
    rmSync(file, { force: true });
  } catch {
    // The root or status directory may already be gone during shutdown.
  }
}
