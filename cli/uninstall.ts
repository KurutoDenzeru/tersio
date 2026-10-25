// cli/uninstall.ts — remove managed extensions, plugins, and binaries.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  BUN_BIN_DIR, HOME, OMP_AGENT_DIR, OMP_PLUGINS_DIR, PACKAGE_NAME, RTK_BINARY_NAME,
  args, dryRun, keepPonytail, removePonytail, removeRtk, yes,
  debug, execP, writeConfigLines,
} from './common.ts';
import { PONYTAIL_PKG } from './manifest.ts';
import { askInteractiveChoice, closeRL, confirmDestructive, tty, sayTagged } from './interactive.ts';
import { detectHosts, hostOptions, parseHostArg } from './hosts.ts';
import type { HostEntry, HostId } from './hosts.ts';
import { piAgentDir, readTextIfExists } from '../extensions/shared/utils.ts';
import { tersioSettingsFile } from '../extensions/shared/plugin-settings.ts';
import {
  CODEX_LEGACY_PROMPTS, CODEX_PERSONAL_MARKETPLACE_LEGACY, CODEX_PLUGIN_ID, CODEX_PLUGIN_NAME, CODEX_PROMPTS, codexInstalledPlugin, codexLegacyPluginDir, codexPersonalMarketplaceFile,
  codexConfigFile, codexPersonalPluginId, codexPromptFile,
  codexPluginDir, codexPluginIdForDir, removeCodexMcpPolicy, removeCodexPersonalMarketplace,
} from '../extensions/shared/codex-plugin.ts';

function shortError(e: unknown): string {
  return (((e as Error & { stderr?: string }).stderr) || (e as Error).message || '').trim().slice(0, 200);
}

interface UninstallOptions {
  yes?: boolean;
  removePonytail?: boolean;
  removeRtk?: boolean;
  dryRun?: boolean;
  host?: HostId;
}

// The pi tree mirrors the OMP one. Ponytail and rtk stay: a package and a shared binary are not ours to delete.

const PI_TREE_DIRS = [
  // What an install writes now.
  'caveman',
  'pstack',
  'rtk',
  'updater',
  'combo',
  'commands',
  'shared',
  'server.ts',
  // Legacy: a tree an older build wrote, or a foreign name that was never shipped here.
  'caveman-session',
  'rtk-session',
  'rtk-filter',
  'ai-addons-updater',
  'combo-toggle',
  'tersio-commands',
  'lib',
  'opencode',
  'aaa-combo-boot',
];

// One `pi remove`, for both packages the installer adds there.
async function piRemove(spec: string, shouldDryRun: boolean): Promise<void> {
  if (shouldDryRun) {
    sayTagged(`  [dry-run] would run: pi remove ${spec}`);
    return;
  }
  try {
    const { execFile } = await import('node:child_process');
    await new Promise<void>((resolve, reject) => {
      execFile('pi', ['remove', spec], { timeout: 120000 }, (err, _out, errOut) => {
        if (err) reject(new Error(String(errOut).trim() || err.message));
        else resolve();
      });
    });
    sayTagged(`  [ok] removed the pi package ${spec}`);
  } catch (e) {
    sayTagged(`  [fail] pi remove: ${(e as Error).message}`);
    sayTagged(`  [hint] Manual: pi remove ${spec}`);
  }
}

// The installer writes a local package dir; drop it and its settings entry.
async function removeCopiedPonytailSkills(shouldDryRun: boolean): Promise<void> {
  const agentDir = piAgentDir();
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

// pi removal delegates to pi remove; always list and confirm first.
async function removePiLayer(host: HostEntry, shouldDryRun: boolean, shouldRemovePonytail: boolean, shouldRemoveRtk: boolean, confirmed: boolean): Promise<boolean> {
  const targets = PI_TREE_DIRS.map((dir) => path.join(piAgentDir(), 'extensions', dir));
  const rtkWiring = path.join(piAgentDir(), 'extensions', 'rtk.ts');
  const piPonytail = path.join(piAgentDir(), 'ponytail');

  if (!host.installed && !host.declared) {
    sayTagged(`  [skip] ${host.label} — nothing installed (${host.installCmd})`);
    return false;
  }
  console.log('Will remove:');
  for (const t of targets) console.log(`  ${t}`);
  if (shouldRemovePonytail) {
    console.log(`  npm:${PONYTAIL_PKG} (pi package)`);
    console.log(`  ${piPonytail} (local Ponytail package)`);
  }
  if (shouldRemoveRtk) console.log(`  ${rtkWiring} (rtk wiring)`);
  console.log(`  ${tersioSettingsFile()} (session defaults)`);
  if (!confirmed && !(await confirmDestructive(`Remove Tersio from ${host.label}?`))) { closeRL(); return false; }
  if (host.declared) await piRemove(`npm:${PACKAGE_NAME}`, shouldDryRun);
  if (shouldRemovePonytail) {
    await piRemove(`npm:${PONYTAIL_PKG}`, shouldDryRun);
    await removeCopiedPonytailSkills(shouldDryRun);
  }
  await Promise.all(targets.map((t) => removeUninstallTarget(t, shouldDryRun)));
  // rtk's wiring is a loose file, not a tree dir, so it survived --remove-rtk on pi while OMP removed its copy.
  if (shouldRemoveRtk) {
    await removeUninstallTarget(rtkWiring, shouldDryRun, false);
    await removeUninstallTarget(path.join(BUN_BIN_DIR, RTK_BINARY_NAME), shouldDryRun, false);
  }
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
  dryRun: boolean,
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
  if (dryRun) {
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

async function runUninstall(options: UninstallOptions = {}): Promise<boolean> {
  const shouldDryRun = options.dryRun ?? dryRun;
  const confirmed = (options.yes ?? yes) || shouldDryRun;
  // Ponytail ships with Tersio, so a full uninstall removes it.
  const shouldRemovePonytail = options.removePonytail ?? (removePonytail || !keepPonytail);
  const shouldRemoveRtk = options.removeRtk ?? removeRtk;

  console.log('\n=== Tersio Uninstall ===\n');

  // A TTY user picks the host; only hosts with tersio on them are offered.
  const installed = detectHosts().filter((host) => host.installed);
  let host: HostId = options.host ?? 'omp';
  try {
    host = parseHostArg(args) ?? host;
  } catch (e) {
    console.error(`[fail] ${(e as Error).message}`);
    process.exit(1);
  }
  if (!options.host && tty() && !confirmed) {
    if (installed.length === 0) {
      console.log('Tersio is not installed for any agent on this machine. Nothing to remove.');
      closeRL();
      return false;
    }
    if (installed.length > 1) {
      const choice = await askInteractiveChoice('Uninstall Tersio from which agent?', hostOptions(installed), host);
      if (choice.status !== 'selected') {
        closeRL();
        return false;
      }
      host = choice.value as HostId;
    } else {
      host = installed[0].id;
    }
  }
  const selected = detectHosts().find((h) => h.id === host) as HostEntry;
  if (host === 'pi') {
    const removed = await removePiLayer(selected, shouldDryRun, shouldRemovePonytail, shouldRemoveRtk, confirmed);
    if (removed) console.log('\nDone. Restart pi, then /combo lite.');
    closeRL();
    return removed;
  }
  if (host === 'opencode') {
    const dir = path.join(HOME, '.config', 'opencode', 'plugins', 'tersio');
    const configPath = path.join(HOME, '.config', 'opencode', 'opencode.json');
    if (!selected.installed && !selected.declared) {
      sayTagged(`  [skip] ${selected.label} — nothing installed (${selected.installCmd})`);
      closeRL();
      return false;
    }
    console.log('Will remove:');
    console.log(`  ${dir}`);
    console.log(`  ${path.join(HOME, '.config', 'opencode', 'plugins', 'rtk.ts')} (rtk auto-wrap; reinstall with: rtk init -g --opencode)`);
    console.log(`  the tersio entry in ${configPath}`);
    if (!confirmed && !(await confirmDestructive('Remove these Tersio files?'))) { closeRL(); return false; }
    await removeUninstallTarget(dir, shouldDryRun);
    await removeUninstallTarget(path.join(HOME, '.config', 'opencode', 'plugins', 'rtk.ts'), shouldDryRun, false);
    if (!shouldDryRun) {
      try {
        const raw = await readTextIfExists(configPath);
        const config = raw ? JSON.parse(raw) as { plugins?: unknown[] } : {};
        if (Array.isArray(config.plugins)) {
          config.plugins = config.plugins.filter((p) => typeof p !== 'string' || !p.includes('/opencode/plugins/tersio/'));
          await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
        }
      } catch { /* config missing or not JSON; nothing to scrub */ }
    }
    console.log('\nDone. Restart OpenCode to drop the plugin.');
    closeRL();
    return true;
  }
  if (host === 'codex') {
    const dir = codexPluginDir();
    const personalMarketplaceFile = codexPersonalMarketplaceFile();
    if (!selected.installed && !selected.hostPresent) {
      sayTagged(`  [skip] ${selected.label} — Tersio is not installed (${selected.installCmd})`);
      closeRL();
      return false;
    }
    const personalMarketplace = await readTextIfExists(personalMarketplaceFile);
    const installed = codexInstalledPlugin();
    const installedId = installed === null ? null : codexPluginIdForDir(installed.dir);
    const ids = [...new Set([
      installedId,
      CODEX_PLUGIN_ID,
      codexPersonalPluginId(personalMarketplace),
      `${CODEX_PLUGIN_NAME}@${CODEX_PERSONAL_MARKETPLACE_LEGACY}`,
    ].filter((id): id is string => id !== null))];
    console.log('Will remove:');
    for (const id of ids) console.log(`  ${id} (installed plugin and cache)`);
    console.log(`  ${dir} (personal plugin)`);
    console.log(`  the tersio entry in ${personalMarketplaceFile}`);
    console.log(`  ${codexLegacyPluginDir()} (unregistered legacy plugin)`);
    console.log(`  ${CODEX_PROMPTS.length} Tersio slash commands in ${path.dirname(codexPromptFile('combo'))}`);
    console.log(`  ${tersioSettingsFile()} (session defaults)`);
    if (!confirmed && !(await confirmDestructive('Remove Tersio from Codex?'))) { closeRL(); return false; }
    if (shouldDryRun) {
      for (const id of ids) sayTagged(`  [dry-run] would run: codex plugin remove ${id}`);
    } else {
      for (const id of ids) {
        await execP('codex', ['plugin', 'remove', id, '--json'], { timeout: 60000 }).catch((e) => {
          debug(`Codex plugin remove skipped: ${shortError(e)}`);
        });
      }
    }
    await removeUninstallTarget(dir, shouldDryRun);
    await removeUninstallTarget(codexLegacyPluginDir(), shouldDryRun);
    for (const name of [...CODEX_PROMPTS, ...CODEX_LEGACY_PROMPTS]) {
      await removeUninstallTarget(codexPromptFile(name), shouldDryRun, false);
    }
    // The MCP policy names the plugin, so it goes with the plugin and leaves every other table alone.
    const configFile = codexConfigFile();
    const configText = await readTextIfExists(configFile);
    const policyId = installedId ?? CODEX_PLUGIN_ID;
    const withoutPolicy = removeCodexMcpPolicy(configText, policyId);
    if (!shouldDryRun && withoutPolicy !== null && withoutPolicy !== configText) {
      await fs.writeFile(configFile, withoutPolicy, 'utf8');
      sayTagged(`  [write] removed the Tersio MCP policy from ${configFile}`);
    }
    if (!shouldDryRun) {
      const marketplace = await readTextIfExists(personalMarketplaceFile);
      if (marketplace !== null) {
        const next = removeCodexPersonalMarketplace(marketplace);
        if (next === null) await fs.rm(personalMarketplaceFile, { force: true });
        else await fs.writeFile(personalMarketplaceFile, next, 'utf8');
      }
    }
    await clearSessionDefaults(shouldDryRun);
    console.log('\nDone. Restart Codex to drop the Tersio plugin. Plugin data is kept.');
    closeRL();
    return true;
  }
  if (!selected.installed) sayTagged(`  [note] ${selected.label} has no tersio install; removing what is left behind.`);

  const extDir = path.join(OMP_AGENT_DIR, 'extensions');
  const configPath = path.join(OMP_AGENT_DIR, 'config.yml');
  const rtkBin = path.join(BUN_BIN_DIR, RTK_BINARY_NAME);
  const pluginsDir = OMP_PLUGINS_DIR;
  const ponytailPkgDir = path.join(pluginsDir, 'node_modules', '@dietrichgebert', 'ponytail');

  const targets = [
    // What an install writes now.
    'caveman',
    'rtk',
    'updater',
    'combo',
    'commands',
    'shared',
    // Legacy: a tree an older build wrote into the agent tree, or a foreign name never shipped here.
    'caveman-session',
    'rtk-session',
    'rtk-filter',
    'ai-addons-updater',
    'combo-toggle',
    'tersio-commands',
    'lib',
    'aaa-combo-boot',
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

  if (shouldRemoveRtk) {
    console.log(`  ${rtkBin}`);
    console.log(`  ${path.join(extDir, 'rtk.ts')} (rtk OMP wiring)`);
  }

  if (!confirmed && !(await confirmDestructive('Remove the listed Tersio files?'))) return false;

  // Remove extension directories (independent paths, so concurrently).
  await Promise.all(targets.map((t) => removeUninstallTarget(t, shouldDryRun)));

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
  if (shouldRemoveRtk) await removeUninstallTarget(rtkBin, shouldDryRun, false);

  await clearSessionDefaults(shouldDryRun);

  console.log(`\nDone. Restart ${detectHosts().find((h) => h.id === host)?.label ?? host} for changes to take effect.`);
  return true;
}

export { runUninstall };
