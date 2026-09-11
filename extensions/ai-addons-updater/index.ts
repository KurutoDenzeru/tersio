// OMP extension: /ai-addons manual updater for Ponytail, RTK, Caveman.
// Built-in Node modules only. Default off; registers a single slash command.
// ponytail: `skipped: none` — semantics match one-liner: fetch + compare + run install.
// rtk: `skipped: signature verification` — checksums.txt ships only SHA256 of release assets; add sigchain when upstream publishes a signing key.
// caveman: `skipped: none` — exactly the ask: write rule.md, report old/new hash.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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
} from '../lib/utils.ts';

const IS_WINDOWS = process.platform === 'win32';
const HOME = os.homedir();

const PONYTAIL_REMOTE = 'https://raw.githubusercontent.com/DietrichGebert/ponytail/main/package.json';
const PONYTAIL_NPM_SPEC = '@dietrichgebert/ponytail@latest';
const PONYTAIL_LOCAL = path.join(HOME, '.omp', 'plugins', 'node_modules', '@dietrichgebert', 'ponytail', 'package.json');
const RTK_BINARY = path.join(HOME, '.bun', 'bin', IS_WINDOWS ? 'rtk.exe' : 'rtk');
const CAVEMAN_LOCAL = path.join(HOME, '.omp', 'agent', 'extensions', 'caveman-session', 'rule.md');

const RELOAD_MSG = 'Reminder: restart OMP (or reload extensions) for updates to take effect.';

// --- Types ---

interface AddonUpdaterCtx {
  cwd?: string;
  ui?: {
    notify?: (message: string, level?: string) => void;
  };
}

interface AddonUpdaterPi {
  setLabel?: (label: string) => void;
  registerCommand?: (name: string, config: { description: string; handler: (args: string, ctx: AddonUpdaterCtx) => Promise<string> }) => void;
  exec?: (cmd: string, args: string[], opts?: { cwd?: string }) => Promise<{ stdout: string; stderr: string; code: number }>;
  cwd?: string;
}

type NotifyLevel = 'info' | 'warning';

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

// Single error-handling source for the three probes; messages unchanged.
function runCheck(name: string, probe: () => Promise<string>): Promise<AddonStatus> {
  return probe().then((text) => ({ text, level: 'info' as const }), (e) => checkFailed(name, e));
}

// Check: no mutation. Probes run concurrently via checkAddons below.
function checkPonytail(): Promise<AddonStatus> {
  return runCheck('Ponytail', async () => {
    const remoteJson = await fetchJson<{ version?: string }>(PONYTAIL_REMOTE);
    const localRaw = await readTextIfExists(PONYTAIL_LOCAL);
    const localVer = localRaw ? (JSON.parse(localRaw) as { version?: string }).version ?? null : null;
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

async function updatePonytail(pi: AddonUpdaterPi, ctx: AddonUpdaterCtx, dryRun = false): Promise<string> {
  const pluginsDir = path.join(HOME, '.omp', 'plugins');
  if (dryRun) {
    const m = `Ponytail dry-run: would run \`npm install ${PONYTAIL_NPM_SPEC} --save --no-audit --no-fund\` in ${pluginsDir}.`;
    return report(ctx, m, 'info');
  }
  notify(ctx, 'Ponytail: ensuring plugin directory exists…', 'info');
  try {
    await fs.mkdir(pluginsDir, { recursive: true });
  } catch (e) {
    const m = `Ponytail update failed: failed to create ${pluginsDir}: ${(e as Error).message}`;
    return report(ctx, m, 'warning');
  }
  if (!pi.exec) {
    const m = 'Ponytail update failed: extension host does not provide exec';
    return report(ctx, m, 'warning');
  }
  notify(ctx, 'Ponytail: running npm install…', 'info');
  let out = '';
  try {
    const r = await pi.exec('npm', ['install', PONYTAIL_NPM_SPEC, '--save', '--no-audit', '--no-fund'], { cwd: pluginsDir });
    out = [r.stdout, r.stderr].filter(Boolean).join('\n').trim();
    if (r.code !== 0) throw new Error(r.stderr || `npm exited ${r.code}`);
  } catch (e) {
    const m = `Ponytail update failed: ${(e as Error).message}`;
    return report(ctx, m, 'warning');
  }
  const m = `Ponytail update finished.${out ? `\n${out}` : ''}\n${RELOAD_MSG}`;
  notify(ctx, 'Ponytail update finished. ' + RELOAD_MSG, 'info');
  return m;
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

    // Set executable bit on Unix
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

export default function aiAddonsUpdaterExtension(pi: AddonUpdaterPi): void {
  pi.setLabel?.('AI add-ons updater');

  pi.registerCommand?.('ai-addons', {
    description: 'Check or update AI add-ons (ponytail/rtk/caveman/all). Usage: /ai-addons <check|status|update ponytail|rtk|caveman|all> [--dry-run]',
    handler: async (args, ctx) => {
      const arg = String(args || '').trim().toLowerCase();
      const parts = arg.split(/\s+/).filter(Boolean);
      const dryRun = parts.includes('--dry-run') || parts.includes('dry-run');
      const cleanParts = parts.filter((p) => p !== '--dry-run' && p !== 'dry-run');
      const sub = cleanParts[0];

      if (sub === 'check' || sub === 'status') {
        const summary = await checkAddons(ctx);
        notify(ctx, 'ai-addons check complete.', 'info');
        return summary;
      }
      if (sub === 'update' && cleanParts[1]) {
        return runAddonUpdate(pi, ctx, cleanParts.slice(1).join(' '), dryRun);
      }
      const m = 'Usage: /ai-addons <check|status|update ponytail|rtk|caveman|all> [--dry-run]';
      return report(ctx, m, 'warning');
    },
  });
}

export { parseChecksum };
