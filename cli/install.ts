// cli/install.ts — install/reinstall flow and all setup steps.
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUN_BIN_DIR, CAVEMAN_DEFAULTS, COMBO_PRESET_MODES, IS_WINDOWS, OMP_AGENT_DIR, OMP_PLUGINS_DIR, OMP_BIN,
  PACKAGE_NAME, PACKAGE_VERSION, PONYTAIL_DEFAULTS, RTK_BINARY_NAME,
  applyUpdate, cavemanDefaultFlag, comboDefaultFlag, command, dryRun, install,
  ponytailDefaultFlag, profileFlagsGiven, reinstall, rtkDefaultFlag, verbose, yes,
  dashboardExport, dashboardPort,
  debug, ensureExtensionAfterConfigEntry, ensureExtensionInConfig, ensurePonytailConfigValue,
  execP, parseJsonObject, readPluginsPackage,
  writeIfChanged,
  InstallOptions, WriteOptions,
} from './common.ts';
import {
  askInteractiveChoice, askInteractiveConfirm, closeRL, execNetwork, tty, withInteractiveSpinner,
} from './interactive.ts';
import { printWelcome } from './banner.ts';
import { checkForUpdate, runLatestUpdate } from './update.ts';
import { runUninstall } from './uninstall.ts';
import { runDoctor } from './doctor.ts';
import { runReset } from './reset.ts';
import { runUsage } from './usage.ts';
import { runDashboard } from './dashboard.ts';
import { wireRtkOmp } from './rtk-wiring.ts';
import {
  CAVEMAN_REMOTE_RULE, RTK_RELEASE_API, RtkRelease, RtkReleaseAsset, fetchJson, findFile, httpsGet,
  httpsDownload, parseChecksum, readTextIfExists, rtkPlatformSpec, sha256File,
} from '../extensions/lib/utils.ts';

// Paths to extension source files (relative to this script)
const EXT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'extensions');
const SHARED_SESSION_STATE = path.join(EXT_DIR, 'shared', 'session-state.js');
const CAVEMAN_INDEX = path.join(EXT_DIR, 'caveman-session', 'index.js');
const RTK_SESSION_INDEX = path.join(EXT_DIR, 'rtk-session', 'index.js');
const UPDATER_INDEX = path.join(EXT_DIR, 'ai-addons-updater', 'index.js');
const COMBO_TOGGLE_INDEX = path.join(EXT_DIR, 'combo-toggle', 'index.js');
const TERSIO_COMMANDS_INDEX = path.join(EXT_DIR, 'tersio-commands', 'index.js');
const MODE_REINFORCEMENT_INDEX = path.join(EXT_DIR, 'shared', 'mode-reinforcement.js');
const SHARED_TYPES = path.join(EXT_DIR, 'shared', 'types.js');
const LIB_UTILS = path.join(EXT_DIR, 'lib', 'utils.js');
const SHARED_PLUGIN_SETTINGS = path.join(EXT_DIR, 'shared', 'plugin-settings.js');
const SHARED_USAGE_LEDGER = path.join(EXT_DIR, 'shared', 'usage-ledger.js');
const SHARED_PRICING = path.join(EXT_DIR, 'shared', 'pricing.js');
const SHARED_CARBON = path.join(EXT_DIR, 'shared', 'carbon.js');

interface Profile {
  comboDefault: string;
  cavemanDefault: string;
  rtkDefault: boolean;
  ponytailDefault: string;
}

const PONYTAIL_GITHUB_SPEC = 'github:DietrichGebert/ponytail';
const PONYTAIL_NPM_SPEC = '@dietrichgebert/ponytail@latest';

async function stepPonytail(pluginsDir: string, userDir: string, options: InstallOptions): Promise<void> {
  if (!options.quiet) console.log('\n[1/8] Ponytail');
  await fs.mkdir(pluginsDir, { recursive: true });
  const pkgPath = path.join(pluginsDir, 'package.json');
  const pkg = await readPluginsPackage(pkgPath);
  pkg.dependencies['@dietrichgebert/ponytail'] = PONYTAIL_GITHUB_SPEC;

  if (options.dryRun) {
    if (!options.quiet) console.log(`  [dry-run] would write ${pkgPath}`);
  } else {
    await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    if (!options.quiet) console.log('  [write] package.json');
  }

  const ponytailExtPath = path.join(pluginsDir, 'node_modules', '@dietrichgebert', 'ponytail', 'pi-extension', 'index.js');
  const probeExt = async (): Promise<boolean> => (await readTextIfExists(ponytailExtPath)) !== null;
  // Fast path: extension already present and no refresh asked — skip network.
  let ponytailExtExists = !options.reinstall && !options.dryRun ? await probeExt() : false;
  if (ponytailExtExists) {
    debug('Ponytail pi-extension already installed; skipping network refresh');
  } else if (options.dryRun) {
    // Dry runs preview the wiring below without touching the network.
    if (!options.quiet) console.log(`  [dry-run] would run: omp plugin install ${PONYTAIL_GITHUB_SPEC}`);
    if (options.reinstall && !options.quiet) {
      console.log(`  [dry-run] would run: npm install ${PONYTAIL_NPM_SPEC} --save --no-audit --no-fund`);
    }
    ponytailExtExists = true;
  } else {
    // Try omp plugin install first
    try {
      await execNetwork('Installing Ponytail plugin', OMP_BIN, ['plugin', 'install', PONYTAIL_GITHUB_SPEC], { cwd: pluginsDir });
      if (!options.quiet) console.log('  [ok] omp plugin install ran');
    } catch (e) {
      console.log(`  [warn] omp plugin install failed: ${(e as Error).message}`);
    }

    if (options.reinstall) {
      try {
        await execNetwork('Refreshing Ponytail package', 'npm', ['install', PONYTAIL_NPM_SPEC, '--save', '--no-audit', '--no-fund'], { cwd: pluginsDir, timeout: 120000 });
        if (!options.quiet) console.log('  [ok] Ponytail refreshed');
      } catch (e) {
        console.log(`  [fail] Could not refresh ponytail: ${(e as Error).message}`);
        console.log(`  [hint] Manual: cd ~/.omp/plugins && npm install ${PONYTAIL_NPM_SPEC} --save --no-audit --no-fund`);
      }
    }

    // Verify the pi-extension/index.js actually exists
    ponytailExtExists = await probeExt();

    // Fallback: try bun install or npm install
    if (!ponytailExtExists) {
      if (!options.quiet) console.log('  [info] pi-extension/index.js not found after omp plugin install — trying npm/bun install...');
      try {
        await execNetwork('Installing Ponytail dependencies', 'npm', ['install'], { cwd: pluginsDir, timeout: 120000 });
        if (!options.quiet) console.log('  [ok] npm install completed');
      } catch {
        try {
          await execNetwork('Installing Ponytail dependencies', 'bun', ['install'], { cwd: pluginsDir, timeout: 120000 });
          if (!options.quiet) console.log('  [ok] bun install completed');
        } catch (e2) {
          console.log(`  [fail] Could not install ponytail: ${(e2 as Error).message}`);
          console.log('  [hint] Manual: cd ~/.omp/plugins && npm install');
        }
      }
      ponytailExtExists = await probeExt();
    }

    // Last-resort fallback: git clone the repo into node_modules
    if (!ponytailExtExists) {
      if (!options.quiet) console.log('  [info] npm/bun did not produce pi-extension — trying git clone...');
      try {
        const dest = path.join(pluginsDir, 'node_modules', '@dietrichgebert', 'ponytail');
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await execNetwork('Cloning Ponytail repository', 'git', ['clone', '--depth', '1', 'https://github.com/DietrichGebert/ponytail.git', dest], { timeout: 180000 });
        if (!options.quiet) console.log('  [ok] git clone completed');
        ponytailExtExists = await probeExt();
      } catch (e3) {
        console.log(`  [fail] git clone failed: ${(e3 as Error).message}`);
        console.log('  [hint] Install git or check network: https://github.com/DietrichGebert/ponytail');
      }
    }
  }

  if (!ponytailExtExists) {
    console.log('  [skip] Ponytail pi-extension/index.js still not found — skill-only mode');
    console.log('  [hint] The /ponytail command won\'t work, but ponytail skills will still load');
  } else if (!options.dryRun && !options.quiet) {
    // Wire extension into config.yml so /ponytail command loads
    console.log('  [ok] Ponytail pi-extension found');
  }
  // Still set Ponytail config defaults even without the extension command
  const configPath = path.join(userDir, 'config.yml');
  await ensureExtensionInConfig(configPath, ponytailExtPath, 'ponytail', options);
  await ensurePonytailConfigValue('defaultMode', 'off', options);
  // hideStatus=true keeps the upstream ponytail bar hidden; combo owns the bar.
  await ensurePonytailConfigValue('hideStatus', true, options);
}

// Registers this package in ~/.omp/plugins so OMP lists it on the
// Settings → Plugins page (OMP enumerates plugins/package.json dependencies).
// Returns true when the package is verified in plugins/node_modules.
async function stepSelfPlugin(pluginsDir: string, options: InstallOptions): Promise<boolean> {
  if (!options.quiet) console.log('\n[2/8] Self-plugin');
  const pkgPath = path.join(pluginsDir, 'package.json');
  const pkg = await readPluginsPackage(pkgPath);
  pkg.dependencies[PACKAGE_NAME] = `^${PACKAGE_VERSION}`;
  for (const legacy of ['oh-my-pi-token-saver', 'tersio-omp']) {
    if (legacy in pkg.dependencies) {
      delete pkg.dependencies[legacy];
      if (!options.dryRun && !options.quiet) console.log(`  [migrate] dropped legacy ${legacy} dependency`);
    }
  }

  if (options.dryRun) {
    if (!options.quiet) console.log(`  [dry-run] would add ${PACKAGE_NAME}@^${PACKAGE_VERSION} to ${pkgPath}`);
    if (!options.quiet) console.log(`  [dry-run] would run: npm install --no-audit --no-fund (in ${pluginsDir})`);
    return false;
  }

  // pkg.dependencies[PACKAGE_NAME] was assigned above, so only reinstall skips this fast path.
  if (!options.reinstall) {
    const installedPkgRaw = await readTextIfExists(path.join(pluginsDir, 'node_modules', PACKAGE_NAME, 'package.json'));
    if (parseJsonObject<{ version?: string }>(installedPkgRaw)?.version === PACKAGE_VERSION) {
      debug(`${PACKAGE_NAME} already installed at v${PACKAGE_VERSION}; skipping npm install`);
      if (!options.quiet) console.log('  [ok] tersio listed in OMP plugins');
      return true;
    }
  }

  await fs.mkdir(pluginsDir, { recursive: true });
  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

  try {
    await execNetwork('Installing Tersio plugin dependencies', 'npm', ['install', '--no-audit', '--no-fund'], { cwd: pluginsDir, timeout: 180000 });
  } catch {
    try {
      await execNetwork('Installing Tersio plugin dependencies', 'bun', ['install'], { cwd: pluginsDir, timeout: 180000 });
    } catch (e) {
      console.log(`  [fail] Could not install ${PACKAGE_NAME} into plugins dir: ${(e as Error).message}`);
      console.log(`  [hint] Manual: cd ~/.omp/plugins && npm install ${PACKAGE_NAME}@^${PACKAGE_VERSION} --save --no-audit --no-fund`);
      return false;
    }
  }

  const installedPkg = path.join(pluginsDir, 'node_modules', PACKAGE_NAME, 'package.json');
  if ((await readTextIfExists(installedPkg)) === null) {
    console.log(`  [warn] ${PACKAGE_NAME} not found in plugins/node_modules after install`);
    return false;
  }
  if (!options.quiet) console.log('  [ok] tersio listed in OMP plugins');
  return true;
}


function resolveRtkTriple(): string | null {
  const triple = rtkPlatformSpec()?.triple;
  if (triple) return triple;
  console.log(`  [fail] Unsupported platform: ${process.platform}/${process.arch}`);
  console.log('  [hint] Manual: https://github.com/rtk-ai/rtk/releases');
  return null;
}

function findRtkAsset(release: RtkRelease, triple: string): RtkReleaseAsset | null {
  const assets = release.assets || [];
  const asset = assets.find((a) => a.name === `rtk-${triple}.zip` || a.name === `rtk-${triple}.tar.gz`);
  if (asset) return asset;
  console.log(`  [fail] No rtk-${triple}.<zip|tar.gz> in release ${release.tag_name}`);
  console.log(`  [hint] Available: ${assets.map((a) => a.name).filter((n) => n.startsWith('rtk-')).join(', ')}`);
  return null;
}

async function downloadRtkChecksums(release: RtkRelease): Promise<string | null> {
  const checksumsAsset = (release.assets || []).find((a) => a.name === 'checksums.txt');
  if (!checksumsAsset) return null;
  try {
    return await httpsGet(checksumsAsset.browser_download_url);
  } catch (e) {
    debug(`Could not download checksums.txt: ${(e as Error).message}`);
    return null;
  }
}

async function verifyRtkArchive(archivePath: string, assetName: string, checksumsText: string | null): Promise<boolean> {
  if (!checksumsText) {
    console.log('  [warn] No checksums.txt available — skipping verification');
    return true;
  }
  const expected = parseChecksum(checksumsText, assetName);
  const actual = await sha256File(archivePath);
  if (!expected) {
    console.log(`  [warn] checksums.txt missing entry for ${assetName} — skipping verification`);
    return true;
  }
  if (actual === expected) {
    console.log(`  [ok] Checksum verified for ${assetName}`);
    return true;
  }
  console.log(`  [fail] Checksum mismatch for ${assetName}`);
  console.log(`  [fail] Expected: ${expected}`);
  console.log(`  [fail] Got:      ${actual}`);
  // Caller finally removes the temp dir.
  return false;
}

function shortError(e: unknown): string {
  return (((e as Error & { stderr?: string }).stderr) || (e as Error).message || '').trim().slice(0, 200);
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function extractRtkArchive(archivePath: string, extractDir: string): Promise<boolean> {
  await fs.mkdir(extractDir, { recursive: true });
  if (archivePath.endsWith('.zip')) {
    if (IS_WINDOWS) {
      await execP('powershell', ['Expand-Archive', '-Path', archivePath, '-DestinationPath', extractDir, '-Force'], { timeout: 60000 });
    } else {
      await execP('unzip', [archivePath, '-d', extractDir], { timeout: 60000 });
    }
    return true;
  }
  if (archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')) {
    try {
      await execP('tar', ['xzf', archivePath, '-C', extractDir], { timeout: 60000 });
      debug('tar xzf ok');
    } catch (e) {
      debug(`tar xzf failed: ${shortError(e)}`);
      console.log(`  [fail] tar could not extract ${path.basename(archivePath)}`);
      console.log('  [hint] Manual: https://github.com/rtk-ai/rtk/releases');
      return false;
    }
    return true;
  }
  console.log(`  [fail] Unknown archive format: ${archivePath}`);
  return false;
}

async function stepRtk(binDir: string, options: InstallOptions): Promise<void> {
  if (!options.quiet) console.log('\n[3/8] RTK binary');
  const binDest = path.join(binDir, RTK_BINARY_NAME);
  // Download failure must not skip wiring: a pre-existing rtk binary is
  // exactly as good for the OMP hook, so wire whatever ends up at binDest.
  try {
    const release = await withInteractiveSpinner('Finding latest RTK release', () => fetchJson<RtkRelease>(RTK_RELEASE_API));
    const triple = resolveRtkTriple();
    if (!triple) return;
    const asset = findRtkAsset(release, triple);
    if (!asset) return;
    if (options.dryRun) {
      if (!options.quiet) console.log(`  [dry-run] would download ${asset.name} from release ${release.tag_name}`);
      if (!options.quiet) console.log('  [dry-run] would verify checksum against checksums.txt');
      if (!options.quiet) console.log(`  [dry-run] would extract and install to ${binDest}`);
      return;
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'omp-rtk-'));
    try {
      const archivePath = path.join(tmpDir, asset.name);
      const checksumsText = await withInteractiveSpinner('Downloading RTK binary', async (update) => {
        const [downloadedChecksums] = await Promise.all([
          downloadRtkChecksums(release),
          httpsDownload(asset.browser_download_url, archivePath),
        ]);
        update('Verifying RTK checksum');
        return downloadedChecksums;
      });
      if (!await verifyRtkArchive(archivePath, asset.name, checksumsText)) return;

      const extractDir = path.join(tmpDir, 'extracted');
      if (!await extractRtkArchive(archivePath, extractDir)) return;

      const found = await findFile(extractDir, RTK_BINARY_NAME);
      if (!found) {
        console.log(`  [fail] Could not find ${RTK_BINARY_NAME} in extracted archive`);
        return;
      }

      await fs.mkdir(path.dirname(binDest), { recursive: true });
      await fs.copyFile(binDest, `${binDest}.bak`).catch(() => { });
      await fs.copyFile(found, binDest);
      if (!options.quiet) console.log(`  [write] ${binDest}`);

      if (!IS_WINDOWS) {
        await fs.chmod(binDest, 0o755);
        debug(`chmod 755 ${binDest}`);
      }

      try {
        const v = (await execP(binDest, ['--version'], { timeout: 30000, shell: false })).stdout.trim();
        if (!options.quiet) console.log(`  [ok] ${binDest} → ${v}`);
      } catch {
        console.log(`  [hint] Verify manually: ${binDest} --version`);
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => { });
    }
  } catch (e) {
    console.log(`  [fail] RTK: ${(e as Error).message}`);
    console.log('  [hint] Manual: https://github.com/rtk-ai/rtk/releases');
  }

  if (options.dryRun) {
    await wireRtkOmp(binDest, options);
    return;
  }
  if (!(await fileExists(binDest))) {
    console.log('  [skip] no rtk binary to wire — install rtk, then run: rtk init -g --agent omp');
    return;
  }
  // Binary alone never meters OMP sessions — wire rtk's tool_call
  // extension so bash commands rewrite to rtk and land in history.db.
  await wireRtkOmp(binDest, options);
}

// Copy repo source files into the target extension dir. First entry is
// required (skip label on missing); rest are optional companions.
async function copySources(extDir: string, files: Array<[string, string]>, skipLabel: string, options: WriteOptions): Promise<boolean> {
  const src = await readTextIfExists(files[0][0]);
  if (!src) {
    if (!options.quiet) console.log(`  [skip] ${skipLabel} not found in repo`);
    return false;
  }
  await writeIfChanged(path.join(extDir, files[0][1]), src, options);
  const rest = files.slice(1);
  const extras = await Promise.all(rest.map(([from]) => readTextIfExists(from)));
  for (let i = 0; i < rest.length; i++) {
    const extra = extras[i];
    if (extra) await writeIfChanged(path.join(extDir, rest[i][1]), extra, options);
  }
  return true;
}

async function stepSharedSessionState(extDir: string, options: WriteOptions): Promise<void> {
  await copySources(extDir, [
    [SHARED_SESSION_STATE, path.join('shared', 'session-state.js')],
    [SHARED_TYPES, path.join('shared', 'types.js')],
    [LIB_UTILS, path.join('lib', 'utils.js')],
    [SHARED_PLUGIN_SETTINGS, path.join('shared', 'plugin-settings.js')],
    [SHARED_USAGE_LEDGER, path.join('shared', 'usage-ledger.js')],
    [SHARED_PRICING, path.join('shared', 'pricing.js')],
    [SHARED_CARBON, path.join('shared', 'carbon.js')],
  ], 'shared/session-state.js', options);
}

async function stepModeReinforcement(extDir: string, ponytailExtPath: string, options: WriteOptions): Promise<void> {
  if (!options.quiet) console.log('\n[8/8] Mode reinforcement');
  const dest = path.join(extDir, 'shared', 'mode-reinforcement.js');
  if (!await copySources(extDir, [[MODE_REINFORCEMENT_INDEX, path.join('shared', 'mode-reinforcement.js')]], 'shared/mode-reinforcement.js', options)) return;
  await ensureExtensionAfterConfigEntry(path.join(path.dirname(extDir), 'config.yml'), dest, ponytailExtPath, 'mode reinforcement', options);
}

async function stepRtkSession(extDir: string, options: WriteOptions): Promise<void> {
  if (!options.quiet) console.log('\n[4/8] RTK session');
  await copySources(extDir, [[RTK_SESSION_INDEX, path.join('rtk-session', 'index.js')]], 'rtk-session/index.js', options);
}

// One rule fetch serves the install; dry runs stay offline
// and fall back to the bundled rule to preview its destination.
async function fetchCavemanRule(options: WriteOptions): Promise<string | null> {
  if (options.dryRun) return (await readTextIfExists(path.join(path.dirname(CAVEMAN_INDEX), 'rule.md'))) || '';
  try {
    return await withInteractiveSpinner('Fetching Caveman rule', () => httpsGet(CAVEMAN_REMOTE_RULE));
  } catch (e) {
    console.log(`  [warn] Could not fetch caveman rule: ${(e as Error).message}`);
    return null;
  }
}

async function stepCaveman(extDir: string, rule: string | null, options: WriteOptions): Promise<void> {
  if (!options.quiet) console.log('\n[5/8] Caveman');
  const cavemanDir = path.join(extDir, 'caveman-session');
  if (!options.dryRun) await fs.mkdir(cavemanDir, { recursive: true });

  const ruleDest = path.join(cavemanDir, 'rule.md');
  if (rule === null && (await readTextIfExists(ruleDest)) !== null) {
    if (!options.quiet) console.log('  [info] Keeping existing rule.md');
  } else if (rule === null) {
    console.log('  [skip] Caveman rule.md unavailable');
    console.log(`  [hint] Manual: ${CAVEMAN_REMOTE_RULE}`);
  } else {
    await writeIfChanged(ruleDest, rule, options);
  }

  await copySources(extDir, [[CAVEMAN_INDEX, path.join('caveman-session', 'index.js')]], 'caveman-session/index.js', options);
}

async function stepTersioCommands(extDir: string, options: WriteOptions): Promise<void> {
  if (!options.quiet) console.log('\n[7/8] Tersio commands');
  await copySources(extDir, [[TERSIO_COMMANDS_INDEX, path.join('tersio-commands', 'index.js')]], 'tersio-commands/index.js', options);
}

async function stepUpdater(extDir: string, options: WriteOptions): Promise<void> {
  await copySources(extDir, [[UPDATER_INDEX, path.join('ai-addons-updater', 'index.js')]], 'ai-addons-updater/index.js', options);
}

async function stepCombo(extDir: string, options: WriteOptions): Promise<void> {
  if (!options.quiet) console.log('\n[6/8] Combo');
  const dest = path.join(extDir, 'combo-toggle', 'index.js');
  if (!await copySources(extDir, [[COMBO_TOGGLE_INDEX, path.join('combo-toggle', 'index.js')]], 'combo-toggle/index.js', options)) return;

  // Auto-register combo in config.yml
  const configPath = path.join(path.dirname(extDir), 'config.yml');
  await ensureExtensionInConfig(configPath, dest, 'combo', options);
}


function defaultProfile(): Profile {
  return {
    comboDefault: 'off',
    cavemanDefault: 'off',
    rtkDefault: false,
    ponytailDefault: 'off',
  };
}

// Stored profile from the live lock file: update/reinstall runs without flags
// or prompts must preserve the user's choice, never reset it to off.
interface StoredSettings {
  comboDefault?: unknown;
  cavemanDefault?: unknown;
  rtkDefault?: unknown;
  ponytailDefault?: unknown;
}

async function storedProfile(): Promise<Profile> {
  const base = defaultProfile();
  const raw = await readTextIfExists(path.join(OMP_PLUGINS_DIR, 'omp-plugins.lock.json'));
  if (!raw) return base;
  let stored: StoredSettings;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !('settings' in parsed)) return base;
    const settings = (parsed as { settings: unknown }).settings;
    if (!settings || typeof settings !== 'object' || !(PACKAGE_NAME in settings)) return base;
    const entry = (settings as Record<string, unknown>)[PACKAGE_NAME];
    if (!entry || typeof entry !== 'object') return base;
    stored = entry as StoredSettings;
  } catch { return base; }
  if (typeof stored.comboDefault === 'string' && stored.comboDefault in COMBO_PRESET_MODES) base.comboDefault = stored.comboDefault;
  if (typeof stored.cavemanDefault === 'string' && CAVEMAN_DEFAULTS.has(stored.cavemanDefault)) base.cavemanDefault = stored.cavemanDefault;
  if (typeof stored.rtkDefault === 'boolean') base.rtkDefault = stored.rtkDefault;
  if (typeof stored.ponytailDefault === 'string' && PONYTAIL_DEFAULTS.has(stored.ponytailDefault)) base.ponytailDefault = stored.ponytailDefault;
  return base;
}

async function resolveProfile(forceReinstall = false, opts: { quiet?: boolean } = {}): Promise<Profile> {
  // Seed from the lock file so flag-less update/reinstall runs keep the
  // user's configured defaults instead of resetting them to off.
  const profile = await storedProfile();

  // Single interactive prompt: the Combo preset implies all three modes.
  // Numbered menu — no typing preset names.
  // Only for a real user at a terminal, only when no default flags were
  // given, and never for --apply-update runs.
  if (tty() && !profileFlagsGiven && !applyUpdate && (install || forceReinstall || reinstall)) {
    const choice = await askInteractiveChoice('Session-start defaults — Combo preset', [
      { value: 'off', label: 'off' },
      { value: 'medium', label: 'medium', hint: 'caveman=lite, rtk=on, ponytail=lite' },
      { value: 'balanced', label: 'balanced', hint: 'caveman=full, rtk=on, ponytail=full' },
      { value: 'max', label: 'max', hint: 'caveman=ultra, rtk=on, ponytail=ultra' },
    ], profile.comboDefault);
    if (choice.status === 'selected') profile.comboDefault = choice.value;
    else {
      closeRL();
      process.exit(130);
    }
  }

  // Explicit flags always win over the Combo preset.
  if (comboDefaultFlag !== undefined) profile.comboDefault = comboDefaultFlag;
  const preset = COMBO_PRESET_MODES[profile.comboDefault] ?? COMBO_PRESET_MODES.off;
  profile.cavemanDefault = preset.caveman;
  profile.rtkDefault = preset.rtk;
  profile.ponytailDefault = preset.ponytail;
  if (cavemanDefaultFlag !== undefined) profile.cavemanDefault = cavemanDefaultFlag;
  if (rtkDefaultFlag !== undefined) profile.rtkDefault = rtkDefaultFlag === 'on';
  if (ponytailDefaultFlag !== undefined) profile.ponytailDefault = ponytailDefaultFlag;

  if (!opts.quiet || dryRun) console.log(`  Profile: combo default=${profile.comboDefault} (caveman=${profile.cavemanDefault} · rtk=${profile.rtkDefault ? 'on' : 'off'} · ponytail=${profile.ponytailDefault})`);
  return profile;
}

// Persist the profile as omp plugin settings so `omp plugin config get`
// reflects the choice and the extensions pick it up on session start.
async function writePluginSettings(profile: Profile, options: WriteOptions): Promise<void> {
  const pluginsDir = OMP_PLUGINS_DIR;
  const lockPath = path.join(pluginsDir, 'omp-plugins.lock.json');
  let config: { plugins?: Record<string, unknown>; settings?: Record<string, Record<string, unknown>> } = {};
  const existing = await readTextIfExists(lockPath);
  if (existing) {
    try { config = JSON.parse(existing); } catch { config = {}; }
  }
  config.plugins = config.plugins || {};
  config.settings = config.settings || {};
  config.settings[PACKAGE_NAME] = {
    ...(config.settings[PACKAGE_NAME] || {}),
    comboDefault: profile.comboDefault,
    cavemanDefault: profile.cavemanDefault,
    rtkDefault: profile.rtkDefault,
    ponytailDefault: profile.ponytailDefault,
  };

  if (options.dryRun) {
    console.log(`  [dry-run] would write plugin settings (${PACKAGE_NAME}) to ${lockPath}`);
    return;
  }
  await fs.mkdir(pluginsDir, { recursive: true });
  await fs.writeFile(lockPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  console.log(`  [write] Plugin settings in ${lockPath}`);
}

let updatePromptDone = false;

// Bare `tersio` at a terminal is a command picker, not an install run:
// update offer first (when pending), then a Clack menu over every command.
// Scripts, pipes, --yes, and --dry-run keep the old straight-to-install path.
async function runCommandMenu(): Promise<void> {
  printWelcome();
  const newer = await checkForUpdate();
  if (typeof newer === 'string' && !dryRun) {
    const answer = await askInteractiveConfirm(`tersio ${newer} is available (installed ${PACKAGE_VERSION}). Install it now?`);
    if (answer.status === 'confirmed' && answer.value) {
      await runLatestUpdate();
      closeRL();
      return;
    }
    if (answer.status === 'cancelled') {
      closeRL();
      process.exit(130);
    }
    console.log(`\n  [update] staying on ${PACKAGE_VERSION} — run ` + '`tersio update`' + ` anytime`);
  }
  updatePromptDone = true;
  const choice = await askInteractiveChoice('Tersio — what next?', [
    { value: 'install', label: 'Install add-ons', hint: 'user scope + combo defaults' },
    { value: 'update', label: 'Update', hint: 'CLI version check, then refresh add-ons (RTK, Caveman rule, Ponytail)' },
    { value: 'reinstall', label: 'Reinstall', hint: 'clean and reinstall the add-ons, Ponytail package kept' },
    { value: 'doctor', label: 'Doctor', hint: 'verify the installation' },
    { value: 'usage', label: 'Usage', hint: 'token usage and savings report' },
    { value: 'gain', label: 'Gain dashboard', hint: 'open the report in your browser' },
    { value: 'reset', label: 'Reset statistics', hint: 'clear statistics; transcripts and RTK history stay' },
    { value: 'uninstall', label: 'Uninstall', hint: 'remove tersio' },
  ], 'install');
  if (choice.status !== 'selected') {
    closeRL();
    process.exit(130);
  }
  switch (choice.value) {
    case 'install':
      await runInstall();
      break;
    case 'update': {
      // One bound flow: the version check already ran above, so report it
      // and offer the refresh in the same breath — no second "update" quiz.
      if (typeof newer === 'string') console.log(`  tersio ${newer} available (installed ${PACKAGE_VERSION})`);
      else console.log(`  tersio ${PACKAGE_VERSION} is the latest`);
      const go = await askInteractiveConfirm('Update now (CLI + RTK, Caveman rule, Ponytail)?');
      if (go.status === 'confirmed' && go.value) {
        await runLatestUpdate();
      } else if (go.status === 'cancelled') {
        closeRL();
        process.exit(130);
      } else {
        console.log(`  staying on ${PACKAGE_VERSION} — run \`tersio update\` anytime`);
      }
      closeRL();
      break;
    }
    case 'reinstall':
      await runInstall({ reinstall: true });
      closeRL();
      break;
    case 'doctor':
      await runDoctor();
      closeRL();
      break;
    case 'usage':
      await runUsage();
      closeRL();
      break;
    case 'gain':
      await runDashboard({ port: dashboardPort, open: true, exportFile: dashboardExport });
      closeRL();
      break;
    case 'reset':
      await runReset();
      closeRL();
      break;
    case 'uninstall':
      await runUninstall();
      closeRL();
      break;
  }
}

async function runInstall(overrides: { reinstall?: boolean } = {}): Promise<void> {
  const isReinstall = overrides.reinstall ?? reinstall;
  // Menu-driven installs must fall through: bare `tersio` re-enters here
  // with command === null after the picker, and without this guard the
  // choice loops straight back into runCommandMenu() forever.
  if (command === null && tty() && !yes && !updatePromptDone) {
    await runCommandMenu();
    return;
  }
  // apply-update is the delegated payload of `tersio update`: stay silent —
  // the parent already printed the plan and owns the closing summary. Banner
  // repeats here otherwise (the reported double-print), burying real output.
  const quiet = applyUpdate;
  if (!quiet) printWelcome();
  if (isReinstall) {
    // removeRtk stays false: reinstall is about to replace the binary, and
    // deleting it first would leave nothing to wire if the fresh download
    // fails (rate limit, offline). rtk.ts is removed here and re-wired below.
    await runUninstall({ yes: true, removePonytail: false, removeRtk: false });
  }

  if (dryRun && !quiet) console.log('[dry-run] No changes will be written.\n');

  if (!quiet) {
    console.log(`Tersio v${PACKAGE_VERSION} — ${process.platform}/${process.arch} · user scope`);
  }

  // Remind humans a newer release exists; silent for scripts (no TTY) and for
  // the apply-update payload, which is itself an update run.
  if (tty() && !applyUpdate && command !== 'uninstall') {
    const newer = await checkForUpdate();
    if (typeof newer === 'string') {
      // Bare `tersio` with an update pending: offer it now (Y/n) instead of
      // burying the banner above the install prompts. Yes runs the full
      // update and stops here — the fresh binary owns what follows.
      if (command === null && !dryRun && !yes && !updatePromptDone) {
        const answer = await askInteractiveConfirm(`tersio ${newer} is available (installed ${PACKAGE_VERSION}). Install it now?`);
        if (answer.status === 'confirmed' && answer.value) {
          await runLatestUpdate();
          closeRL();
          return;
        }
        if (answer.status === 'cancelled') {
          closeRL();
          process.exit(130);
        }
        console.log(`\n  [update] staying on ${PACKAGE_VERSION} — run \`tersio update\` anytime`);
      } else {
        console.log(`\n  [update] tersio ${newer} available (installed ${PACKAGE_VERSION}) — run \`tersio update\``);
      }
    }
  }

  // Resolve session defaults: flags > interactive prompt > defaults.
  const profile = await resolveProfile(isReinstall, { quiet });

  const userDir = OMP_AGENT_DIR;
  const userExtDir = path.join(userDir, 'extensions');

  // apply-update is `tersio update`'s payload run: treat it like reinstall so
  // the add-ons refresh too — Ponytail package via npm, self plugin, RTK
  // binary (always re-downloaded), and the Caveman rule (always re-fetched).
  const options: InstallOptions = { dryRun, verbose, yes, reinstall: isReinstall || applyUpdate, quiet };

  try {
    const v = (await execP(OMP_BIN, ['--version'])).stdout.trim();
    if (!quiet) console.log(`  omp ${v}`);
  } catch {
    console.log('  [fail] omp not found — ensure it\'s installed');
  }

  const cavemanRule = await fetchCavemanRule(options);

  const failures: string[] = [];
  const capture = async (label: string, work: () => Promise<void>): Promise<void> => {
    try {
      await work();
    } catch (e) {
      failures.push(label);
      console.log(`  [fail] ${label}: ${shortError(e)}`);
    }
  };
  await capture('shared', () => stepSharedSessionState(userExtDir, options));
  await capture('ponytail', () => stepPonytail(OMP_PLUGINS_DIR, userDir, options));
  let selfPlugin = false;
  await capture('self-plugin', async () => { selfPlugin = await stepSelfPlugin(OMP_PLUGINS_DIR, options); });
  const ponytailExtPath = path.join(OMP_PLUGINS_DIR, 'node_modules', '@dietrichgebert', 'ponytail', 'pi-extension', 'index.js');
  await capture('rtk', () => stepRtk(BUN_BIN_DIR, options));
  await capture('rtk session', () => stepRtkSession(userExtDir, options));
  await capture('caveman', () => stepCaveman(userExtDir, cavemanRule, options));
  await capture('combo', () => stepCombo(userExtDir, options));
  await capture('commands', () => stepTersioCommands(userExtDir, options));
  await capture('reinforcement', () => stepModeReinforcement(userExtDir, ponytailExtPath, options));
  await capture('updater', () => stepUpdater(userExtDir, options));
  if (selfPlugin) await capture('settings', () => writePluginSettings(profile, options));

  if (quiet) {
    if (failures.length > 0) console.log(`  add-ons: ${failures.length} failed (${failures.join(', ')}) — see [fail] lines above`);
  } else {
    console.log(failures.length === 0 ? '\nDone — restart OMP, then /combo medium.' : `\nDone with ${failures.length} failure(s) — see [fail] lines above.`);
  }

  closeRL();
}
export { runInstall };
