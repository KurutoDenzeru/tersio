// cli/doctor.ts — installation health checks.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  BUN_BIN_DIR, OMP_AGENT_DIR, OMP_PLUGINS_DIR, OMP_BIN,
  PACKAGE_NAME, PACKAGE_VERSION, RTK_BINARY_NAME,
  args, dryRun, fix, yes,
  execP, parseJsonObject, relTime,
} from './common.ts';
import { askInteractiveChoice, askInteractiveConfirm, runInteractivePhase } from './interactive.ts';
import { ledgerPath, readUsage, sessionsDir } from '../extensions/shared/usage-ledger.ts';
import { usageDbPath } from '../extensions/shared/usage-store.ts';
import { readRtkGain, rtkDbPath } from '../extensions/shared/rtk-gain.ts';
import { checkForUpdate } from './update.ts';
import { readTextIfExists } from '../extensions/lib/utils.ts';

interface DoctorSummary {
  ok: number;
  warn: number;
  missing: number;
}

async function runDoctor(recheck = false): Promise<DoctorSummary> {
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
  const cavemanIndex = path.join(extDir, 'caveman-session', 'index.ts');
  const cavemanRule = path.join(extDir, 'caveman-session', 'rule.md');
  const rtkIndex = path.join(extDir, 'rtk-session', 'index.ts');
  const updaterIndex = path.join(extDir, 'ai-addons-updater', 'index.ts');
  const comboIndex = path.join(extDir, 'combo-toggle', 'index.ts');
  const tersioIndex = path.join(extDir, 'tersio-commands', 'index.ts');
  const modeReinforcement = path.join(extDir, 'shared', 'mode-reinforcement.ts');
  const selfPkg = path.join(pluginsDir, 'node_modules', PACKAGE_NAME, 'package.json');

  // Independent probes start concurrently; sections report in fixed order as
  // their data settles. Every probe resolves instead of rejecting.
  const probes = {
    ompVersion: execP(OMP_BIN, ['--version']).then((r) => r.stdout.trim(), () => null),
    agentEntries: fs.readdir(agentDir).catch(() => null),
    extEntries: fs.readdir(extDir).catch(() => null),
    sharedStateText: readTextIfExists(path.join(extDir, 'shared', 'session-state.ts')),
    configText: readTextIfExists(configPath),
    ponytailPkgText: readTextIfExists(ponytailPkg),
    ponytailExtText: readTextIfExists(ponytailExt),
    pluginsPkgRaw: readTextIfExists(path.join(pluginsDir, 'package.json')),
    selfPkgText: readTextIfExists(selfPkg),
    rtkBinText: readTextIfExists(rtkBin),
    rtkOmpText: readTextIfExists(path.join(extDir, 'rtk.ts')),
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
  const [[ompVersion, agentEntries, extEntries, sharedStateText, configText, updateVersion], [cavemanIndexText, rtkIndexText, updaterIndexText, comboIndexText, tersioIndexText, modeReinforcementText, ponytailPkgText, ponytailExtText, pluginsPkgRaw, selfPkgText], [cavemanRuleText, ruleMtime, rtkBinText, rtkMtime, rtkVersion, rtkOmpText, ponytailMtime]] = await runInteractivePhase('Checking installation', () => Promise.all([
    Promise.all([
      probes.ompVersion,
      probes.agentEntries,
      probes.extEntries,
      probes.sharedStateText,
      probes.configText,
      probes.updateVersion,
    ]),
    Promise.all([
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
    ]),
    Promise.all([
      probes.cavemanRuleText,
      probes.ruleMtime,
      probes.rtkBinText,
      probes.rtkMtime,
      rtkVersionProbe,
      probes.rtkOmpText,
      probes.ponytailMtime,
    ]),
  ]));

  // Categorized output with a tally; success rows stay quiet (no path echoes)
  // while failures print the expected path or fix so they stay actionable.
  const tally = { ok: 0, missing: 0, warn: 0 };
  function check(label: string, ok: boolean, detail = ''): void {
    if (ok) { tally.ok++; console.log(`  ✅ ${label}: ok${detail ? ` ${detail}` : ''}`); }
    else { tally.missing++; console.log(`  ❌ ${label}: MISSING${detail ? ` ${detail}` : ''}`); }
  }
  function warnLine(label: string, detail: string): void {
    tally.warn++;
    console.log(`  ⚠️ ${label}: warn ${detail}`);
  }

  section('Environment');
  check('Node', true, process.version);
  check('OMP CLI', ompVersion !== null, ompVersion ?? '');
  if (typeof updateVersion === 'string') warnLine('Tersio CLI', `${updateVersion} available — run tersio update`);
  else if (updateVersion === 'unknown') warnLine('Tersio CLI', `${PACKAGE_VERSION} (version check unreachable)`);
  else check('Tersio CLI', true, PACKAGE_VERSION);

  section('Installation');
  check('OMP agent dir', agentEntries !== null, agentEntries === null ? agentDir : '');
  check('OMP extensions dir', extEntries !== null, extEntries === null ? extDir : '');
  check('OMP config.yml', configText !== null, configText === null ? configPath : '');
  check('Shared session bridge', sharedStateText !== null);

  section('Extensions & plugins');
  check('Caveman extension', cavemanIndexText !== null);
  check('RTK extension', rtkIndexText !== null);
  check('Updater extension', updaterIndexText !== null);
  check('Combo extension', comboIndexText !== null);
  check('Tersio commands extension', tersioIndexText !== null);
  check('Mode reinforcement extension', modeReinforcementText !== null);
  check('Ponytail extension', ponytailExtText !== null);
  check('Ponytail in config.yml', (configText ?? '').includes('ponytail') && (configText ?? '').includes('pi-extension'));
  check('Combo in config.yml', (configText ?? '').includes('combo-toggle'));
  check('Self plugin package', selfPkgText !== null, parseJsonObject<{ version?: string }>(selfPkgText)?.version ?? '');
  const selfDep = PACKAGE_NAME in (parseJsonObject<{ dependencies?: Record<string, string> }>(pluginsPkgRaw)?.dependencies || {});
  check('Self plugin in plugins/package.json', selfDep);

  section('Usage & records');
  const usageRows = readUsage();
  check('Usage ledger', true, usageRows.length ? `${usageRows.length} rows` : 'empty — no records yet');
  console.log(`  Usage ledger (tersio-owned, tersio reset clears): ${ledgerPath()} · ${usageRows.length} rows`);
  console.log(`  Session transcripts (host-owned, never touched): ${sessionsDir()}`);
  console.log(`  Usage DB (tersio-owned, tersio reset clears): ${usageDbPath()}`);
  const rtkDb = rtkDbPath();
  const rtk = readRtkGain();
  console.log(`  RTK history (rtk-owned, never touched): ${rtkDb}${rtk.commands ? ` · ${rtk.commands} commands` : ''}`);

  section('Add-ons');
  const ruleAge = ruleMtime ? `updated ${relTime(Date.now() - ruleMtime.mtimeMs)}` : '';
  check('Caveman rule', cavemanRuleText !== null, ruleAge);
  const rtkAge = rtkMtime ? `updated ${relTime(Date.now() - rtkMtime.mtimeMs)}` : '';
  check('RTK binary', rtkBinText !== null, rtkBinText === null ? rtkBin : [rtkVersion, rtkAge].filter(Boolean).join(', '));
  if (rtkBinText !== null && !rtkVersion) warnLine('RTK version', 'unavailable — binary may not be executable');
  const rtkRegistered = rtkOmpText !== null && (configText ?? '').includes('extensions/rtk.ts');
  check('RTK OMP wiring (rtk.ts)', rtkOmpText !== null, rtkOmpText === null ? 'run: rtk init -g --agent omp' : '');
  if (rtkOmpText !== null && !rtkRegistered) warnLine('RTK in config.yml', 'rtk.ts not listed — OMP will not load it; rerun install');
  const ponytailAge = ponytailMtime ? `updated ${relTime(Date.now() - ponytailMtime.mtimeMs)}` : '';
  check('Ponytail', ponytailPkgText !== null, [parseJsonObject<{ version?: string }>(ponytailPkgText)?.version ?? '', ponytailAge].filter(Boolean).join(', '));

  const total = tally.ok + tally.missing + tally.warn;
  console.log(`\n  Summary: ${total} checks — ✅ ${tally.ok} ok, ⚠️ ${tally.warn} warn, ❌ ${tally.missing} missing`);

  if (!recheck && tally.missing + tally.warn > 0 && (fix || dryRun)) {
    await runDoctorFix(tally);
  } else if (!recheck && tally.missing + tally.warn > 0) {
    console.log('\n  Run `tersio doctor --fix` to repair the rows above.');
  }
  return tally;
}

type FixTarget = 'extensions' | 'registrations' | 'rtk' | 'ponytail' | 'cli';
type FixRequest = FixTarget | 'all';

function fixScope(): FixTarget | null {
  const eq = args.find((a) => a.startsWith('--fix='));
  if (eq !== undefined) {
    const raw = eq.slice('--fix='.length).trim().toLowerCase();
    if (raw === '') return null;
    return checkFixScope(raw);
  }
  const i = args.indexOf('--fix');
  if (i === -1) return null;
  const next = args[i + 1];
  if (next === undefined || next.startsWith('-')) return null;
  return checkFixScope(next.trim().toLowerCase());
}

function checkFixScope(raw: string): FixTarget {
  const valid: FixTarget[] = ['extensions', 'registrations', 'rtk', 'ponytail', 'cli'];
  if (!valid.includes(raw as FixTarget)) {
    console.error(`[fail] Invalid --fix scope: ${raw}. Valid: ${valid.join(', ')}`);
    process.exit(1);
  }
  return raw as FixTarget;
}

async function runDoctorFix(tally: DoctorSummary): Promise<void> {
  const problems: string[] = [];
  if (tally.missing > 0) problems.push(`${tally.missing} missing`);
  if (tally.warn > 0) problems.push(`${tally.warn} warn`);
  if (dryRun) {
    console.log(`\n  [dry-run] would repair ${problems.join(' + ')} (extensions, config.yml registrations, rtk wiring, ponytail refresh, CLI update)`);
    return;
  }
  const scoped = fixScope();
  let targets: FixRequest[];
  if (scoped) {
    targets = [scoped];
    if (!yes) {
      const go = await askInteractiveConfirm(`Repair "${scoped}" now?`);
      if (go.status !== 'confirmed' || !go.value) { process.exitCode = 130; return; }
    }
  } else if (yes) {
    targets = ['all'];
  } else {
    const picked = await askInteractiveChoice('Doctor — what should I repair?', [
      { value: 'all', label: 'Fix everything', hint: `${tally.missing + tally.warn} rows` },
      { value: 'extensions', label: 'Missing extension files', hint: 'copy sources from this CLI' },
      { value: 'registrations', label: 'config.yml registrations', hint: 'combo, ponytail, rtk.ts entries' },
      { value: 'rtk', label: 'RTK binary + wiring', hint: 'download checksum-verified binary, rtk init' },
      { value: 'ponytail', label: 'Ponytail package', hint: 'bundled reinstall via tersio dep' },
      { value: 'cli', label: 'CLI update', hint: 'latest tersio + delegated refresh' },
    ], 'all');
    if (picked.status !== 'selected') { process.exitCode = 130; return; }
    if (picked.value === 'all') targets = ['all'];
    else {
      const go = await askInteractiveConfirm(`Repair "${picked.value}" now?`);
      if (go.status !== 'confirmed' || !go.value) { process.exitCode = 130; return; }
      targets = [picked.value as FixTarget];
    }
  }
  const { runDoctorRepairs } = await import('./doctor-fix.ts');
  const failed = await runDoctorRepairs(targets);
  if (failed.length > 0) {
    console.log(`\n  Doctor --fix: ${failed.length} repair(s) failed (${failed.join(', ')}) — rerun or see [fail] lines above.`);
    process.exitCode = 1;
    return;
  }
  if (targets.includes('cli')) {
    console.log('\n  Doctor --fix: CLI refresh delegated — rerun `tersio doctor` after it lands.');
    return;
  }
  console.log('\n  Doctor --fix: repairs done — rechecking.');
  const again = await runDoctor(true);
  if (again.missing + again.warn === 0) console.log('  Doctor --fix: all checks pass. Restart OMP.');
  else console.log(`  Doctor --fix: still ${again.missing} missing + ${again.warn} warn — rerun or repair manually.`);
}

function section(name: string): void {
  console.log(`\n${name}`);
}
export { runDoctor };
