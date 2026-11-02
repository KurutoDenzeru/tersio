// snapshots.ts — one `.snap` per data snapshot: a 4-byte length, a JSON header, then one gzip body. The header alone lists a snapshot, and every member carries a hash so a restore can refuse a short file.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import { agentDbPath, statsDbPath } from './agent-stats.ts';
import { rtkDbPath } from './rtk-gain.ts';
import { sqliteExec } from './sqlite.ts';
import { usageDbPath } from './usage-store.ts';
import { tersioHome } from './utils.ts';

/** Snapshots kept on disk, newest first; six fills past one screen so the pane scrolls. */
export const BACKUP_KEEP = 14;

const EXT = '.snap';
const LEGACY = /^usage-\d{14}\.db$/;
/** A live database cannot be read without its write-ahead log, so the two travel together. */
const SIDECARS = ['-wal', '-shm'] as const;
const HEADER_LIMIT = 1 << 20;

export interface BackupFile {
  label: string;
  source: string;
  bytes: number;
}

export interface BackupMember extends BackupFile {
  /** File name inside the snapshot. */
  name: string;
  /** Live path this member overwrites on restore. */
  target: string;
  sha256: string;
}

export interface DataBackup {
  name: string;
  path: string;
  mtime: number;
  bytes: number;
  members: BackupMember[];
  /** True for the lone `usage-<stamp>.db` file older builds wrote, which restores over the ledger alone. */
  legacy: boolean;
}

interface SnapHeader {
  v: number;
  app: string;
  createdAt: string;
  /** Uncompressed bytes across every member, checked against the gunzip output. */
  bodyBytes: number;
  /** Packed bytes after the header, so a truncated file is caught without opening the body. */
  packedBytes: number;
  members: BackupMember[];
}

interface Staged {
  member: BackupMember;
  body: Buffer;
}

export function backupDir(): string {
  return path.join(tersioHome(), 'backups');
}

/** Byte size of a file, zero when it is absent or unreadable. */
function sizeOf(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

/** Every file this build snapshots, deduplicated by path: the ledger is also the agent-stats store. */
export function dataSources(): BackupFile[] {
  const declared: Array<[string, string]> = [
    ['Usage ledger', usageDbPath()],
    ['Settings', path.join(tersioHome(), 'settings.json')],
    ['Agent stats', statsDbPath()],
    ['Agent quota windows', agentDbPath()],
    ['Command history', rtkDbPath()],
  ];
  const byPath = new Map<string, BackupFile>();
  for (const [label, source] of declared) {
    const seen = byPath.get(source);
    if (seen) seen.label = `${seen.label}, ${label}`;
    else byPath.set(source, { label, source, bytes: sizeOf(source) });
  }
  return [...byPath.values()];
}

function hash(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}

function member(name: string, label: string, source: string, target: string, body: Buffer): BackupMember {
  return { name, label, source, target, bytes: body.length, sha256: hash(body) };
}

function sql(quoted: string): string {
  return `'${quoted.replace(/'/g, "''")}'`;
}

/** VACUUM INTO reads the committed state, write-ahead log included, and writes one whole database. */
function vacuumInto(from: string, to: string): boolean {
  try {
    fs.rmSync(to, { force: true });
    sqliteExec(from, `VACUUM INTO ${sql(to)};`);
    return fs.existsSync(to);
  } catch {
    return false;
  }
}

/** One source as stored members: a vacuumed database, or the file set when no engine can read it. */
function collect(source: BackupFile): Staged[] {
  const name = path.basename(source.source);
  const spare = path.join(os.tmpdir(), `tersio-snap-${process.pid}-${Math.random().toString(36).slice(2)}.db`);
  if (vacuumInto(source.source, spare)) {
    const body = fs.readFileSync(spare);
    fs.rmSync(spare, { force: true });
    return [{ member: member(name, source.label, source.source, source.source, body), body }];
  }
  const staged: Staged[] = [];
  for (const suffix of ['', ...SIDECARS]) {
    const live = `${source.source}${suffix}`;
    if (!fs.existsSync(live)) continue;
    const body = fs.readFileSync(live);
    const fileName = `${name}${suffix}`;
    staged.push({ member: member(fileName, source.label, source.source, live, body), body });
  }
  return staged;
}

function writeSnap(file: string, staged: Staged[], createdAt: string): void {
  const body = zlib.gzipSync(Buffer.concat(staged.map((entry) => entry.body)), { level: 9 });
  const header: SnapHeader = {
    v: 1,
    app: 'tersio',
    createdAt,
    bodyBytes: staged.reduce((sum, entry) => sum + entry.body.length, 0),
    packedBytes: body.length,
    members: staged.map((entry) => entry.member),
  };
  const head = Buffer.from(JSON.stringify(header), 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32LE(head.length);
  // A crash mid-write must not leave a half snapshot in the listing.
  const tmp = `${file}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, Buffer.concat([length, head, body]));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

/** The header alone, so listing a snapshot never opens its body. */
function readHeader(file: string): { header: SnapHeader; headerBytes: number } | null {
  let fd: number;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return null;
  }
  try {
    const size = Buffer.alloc(4);
    if (fs.readSync(fd, size, 0, 4, 0) !== 4) return null;
    const length = size.readUInt32LE(0);
    if (length === 0 || length > HEADER_LIMIT) return null;
    const head = Buffer.alloc(length);
    if (fs.readSync(fd, head, 0, length, 4) !== length) return null;
    const header = JSON.parse(head.toString('utf8')) as SnapHeader;
    if (header?.v !== 1 || !Array.isArray(header.members)) return null;
    return { header, headerBytes: 4 + length };
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

/** Every member body in header order, hash-checked. Null when the file is short or a hash disagrees. */
function readBodies(file: string): Staged[] | null {
  const found = readHeader(file);
  if (!found) return null;
  try {
    const raw = zlib.gunzipSync(fs.readFileSync(file).subarray(found.headerBytes));
    if (raw.length !== found.header.bodyBytes) return null;
    const staged: Staged[] = [];
    let offset = 0;
    for (const entry of found.header.members) {
      const body = raw.subarray(offset, offset + entry.bytes);
      offset += entry.bytes;
      if (body.length !== entry.bytes || hash(body) !== entry.sha256) return null;
      staged.push({ member: entry, body });
    }
    return offset === raw.length ? staged : null;
  } catch {
    return null;
  }
}

/** A snapshot entry: its size and members, or null when the file is not a readable snapshot. */
function describe(file: string, name: string, mtime: number, bytes: number, legacy: boolean): DataBackup | null {
  if (legacy) {
    return {
      name,
      path: file,
      mtime,
      bytes,
      legacy: true,
      members: [{ name, label: 'Usage ledger', source: usageDbPath(), target: usageDbPath(), bytes, sha256: '' }],
    };
  }
  const found = readHeader(file);
  // A short or unreadable file carries no member, so it never counts as a snapshot worth keeping.
  if (!found || bytes !== found.headerBytes + found.header.packedBytes) return null;
  return { name, path: file, mtime, bytes, legacy: false, members: found.header.members };
}

/** Newest first: the `.snap` files this build wrote, then the lone `usage-*.db` files. */
export function listDataBackups(): DataBackup[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(backupDir());
  } catch {
    return [];
  }
  const found: DataBackup[] = [];
  for (const name of names) {
    const full = path.join(backupDir(), name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) continue;
    const entry = name.endsWith(EXT)
      ? describe(full, name, stat.mtimeMs, stat.size, false)
      : LEGACY.test(name)
        ? describe(full, name, stat.mtimeMs, stat.size, true)
        : null;
    if (entry) found.push(entry);
  }
  return found.toSorted((a, b) => b.mtime - a.mtime);
}

/** The newest snapshot, as the re-parse guard's restore target. */
export function newestDataBackup(): DataBackup | null {
  return listDataBackups()[0] ?? null;
}

export function snapshotMember(backup: DataBackup, name: string): BackupMember | null {
  return backup.members.find((entry) => entry.name === name) ?? null;
}

/** One member's bytes, hash-checked against the header. Null when the snapshot or the member is bad. */
export function readSnapshotMember(backup: DataBackup, name: string): Buffer | null {
  const wanted = snapshotMember(backup, name);
  if (!wanted) return null;
  const staged = backup.legacy
    ? [{ member: wanted, body: fs.readFileSync(backup.path) }]
    : readBodies(backup.path);
  if (!staged) return null;
  return staged.find((entry) => entry.member.name === name)?.body ?? null;
}

/** Write one member over its live path. Needs no safety copy: the caller restores what it just lost. */
export function restoreSnapshotMember(backup: DataBackup, name: string): boolean {
  const wanted = snapshotMember(backup, name);
  if (!wanted) return false;
  const staged = backup.legacy
    ? [{ member: wanted, body: fs.readFileSync(backup.path) }]
    : readBodies(backup.path);
  const found = staged?.find((entry) => entry.member.name === name);
  if (!found) return false;
  return writeMember(found.member, found.body);
}

/** Put one member back, replacing any sidecar it owns so a stale log cannot outlive it. */
function writeMember(entry: BackupMember, body: Buffer): boolean {
  try {
    fs.mkdirSync(path.dirname(entry.target), { recursive: true });
    for (const suffix of SIDECARS) fs.rmSync(`${entry.target}${suffix}`, { force: true });
    const tmp = `${entry.target}.tmp`;
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, entry.target);
    // VACUUM INTO writes the delete journal; the store wants its own mode back.
    if (entry.name.endsWith('.db')) {
      try { sqliteExec(entry.target, 'PRAGMA journal_mode=WAL;'); } catch { /* not a database: the copy is all there is */ }
    }
    return true;
  } catch {
    return false;
  }
}

/** Pack the directories older builds wrote into `.snap` files, then drop each verified directory. */
function migrateDirectories(): void {
  let names: string[] = [];
  try {
    names = fs.readdirSync(backupDir());
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.startsWith('data-')) continue;
    const dir = path.join(backupDir(), name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    let listed: unknown;
    try {
      listed = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    } catch {
      continue;
    }
    if (!Array.isArray(listed) || listed.length === 0) continue;
    const staged: Staged[] = [];
    for (const raw of listed) {
      const record = (raw ?? {}) as Record<string, unknown>;
      const source = String(record.source ?? '');
      if (!source) continue;
      const stored = path.join(dir, path.basename(source));
      if (!fs.existsSync(stored)) continue;
      const body = fs.readFileSync(stored);
      staged.push({ member: member(path.basename(source), String(record.label ?? path.basename(source)), source, source, body), body });
    }
    if (staged.length === 0) continue;
    const file = path.join(backupDir(), `${name}${EXT}`);
    writeSnap(file, staged, new Date(stat.mtimeMs).toISOString());
    if (!readBodies(file)) {
      fs.rmSync(file, { force: true });
      continue;
    }
    // Keep the directory's own stamp, so the pane's order does not jump on the upgrade.
    try { fs.utimesSync(file, new Date(), new Date(stat.mtimeMs)); } catch { /* order only */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** A snapshot stamp: sortable to the millisecond, so the file name is also the order. */
function stampOf(at: Date): string {
  return at.toISOString().replace(/[-:TZ.]/g, '');
}

/** Take a snapshot: one `.snap` file, verified before it counts. Throws when the pack fails. */
export function createDataBackup(): DataBackup {
  fs.mkdirSync(backupDir(), { recursive: true });
  migrateDirectories();
  const at = new Date();
  // Two packs inside one millisecond must not share a file, so the stamp walks forward until the name is free.
  let file = '';
  for (let bump = 0; !file; bump += 1) {
    const candidate = path.join(backupDir(), `data-${stampOf(new Date(at.getTime() + bump))}${EXT}`);
    if (!fs.existsSync(candidate)) file = candidate;
  }
  const staged = dataSources().flatMap((source) => (source.bytes > 0 ? collect(source) : []));
  if (staged.length === 0) throw new Error('no data file to snapshot');
  writeSnap(file, staged, new Date().toISOString());
  if (!readBodies(file)) {
    fs.rmSync(file, { force: true });
    throw new Error('the snapshot failed its own hash check, so it was removed');
  }
  pruneBackups();
  return describe(file, path.basename(file), Date.now(), sizeOf(file), false)
    ?? { name: path.basename(file), path: file, mtime: Date.now(), bytes: sizeOf(file), members: staged.map((entry) => entry.member), legacy: false };
}

/** Keep the newest {@link BACKUP_KEEP} readable snapshots, drop the rest, and retire superseded mirrors. */
export function pruneBackups(): void {
  let names: string[] = [];
  try {
    names = fs.readdirSync(backupDir());
  } catch {
    return;
  }
  const readable: DataBackup[] = [];
  const surplus: string[] = [];
  const broken: string[] = [];
  const mirrors: string[] = [];
  for (const name of names) {
    const full = path.join(backupDir(), name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) continue;
    if (name.endsWith(EXT)) {
      const entry = describe(full, name, stat.mtimeMs, stat.size, false);
      // A listing reads the header alone, but a snapshot whose body fails its hash cannot be restored,
      // so it never counts against the keep limit. Prune runs on a create, so the read cost lands there.
      if (entry && readBodies(full)) readable.push(entry);
      else { surplus.push(full); broken.push(full); }
    } else if (LEGACY.test(name)) {
      mirrors.push(name);
    }
  }
  const kept = readable.toSorted((a, b) => b.mtime - a.mtime).slice(0, BACKUP_KEEP);
  const keep = new Set(kept.map((entry) => entry.name));
  // An unreadable file carries nothing, so it never displaces a snapshot that does.
  for (const entry of readable) if (!keep.has(entry.name)) surplus.push(entry.path);
  for (const file of surplus) fs.rmSync(file, { force: true });
  // A corrupted snapshot is gone for good, so the loss must not be silent.
  if (broken.length > 0) console.warn(`tersio: removed ${broken.length} unreadable snapshot file(s) from ${backupDir()}`);
  const newest = kept[0];
  // A mirror is the ledger alone, so only a snapshot that carries the ledger and is at least as new retires it.
  const ledger = path.basename(usageDbPath());
  if (!newest || !newest.members.some((entry) => entry.name === ledger)) return;
  for (const name of mirrors) {
    if (statOf(path.join(backupDir(), name)) <= newest.mtime) fs.rmSync(path.join(backupDir(), name), { force: true });
  }
}

function statOf(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

/** A snapshot name resolves to an entry inside the backup directory, or null when it does not. */
function resolveBackup(name: string): DataBackup | null {
  if (!name || path.basename(name) !== name || /[\\/]/.test(name)) return null;
  return listDataBackups().find((entry) => entry.name === name) ?? null;
}

/** Restore: the snapshot's members overwrite their live paths; members it lacks stay put, so nothing is lost. */
export function restoreDataBackup(name: string): boolean {
  const found = resolveBackup(name);
  if (!found) return false;
  const staged = found.legacy
    ? [{ member: found.members[0], body: fs.readFileSync(found.path) }]
    : readBodies(found.path);
  if (!staged) return false;
  // Hold the whole snapshot in memory first, so the safety copy cannot take the source away.
  // Nothing on disk means nothing to protect, and the restore must still go through.
  if (dataSources().some((source) => source.bytes > 0)) {
    try {
      createDataBackup();
    } catch {
      return false;
    }
  }
  return staged.every((entry) => writeMember(entry.member, entry.body));
}

/** Remove one snapshot. Only ever touches a path inside the backup directory. */
export function deleteDataBackup(name: string): boolean {
  const found = resolveBackup(name);
  if (!found) return false;
  try {
    fs.rmSync(found.path, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/** Total size of every snapshot on disk, for the pane's footer. */
export function backupDiskBytes(): number {
  return listDataBackups().reduce((sum, entry) => sum + entry.bytes, 0);
}