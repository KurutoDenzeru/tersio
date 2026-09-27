// cli/uninstall.ts — remove managed extensions, plugins, and binaries.
import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cancel as clackCancel } from '@clack/prompts';
import {
  PACKAGE_NAME, RTK_BINARY_NAME,
  agentFlag, dryRun, keepOmpLayer, keepPonytail, removePonytail, removeRtk, yes,
  debug, writeConfigLines,
} from './common.ts';
import { ask, askInteractiveChoice, askInteractiveConfirm, closeRL, tty } from './interactive.ts';
import { readTextIfExists } from '../extensions/lib/utils.ts';
import {
  displayPath, installedHostIds, installedRows, installedState,
  planRemove, readSelection, removeHosts, resolveAgentSelection, writeSelection,
} from './agents.ts';
import { ompExtensionTargets, ompLayer } from './omp-layer.ts';
import { piExtensionTargets, piLayer } from './pi-layer.ts';
import { removeOpenCodeRtk } from './opencode-wiring.ts';
import { removePiTersio } from './pi-wiring.ts';
import { removePiRtk } from './rtk-wiring.ts';

/** Menu row that resolves to every installed host. Not a host id. */
const ALL_HOSTS = '__all__';

interface UninstallOptions {
  yes?: boolean;
  removePonytail?: boolean;
  removeRtk?: boolean;
  keepOmpLayer?: boolean;
  /** Clear the extension directories while keeping the plugin package. */
  replaceOmpExtensions?: boolean;
  /** Host ids to act on instead of the resolved selection. */
  agentFlagOverride?: string[];
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
  // The layer answer. `--keep-omp-layer` settles it without a prompt, and
  // reinstall passes `true` so its clean step keeps Ponytail: deleting the
  // plugin a reinstall is about to re-download leaves a window with neither.
  const wantsOmpLayer = options.keepOmpLayer ?? keepOmpLayer;

  console.log('\n=== Tersio Uninstall ===\n');

  // Ask which agents to clear BEFORE the destructive confirm: asking afterwards
  // ran the confirm first, so the agent prompt appeared once the OMP files were
  // already gone.
  const home = os.homedir();
  // Only hosts with something of ours on disk are offered — a row is an offer
  // to delete, and a row with no files is an offer to delete nothing. The saved
  // set is not consulted: the disk is the only honest source (see
  // installedState). Reinstall drives this call directly, so it can pin the
  // layer without a prompt.
  const state = installedState(home);
  const installed = installedHostIds(state);
  // No pre-tick and no "not installed" rows: this menu only ever deletes, so
  // Enter on the highlighted row is the safe answer.
  let cancelled = false;
  const pinned = options.agentFlagOverride;
  const selection = await resolveAgentSelection({
    flag: pinned ?? agentFlag,
    stored: installed,
    detected: [],
    // Single select, one host per run. Space-to-tick was the install menu's
    // shape; here every row is a deletion, and a tick list invites the
    // highlight-and-Enter reflex that removes the wrong host.
    ask: !pinned && tty() && !confirmed && agentFlag.length === 0
      ? async () => {
        const rows = installedRows(state);
        if (rows.length === 0) return [];
        // The all-in-one row goes last for the same reason it does in install:
        // Enter is the reflex answer, so it should land on the row a user who
        // wants one host means. The confirm below still defaults to No.
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
  // Cancel is an abort, not an empty answer: falling through to the automatic
  // set would remove every installed host from a menu the user quit.
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
  // Pi's live behavior is a directory tree the generic emitters never see, and
  // removePiTersio deletes all of it. The menu counts these dirs, so the plan
  // has to name them: a count the preview never shows is a promise the run
  // makes and the user cannot check.
  const piTargets = extra.includes('pi')
    ? piExtensionTargets(piLayer(home)).filter((target) => existsSync(target))
    : [];

  // Oh My Pi is one row in the menu above, not a separate question. Asking again
  // meant picking "Pi" and then being asked about a different agent named "Oh
  // My Pi", whose answer defaulted to removing — which is how the layer came to
  // be deleted for a host that was never selected.
  const removeOmpLayer = selection.ids.includes('omp') && !wantsOmpLayer;
  // Reinstall clears the extension dirs but keeps the plugin package: those are
  // separate decisions, since a reinstall replaces the dirs and re-downloads
  // the package.
  const removeOmpExtensions = removeOmpLayer || options.replaceOmpExtensions === true;

  // Printed from the resolved selection, so every line below is something the
  // run really does. Each host is its own section: a flat path list cannot be
  // checked against a selection.
  if (removeOmpExtensions) {
    // Names only what this run takes: a header that always said "Ponytail"
    // would describe a removal a reinstall does not perform.
    const also = [
      removeOmpLayer && shouldRemovePonytail ? 'Ponytail' : null,
      removeOmpLayer && shouldRemoveRtk ? 'rtk' : null,
    ].filter(Boolean);
    console.log(`  Oh My Pi — ${targets.length} extension director${targets.length === 1 ? 'y' : 'ies'}${also.length > 0 ? `, ${also.join(', ')}` : ''}`);
    for (const target of targets) console.log(`    ${displayPath(target, home)}`);
    // Both of these are printed only when they are on disk. An absent package
    // or binary is not something the run can remove, and naming it made the
    // section read as a bigger removal than the one that follows.
    if (removeOmpLayer && shouldRemovePonytail && existsSync(ponytailPkgDir)) {
      console.log(`    ${displayPath(ponytailPkgDir, home)} — ponytail plugin package`);
    }
    if (removeOmpLayer && shouldRemoveRtk) {
      if (existsSync(rtkBin)) console.log(`    ${displayPath(rtkBin, home)} — rtk binary`);
      if (existsSync(layer.rtkExtension)) console.log(`    ${displayPath(layer.rtkExtension, home)} — rtk OMP wiring`);
    }
  }

  if (piTargets.length > 0) {
    const piRtk = piLayer(home).rtkExtension;
    console.log(`\n  Pi — ${piTargets.length} extension/module director${piTargets.length === 1 ? 'y' : 'ies'}`);
    for (const target of piTargets) console.log(`    ${displayPath(target, home)}`);
    if (existsSync(piRtk)) console.log(`    ${displayPath(piRtk, home)} — rtk Pi wiring`);
  }

  // Only what is still ours is named, per host: a stale plan would overstate
  // what happens, and a host with nothing left is dropped rather than printing
  // an empty section.
  const plan = planRemove(extra, home);
  if (plan.hosts.length > 0) {
    console.log(`\n  Coding agents — ${plan.files} file(s) to remove`);
    for (const preview of plan.hosts) {
      console.log(`    ${preview.host.label} — ${preview.wiring}`);
      for (const line of preview.lines) console.log(`      ${displayPath(line.path, home)}`);
    }
  } else if (extra.length > 0) {
    console.log(`\n  Coding agents — nothing of ours found for ${extra.join(', ')}`);
  }

  // With nothing selected there is nothing to confirm. Asking "remove the
  // listed files?" over an empty plan invited a reflexive Yes to a run that
  // could only ever do nothing. So: say what happened, then stop.
  if (!removeOmpExtensions && plan.files === 0 && piTargets.length === 0) {
    console.log('\n  Nothing selected — no files were removed.');
    if (!confirmed) closeRL();
    return false;
  }

  // Only worth saying when the layer was kept while other agents were cleared.
  if (!removeOmpLayer) {
    console.log('\nKeeping the Oh My Pi (OMP) extensions and Ponytail. Re-run and pick OMP to remove them.');
  }

  if (!confirmed) {
    if (tty()) {
      // Defaults to No, so Enter means "keep everything". A bare `y` says yes
      // outright rather than making the user hunt for the arrow keys.
      const confirmedChoice = await askInteractiveConfirm('Remove the listed Tersio files?', false);
      if (confirmedChoice.status !== 'confirmed') {
        if (confirmedChoice.status === 'cancelled') clackCancel('Aborted.');
        else console.log('Aborted.');
        closeRL();
        return false;
      }
      if (!confirmedChoice.value) {
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

  // The extension dirs go whenever they are being replaced, a reinstall as well
  // as a full removal. Gating them on the prompt answer alone made a "keep"
  // answer print "keeping" and delete them anyway.
  if (removeOmpExtensions) {
    // Extension directories are independent paths, so remove them concurrently.
    await Promise.all(targets.map((t) => removeUninstallTarget(t, shouldDryRun)));
  }

  if (removeOmpExtensions) {
    // Remove Combo and mode-reinforcement registrations; Ponytail only when the
    // package itself goes, since a kept plugin still needs its config entry.
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
        if (shouldDryRun) console.log(`  [dry-run] would remove ${before - lines.length} config.yml entries`);
        else await writeConfigLines(configPath, lines, `  [write] Updated config.yml (removed ${before - lines.length} entries)`);
      }
    }
  }

  // Everything below removes the plugin package or the binaries, which only a
  // full OMP removal does. A reinstall keeps them: it is about to re-download
  // the same package, and deleting it first leaves a failed download with
  // neither the old copy nor the new one.
  if (removeOmpLayer) {
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
      await removeUninstallTarget(layer.rtkExtension, shouldDryRun);
    }
  }

  // Strip tersio's content from every other selected host. This removes only
  // what we wrote: a merged file loses its marked block, a config the user also
  // owns keeps everything but our entry, and a file we named is deleted once it
  // configures no hook.
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

    // Pi's live behavior lives in extension files the generic emitters cannot
    // remove: rtk's own rtk.ts (written by `rtk init -g --agent pi`) and
    // tersio's extension tree. Without these the rewrite and the commands
    // survive the uninstall and Pi keeps rewriting after tersio is gone.
    if (extra.includes('pi')) {
      await removePiRtk(home, { dryRun: shouldDryRun, quiet: false });
      await removePiTersio(home, { dryRun: shouldDryRun, quiet: false });
    }

    // Keep the saved set in step with what is left, so a later install does not
    // resurrect agents the user just cleared. A pick in the menu means remove,
    // so the host drops out of the saved set rather than replacing it — writing
    // the picked set verbatim would uninstall every other saved host next time.
    if (!shouldDryRun && selection.source === 'prompt') {
      writeSelection(home, readSelection(home).hosts.filter((id) => !extra.includes(id)));
    }
  }

  // Not OMP-specific: the run may have cleared nothing but coding agents.
  console.log(removeOmpExtensions
    ? '\nDone. Restart OMP for changes to take effect.'
    : '\nDone — restart your agents to pick up the changes.');
  return true;
}

export { runUninstall };
