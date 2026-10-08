// /ai-addons manual updater. Node built-ins only. RTK ships SHA256 checksums with no signature, so checksum-only is the best available.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { setExtensionLabel } from '../shared/host.ts';
import {
  CAVEMAN_REMOTE_ULTRA,
  CAVEMAN_REMOTE_MEGACAVE,
  RTK_RELEASE_API,
  type RtkRelease,
  fetchJson,
  findFile,
  findHoistedPackage,
  httpsGet,
  httpsDownload,
  sha256Hex,
  parseChecksum,
  normalizeRtkVersion,
  readTextIfExists,
  rtkPlatformSpec,
  resolveRtkBinary,
} from '../lib/utils.ts';

const IS_WINDOWS = process.platform === 'win32';
const EXTENSION_DIR = path.dirname(fileURLToPath(import.meta.url));

const PONYTAIL_REMOTE = 'https://raw.githubusercontent.com/DietrichGebert/ponytail/main/package.json';
const RTK_BINARY = resolveRtkBinary();
// Beside this file, not a host path: these are the rules /caveman reads.
const cavemanRule = (name: string) => path.join(EXTENSION_DIR, '..', 'caveman-session', name);
const CAVEMAN_LOCAL = cavemanRule('rule.md');
const CAVEMAN_TRACKED: ReadonlyArray<{ file: string; remote: string }> = [
  { file: cavemanRule('rule-ultra.md'), remote: CAVEMAN_REMOTE_ULTRA },
  { file: cavemanRule('rule-megacave.md'), remote: CAVEMAN_REMOTE_MEGACAVE },
];
// Host-neutral: this updater runs inside pi, OMP, and OpenCode alike.
const RELOAD_MSG = 'Reminder: restart your agent (or reload extensions) for updates to take effect.';

// Ponytail is a hoisted dependency, so the installed copy is found by walking up rather than by naming a host directory.
function ponytailLocal(): string | null {
  return findHoistedPackage('@dietrichgebert/ponytail', EXTENSION_DIR, 'package.json');
}

// --- Types ---

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

interface AddonStatus {
  text: string;
  level: NotifyLevel;
}

function shortHash(text: string): string {
  return sha256Hex(text).slice(0, 16);
}

function checkFailed(name: string, e: unknown): AddonStatus {
  return { text: `${name} check failed: ${(e as Error).message}`, level: 'warning' };
}

function runCheck(name: string, probe: () => Promise<string>): Promise<AddonStatus> {
  return probe().then((text) => ({ text, level: 'info' as const }), (e) => checkFailed(name, e));
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

function checkPonytail(): Promise<AddonStatus> {
  return runCheck('Ponytail', async () => {
    const remoteJson = await fetchJson<{ version?: string }>(PONYTAIL_REMOTE);
    const localRaw = await readTextIfExists(ponytailLocal() ?? '');
    const localVer = parsePackageVersion(localRaw);
    const remoteVer = remoteJson.version;
    const status = !localVer ? 'not installed'
      : localVer === remoteVer ? 'up to date'
        : 'update available';
    return `Ponytail ${status}: local=${localVer || '—'} latest=${remoteVer}`;
  });
}

async function fetchRelease(): Promise<RtkRelease> {
  return fetchJson<RtkRelease>(RTK_RELEASE_API);
}

function checkRtk(): Promise<AddonStatus> {
  return runCheck('RTK', async () => {
    const release = await fetchRelease();
    const latestTag = release.tag_name || null;
    let localVer: string | null = null;
    try {
      if (!RTK_BINARY) throw new Error('rtk not found in PATH');
      const out = execFileSync(RTK_BINARY, ['--version'], { encoding: 'utf8', windowsHide: true, shell: false, timeout: 10000 }) || '';
      if (out) localVer = out.trim().split(/\r?\n/)[0];
    } catch { localVer = null; }
    const status = localVer === null ? 'not installed'
      : normalizeRtkVersion(localVer) === normalizeRtkVersion(latestTag ?? undefined) ? 'up to date'
        : 'update available';
    return `RTK ${status}: local=${localVer || '—'} latest=${latestTag || '—'}`;
  });
}

function checkCaveman(): Promise<AddonStatus> {
  return runCheck('Caveman', async () => {
    const parts: string[] = [(await readTextIfExists(CAVEMAN_LOCAL)) ? 'rule.md ok' : 'rule.md missing'];
    for (const { file, remote } of CAVEMAN_TRACKED) {
      const name = path.basename(file);
      try {
        const [remoteText, localText] = await Promise.all([httpsGet(remote), readTextIfExists(file)]);
        parts.push(!localText ? `${name} missing` : shortHash(localText) === shortHash(remoteText) ? `${name} up to date` : `${name} update available`);
      } catch {
        parts.push(`${name} check skipped`);
      }
    }
    return `Caveman ${parts.join(', ')}`;
  });
}

export async function checkAddonsSummary(ctx: AddonUpdaterCtx): Promise<string> {
  return checkAddons(ctx);
}

export async function runAddonUpdate(pi: { exec?: AddonUpdaterPi['exec'] }, ctx: AddonUpdaterCtx, target: string, dryRun = false): Promise<string> {
  const results: string[] = [];
  const updaters: Record<string, () => Promise<string>> = {
    ponytail: () => updatePonytail(pi, ctx, dryRun),
    rtk: () => updateRtk(ctx, dryRun),
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
  return results.join('\n\n');
}

async function checkAddons(ctx: AddonUpdaterCtx): Promise<string> {
  const [ponytail, rtk, caveman] = await Promise.all([checkPonytail(), checkRtk(), checkCaveman()]);
  const lines: string[] = [];
  for (const status of [ponytail, rtk, caveman]) {
    lines.push(status.text);
    notify(ctx, status.text, status.level);
  }
  return lines.join('\n');
}

// Ponytail is a hoisted dependency; replace its package dir from the npm tarball.
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
      throw new Error(`${(e as Error).message}; restored backup`);
    }
    await fs.rm(backupDir, { recursive: true, force: true }).catch(() => { });
    return report(ctx, `Ponytail updated → ${remoteVer} at ${destDir}\n${RELOAD_MSG}`, 'info');
  } catch (e) {
    return report(ctx, `Ponytail update failed: ${(e as Error).message}`, 'warning');
  } finally {
    fs.rm(tmp, { recursive: true, force: true }).catch(() => { });
  }
}

async function updateRtk(ctx: AddonUpdaterCtx, dryRun = false): Promise<string> {
  let release: RtkRelease;
  try {
    release = await fetchRelease();
  } catch (e) {
    const m = `RTK: cannot fetch release info: ${(e as Error).message}`;
    return report(ctx, m, 'warning');
  }
  const tag = release.tag_name || 'unknown';
  const assets = Array.isArray(release.assets) ? release.assets : [];
  if (!RTK_BINARY) return report(ctx, 'RTK: executable not found in PATH', 'warning');

  const PLATFORM = process.platform;
  const ARCH = process.arch;
  const spec = rtkPlatformSpec(PLATFORM, ARCH);
  if (!spec) {
    const m = `RTK: unsupported platform ${PLATFORM}/${ARCH}`;
    return report(ctx, m, 'warning');
  }
  const { triple: assetTriple, ext: assetExt, binary: binaryName } = spec;

  const asset = assets.find((a) => a.name === `rtk-${assetTriple}${assetExt}`);
  const checksAsset = assets.find((a) => a.name === 'checksums.txt');
  if (!asset || !checksAsset) {
    const m = `RTK: required assets not found in release ${tag} (need rtk-${assetTriple}${assetExt} and checksums.txt)`;
    return report(ctx, m, 'warning');
  }

  if (dryRun) {
    const m = `RTK dry-run: would download ${asset.name} (${tag}), verify checksums.txt, and replace ${RTK_BINARY}.`;
    return report(ctx, m, 'info');
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rtk-update-'));
  const archivePath = path.join(tmp, asset.name);
  const checksPath = path.join(tmp, 'checksums.txt');

  try {
    notify(ctx, `RTK: downloading ${asset.name} (${tag})…`, 'info');
    notify(ctx, 'RTK: downloading checksums.txt…', 'info');
    await Promise.all([
      httpsDownload(asset.browser_download_url, archivePath),
      httpsDownload(checksAsset.browser_download_url, checksPath),
    ]);
    const checks = await fs.readFile(checksPath, 'utf8');
    const expected = parseChecksum(checks, asset.name);
    if (!expected) {
      const m = `RTK: checksums.txt has no entry for ${asset.name}; not installing`;
      return report(ctx, m, 'error');
    }
    const archiveBuf = await fs.readFile(archivePath);
    const actual = createHash('sha256').update(archiveBuf).digest('hex').toLowerCase();
    if (actual !== expected) {
      const m = `RTK: checksum mismatch! expected=${expected.slice(0, 12)}… actual=${actual.slice(0, 12)}…; not installing`;
      return report(ctx, m, 'error');
    }
    notify(ctx, 'RTK: checksum verified.', 'info');

    const extractDir = path.join(tmp, 'extracted');
    await fs.mkdir(extractDir, { recursive: true });

    if (asset.name.endsWith('.zip')) {
      if (IS_WINDOWS) {
        execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
          `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${extractDir}' -Force`],
          { encoding: 'utf8', windowsHide: true, shell: false });
      } else {
        execFileSync('unzip', [archivePath, '-d', extractDir], { encoding: 'utf8', shell: false });
      }
    } else if (asset.name.endsWith('.tar.gz') || asset.name.endsWith('.tgz')) {
      try {
        execFileSync('tar', ['xzf', archivePath, '-C', extractDir], { encoding: 'utf8', shell: false });
      } catch (e) {
        throw new Error(`tar could not extract ${asset.name}: ${(e as Error).message}`);
      }
    } else {
      throw new Error(`Unknown archive format: ${asset.name}`);
    }
    const rtkExtracted = await findFile(extractDir, binaryName);
    if (!rtkExtracted) {
      const m = `RTK: ${binaryName} not found in extracted archive`;
      return report(ctx, m, 'warning');
    }
    await fs.mkdir(path.dirname(RTK_BINARY), { recursive: true });
    const backupPath = `${RTK_BINARY}.bak`;
    const backedUp = await fs.copyFile(RTK_BINARY, backupPath).then(() => true, () => false);

    await fs.copyFile(rtkExtracted, RTK_BINARY);

    if (!IS_WINDOWS) {
      await fs.chmod(RTK_BINARY, 0o755);
    }

    let versionOut = '';
    try {
      versionOut = execFileSync(RTK_BINARY, ['--version'], { encoding: 'utf8', windowsHide: true, shell: false, timeout: 10000 }).trim();
    } catch (e) {
      if (backedUp) await fs.copyFile(backupPath, RTK_BINARY);
      throw new Error(`new ${binaryName} failed --version${backedUp ? '; restored backup' : ''}: ${(e as Error).message}`);
    }
    if (normalizeRtkVersion(versionOut) !== normalizeRtkVersion(tag)) {
      if (backedUp) await fs.copyFile(backupPath, RTK_BINARY);
      throw new Error(`new ${binaryName} reports ${versionOut}, expected ${tag}${backedUp ? '; restored backup' : ''}`);
    }
    const m = `RTK updated to ${tag} → ${RTK_BINARY}\nbackup=${backedUp ? backupPath : '—'}\n${RELOAD_MSG}`;
    notify(ctx, 'RTK update finished. ' + RELOAD_MSG, 'info');
    return m;
  } catch (e) {
    const m = `RTK update failed: ${(e as Error).message}`;
    return report(ctx, m, 'warning');
  } finally {
    fs.rm(tmp, { recursive: true, force: true }).catch(() => { });
  }
}

async function updateCaveman(ctx: AddonUpdaterCtx, dryRun = false): Promise<string> {
  const results: string[] = [];
  for (const { file, remote } of CAVEMAN_TRACKED) {
    const name = path.basename(file);
    let remoteText: string;
    try { remoteText = await httpsGet(remote); }
    catch (e) { results.push(report(ctx, `Caveman ${name} update failed: ${(e as Error).message}`, 'warning')); continue; }

    const remoteHash = shortHash(remoteText);
    const oldLocal = await readTextIfExists(file);
    const oldHash = oldLocal ? shortHash(oldLocal) : null;
    if (oldHash === remoteHash) { results.push(`${name} up to date: ${remoteHash}`); continue; }

    if (dryRun) {
      results.push(`Caveman dry-run: would write ${file}\nold=${oldHash || '—'} new=${remoteHash}.`);
      continue;
    }

    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const backupPath = `${file}.bak`;
      if (oldLocal !== null) await fs.writeFile(backupPath, oldLocal, 'utf8');
      await fs.writeFile(file, remoteText, 'utf8');
      const writtenHash = shortHash(await fs.readFile(file, 'utf8'));
      if (writtenHash !== remoteHash) {
        if (oldLocal !== null) await fs.writeFile(file, oldLocal, 'utf8');
        throw new Error(`written hash ${writtenHash} did not match remote ${remoteHash}${oldLocal !== null ? '; restored backup' : ''}`);
      }
      results.push(`Caveman ${name} updated → ${file}\nold=${oldHash || '—'} new=${remoteHash}\nbackup=${oldLocal !== null ? backupPath : '—'}\n${RELOAD_MSG}`);
    } catch (e) {
      results.push(`Caveman ${name} update failed: ${(e as Error).message}`);
    }
  }
  const summary = results.join('\n');
  notify(ctx, `Caveman update finished. ${RELOAD_MSG}`, 'info');
  return summary;
}

export default function aiAddonsUpdaterExtension(pi: AddonUpdaterPi): void {
  setExtensionLabel(pi, 'AI add-ons updater');

  pi.registerCommand?.('ai-addons', {
    description: 'Check or update AI add-ons (ponytail/rtk/caveman/all). Usage: /ai-addons <check|status|update ponytail|rtk|caveman|all> [--dry-run]',
    handler: async (args, ctx) => {
      const arg = String(args || '').trim().toLowerCase();
      const parts = arg.split(/\s+/).filter(Boolean);
      const dryRun = parts.includes('--dry-run') || parts.includes('dry-run');
      const cleanParts = parts.filter((p) => p !== '--dry-run' && p !== 'dry-run');
      const sub = cleanParts[0];

      if (sub === 'check' || sub === 'status') {
        await checkAddons(ctx);
        notify(ctx, 'ai-addons check complete.', 'info');
        return;
      }
      if (sub === 'update' && cleanParts[1]) {
        await runAddonUpdate(pi, ctx, cleanParts.slice(1).join(' '), dryRun);
        return;
      }
      report(ctx, 'Usage: /ai-addons <check|status|update ponytail|rtk|caveman|all> [--dry-run]', 'warning');
      return;
    },
  });
}

export { parseChecksum };
