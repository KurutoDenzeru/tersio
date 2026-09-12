// cli/install.ts — install/reinstall flow and all setup steps.
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUN_BIN_DIR, COMBO_PRESET_MODES, EXTENSIONS_KEY_RE, HOME, IS_WINDOWS, OMP_AGENT_DIR, OMP_PLUGINS_DIR, OMP_BIN,
  PACKAGE_NAME, PACKAGE_VERSION, RTK_BINARY_NAME, SCOPE_MAP,
  applyUpdate, cavemanDefaultFlag, comboDefaultFlag, command, dryRun, install,
  ponytailDefaultFlag, profileFlagsGiven, reinstall, rtkDefaultFlag, scopeFlag, verbose, yes,
  dashboardExport, dashboardPort,
  debug, ensureExtensionAfterConfigEntry, ensureExtensionInConfig, ensurePonytailConfigValue,
  execP, parseJsonObject, parsePonytailConfig, patchPonytailConfig, readPluginsPackage,
  readPonytailConfig, writeIfChanged,
  InstallOptions, WriteOptions,
} from './common.ts';
import {
  ask, askInteractiveChoice, askInteractiveConfirm, closeRL, execNetwork, tty, withInteractiveSpinner,
} from './interactive.ts';
import { printWelcome } from './banner.ts';
import { checkForUpdate, runLatestUpdate } from './update.ts';
import { runUninstall } from './uninstall.ts';
import { runDoctor } from './doctor.ts';
import { runUsage } from './usage.ts';
import { runDashboard } from './dashboard.ts';
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

interface Profile {
  comboDefault: string;
  cavemanDefault: string;
  rtkDefault: boolean;
  ponytailDefault: string;
}

const PONYTAIL_GITHUB_SPEC = 'github:DietrichGebert/ponytail';
const PONYTAIL_NPM_SPEC = '@dietrichgebert/ponytail@latest';

async function stepPonytail(pluginsDir: string, userDir: string, options: InstallOptions): Promise<void> {
  console.log('\n[1/8] Installing Ponytail plugin...');
  await fs.mkdir(pluginsDir, { recursive: true });
  const pkgPath = path.join(pluginsDir, 'package.json');
  const pkg = await readPluginsPackage(pkgPath);
  pkg.dependencies['@dietrichgebert/ponytail'] = PONYTAIL_GITHUB_SPEC;

  if (options.dryRun) {
    console.log(`  [dry-run] would write ${pkgPath}`);
  } else {
    await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log('  [write] package.json');
  }

  const ponytailExtPath = path.join(pluginsDir, 'node_modules', '@dietrichgebert', 'ponytail', 'pi-extension', 'index.js');
  const probeExt = async (): Promise<boolean> => (await readTextIfExists(ponytailExtPath)) !== null;
  // Fast path: extension already present and no refresh asked — skip network.
  let ponytailExtExists = !options.reinstall && !options.dryRun ? await probeExt() : false;
  if (ponytailExtExists) {
    debug('Ponytail pi-extension already installed; skipping network refresh');
  } else if (options.dryRun) {
    // Dry runs preview the wiring below without touching the network.
    console.log(`  [dry-run] would run: omp plugin install ${PONYTAIL_GITHUB_SPEC}`);
    if (options.reinstall) {
      console.log(`  [dry-run] would run: npm install ${PONYTAIL_NPM_SPEC} --save --no-audit --no-fund`);
    }
    ponytailExtExists = true;
  } else {
    // Try omp plugin install first
    try {
      await execNetwork('Installing Ponytail plugin', OMP_BIN, ['plugin', 'install', PONYTAIL_GITHUB_SPEC], { cwd: pluginsDir });
      console.log('  [ok] omp plugin install ran');
    } catch (e) {
      console.log(`  [warn] omp plugin install failed: ${(e as Error).message}`);
    }

    if (options.reinstall) {
      try {
        await execNetwork('Refreshing Ponytail package', 'npm', ['install', PONYTAIL_NPM_SPEC, '--save', '--no-audit', '--no-fund'], { cwd: pluginsDir, timeout: 120000 });
        console.log('  [ok] Ponytail refreshed');
      } catch (e) {
        console.log(`  [fail] Could not refresh ponytail: ${(e as Error).message}`);
        console.log(`  [hint] Manual: cd ~/.omp/plugins && npm install ${PONYTAIL_NPM_SPEC} --save --no-audit --no-fund`);
      }
    }

    // Verify the pi-extension/index.js actually exists
    ponytailExtExists = await probeExt();

    // Fallback: try bun install or npm install
    if (!ponytailExtExists) {
      console.log('  [info] pi-extension/index.js not found after omp plugin install — trying npm/bun install...');
      try {
        await execNetwork('Installing Ponytail dependencies', 'npm', ['install'], { cwd: pluginsDir, timeout: 120000 });
        console.log('  [ok] npm install completed');
      } catch {
        try {
          await execNetwork('Installing Ponytail dependencies', 'bun', ['install'], { cwd: pluginsDir, timeout: 120000 });
          console.log('  [ok] bun install completed');
        } catch (e2) {
          console.log(`  [fail] Could not install ponytail: ${(e2 as Error).message}`);
          console.log('  [hint] Manual: cd ~/.omp/plugins && npm install');
        }
      }
      ponytailExtExists = await probeExt();
    }

    // Last-resort fallback: git clone the repo into node_modules
    if (!ponytailExtExists) {
      console.log('  [info] npm/bun did not produce pi-extension — trying git clone...');
      try {
        const dest = path.join(pluginsDir, 'node_modules', '@dietrichgebert', 'ponytail');
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await execNetwork('Cloning Ponytail repository', 'git', ['clone', '--depth', '1', 'https://github.com/DietrichGebert/ponytail.git', dest], { timeout: 180000 });
        console.log('  [ok] git clone completed');
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
  } else if (!options.dryRun) {
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
  console.log('\n[2/8] Registering tersio as OMP plugin...');
  const pkgPath = path.join(pluginsDir, 'package.json');
  const pkg = await readPluginsPackage(pkgPath);
  pkg.dependencies[PACKAGE_NAME] = `^${PACKAGE_VERSION}`;
  for (const legacy of ['oh-my-pi-token-saver', 'tersio-omp']) {
    if (legacy in pkg.dependencies) {
      delete pkg.dependencies[legacy];
      if (!options.dryRun) console.log(`  [migrate] dropped legacy ${legacy} dependency`);
    }
  }

  if (options.dryRun) {
    console.log(`  [dry-run] would add ${PACKAGE_NAME}@^${PACKAGE_VERSION} to ${pkgPath}`);
    console.log(`  [dry-run] would run: npm install --no-audit --no-fund (in ${pluginsDir})`);
    return false;
  }

  // pkg.dependencies[PACKAGE_NAME] was assigned above, so only reinstall skips this fast path.
  if (!options.reinstall) {
    const installedPkgRaw = await readTextIfExists(path.join(pluginsDir, 'node_modules', PACKAGE_NAME, 'package.json'));
    if (parseJsonObject<{ version?: string }>(installedPkgRaw)?.version === PACKAGE_VERSION) {
      debug(`${PACKAGE_NAME} already installed at v${PACKAGE_VERSION}; skipping npm install`);
      console.log('  [ok] Listed in OMP Settings → Plugins as tersio');
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
  console.log('  [ok] Listed in OMP Settings → Plugins as tersio');
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
  console.log('\n[3/8] Installing RTK binary...');
  try {
    const release = await withInteractiveSpinner('Finding latest RTK release', () => fetchJson<RtkRelease>(RTK_RELEASE_API));
    const triple = resolveRtkTriple();
    if (!triple) return;
    const asset = findRtkAsset(release, triple);
    if (!asset) return;
    const binDest = path.join(binDir, RTK_BINARY_NAME);

    if (options.dryRun) {
      console.log(`  [dry-run] would download ${asset.name} from release ${release.tag_name}`);
      console.log('  [dry-run] would verify checksum against checksums.txt');
      console.log(`  [dry-run] would extract and install to ${binDest}`);
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
      console.log(`  [write] ${binDest}`);

      if (!IS_WINDOWS) {
        await fs.chmod(binDest, 0o755);
        debug(`chmod 755 ${binDest}`);
      }

      try {
        const v = (await execP(binDest, ['--version'], { timeout: 10000, shell: false })).stdout.trim();
        console.log(`  [ok] ${binDest} → ${v}`);
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
}

// Copy repo source files into the target extension dir. First entry is
// required (skip label on missing); rest are optional companions.
async function copySources(extDir: string, files: Array<[string, string]>, skipLabel: string, options: WriteOptions): Promise<boolean> {
  const src = await readTextIfExists(files[0][0]);
  if (!src) {
    console.log(`  [skip] ${skipLabel} not found in repo`);
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
  ], 'shared/session-state.js', options);
}

async function stepModeReinforcement(extDir: string, ponytailExtPath: string, options: WriteOptions): Promise<void> {
  console.log('\n[8/8] Installing mode reinforcement extension...');
  const dest = path.join(extDir, 'shared', 'mode-reinforcement.js');
  if (!await copySources(extDir, [[MODE_REINFORCEMENT_INDEX, path.join('shared', 'mode-reinforcement.js')]], 'shared/mode-reinforcement.js', options)) return;
  await ensureExtensionAfterConfigEntry(path.join(path.dirname(extDir), 'config.yml'), dest, ponytailExtPath, 'mode reinforcement', options);
}

async function stepRtkSession(extDir: string, options: WriteOptions): Promise<void> {
  console.log('\n[4/8] Installing RTK session extension...');
  await copySources(extDir, [[RTK_SESSION_INDEX, path.join('rtk-session', 'index.js')]], 'rtk-session/index.js', options);
}

// One rule fetch serves user- and project-level installs; dry runs stay offline
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
  console.log('\n[5/8] Installing Caveman session extension...');
  const cavemanDir = path.join(extDir, 'caveman-session');
  if (!options.dryRun) await fs.mkdir(cavemanDir, { recursive: true });

  const ruleDest = path.join(cavemanDir, 'rule.md');
  if (rule === null && (await readTextIfExists(ruleDest)) !== null) {
    console.log('  [info] Keeping existing rule.md');
  } else if (rule === null) {
    console.log('  [skip] Caveman rule.md unavailable');
    console.log(`  [hint] Manual: ${CAVEMAN_REMOTE_RULE}`);
  } else {
    await writeIfChanged(ruleDest, rule, options);
  }

  await copySources(extDir, [[CAVEMAN_INDEX, path.join('caveman-session', 'index.js')]], 'caveman-session/index.js', options);
}

async function stepTersioCommands(extDir: string, options: WriteOptions): Promise<void> {
  console.log('\n[7/8] Installing Tersio root-command extension...');
  await copySources(extDir, [[TERSIO_COMMANDS_INDEX, path.join('tersio-commands', 'index.js')]], 'tersio-commands/index.js', options);
}

async function stepUpdater(extDir: string, options: WriteOptions): Promise<void> {
  await copySources(extDir, [[UPDATER_INDEX, path.join('ai-addons-updater', 'index.js')]], 'ai-addons-updater/index.js', options);
}

async function stepCombo(extDir: string, options: WriteOptions): Promise<void> {
  console.log('\n[6/8] Installing Combo toggle extension...');
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

// Determine install scope: reinstall > flag > non-interactive default > prompt.
async function resolveScope(): Promise<string> {
  if (reinstall) {
    console.log('  Scope: user (reinstall)');
    return '1';
  }
  if (scopeFlag) {
    const scope = SCOPE_MAP[scopeFlag];
    if (!scope) {
      console.log(`  [fail] Invalid --scope: ${scopeFlag}. Use: user, project, both`);
      closeRL();
      process.exit(1);
    }
    console.log(`  Scope: ${scopeFlag}`);
    return scope;
  }
  if (install || yes) {
    console.log(`  Scope: user (${install ? 'install default' : '--scope omitted, defaulting to user with --yes'})`);
    return '1';
  }
  if (tty()) {
    const choice = await askInteractiveChoice('Install scope', [
      { value: '1', label: 'User-level', hint: 'all OMP sessions' },
      { value: '2', label: 'Project-level', hint: 'this repo only' },
      { value: '3', label: 'Both' },
    ], '1');
    if (choice.status === 'selected') return choice.value;
    closeRL();
    process.exit(130);
  }
  console.log('\nInstall scope:');
  console.log('  1) User-level (all OMP sessions)');
  console.log('  2) Project-level (this repo only)');
  console.log('  3) Both');
  while (true) {
    const answer = (await ask('\nChoose [1-3] (default 1): ')).trim() || '1';
    if (answer === '1' || answer === '2' || answer === '3') return answer;
    console.log(`  [fail] Invalid scope: ${answer}. Choose 1, 2, or 3.`);
  }
}

async function resolveProfile(): Promise<Profile> {
  const profile = defaultProfile();

  // Single interactive prompt: the Combo preset implies all three modes.
  // Numbered menu, same pattern as the scope prompt — no typing preset names.
  // Only for a real user at a terminal, only when no default flags were
  // given, and never for --apply-update runs.
  if (tty() && !profileFlagsGiven && !applyUpdate && (install || reinstall)) {
    const choice = await askInteractiveChoice('Session-start defaults — Combo preset', [
      { value: 'off', label: 'off' },
      { value: 'medium', label: 'medium', hint: 'caveman=lite, rtk=on, ponytail=lite' },
      { value: 'balanced', label: 'balanced', hint: 'caveman=full, rtk=on, ponytail=full' },
      { value: 'max', label: 'max', hint: 'caveman=ultra, rtk=on, ponytail=ultra' },
    ], 'off');
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

  console.log(`  Profile: combo default=${profile.comboDefault} (caveman=${profile.cavemanDefault} · rtk=${profile.rtkDefault ? 'on' : 'off'} · ponytail=${profile.ponytailDefault})`);
  return profile;
}

// ponytail: post-install guard. List entries under `extensions: null` break
// OMP launch, so fail loudly here instead of at the next OMP start.
async function validateConfigExtensions(agentDir: string, options: WriteOptions): Promise<void> {
  if (options.dryRun) return;
  const raw = await readTextIfExists(path.join(agentDir, 'config.yml'));
  if (!raw) return;
  const lines = raw.split('\n');
  const keyIdx = lines.findIndex((l) => EXTENSIONS_KEY_RE.test(l));
  if (keyIdx === -1) return;
  const scalarNull = /^\s*extensions\s*:\s*(null|~|\[\s*\])\s*$/i.test(lines[keyIdx]);
  const hasEntries = lines.slice(keyIdx + 1).some((l) => /^\s*-\s+\S/.test(l));
  if (scalarNull && hasEntries) {
    console.log('  [fail] config.yml lists extensions under `extensions: null` — OMP will fail to launch.');
    console.log('  [hint] Replace the `extensions: null` line with `extensions:`, then reinstall.');
    process.exitCode = 1;
  } else {
    console.log('  [ok] config.yml extensions key valid');
  }
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
    { value: 'install', label: 'Install add-ons', hint: 'user/project scope + combo defaults' },
    { value: 'check', label: 'Check for updates', hint: 'compare installed vs latest release' },
    { value: 'update', label: 'Update everything', hint: 'CLI plus all ai-addons' },
    { value: 'doctor', label: 'Doctor', hint: 'verify the installation' },
    { value: 'usage', label: 'Usage', hint: 'token usage and savings report' },
    { value: 'gain', label: 'Gain dashboard', hint: 'open the report in your browser' },
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
    case 'check': {
      const latest = await checkForUpdate(true);
      if (typeof latest === 'string') console.log(`  [update] tersio ${latest} available (installed ${PACKAGE_VERSION})`);
      else if (latest === 'unknown') console.log(`  [warn] could not reach the npm registry — run \`tersio update\` to retry`);
      else console.log(`  [ok] tersio ${PACKAGE_VERSION} is the latest`);
      closeRL();
      break;
    }
    case 'update':
      await runLatestUpdate();
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
    case 'uninstall':
      await runUninstall();
      closeRL();
      break;
  }
}

async function runInstall(): Promise<void> {
  if (command === null && tty() && !yes) {
    await runCommandMenu();
    return;
  }
  printWelcome();
  if (reinstall) {
    await runUninstall({ yes: true, removePonytail: false, removeRtk: true });
  }

  if (dryRun) console.log('[dry-run] No changes will be written.\n');

  console.log(`=== Tersio v${PACKAGE_VERSION} ===`);
  console.log(`  Platform: ${process.platform}`);
  console.log(`  Arch: ${process.arch}`);
  console.log(`  Home: ${HOME}`);

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

  const scope = await resolveScope();


  // Resolve session defaults: flags > interactive prompt > defaults.
  const profile = await resolveProfile();


  const userDir = OMP_AGENT_DIR;
  const userExtDir = path.join(userDir, 'extensions');
  const projectExtDir = path.join(process.cwd(), '.omp', 'extensions');

  // apply-update is `tersio update`'s payload run: treat it like reinstall so
  // the add-ons refresh too — Ponytail package via npm, self plugin, RTK
  // binary (always re-downloaded), and the Caveman rule (always re-fetched).
  const options: InstallOptions = { dryRun, verbose, yes, scope, reinstall: reinstall || applyUpdate };

  // Check prerequisites
  console.log('\nPrerequisites:');
  try {
    const v = (await execP(OMP_BIN, ['--version'])).stdout.trim();
    console.log(`  [ok] omp ${v}`);
  } catch {
    console.log('  [fail] omp not found — ensure it\'s installed');
  }

  const cavemanRule = await fetchCavemanRule(options);

  if (scope === '1' || scope === '3') {
    console.log('\n--- User-level install ---');
    await stepSharedSessionState(userExtDir, options);
    await stepPonytail(OMP_PLUGINS_DIR, userDir, options);
    const selfPlugin = await stepSelfPlugin(OMP_PLUGINS_DIR, options);
    const ponytailExtPath = path.join(OMP_PLUGINS_DIR, 'node_modules', '@dietrichgebert', 'ponytail', 'pi-extension', 'index.js');
    await stepRtk(BUN_BIN_DIR, options);
    await stepRtkSession(userExtDir, options);
    await stepCaveman(userExtDir, cavemanRule, options);
    await stepCombo(userExtDir, options);
    await stepTersioCommands(userExtDir, options);
    await stepModeReinforcement(userExtDir, ponytailExtPath, options);
    await stepUpdater(userExtDir, options);
    if (selfPlugin) await writePluginSettings(profile, options);
    await validateConfigExtensions(userDir, options);
  }

  if (scope === '2' || scope === '3') {
    console.log('\n--- Project-level install ---');
    await stepSharedSessionState(projectExtDir, options);
    await stepRtkSession(projectExtDir, options);
    await stepCaveman(projectExtDir, cavemanRule, options);
    await stepTersioCommands(projectExtDir, options);
    await stepUpdater(projectExtDir, options);
    console.log('  [note] Ponytail, RTK binary, and Combo toggle require user-level (global) install');
  }

  console.log('\n=== Installation complete ===');
  console.log('\nNext steps:');
  console.log('  1. Restart OMP');
  console.log('  2. /caveman full');
  console.log('  3. /rtk on');
  console.log('  4. /ponytail full');
  console.log('  5. /ai-addons check');
  console.log('  6. /combo medium   (toggle all 3 at once — off by default)');

  closeRL();
}
export { runInstall };
