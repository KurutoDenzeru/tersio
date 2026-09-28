// cli/uninstall.ts — remove managed extensions, plugins, and binaries.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { cancel as clackCancel, confirm as clackConfirm } from '@clack/prompts';
import {
  BUN_BIN_DIR, OMP_AGENT_DIR, OMP_PLUGINS_DIR, PACKAGE_NAME, RTK_BINARY_NAME,
  args, dryRun, keepPonytail, removePonytail, removeRtk, yes,
  debug, parseJsonObject, writeConfigLines, writeIfChanged,
} from './common.ts';
import { ask, askInteractiveChoice, closeRL, tty } from './interactive.ts';
import { detectHosts, hostHint, hostLabel, parseHostArg } from './hosts.ts';
import type { HostEntry, HostId } from './hosts.ts';
import { piAgentDir, readTextIfExists } from '../extensions/lib/utils.ts';
import { tersioSettingsFile } from '../extensions/shared/plugin-settings.ts';

interface UninstallOptions {
  yes?: boolean;
  removePonytail?: boolean;
  removeRtk?: boolean;
  dryRun?: boolean;
  host?: HostId;
}

// The pi tree mirrors the OMP one, so the same directories come off. Ponytail
// and rtk stay: a pi package and a shared binary are not ours to delete.
// The session defaults live in ~/.tersio/settings.json for both hosts, so the
// caller clears them once at the end.
const PI_TREE_DIRS = [
  'caveman-session',
  'rtk-session',
  'ai-addons-updater',
  'combo-toggle',
  'tersio-commands',
  'shared',
  'lib',
];

async function removePiLayer(host: HostEntry, shouldDryRun: boolean, shouldRemovePonytail: boolean): Promise<boolean> {
  const extDir = path.join(piAgentDir(), 'extensions');
  const targets = PI_TREE_DIRS.map((dir) => path.join(extDir, dir));
  if (shouldRemovePonytail) targets.push(path.join(piAgentDir(), 'skills'));

  if (!host.installed && !host.declared) {
    console.log(`  [skip] ${host.label} — nothing installed (${host.installCmd})`);
    return false;
  }
  if (host.declared) {
    if (shouldDryRun) console.log(`  [dry-run] would run: ${host.removeCmd}`);
    else {
      try {
        const { execFile } = await import('node:child_process');
        await new Promise<void>((resolve, reject) => {
          execFile(host.bin, ['remove', `npm:${PACKAGE_NAME}`], { timeout: 120000 }, (err, _out, errOut) => {
            if (err) reject(new Error(String(errOut).trim() || err.message));
            else resolve();
          });
        });
        console.log(`  [ok] removed the pi package ${host.declared}`);
      } catch (e) {
        console.log(`  [fail] pi remove: ${(e as Error).message}`);
        console.log(`  [hint] Manual: ${host.removeCmd}`);
      }
    }
  }
  await Promise.all(targets.map((t) => removeUninstallTarget(t, shouldDryRun)));
  await clearSessionDefaults(shouldDryRun);
  return true;
}

// The session defaults live in ~/.tersio/settings.json for every host, and
// that file holds nothing but Tersio's values, so it comes off as a whole.
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

async function runUninstall(options: UninstallOptions = {}): Promise<boolean> {
  const shouldDryRun = options.dryRun ?? dryRun;
  const confirmed = (options.yes ?? yes) || shouldDryRun;
  // Ponytail ships with Tersio, so a full uninstall removes it;
  // --keep-ponytail opts out and reinstall always preserves it.
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
      const choice = await askInteractiveChoice('Uninstall Tersio from which agent?', installed.map((h) => ({
        value: h.id,
        label: hostLabel(h),
        hint: hostHint(h),
      })), host);
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
    const removed = await removePiLayer(selected, shouldDryRun, shouldRemovePonytail);
    if (removed) console.log('\nDone. Restart pi for changes to take effect.');
    closeRL();
    return removed;
  }
  if (!selected.installed) console.log(`  [note] ${selected.label} has no tersio install; removing what is left behind.`);

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
    // Only consumed by the updater, which runs before this.
    'lib',
    // Legacy helper importing shared/session-state.js: it warns once that
    // module is gone.
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

  // Remove Combo and mode-reinforcement registrations; Ponytail on request.
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

  // Remove the bundled Ponytail copy (the dep entry exists only on pre-bundle
  // installs); its config.yml entry was filtered above.
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

  // rtk.ts is rtk-owned but written by our wiring step. With the binary gone it
  // would pass through harmlessly, so drop it only on a full rtk removal.
  if (shouldRemoveRtk) {
    await removeUninstallTarget(rtkBin, shouldDryRun, false);
    await removeUninstallTarget(path.join(extDir, 'rtk.ts'), shouldDryRun);
  }

  await clearSessionDefaults(shouldDryRun);

  console.log('\nDone. Restart OMP for changes to take effect.');
  return true;
}

export { runUninstall };
