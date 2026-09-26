// cli/uninstall.ts — remove managed extensions, plugins, and binaries.
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cancel as clackCancel, confirm as clackConfirm } from '@clack/prompts';
import {
  BUN_BIN_DIR, OMP_AGENT_DIR, OMP_PLUGINS_DIR, PACKAGE_NAME, RTK_BINARY_NAME,
  agentFlag, dryRun, keepPonytail, removePonytail, removeRtk, yes,
  debug, writeConfigLines,
} from './common.ts';
import { ask, askInteractiveMultiChoice, closeRL, tty } from './interactive.ts';
import { readTextIfExists } from '../extensions/lib/utils.ts';
import { agentChoices, readSelection, removeHosts, resolveAgentSelection, writeSelection } from './agents.ts';
import { removeOpenCodeRtk } from './opencode-wiring.ts';

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

  // Strip tersio's content from every other selected host. This removes only
  // what we wrote: a merged file loses its marked block, a config the user also
  // owns keeps everything but our entry, and a file we named is deleted once it
  // configures no hook.
  const home = os.homedir();
  const stored = readSelection(home).hosts;
  // Unlike install, detection is deliberately NOT unioned in here. Removal acts
  // on what tersio actually wrote, and a host that merely happens to be
  // installed was never a tersio install target. Unioning would advertise
  // removals for hosts the user never selected.
  const selection = await resolveAgentSelection({
    flag: agentFlag,
    stored,
    detected: [],
    ask: tty() && !confirmed && agentFlag.length === 0
      ? async () => {
        const answer = await askInteractiveMultiChoice(
          'Remove tersio from which coding agents?',
          agentChoices(),
          stored,
        );
        return answer.status === 'selected' ? answer.value : null;
      }
      : undefined,
  });
  const extra = selection.ids.filter((id) => id !== 'omp');
  if (extra.length > 0) {
    // The header prints under --dry-run too: a preview that silently omits a
    // section is not a preview of the real run.
    console.log('\n=== Agent hosts ===\n');
    const { results, errors } = await removeHosts(extra, home, { dryRun: shouldDryRun, quiet: false });
    for (const r of results) {
      const what = r.removed.length === 0
        ? 'nothing of ours found'
        : shouldDryRun
          ? `would remove ${r.removed.length} path(s)`
          : `removed ${r.removed.length} path(s)`;
      console.log(`  ${shouldDryRun ? '[dry-run]' : '[ok]'} ${r.host.label}: ${what}`);
      if (r.kept.length > 0 && !shouldDryRun) {
        console.log(`         kept ${r.kept.length} file(s) that also hold your own content`);
      }
    }
    for (const e of errors) console.log(`  [fail] ${e.host}: ${e.error}`);

    // OpenCode's rewrite lives in a plugin the generic emitters cannot remove.
    if (extra.includes('opencode')) {
      await removeOpenCodeRtk(home, { dryRun: shouldDryRun, quiet: false });
    }

    // Keep the saved set in step with what is left, so a later install does not
    // resurrect agents the user just cleared out.
    if (!shouldDryRun && selection.source === 'prompt') {
      writeSelection(home, selection.ids.filter((id) => id !== 'omp'));
    }
  }

  console.log('\nDone. Restart OMP for changes to take effect.');
  return true;
}

export { runUninstall };
