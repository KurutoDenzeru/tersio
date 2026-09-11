// cli/doctor.ts — installation health checks.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  BUN_BIN_DIR, HOME, OMP_AGENT_DIR, OMP_PLUGINS_DIR, OMP_BIN,
  PACKAGE_NAME, PACKAGE_VERSION, RTK_BINARY_NAME,
  execP, parseJsonObject, relTime,
} from './common.ts';
import { runInteractivePhase } from './interactive.ts';
import { ledgerPath, readUsage } from '../extensions/shared/usage-ledger.ts';
import { checkForUpdate } from './update.ts';
import { readTextIfExists } from '../extensions/lib/utils.ts';

async function runDoctor(): Promise<void> {
  console.log('\n=== Tersio Doctor ===');

  // Directories
  const agentDir = OMP_AGENT_DIR;
  const extDir = path.join(agentDir, 'extensions');
  const configPath = path.join(agentDir, 'config.yml');
  const pluginsDir = OMP_PLUGINS_DIR;
  const rtkBin = path.join(BUN_BIN_DIR, RTK_BINARY_NAME);

  // Ponytail
  const ponytailPkg = path.join(pluginsDir, 'node_modules', '@dietrichgebert', 'ponytail', 'package.json');
  const ponytailExt = path.join(pluginsDir, 'node_modules', '@dietrichgebert', 'ponytail', 'pi-extension', 'index.js');
  const cavemanIndex = path.join(extDir, 'caveman-session', 'index.js');
  const cavemanRule = path.join(extDir, 'caveman-session', 'rule.md');
  const rtkIndex = path.join(extDir, 'rtk-session', 'index.js');
  const updaterIndex = path.join(extDir, 'ai-addons-updater', 'index.js');
  const comboIndex = path.join(extDir, 'combo-toggle', 'index.js');
  const tersioIndex = path.join(extDir, 'tersio-commands', 'index.js');
  const modeReinforcement = path.join(extDir, 'shared', 'mode-reinforcement.js');
  const selfPkg = path.join(pluginsDir, 'node_modules', PACKAGE_NAME, 'package.json');

  // Independent probes start concurrently; sections report in fixed order as
  // their data settles. Every probe resolves instead of rejecting.
  const probes = {
    ompVersion: execP(OMP_BIN, ['--version']).then((r) => r.stdout.trim(), () => null),
    agentEntries: fs.readdir(agentDir).catch(() => null),
    extEntries: fs.readdir(extDir).catch(() => null),
    sharedStateText: readTextIfExists(path.join(extDir, 'shared', 'session-state.js')),
    configText: readTextIfExists(configPath),
    ponytailPkgText: readTextIfExists(ponytailPkg),
    ponytailExtText: readTextIfExists(ponytailExt),
    pluginsPkgRaw: readTextIfExists(path.join(pluginsDir, 'package.json')),
    selfPkgText: readTextIfExists(selfPkg),
    rtkBinText: readTextIfExists(rtkBin),
    cavemanIndexText: readTextIfExists(cavemanIndex),
    cavemanRuleText: readTextIfExists(cavemanRule),
    rtkIndexText: readTextIfExists(rtkIndex),
    updaterIndexText: readTextIfExists(updaterIndex),
    comboIndexText: readTextIfExists(comboIndex),
    tersioIndexText: readTextIfExists(tersioIndex),
    modeReinforcementText: readTextIfExists(modeReinforcement),
    ruleMtime: fs.stat(cavemanRule).catch(() => null),
    rtkMtime: fs.stat(rtkBin).catch(() => null),
    ponytailMtime: fs.stat(ponytailPkg).catch(() => null),
    updateVersion: checkForUpdate(),
  };
  const rtkVersionProbe: Promise<string | null> = probes.rtkBinText.then((text) => text === null ? null : execP(rtkBin, ['--version'], { timeout: 5000 }).then(
    (r) => r.stdout.trim() || r.stderr.trim() || null,
    (e) => {
      const err = e as { stdout?: string; stderr?: string };
      return err.stdout?.trim() || err.stderr?.trim() || null;
    },
  ));
  const [ompVersion, agentEntries, extEntries, sharedStateText, configText, updateVersion] = await runInteractivePhase('Checking environment and installation', () => Promise.all([
    probes.ompVersion,
    probes.agentEntries,
    probes.extEntries,
    probes.sharedStateText,
    probes.configText,
    probes.updateVersion,
  ]));
  const [cavemanIndexText, rtkIndexText, updaterIndexText, comboIndexText, tersioIndexText, modeReinforcementText, ponytailPkgText, ponytailExtText, pluginsPkgRaw, selfPkgText] = await runInteractivePhase('Checking extensions and plugins', () => Promise.all([
    probes.cavemanIndexText,
    probes.rtkIndexText,
    probes.updaterIndexText,
    probes.comboIndexText,
    probes.tersioIndexText,
    probes.modeReinforcementText,
    probes.ponytailPkgText,
    probes.ponytailExtText,
    probes.pluginsPkgRaw,
    probes.selfPkgText,
  ]));
  const [cavemanRuleText, ruleMtime, rtkBinText, rtkMtime, rtkVersion, ponytailMtime] = await runInteractivePhase('Checking add-ons', () => Promise.all([
    probes.cavemanRuleText,
    probes.ruleMtime,
    probes.rtkBinText,
    probes.rtkMtime,
    rtkVersionProbe,
    probes.ponytailMtime,
  ]));

  // Categorized output with a tally; section headers group related probes.
  const tally = { ok: 0, missing: 0, warn: 0 };
  function check(label: string, ok: boolean, detail = ''): void {
    if (ok) { tally.ok++; console.log(`  ${label}: ok${detail ? ` ${detail}` : ''}`); }
    else { tally.missing++; console.log(`  ${label}: MISSING${detail ? ` ${detail}` : ''}`); }
  }
  function warnLine(label: string, detail: string): void {
    tally.warn++;
    console.log(`  ${label}: warn ${detail}`);
  }

  section('Environment');
  check('Node', true, process.version);
  check('OMP CLI', ompVersion !== null, ompVersion ?? '');
  if (updateVersion) warnLine('Tersio CLI', `${updateVersion} available — run tersio update`);
  else check('Tersio CLI', true, PACKAGE_VERSION);
  console.log(`  Home: ${HOME}`);

  section('Installation');
  check('OMP agent dir', agentEntries !== null, agentDir);
  check('OMP extensions dir', extEntries !== null, extDir);
  check('OMP config.yml', configText !== null, configPath);
  check('Shared session bridge', sharedStateText !== null);

  section('Extensions');
  check('Caveman extension', cavemanIndexText !== null);
  check('RTK extension', rtkIndexText !== null);
  check('Updater extension', updaterIndexText !== null);
  check('Combo extension', comboIndexText !== null);
  check('Tersio commands extension', tersioIndexText !== null);
  check('Mode reinforcement extension', modeReinforcementText !== null);

  section('Plugins');
  check('Ponytail package', ponytailPkgText !== null);
  check('Ponytail extension', ponytailExtText !== null);
  if (configText) {
    check('Ponytail in config.yml', configText.includes('ponytail') && configText.includes('pi-extension'));
    check('Combo in config.yml', configText.includes('combo-toggle'));
  }
  check('Self plugin package', selfPkgText !== null, parseJsonObject<{ version?: string }>(selfPkgText)?.version ?? '');
  const selfDep = PACKAGE_NAME in (parseJsonObject<{ dependencies?: Record<string, string> }>(pluginsPkgRaw)?.dependencies || {});
  check('Self plugin in plugins/package.json', selfDep);

  section('Usage');
  const usageRows = readUsage();
  check('Usage ledger', usageRows.length > 0, usageRows.length ? `${usageRows.length} rows · ${ledgerPath()}` : ledgerPath());

  section('Add-ons');
  const ruleAge = ruleMtime ? `updated ${relTime(Date.now() - ruleMtime.mtimeMs)}` : '';
  check('Caveman rule', cavemanRuleText !== null, ruleAge);
  const rtkAge = rtkMtime ? `updated ${relTime(Date.now() - rtkMtime.mtimeMs)}` : '';
  if (rtkBinText === null) check('RTK binary', false, rtkBin);
  else {
    const bits = [rtkVersion, rtkAge].filter(Boolean).join(', ');
    check('RTK binary', true, bits);
    if (!rtkVersion) warnLine('RTK version', 'unavailable — binary may not be executable');
  }
  const ponytailAge = ponytailMtime ? `updated ${relTime(Date.now() - ponytailMtime.mtimeMs)}` : '';
  check('Ponytail', ponytailPkgText !== null, [parseJsonObject<{ version?: string }>(ponytailPkgText)?.version ?? '', ponytailAge].filter(Boolean).join(', '));

  const total = tally.ok + tally.missing + tally.warn;
  console.log(`\n  Summary: ${total} checks — ${tally.ok} ok, ${tally.warn} warn, ${tally.missing} missing`);
}

function section(name: string): void {
  console.log(`\n${name}`);
}
export { runDoctor };
