// cli/install.ts — install flow and all setup steps.
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUN_BIN_DIR, COMBO_PRESET_MODES, HOME, IS_WINDOWS, OMP_AGENT_DIR, OMP_PLUGINS_DIR, OMP_BIN,
  PACKAGE_NAME, PACKAGE_VERSION, RTK_BINARY_NAME, args,
  allowUnverified, applyUpdate, cavemanDefaultFlag, comboDefaultFlag, command, dryRun,
  ponytailDefaultFlag, profileFlagsGiven, rtkDefaultFlag, verbose, yes,
  dashboardExport, dashboardPort,
  debug, ensurePonytailConfigValue,
  execP, parseJsonObject, readPluginsPackage,
  writeIfChanged,
  InstallOptions, WriteOptions,
} from './common.ts';
import {
  askInteractiveChoice, askInteractiveConfirm, closeRL, execNetwork, tty, withInteractiveSpinner, withInteractiveTask, sayTagged } from './interactive.ts';
import { printWelcome } from './banner.ts';
import { checkForUpdate, runLatestUpdate } from './update.ts';
import { runUninstall } from './uninstall.ts';
import { runDoctor } from './doctor.ts';
import { runReset } from './reset.ts';
import { runUsage } from './usage.ts';
import { runDashboard } from './dashboard.ts';
import { wireRtkOmp, wireRtkOpencode, wireRtkPi } from './rtk-wiring.ts';
import {
  CAVEMAN_REMOTE_ULTRA, CAVEMAN_REMOTE_WENYAN, RTK_RELEASE_API, RtkRelease, RtkReleaseAsset, fetchJson, findFile, findHoistedPackage, httpsGet,
  httpsDownload, parseChecksum, piAgentDir, readTextIfExists, resolveRtkBinary, rtkPlatformSpec, sha256File,
} from '../extensions/lib/utils.ts';
import { formatCliStatus, storedProfile, storedProfileSync, writePluginSettings } from './profile.ts';
import { runSettings } from './settings.ts';
import { tersioSettingsFile } from '../extensions/shared/plugin-settings.ts';
import { OPENCODE_SERVER_SHIM, filesUnder, sourcePath } from './manifest.ts';
import type { Profile } from './profile.ts';
import { detectHosts, hostHint, hostLabel, parseHostArg, piTersioSource } from './hosts.ts';
import type { HostEntry, HostId } from './hosts.ts';


async function stepPonytail(pluginsDir: string, options: InstallOptions): Promise<void> {
  if (!options.quiet) console.log('  Ponytail — ensure bundled plugin');
  await fs.mkdir(pluginsDir, { recursive: true });
  const pkgPath = path.join(pluginsDir, 'package.json');
  const pkg = await readPluginsPackage(pkgPath);
  // Drop the legacy Ponytail plugin row; it is a tersio dependency now.
  let migrated = false;
  if ('@dietrichgebert/ponytail' in pkg.dependencies) {
    delete pkg.dependencies['@dietrichgebert/ponytail'];
    migrated = true;
  }

  if (options.dryRun) {
    if (verbose && !options.quiet) sayTagged(`  [dry-run] would write ${pkgPath}`);
    if (migrated && verbose && !options.quiet) sayTagged(`  [dry-run] would drop the separate @dietrichgebert/ponytail dependency (bundled with tersio)`);
  } else if (migrated) {
    await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    if (!options.quiet) console.log('  [migrate] dropped separate @dietrichgebert/ponytail dependency (now bundled with tersio)');
  }

  const ponytailExtPath = path.join(pluginsDir, 'node_modules', '@dietrichgebert', 'ponytail', 'pi-extension', 'index.js');
  const probeExt = async (): Promise<boolean> => (await readTextIfExists(ponytailExtPath)) !== null;
  // Skip the network unless a refresh was asked; migration always reinstalls.
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
        sayTagged(`  [fail] Could not install bundled ponytail: ${(e as Error).message}`);
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

// Registers the package so OMP lists it under Settings → Plugins.
async function stepSelfPlugin(pluginsDir: string, options: InstallOptions): Promise<boolean> {
  if (!options.quiet) console.log('  Tersio — register plugin');
  const pkgPath = path.join(pluginsDir, 'package.json');
  const pkg = await readPluginsPackage(pkgPath);
  pkg.dependencies[PACKAGE_NAME] = `^${PACKAGE_VERSION}`;
  for (const legacy of ['oh-my-pi-token-saver', 'tersio-omp']) {
    if (legacy in pkg.dependencies) {
      delete pkg.dependencies[legacy];
      if (!options.dryRun && !options.quiet) sayTagged(`  [migrate] dropped legacy ${legacy} dependency`);
    }
  }

  if (options.dryRun) {
    if (verbose && !options.quiet) sayTagged(`  [dry-run] would add ${PACKAGE_NAME}@^${PACKAGE_VERSION} to ${pkgPath}`);
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
    await execNetwork('Installing Tersio plugin dependencies', 'npm', ['install', '--no-audit', '--no-fund'], { cwd: pluginsDir, timeout: 180000 });
  } catch {
    try {
      await execNetwork('Installing Tersio plugin dependencies', 'bun', ['install'], { cwd: pluginsDir, timeout: 180000 });
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

// Fails closed: a missing checksum is worse than a failed install, since an unverifiable RTK binary runs with the user's privileges. `--allow-unverified` opts out.
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
  // A failed download must not skip wiring: a pre-existing binary serves the host hook just as well. Dry runs stay offline.
  if (options.dryRun) {
    if (verbose && !options.quiet) sayTagged(`  [dry-run] would download rtk binary and install to ${binDest}`);
    await bind(found ?? binDest);
    return;
  }
  try {
    const triple = resolveRtkTriple();
    if (!triple) return;
    // One task with streamed sub-steps: release lookup, download, checksum, extract, install. Non-TTY keeps the plain lines each step already prints.
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

// Copy sources into the target extension dir. First entry is required; the rest are optional companions.
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
  const shared = [...filesUnder('shared'), ...filesUnder('lib')];
  await copySources(extDir, shared, 'shared/session-state.js', options);
}


async function stepRtkSession(extDir: string, options: WriteOptions): Promise<void> {
  if (!options.quiet) console.log('  RTK session — install session mode');
  await copySources(extDir, filesUnder('rtk-session'), 'rtk-session/index.ts', options);
}

// rule.md ships with the package; the other bodies track upstream skills.
const CAVEMAN_RULES: ReadonlyArray<[name: string, remote: string | null]> = [
  ['rule.md', null],
  ['rule-ultra.md', CAVEMAN_REMOTE_ULTRA],
  ['rule-wenyan.md', CAVEMAN_REMOTE_WENYAN],
];

async function stepCaveman(extDir: string, options: WriteOptions): Promise<void> {
  if (!options.quiet) console.log('  Caveman — install session mode and rule bodies');
  const cavemanDir = path.join(extDir, 'caveman-session');
  if (!options.dryRun) await fs.mkdir(cavemanDir, { recursive: true });

  for (const [name, remote] of CAVEMAN_RULES) {
    const bundled = await readTextIfExists(sourcePath(`caveman-session/${name}`));
    let rule = bundled;
    if (remote && !options.dryRun) {
      try {
        rule = await withInteractiveSpinner(`Fetching Caveman ${name}`, () => httpsGet(remote));
      } catch (e) {
        if (bundled === null) sayTagged(`  [warn] Could not fetch caveman ${name}: ${(e as Error).message}`);
        else debug(`Using bundled Caveman ${name}: ${(e as Error).message}`);
      }
    }
    if (rule === null) {
      if (remote) sayTagged(`  [hint] Manual: ${remote}`);
      console.log(`  [skip] Caveman ${name} unavailable`);
    } else {
      await writeIfChanged(path.join(cavemanDir, name), rule, options);
    }
  }

  await copySources(extDir, filesUnder('caveman-session').filter(([, to]) => to.endsWith('index.ts')), 'caveman-session/index.ts', options);
}

async function stepTersioCommands(extDir: string, options: WriteOptions): Promise<void> {
  if (!options.quiet) console.log('  Tersio commands — install /tersio root command');
  await copySources(extDir, filesUnder('tersio-commands'), 'tersio-commands/index.ts', options);
}

async function stepUpdater(extDir: string, options: WriteOptions): Promise<void> {
  await copySources(extDir, filesUnder('ai-addons-updater'), 'ai-addons-updater/index.ts', options);
}

async function stepCombo(extDir: string, options: InstallOptions): Promise<void> {
  if (!options.quiet) console.log('  Combo — install preset switch');
  await copySources(extDir, filesUnder('combo-toggle'), 'combo-toggle/index.ts', options);
}

// The tree ships no node_modules, so the full ruleset rides along as files.
const PONYTAIL_BUNDLE_FILES = [
  'hooks/ponytail-instructions.js',
  'hooks/ponytail-config.js',
  'skills/ponytail/SKILL.md',
] as const;

async function stepPonytailBundle(treeDir: string, options: InstallOptions): Promise<void> {
  const root = findHoistedPackage('@dietrichgebert/ponytail', path.dirname(fileURLToPath(import.meta.url)));
  if (!root) {
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
  await stepSharedSessionState(dir, options);
  await copySources(dir, filesUnder('rtk-session'), 'rtk-session/index.ts', options);
  await copySources(dir, filesUnder('caveman-session'), 'caveman-session/index.ts', options);
  await stepCombo(dir, options);
  await copySources(dir, filesUnder('tersio-commands'), 'tersio-commands/index.ts', options);
  await stepUpdater(dir, options);
  await copySources(dir, filesUnder('opencode'), 'opencode/server.ts', options);
  await stepPonytailBundle(dir, options);
  // The loader resolves <pluginDir>/server.ts, so mirror the entry at the tree root.
  await writeIfChanged(path.join(dir, 'server.ts'), OPENCODE_SERVER_SHIM, options);
  if (!options.dryRun) await fs.rm(path.join(dir, 'opencode', 'index.ts'), { force: true }).catch(() => {});

  const configPath = path.join(HOME, '.config', 'opencode', 'opencode.json');
  let config: Record<string, unknown> = {};
  try { config = JSON.parse((await readTextIfExists(configPath)) ?? '{}') as Record<string, unknown>; } catch { return; }
  const plugins = Array.isArray(config.plugins) ? [...config.plugins] : [];
  const withoutTersio = plugins.filter((p) => typeof p !== 'string' || !p.includes('/opencode/plugins/tersio'));
  if (!withoutTersio.includes(dir)) withoutTersio.push(dir);
  config.plugins = withoutTersio;
  if (!options.dryRun) await fs.mkdir(path.dirname(configPath), { recursive: true });
  await writeIfChanged(configPath, `${JSON.stringify(config, null, 2)}\n`, options);
}


async function resolveProfile(opts: { quiet?: boolean } = {}): Promise<Profile> {
  // Seed from the stored defaults so flag-less runs keep them.
  const profile = await storedProfile();

  // One numbered prompt for all three modes, for a real terminal user with no default flags. Never for --apply-update, and never for a script.
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

// Bare `tersio` at a terminal picks a command; scripts and flags install.
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
  const choice = await askInteractiveChoice(`Tersio — what next?\n${formatCliStatus(storedProfileSync())}`, [
    { value: 'install', label: 'Install add-ons', hint: 'user scope + combo defaults' },
    { value: 'update', label: 'Update', hint: 'CLI version check, then refresh add-ons (RTK, Caveman rule, Ponytail)' },
    { value: 'doctor', label: 'Doctor', hint: 'verify the installation' },
    { value: 'settings', label: 'Settings', hint: 'default combo mode, currency, diagnosis schedule' },
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
      // One bound flow: the version check already ran above, so report it and offer the refresh in the same breath — no second "update" quiz.
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
    case 'settings':
      await runSettings();
      closeRL();
      break;
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

// Which host this run targets. --host pins it; a TTY user picks; scripts, pipes, --yes, and --dry-run keep the pre-multi-host default of Oh My Pi.
let targetHost: HostId = 'omp';

// Hosts the menu advertises but cannot install yet. Listed disabled so the roadmap is visible without offering a target that does nothing.
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

// pi auto-discovers `<agent-dir>/extensions/**/index.ts`, so this route writes the same tree as OMP's and registers nothing.
async function stepPiLayer(options: InstallOptions): Promise<void> {
  const agentDir = piAgentDir();
  const extDir = path.join(agentDir, 'extensions');
  const declared = piTersioSource(agentDir);
  if (declared) sayTagged(`  [note] pi also has a tersio package (${declared}) — remove one, or both copies load: pi remove npm:${PACKAGE_NAME}`);

  if (!options.quiet) console.log(`  Pi — write the extension tree (${extDir})`);
  const cavemanRule = await fetchCavemanRule(options);
  await stepSharedSessionState(extDir, options);
  // OMP loads rtk-session from its plugin manifest, so only the pi tree copies it.
  await copySources(extDir, filesUnder('rtk-session'), 'rtk-session/index.ts', options);
  await stepCaveman(extDir, cavemanRule, options);
  await stepCombo(extDir, options);
  await stepTersioCommands(extDir, options);
  await stepUpdater(extDir, options);
  await stepPonytailForPi(agentDir, options);
}

// Ponytail for pi: install the package, or copy the bundled skills offline.
async function stepPonytailForPi(agentDir: string, options: InstallOptions): Promise<void> {
  if (!options.quiet) console.log('  Ponytail — ensure the pi package');
  if (!options.dryRun) {
    try {
      await execNetwork('Installing Ponytail for pi', 'pi', ['install', 'npm:@dietrichgebert/ponytail'], { timeout: 300000 });
      return;
    } catch (e) {
      sayTagged(`  [fail] pi install ponytail: ${shortError(e)}`);
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
    if (verbose && !options.quiet) sayTagged(`  [dry-run] would copy Ponytail skills to ${dest}`);
    return;
  }
  for (const entry of await fs.readdir(skills, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const to = path.join(dest, entry.name);
    await fs.rm(to, { recursive: true, force: true });
    await fs.cp(path.join(skills, entry.name), to, { recursive: true });
    if (!options.quiet) sayTagged(`  [write] skill ${entry.name} → ${to}`);
  }
}

async function runInstall(): Promise<void> {
  // Without this guard a picked command re-enters here with command === null and loops straight back into the picker.
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
  if (pinned) targetHost = pinned;
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
      // Update pending: offer it here instead of burying it above the install prompts. Yes runs the full update and stops.
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
    else console.log('\nDone — restart OpenCode, then /combo balanced.');
    closeRL();
    return;
  }

  if (targetHost === 'pi') {
    await capture('pi tree', () => stepPiLayer(installOptions));
    await capture('rtk', () => stepRtk(BUN_BIN_DIR, installOptions, 'pi'));
    await capture('settings', () => writePluginSettings(profile, installOptions));
    if (failures.length > 0) console.log(`\nDone with ${failures.length} failure(s) — see [fail] lines above.`);
    else console.log('\nDone — restart pi, then /combo medium.');
    closeRL();
    return;
  }

  await capture('shared', () => stepSharedSessionState(userExtDir, installOptions));
  let selfPlugin = false;
  await capture('self-plugin', async () => { selfPlugin = await stepSelfPlugin(OMP_PLUGINS_DIR, installOptions); });
  await capture('ponytail', () => stepPonytail(OMP_PLUGINS_DIR, installOptions));
  await capture('rtk', () => stepRtk(BUN_BIN_DIR, installOptions));
  await capture('rtk session', () => stepRtkSession(userExtDir, installOptions));
  await capture('caveman', () => stepCaveman(path.join(OMP_PLUGINS_DIR, 'node_modules', '@krtclcdy', 'tersio', 'extensions'), installOptions));
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
export { runInstall, verifyRtkArchive };
