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
import { installPiTersio } from './pi-wiring.ts';
import { piExtensionTargets, piLayer } from './pi-layer.ts';
import {
  CAVEMAN_REMOTE_RULE, RTK_RELEASE_API, RtkRelease, RtkReleaseAsset, fetchJson, findFile, httpsGet,
  httpsDownload, parseChecksum, readTextIfExists, rtkPlatformSpec, sha256File,
} from '../extensions/lib/utils.ts';
import { rewritePortImports } from './layer.ts';
import { storedProfile, writePluginSettings } from './profile.ts';
import {
  agentChoices, clearRetiredPaths, detectHosts, displayPath, hostLayer,
  installedHostIds, installedState, normalizeIds, readSelection, resolveAgentSelection, writeSelection,
} from './agents.ts';
import { ompLayer } from './omp-layer.ts';
import type { Profile } from './profile.ts';

// Paths to extension source files (relative to this script)
const EXT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'extensions');
const SHARED_SESSION_STATE = path.join(EXT_DIR, 'shared', 'session-state.ts');
const SHARED_OMP_PROMPT = path.join(EXT_DIR, 'shared', 'omp-prompt.ts');
const CAVEMAN_INDEX = path.join(EXT_DIR, 'omp', 'caveman-session', 'index.ts');
const CAVEMAN_RULE = path.join(EXT_DIR, 'omp', 'caveman-session', 'rule.md');
const RTK_SESSION_INDEX = path.join(EXT_DIR, 'omp', 'rtk-session', 'index.ts');
const UPDATER_INDEX = path.join(EXT_DIR, 'omp', 'ai-addons-updater', 'index.ts');
const COMBO_TOGGLE_INDEX = path.join(EXT_DIR, 'omp', 'combo-toggle', 'index.ts');
const TERSIO_COMMANDS_INDEX = path.join(EXT_DIR, 'omp', 'tersio-commands', 'index.ts');
const SHARED_TYPES = path.join(EXT_DIR, 'shared', 'types.ts');
const LIB_UTILS = path.join(EXT_DIR, 'lib', 'utils.ts');
const SHARED_PLUGIN_SETTINGS = path.join(EXT_DIR, 'shared', 'plugin-settings.ts');
const SHARED_USAGE_LEDGER = path.join(EXT_DIR, 'shared', 'usage-ledger.ts');
const SHARED_PRICING = path.join(EXT_DIR, 'shared', 'pricing.ts');
const SHARED_CARBON = path.join(EXT_DIR, 'shared', 'carbon.ts');

// The directory names come from cli/pi-layer.ts, which the uninstall removal also reads, so a plan and a removal cannot...
import { PI_EXTENSION_DIRS } from './pi-layer.ts';
// Pi's extension tree as `[repo path, path under the Pi ext dir]` pairs.
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

// Menu row that resolves to every detected host. Not a host id.
const ALL_HOSTS = '__all__';

async function stepPonytail(pluginsDir: string, options: InstallOptions): Promise<void> {
  step(options, 'Ponytail — ensure bundled plugin');
  await fs.mkdir(pluginsDir, { recursive: true });
  const pkgPath = path.join(pluginsDir, 'package.json');
  const pkg = await readPluginsPackage(pkgPath);
  // Migration: ponytail was a separate plugin row. It is now a tersio dependency, so drop the legacy row.
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
  let ponytailExtExists = !options.reinstall && !options.dryRun && !migrated ? await probeExt() : false;
  if (ponytailExtExists) {
    debug('Bundled Ponytail pi-extension already installed; skipping network refresh');
  } else if (options.dryRun) {
    // Dry runs preview the wiring below without touching the network.
    if (verbose && !options.quiet) console.log('  [dry-run] would run: npm install --no-audit --no-fund (in plugins dir)');
    ponytailExtExists = true;
  } else {
    // Self-plugin npm install already materialized the bundled copy. Reinstall here only when the probe still misses.
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

// Registers this package in ~/.omp/plugins so OMP lists it on the Settings → Plugins page (OMP enumerates...
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

// Downloads the rtk binary and returns its path, or null. Wiring is the caller's job.
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

  // A failed download must not skip wiring: a pre-existing binary at binDest is exactly as good, so report whatever ended...
  return (await fileExists(binDest)) ? binDest : null;
}

// Copy repo source files into the target extension dir. First entry is required (skip label on missing);
async function copySources(extDir: string, files: Array<[string, string]>, skipLabel: string, options: WriteOptions): Promise<boolean> {
  const src = await readTextIfExists(files[0][0]);
  if (!src) {
    if (!options.quiet && options.dryRun) console.log(`  [skip] ${skipLabel} not found in repo`);
    return false;
  }
  await writeIfChanged(path.join(extDir, files[0][1]), rewritePortImports(src), options);
  const rest = files.slice(1);
  const extras = await Promise.all(rest.map(([from]) => readTextIfExists(from)));
  for (let i = 0; i < rest.length; i++) {
    const extra = extras[i];
    if (extra) await writeIfChanged(path.join(extDir, rest[i][1]), rewritePortImports(extra), options);
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

// One rule fetch serves the install; dry runs stay offline and fall back to the bundled rule to preview its destination.
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

// Names the hosts this run writes. Printed on every run, dry runs included.
function printHostHeader(ids: readonly string[]): void {
  const names = ids.map((id) => byId(id)?.label ?? id).join(', ');
  console.log(`\n  Coding agents — ${names}`);
}

// The `--verbose` install plan: the extension tree plus the rtk module.
function printHostPlans(ids: readonly string[], home: string): void {
  for (const id of ids) {
    const host = byId(id);
    if (!host) continue;
    if (id === 'pi') {
      const layer = piLayer(home);
      const targets = [...piExtensionTargets(layer), layer.rtkExtension];
      console.log(`  ${host.label} — ${targets.length} extension/module path(s)`);
      for (const target of targets) {
        console.log(`    ${displayPath(target, home)}${existsSync(target) ? '' : ' (new)'}`);
      }
      continue;
    }
    console.log(`  ${host.label} — ${id === 'omp' ? 'no static files — rtk writes ~/.omp/agent/extensions/rtk.ts' : 'no static files'}`);
  }
}

// An internal step label, under `--verbose` only: the default is one line per host, and these describe how the installer...
function step(options: { quiet?: boolean }, label: string): void {
  if (verbose && !options.quiet) console.log(`  ${label}`);
}

// How to install each host this run touched, both ways.
function printInstallGuide(ids: readonly string[], dryRun: boolean): void {
  if (dryRun) return;
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

// Removes what an earlier version wrote and this one no longer does.
async function clearRetired(ids: readonly string[], home: string, options: InstallOptions): Promise<void> {
  for (const id of ids) {
    const host = byId(id);
    if (!host?.retired) continue;
    for (const removed of clearRetiredPaths(host, home, options)) {
      if (verbose && !options.quiet) step(options, `[rm] ${displayPath(removed, home)} (superseded)`);
    }
  }
}

// What one agent ends up with, in a sentence a non-technical user can read.
function readyLine(label: string, itemCount: number): void {
  console.log(`  \u2705 ${label} \u2014 ${itemCount} item${itemCount === 1 ? '' : 's'} in place. Caveman, Ponytail and rtk are ready.`);
}

// The OMP layer install, from the list the uninstall also reads.
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

// Which hosts this run acts on, or null when the picker was cancelled.
async function resolveInstallSelection(options: InstallOptions): Promise<{ ids: string[]; interactive: boolean } | null> {
  const home = os.homedir();
  const stored = readSelection(home).hosts;
  const detected = detectHosts(home);
  const interactive = tty() && !options.yes && !applyUpdate && agentFlag.length === 0;
  // Seeded from the filesystem, not the saved selection.
  const state = installedState(home);
  const installed = installedHostIds(state);

  let cancelled = false;
  const selection = await resolveAgentSelection({
    flag: agentFlag,
    stored,
    detected,
    // Single select, one host per run: a tick list here deletes.
    ask: interactive
      ? async () => {
        const rows = agentChoices(state);
        if (rows.length === 0) return [];
        const all = normalizeIds([...installed, ...stored, ...detected]);
        // The bulk row goes last, so Enter takes one host.
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
  // Cancel is an abort, and the abort has to reach the run.
  if (cancelled) {
    closeRL();
    return null;
  }

  // "Also found" is for a run nobody watched: a script or a --yes run takes the union of the saved set and what is...
  if (!interactive && selection.addedByDetection.length > 0) {
    if (!options.quiet) {
      console.log(`  [note] also found: ${selection.addedByDetection.join(', ')}`);
    }
  }

  return { ids: selection.ids, interactive };
}

// Takes the rtk binary this run fetched rather than probing PATH.
async function applyAgentHosts(
  selection: { ids: string[]; interactive: boolean },
  options: InstallOptions,
  cavemanRule: string | null,
  rtkBin: string | null,
): Promise<void> {
  const { ids, interactive } = selection;
  const home = os.homedir();
  // Oh My Pi rides the same path whenever its layer is in scope — an empty selection is the pre-multi-host default that...
  const wantsOmp = ids.length === 0 || ids.includes('omp');
  const targets = wantsOmp ? [...new Set([...ids, 'omp'])] : ids;
  if (targets.length === 0) {
    if (interactive && !options.quiet) console.log('  no coding agents selected');
    if (!options.dryRun && ids.length > 0) writeSelection(home, ids);
    return;
  }

  if (!options.quiet) printHostHeader(targets);
  if (verbose && !options.quiet) printHostPlans(targets, home);
  if (!options.quiet && !options.dryRun) {
    for (const id of targets) {
      const host = byId(id);
      if (host) readyLine(host.label, hostLayer(host, home).present.length);
    }
  }

  await clearRetired(targets, home, options);

  // Every host is an extension-file host, so rtk's own init writes the rewrite.
  for (const id of targets) {
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

  // Pi gets the same live extension layer OMP gets, not one flat module.
  if (targets.includes('pi')) {
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
  // Seed from the lock file so flag-less update/reinstall runs keep the user's configured defaults instead of resetting...
  const profile = await storedProfile();

  // Single interactive prompt: the Combo preset implies all three modes. Numbered menu — no typing preset names.
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

// Bare `tersio` at a terminal is a command picker, not an install run.
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
      // One bound flow: the version check already ran above, so report it and offer the refresh in the same breath — no second...
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
  // No `tersio reinstall` command any more — `tersio doctor` reports a broken install and `tersio update` refreshes it.
  const isReinstall = overrides.reinstall ?? applyUpdate;
  // Menu-driven installs must fall through: bare `tersio` re-enters here with command === null after the picker, and...
  if (command === null && tty() && !yes && !updatePromptDone) {
    await runCommandMenu();
    return;
  }
  // apply-update is the delegated payload of `tersio update`.
  const quiet = applyUpdate;
  if (!quiet) printWelcome();
  if (isReinstall) {
    // removeRtk stays false: reinstall is about to replace the binary, and deleting it first would leave nothing to wire if...
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

  // Remind humans a newer release exists; silent for scripts (no TTY) and for the apply-update payload, which is itself an...
  if (tty() && !applyUpdate && command !== 'uninstall') {
    const newer = await checkForUpdate();
    if (typeof newer === 'string') {
      // Bare `tersio` with an update pending: offer it now (Y/n) instead of burying the banner above the install prompts.
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

  // apply-update is `tersio update`'s payload run: treat it like reinstall so the add-ons refresh too — Ponytail package...
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
  // The agent prompt is the first question this run asks, and nothing is fetched or written before it is answered.
  const selection = await resolveInstallSelection(options);
  if (selection === null) {
    console.log('\nNothing was installed.');
    closeRL();
    return;
  }

  // rtk's binary comes before the hosts: rtk's own init wires them and needs it on disk, or a first-time install with no...
  let rtkBin: string | null = null;
  await capture('rtk', async () => { rtkBin = await stepRtk(BUN_BIN_DIR, options); });

  await capture('agent hosts', async () => { await applyAgentHosts(selection, options, cavemanRule, rtkBin); });

  // The Oh My Pi layer runs for OMP, and for a run that named no host at all — the pre-multi-host default.
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
    // Binary alone never meters OMP sessions — wire rtk's tool_call extension so bash commands rewrite to rtk and land in...
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
