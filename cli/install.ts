// cli/install.ts — install flow and all setup steps.
import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUN_BIN_DIR, BUN_BIN, COMBO_PRESET_MODES, HOME, IS_WINDOWS, NPM_BIN, OMP_AGENT_DIR, OMP_PLUGINS_DIR, OMP_BIN,
  PACKAGE_NAME, PACKAGE_VERSION, RTK_BINARY_NAME, args,
  allowUnverified, applyUpdate, cavemanDefaultFlag, comboDefaultFlag, command, dryRun,
  ponytailDefaultFlag, pstackDefaultFlag, profileFlagsGiven, rtkDefaultFlag, verbose, yes,
  dashboardExport, dashboardPort, currency,
  debug, ensurePonytailConfigValue,
  execP, parseJsonObject, readPluginsPackage,
  writeIfChanged,
} from './common.ts';
import type { InstallOptions, WriteOptions } from './common.ts';
import {
  askInteractiveChoice, askInteractiveConfirm, closeRL, execNetwork, tty, withInteractiveSpinner, withInteractiveTask, sayTagged } from './interactive.ts';
import { printWelcome } from './banner.ts';
import { checkForUpdate, runLatestUpdate } from './update.ts';
import { runUninstall } from './uninstall.ts';
import { runDoctor } from './doctor.ts';
import { runDashboard } from './dashboard.ts';
import { wireRtkOmp, wireRtkOpencode, wireRtkPi } from './rtk-wiring.ts';
import {
  RTK_RELEASE_API, fetchJson, findFile, httpsGet,
  findPackageRoot, httpsDownload, parseChecksum, piAgentDir, readTextIfExists, resolveRtkBinary, ruleBodyProblem, rtkPlatformSpec, sha256File,
} from '../extensions/shared/utils.ts';
import type { RtkRelease, RtkReleaseAsset } from '../extensions/shared/utils.ts';
import { patchState } from '../extensions/shared/state.ts';
import { CAVEMAN_PIN } from './upstream.ts';
import { formatCliStatus, storedProfile, storedProfileSync, writePluginSettings } from './profile.ts';
import { tersioSettingsFile } from '../extensions/shared/plugin-settings.ts';
import { PI_RTK_MANIFEST, PI_PONYTAIL_FILES, PONYTAIL_BUNDLE_FILES, PONYTAIL_DIR, PONYTAIL_PKG, filesUnder, rootFiles, sourcePath, syncPluginManifest, syncTreeFiles } from './manifest.ts';
import type { Profile } from './profile.ts';
import { detectHosts, hostHint, hostLabel, parseHostArg, piTersioSource } from './hosts.ts';
import type { HostEntry, HostId } from './hosts.ts';


async function stepPonytail(pluginsDir: string, options: InstallOptions): Promise<void> {
  // Ponytail rides inside this package now. An older install carried it as its own dependency,
  // which a host then listed as a second plugin, so drop that entry and its sibling copy.
  if (!options.quiet) console.log('  Ponytail — bundled in this plugin');
  const pkgPath = path.join(pluginsDir, 'package.json');
  const pkg = await readPluginsPackage(pkgPath);
  let migrated = false;
  if (PONYTAIL_PKG in pkg.dependencies) {
    delete pkg.dependencies[PONYTAIL_PKG];
    migrated = true;
  }
  const overrides: Record<string, string> =
    typeof pkg.overrides === 'object' && pkg.overrides !== null ? { ...pkg.overrides as Record<string, string> } : {};
  if (PONYTAIL_PKG in overrides) {
    delete overrides[PONYTAIL_PKG];
    if (Object.keys(overrides).length === 0) delete pkg.overrides;
    else pkg.overrides = overrides;
    migrated = true;
  }
  if (options.dryRun) {
    if (migrated && verbose && !options.quiet) sayTagged(`  [dry-run] would drop ${PONYTAIL_PKG} from ${pkgPath}`);
  } else if (migrated) {
    await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    if (!options.quiet) console.log(`  [migrate] dropped ${PONYTAIL_PKG} (now bundled in tersio)`);
  }

  // A host discovers every package in node_modules, so the old sibling would still be listed.
  const sibling = path.join(pluginsDir, 'node_modules', '@dietrichgebert', 'ponytail');
  if (options.dryRun) {
    if (existsSync(sibling) && verbose && !options.quiet) sayTagged(`  [dry-run] would remove ${sibling}`);
  } else if (existsSync(sibling)) {
    await fs.rm(sibling, { recursive: true, force: true });
    if (!options.quiet) console.log('  [migrate] removed the separate ponytail package');
  }

  await ensurePonytailConfigValue('defaultMode', 'off', options);
  // hideStatus=true keeps the upstream ponytail bar hidden; combo owns the bar.
  await ensurePonytailConfigValue('hideStatus', true, options);
}

// Registers the package so OMP lists it under Settings → Plugins.
async function stepSelfPlugin(pluginsDir: string, options: InstallOptions): Promise<boolean> {
  if (!options.quiet) console.log('  Tersio — register plugin');
  const pkgPath = path.join(pluginsDir, 'package.json');
  const pkg = await readPluginsPackage(pkgPath);
  // The exact version: a range lets npm install a release this CLI never wrote.
  pkg.dependencies[PACKAGE_NAME] = PACKAGE_VERSION;
  for (const legacy of ['oh-my-pi-token-saver', 'tersio-omp']) {
    if (legacy in pkg.dependencies) {
      delete pkg.dependencies[legacy];
      if (!options.dryRun && !options.quiet) sayTagged(`  [migrate] dropped legacy ${legacy} dependency`);
    }
  }

  if (options.dryRun) {
    if (verbose && !options.quiet) sayTagged(`  [dry-run] would add ${PACKAGE_NAME}@${PACKAGE_VERSION} to ${pkgPath}`);
    if (verbose && !options.quiet) sayTagged(`  [dry-run] would run: npm install --no-audit --no-fund (in ${pluginsDir})`);
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
    await execNetwork('Installing Tersio plugin dependencies', NPM_BIN, ['install', '--no-audit', '--no-fund'], { cwd: pluginsDir, timeout: 180000 });
  } catch {
    try {
      await execNetwork('Installing Tersio plugin dependencies', BUN_BIN, ['install'], { cwd: pluginsDir, timeout: 180000 });
    } catch (e) {
      sayTagged(`  [fail] Could not install ${PACKAGE_NAME} into plugins dir: ${(e as Error).message}`);
      sayTagged(`  [hint] Manual: cd ~/.omp/plugins && npm install ${PACKAGE_NAME}@^${PACKAGE_VERSION} --save --no-audit --no-fund`);
      return false;
    }
  }

  const installedPkg = path.join(pluginsDir, 'node_modules', PACKAGE_NAME, 'package.json');
  if ((await readTextIfExists(installedPkg)) === null) {
    sayTagged(`  [warn] ${PACKAGE_NAME} not found in plugins/node_modules after install`);
    return false;
  }
  debug('tersio listed in OMP plugins');
  return true;
}


function resolveRtkTriple(): string | null {
  const triple = rtkPlatformSpec()?.triple;
  if (triple) return triple;
  sayTagged(`  [fail] Unsupported platform: ${process.platform}/${process.arch}`);
  console.log('  [hint] Manual: https://github.com/rtk-ai/rtk/releases');
  return null;
}

function findRtkAsset(release: RtkRelease, triple: string): RtkReleaseAsset | null {
  const assets = release.assets || [];
  const asset = assets.find((a) => a.name === `rtk-${triple}.zip` || a.name === `rtk-${triple}.tar.gz`);
  if (asset) return asset;
  sayTagged(`  [fail] No rtk-${triple}.<zip|tar.gz> in release ${release.tag_name}`);
  sayTagged(`  [hint] Available: ${assets.map((a) => a.name).filter((n) => n.startsWith('rtk-')).join(', ')}`);
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

// Fails closed: an unverifiable RTK binary runs with the user's privileges. `--allow-unverified` opts out.
async function verifyRtkArchive(archivePath: string, assetName: string, checksumsText: string | null): Promise<boolean> {
  const unverified = (reason: string): boolean => {
    if (allowUnverified) {
      sayTagged(`  [warn] ${reason} — installing anyway (--allow-unverified)`);
      return true;
    }
    sayTagged(`  [fail] ${reason}`);
    sayTagged('  [hint] RTK not installed. Retry with --allow-unverified to accept an unverified binary.');
    return false;
  };
  if (!checksumsText) return unverified(`No checksums.txt published for ${assetName}`);
  const expected = parseChecksum(checksumsText, assetName);
  if (!expected) return unverified(`checksums.txt has no entry for ${assetName}`);
  const actual = await sha256File(archivePath);
  if (actual === expected) {
    debug(`Checksum verified for ${assetName}`);
    return true;
  }
  sayTagged(`  [fail] Checksum mismatch for ${assetName}`);
  sayTagged(`  [fail] Expected: ${expected}`);
  sayTagged(`  [fail] Got:      ${actual}`);
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
      sayTagged(`  [fail] tar could not extract ${path.basename(archivePath)}`);
      console.log('  [hint] Manual: https://github.com/rtk-ai/rtk/releases');
      return false;
    }
    return true;
  }
  sayTagged(`  [fail] Unknown archive format: ${archivePath}`);
  return false;
}

// A rule body found in a retired copy still resolves and loads twice, so drop the agent tree's extras.
const RETIRED_OMP_AGENT_DIRS = [
  'caveman-session',
  'rtk-session',
  'rtk-filter',
  'combo-toggle',
  'tersio-commands',
  'ai-addons-updater',
  'shared',
  'lib',
];

/** Drop the copies an older OMP install left in the agent tree, keeping rtk's `rtk.ts`. */
async function stepRetireAgentCopies(extDir: string, options: InstallOptions): Promise<void> {
  const stale = RETIRED_OMP_AGENT_DIRS.filter((dir) => existsSync(path.join(extDir, dir)));
  if (stale.length === 0) {
    if (!options.quiet) console.log('  Retired agent copies — none');
    return;
  }
  if (!options.quiet) console.log(`  Retired agent copies — remove ${stale.join(', ')}`);
  if (options.dryRun) {
    if (verbose) sayTagged(`  [dry-run] would remove ${stale.map((d) => path.join(extDir, d)).join(', ')}`);
    return;
  }
  await Promise.all(stale.map((dir) => fs.rm(path.join(extDir, dir), { recursive: true, force: true })));
}

// The binary is machine-wide; hosts without a hook only rebind. `tersio update` still refreshes it.
async function stepRtk(binDir: string, options: InstallOptions, target: 'omp' | 'pi' | 'opencode' = 'omp'): Promise<void> {
  const binDest = path.join(binDir, RTK_BINARY_NAME);
  const found = resolveRtkBinary();
  const hostName = target === 'omp' ? 'OMP' : target === 'opencode' ? 'OpenCode' : 'pi';
  const bind = async (binary: string): Promise<void> => {
    if (!(await fileExists(binary))) {
      console.log(`  [skip] no rtk binary to wire — install rtk, then run: rtk init -g ${target === 'opencode' ? '--opencode' : `--agent ${target}`}`);
      return;
    }
    if (target === 'opencode') await wireRtkOpencode(binary, options);
    else if (target === 'pi') await wireRtkPi(binary, options);
    else await wireRtkOmp(binary, options);
  };

  if (found && !applyUpdate) {
    // The path only under --verbose: a plain run, and a dry run, stay free of real user paths.
    if (!options.quiet) {
      const where = verbose ? ` (${found})` : '';
      console.log(`  RTK — already installed${where}, binding into ${hostName}`);
    }
    await bind(found);
    return;
  }

  if (!options.quiet) console.log(`  RTK — download binary and wire into ${hostName}`);
  // A failed download must not skip wiring: a pre-existing binary serves the host hook. Dry runs stay offline.
  if (options.dryRun) {
    if (verbose && !options.quiet) sayTagged(`  [dry-run] would download rtk binary and install to ${binDest}`);
    await bind(found ?? binDest);
    return;
  }
  try {
    const triple = resolveRtkTriple();
    if (!triple) return;
    // One task with streamed sub-steps; non-TTY keeps the plain lines each step already prints.
    await withInteractiveTask('Installing RTK', async (update) => {
      const release = await fetchJson<RtkRelease>(RTK_RELEASE_API);
      const asset = findRtkAsset(release, triple);
      if (!asset) {
        sayTagged(`  [fail] No rtk-${triple}.<zip|tar.gz> in release ${release.tag_name}`);
        return;
      }
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'omp-rtk-'));
      try {
        const archivePath = path.join(tmpDir, asset.name);
        update(`Downloading ${asset.name}`);
        const [checksumsText] = await Promise.all([
          downloadRtkChecksums(release),
          httpsDownload(asset.browser_download_url, archivePath),
        ]);
        update('Verifying checksum');
        if (!await verifyRtkArchive(archivePath, asset.name, checksumsText)) {
          sayTagged('  [hint] RTK install skipped for this run');
          return;
        }
        update('Extracting');
        const extractDir = path.join(tmpDir, 'extracted');
        if (!await extractRtkArchive(archivePath, extractDir)) {
          sayTagged(`  [fail] Could not extract ${asset.name}`);
          return;
        }
        update('Installing binary');
        const found = await findFile(extractDir, RTK_BINARY_NAME);
        if (!found) {
          sayTagged(`  [fail] Could not find ${RTK_BINARY_NAME} in extracted archive`);
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
          sayTagged(`  [hint] Verify manually: ${binDest} --version`);
        }
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => { });
      }
    });
  } catch (e) {
    sayTagged(`  [fail] RTK: ${(e as Error).message}`);
    console.log('  [hint] Manual: https://github.com/rtk-ai/rtk/releases');
  }

  // Wire rtk's tool_call extension: the binary alone never meters a session.
  await bind(binDest);
}

// First entry is required; the rest are optional companions.
async function copySources(extDir: string, files: Array<[string, string]>, skipLabel: string, options: WriteOptions): Promise<boolean> {
  const src = await readTextIfExists(files[0][0]);
  if (!src) {
    if (!options.quiet && options.dryRun) sayTagged(`  [skip] ${skipLabel} not found in repo`);
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
  await copySources(extDir, filesUnder('shared'), 'shared/session-state.js', options);
}


async function stepRtkSession(extDir: string, options: WriteOptions): Promise<void> {
  if (!options.quiet) console.log('  RTK session — install session mode');
  await copySources(extDir, filesUnder('rtk'), 'rtk/session.ts', options);
}

// pi's built-in grep and glob never reach the bash hook, so this one filters their output.
async function stepRtkFilter(extDir: string, options: WriteOptions): Promise<void> {
  if (!options.quiet) console.log('  RTK filter — install built-in tool output filtering');
  await copySources(extDir, filesUnder('rtk'), 'rtk/filter.ts', options);
}

// The install writes this build's bodies, which are the pinned ones. The updater pulls a newer
// published release, and the stamp says which release the installed body is.
const CAVEMAN_RULES: readonly string[] = [
  'rule.md',
  'rule-lite.md',
  'rule-megacave-lite.md',
  'rule-megacave-ultra.md',
  'rule-ultra.md',
  'rule-megacave.md',
];

async function stepCaveman(extDir: string, options: WriteOptions): Promise<void> {
  if (!options.quiet) console.log('  Caveman — install session mode and rule bodies');
  const cavemanDir = path.join(extDir, 'caveman');
  if (!options.dryRun) await fs.mkdir(cavemanDir, { recursive: true });

  for (const name of CAVEMAN_RULES) {
    const rule = await readTextIfExists(sourcePath(`caveman/${name}`));
    if (rule === null) {
      console.log(`  [skip] Caveman ${name} unavailable`);
      continue;
    }
    await writeIfChanged(path.join(cavemanDir, name), rule, options);
  }
  if (!options.dryRun) patchState({ cavemanUpstream: { tag: CAVEMAN_PIN, at: Date.now() } });

  await copySources(extDir, filesUnder('caveman').filter(([, to]) => to.endsWith('index.ts')), 'caveman/index.ts', options);

  // Renamed body: drop the stale copy an older install left behind.
  if (!options.dryRun) await fs.rm(path.join(cavemanDir, 'rule-wenyan.md'), { force: true });
}

async function stepTersioCommands(extDir: string, options: WriteOptions): Promise<void> {
  if (!options.quiet) console.log('  Tersio commands — install /tersio root command');
  await copySources(extDir, filesUnder('commands'), 'commands/index.ts', options);
}

async function stepUpdater(extDir: string, options: WriteOptions): Promise<void> {
  await copySources(extDir, filesUnder('updater'), 'updater/index.ts', options);
}

// omp loads no OpenCode entry, but its package ships one: the repair writes it, so the install does too.
async function stepPluginEntry(extDir: string, options: WriteOptions): Promise<void> {
  await copySources(extDir, rootFiles(), 'server.ts', options);
}

// pi records no first-token latency, so this stamps one into the row the dashboard reads.
async function stepTiming(extDir: string, options: WriteOptions): Promise<void> {
  await copySources(extDir, filesUnder('timing'), 'timing/index.ts', options);
}

async function stepCombo(extDir: string, options: InstallOptions): Promise<void> {
  if (!options.quiet) console.log('  Combo — install preset switch');
  await copySources(extDir, filesUnder('combo'), 'combo/index.ts', options);
}

// The body is a Tersio fork of an upstream skill, so the install copies it and never fetches it.
async function stepPstack(extDir: string, options: InstallOptions): Promise<void> {
  if (!options.quiet) console.log('  pstack — install the rigor mode');
  await copySources(extDir, filesUnder('pstack'), 'pstack/index.ts', options);
}

// The tree ships no node_modules, so the ruleset rides along as files. Both hosts need the same six.
async function stepPonytailBundle(treeDir: string, options: InstallOptions): Promise<void> {
  const root = PONYTAIL_DIR;
  if (!existsSync(root)) {
    if (!options.quiet) console.log('  [skip] Ponytail package not found next to the CLI — OpenCode keeps the built-in text');
    return;
  }
  if (!options.quiet) console.log('  Ponytail — bundle the full ruleset for OpenCode');
  for (const rel of PONYTAIL_BUNDLE_FILES) {
    const src = path.join(root, ...rel.split('/'));
    let text: string;
    try {
      text = await fs.readFile(src, 'utf8');
    } catch {
      sayTagged(`  [fail] Ponytail bundle file missing: ${rel}`);
      return;
    }
    await writeIfChanged(path.join(treeDir, 'ponytail-bundle', ...rel.split('/')), text, options);
  }
}

// OpenCode loads imported .ts plugins from the config plugins dir, so a plain tree copy + one config entry is enough.
async function stepOpencode(options: InstallOptions): Promise<void> {
  const dir = path.join(HOME, '.config', 'opencode', 'plugins', 'tersio');
  if (!options.quiet) console.log(`  OpenCode — write the plugin tree (${dir})`);
  // Retire the `-session`/`-toggle` leftovers first: a rule body found in one still resolves.
  await stepRetireAgentCopies(dir, options);
  await stepSharedSessionState(dir, options);
  await copySources(dir, filesUnder('rtk'), 'rtk/session.ts', options);
  await stepRtkFilter(dir, options);
  await stepTiming(dir, options);
  await copySources(dir, filesUnder('caveman'), 'caveman/index.ts', options);
  await stepCombo(dir, options);
  await stepPstack(dir, options);
  await copySources(dir, filesUnder('commands'), 'commands/index.ts', options);
  await stepUpdater(dir, options);
  await stepPonytailBundle(dir, options);
  // The loader resolves <pluginDir>/server.ts, and the entry is that file: copy it in place.
  await copySources(dir, rootFiles(), 'server.ts', options);

  const configPath = path.join(HOME, '.config', 'opencode', 'opencode.json');
  let config: Record<string, unknown> = {};
  try { config = JSON.parse((await readTextIfExists(configPath)) ?? '{}') as Record<string, unknown>; } catch { return; }
  const plugins = Array.isArray(config.plugins) ? [...config.plugins] : [];
  // The tree ships the rtk rewrite, so its own plugin entry is redundant.
  const kept = plugins.filter((p) => typeof p !== 'string' || !p.endsWith('/opencode/plugins/rtk.ts'));
  if (!kept.includes(dir)) kept.push(dir);
  config.plugins = kept;
  if (!options.dryRun) {
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.rm(path.join(HOME, '.config', 'opencode', 'plugins', 'rtk.ts'), { force: true }).catch(() => {});
  }
  // The user's own config, so keep the previous copy beside it.
  await writeIfChanged(configPath, `${JSON.stringify(config, null, 2)}\n`, { ...options, backup: true });
}


async function resolveProfile(opts: { quiet?: boolean } = {}): Promise<Profile> {
  // Seed from the stored defaults so flag-less runs keep them.
  const profile = await storedProfile();

  // The chosen preset owns all three modes.
  let comboChosen = comboDefaultFlag !== undefined;
  if (tty() && !profileFlagsGiven && !applyUpdate) {
    const choice = await askInteractiveChoice('Session-start defaults — Combo preset', [
      { value: 'off', label: 'off' },
      { value: 'lite', label: 'lite', hint: 'caveman=lite, rtk=on, ponytail=lite' },
      { value: 'balanced', label: 'balanced', hint: 'caveman=full, rtk=on, ponytail=full' },
      { value: 'max', label: 'max', hint: 'caveman=ultra, rtk=on, ponytail=ultra' },
    ], profile.comboDefault);
    if (choice.status === 'selected') {
      profile.comboDefault = choice.value;
      comboChosen = true;
    } else {
      closeRL();
      process.exit(130);
    }
  }

  // Explicit flags always win over the Combo preset.
  if (comboDefaultFlag !== undefined) profile.comboDefault = comboDefaultFlag;
  // A stored per-mode choice survives installs and updates; only a chosen preset rewrites it.
  if (comboChosen) {
    const preset = COMBO_PRESET_MODES[profile.comboDefault] ?? COMBO_PRESET_MODES.off;
    profile.cavemanDefault = preset.caveman;
    profile.rtkDefault = preset.rtk;
    profile.ponytailDefault = preset.ponytail;
    profile.pstackDefault = preset.pstack;
  }
  if (cavemanDefaultFlag !== undefined) profile.cavemanDefault = cavemanDefaultFlag;
  if (rtkDefaultFlag !== undefined) profile.rtkDefault = rtkDefaultFlag === 'on';
  if (ponytailDefaultFlag !== undefined) profile.ponytailDefault = ponytailDefaultFlag;
  if (pstackDefaultFlag !== undefined) profile.pstackDefault = pstackDefaultFlag;

  if ((!opts.quiet && verbose) || dryRun) console.log(`  Defaults: combo=${profile.comboDefault} (caveman=${profile.cavemanDefault} · rtk=${profile.rtkDefault ? 'on' : 'off'} · ponytail=${profile.ponytailDefault} · pstack=${profile.pstackDefault})`);
  return profile;
}

let updatePromptDone = false;

// Bare `tersio` at a terminal picks a command; scripts and flags install.
async function runCommandMenu(): Promise<void> {
  printWelcome();
  // Interactive launches always check; scripts use the cached verdict.
  const newer = await checkForUpdate(true);
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
  const choice = await askInteractiveChoice(`Tersio — what next?\n${formatCliStatus(storedProfileSync())}`, [
    { value: 'install', label: 'Install plugin', hint: 'user scope + combo defaults' },
    { value: 'update', label: 'Update', hint: 'CLI version check, then refresh add-ons (RTK, Caveman rule, Ponytail)' },
    { value: 'doctor', label: 'Doctor', hint: 'verify the installation' },
    { value: 'dashboard', label: 'Dashboard', hint: 'open the report in your browser' },
    { value: 'uninstall', label: 'Uninstall plugin', hint: 'remove tersio' },
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
      // Version check already ran above, so report it and offer the refresh here — no second "update" quiz.
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
    case 'dashboard':
      await runDashboard({ port: dashboardPort, open: true, exportFile: dashboardExport, currency });
      closeRL();
      break;
    case 'uninstall':
      await runUninstall();
      closeRL();
      break;
  }
}

// Which host this run targets. --host pins it; scripts and --yes keep the default of Oh My Pi.
let targetHost: HostId = 'omp';

// Hosts the menu advertises but cannot install yet; listed disabled so the roadmap stays visible.
const SOON_HOSTS = [
  { value: 'claude', label: 'Claude Code', hint: 'Coming soon' },
  { value: 'codex', label: 'Codex', hint: 'Coming soon' },
];

async function chooseHost(title: string, only?: HostId[]): Promise<HostId> {
  const hosts = detectHosts().filter((host) => !only || only.includes(host.id));
  const options: Array<{ value: string; label: string; hint?: string; disabled?: boolean }> = hosts.map((host) => ({
    value: host.id,
    label: hostLabel(host),
    hint: hostHint(host),
  }));
  // A scoped menu (uninstall --host) lists only real hosts.
  if (!only) options.push(...SOON_HOSTS.map((h) => ({ ...h, disabled: true })));
  const choice = await askInteractiveChoice(title, options, targetHost);
  if (choice.status !== 'selected') {
    closeRL();
    process.exit(130);
  }
  return choice.value as HostId;
}

function hostEntry(id: HostId): HostEntry {
  return detectHosts().find((host) => host.id === id) as HostEntry;
}

/** pi discovers a subdirectory only through an index file or a package.json with `pi.extensions`, so rtk/ needs one or both files stay dead. */
async function stepPiRtkManifest(extDir: string, options: WriteOptions): Promise<void> {
  await syncTreeFiles(extDir, [PI_RTK_MANIFEST], options);
}

/** The directory a host's install writes, for the plan line a reinstall prints. */
function resolvedHostPath(host: HostId): string {
  if (host === 'pi') return path.join(piAgentDir(), 'extensions');
  if (host === 'opencode') return path.join(HOME, '.config', 'opencode', 'plugins', 'tersio');
  return path.join(OMP_PLUGINS_DIR, 'node_modules', ...PACKAGE_NAME.split('/'), 'extensions');
}

// pi auto-discovers `<agent-dir>/extensions/**/index.ts`, so this route writes the same tree and registers nothing.
async function stepPiLayer(options: InstallOptions): Promise<void> {
  const agentDir = piAgentDir();
  const extDir = path.join(agentDir, 'extensions');
  const declared = piTersioSource(agentDir);
  if (declared) sayTagged(`  [note] pi also has a tersio package (${declared}) — remove one, or both copies load: pi remove npm:${PACKAGE_NAME}`);

  if (!options.quiet) console.log(`  Pi — write the extension tree (${extDir})`);
  await stepSharedSessionState(extDir, options);
  // OMP loads rtk/session.ts from its plugin manifest, so only the pi tree copies it.
  await copySources(extDir, filesUnder('rtk'), 'rtk/session.ts', options);
  await stepRtkFilter(extDir, options);
  await stepPiRtkManifest(extDir, options);
  await stepTiming(extDir, options);
  await stepCaveman(extDir, options);
  await stepCombo(extDir, options);
  await stepPstack(extDir, options);
  await stepTersioCommands(extDir, options);
  await stepUpdater(extDir, options);
  await stepPonytailForPi(agentDir, options);
}

// A local dir, not an npm spec: pi only version-checks npm entries, so this avoids the update nag.
const PI_PONYTAIL_PACKAGE = `${JSON.stringify({ name: 'ponytail', version: '0.0.0', private: true, pi: { extensions: ['./pi-extension/index.js'], skills: ['./skills'] } }, null, 2)}\n`;

async function stepPonytailForPi(agentDir: string, options: InstallOptions): Promise<void> {
  if (!options.quiet) console.log('  Ponytail — write the local pi package');
  const root = PONYTAIL_DIR;
  const dest = path.join(agentDir, 'ponytail');
  if (!root) {
    console.log('  [skip] Ponytail package not found next to the CLI');
    console.log('  [hint] The /ponytail command will not work; run: tersio update --host pi');
    return;
  }
  await writeIfChanged(path.join(dest, 'package.json'), PI_PONYTAIL_PACKAGE, options);
  for (const rel of PI_PONYTAIL_FILES) {
    let text: string;
    try {
      text = await fs.readFile(path.join(root, ...rel.split('/')), 'utf8');
    } catch {
      sayTagged(`  [fail] Ponytail file missing: ${rel}`);
      return;
    }
    await writeIfChanged(path.join(dest, ...rel.split('/')), text, options);
  }
  if (options.dryRun) return;
  // Only when pi still declares the npm spec: with nothing to remove, `pi remove` still warns and exits non-zero.
  const declared = await piDeclaredPackages(agentDir);
  if (declared.some(isNpmPonytailPackage)) {
    try {
      await execNetwork('Removing the pi npm copy of Ponytail', 'pi', ['remove', 'npm:@dietrichgebert/ponytail'], { timeout: 120000 });
    } catch (e) {
      sayTagged(`  [warn] pi remove ponytail: ${shortError(e)}`);
    }
  }
  await registerPiLocalPonytail(agentDir, dest, options);
}

// pi declares its package sources in settings.json; [] when the file is absent or unreadable.
async function piDeclaredPackages(agentDir: string): Promise<unknown[]> {
  try {
    const settings = JSON.parse(await fs.readFile(path.join(agentDir, 'settings.json'), 'utf8')) as Record<string, unknown>;
    return Array.isArray(settings.packages) ? settings.packages : [];
  } catch {
    return [];
  }
}

const isNpmPonytailPackage = (value: unknown): boolean =>
  typeof value === 'string' && value.startsWith('npm:@dietrichgebert/ponytail');

// pi lists package sources in settings; swap the npm spec for the local dir.
async function registerPiLocalPonytail(agentDir: string, dest: string, options: InstallOptions): Promise<void> {
  const settingsPath = path.join(agentDir, 'settings.json');
  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(await fs.readFile(settingsPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return;
  }
  const packages = (Array.isArray(settings.packages) ? settings.packages : []) as unknown[];
  const kept = packages.filter((p) => !isNpmPonytailPackage(p));
  if (!kept.includes(dest)) kept.push(dest);
  settings.packages = kept;
  await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  if (!options.quiet) sayTagged(`  [write] pi package source → ${dest}`);
}

// Name the preset this run actually chose, instead of a hardcoded level.
function comboHint(host: string, comboDefault: string): string {
  return comboDefault === 'off' ? `\nDone — restart ${host}.` : `\nDone — restart ${host}, then /combo ${comboDefault}.`;
}

async function runInstall(forcedHost?: HostId): Promise<void> {
  if (command === null && tty() && !yes && !updatePromptDone) {
    await runCommandMenu();
    return;
  }

  // Ask the host first: it decides the tree, the cleanup, and the defaults file.
  let pinned: HostId | undefined;
  try {
    pinned = parseHostArg(args);
  } catch (e) {
    console.error(`[fail] ${(e as Error).message}`);
    process.exit(1);
  }
  if (forcedHost) targetHost = forcedHost;
  else if (pinned) targetHost = pinned;
  else if (tty() && !yes && !dryRun && !applyUpdate && command !== 'uninstall') {
    targetHost = await chooseHost('Install Tersio into which agent?');
  }

  // apply-update stays silent: the parent printed the plan.
  const quiet = applyUpdate;
  if (!quiet) printWelcome();

  if (dryRun && !quiet) console.log('Preview — no changes will be written.\n');

  if (!quiet) {
    console.log(`Installing Tersio v${PACKAGE_VERSION}`);
  }

  // Nudge about a newer release; silent without a TTY.
  if (tty() && !applyUpdate && command !== 'uninstall') {
    const newer = await checkForUpdate();
    if (typeof newer === 'string') {
      // Update pending: offer it here; yes runs the full update and stops.
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

  // apply-update refreshes every add-on like a reinstall.
  const installOptions: InstallOptions = { dryRun, verbose, yes, reinstall: applyUpdate, quiet };

  // Point of no return: disk writes start here; pipes stay unattended.
  if (!yes && !dryRun && !applyUpdate && tty()) {
    const target = hostEntry(targetHost);
    const where = targetHost === 'pi'
      ? path.join(piAgentDir(), 'extensions')
      : targetHost === 'opencode'
        ? path.join(HOME, '.config', 'opencode', 'plugins', 'tersio')
        : path.join(OMP_AGENT_DIR, 'extensions');
    console.log(`\nWill install into ${target.label}:`);
    console.log(`  ${where}`);
    console.log('  caveman · rtk · ponytail session modes');
    console.log(`  session defaults → ${tersioSettingsFile()}`);
    const go = await askInteractiveConfirm(`Install Tersio into ${target.label}?`);
    if (go.status !== 'confirmed' || !go.value) {
      closeRL();
      console.log('\nAborted. Nothing was changed.');
      return;
    }
  }

  try {
    const v = (await execP(OMP_BIN, ['--version'])).stdout.trim();
    if (verbose && !quiet) console.log(`  omp ${v}`);
  } catch {
    if (targetHost === 'omp') console.log('  [fail] omp not found — ensure it\'s installed');
  }

  const failures: string[] = [];
  const capture = async (label: string, work: () => Promise<void>): Promise<void> => {
    try {
      await work();
    } catch (e) {
      failures.push(label);
      sayTagged(`  [fail] ${label}: ${shortError(e)}`);
    }
  };

  if (targetHost === 'opencode') {
    await capture('opencode tree', () => stepOpencode(installOptions));
    await capture('rtk', () => stepRtk(BUN_BIN_DIR, installOptions, 'opencode'));
    await capture('settings', () => writePluginSettings(profile, installOptions));
    if (failures.length > 0) console.log(`\nDone with ${failures.length} failure(s) — see [fail] lines above.`);
    else console.log(comboHint('OpenCode', profile.comboDefault));
    closeRL();
    return;
  }

  if (targetHost === 'pi') {
    await capture('pi tree', () => stepPiLayer(installOptions));
    await capture('rtk', () => stepRtk(BUN_BIN_DIR, installOptions, 'pi'));
    await capture('settings', () => writePluginSettings(profile, installOptions));
    if (failures.length > 0) console.log(`\nDone with ${failures.length} failure(s) — see [fail] lines above.`);
    else console.log(comboHint('pi', profile.comboDefault));
    closeRL();
    return;
  }

  let selfPlugin = false;
  await capture('self-plugin', async () => { selfPlugin = await stepSelfPlugin(OMP_PLUGINS_DIR, installOptions); });
  await capture('ponytail', () => stepPonytail(OMP_PLUGINS_DIR, installOptions));
  await capture('rtk', () => stepRtk(BUN_BIN_DIR, installOptions));

  // The plugin manifest owns every mode extension; only a failed registration falls back to the agent tree.
  const pluginExtDir = path.join(OMP_PLUGINS_DIR, 'node_modules', '@krtclcdy', 'tersio', 'extensions');
  const ownsTree = selfPlugin || dryRun;
  const extDir = ownsTree ? pluginExtDir : userExtDir;
  if (!quiet) console.log(`  Add-ons load from: ${ownsTree ? 'the OMP plugin manifest' : 'the agent tree (plugin registration failed)'}`);

  await capture('shared', () => stepSharedSessionState(extDir, installOptions));
  await capture('rtk session', () => stepRtkSession(extDir, installOptions));
  await capture('rtk filter', () => stepRtkFilter(extDir, installOptions));
  await capture('timing', () => stepTiming(extDir, installOptions));
  await capture('caveman', () => stepCaveman(extDir, installOptions));
  await capture('combo', () => stepCombo(extDir, installOptions));
  await capture('pstack', () => stepPstack(extDir, installOptions));
  await capture('commands', () => stepTersioCommands(extDir, installOptions));
  await capture('updater', () => stepUpdater(extDir, installOptions));
  // One package, one file set: the repair writes every tree file here, so the install does too.
  if (ownsTree) await capture('plugin entry', () => stepPluginEntry(extDir, installOptions));
  if (ownsTree) await capture('plugin manifest', () => syncPluginManifest(path.dirname(pluginExtDir), installOptions));
  if (ownsTree) await capture('retired agent copies', () => stepRetireAgentCopies(userExtDir, installOptions));
  if (selfPlugin) await capture('settings', () => writePluginSettings(profile, installOptions));

  if (quiet) {
    if (failures.length > 0) console.log(`  add-ons: ${failures.length} failed (${failures.join(', ')}) — see [fail] lines above`);
  } else {
    console.log(failures.length === 0 ? comboHint('OMP', profile.comboDefault) : `\nDone with ${failures.length} failure(s) — see [fail] lines above.`);
  }

  closeRL();
}
export { runInstall, verifyRtkArchive };
