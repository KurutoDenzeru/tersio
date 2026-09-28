// cli/uninstall.ts — remove managed extensions, plugins, and binaries.
import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cancel as clackCancel } from '@clack/prompts';
import {
  PACKAGE_NAME, RTK_BINARY_NAME,
  agentFlag, dryRun, keepOmpLayer, keepPonytail, removePonytail, removeRtk, verbose, yes,
  debug, writeConfigLines,
} from './common.ts';
import { ask, askInteractiveChoice, askInteractiveConfirm, closeRL, tty } from './interactive.ts';
import { readTextIfExists } from '../extensions/lib/utils.ts';
import {
  clearRetiredPaths, displayPath, installedHostIds, installedRows, installedState,
  readSelection, resolveAgentSelection, writeSelection,
} from './agents.ts';
import { byId, type AgentHost } from './agent-hosts.ts';
import { ompExtensionTargets, ompLayer } from './omp-layer.ts';
import { piExtensionTargets, piLayer } from './pi-layer.ts';
import { removePiTersio } from './pi-wiring.ts';
import { removePiRtk } from './rtk-wiring.ts';

// Menu row that resolves to every installed host. Not a host id.
const ALL_HOSTS = '__all__';

interface UninstallOptions {
  yes?: boolean;
  removePonytail?: boolean;
  removeRtk?: boolean;
  keepOmpLayer?: boolean;
  // Clear the extension directories while keeping the plugin package.
  replaceOmpExtensions?: boolean;
  // Host ids to act on instead of the resolved selection.
  agentFlagOverride?: string[];
  dryRun?: boolean;
}

// Read-modify-write a JSON file. mutate returns true when it changed something;
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
  step(`[write] ${writeNote}`);
}

function dropKey(section: unknown, key: string): boolean {
  if (!section || typeof section !== 'object') return false;
  const record = section as Record<string, unknown>;
  if (!(key in record)) return false;
  delete record[key];
  return true;
}

// An internal step line, under `--verbose` only: the default answers "what will this change", not "how the remover works".
function step(line: string): void {
  if (verbose) console.log(`  ${line}`);
}

// One plain sentence for a host, in place of its file list.
function planLine(label: string, count: number): void {
  console.log(`  ${label} \u2014 ${count} item${count === 1 ? '' : 's'} will be removed.`);
}

// What an earlier version wrote and this one no longer does, read without removing.
function retiredOnDisk(host: AgentHost | undefined, home: string): Array<{ label: string; path: string }> {
  if (!host) return [];
  return (host.retired ?? [])
    .map((entry) => ({ label: entry.kind === 'merged' ? 'rules block' : 'superseded path', path: path.join(home, entry.path) }))
    .filter((entry) => existsSync(entry.path));
}

async function removeUninstallTarget(target: string, shouldDryRun: boolean, recursive = true): Promise<void> {
  try {
    if (shouldDryRun) {
      step(`[dry-run] would remove ${target}`);
      return;
    }
    if (recursive) await fs.rm(target, { recursive: true, force: true });
    else await fs.unlink(target);
    step(`[rm] ${target}`);
  } catch {
    debug(`Could not remove ${target}`);
  }
}

async function runUninstall(options: UninstallOptions = {}): Promise<boolean> {
  const shouldDryRun = options.dryRun ?? dryRun;
  const confirmed = (options.yes ?? yes) || shouldDryRun;
  // Ponytail is bundled with Tersio's presets, so a full uninstall removes its copy too;
  const shouldRemovePonytail = options.removePonytail ?? (removePonytail || !keepPonytail);
  const shouldRemoveRtk = options.removeRtk ?? removeRtk;
  // The layer answer. `--keep-omp-layer` settles it without a prompt, and reinstall passes `true` so its clean step keeps...
  const wantsOmpLayer = options.keepOmpLayer ?? keepOmpLayer;

  console.log('\n=== Tersio Uninstall ===\n');

  // Asked before the destructive confirm, not after it.
  const home = os.homedir();
  // Only hosts with something of ours on disk are offered.
  const state = installedState(home);
  const installed = installedHostIds(state);
  // No pre-tick and no "not installed" rows: this menu only ever deletes, so Enter on the highlighted row is the safe...
  let cancelled = false;
  const pinned = options.agentFlagOverride;
  const selection = await resolveAgentSelection({
    flag: pinned ?? agentFlag,
    stored: installed,
    detected: [],
    // Single select, one host per run. Space-to-tick was the install menu's shape;
    ask: !pinned && tty() && !confirmed && agentFlag.length === 0
      ? async () => {
        const rows = installedRows(state);
        if (rows.length === 0) return [];
        // The all-in-one row goes last, for the same reason as install.
        const options = rows.length > 1
          ? [...rows, { value: ALL_HOSTS, label: `All installed agents (${rows.length})` }]
          : rows;
        const answer = await askInteractiveChoice(
          'Remove tersio from which coding agent?',
          options,
          rows[0].value,
        );
        if (answer.status !== 'selected') {
          cancelled = true;
          return [];
        }
        return answer.value === ALL_HOSTS ? installed : [answer.value];
      }
      : undefined,
  });
  // Cancel is an abort, not an empty answer: falling through to the automatic set would remove every installed host from a...
  if (cancelled) {
    closeRL();
    return false;
  }
  const extra = selection.ids.filter((id) => id !== 'omp');
  const layer = ompLayer(home, RTK_BINARY_NAME);
  const configPath = layer.configFile;
  const pluginsDir = layer.pluginsDir;
  const ponytailPkgDir = layer.ponytailPackage;
  const rtkBin = layer.rtkBinary;
  const targets = ompExtensionTargets(layer).filter((target) => existsSync(target));
  // Pi's live behavior is a directory tree, and removePiTersio deletes all of it.
  const piTargets = extra.includes('pi')
    ? piExtensionTargets(piLayer(home)).filter((target) => existsSync(target))
    : [];

  // Oh My Pi is one row in the menu above, not a separate question.
  const removeOmpLayer = selection.ids.includes('omp') && !wantsOmpLayer;
  // Reinstall clears the extension dirs but keeps the plugin package.
  const removeOmpExtensions = removeOmpLayer || options.replaceOmpExtensions === true;

  // The OMP layer stays unless OMP is the host being removed; its retired paths do not.
  const artifactHosts = removeOmpLayer ? selection.ids : extra;
  const retired = artifactHosts.flatMap((id) => retiredOnDisk(byId(id), home));

  // Printed from the resolved selection, so every line below is something the run really does.
  if (removeOmpExtensions) {
    // Names only what this run takes: a header that always said "Ponytail" would describe a removal a reinstall does not...
    const also = [
      removeOmpLayer && shouldRemovePonytail ? 'Ponytail' : null,
      removeOmpLayer && shouldRemoveRtk ? 'rtk' : null,
    ].filter(Boolean);
    if (verbose) {
      console.log(`  Oh My Pi — ${targets.length} extension director${targets.length === 1 ? 'y' : 'ies'}${also.length > 0 ? `, ${also.join(', ')}` : ''}`);
      for (const target of targets) console.log(`    ${displayPath(target, home)}`);
    }
    // Both of these are printed only when they are on disk.
    if (removeOmpLayer && shouldRemovePonytail && existsSync(ponytailPkgDir)) {
      if (verbose) console.log(`    ${displayPath(ponytailPkgDir, home)} — ponytail plugin package`);
    }
    if (removeOmpLayer && shouldRemoveRtk) {
      if (verbose && existsSync(rtkBin)) console.log(`    ${displayPath(rtkBin, home)} — rtk binary`);
      if (verbose && existsSync(layer.rtkExtension)) console.log(`    ${displayPath(layer.rtkExtension, home)} — rtk OMP wiring`);
    }
  }

  // Only what is still ours is named: a stale plan would overstate what happens, and a host with nothing left is dropped...
  const piRtk = piLayer(home).rtkExtension;
  const piWiring = extra.includes('pi') && existsSync(piRtk) ? 1 : 0;
  const piTotal = piTargets.length + piWiring;
  if (piTotal > 0) {
    if (!verbose) planLine('Pi', piTotal);
    else {
      console.log(`\n  Pi — ${piTotal} artifact${piTotal === 1 ? '' : 's'} to remove`);
      for (const target of piTargets) console.log(`    ${displayPath(target, home)}`);
      if (piWiring) console.log(`    ${displayPath(piRtk, home)} — rtk Pi wiring`);
    }
  }
  for (const entry of retired) {
    if (verbose) console.log(`  ${entry.label} — ${displayPath(entry.path, home)} (earlier release)`);
  }
  if (retired.length > 0 && !verbose) planLine('Earlier-release files', retired.length);

  // With nothing to remove there is nothing to confirm, so say so and stop.
  const layerDirsLeft = artifactHosts.some((id) => {
    const dir = id === 'pi'
      ? path.join(home, '.pi', 'agent', 'extensions')
      : id === 'omp'
        ? path.join(home, '.omp', 'agent', 'extensions')
        : '';
    return dir !== '' && existsSync(dir);
  });
  if (!removeOmpExtensions && !layerDirsLeft && retired.length === 0 && piTotal === 0) {
    console.log('\n  Nothing selected — no files were removed.');
    if (!confirmed) closeRL();
    return false;
  }

  // A host that was asked for and had nothing of ours on disk is named here, so a partial run says which host it found...
  if (piTotal === 0 && retired.length === 0 && artifactHosts.length > 0) {
    const asked = [...new Set(artifactHosts)].join(', ');
    console.log(`\n  Nothing of ours found for ${asked}.`);
  }

  // Only worth saying when the layer was kept while other agents were cleared.
  if (!removeOmpLayer) {
    console.log('\nKeeping the Oh My Pi (OMP) extensions and Ponytail. Re-run and pick OMP to remove them.');
  }

  if (!confirmed) {
    const names = [...new Set(artifactHosts.map((id) => byId(id)?.label ?? id))];
    if (tty()) {
      // Defaults to No, so Enter means "keep everything".
      const confirmChoice = await askInteractiveConfirm(`Remove Tersio from ${names.join(', ')}?`, false);
      if (confirmChoice.status !== 'confirmed') {
        if (confirmChoice.status === 'cancelled') clackCancel('Aborted.');
        else console.log('Aborted.');
        closeRL();
        return false;
      }
      if (!confirmChoice.value) {
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

  // The extension dirs go whenever they are being replaced, a reinstall as well as a full removal.
  if (removeOmpExtensions) {
    // Extension directories are independent paths, so remove them concurrently.
    await Promise.all(targets.map((t) => removeUninstallTarget(t, shouldDryRun)));
  }

  if (removeOmpExtensions) {
    // Remove Combo and mode-reinforcement registrations;
    const configRaw = await readTextIfExists(configPath);
    if (configRaw) {
      let lines = configRaw.split('\n');
      const before = lines.length;
      lines = lines.filter((l) => {
        if (l.includes('combo-toggle') || l.includes('mode-reinforcement')) return false;
        if (removeOmpLayer && shouldRemovePonytail && l.includes('ponytail') && l.includes('pi-extension')) return false;
        return true;
      });
      if (lines.length !== before) {
        if (shouldDryRun) step(`[dry-run] would remove ${before - lines.length} config.yml entries`);
        else await writeConfigLines(configPath, lines, `  [write] Updated config.yml (removed ${before - lines.length} entries)`);
      }
    }
  }

  // Everything below removes the plugin package or the binaries, which only a full OMP removal does.
  if (removeOmpLayer) {
    // Remove the bundled Ponytail copy (dep entry exists only on pre-bundle installs);
    if (shouldRemovePonytail) {
      const pluginsPkgPath = path.join(pluginsDir, 'package.json');
      await updateJsonFile(pluginsPkgPath,
        (data) => dropKey(data.dependencies, '@dietrichgebert/ponytail'),
        `would remove @dietrichgebert/ponytail from ${pluginsPkgPath}`,
        'Removed @dietrichgebert/ponytail from plugins/package.json', shouldDryRun);
      try {
        if (shouldDryRun) step(`[dry-run] would remove ${ponytailPkgDir}`);
        else {
          await fs.rm(ponytailPkgDir, { recursive: true, force: true });
          step(`[rm] ${ponytailPkgDir}`);
          await fs.rm(path.dirname(ponytailPkgDir));
          step(`[rm] ${path.dirname(ponytailPkgDir)} (empty scope)`);
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

    // Remove RTK binary if requested. rtk.ts is rtk-owned but installed by our wiring step;
    if (shouldRemoveRtk) {
      await removeUninstallTarget(rtkBin, shouldDryRun, false);
      await removeUninstallTarget(layer.rtkExtension, shouldDryRun);
    }
  }

  // Clear what an earlier version wrote for the selected hosts.
  for (const id of artifactHosts) {
    const host = byId(id);
    if (!host) continue;
    for (const removed of clearRetiredPaths(host, home, { dryRun: shouldDryRun })) {
      step(`${shouldDryRun ? '[dry-run] would remove' : '[rm]'} ${displayPath(removed, home)} (earlier release)`);
    }
  }

  // Pi's live behavior lives in extension files: rtk's own rtk.ts (written by `rtk init -g --agent pi`) and tersio's...
  if (extra.includes('pi')) {
    await removePiRtk(home, { dryRun: shouldDryRun, quiet: false });
    await removePiTersio(home, { dryRun: shouldDryRun, quiet: false });
  }

  // Keep the saved set in step with what is left, so a later install does not resurrect agents the user just cleared.
  if (!shouldDryRun && selection.source === 'prompt') {
    writeSelection(home, readSelection(home).hosts.filter((id) => !extra.includes(id)));
  }

  // Not OMP-specific: the run may have cleared nothing but coding agents.
  console.log(removeOmpExtensions
    ? '\nDone. Restart OMP for changes to take effect.'
    : '\nDone — restart your agents to pick up the changes.');
  return true;
}

export { runUninstall };
