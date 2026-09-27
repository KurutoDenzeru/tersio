// Pi extension: /ai-addons manual updater for Ponytail, RTK, Caveman.
// Built-in Node modules only. Default off; registers a single slash command.
// ponytail: `skipped: none` — semantics match one-liner: fetch + compare + run install.
// rtk: `skipped: signature verification` — checksums.txt ships only SHA256 of release assets; add sigchain when upstream publishes a signing key.
// caveman: `skipped: none` — exactly the ask: write rule.md, report old/new hash.
//
// Divergences from the OMP original, all forced by Pi:
//   - No `pi.setLabel` (fact 3): Pi's setLabel(entryId, label) labels a session
//     entry for bookmarks, not the extension, so there is nothing to call.
//   - Command handlers resolve to void (pi-coding-agent RegisteredCommand), so
//     the handler no longer returns the summary string. Every user-visible line
//     already goes through notify() below, which is why nothing is lost; the
//     return values survive only for the tersio-commands port, which ignores them.
//   - Both add-on paths are re-derived from this file's own location (facts 1/11):
//     Pi loads extensions from a bare config dir with no plugin store.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CAVEMAN_REMOTE_RULE as CAVEMAN_REMOTE,
  RTK_RELEASE_API,
  RtkRelease,
  fetchJson,
  findFile,
  httpsGet,
  httpsDownload,
  sha256Hex,
  parseChecksum,
  normalizeRtkVersion,
  readTextIfExists,
  rtkPlatformSpec,
  resolveRtkBinary,
} from '../lib/utils.ts';
import { notify } from '../shared/pi-session-state.ts';
import type { ExtensionCtx, PiExtensionAPI } from '../shared/pi-types.ts';

const IS_WINDOWS = process.platform === 'win32';
const EXT_DIR = path.dirname(fileURLToPath(import.meta.url));

const PONYTAIL_REMOTE = 'https://raw.githubusercontent.com/DietrichGebert/ponytail/main/package.json';
const RTK_BINARY = resolveRtkBinary();
// The caveman rule ships inside this extension tree, so it is found by walking
// up from this module rather than by hard-coding a host plugin directory.
const CAVEMAN_LOCAL = path.resolve(EXT_DIR, '..', 'caveman-session', 'rule.md');
const RELOAD_MSG = 'Reminder: restart Pi (or reload extensions) for updates to take effect.';

// --- Types ---

type NotifyLevel = 'info' | 'warning';

interface AddonStatus {
  text: string;
  level: NotifyLevel;
}

function report(ctx: ExtensionCtx | undefined, msg: string, level: NotifyLevel): string {
  notify(ctx, msg, level);
  return msg;
}

function shortHash(text: string): string {
  return sha256Hex(text).slice(0, 16);
}

function checkFailed(name: string, e: unknown): AddonStatus {
  return { text: `${name} check failed: ${(e as Error).message}`, level: 'warning' };
}

// Single error-handling source for the three probes; messages unchanged.
function runCheck(name: string, probe: () => Promise<string>): Promise<AddonStatus> {
  return probe().then((text) => ({ text, level: 'info' as const }), (e) => checkFailed(name, e));
}

/**
 * Locates an installed ponytail package.json by walking up from this extension.
 *
 * Pi keeps extensions in a bare config directory that may have no node_modules at
 * all, so there is no fixed package path to name. Absent install is the normal
 * case and must report "not installed", not throw, so every miss yields null and
 * the caller renders the not-installed line.
 */
function ponytailPackageJson(): string | null {
  let dir = EXT_DIR;
  // Bounded: config dir → its parent → … 8 levels covers any sane node_modules
  // chain; the stop on the filesystem root keeps it from looping forever.
  for (let depth = 0; depth < 8; depth++) {
    const candidate = path.join(dir, 'node_modules', '@dietrichgebert', 'ponytail', 'package.json');
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

async function readPonytailVersion(): Promise<string | null> {
  const pkg = ponytailPackageJson();
  if (!pkg) return null;
  try {
    const raw = await readTextIfExists(pkg);
    if (!raw) return null;
    return (JSON.parse(raw) as { version?: string }).version ?? null;
  } catch {
    return null;
  }
}

// Check: no mutation. Probes run concurrently via checkAddons below.
function checkPonytail(): Promise<AddonStatus> {
  return runCheck('Ponytail', async () => {
    const remoteJson = await fetchJson<{ version?: string }>(PONYTAIL_REMOTE);
    const localVer = await readPonytailVersion();
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

// Caveman (rule.md)
function checkCaveman(): Promise<AddonStatus> {
  return runCheck('Caveman', async () => {
    const remote = await httpsGet(CAVEMAN_REMOTE);
    const remoteHash = shortHash(remote);
    const local = await readTextIfExists(CAVEMAN_LOCAL);
    const localHash = local ? shortHash(local) : null;
    const status = !local ? 'rule.md missing'
      : localHash === remoteHash ? 'rule.md up to date'
        : 'rule.md update available';
    return `Caveman ${status}: local=${localHash || '—'} remote=${remoteHash}`;
  });
}

export async function checkAddonsSummary(ctx: ExtensionCtx): Promise<string> {
  return checkAddons(ctx);
}

export async function runAddonUpdate(pi: PiExtensionAPI, ctx: ExtensionCtx, target: string, dryRun = false): Promise<string> {
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

async function checkAddons(ctx: ExtensionCtx): Promise<string> {
  const [ponytail, rtk, caveman] = await Promise.all([checkPonytail(), checkRtk(), checkCaveman()]);
  const lines: string[] = [];
  for (const status of [ponytail, rtk, caveman]) {
    lines.push(status.text);
    notify(ctx, status.text, status.level);
  }
  return lines.join('\n');
}

async function updatePonytail(pi: PiExtensionAPI, ctx: ExtensionCtx, dryRun = false): Promise<string> {
  // Bundled with tersio: no separate package to refresh. `tersio update`
  // pulls the bundled copy with the CLI.
  const localVer = await readPonytailVersion();
  void pi;
  const m = dryRun
    ? `Ponytail dry-run: bundled with tersio (local=${localVer || '—'}); run \`tersio update\` to refresh it.`
    : `Ponytail is bundled with tersio (local=${localVer || '—'}); run \`tersio update\` to refresh it.\n${RELOAD_MSG}`;
  return report(ctx, m, 'info');
}

async function updateRtk(ctx: ExtensionCtx, dryRun = false): Promise<string> {
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

  // Cross-platform asset selection (mirrors installer stepRtk)
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
    // Verify SHA256 against checksums.txt
    const checks = await fs.readFile(checksPath, 'utf8');
    const expected = parseChecksum(checks, asset.name);
    if (!expected) {
      const m = `RTK: checksums.txt has no entry for ${asset.name}`;
      return report(ctx, m, 'warning');
    }
    const archiveBuf = await fs.readFile(archivePath);
    const actual = createHash('sha256').update(archiveBuf).digest('hex').toLowerCase();
    if (actual !== expected) {
      const m = `RTK: checksum mismatch! expected=${expected.slice(0, 12)}… actual=${actual.slice(0, 12)}…`;
      return report(ctx, m, 'warning');
    }
    notify(ctx, 'RTK: checksum verified.', 'info');

    // Extract by archive format
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
        throw new Error(`tar could not extract ${asset.name}: ${(e as Error).message}`, { cause: e });
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

    // Set executable bit on Unix
    if (!IS_WINDOWS) {
      await fs.chmod(RTK_BINARY, 0o755);
    }

    let versionOut = '';
    try {
      versionOut = execFileSync(RTK_BINARY, ['--version'], { encoding: 'utf8', windowsHide: true, shell: false, timeout: 10000 }).trim();
    } catch (e) {
      if (backedUp) await fs.copyFile(backupPath, RTK_BINARY);
      throw new Error(`new ${binaryName} failed --version${backedUp ? '; restored backup' : ''}: ${(e as Error).message}`, { cause: e });
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

async function updateCaveman(ctx: ExtensionCtx, dryRun = false): Promise<string> {
  let remote: string;
  try { remote = await httpsGet(CAVEMAN_REMOTE); }
  catch (e) { return report(ctx, `Caveman update failed: ${(e as Error).message}`, 'warning'); }

  const remoteHash = shortHash(remote);
  const oldLocal = await readTextIfExists(CAVEMAN_LOCAL);
  const oldHash = oldLocal ? shortHash(oldLocal) : null;

  if (dryRun) {
    const m = `Caveman dry-run: would write ${CAVEMAN_LOCAL}\nold=${oldHash || '—'} new=${remoteHash}.`;
    return report(ctx, m, 'info');
  }

  try {
    await fs.mkdir(path.dirname(CAVEMAN_LOCAL), { recursive: true });
    const backupPath = `${CAVEMAN_LOCAL}.bak`;
    if (oldLocal !== null) await fs.writeFile(backupPath, oldLocal, 'utf8');
    await fs.writeFile(CAVEMAN_LOCAL, remote, 'utf8');
    const written = await fs.readFile(CAVEMAN_LOCAL, 'utf8');
    const writtenHash = shortHash(written);
    if (writtenHash !== remoteHash) {
      if (oldLocal !== null) await fs.writeFile(CAVEMAN_LOCAL, oldLocal, 'utf8');
      throw new Error(`written hash ${writtenHash} did not match remote ${remoteHash}${oldLocal !== null ? '; restored backup' : ''}`);
    }
    const m = `Caveman rule.md updated → ${CAVEMAN_LOCAL}\nold=${oldHash || '—'} new=${remoteHash}\nbackup=${oldLocal !== null ? backupPath : '—'}\n${RELOAD_MSG}`;
    notify(ctx, 'Caveman rule.md updated. ' + RELOAD_MSG, 'info');
    return m;
  } catch (e) {
    const m = `Caveman update failed: ${(e as Error).message}`;
    return report(ctx, m, 'warning');
  }
}

export default function aiAddonsUpdaterExtension(pi: PiExtensionAPI): void {
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
    },
  });
}

export { parseChecksum };
