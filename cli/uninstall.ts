// cli/uninstall.ts — remove managed extensions, plugins, and binaries.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { cancel as clackCancel, confirm as clackConfirm } from '@clack/prompts';
import {
  BUN_BIN_DIR, OMP_AGENT_DIR, OMP_PLUGINS_DIR, PACKAGE_NAME, RTK_BINARY_NAME,
  dryRun, keepPonytail, removePonytail, removeRtk, yes,
  debug, parseJsonObject, writeConfigLines, writeIfChanged,
} from './common.ts';
import { ask, closeRL, tty } from './interactive.ts';
import { openCodeAgentsPath, openCodePluginPath, removeOpenCodeRtk } from './opencode-wiring.ts';
import { byId, clearAgents, hostPath, selectedHosts } from './agents.ts';
import type { AgentHost } from './agents.ts';
import { HOOK_SCRIPT_NAME, removeHost } from './host-writers.ts';
import { START as TERSIO_START } from './rules-pack.ts';
import { readTextIfExists } from '../extensions/lib/utils.ts';

interface UninstallOptions {
  yes?: boolean;
  removePonytail?: boolean;
  removeRtk?: boolean;
  dryRun?: boolean;
}

// Read-modify-write a JSON file. mutate returns true when it changed
// something; no change (or unreadable file) means no output at all.
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
    console.log(`  [dry-run] ${dryRunNote}`);
    return;
  }
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`  [write] ${writeNote}`);
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
      console.log(`  [dry-run] would remove ${target}`);
      return;
    }
    if (recursive) await fs.rm(target, { recursive: true, force: true });
    else await fs.unlink(target);
    console.log(`  [rm] ${target}`);
  } catch {
    debug(`Could not remove ${target}`);
  }
}

/**
 * Hosts with Tersio files on this machine, and what each has. The stored
 * selection is a preference, not evidence: a host can be selected and then fail
 * its write, and listing it as installed hides the hosts that are really there.
 */
async function hostsWithTersioFiles(): Promise<Array<{ host: AgentHost; artifacts: string[] }>> {
  const found: Array<{ host: AgentHost; artifacts: string[] }> = [];
  for (const id of selectedHosts()) {
    const host = byId(id);
    if (!host) continue;
    const artifacts: string[] = [];

    if (host.id === 'opencode') {
      // OpenCode's guidance block uses its own marker (cli/opencode-wiring.ts),
      // not the generic rules marker, and its plugin is a plain file rather than
      // a hook config, so probe both explicitly.
      if (await readTextIfExists(openCodePluginPath()) !== null) artifacts.push('rtk plugin');
      const agents = await readTextIfExists(openCodeAgentsPath());
      if (agents !== null && agents.includes('tersio:rtk:start')) artifacts.push('guidance');
      if (artifacts.length > 0) found.push({ host, artifacts });
      continue;
    }
    // OMP's artifacts are the extension directories already listed above.
    if (host.id === 'omp') continue;

    if (host.rulesFile) {
      const text = await readTextIfExists(hostPath(host, host.rulesFile));
      if (text !== null && text.includes(TERSIO_START)) artifacts.push('rules');
    }
    if (host.skillsDir) {
      for (const mode of ['caveman', 'ponytail', 'rtk'] as const) {
        const skill = await readTextIfExists(hostPath(host, `${host.skillsDir}/tersio-${mode}/SKILL.md`));
        if (skill !== null) artifacts.push(`${mode} skill`);
      }
    }
    const cfg = host.rewriteConfig;
    if (cfg) {
      const hookText = await readTextIfExists(hostPath(host, cfg.configFile));
      if (hookText !== null && hookText.includes(HOOK_SCRIPT_NAME)) artifacts.push('rtk hook');
    }
    if (artifacts.length > 0) found.push({ host, artifacts });
  }
  return found;
}

async function runUninstall(options: UninstallOptions = {}): Promise<boolean> {
  const shouldDryRun = options.dryRun ?? dryRun;
  const confirmed = (options.yes ?? yes) || shouldDryRun;
  // Ponytail is bundled with Tersio's presets, so a full uninstall removes
  // its copy too; --keep-ponytail opts out and reinstall always preserves it.
  const shouldRemovePonytail = options.removePonytail ?? (removePonytail || !keepPonytail);
  const shouldRemoveRtk = options.removeRtk ?? removeRtk;

  console.log('\n=== Tersio Uninstall ===\n');

  const extDir = path.join(OMP_AGENT_DIR, 'extensions');
  const configPath = path.join(OMP_AGENT_DIR, 'config.yml');
  const rtkBin = path.join(BUN_BIN_DIR, RTK_BINARY_NAME);
  const pluginsDir = OMP_PLUGINS_DIR;
  const ponytailPkgDir = path.join(pluginsDir, 'node_modules', '@dietrichgebert', 'ponytail');

  const targets = [
    'caveman-session',
    'rtk-session',
    'ai-addons-updater',
    'combo-toggle',
    'tersio-commands',
    'shared',
    // Only consumed by ai-addons-updater (removed above); otherwise orphaned.
    'lib',
    // Legacy always-on combo helper; imports shared/session-state.js, so it
    // breaks with a module-not-found warning once the shared dir is removed.
    'aaa-combo-boot',
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

  // Show only the hosts that actually have Tersio files on disk, each with what
  // it has. The stored selection is a preference, not evidence: a host can be
  // selected and fail to write, and listing it as if it were installed is noise
  // that hides the hosts which are really there.
  const installedHosts = await hostsWithTersioFiles();
  if (shouldRemoveRtk) {
    if (installedHosts.some((h) => h.host.id === 'opencode')) {
      console.log(`  ${openCodePluginPath()} (opencode rtk plugin)`);
      console.log(`  ${openCodeAgentsPath()} (opencode rtk guidance block)`);
    }
    for (const { host, artifacts } of installedHosts) {
      if (host.id === 'opencode' || host.id === 'omp') continue;
      console.log(`  ${host.label} — ${artifacts.join(', ')}`);
    }
  }

  if (!confirmed) {
    if (tty()) {
      closeRL();
      const confirmedChoice = await clackConfirm({ message: 'Remove the listed Tersio files?', initialValue: false });
      if (typeof confirmedChoice !== 'boolean') {
        clackCancel('Aborted.');
        closeRL();
        return false;
      }
      if (!confirmedChoice) {
        console.log('Aborted.');
        closeRL();
        return false;
      }
    } else {
      const answer = await ask('\nProceed? [y/N]: ');
      if (!answer.toLowerCase().startsWith('y')) {
        console.log('Aborted.');
        closeRL();
        return false;
      }
    }
  }

  // Remove extension directories (independent paths, so concurrently).
  await Promise.all(targets.map((t) => removeUninstallTarget(t, shouldDryRun)));

  // Remove Combo and mode-reinforcement registrations; Ponytail only when requested.
  const configRaw = await readTextIfExists(configPath);
  if (configRaw) {
    let lines = configRaw.split('\n');
    const before = lines.length;
    lines = lines.filter((l) => {
      if (l.includes('combo-toggle') || l.includes('mode-reinforcement')) return false;
      if (shouldRemovePonytail && l.includes('ponytail') && l.includes('pi-extension')) return false;
      return true;
    });
    if (lines.length !== before) {
      if (shouldDryRun) console.log(`  [dry-run] would remove ${before - lines.length} config.yml entries`);
      else await writeConfigLines(configPath, lines, `  [write] Updated config.yml (removed ${before - lines.length} entries)`);
    }
  }

  // Remove the bundled Ponytail copy (dep entry exists only on
  // pre-bundle installs); the config.yml entry was filtered above.
  if (shouldRemovePonytail) {
    const pluginsPkgPath = path.join(pluginsDir, 'package.json');
    await updateJsonFile(pluginsPkgPath,
      (data) => dropKey(data.dependencies, '@dietrichgebert/ponytail'),
      `would remove @dietrichgebert/ponytail from ${pluginsPkgPath}`,
      'Removed @dietrichgebert/ponytail from plugins/package.json', shouldDryRun);
    try {
      if (shouldDryRun) console.log(`  [dry-run] would remove ${ponytailPkgDir}`);
      else {
        await fs.rm(ponytailPkgDir, { recursive: true, force: true });
        console.log(`  [rm] ${ponytailPkgDir}`);
        await fs.rm(path.dirname(ponytailPkgDir));
        console.log(`  [rm] ${path.dirname(ponytailPkgDir)} (empty scope)`);
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

  // Remove RTK binary if requested. rtk.ts is rtk-owned but installed by our
  // wiring step; with the binary gone it would pass through harmlessly, so
  // only drop it on a full rtk removal.
  if (shouldRemoveRtk) {
    await removeUninstallTarget(rtkBin, shouldDryRun, false);
    await removeUninstallTarget(path.join(extDir, 'rtk.ts'), shouldDryRun);
  }

  // Only the hosts the preview listed are actually removed. Running removal
  // over the whole stored selection would touch a host the user never got
  // files for, and would report removals the preview never promised.
  if (shouldRemoveRtk) {
    if (installedHosts.some((h) => h.host.id === 'opencode')) {
      // OpenCode's plugin is ours, not rtk's, so it goes with --remove-rtk for
      // the same reason ~/.omp/agent/extensions/rtk.ts does: with the binary
      // gone the hook would pass through harmlessly, but the file is ours.
      await removeOpenCodeRtk({ dryRun: shouldDryRun, quiet: true });
    }
    for (const { host } of installedHosts) {
      if (host.id === 'omp' || host.id === 'opencode') continue;
      // Strip our rules block, drop our skills, and prune our hook from the
      // host's config, leaving everything else the user put there.
      await removeHost(host, { dryRun: shouldDryRun, quiet: true });
    }
    await clearAgents();
  }

  console.log('\nDone. Restart OMP for changes to take effect.');
  return true;
}

export { runUninstall };
