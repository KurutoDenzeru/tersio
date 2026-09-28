// cli/install.ts — install/reinstall flow and all setup steps.
import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUN_BIN_DIR, COMBO_PRESET_MODES, IS_WINDOWS, OMP_AGENT_DIR, OMP_PLUGINS_DIR, OMP_BIN,
  PACKAGE_NAME, PACKAGE_VERSION, RTK_BINARY_NAME,
  agentFlag, applyUpdate, cavemanDefaultFlag, comboDefaultFlag, command, dryRun, install,
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
import { HOSTS, byId } from './agent-hosts.ts';
import { printWelcome } from './banner.ts';
import { checkForUpdate, runLatestUpdate } from './update.ts';
import { runUninstall } from './uninstall.ts';
import { runDoctor } from './doctor.ts';
import { runReset } from './reset.ts';
import { runUsage } from './usage.ts';
import { runDashboard } from './dashboard.ts';
import { wireRtkOmp, wireRtkAgent, rtkAgentFor } from './rtk-wiring.ts';
import { installOpenCodeRtk, openCodePluginPath } from './opencode-wiring.ts';
import { installPiTersio } from './pi-wiring.ts';
import { piExtensionTargets, piLayer } from './pi-layer.ts';
import {
  CAVEMAN_REMOTE_RULE, RTK_RELEASE_API, RtkRelease, RtkReleaseAsset, fetchJson, findFile, httpsGet,
  httpsDownload, parseChecksum, readTextIfExists, rtkPlatformSpec, sha256File,
} from '../extensions/lib/utils.ts';
import { storedProfile, writePluginSettings } from './profile.ts';
import {
  applyHosts, agentChoices, clearRetiredPaths, detectHosts, displayPath, groupByLabel,
  installedHostIds, installedState,
  normalizeIds, planInstall, pluralArtifactLabel, readSelection, resolveAgentSelection, writeSelection,
  type InstallPlan, type PlanLine,
} from './agents.ts';
import { ompLayer } from './omp-layer.ts';
import type { Profile } from './profile.ts';

// Paths to extension source files (relative to this script)
const EXT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'extensions');
const SHARED_SESSION_STATE = path.join(EXT_DIR, 'shared', 'session-state.ts');
const SHARED_OMP_PROMPT = path.join(EXT_DIR, 'shared', 'omp-prompt.ts');
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
/**
 * OpenCode's plugin, read from the extension source rather than imported: it
 * is a self-contained ESM file with no build step, and it is written verbatim
 * into the user's config dir where there is no node_modules to import from.
 */
const OPENCODE_PLUGIN_SOURCE = path.join(EXT_DIR, 'opencode', 'rtk-plugin.ts');

// The directory names come from cli/pi-layer.ts, which the uninstall removal
// also reads, so a plan and a removal cannot name different sets.
import { PI_EXTENSION_DIRS } from './pi-layer.ts';
/**
 * Pi's extension tree, as `[repo path, path under the Pi ext dir]` pairs.
 *
 * Pi loads each `<agent-dir>/extensions/<dir>/index.ts` at one level with no
 * recursion (core/extensions/loader.ts, resolvePackageExtensions), so shared
 * modules sit BESIDE the extension dirs — where the OMP layer already keeps
 * them, giving both hosts one layout and one `../shared/x.ts` spelling.
 *
 * The repo puts extensions/shared/ two levels higher than the installed tree
 * does, so extensions/pi/ carries repo-only shims. Those are deliberately
 * absent here: shipping one would fail to resolve on disk, and shipping a
 * canonical file under a shim name would split the mode bridge across two
 * module instances.
 */
function piTreeSources(): Array<[string, string]> {
  const piExt = path.join(EXT_DIR, 'pi');
  const pairs: Array<[string, string]> = [
    [path.join(piExt, 'shared', 'pi-types.ts'), path.join('shared', 'pi-types.ts')],
    [path.join(piExt, 'shared', 'pi-session-state.ts'), path.join('shared', 'pi-session-state.ts')],
    [SHARED_SESSION_STATE, path.join('shared', 'session-state.ts')],
    [SHARED_TYPES, path.join('shared', 'types.ts')],
    [SHARED_PLUGIN_SETTINGS, path.join('shared', 'plugin-settings.ts')],
    [LIB_UTILS, path.join('lib', 'utils.ts')],
    [SHARED_USAGE_LEDGER, path.join('shared', 'usage-ledger.ts')],
    [SHARED_PRICING, path.join('shared', 'pricing.ts')],
    [SHARED_CARBON, path.join('shared', 'carbon.ts')],
    [SHARED_OMP_PROMPT, path.join('shared', 'omp-prompt.ts')],
  ];
  for (const dir of PI_EXTENSION_DIRS) {
    pairs.push([path.join(piExt, dir, 'index.ts'), path.join(dir, 'index.ts')]);
  }
  return pairs;
}

export { piTreeSources };

/** Menu row that resolves to every detected host. Not a host id. */
const ALL_HOSTS = '__all__';

async function stepPonytail(pluginsDir: string, options: InstallOptions): Promise<void> {
  step(options, 'Ponytail — ensure bundled plugin');
  await fs.mkdir(pluginsDir, { recursive: true });
  const pkgPath = path.join(pluginsDir, 'package.json');
  const pkg = await readPluginsPackage(pkgPath);
  // Migration: ponytail was a separate plugin row. It is now a tersio
  // dependency, so drop the legacy row. Runs after stepSelfPlugin.
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
  // Fast path: bundled copy already present and no refresh asked — skip
  // network. Migration always reinstalls: the probe may hit the stale legacy
  // copy, and only npm install prunes it into the tersio-owned one.
  let ponytailExtExists = !options.reinstall && !options.dryRun && !migrated ? await probeExt() : false;
  if (ponytailExtExists) {
    debug('Bundled Ponytail pi-extension already installed; skipping network refresh');
  } else if (options.dryRun) {
    // Dry runs preview the wiring below without touching the network.
    if (verbose && !options.quiet) console.log('  [dry-run] would run: npm install --no-audit --no-fund (in plugins dir)');
    ponytailExtExists = true;
  } else {
    // Self-plugin npm install already materialized the bundled copy.
    // Reinstall here only when the probe still misses.
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

// Registers this package in ~/.omp/plugins so OMP lists it on the
// Settings → Plugins page (OMP enumerates plugins/package.json dependencies).
// Returns true when the package is verified in plugins/node_modules.
async function stepSelfPlugin(pluginsDir: string, options: InstallOptions): Promise<boolean> {
  step(options, 'Tersio — register plugin');
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

/**
 * Downloads the rtk binary and returns its path, or null when there is nothing
 * at that path. Wiring is the caller's job: which host needs an rtk-owned
 * extension is a per-host decision, and doing it here wrote `rtk.ts` into the
 * Oh My Pi extensions on every install, whichever host was picked.
 */
async function stepRtk(binDir: string, options: InstallOptions): Promise<string | null> {
  if (!options.quiet) console.log('  RTK — download binary');
  const binDest = path.join(binDir, RTK_BINARY_NAME);
  // Dry runs stay offline: no registry probe, just the plan line above.
  if (options.dryRun) {
    if (verbose && !options.quiet) console.log(`  [dry-run] would download rtk binary and install to ${binDest}`);
    return binDest;
  }
  try {
    const release = await withInteractiveSpinner('Finding latest RTK release', () => fetchJson<RtkRelease>(RTK_RELEASE_API));
    const triple = resolveRtkTriple();
    if (!triple) return null;
    const asset = findRtkAsset(release, triple);
    if (!asset) return null;
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
      if (!await verifyRtkArchive(archivePath, asset.name, checksumsText, options)) return null;

      const extractDir = path.join(tmpDir, 'extracted');
      if (!await extractRtkArchive(archivePath, extractDir)) return null;

      const found = await findFile(extractDir, RTK_BINARY_NAME);
      if (!found) {
        console.log(`  [fail] Could not find ${RTK_BINARY_NAME} in extracted archive`);
        return null;
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

  // A failed download must not skip wiring: a pre-existing binary at binDest is
  // exactly as good, so report whatever ended up there and let the host decide.
  return (await fileExists(binDest)) ? binDest : null;
}

// Copy repo source files into the target extension dir. First entry is
// required (skip label on missing); rest are optional companions.
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
  step(options, 'Shared files — sync session bridge');
  await copySources(extDir, [
    [SHARED_SESSION_STATE, path.join('shared', 'session-state.ts')],
    [SHARED_TYPES, path.join('shared', 'types.ts')],
    [LIB_UTILS, path.join('lib', 'utils.ts')],
    [SHARED_PLUGIN_SETTINGS, path.join('shared', 'plugin-settings.ts')],
    [SHARED_USAGE_LEDGER, path.join('shared', 'usage-ledger.ts')],
    [SHARED_PRICING, path.join('shared', 'pricing.ts')],
    [SHARED_CARBON, path.join('shared', 'carbon.ts')],
    [SHARED_OMP_PROMPT, path.join('shared', 'omp-prompt.ts')],
  ], 'shared/session-state.js', options);
}


async function stepRtkSession(extDir: string, options: WriteOptions): Promise<void> {
  step(options, 'RTK session — install session mode');
  await copySources(extDir, [[RTK_SESSION_INDEX, path.join('rtk-session', 'index.ts')]], 'rtk-session/index.ts', options);
}

// One rule fetch serves the install; dry runs stay offline
// and fall back to the bundled rule to preview its destination.
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
  step(options, 'Caveman — fetch rule and install session mode');
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
  step(options, 'Tersio commands — install /tersio root command');
  await copySources(extDir, [[TERSIO_COMMANDS_INDEX, path.join('tersio-commands', 'index.ts')]], 'tersio-commands/index.ts', options);
}

async function stepUpdater(extDir: string, options: WriteOptions): Promise<void> {
  await copySources(extDir, [[UPDATER_INDEX, path.join('ai-addons-updater', 'index.ts')]], 'ai-addons-updater/index.ts', options);
}

// How each live-extension host gets its rewrite, for the plan line that stands
// in for a file list. omp and pi are wired by rtk's own init via
// cli/rtk-wiring.ts; opencode gets a plugin from cli/opencode-wiring.ts.
const LIVE_WIRING_NOTE: Record<string, string> = {
  omp: 'no static files — rtk writes ~/.omp/agent/extensions/rtk.ts',
  opencode: 'no static files — tersio writes its own OpenCode plugin',
  pi: 'tersio writes ~/.pi/agent/extensions/tersio.ts, rtk writes ~/.pi/agent/extensions/rtk.ts',
};

/**
 * Prints what an install will do to the selected coding agents. The input is
 * `planInstall` output — the same planner `applyHosts` writes from — so every
 * line is a file the run really touches. Paths are `$HOME`-relative because a
 * preview has no reason to print the machine layout.
 */
/**
 * Artifacts a host gets that `planInstall` does not model: a live extension
 * tree, or a plugin module.
 *
 * The install preview used to stop at the static files, so a Pi run named four
 * artifacts and wrote twelve — the seven-directory tree and rtk's own wiring
 * were written by later steps the preview never mentioned. This is the same
 * list the uninstall preview names, so the two ends of the command agree.
 */
function hostLayerLines(hostId: string, home: string): PlanLine[] {
  if (hostId === 'pi') {
    const layer = piLayer(home);
    return [
      ...piExtensionTargets(layer).map((p): PlanLine => ({ label: 'extension tree', path: p, new: !existsSync(p) })),
      { label: 'rtk wiring', path: layer.rtkExtension, new: !existsSync(layer.rtkExtension) },
    ];
  }
  if (hostId === 'opencode') {
    const plugin = openCodePluginPath(home);
    return [{ label: 'plugin', path: plugin, new: !existsSync(plugin) }];
  }
  return [];
}

/**
 * Prints an internal step label, and only under `--verbose`.
 *
 * The default output is one line per agent, because "sync session bridge" and
 * "fetch rule and install session mode" describe how the installer works rather
 * than what the person running it now has. The labels are still the first thing
 * to reach for when a step misbehaves, so they move rather than disappear.
 */
function step(options: { quiet?: boolean }, label: string): void {
  if (verbose && !options.quiet) console.log(`  ${label}`);
}

/**
 * How to install each agent this run touched, both ways.
 *
 * `tersio install` wrote the files, so this is the alternative rather than the
 * next step. Every host in scope gets its `tersio install --agent <id>` line,
 * because that is the supported path for all of them, and the agent's own command
 * is added where one exists. Claude Code and Codex have no native command while
 * their plugin ports are on hold, so they appear with the tersio form alone —
 * listed, not silently missing.
 */
function printInstallGuide(ids: readonly string[], dryRun: boolean): void {
  if (dryRun) return;
  // Every host in scope gets its own `tersio install --agent` line, because that
  // is the supported path for all of them. The agent's own command is added
  // only where one exists, so Claude Code and Codex appear with the tersio form
  // and no native one, which is what "held" means in practice rather than
  // being left out of the list entirely.
  const rows = HOSTS.flatMap((host) => {
    if (!ids.includes(host.id)) return [];
    return [[host.label, host.id, host.nativeInstall?.command] as const];
  });
  if (rows.length === 0) return;
  const labelWidth = Math.max(...rows.map(([label]) => label.length));
  const tersioWidth = Math.max(...rows.map(([, id]) => `tersio install --agent ${id}`.length));
  console.log("\n  Or install it yourself:");
  for (const [label, id, native] of rows) {
    const tersio = `tersio install --agent ${id}`;
    // Pad only when a native command follows, or the line ends in spaces.
    const cell = native ? `${tersio.padEnd(tersioWidth)}   ${native}` : tersio;
    console.log(`    ${label.padEnd(labelWidth)}   ${cell}`);
  }
}

/**
 * Removes what a previous version wrote and the current one does not.
 *
 * A host that dropped a capability would otherwise keep its old files forever:
 * the planner no longer emits them, so install will not overwrite them and
 * uninstall will not see them either. This is the only thing that clears them,
 * so it runs on install as well as on removal.
 */
async function clearRetired(ids: readonly string[], home: string, options: InstallOptions): Promise<void> {
  for (const id of ids) {
    const host = byId(id);
    if (!host?.retired) continue;
    for (const removed of clearRetiredPaths(host, home, options)) {
      if (verbose && !options.quiet) step(options, `[rm] ${displayPath(removed, home)} (superseded)`);
    }
  }
}

/** What one agent ends up with, in a sentence a non-technical user can read. */
function readyLine(label: string, artifactCount: number): void {
  console.log(`  \u2705 ${label} \u2014 ${artifactCount} file${artifactCount === 1 ? '' : 's'} in place. Caveman, Ponytail and rtk are ready.`);
}

function printInstallPlan(plan: InstallPlan, home: string): void {
  const names = plan.selected.map((host) => host.label).join(', ');
  // One header over everything the run writes, layer directories included, so
  // the count a user reads is the count they get on disk.
  const rows = plan.hosts.map((preview) => ({
    preview,
    lines: [...hostLayerLines(preview.host.id, home), ...preview.lines],
  }));
  const fresh = rows.reduce((n, r) => n + r.lines.filter((l) => l.new).length, 0);
  const held = rows.reduce((n, r) => n + r.lines.filter((l) => !l.new).length, 0);
  console.log(`\n  Coding agents — ${names} (${fresh} new file(s)${held > 0 ? `, ${held} already in place` : ''})`);
  for (const row of rows) {
    const isFresh = row.lines.some((line) => line.new);
    const state = isFresh ? `${row.lines.filter((l) => l.new).length} new` : 'up to date';
    const note = row.lines.length === 0 ? (LIVE_WIRING_NOTE[row.preview.host.id] ?? 'no static files') : `${row.lines.length} artifact(s) · ${state}`;
    console.log(`    ${row.preview.host.label} — ${row.preview.wiring} — ${note}`);
    for (const group of groupByLabel(row.lines)) {
      const label = pluralArtifactLabel(group.label);
      const freshInGroup = group.lines.filter((l) => l.new).length;
      console.log(`      ${label} — ${group.lines.length}${freshInGroup > 0 ? `, ${freshInGroup} new` : ', up to date'}`);
      for (const line of group.lines) console.log(`        ${displayPath(line.path, home)}${line.new ? ' (new)' : ''}`);
    }
  }
}

/**
 * Prints what the Oh My Pi layer install will write.
 *
 * The extension list comes from `omp-layer.ts`, the same source the uninstall
 * preview and the uninstall run read, so "installed" and "removed" can never
 * name different directories.
 */
/** Prints the OMP layer install, from the list the uninstall also reads. */
function printOmpPlan(home: string): void {
  const layer = ompLayer(home, RTK_BINARY_NAME);
  const pending = layer.installed.filter((entry) => !existsSync(entry.path));
  console.log(`\n  Oh My Pi — ${layer.installed.length} extension directories, Ponytail, rtk`);
  if (pending.length === 0) {
    console.log('    already up to date');
    return;
  }
  for (const entry of pending) console.log(`    ${displayPath(entry.path, home)} — ${entry.label} (new)`);
  console.log(`    ${displayPath(layer.ponytailPackage, home)} — ponytail plugin package`);
  console.log(`    ${displayPath(layer.rtkBinary, home)} — rtk binary`);
  console.log(`    ${displayPath(layer.rtkExtension, home)} — rtk OMP wiring`);
}

/**
 * Asks which agents to set up, and writes the answer for later runs. Asked at
 * a terminal even when a choice is saved, so the selection stays changeable;
 * skipped for an explicit `--agent`, and for `--yes`, `--apply-update`, pipes,
 * and CI, which fall back to the saved set unioned with what is detected.
 */
/**
 * Which hosts this run acts on, or null when the picker was cancelled.
 *
 * Split from the application below so the prompt is the first thing the run
 * does. The rtk binary must be on disk before the extension-file hosts are
 * wired, which is why it is fetched before that — but there is no reason to
 * fetch it before the user has been asked anything, and doing so meant Escape at
 * the picker left a downloaded binary on the machine.
 */
async function resolveInstallSelection(options: InstallOptions): Promise<{ ids: string[]; interactive: boolean } | null> {
  const home = os.homedir();
  const stored = readSelection(home).hosts;
  const detected = detectHosts(home);
  const interactive = tty() && !options.yes && !applyUpdate && agentFlag.length === 0;
  // Seeded from the filesystem, not the saved selection: that file is a
  // preference that goes stale the moment anything is cleaned by hand, and it
  // never named Oh My Pi, whose layer is written by the layer steps rather than
  // the host emitters.
  const state = installedState(home);
  const installed = installedHostIds(state);

  let cancelled = false;
  const selection = await resolveAgentSelection({
    flag: agentFlag,
    stored,
    detected,
    // Single select, one host per run, for the same reason as uninstall: a
    // tick list made Enter submit whatever was highlighted, and a saved set of
    // five hosts made the answer a scroll rather than a decision. `All
    // detected` keeps multi-host installs one keystroke away.
    ask: interactive
      ? async () => {
        const rows = agentChoices(state);
        if (rows.length === 0) return [];
        const all = normalizeIds([...installed, ...stored, ...detected]);
        // The bulk row goes last and is never the default: a first-position
        // "All detected" turns the Enter reflex into "write files for every
        // agent on this machine".
        const options = all.length > 1
          ? [...rows, { value: ALL_HOSTS, label: `All detected (${all.length})`, hint: all.join(', ') }]
          : rows;
        const answer = await askInteractiveChoice('Install for which coding agent?', options, rows[0].value);
        if (answer.status !== 'selected') {
          cancelled = true;
          return [];
        }
        return answer.value === ALL_HOSTS ? all : [answer.value];
      }
      : undefined,
  });
  // Cancel is an abort, and the abort has to reach the run: returning here only
  // skipped the coding agents, and the OMP layer steps below carried on to
  // completion — so Escape looked like it did nothing while files kept landing.
  if (cancelled) {
    closeRL();
    return null;
  }

  // "Also found" is for a run nobody watched: a script or a --yes run takes
  // the union of the saved set and what is detected, and the host it silently
  // added is worth naming. In the menu the user is looking at every host with
  // its state, so the line only told them what the screen already said.
  if (!interactive && selection.addedByDetection.length > 0) {
    if (!options.quiet) {
      console.log(`  [note] also found: ${selection.addedByDetection.join(', ')}`);
    }
  }


  return { ids: selection.ids, interactive };
}

/**
 * Writes every artifact the chosen hosts need.
 *
 * Takes the rtk binary the run just fetched rather than probing PATH again:
 * the extension-file hosts are wired by rtk's own init, and that needs the
 * binary this run installed, not whichever one happened to be on PATH.
 */
async function applyAgentHosts(
  selection: { ids: string[]; interactive: boolean },
  options: InstallOptions,
  cavemanRule: string | null,
  rtkBin: string | null,
): Promise<void> {
  const { ids, interactive } = selection;
  const home = os.homedir();
  // omp's static files ride the same path as everyone else's whenever its layer
  // is in scope — an empty selection is the pre-multi-host default that puts
  // the layer in, so it puts the files in too. The extension directories and
  // rtk's own wiring stay with the layer block; only the files the generic
  // emitters own are planned and written here.
  const wantsOmp = ids.length === 0 || ids.includes('omp');
  const extra = wantsOmp ? [...new Set([...ids, 'omp'])] : ids.filter((id) => id !== 'omp');
  if (extra.length === 0) {
    if (interactive && !options.quiet) console.log('  no coding agents selected');
    if (!options.dryRun && ids.length > 0) writeSelection(home, ids);
    return;
  }

  const planned = await planInstall(extra, home);
  if (verbose && !options.quiet) printInstallPlan(planned, home);
  if (!options.quiet && !options.dryRun) {
    for (const preview of planned.hosts) readyLine(preview.host.label, planned.newFiles + planned.unchanged);
  }

  const { results, errors } = await applyHosts(extra, home, {
    dryRun: options.dryRun,
    quiet: options.quiet,
    onlyChanged: true,
  });
  await clearRetired(extra, home, options);

  // Only the hosts that changed are reported. The plan above already said which
  // were up to date, and repeating it here per host turned a no-op re-run into
  // twenty-plus lines asserting that nothing had happened.
  for (const r of results) {
    if (options.dryRun) {
      console.log(`  [dry-run] ${r.host.label}: would write ${r.planned.length} file(s)`);
      continue;
    }
    if (r.written.length === 0) continue;
    console.log(`  [write] ${r.host.label}: ${r.written.length} file(s)`);
  }
  for (const e of errors) console.log(`  [fail] ${e.host}: ${e.error}`);

  // Delegate the extension-file hosts to rtk, which owns that format.
  for (const id of extra) {
    const agent = rtkAgentFor(id);
    if (!agent) continue;
    if (!rtkBin) {
      if (!options.quiet) console.log(`  [skip] ${id}: rtk binary not found, so no ${agent} extension`);
      continue;
    }
    const wired = await wireRtkAgent(rtkBin, agent, { dryRun: options.dryRun, quiet: options.quiet });
    if (wired && !options.dryRun && !options.quiet) {
      console.log(`  [ok] ${id}: rtk ${agent} extension wired`);
    }
  }

  // OpenCode needs a plugin rather than a static hook, and rtk's own plugin is
  // in a format current OpenCode rejects, so tersio writes its own.
  if (extra.includes('opencode')) {
    await installOpenCodeRtk(home, OPENCODE_PLUGIN_SOURCE, {
      dryRun: options.dryRun,
      quiet: options.quiet,
    });
  }

  // Pi gets the same live extension layer OMP gets, not one flat module: one
  // directory per extension under <agent-dir>/extensions, each with an
  // index.ts Pi loads through jiti. The rule travels with its module so caveman
  // full mode reads the same text the installer fetched.
  if (extra.includes('pi')) {
    await installPiTersio(home, { sources: piTreeSources(), rules: [['caveman-session', cavemanRule]] }, {
      dryRun: options.dryRun,
      quiet: options.quiet,
    });
  }

  if (!options.dryRun) writeSelection(home, selection.ids);
}

async function stepCombo(extDir: string, options: InstallOptions): Promise<void> {
  step(options, 'Combo — install preset switch');
  await copySources(extDir, [[COMBO_TOGGLE_INDEX, path.join('combo-toggle', 'index.ts')]], 'combo-toggle/index.ts', options);
}


async function resolveProfile(forceReinstall = false, opts: { quiet?: boolean } = {}): Promise<Profile> {
  // Seed from the lock file so flag-less update/reinstall runs keep the
  // user's configured defaults instead of resetting them to off.
  const profile = await storedProfile();

  // Single interactive prompt: the Combo preset implies all three modes.
  // Numbered menu — no typing preset names.
  // Only for a real user at a terminal, only when no default flags were
  // given, and never for --apply-update runs.
  if (tty() && !profileFlagsGiven && !applyUpdate && (install || forceReinstall)) {
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

async function runInstall(overrides: { reinstall?: boolean } = {}): Promise<void> {
  // No `tersio reinstall` command any more — `tersio doctor` reports a broken
  // install and `tersio update` refreshes it. update's delegated payload still
  // takes the clean-then-install path, so the stale-directory sweep the command
  // used to own is not lost with it.
  const isReinstall = overrides.reinstall ?? applyUpdate;
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
    // The clean step clears the extension directories (replaceOmpExtensions)
    // but keeps the plugin package, which it is about to re-download. Deleting
    // that first meant a failed download left the machine with neither the old
    // copy nor the new one. `--agent omp` is passed too: the layer is now
    // driven by the selection rather than a prompt, so a flagless reinstall
    // would otherwise skip the directories it needs to replace.
    await runUninstall({
      yes: true,
      removePonytail: false,
      removeRtk: false,
      replaceOmpExtensions: true,
      ...(agentFlag.length > 0 ? {} : { agentFlagOverride: ['omp'] }),
    });
  }

  if (dryRun && !quiet) console.log('Preview — no changes will be written.\n');

  if (!quiet) {
    console.log(`Installing Tersio v${PACKAGE_VERSION}`);
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
    if (verbose && !quiet) console.log(`  omp ${v}`);
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
  // rtk's binary comes before the hosts. Every generated rewriter shells out to
  // `rtk rewrite`, and the extension-file hosts are wired by rtk's own init,
  // which needs the binary already on disk. It used to be fetched after the
  // hosts were wired, so a first-time install on a machine without rtk on PATH
  // reported "rtk binary not found" for the very host it had just fetched it for.
  // The agent prompt is the first question this run asks, and nothing is
  // fetched or written before it is answered. It also puts the file plan
  // directly under the menu, where the answer is still on screen. The rtk
  // download used to print above the prompt, and Escape at that prompt left
  // the binary behind.
  const selection = await resolveInstallSelection(options);
  if (selection === null) {
    console.log('\nNothing was installed.');
    closeRL();
    return;
  }

  // rtk's binary is next, because both consumers of it come after: the
  // extension-file hosts are wired by rtk's own init, and every generated
  // rewriter shells out to `rtk rewrite`. It used to be fetched *before* the
  // hosts were wired, so a first-time install with no rtk on PATH reported
  // "rtk binary not found" for the host it had just fetched it for.
  let rtkBin: string | null = null;
  await capture('rtk', async () => { rtkBin = await stepRtk(BUN_BIN_DIR, options); });

  await capture('agent hosts', async () => { await applyAgentHosts(selection, options, cavemanRule, rtkBin); });

  // The Oh My Pi layer installs for OMP, and for a run that named no host at
  // all: an empty selection is not a request for some other agent, it is the
  // pre-multi-host default of `tersio install` doing its job. What must never
  // happen is naming one host and getting another's artifacts too — choosing
  // Codex used to also write seven extension directories, the Ponytail package
  // and the rtk wiring on top of the four files that were asked for.
  const wantsOmpLayer = selection.ids.length === 0 || selection.ids.includes('omp');
  if (wantsOmpLayer) {
    // The layer's file list, under --verbose. The default gets one sentence.
    if (verbose && !quiet) printOmpPlan(os.homedir());
    if (!quiet && !options.dryRun) readyLine('Oh My Pi (OMP)', ompLayer(os.homedir(), RTK_BINARY_NAME).installed.length);

    await capture('shared', () => stepSharedSessionState(userExtDir, options));
    let selfPlugin = false;
    await capture('self-plugin', async () => { selfPlugin = await stepSelfPlugin(OMP_PLUGINS_DIR, options); });
    await capture('ponytail', () => stepPonytail(OMP_PLUGINS_DIR, options));
    await capture('rtk session', () => stepRtkSession(userExtDir, options));
    await capture('caveman', () => stepCaveman(path.join(OMP_PLUGINS_DIR, 'node_modules', '@krtclcdy', 'tersio', 'extensions'), cavemanRule, options));
    await capture('combo', () => stepCombo(userExtDir, options));
    await capture('commands', () => stepTersioCommands(userExtDir, options));
    await capture('updater', () => stepUpdater(userExtDir, options));
    // Binary alone never meters OMP sessions — wire rtk's tool_call extension so
    // bash commands rewrite to rtk and land in history.db.
    if (rtkBin) await wireRtkOmp(rtkBin, options);
    else console.log('  [skip] no rtk binary to wire — install rtk, then run: rtk init -g --agent omp');
    if (selfPlugin) await capture('settings', () => writePluginSettings(profile, options));
  }

  if (quiet) {
    if (failures.length > 0) console.log(`  add-ons: ${failures.length} failed (${failures.join(', ')}) — see [fail] lines above`);
  } else {
    printInstallGuide([...new Set([...selection.ids, ...(wantsOmpLayer ? ['omp'] : [])])], options.dryRun);
    // Not OMP-specific: the run may have installed nothing but coding agents.
    console.log(failures.length === 0 ? '\nDone — restart your agents to pick up the changes.' : `\nDone with ${failures.length} failure(s) — see [fail] lines above.`);
  }

  closeRL();
}
export { runInstall };
