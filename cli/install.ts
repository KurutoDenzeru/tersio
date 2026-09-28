// cli/install.ts — install flow and all setup steps.
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUN_BIN_DIR, COMBO_PRESET_MODES, IS_WINDOWS, OMP_AGENT_DIR, OMP_PLUGINS_DIR, OMP_BIN,
  PACKAGE_NAME, PACKAGE_VERSION, RTK_BINARY_NAME, args,
  applyUpdate, cavemanDefaultFlag, comboDefaultFlag, command, dryRun, install,
  ponytailDefaultFlag, profileFlagsGiven, rtkDefaultFlag, verbose, yes,
  dashboardExport, dashboardPort,
  debug, ensurePonytailConfigValue,
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
  CAVEMAN_REMOTE_RULE, RTK_RELEASE_API, RtkRelease, RtkReleaseAsset, fetchJson, findFile, findHoistedPackage, httpsGet,
  httpsDownload, parseChecksum, piAgentDir, readTextIfExists, resolveRtkBinary, rtkPlatformSpec, sha256File,
} from '../extensions/lib/utils.ts';
import { storedProfile, writePluginSettings } from './profile.ts';
import type { Profile } from './profile.ts';
import { detectHosts, hostHint, hostLabel, parseHostArg, piTersioSource } from './hosts.ts';
import type { HostEntry, HostId } from './hosts.ts';

// Paths to extension source files (relative to this script)
const EXT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'extensions');
const SHARED_SESSION_STATE = path.join(EXT_DIR, 'shared', 'session-state.ts');
const SHARED_HOST = path.join(EXT_DIR, 'shared', 'host.ts');
const CAVEMAN_INDEX = path.join(EXT_DIR, 'caveman-session', 'index.ts');
const CAVEMAN_RULE = path.join(EXT_DIR, 'caveman-session', 'rule.md');
const RTK_SESSION_INDEX = path.join(EXT_DIR, 'rtk-session', 'index.ts');
const UPDATER_INDEX = path.join(EXT_DIR, 'ai-addons-updater', 'index.ts');
const COMBO_TOGGLE_INDEX = path.join(EXT_DIR, 'combo-toggle', 'index.ts');
const TERSIO_COMMANDS_INDEX = path.join(EXT_DIR, 'tersio-commands', 'index.ts');
const SHARED_TYPES = path.join(EXT_DIR, 'shared', 'types.ts');
const LIB_UTILS = path.join(EXT_DIR, 'lib', 'utils.ts');
const SHARED_PLUGIN_SETTINGS = path.join(EXT_DIR, 'shared', 'plugin-settings.ts');
const SHARED_USAGE_LEDGER = path.join(EXT_DIR, 'shared', 'usage-ledger.ts');
const SHARED_PRICING = path.join(EXT_DIR, 'shared', 'pricing.ts');
const SHARED_CARBON = path.join(EXT_DIR, 'shared', 'carbon.ts');

async function stepPonytail(pluginsDir: string, options: InstallOptions): Promise<void> {
  if (!options.quiet) console.log('  Ponytail — ensure bundled plugin');
  await fs.mkdir(pluginsDir, { recursive: true });
  const pkgPath = path.join(pluginsDir, 'package.json');
  const pkg = await readPluginsPackage(pkgPath);
  // Migration: Ponytail is a tersio dependency now, so drop the legacy plugin
  // row. Runs after stepSelfPlugin.
  let migrated = false;
  if ('@dietrichgebert/ponytail' in pkg.dependencies) {
    delete pkg.dependencies['@dietrichgebert/ponytail'];
    migrated = true;
  }

  if (options.dryRun) {
    if (verbose && !options.quiet) console.log(`  [dry-run] would write ${pkgPath}`);
    if (migrated && verbose && !options.quiet) console.log(`  [dry-run] would drop the separate @dietrichgebert/ponytail dependency (bundled with tersio)`);
  } else if (migrated) {
    await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    if (!options.quiet) console.log('  [migrate] dropped separate @dietrichgebert/ponytail dependency (now bundled with tersio)');
  }

  const ponytailExtPath = path.join(pluginsDir, 'node_modules', '@dietrichgebert', 'ponytail', 'pi-extension', 'index.js');
  const probeExt = async (): Promise<boolean> => (await readTextIfExists(ponytailExtPath)) !== null;
  // Fast path: bundled copy present and no refresh asked, so skip the network.
  // Migration always reinstalls, because only npm prunes the legacy copy.
  let ponytailExtExists = !options.reinstall && !options.dryRun && !migrated ? await probeExt() : false;
  if (ponytailExtExists) {
    debug('Bundled Ponytail pi-extension already installed; skipping network refresh');
  } else if (options.dryRun) {
    // Dry runs preview the wiring below without touching the network.
    if (verbose && !options.quiet) console.log('  [dry-run] would run: npm install --no-audit --no-fund (in plugins dir)');
    ponytailExtExists = true;
  } else {
    // Reinstall only when the self-plugin step did not materialize it.
    try {
      await execNetwork('Installing bundled Ponytail', 'npm', ['install', '--no-audit', '--no-fund'], { cwd: pluginsDir, timeout: 180000 });
    } catch {
      try {
        await execNetwork('Installing bundled Ponytail', 'bun', ['install'], { cwd: pluginsDir, timeout: 180000 });
      } catch (e) {
        console.log(`  [fail] Could not install bundled ponytail: ${(e as Error).message}`);
        console.log('  [hint] Manual: cd ~/.omp/plugins && npm install --no-audit --no-fund');
      }
    }
    ponytailExtExists = await probeExt();
  }

  if (!ponytailExtExists) {
    console.log('  [skip] Bundled Ponytail pi-extension/index.js still not found — skill-only mode');
    console.log('  [hint] The /ponytail command won\'t work, but ponytail skills will still load');
  } else if (!options.dryRun && !options.quiet) {
    debug('Bundled Ponytail pi-extension found; OMP loads it from the plugin manifest');
  }
  await ensurePonytailConfigValue('defaultMode', 'off', options);
  // hideStatus=true keeps the upstream ponytail bar hidden; combo owns the bar.
  await ensurePonytailConfigValue('hideStatus', true, options);
}

// Registers this package in ~/.omp/plugins so OMP lists it under Settings →
// Plugins. True when the package is verified in plugins/node_modules.
async function stepSelfPlugin(pluginsDir: string, options: InstallOptions): Promise<boolean> {
  if (!options.quiet) console.log('  Tersio — register plugin');
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
    if (verbose && !options.quiet) console.log(`  [dry-run] would add ${PACKAGE_NAME}@^${PACKAGE_VERSION} to ${pkgPath}`);
    if (verbose && !options.quiet) console.log(`  [dry-run] would run: npm install --no-audit --no-fund (in ${pluginsDir})`);
    return false;
  }

  // pkg.dependencies[PACKAGE_NAME] was assigned above, so only reinstall skips this fast path.
  if (!options.reinstall) {
    const installedPkgRaw = await readTextIfExists(path.join(pluginsDir, 'node_modules', PACKAGE_NAME, 'package.json'));
    if (parseJsonObject<{ version?: string }>(installedPkgRaw)?.version === PACKAGE_VERSION) {
      debug(`${PACKAGE_NAME} already installed at v${PACKAGE_VERSION}; skipping npm install`);
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
  debug('tersio listed in OMP plugins');
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

async function verifyRtkArchive(archivePath: string, assetName: string, checksumsText: string | null, options: WriteOptions = {}): Promise<boolean> {
  if (!checksumsText) {
    if (!options.quiet) console.log('  [warn] No checksums.txt available — skipping verification');
    return true;
  }
  const expected = parseChecksum(checksumsText, assetName);
  const actual = await sha256File(archivePath);
  if (!expected) {
    if (!options.quiet) console.log(`  [warn] checksums.txt missing entry for ${assetName} — skipping verification`);
    return true;
  }
  if (actual === expected) {
    debug(`Checksum verified for ${assetName}`);
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

// The binary is machine-wide and only OMP needs the tool_call wiring, since
// the extensions call the binary themselves on either host. So an install that
// finds one already present only rebinds: no registry probe, no download.
// `tersio update` still refreshes it, because refreshing is that command's job.
async function stepRtk(binDir: string, options: InstallOptions, target: 'omp' | 'pi' = 'omp'): Promise<void> {
  const binDest = path.join(binDir, RTK_BINARY_NAME);
  const found = resolveRtkBinary();
  const bind = async (binary: string): Promise<void> => {
    if (target !== 'omp') return;
    if (!(await fileExists(binary))) {
      console.log('  [skip] no rtk binary to wire — install rtk, then run: rtk init -g --agent omp');
      return;
    }
    await wireRtkOmp(binary, options);
  };

  if (found && !applyUpdate) {
    // The path only under --verbose: a plain run, and a dry run, stay free of
    // real user paths.
    if (!options.quiet) {
      const where = verbose ? ` (${found})` : '';
      console.log(`  RTK — already installed${where}${target === 'omp' ? ', binding into OMP' : ', nothing to bind on pi'}`);
    }
    await bind(found);
    return;
  }

  if (!options.quiet) console.log(`  RTK — download binary and ${target === 'omp' ? 'wire into OMP' : 'put it on PATH'}`);
  // A failed download must not skip wiring: a pre-existing binary serves the
  // OMP hook just as well. Dry runs stay offline.
  if (options.dryRun) {
    if (verbose && !options.quiet) console.log(`  [dry-run] would download rtk binary and install to ${binDest}`);
    await bind(found ?? binDest);
    return;
  }
  try {
    const release = await withInteractiveSpinner('Finding latest RTK release', () => fetchJson<RtkRelease>(RTK_RELEASE_API));
    const triple = resolveRtkTriple();
    if (!triple) return;
    const asset = findRtkAsset(release, triple);
    if (!asset) return;
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
      if (!await verifyRtkArchive(archivePath, asset.name, checksumsText, options)) return;

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

      if (!IS_WINDOWS) {
        await fs.chmod(binDest, 0o755);
        debug(`chmod 755 ${binDest}`);
      }

      try {
        await execP(binDest, ['--version'], { timeout: 30000, shell: false });
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

  // Wire rtk's tool_call extension: the binary alone never meters a session.
  await bind(binDest);
}

// Copy sources into the target extension dir. First entry is required; the
// rest are optional companions.
async function copySources(extDir: string, files: Array<[string, string]>, skipLabel: string, options: WriteOptions): Promise<boolean> {
  const src = await readTextIfExists(files[0][0]);
  if (!src) {
    if (!options.quiet && options.dryRun) console.log(`  [skip] ${skipLabel} not found in repo`);
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
  if (!options.quiet) console.log('  Shared files — sync session bridge');
  await copySources(extDir, [
    [SHARED_HOST, path.join('shared', 'host.ts')],
    [SHARED_SESSION_STATE, path.join('shared', 'session-state.ts')],
    [SHARED_TYPES, path.join('shared', 'types.ts')],
    [LIB_UTILS, path.join('lib', 'utils.ts')],
    [SHARED_PLUGIN_SETTINGS, path.join('shared', 'plugin-settings.ts')],
    [SHARED_USAGE_LEDGER, path.join('shared', 'usage-ledger.ts')],
    [SHARED_PRICING, path.join('shared', 'pricing.ts')],
    [SHARED_CARBON, path.join('shared', 'carbon.ts')],
  ], 'shared/session-state.js', options);
}


async function stepRtkSession(extDir: string, options: WriteOptions): Promise<void> {
  if (!options.quiet) console.log('  RTK session — install session mode');
  await copySources(extDir, [[RTK_SESSION_INDEX, path.join('rtk-session', 'index.ts')]], 'rtk-session/index.ts', options);
}

// One fetch serves the install; dry runs stay offline and preview the bundled
// rule's destination.
async function fetchCavemanRule(options: WriteOptions): Promise<string | null> {
  const bundled = await readTextIfExists(CAVEMAN_RULE);
  if (options.dryRun) return bundled;
  try {
    return await withInteractiveSpinner('Fetching Caveman rule', () => httpsGet(CAVEMAN_REMOTE_RULE));
  } catch (e) {
    if (bundled !== null) {
      debug(`Using bundled Caveman rule: ${(e as Error).message}`);
      return bundled;
    }
    console.log(`  [warn] Could not fetch caveman rule: ${(e as Error).message}`);
    return null;
  }
}

async function stepCaveman(extDir: string, rule: string | null, options: WriteOptions): Promise<void> {
  if (!options.quiet) console.log('  Caveman — fetch rule and install session mode');
  const cavemanDir = path.join(extDir, 'caveman-session');
  if (!options.dryRun) await fs.mkdir(cavemanDir, { recursive: true });

  const ruleDest = path.join(cavemanDir, 'rule.md');
  if (rule === null && (await readTextIfExists(ruleDest)) !== null) {
    debug('Keeping existing rule.md');
  } else if (rule === null) {
    console.log('  [skip] Caveman rule.md unavailable');
    console.log(`  [hint] Manual: ${CAVEMAN_REMOTE_RULE}`);
  } else {
    await writeIfChanged(ruleDest, rule, options);
  }

  await copySources(extDir, [[CAVEMAN_INDEX, path.join('caveman-session', 'index.ts')]], 'caveman-session/index.ts', options);
}

async function stepTersioCommands(extDir: string, options: WriteOptions): Promise<void> {
  if (!options.quiet) console.log('  Tersio commands — install /tersio root command');
  await copySources(extDir, [[TERSIO_COMMANDS_INDEX, path.join('tersio-commands', 'index.ts')]], 'tersio-commands/index.ts', options);
}

async function stepUpdater(extDir: string, options: WriteOptions): Promise<void> {
  await copySources(extDir, [[UPDATER_INDEX, path.join('ai-addons-updater', 'index.ts')]], 'ai-addons-updater/index.ts', options);
}

async function stepCombo(extDir: string, options: InstallOptions): Promise<void> {
  if (!options.quiet) console.log('  Combo — install preset switch');
  await copySources(extDir, [[COMBO_TOGGLE_INDEX, path.join('combo-toggle', 'index.ts')]], 'combo-toggle/index.ts', options);
}


async function resolveProfile(opts: { quiet?: boolean } = {}): Promise<Profile> {
  // Seed from the lock file so flag-less runs keep the user's defaults.
  const profile = await storedProfile();

  // One numbered prompt for all three modes, for a real terminal user with no
  // default flags. Never for --apply-update, and never for a script.
  if (tty() && !profileFlagsGiven && !applyUpdate) {
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

  if ((!opts.quiet && verbose) || dryRun) console.log(`  Defaults: combo=${profile.comboDefault} (caveman=${profile.cavemanDefault} · rtk=${profile.rtkDefault ? 'on' : 'off'} · ponytail=${profile.ponytailDefault})`);
  return profile;
}

let updatePromptDone = false;

// Bare `tersio` at a terminal is a command picker: update offer first, then a
// menu over every command. Scripts, pipes, --yes, and --dry-run install.
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
    { value: 'doctor', label: 'Doctor', hint: 'verify the installation' },
    { value: 'usage', label: 'Usage', hint: 'token usage and savings report' },
    { value: 'dashboard', label: 'Dashboard', hint: 'open the report in your browser' },
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
    case 'doctor': {
      const summary = await runDoctor();
      if (!dryRun && summary.missing + summary.warn > 0) {
        const fixIt = await askInteractiveConfirm('Doctor found problems — repair them now?');
        if (fixIt.status === 'confirmed' && fixIt.value) {
          const { runDoctorRepairs } = await import('./doctor-fix.ts');
          const failed = await runDoctorRepairs(['all']);
          if (failed.length === 0) {
            console.log('\n  Repairs done — rechecking.');
            await runDoctor();
          } else {
            console.log(`\n  ${failed.length} repair(s) failed (${failed.join(', ')}) — see [fail] lines above.`);
          }
        }
      }
      closeRL();
      break;
    }
    case 'usage':
      await runUsage();
      closeRL();
      break;
    case 'dashboard':
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

// Which host this run targets. --host pins it; a TTY user picks; scripts,
// pipes, --yes, and --dry-run keep the pre-multi-host default of Oh My Pi.
let targetHost: HostId = 'omp';

async function chooseHost(title: string, only?: HostId[]): Promise<HostId> {
  const hosts = detectHosts().filter((host) => !only || only.includes(host.id));
  const choice = await askInteractiveChoice(title, hosts.map((host) => ({
    value: host.id,
    label: hostLabel(host),
    hint: hostHint(host),
  })), targetHost);
  if (choice.status !== 'selected') {
    closeRL();
    process.exit(130);
  }
  return choice.value as HostId;
}

function hostEntry(id: HostId): HostEntry {
  return detectHosts().find((host) => host.id === id) as HostEntry;
}

// pi auto-discovers `<agent-dir>/extensions/**/index.ts`, so the pi route writes
// the same tree the OMP route writes and needs no registration. Ponytail comes
// from a pi package; its skills are the offline fallback.
async function stepPiLayer(profile: Profile, options: InstallOptions): Promise<void> {
  const agentDir = piAgentDir();
  const extDir = path.join(agentDir, 'extensions');
  const declared = piTersioSource(agentDir);
  if (declared) console.log(`  [note] pi also has a tersio package (${declared}) — remove one, or both copies load: pi remove npm:${PACKAGE_NAME}`);

  if (!options.quiet) console.log(`  Pi — write the extension tree (${extDir})`);
  const cavemanRule = await fetchCavemanRule(options);
  await stepSharedSessionState(extDir, options);
  // OMP loads rtk-session from its plugin manifest, so only the pi tree copies it.
  await copySources(extDir, [[RTK_SESSION_INDEX, path.join('rtk-session', 'index.ts')]], 'rtk-session/index.ts', options);
  await stepCaveman(extDir, cavemanRule, options);
  await stepCombo(extDir, options);
  await stepTersioCommands(extDir, options);
  await stepUpdater(extDir, options);
  await stepPonytailForPi(agentDir, options);
}

// pi reads Ponytail from a package, so install it the pi way. Offline or failed,
// the bundled copy's skills are copied instead: plain markdown, and the combo
// extension injects the Ponytail instructions either way.
async function stepPonytailForPi(agentDir: string, options: InstallOptions): Promise<void> {
  if (!options.quiet) console.log('  Ponytail — ensure the pi package');
  if (!options.dryRun) {
    try {
      await execNetwork('Installing Ponytail for pi', 'pi', ['install', 'npm:@dietrichgebert/ponytail'], { timeout: 300000 });
      return;
    } catch (e) {
      console.log(`  [fail] pi install ponytail: ${shortError(e)}`);
    }
  }
  const skills = findHoistedPackage('@dietrichgebert/ponytail', path.dirname(fileURLToPath(import.meta.url)), 'skills');
  if (!skills) {
    console.log('  [skip] Ponytail package not found next to the CLI — skills not copied');
    console.log('  [hint] The /ponytail command will not work; run: pi install npm:@dietrichgebert/ponytail');
    return;
  }
  const dest = path.join(agentDir, 'skills');
  if (options.dryRun) {
    if (verbose && !options.quiet) console.log(`  [dry-run] would copy Ponytail skills to ${dest}`);
    return;
  }
  for (const entry of await fs.readdir(skills, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const to = path.join(dest, entry.name);
    await fs.rm(to, { recursive: true, force: true });
    await fs.cp(path.join(skills, entry.name), to, { recursive: true });
    if (!options.quiet) console.log(`  [write] skill ${entry.name} → ${to}`);
  }
}

async function runInstall(): Promise<void> {
  // Without this guard a picked command re-enters here with command === null
  // and loops straight back into the picker.
  if (command === null && tty() && !yes && !updatePromptDone) {
    await runCommandMenu();
    return;
  }

  // The host question comes first: it decides which tree is written, which
  // reinstall cleanup runs, and which defaults file is stored. --host pins it;
  // scripts, pipes, --yes, and --dry-run keep the OMP default.
  let pinned: HostId | undefined;
  try {
    pinned = parseHostArg(args);
  } catch (e) {
    console.error(`[fail] ${(e as Error).message}`);
    process.exit(1);
  }
  if (pinned) targetHost = pinned;
  else if (tty() && !yes && !dryRun && !applyUpdate && command !== 'uninstall') {
    targetHost = await chooseHost('Install Tersio into which agent?');
  }
  const host = hostEntry(targetHost);

  // apply-update is `tersio update`'s payload: stay silent, the parent already
  // printed the plan and owns the summary.
  const quiet = applyUpdate;
  if (!quiet) printWelcome();

  if (dryRun && !quiet) console.log('Preview — no changes will be written.\n');

  if (!quiet) {
    console.log(`Installing Tersio v${PACKAGE_VERSION}`);
  }

  // Nudge humans about a newer release; silent without a TTY and for
  // apply-update, which is itself an update run.
  if (tty() && !applyUpdate && command !== 'uninstall') {
    const newer = await checkForUpdate();
    if (typeof newer === 'string') {
      // Update pending: offer it here instead of burying it above the install
      // prompts. Yes runs the full update and stops.
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
  const profile = await resolveProfile({ quiet });

  const userDir = OMP_AGENT_DIR;
  const userExtDir = path.join(userDir, 'extensions');

  // apply-update refreshes the add-ons like a reinstall: Ponytail via npm,
  // self plugin, RTK binary, and the Caveman rule.
  const installOptions: InstallOptions = { dryRun, verbose, yes, reinstall: applyUpdate, quiet };

  try {
    const v = (await execP(OMP_BIN, ['--version'])).stdout.trim();
    if (verbose && !quiet) console.log(`  omp ${v}`);
  } catch {
    if (targetHost === 'omp') console.log('  [fail] omp not found — ensure it\'s installed');
  }

  if (targetHost === 'pi') {
    const failures: string[] = [];
    const capture = async (label: string, work: () => Promise<void>): Promise<void> => {
      try {
        await work();
      } catch (e) {
        failures.push(label);
        console.log(`  [fail] ${label}: ${shortError(e)}`);
      }
    };
    await capture('pi tree', () => stepPiLayer(profile, installOptions));
    await capture('rtk', () => stepRtk(BUN_BIN_DIR, installOptions, 'pi'));
    await capture('settings', () => writePluginSettings(profile, installOptions));
    if (failures.length > 0) console.log(`\nDone with ${failures.length} failure(s) — see [fail] lines above.`);
    else console.log('\nDone — restart pi, then /combo medium.');
    closeRL();
    return;
  }

  const cavemanRule = await fetchCavemanRule(installOptions);

  const failures: string[] = [];
  const capture = async (label: string, work: () => Promise<void>): Promise<void> => {
    try {
      await work();
    } catch (e) {
      failures.push(label);
      console.log(`  [fail] ${label}: ${shortError(e)}`);
    }
  };
  await capture('shared', () => stepSharedSessionState(userExtDir, installOptions));
  let selfPlugin = false;
  await capture('self-plugin', async () => { selfPlugin = await stepSelfPlugin(OMP_PLUGINS_DIR, installOptions); });
  await capture('ponytail', () => stepPonytail(OMP_PLUGINS_DIR, installOptions));
  await capture('rtk', () => stepRtk(BUN_BIN_DIR, installOptions));
  await capture('rtk session', () => stepRtkSession(userExtDir, installOptions));
  await capture('caveman', () => stepCaveman(path.join(OMP_PLUGINS_DIR, 'node_modules', '@krtclcdy', 'tersio', 'extensions'), cavemanRule, installOptions));
  await capture('combo', () => stepCombo(userExtDir, installOptions));
  await capture('commands', () => stepTersioCommands(userExtDir, installOptions));
  await capture('updater', () => stepUpdater(userExtDir, installOptions));
  if (selfPlugin) await capture('settings', () => writePluginSettings(profile, installOptions));

  if (quiet) {
    if (failures.length > 0) console.log(`  add-ons: ${failures.length} failed (${failures.join(', ')}) — see [fail] lines above`);
  } else {
    console.log(failures.length === 0 ? '\nDone — restart OMP, then /combo medium.' : `\nDone with ${failures.length} failure(s) — see [fail] lines above.`);
  }

  closeRL();
}
export { runInstall };
