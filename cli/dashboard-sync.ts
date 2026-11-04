// Remote backups: seal a local snapshot, upload it to the configured home, and put one back on request.
import fs from 'node:fs';
import path from 'node:path';
import { open, seal } from '../extensions/shared/sync-seal.ts';
import { REMOTE_EXT, remoteFor } from '../extensions/shared/sync-remote.ts';
import type { RemoteEntry, SyncConfig, SyncMode } from '../extensions/shared/sync-remote.ts';
import { backupDir, createDataBackup, listDataBackups, restoreDataBackup } from '../extensions/shared/snapshots.ts';
import { tersioHome } from '../extensions/shared/utils.ts';

export interface StoredSync {
  config: SyncConfig | null;
  /** Kept so a scheduled backup needs no prompt; the file is 0600 and never leaves this computer. */
  passphrase: string;
}

export interface SyncView {
  configured: boolean;
  mode: SyncMode | null;
  target: string;
  passphraseSet: boolean;
  versions: RemoteEntry[];
  /** Why the last request failed, so the panel can say it instead of guessing. */
  error: string | null;
}

const FILE = 'sync.json';
/** The write probe's name: not `.tsb`, so no version list ever shows it. */
const FOLDER_PROBE = 'tersio-write-probe.tmp';

/** A blank configuration the panel edits field by field; every protocol keeps its own rows. */
export function emptyConfig(): SyncConfig {
  return {
    mode: 'webdav',
    webdav: { address: '', user: '', password: '' },
    s3: { endpoint: '', bucket: '', prefix: '', region: 'us-east-1', accessKey: '', secret: '', sessionToken: '', pathStyle: false },
    github: { repository: '', branch: '', folder: '', token: '' },
  };
}

/** Copy only the fields a protocol owns, so a request body cannot smuggle others into the file. */
export function applyTarget(mode: SyncMode, input: Record<string, unknown>, base: SyncConfig): SyncConfig {
  const text = (key: string): string => (typeof input[key] === 'string' ? String(input[key]).trim() : '');
  const next: SyncConfig = { ...base, mode };
  // A blank secret means "keep the saved one": the panel never receives it, so it cannot echo it back.
  if (mode === 'webdav') next.webdav = { address: text('address'), user: text('user'), password: text('password') || base.webdav.password };
  if (mode === 's3') next.s3 = { endpoint: text('endpoint'), bucket: text('bucket'), prefix: text('prefix'), region: text('region') || 'us-east-1', accessKey: text('accessKey'), secret: text('secret') || base.s3.secret, sessionToken: text('sessionToken') || base.s3.sessionToken, pathStyle: input.pathStyle === true };
  if (mode === 'github') next.github = { repository: text('repository'), branch: text('branch'), folder: text('folder'), token: text('token') || base.github.token };
  return next;
}

export function syncFile(): string {
  return path.join(tersioHome(), FILE);
}

function empty(): StoredSync {
  return { config: null, passphrase: '' };
}

export function readSync(): StoredSync {
  try {
    const raw = JSON.parse(fs.readFileSync(syncFile(), 'utf8')) as Partial<StoredSync>;
    const config = raw.config && typeof raw.config === 'object' ? raw.config as SyncConfig : null;
    return { config, passphrase: typeof raw.passphrase === 'string' ? raw.passphrase : '' };
  } catch {
    return empty();
  }
}

export function saveSync(next: StoredSync): void {
  fs.mkdirSync(tersioHome(), { recursive: true });
  // Temp file then rename, so a crash cannot leave a half-written config or lose the passphrase.
  const target = syncFile();
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, target);
  try { fs.chmodSync(target, 0o600); } catch { /* a filesystem without modes still wrote the file */ }
}

/** Everything the panel may prefill. Passwords and tokens stay out: the panel only learns they are saved. */
export function publicFields(config: SyncConfig | null): Record<string, unknown> {
  if (!config) return {};
  const { mode, webdav, s3, github } = config;
  return { mode, webdav: { address: webdav.address, user: webdav.user }, s3: { endpoint: s3.endpoint, bucket: s3.bucket, prefix: s3.prefix, region: s3.region, accessKey: s3.accessKey, pathStyle: s3.pathStyle }, github: { repository: github.repository, branch: github.branch, folder: github.folder } };
}

/** What the panel shows at a glance: never the secrets. */
export function syncTarget(config: SyncConfig | null): string {
  if (!config) return '';
  if (config.mode === 'webdav') return config.webdav.address;
  if (config.mode === 's3') return [config.s3.endpoint, config.s3.bucket].filter(Boolean).join(' · ');
  return [config.github.repository, config.github.folder || 'tersio'].filter(Boolean).join(' · ');
}

function requireReady(saved: StoredSync): SyncConfig {
  if (!saved.config) throw new Error('no sync target is set up yet');
  if (!saved.passphrase.trim()) throw new Error('set a passphrase before backing up');
  return saved.config;
}

/** Take a snapshot, seal it, and upload it. Returns the remote name so the panel can name it. */
export async function runSync(): Promise<{ name: string; bytes: number }> {
  const saved = readSync();
  const config = requireReady(saved);
  const backup = createDataBackup();
  const sealed = seal(fs.readFileSync(backup.path), saved.passphrase);
  const name = backup.name.replace(/\.snap$/, '') + REMOTE_EXT;
  await remoteFor(config).put(name, sealed);
  return { name, bytes: sealed.length };
}

/** Prove the saved credentials reach the remote, can write, and can read the folder back. */
export async function testTarget(config: SyncConfig): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  try {
    const remote = remoteFor(config);
    await remote.put(FOLDER_PROBE, Buffer.from('tersio write probe'));
    try {
      await remote.remove(FOLDER_PROBE);
    } catch (caught) {
      return { ok: false, error: `the backup uploaded, but deleting it failed: ${(caught as Error).message}` };
    }
    const versions = await remote.list();
    return { ok: true, count: versions.length };
  } catch (caught) {
    return { ok: false, error: (caught as Error).message || 'the remote did not answer' };
  }
}

export async function listSyncVersions(): Promise<RemoteEntry[]> {
  const saved = readSync();
  if (!saved.config) return [];
  return remoteFor(saved.config).list();
}

/** Keep the current state as a local snapshot first, so a restore is never a one-way door. */
export async function restoreSync(name: string): Promise<{ backup: string }> {
  const saved = readSync();
  const config = requireReady(saved);
  const sealed = await remoteFor(config).get(name);
  const body = open(sealed, saved.passphrase);
  const local = name.replace(/\.tsb$/, '') + '.snap';
  const target = path.join(backupDir(), local);
  fs.mkdirSync(backupDir(), { recursive: true });
  fs.writeFileSync(target, body);
  // describe() refuses a bad header, so the list is the validity check before anything is overwritten.
  if (!listDataBackups().some((entry) => entry.name === local)) {
    fs.rmSync(target, { force: true });
    throw new Error('that backup is not a Tersio snapshot');
  }
  const safety = createDataBackup();
  if (!restoreDataBackup(local)) throw new Error('the snapshot could not be restored');
  return { backup: safety.name };
}
