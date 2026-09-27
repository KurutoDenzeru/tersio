// cli/doctor.ts — installation health checks.
import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  OMP_AGENT_DIR, OMP_PLUGINS_DIR,
  agentFlag, args, dryRun, fix, yes,
  execP, parseJsonObject, relTime,
} from './common.ts';
import { askInteractiveChoice, askInteractiveConfirm, runInteractivePhase } from './interactive.ts';
import { usageDbPath } from '../extensions/shared/usage-store.ts';
import { pricesCachePath } from '../extensions/shared/pricing.ts';
import { readTextIfExists, resolveRtkBinary } from '../extensions/lib/utils.ts';
import { detectHosts, readSelection, reportHosts, resolveAgentSelection } from './agents.ts';
import { HOSTS } from './agent-hosts.ts';
import { reportOmpLayer } from './omp-layer.ts';
import { reportPiLayer } from './pi-layer.ts';

interface DoctorSummary {
  ok: number;
  warn: number;
  missing: number;
}

async function runDoctor(recheck = false): Promise<DoctorSummary> {
  console.log('\n=== Tersio Doctor ===');

  // Directories
  const agentDir = OMP_AGENT_DIR;
  const configPath = path.join(agentDir, 'config.yml');
  const pluginsDir = OMP_PLUGINS_DIR;
  const rtkBin = resolveRtkBinary();

  // Ponytail
  const ponytailPkg = path.join(pluginsDir, 'node_modules', '@dietrichgebert', 'ponytail', 'package.json');
  const ponytailExt = path.join(pluginsDir, 'node_modules', '@dietrichgebert', 'ponytail', 'pi-extension', 'index.js');
  const tersioPluginDir = path.join(pluginsDir, 'node_modules', '@krtclcdy', 'tersio');
  const cavemanIndex = path.join(tersioPluginDir, 'extensions', 'caveman-session', 'index.ts');
  const cavemanRule = path.join(tersioPluginDir, 'extensions', 'caveman-session', 'rule.md');
  const rtkIndex = path.join(tersioPluginDir, 'extensions', 'rtk-session', 'index.ts');
  const updaterIndex = path.join(tersioPluginDir, 'extensions', 'ai-addons-updater', 'index.ts');

  // Independent probes start concurrently; sections report in fixed order as
  // their data settles. Every probe resolves instead of rejecting.
  const probes = {
    configText: readTextIfExists(configPath),
    ponytailPkgText: readTextIfExists(ponytailPkg),
    ponytailExtText: readTextIfExists(ponytailExt),
    rtkBinText: rtkBin ? readTextIfExists(rtkBin) : Promise.resolve(null),
    cavemanIndexText: readTextIfExists(cavemanIndex),
    cavemanRuleText: readTextIfExists(cavemanRule),
    rtkIndexText: readTextIfExists(rtkIndex),
    updaterIndexText: readTextIfExists(updaterIndex),
    rtkMtime: rtkBin ? fs.stat(rtkBin).catch(() => null) : Promise.resolve(null),
    ruleMtime: fs.stat(cavemanRule).catch(() => null),
    ponytailMtime: fs.stat(ponytailPkg).catch(() => null),
    pricesMtime: fs.stat(pricesCachePath()).catch(() => null),
  };
  const rtkVersionProbe: Promise<string | null> = rtkBin ? execP(rtkBin, ['--version'], { timeout: 5000 }).then(
    (r) => r.stdout.trim() || r.stderr.trim() || null,
    (e) => {
      const err = e as { stdout?: string; stderr?: string };
      return err.stdout?.trim() || err.stderr?.trim() || null;
    },
  ) : Promise.resolve(null);
  const [[configText], [cavemanIndexText, rtkIndexText, updaterIndexText, ponytailPkgText, ponytailExtText], [cavemanRuleText, ruleMtime, rtkBinText, rtkMtime, rtkVersion, ponytailMtime, pricesMtime]] = await runInteractivePhase('Checking installation', () => Promise.all([
    Promise.all([
      probes.configText,
    ]),
    Promise.all([
      probes.cavemanIndexText,
      probes.rtkIndexText,
      probes.updaterIndexText,
      probes.ponytailPkgText,
      probes.ponytailExtText,
    ]),
    Promise.all([
      probes.cavemanRuleText,
      probes.ruleMtime,
      probes.rtkBinText,
      probes.rtkMtime,
      rtkVersionProbe,
      probes.ponytailMtime,
      probes.pricesMtime,
    ]),
  ]));

  // Categorized output with a tally; success rows stay quiet (no path echoes)
  // while failures print the expected path or fix so they stay actionable.
  const tally = { ok: 0, missing: 0, warn: 0 };
  function absDate(ms: number): string {
    const d = new Date(ms);
    const q = (n: number): string => String(n).padStart(2, '0');
    const h24 = d.getHours();
    return `${q(d.getMonth() + 1)}-${q(d.getDate())}-${d.getFullYear()}, ${q(h24 % 12 || 12)}:${q(d.getMinutes())} ${h24 >= 12 ? 'PM' : 'AM'}`;
  }
  function check(label: string, ok: boolean, detail = ''): void {
    if (ok) { tally.ok++; console.log(`  ✅ ${label}: ok${detail ? ` ${detail}` : ''}`); }
    else { tally.missing++; console.log(`  ❌ ${label}: MISSING${detail ? ` ${detail}` : ''}`); }
  }
  function warnLine(label: string, detail: string): void {
    tally.warn++;
    console.log(`  ⚠️ ${label}: warn ${detail}`);
  }

  // Agent hosts lead the report: they are what the product is for, and the OMP
  // sections below are supporting detail for one host of several. Always
  // printed, so a user who has not configured any yet is told how, instead of
  // the section silently not existing. Each row reports the rewrite path the
  // host actually got, because "wired" and "wired to a hook the host ignores"
  // look identical from the outside.
  const home = os.homedir();
  // No `ask`: doctor reports, it never prompts, but it shares the same
  // resolution so it cannot describe a different host set than install acts on.
  const selection = await resolveAgentSelection({
    flag: agentFlag,
    stored: readSelection(home).hosts,
    detected: detectHosts(home),
  });
  const otherHosts = selection.ids.filter((id) => id !== 'omp');
  section('Agent hosts');
  if (otherHosts.length === 0) {
    // Derived from the registry so dropping a host cannot leave a stale id
    // advertised here.
    console.log('  ℹ️  none configured — `tersio install --agent <id>` adds one');
    console.log(`      known ids: ${HOSTS.map((h) => h.id).join(', ')}`);
  } else {
    for (const row of reportHosts(otherHosts, home)) {
      const label = row.host.label;
      if (row.status === 'warn') {
        const first = row.missing[0] ? ` (${row.missing[0]})` : '';
        warnLine(label, `${row.missing.length} file(s) missing${first} — run: tersio install --agent ${row.host.id}`);
      } else {
        check(label, true, row.detail.replace(`${label}: `, ''));
      }
    }
  }

  // OMP belongs in the host list, not in a section of its own: it is one host
  // among several, and its artifacts are extension directories rather than
  // files. The row appears only when the plugin is actually installed, so a
  // machine that never had the Oh My Pi layer is not told it is missing.
  const ompReport = reportOmpLayer(home, existsSync);
  if (ompReport.installed) {
    const ompLabel = 'Oh My Pi (OMP)';
    const extCount = ompReport.extensions.length;
    if (ompReport.missing.length === 0) {
      check(ompLabel, true, `plugin + ${extCount} extension director${extCount === 1 ? 'y' : 'ies'}`);
    } else {
      warnLine(ompLabel, `${ompReport.missing.length} extension dir(s) missing — run: tersio install --agent omp`);
    }
  }

  // Pi's extension layer, same shape as OMP's: a row appears only when the
  // tree is actually on disk, so a machine that never installed it is not
  // told it is missing.
  const piReport = reportPiLayer(home, existsSync);
  if (piReport.installed) {
    const piLabel = 'Pi extension layer';
    const present = piReport.extensions.length;
    if (piReport.missing.length === 0) {
      check(piLabel, true, `${present} extension/module director${present === 1 ? 'y' : 'ies'}`);
    } else {
      warnLine(piLabel, `${piReport.missing.length} extension dir(s) missing — run: tersio install --agent pi`);
    }
  }



  section('Extensions & plugins');
  const explicitEntries = (configText ?? '').split('\n')
    .map((line) => line.trim().replace(/^-\s*/, '').replace(/^['"]|['"]$/g, ''))
    .filter((line) => line.startsWith('/') || line.startsWith('.'));
  const duplicateExtensions = [...new Set(explicitEntries.filter((entry, index) => explicitEntries.indexOf(entry) !== index))];
  const retiredReinforcement = explicitEntries.filter((entry) => entry.endsWith('/shared/mode-reinforcement.ts')).length;
  check('Unique config registrations', duplicateExtensions.length === 0, duplicateExtensions.join(', '));
  if (retiredReinforcement === 0) check('No retired reinforcement', true);
  else warnLine('Retired reinforcement registration', `${retiredReinforcement} found; run doctor --fix registrations`);
  check('Caveman extension', cavemanIndexText !== null);
  check('RTK extension', rtkIndexText !== null);
  check('Updater extension', updaterIndexText !== null);
  check('Ponytail extension', ponytailExtText !== null);

  section('Usage & records');
  console.log(`  Usage DB (tersio-owned · local hosted): ${usageDbPath()}`);
  const pricesAge = pricesMtime ? `(pulled ${relTime(Date.now() - pricesMtime.mtimeMs)} · ${absDate(pricesMtime.mtimeMs)})` : '';
  check('Prices feed', pricesMtime !== null, pricesAge || pricesCachePath());

  section('Add-ons');
  const ruleAge = ruleMtime ? `(updated ${relTime(Date.now() - ruleMtime.mtimeMs)} · ${absDate(ruleMtime.mtimeMs)})` : '';
  check('Caveman rule', cavemanRuleText !== null, ruleAge);
  const rtkAge = rtkMtime ? `(updated ${relTime(Date.now() - rtkMtime.mtimeMs)} · ${absDate(rtkMtime.mtimeMs)})` : '';
  check('RTK binary', rtkBin !== null, rtkBinText === null ? 'not found in PATH' : [rtkVersion, rtkAge].filter(Boolean).join(' '));
  if (rtkBinText !== null && !rtkVersion) warnLine('RTK version', 'unavailable — binary may not be executable');
  const ponytailAge = ponytailMtime ? `(updated ${relTime(Date.now() - ponytailMtime.mtimeMs)} · ${absDate(ponytailMtime.mtimeMs)})` : '';
  const ponytailVer = parseJsonObject<{ version?: string }>(ponytailPkgText)?.version ?? '';
  check('Ponytail', ponytailPkgText !== null, [ponytailVer, ponytailAge].filter(Boolean).join(' '));

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
    console.log(`\n  [dry-run] would repair ${problems.join(' + ')} (extensions, stale config.yml entries, rtk wiring, ponytail refresh, CLI update)`);
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
      { value: 'registrations', label: 'config.yml registrations', hint: 'remove stale entries; keep manifest-owned extensions out' },
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
