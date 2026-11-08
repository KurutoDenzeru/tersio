// cli/uninstall.ts — remove managed extensions, plugins, and binaries.
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import {
  HOME, OMP_AGENT_DIR, OMP_PLUGINS_DIR, PACKAGE_NAME,
  args, dryRun, keepPonytail, removePonytail, removeRtk, yes,
  debug, execP, writeConfigLines,
} from './common.ts';
import { PONYTAIL_PKG } from './manifest.ts';
import { askInteractiveChoice, closeRL, confirmDestructive, tty, sayTagged } from './interactive.ts';
import { detectHosts, dshCliProfiles, dshDesktopProfilePresent, dshPackageDir, dshRunner, parseHostArg, removeDshMcpCommand } from './hosts.ts';
import type { HostEntry } from './hosts.ts';
import type { HostId } from '../extensions/shared/host-caps.ts';
import { hostCap } from '../extensions/shared/host-caps.ts';
import { CODEX_MARKETPLACE_NAME, CODEX_PLUGIN_ID, CODEX_PROMPT_MARKER, CODEX_PROMPT_NAMES, codexLocalMarketplaceRoot, codexPromptsDir, installedCodexPlugin } from '../extensions/shared/codex-plugin.ts';
import { piAgentDir, pigAgentDir, readTextIfExists, resolveHostBinary } from '../extensions/shared/utils.ts';
import { tersioSettingsFile } from '../extensions/shared/plugin-settings.ts';
import { removeTersioMcp } from '../extensions/shared/mcp-config.ts';
import { NATIVE_ROUTE_HOSTS, isNativeRouteHost, removeNativeRoute } from '../extensions/shared/headroom-routes.ts';
import { restoreOmpGateway } from '../extensions/shared/headroom-proxy.ts';
import { stopHeadroomRuntime } from '../extensions/shared/headroom-runtime.ts';

interface UninstallOptions {
  yes?: boolean;
  removePonytail?: boolean;
  removeRtk?: boolean;
  dryRun?: boolean;
  host?: HostId;
}

// The pi tree mirrors the OMP one. Ponytail and rtk stay: a package and a shared binary are not ours to delete.

/** Every extension dir an install writes; a removal that misses one strands an extension on a shared file it deleted. */
export const SHIPPED_TREE_DIRS = ['caveman', 'combo', 'commands', 'headroom', 'pstack', 'rtk', 'shared', 'timing'] as const;

/** A tree an older build wrote, or a foreign name that was never shipped here. */
const LEGACY_TREE_DIRS = [
  'updater',
  'caveman-session',
  'rtk-session',
  'rtk-filter',
  'ai-addons-updater',
  'combo-toggle',
  'tersio-commands',
  'lib',
  'aaa-combo-boot',
] as const;

export const PI_TREE_DIRS = [
  ...SHIPPED_TREE_DIRS,
  // pi loads server.ts from the tree root; OMP never writes it there.
  'server.ts',
  ...LEGACY_TREE_DIRS,
  // Foreign to the pi loader; never shipped here on purpose.
  'opencode',
];

// One package remove, for packages the installer adds.
async function piRemove(spec: string, shouldDryRun: boolean, bin = 'pi'): Promise<void> {
  if (shouldDryRun) {
    sayTagged(`  [dry-run] would run: ${bin} remove ${spec}`);
    return;
  }
  try {
    const { execFile } = await import('node:child_process');
    await new Promise<void>((resolve, reject) => {
      execFile(bin, ['remove', spec], { timeout: 120000 }, (err, _out, errOut) => {
        if (err) reject(new Error(String(errOut).trim() || err.message));
        else resolve();
      });
    });
    sayTagged(`  [ok] removed the ${bin} package ${spec}`);
  } catch (e) {
    sayTagged(`  [fail] ${bin} remove: ${(e as Error).message}`);
    sayTagged(`  [hint] Manual: ${bin} remove ${spec}`);
  }
}

// The installer writes a local package dir; drop it and its settings entry.
async function removeCopiedPonytailSkills(shouldDryRun: boolean, agentDir = piAgentDir()): Promise<void> {
  const settingsPath = path.join(agentDir, 'settings.json');
  try {
    const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8')) as { packages?: unknown[] };
    if (!Array.isArray(settings.packages)) return;
    const kept = settings.packages.filter((p) => p !== path.join(agentDir, 'ponytail'));
    if (kept.length === settings.packages.length) return;
    if (shouldDryRun) sayTagged(`  [dry-run] would drop the local ponytail entry from ${settingsPath}`);
    else await fs.writeFile(settingsPath, `${JSON.stringify({ ...settings, packages: kept }, null, 2)}\n`, 'utf8');
  } catch { /* no settings file, nothing to clean */ }
  await removeUninstallTarget(path.join(agentDir, 'ponytail'), shouldDryRun);
}

// pi / pig removal delegates to host remove; always list and confirm first.
async function removePiLayer(host: HostEntry, shouldDryRun: boolean, shouldRemovePonytail: boolean, shouldRemoveRtk: boolean, confirmed: boolean, targetHost: 'pi' | 'pig' = 'pi'): Promise<boolean> {
  const agentDir = targetHost === 'pig' ? pigAgentDir() : piAgentDir();
  const bin = targetHost;
  const targets = PI_TREE_DIRS.map((dir) => path.join(agentDir, 'extensions', dir));
  const rtkWiring = path.join(agentDir, 'extensions', 'rtk.ts');
  const piPonytail = path.join(agentDir, 'ponytail');

  // A partial tree is removable even when the host has no complete install: clearing leftovers is the point.
  const anyLeft = targets.some((target) => existsSync(target)) || existsSync(rtkWiring);
  if (!host.installed && !host.declared && !anyLeft) {
    sayTagged(`  [skip] ${host.label} — nothing installed (${host.installCmd})`);
    return false;
  }
  console.log('Will remove:');
  for (const t of targets) console.log(`  ${t}`);
  if (shouldRemovePonytail) {
    console.log(`  npm:${PONYTAIL_PKG} (${bin} package)`);
    console.log(`  ${piPonytail} (local Ponytail package)`);
  }
  if (shouldRemoveRtk) console.log(`  ${rtkWiring} (rtk wiring)`);
  console.log(`  ${tersioSettingsFile()} (session defaults)`);
  if (!confirmed && !(await confirmDestructive(`Remove Tersio from ${host.label}?`))) { closeRL(); return false; }
  if (host.declared) await piRemove(`npm:${PACKAGE_NAME}`, shouldDryRun, bin);
  if (shouldRemovePonytail) {
    await piRemove(`npm:${PONYTAIL_PKG}`, shouldDryRun, bin);
    await removeCopiedPonytailSkills(shouldDryRun, agentDir);
  }
  await Promise.all(targets.map((t) => removeUninstallTarget(t, shouldDryRun)));
  // rtk's wiring is a loose file, not a tree dir, so it survived --remove-rtk on pi while OMP removed its copy.
  // Only the wiring Tersio wrote; rtk's own binary belongs to the user's rtk install.
  if (shouldRemoveRtk) await removeUninstallTarget(rtkWiring, shouldDryRun, false);
  if (!shouldDryRun) removeTersioMcp(targetHost);
  await clearSessionDefaults(shouldDryRun);
  return true;
}

// ~/.tersio/settings.json holds nothing but Tersio's values, so it goes whole.
async function clearSessionDefaults(shouldDryRun: boolean): Promise<void> {
  await removeUninstallTarget(tersioSettingsFile(), shouldDryRun, false);
}

// Read-modify-write a JSON file; mutate returning false prints nothing.
async function updateJsonFile(
  filePath: string,
  mutate: (data: Record<string, unknown>) => boolean,
  dryRunNote: string,
  writeNote: string,
  shouldDryRun: boolean,
): Promise<void> {
  const raw = await readTextIfExists(filePath);
  if (!raw) return;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    debug(`Could not parse ${filePath}`);
    return;
  }
  if (!mutate(data)) return;
  if (shouldDryRun) {
    sayTagged(`  [dry-run] ${dryRunNote}`);
    return;
  }
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  sayTagged(`  [write] ${writeNote}`);
}

function dropKey(section: unknown, key: string): boolean {
  if (!section || typeof section !== 'object') return false;
  const record = section as Record<string, unknown>;
  if (!(key in record)) return false;
  delete record[key];
  return true;
}

async function removeUninstallTarget(target: string, shouldDryRun: boolean, recursive = true): Promise<void> {
  try {
    if (shouldDryRun) {
      sayTagged(`  [dry-run] would remove ${target}`);
      return;
    }
    if (recursive) await fs.rm(target, { recursive: true, force: true });
    else await fs.unlink(target);
    sayTagged(`  [rm] ${target}`);
  } catch {
    debug(`Could not remove ${target}`);
  }
}

/** Undo one agent's route before its tree leaves: Headroom's writer for two hosts, Tersio's for the rest. */
async function restoreHeadroomRoute(host: HostId, shouldDryRun: boolean): Promise<void> {
  if (!hostCap(host)?.headroom) return;
  if (isNativeRouteHost(host)) {
    if (shouldDryRun) return;
    const restored = removeNativeRoute(host);
    if (restored.ok) sayTagged(`  [rm] Headroom endpoint: ${restored.detail}`);
    return;
  }
  if (shouldDryRun) {
    sayTagged(`  [dry-run] would put ${host}'s endpoint back`);
    return;
  }
  // Tersio wrote every endpoint it routes, so Tersio puts it back; headroom is not asked.
  const restored = isNativeRouteHost(host) ? removeNativeRoute(host) : { ok: restoreOmpGateway(), detail: '' };
  if (restored.ok) sayTagged(`  [rm] Headroom endpoint: ${host}`);
}

/** Removes the user's own Headroom install with whichever package manager installed it. */
async function removeHeadroomBinary(shouldDryRun: boolean): Promise<void> {
  // Put every endpoint back before the proxy leaves: a removed binary behind a routed agent strands it.
  if (!shouldDryRun) {
    if (restoreOmpGateway()) sayTagged('  [rm] Headroom endpoint: omp');
    for (const target of NATIVE_ROUTE_HOSTS) {
      const restored = removeNativeRoute(target);
      if (restored.ok) sayTagged(`  [rm] Headroom endpoint: ${restored.detail}`);
    }
  }
  // A route is put back above, so the proxy has nothing left to serve: stop it before the binary leaves.
  if (!shouldDryRun) {
    const stopped = await stopHeadroomRuntime();
    if (stopped.ok) sayTagged(`  [rm] ${stopped.detail}`);
  }
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  dirs.push(path.join(HOME, '.local', 'bin'));
  const viaUv = dirs.some((dir) => existsSync(path.join(dir, 'uv')));
  const cmd = viaUv ? 'uv' : 'pip3';
  const cmdArgs = viaUv ? ['tool', 'uninstall', 'headroom-ai'] : ['uninstall', '-y', 'headroom-ai'];
  if (shouldDryRun) {
    sayTagged(`  [dry-run] would run: ${cmd} ${cmdArgs.join(' ')}`);
    return;
  }
  try {
    await execP(cmd, cmdArgs, { timeout: 300_000 });
    sayTagged('  [rm] Headroom binary uninstalled');
  } catch {
    sayTagged('  [warn] Headroom binary uninstall failed — remove it by hand if it stays');
  }
}

async function runUninstall(options: UninstallOptions = {}): Promise<boolean> {
  const shouldDryRun = options.dryRun ?? dryRun;
  const confirmed = (options.yes ?? yes) || shouldDryRun;
  // Ponytail ships with Tersio, so a full uninstall removes it.
  const shouldRemovePonytail = options.removePonytail ?? (removePonytail || !keepPonytail);
  let shouldRemoveRtk = options.removeRtk ?? removeRtk;

  console.log('\n=== Tersio Uninstall ===\n');

  // A TTY run asks for everything to remove in one list: the agents, then the vendor binaries.
  const allHosts = detectHosts();
  const installed = allHosts.filter((entry) => entry.installed);
  let hosts: HostId[];
  let shouldRemoveHeadroomBinary = false;
  if (options.host) {
    hosts = [options.host];
  } else if (tty() && !confirmed) {
    // One plain select: Enter picks the single thing to remove, no Space and no Done row.
    const targets = [
      ...(installed.length > 0 ? [{ value: 'agents', label: 'AI agents', hint: `${installed.map((entry) => entry.label).join(', ')} — pick one next` }] : []),
      ...(shouldRemoveRtk ? [] : [{ value: 'rtk', label: 'RTK binary', hint: 'the rtk CLI the hooks call' }]),
      { value: 'headroom', label: 'Headroom binary', hint: 'uninstalls headroom-ai through uv or pip' },
    ];
    const pick = await askInteractiveChoice('What should Tersio remove?', targets, targets[0].value);
    if (pick.status !== 'selected') {
      closeRL();
      return false;
    }
    hosts = [];
    if (pick.value === 'rtk') shouldRemoveRtk = true;
    if (pick.value === 'headroom') shouldRemoveHeadroomBinary = true;
    if (pick.value === 'agents' && installed.length > 0) {
      const agentPick = await askInteractiveChoice('Which agent?', installed.map((entry) => ({
        value: entry.id,
        label: entry.label,
        hint: entry.version ? `tersio ${entry.version}` : 'tersio installed',
      })), installed[0].id);
      if (agentPick.status === 'selected') hosts = [agentPick.value as HostId];
    }
    if (hosts.length === 0 && !shouldRemoveRtk && !shouldRemoveHeadroomBinary) {
      console.log('Nothing selected.');
      closeRL();
      return false;
    }
  } else {
    try {
      hosts = [parseHostArg(args) ?? 'omp'];
    } catch (e) {
      console.error(`[fail] ${(e as Error).message}`);
      process.exit(1);
    }
  }
  // Binaries picked without an agent get their own confirmation and their own removal; with a host the host's dialog already lists them.
  if (shouldRemoveHeadroomBinary) {
    if (!confirmed && !(await confirmDestructive('Remove the Headroom binary?'))) {
      closeRL();
      return false;
    }
    await removeHeadroomBinary(shouldDryRun);
  }
  if (hosts.length === 0) {
    closeRL();
    return true;
  }
  const results: boolean[] = [];
  for (const host of hosts) {
    const selected = allHosts.find((h) => h.id === host) as HostEntry;
  await restoreHeadroomRoute(host, shouldDryRun);
  if (host === 'pi') {
    const removed = await removePiLayer(selected, shouldDryRun, shouldRemovePonytail, shouldRemoveRtk, confirmed, 'pi');
    if (removed) console.log('\nDone. Restart pi, then /combo lite.');
    results.push(removed);
    continue;
  }
  if (host === 'pig') {
    const removed = await removePiLayer(selected, shouldDryRun, shouldRemovePonytail, shouldRemoveRtk, confirmed, 'pig');
    if (removed) console.log('\nDone. Restart pig, then /combo lite.');
    results.push(removed);
    continue;
  }
  if (host === 'opencode') {
    const dir = path.join(HOME, '.config', 'opencode', 'plugins', 'tersio');
    const configPath = path.join(HOME, '.config', 'opencode', 'opencode.json');
    if (!selected.installed && !selected.declared) {
      sayTagged(`  [skip] ${selected.label} — nothing installed (${selected.installCmd})`);
      results.push(false);
      continue;
    }
    console.log('Will remove:');
    console.log(`  ${dir}`);
    console.log(`  ${path.join(HOME, '.config', 'opencode', 'plugins', 'rtk.ts')} (rtk auto-wrap; reinstall with: rtk init -g --opencode)`);
    console.log(`  the tersio entry in ${configPath}`);
    if (!confirmed && !(await confirmDestructive('Remove these Tersio files?'))) { results.push(false); continue; }
    await removeUninstallTarget(dir, shouldDryRun);
    await removeUninstallTarget(path.join(HOME, '.config', 'opencode', 'plugins', 'rtk.ts'), shouldDryRun, false);
    if (!shouldDryRun) {
      try {
        const raw = await readTextIfExists(configPath);
        const config = raw ? JSON.parse(raw) as { plugins?: unknown[] } : {};
        if (Array.isArray(config.plugins)) {
          // The installer writes the directory without a trailing slash, so compare the resolved paths.
          const ours = new Set([path.resolve(dir), path.resolve(path.join(HOME, '.config', 'opencode', 'plugins', 'rtk.ts'))]);
          config.plugins = config.plugins.filter((p) => typeof p !== 'string' || !ours.has(path.resolve(p)));
          await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
        }
      } catch { /* config missing or not JSON; nothing to scrub */ }
      removeTersioMcp('opencode');
    }
    console.log('\nDone. Restart OpenCode to drop the plugin.');
    results.push(true);
    continue;
  }
  if (host === 'dsh') {
    const runner = dshRunner();
    const profiles = dshCliProfiles();
    if (!selected.installed && !selected.declared) {
      sayTagged(`  [skip] ${selected.label} — nothing installed (${selected.installCmd})`);
      results.push(false);
      continue;
    }
    console.log('Will remove:');
    console.log(`  the tersio bundle from every dsh CLI profile (${dshPackageDir()} is the web profile's copy)`);
    if (dshDesktopProfilePresent()) console.log('  the desktop app keeps its own profile — remove the plugin there: Plugins → the Tersio row → Remove');
    if (!confirmed && !(await confirmDestructive('Remove the tersio bundle from DeepSeek Harness?'))) { results.push(false); continue; }
    if (dryRun) {
      sayTagged(`  [dry-run] would run: ${runner.join(' ')} plugin --profile <${profiles.join(',') || 'none'}> remove @krtclcdy/tersio`);
      results.push(true);
      continue;
    }
    for (const profile of profiles) {
      const remove = [...runner, 'plugin', '--profile', profile, 'remove', '@krtclcdy/tersio'];
      await execP(remove[0], remove.slice(1), { timeout: 300_000 });
      // The MCP override targets an id only the bundle supplies, so it goes with it.
      if (removeDshMcpCommand(profile)) sayTagged(`  [rm] the pinned MCP command from the ${profile} profile`);
      sayTagged(`  [rm] the tersio bundle from the ${profile} profile`);
    }
    console.log('\nDone. Restart dsh web (or the desktop app) to drop the bundle.');
    results.push(true);
    continue;
  }
  if (host === 'codex') {
    const state = installedCodexPlugin();
    const managedPromptLeft = CODEX_PROMPT_NAMES.some((name) => existsSync(path.join(codexPromptsDir(), `${name}.md`)));
    if (!selected.installed && !selected.declared && !existsSync(codexLocalMarketplaceRoot()) && !managedPromptLeft) {
      sayTagged(`  [skip] ${selected.label} — nothing installed (${selected.installCmd})`);
      results.push(false);
      continue;
    }
    console.log('Will remove:');
    console.log(`  ${CODEX_PLUGIN_ID} (Codex plugin)${state.dir ? `\n  ${state.dir}` : ''}`);
    console.log(`  the ${CODEX_MARKETPLACE_NAME} marketplace source`);
    console.log('  Tersio plugin data under Codex is kept');
    if (!confirmed && !(await confirmDestructive('Remove the Tersio Codex plugin?'))) { results.push(false); continue; }
    const codex = resolveHostBinary('codex');
    if (shouldDryRun) {
      sayTagged(`  [dry-run] would run: codex plugin remove ${CODEX_PLUGIN_ID}`);
      sayTagged(`  [dry-run] would run: codex plugin marketplace remove ${CODEX_MARKETPLACE_NAME}`);
    } else if (!codex) {
      sayTagged('  [warn] codex not found — remove Tersio from Codex Settings → Plugins');
    } else {
      await execP(codex, ['plugin', 'remove', CODEX_PLUGIN_ID, '--json'], { timeout: 120_000, cwd: HOME }).catch((e: unknown) => {
        sayTagged(`  [warn] codex plugin remove: ${(e as Error).message}`);
      });
      await execP(codex, ['plugin', 'marketplace', 'remove', CODEX_MARKETPLACE_NAME, '--json'], { timeout: 120_000, cwd: HOME }).catch((e: unknown) => {
        sayTagged(`  [warn] codex marketplace remove: ${(e as Error).message}`);
      });
    }
    await removeUninstallTarget(codexLocalMarketplaceRoot(), shouldDryRun);
    for (const name of CODEX_PROMPT_NAMES) {
      const file = path.join(codexPromptsDir(), `${name}.md`);
      const text = await readTextIfExists(file);
      if (text?.includes(CODEX_PROMPT_MARKER)) await removeUninstallTarget(file, shouldDryRun, false);
    }
    await clearSessionDefaults(shouldDryRun);
    console.log('\nDone. Restart Codex to unload the plugin.');
    results.push(true);
    continue;
  }
  if (!selected.installed) sayTagged(`  [note] ${selected.label} has no tersio install; removing what is left behind.`);

  const extDir = path.join(OMP_AGENT_DIR, 'extensions');
  const configPath = path.join(OMP_AGENT_DIR, 'config.yml');
  const pluginsDir = OMP_PLUGINS_DIR;
  const ponytailPkgDir = path.join(pluginsDir, 'node_modules', '@dietrichgebert', 'ponytail');

  const targets = [
    // What an install writes now: the same shipped set the pi removal covers.
    ...SHIPPED_TREE_DIRS,
    ...LEGACY_TREE_DIRS,
    // Foreign to the OMP loader; never shipped here on purpose.
    'opencode',
  ].map((dir) => path.join(extDir, dir));

  console.log('Will remove:');
  for (const t of targets) {
    console.log(`  ${t}`);
  }

  if (shouldRemovePonytail) {
    console.log(`  ${ponytailPkgDir} (ponytail plugin package)`);
  }

  if (shouldRemoveRtk) console.log(`  ${path.join(extDir, 'rtk.ts')} (rtk OMP wiring)`);

  if (!confirmed && !(await confirmDestructive('Remove the listed Tersio files?'))) { results.push(false); continue; }

  // Remove extension directories (independent paths, so concurrently).
  await Promise.all(targets.map((t) => removeUninstallTarget(t, shouldDryRun)));
  if (!shouldDryRun && removeTersioMcp('omp')) sayTagged('  [rm] Removed the Tersio MCP entry from OMP');

  const configRaw = await readTextIfExists(configPath);
  if (configRaw) {
    let lines = configRaw.split('\n');
    const before = lines.length;
    lines = lines.filter((l) => {
      if (l.includes('combo-toggle') || l.includes('mode-reinforcement')) return false;
      if (shouldRemovePonytail && l.includes('ponytail') && l.includes('pi-extension')) return false;
      // Our rtk wiring, absolute or relative. Leaving it listed would keep OMP loading a hook for an uninstalled package.
      const entry = l.trim().replace(/^-\s*/, '').replace(/^['"]|['"]$/g, '');
      if (entry.endsWith(`extensions${path.sep}rtk.ts`) || entry.endsWith('extensions/rtk.ts')) return false;
      return true;
    });
    if (lines.length !== before) {
      if (shouldDryRun) sayTagged(`  [dry-run] would remove ${before - lines.length} config.yml entries`);
      else await writeConfigLines(configPath, lines, `  [write] Updated config.yml (removed ${before - lines.length} entries)`);
    }
  }

  // OMP finds plugin skills only through user skill roots; the install added this one.
  await updateJsonFile(path.join(OMP_AGENT_DIR, 'settings.json'), (data) => {
    const skills = (data.skills ?? {}) as Record<string, unknown>;
    const dirs = skills.customDirectories;
    if (!Array.isArray(dirs)) return false;
    const kept = dirs.filter((dir) => typeof dir !== 'string' || !dir.replace(/\\/g, '/').endsWith('tersio/skills'));
    if (kept.length === dirs.length) return false;
    data.skills = { ...skills, customDirectories: kept };
    return true;
  }, 'would remove the Tersio skills directory from OMP settings', 'Removed the Tersio skills directory from OMP settings', shouldDryRun);

  // Cleared last: writeConfigLines above would just make a fresh one.
  const cavemanDir = path.join(pluginsDir, 'node_modules', PACKAGE_NAME, 'extensions', 'caveman-session');
  for (const backup of [`${configPath}.bak`, path.join(cavemanDir, 'rule.md.bak'), path.join(cavemanDir, 'rule-lite.md.bak'), path.join(cavemanDir, 'rule-megacave-lite.md.bak'), path.join(cavemanDir, 'rule-megacave-ultra.md.bak'), path.join(cavemanDir, 'rule-ultra.md.bak'), path.join(cavemanDir, 'rule-megacave.md.bak')]) {
    await removeUninstallTarget(backup, shouldDryRun, false);
  }

  // Remove the bundled Ponytail copy; its config.yml entry is already filtered.
  if (shouldRemovePonytail) {
    const pluginsPkgPath = path.join(pluginsDir, 'package.json');
    await updateJsonFile(pluginsPkgPath,
      (data) => dropKey(data.dependencies, '@dietrichgebert/ponytail'),
      `would remove @dietrichgebert/ponytail from ${pluginsPkgPath}`,
      'Removed @dietrichgebert/ponytail from plugins/package.json', shouldDryRun);
    try {
      if (shouldDryRun) sayTagged(`  [dry-run] would remove ${ponytailPkgDir}`);
      else {
        await fs.rm(ponytailPkgDir, { recursive: true, force: true });
        sayTagged(`  [rm] ${ponytailPkgDir}`);
        await fs.rm(path.dirname(ponytailPkgDir));
        sayTagged(`  [rm] ${path.dirname(ponytailPkgDir)} (empty scope)`);
      }
    } catch {
      debug('Could not remove ponytail package dir (scope may hold other packages)');
    }
    const lockPath = path.join(pluginsDir, 'omp-plugins.lock.json');
    await updateJsonFile(lockPath,
      (data) => dropKey(data.plugins, '@dietrichgebert/ponytail'),
      `would remove @dietrichgebert/ponytail from ${lockPath}`,
      `Removed @dietrichgebert/ponytail from ${lockPath}`, shouldDryRun);
  }

  // Remove our plugin registration from ~/.omp/plugins
  const pluginsPkgPath = path.join(pluginsDir, 'package.json');
  await updateJsonFile(pluginsPkgPath,
    (data) => dropKey(data.dependencies, PACKAGE_NAME),
    `would remove ${PACKAGE_NAME} from ${pluginsPkgPath}`,
    `Removed ${PACKAGE_NAME} from plugins/package.json`, shouldDryRun);
  const selfPluginDir = path.join(pluginsDir, 'node_modules', PACKAGE_NAME);
  if ((await readTextIfExists(path.join(selfPluginDir, 'package.json'))) !== null) {
    await removeUninstallTarget(selfPluginDir, shouldDryRun);
  }

  // Our rtk wiring goes too, or OMP keeps rewriting for a removed package.
  await removeUninstallTarget(path.join(extDir, 'rtk.ts'), shouldDryRun);

  await clearSessionDefaults(shouldDryRun);

  console.log(`\nDone. Restart ${detectHosts().find((h) => h.id === host)?.label ?? host} for changes to take effect.`);
  results.push(true);
  }
  closeRL();
  return results.some(Boolean);
}

export { runUninstall };
