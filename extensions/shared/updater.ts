// The in-session add-on updater behind /tersio update. Node built-ins only. rtk's binary is its own to update.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { patchState } from './state.ts';
import {
  CAVEMAN_BODY_PATHS,
  CAVEMAN_RAW,
  RTK_INSTALL_DOCS,
  RTK_RELEASE_API,
  cavemanRelease,
  fetchJson,
  homeDir,
  httpsGet,
  httpsDownload,
  sha256Hex,
  findFile,
  parseChecksum,
  normalizeRtkVersion,
  readTextIfExists,
  resolveRtkBinary,
} from './utils.ts';
import type { RtkRelease } from './utils.ts';

const EXTENSION_DIR = path.dirname(fileURLToPath(import.meta.url));

const RTK_BINARY = resolveRtkBinary();
// Beside this file: a retired agent-tree copy has no `caveman` sibling, so fall back to the OMP plugin.
const CAVEMAN_SIBLING = (name: string): string => path.join(EXTENSION_DIR, '..', 'caveman', name);

function cavemanRule(name: string): string {
  const beside = CAVEMAN_SIBLING(name);
  if (fsSync.existsSync(beside)) return beside;
  const plugin = path.join(homeDir(), '.omp', 'plugins', 'node_modules', '@krtclcdy', 'tersio', 'extensions', 'caveman', name);
  return fsSync.existsSync(plugin) ? plugin : beside;
}

const CAVEMAN_LOCAL = cavemanRule('rule.md');
// `rule.md` is upstream's body with one adapted line, so a refresh re-applies the adaptation.
const adaptCavemanFull = (text: string): string =>
  text.replace('`/caveman-compress` exempt.', '`/caveman-compress`, where the host offers it, is exempt.');
const CAVEMAN_TRACKED: ReadonlyArray<{ file: string; body: string; adapt?: (text: string) => string }> = [
  { file: CAVEMAN_LOCAL, body: CAVEMAN_BODY_PATHS.full, adapt: adaptCavemanFull },
  { file: cavemanRule('rule-ultra.md'), body: CAVEMAN_BODY_PATHS.ultra },
  { file: cavemanRule('rule-megacave.md'), body: CAVEMAN_BODY_PATHS.megacave },
];

/** One body at a published release, so a fetch names the version it wrote. */
function cavemanBodyUrl(tag: string, body: string): string {
  return `${CAVEMAN_RAW}/${tag}/${body}`;
}
export { adaptCavemanFull };
// Host-neutral: this updater runs inside pi, OMP, and OpenCode alike.
const RELOAD_MSG = 'Reminder: restart your agent (or reload extensions) for updates to take effect.';

// Ponytail rides inside this extension tree, so its copy is a fixed path, not an upward walk.
function ponytailLocal(): string | null {
  const pkg = path.join(EXTENSION_DIR, '..', 'ponytail', 'package.json');
  return fsSync.existsSync(pkg) ? pkg : null;
}

// A missing file is "not installed"; an unreadable one is a reportable fault.
function parsePackageVersion(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return (JSON.parse(raw) as { version?: string }).version ?? null;
  } catch {
    throw new Error('ponytail package.json is not readable JSON');
  }
}

function shortHash(text: string): string {
  return sha256Hex(text).slice(0, 16);
}

interface AddonUpdaterCtx {
  cwd?: string;
  ui?: {
    notify?: (message: string, level?: string) => void;
  };
}

interface AddonUpdaterPi {
  setLabel?: (label: string) => void;
  registerCommand?: (name: string, config: { description: string; handler: (args: string, ctx: AddonUpdaterCtx) => Promise<void> }) => void;
  exec?: (cmd: string, args: string[], opts?: { cwd?: string }) => Promise<{ stdout: string; stderr: string; code: number }>;
  cwd?: string;
}

type NotifyLevel = 'info' | 'warning' | 'error';

function notify(ctx: AddonUpdaterCtx | undefined, msg: string, level: NotifyLevel): void {
  ctx?.ui?.notify?.(String(msg), level);
}

function report(ctx: AddonUpdaterCtx | undefined, msg: string, level: NotifyLevel): string {
  notify(ctx, msg, level);
  return msg;
}

export async function runAddonUpdate(pi: { exec?: AddonUpdaterPi['exec'] }, ctx: AddonUpdaterCtx, target: string, dryRun = false): Promise<string> {
  const results: string[] = [];
  const updaters: Record<string, () => Promise<string>> = {
    ponytail: () => updatePonytail(pi, ctx, dryRun),
    rtk: () => updateRtk(ctx),
    caveman: () => updateCaveman(ctx, dryRun),
  };
  if (target === 'all') {
    notify(ctx, `ai-addons update all${dryRun ? ' dry-run' : ''}: starting ponytail → rtk → caveman sequentially…`, 'info');
    for (const name of ['ponytail', 'rtk', 'caveman']) results.push(await updaters[name]());
    if (!dryRun) results.push(RELOAD_MSG);
    notify(ctx, `ai-addons update all ${dryRun ? 'dry-run ' : ''}complete.${dryRun ? '' : ` ${RELOAD_MSG}`}`, 'info');
  } else if (Object.hasOwn(updaters, target)) {
    results.push(await updaters[target]());
  } else {
    const m = 'Usage: /ai-addons update <ponytail|rtk|caveman|all> [--dry-run]';
    return report(ctx, m, 'warning');
  }
  const out = results.join('\n\n');
  // The per-file report names the release a body came from, so it reaches the user and not only the caller.
  if (out.trim()) notify(ctx, out, 'info');
  return out;
}

async function updatePonytail(pi: AddonUpdaterPi, ctx: AddonUpdaterCtx, dryRun = false): Promise<string> {
  void pi;
  const localPkg = ponytailLocal();
  let localVer: string | null = null;
  try { localVer = localPkg ? parsePackageVersion(await readTextIfExists(localPkg)) : null; } catch { localVer = null; }
  if (!localPkg) return report(ctx, 'Ponytail: package.json not found; reinstall with `tersio update`.', 'warning');

  let meta: { version?: string; dist?: { tarball?: string; shasum?: string } };
  try {
    meta = await fetchJson('https://registry.npmjs.org/@dietrichgebert/ponytail/latest');
  } catch (e) {
    return report(ctx, `Ponytail: cannot fetch npm metadata: ${(e as Error).message}`, 'warning');
  }
  const remoteVer = meta.version;
  if (!remoteVer) return report(ctx, 'Ponytail: npm metadata has no version.', 'warning');
  if (localVer === remoteVer) return report(ctx, `Ponytail up to date: local=${localVer} latest=${remoteVer}`, 'info');
  if (!meta.dist?.tarball) return report(ctx, 'Ponytail: npm metadata has no tarball.', 'warning');

  if (dryRun) return report(ctx, `Ponytail dry-run: would install ${remoteVer} over ${localVer || '—'} at ${path.dirname(localPkg)}.`, 'info');

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ponytail-update-'));
  try {
    const tarballPath = path.join(tmp, 'pkg.tgz');
    notify(ctx, `Ponytail: downloading ${remoteVer}…`, 'info');
    await httpsDownload(meta.dist.tarball, tarballPath);
    if (meta.dist.shasum) {
      const actual = createHash('sha1').update(await fs.readFile(tarballPath)).digest('hex');
      if (actual !== meta.dist.shasum) return report(ctx, `Ponytail: sha1 mismatch; expected ${meta.dist.shasum.slice(0, 12)}…, got ${actual.slice(0, 12)}…; not installing`, 'error');
    }
    const extractDir = path.join(tmp, 'out');
    await fs.mkdir(extractDir, { recursive: true });
    execFileSync('tar', ['xzf', tarballPath, '-C', extractDir], { encoding: 'utf8', shell: false });
    const newPkgJson = await findFile(extractDir, 'package.json');
    if (!newPkgJson) return report(ctx, 'Ponytail: package.json not in tarball.', 'warning');
    const newDir = path.dirname(newPkgJson);
    const destDir = path.dirname(localPkg);
    const backupDir = `${destDir}.bak`;
    // fs.rename cannot cross filesystems (tmp vs home), so copy then verify.
    await fs.rename(destDir, backupDir);
    try {
      await fs.cp(newDir, destDir, { recursive: true });
      const written = parsePackageVersion(await readTextIfExists(path.join(destDir, 'package.json')));
      if (written !== remoteVer) throw new Error(`installed version ${written} !== ${remoteVer}`);
    } catch (e) {
      await fs.rm(destDir, { recursive: true, force: true }).catch(() => { });
      await fs.rename(backupDir, destDir).catch(() => { });
      throw new Error(`${(e as Error).message}; restored backup`, { cause: e });
    }
    await fs.rm(backupDir, { recursive: true, force: true }).catch(() => { });
    return report(ctx, `Ponytail updated → ${remoteVer} at ${destDir}\n${RELOAD_MSG}`, 'info');
  } catch (e) {
    return report(ctx, `Ponytail update failed: ${(e as Error).message}`, 'warning');
  } finally {
    fs.rm(tmp, { recursive: true, force: true }).catch(() => { });
  }
}

/** rtk updates itself through its own installer; this reports whether one is waiting, and never touches the binary. */
async function updateRtk(ctx: AddonUpdaterCtx): Promise<string> {
  if (!RTK_BINARY) return report(ctx, `RTK: not installed — get it from ${RTK_INSTALL_DOCS}`, 'warning');
  let local: string;
  try {
    local = normalizeRtkVersion(execFileSync(RTK_BINARY, ['--version'], { encoding: 'utf8', windowsHide: true, shell: false, timeout: 10000 }).trim());
  } catch (e) {
    return report(ctx, `RTK: ${RTK_BINARY} --version failed: ${(e as Error).message}`, 'warning');
  }
  let latest: string;
  try {
    latest = normalizeRtkVersion((await fetchJson<RtkRelease>(RTK_RELEASE_API)).tag_name);
  } catch (e) {
    return report(ctx, `RTK ${local}: cannot fetch release info: ${(e as Error).message}`, 'warning');
  }
  if (!latest || latest === local) return report(ctx, `RTK ${local} is up to date.`, 'info');
  return report(ctx, `RTK ${latest} is available (installed ${local}). Tersio does not install the binary — update it with the rtk installer: ${RTK_INSTALL_DOCS}`, 'info');
}

async function updateCaveman(ctx: AddonUpdaterCtx, dryRun = false): Promise<string> {
  const results: string[] = [];
  const tag = await cavemanRelease();
  if (!tag) {
    results.push(report(ctx, 'Caveman update failed: no published release could be read', 'warning'));
    return results.join('\n');
  }
  for (const { file, body, adapt } of CAVEMAN_TRACKED) {
    const name = path.basename(file);
    let remoteText: string;
    try { remoteText = await httpsGet(cavemanBodyUrl(tag, body)); }
    catch (e) { results.push(report(ctx, `Caveman ${name} update failed: ${(e as Error).message}`, 'warning')); continue; }

    // A tracked fork compares against the text it would write, so an adapted body still reads up to date.
    const nextText = adapt ? adapt(remoteText) : remoteText;
    const remoteHash = shortHash(nextText);
    const oldLocal = await readTextIfExists(file);
    const oldHash = oldLocal ? shortHash(oldLocal) : null;
    if (oldHash === remoteHash) { results.push(`${name} up to date: ${remoteHash} (release ${tag})`); continue; }

    if (dryRun) {
      results.push(`Caveman dry-run: would write ${file}\nold=${oldHash || '—'} new=${remoteHash}.`);
      continue;
    }

    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const backupPath = `${file}.bak`;
      if (oldLocal !== null) await fs.writeFile(backupPath, oldLocal, 'utf8');
      await fs.writeFile(file, nextText, 'utf8');
      const writtenHash = shortHash(await fs.readFile(file, 'utf8'));
      if (writtenHash !== remoteHash) {
        if (oldLocal !== null) await fs.writeFile(file, oldLocal, 'utf8');
        throw new Error(`written hash ${writtenHash} did not match remote ${remoteHash}${oldLocal !== null ? '; restored backup' : ''}`);
      }
      results.push(`Caveman ${name} updated → ${file}\nold=${oldHash || '—'} new=${remoteHash} release=${tag}\nbackup=${oldLocal !== null ? backupPath : '—'}\n${RELOAD_MSG}`);
    } catch (e) {
      results.push(`Caveman ${name} update failed: ${(e as Error).message}`);
    }
  }
  if (!dryRun && tag) patchState({ cavemanUpstream: { tag, at: Date.now() } });
  const summary = results.join('\n');
  notify(ctx, `Caveman update finished. ${RELOAD_MSG}`, 'info');
  return summary;
}

export { parseChecksum };
export default function updaterExtension(): void {}
