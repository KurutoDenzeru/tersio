// Data snapshots: what tersio keeps, where the copies live, and how one is put back.
//
// A snapshot is a directory with a manifest, not a single file, so one copy holds the whole set.
// Older installs wrote a lone `usage-<stamp>.db`; those still list and restore, over the ledger alone.

import { promises as fs } from 'node:fs';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { agentDbPath, statsDbPath } from '../extensions/shared/agent-stats.ts';
import { rtkDbPath } from '../extensions/shared/rtk-gain.ts';
import { pricesCachePath } from '../extensions/shared/pricing.ts';
import { usageDbPath } from '../extensions/shared/usage-store.ts';
import { resetMarkerPath } from '../extensions/shared/usage-ledger.ts';
import { tersioHome } from '../extensions/shared/utils.ts';

/** Snapshots kept on disk; the oldest is pruned first. Six keeps the list past one screen, so
 *  the pane scrolls instead of showing the whole history at once. */
export const BACKUP_KEEP = 6;

/** One file a snapshot can hold, with where it came from. */
export interface BackupFile {
  label: string;
  source: string;
  bytes: number;
}

/** One snapshot on disk, with the files it holds. */
export interface DataBackup {
  name: string;
  path: string;
  mtime: number;
  bytes: number;
  files: BackupFile[];
  /** True for the lone ledger file older builds wrote, which restores over the ledger alone. */
  legacy: boolean;
}

/** Where a snapshot's files live. */
export function backupDir(): string {
  return path.join(tersioHome(), 'backups');
}

/** A snapshot directory's manifest, read back out with its files. */
function manifestPath(dir: string): string {
  return path.join(dir, 'manifest.json');
}

/** Every file this build knows how to snapshot, whether or not it exists yet. */
export function dataSources(): BackupFile[] {
  const sources: Array<[string, string]> = [
    ['Usage ledger', usageDbPath()],
    ['Reset watermark', resetMarkerPath()],
    ['Settings', path.join(tersioHome(), 'settings.json')],
    ['Price cache', pricesCachePath()],
    ['Model price cache', path.join(tersioHome(), 'prices-modelsdev.json')],
    ['Agent stats', statsDbPath()],
    ['Agent quota windows', agentDbPath()],
    ['Command history', rtkDbPath()],
  ];
  return sources.map(([label, source]) => ({ label, source, bytes: sizeOf(source) }));
}

/** Byte size of a file, zero when it is absent or unreadable. */
function sizeOf(file: string): number {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

/** Snapshot label for a legacy single-file backup, so the list reads the same for both. */
function legacyLabel(name: string): string {
  return name.startsWith('usage-') ? 'Usage ledger' : 'Snapshot';
}

/** Newest first: the directories this build wrote, then the lone `usage-*.db` files. */
export function listDataBackups(): DataBackup[] {
  let names: string[] = [];
  try {
    names = readdirSync(backupDir());
  } catch {
    return [];
  }
  const dirs: DataBackup[] = [];
  const legacy: DataBackup[] = [];
  for (const name of names) {
    const full = path.join(backupDir(), name);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      const files = readManifest(full);
      if (files.length === 0) continue;
      dirs.push({ name, path: full, mtime: stat.mtimeMs, bytes: totalOf(full), files, legacy: false });
      continue;
    }
    if (/^usage-\d{14}\.db$/.test(name)) {
      legacy.push({
        name,
        path: full,
        mtime: stat.mtimeMs,
        bytes: stat.size,
        files: [{ label: legacyLabel(name), source: usageDbPath(), bytes: stat.size }],
        legacy: true,
      });
    }
  }
  return [...dirs, ...legacy].toSorted((a, b) => b.mtime - a.mtime);
}

/** The files a snapshot directory holds, read from its manifest. */
function readManifest(dir: string): BackupFile[] {
  try {
    const raw = JSON.parse(readFileSync(manifestPath(dir), 'utf8')) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((entry) => {
        const record = (entry ?? {}) as Record<string, unknown>;
        const source = String(record.source ?? '');
        const name = path.basename(source);
        const file = path.join(dir, name);
        const bytes = sizeOf(file);
        if (!source || bytes === 0) return null;
        return { label: String(record.label ?? name), source, bytes };
      })
      .filter((entry): entry is BackupFile => entry !== null);
  } catch {
    return [];
  }
}

/** Disk size of a snapshot, counting the manifest. */
function totalOf(dir: string): number {
  return sizeOf(manifestPath(dir)) + readdirSync(dir).reduce((sum, name: string) => sum + sizeOf(path.join(dir, name)), 0);
}

/** Put the sqlite ledger's write-ahead log back in the main file, so a copy is one whole database. */
function checkpointLedger(): void {
  try {
    execFileSync('sqlite3', [usageDbPath(), 'PRAGMA wal_checkpoint(TRUNCATE);'], { stdio: 'ignore', timeout: 10_000 });
  } catch {
    /* no sqlite3, or no ledger: the plain file copy is the best available */
  }
}

/** Take a snapshot now: one copy of every file that exists, under a stamp directory, then keep only the newest {@link BACKUP_KEEP}. */
export async function createDataBackup(): Promise<DataBackup> {
  // The stamp keeps milliseconds: two snapshots in the same second must not land in one directory.
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '');
  const dir = path.join(backupDir(), `data-${stamp}`);
  checkpointLedger();
  await fs.mkdir(dir, { recursive: true });
  const files: BackupFile[] = [];
  for (const source of dataSources()) {
    if (source.bytes === 0) continue;
    const target = path.join(dir, path.basename(source.source));
    await fs.copyFile(source.source, target);
    files.push({ ...source, bytes: sizeOf(target) });
  }
  await fs.writeFile(manifestPath(dir), JSON.stringify(files.map(({ label, source }) => ({ label, source }))), 'utf8');
  await pruneBackups();
  return { name: path.basename(dir), path: dir, mtime: Date.now(), bytes: files.reduce((sum, f) => sum + f.bytes, 0), files, legacy: false };
}

/** Keep the newest {@link BACKUP_KEEP} snapshots and drop the rest, legacy files included. */
export async function pruneBackups(): Promise<void> {
  const all = listDataBackups();
  for (const old of all.slice(BACKUP_KEEP)) {
    await fs.rm(old.path, { recursive: true, force: true }).catch(() => { /* a locked file goes next time */ });
  }
}

/** A snapshot name resolves to a path inside the backup directory, or null when it does not. */
function resolveBackup(name: string): DataBackup | null {
  if (!name || path.basename(name) !== name || /[\\/]/.test(name)) return null;
  const found = listDataBackups().find((entry) => entry.name === name);
  return found ?? null;
}

/** Put a snapshot back: every file it holds is copied over its live source. A file it lacks is left alone, so a restore never deletes what it does not carry. */
export async function restoreDataBackup(name: string): Promise<boolean> {
  const found = resolveBackup(name);
  if (!found) return false;
  if (found.legacy) {
    await fs.mkdir(path.dirname(usageDbPath()), { recursive: true });
    await fs.copyFile(found.path, usageDbPath());
    return true;
  }
  for (const file of found.files) {
    const from = path.join(found.path, path.basename(file.source));
    await fs.mkdir(path.dirname(file.source), { recursive: true });
    await fs.copyFile(from, file.source);
  }
  return true;
}

/** Remove one snapshot. Only ever touches a path inside the backup directory. */
export async function deleteDataBackup(name: string): Promise<boolean> {
  const found = resolveBackup(name);
  if (!found) return false;
  await fs.rm(found.path, { recursive: true, force: true });
  return true;
}

/** Total size of every snapshot on disk, for the pane's footer. */
export function backupDiskBytes(): number {
  return listDataBackups().reduce((sum, entry) => sum + entry.bytes, 0);
}

/** The home directory the snapshots live under, for the pane's path line. */
export function backupHome(): string {
  return tersioHome();
}
