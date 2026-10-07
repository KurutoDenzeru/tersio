// cli/doctor.ts — installation health checks.
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import {
  HOME, OMP_AGENT_DIR, OMP_PLUGINS_DIR, PACKAGE_NAME, PACKAGE_VERSION,
  args, dryRun, fix, yes,
  execP, parseJsonObject, relTime,
} from './common.ts';
import { detectHosts, hostExtensionsDir, ompPackageDir, piTersioSource } from './hosts.ts';
import { askInteractiveChoice, askInteractiveConfirm, runInteractivePhase } from './interactive.ts';
import { usageDbPath } from '../extensions/shared/usage-store.ts';
import { pricesCachePath } from '../extensions/shared/pricing.ts';
import { readTextIfExists, resolveRtkBinary, ruleBodyProblem } from '../extensions/lib/utils.ts';
import { TREE_FILES } from './manifest.ts';

interface DoctorSummary {
  ok: number;
  warn: number;
  missing: number;
}

async function runDoctor(recheck = false): Promise<DoctorSummary> {
  console.log('\n=== Tersio Doctor ===');

  // OMP loads the plugin from its plugins dir; pi loads the same package as a pi package, which its own settings.json declares and its npm dir holds.
  const pluginsDir = OMP_PLUGINS_DIR;
  const rtkBin = resolveRtkBinary();

  // Ponytail
  const ponytailPkg = path.join(pluginsDir, 'node_modules', '@dietrichgebert', 'ponytail', 'package.json');
  const tersioPluginDir = path.join(pluginsDir, 'node_modules', '@krtclcdy', 'tersio');
  const cavemanIndex = path.join(tersioPluginDir, 'extensions', 'caveman-session', 'index.ts');
  const cavemanRule = (name: string) => path.join(tersioPluginDir, 'extensions', 'caveman-session', name);
  const rtkIndex = path.join(tersioPluginDir, 'extensions', 'rtk-session', 'index.ts');
  const updaterIndex = path.join(tersioPluginDir, 'extensions', 'ai-addons-updater', 'index.ts');

  // Independent probes start concurrently; sections report in fixed order as their data settles. Every probe resolves instead of rejecting.
  const hosts = detectHosts();
  const probes = {
    ompPkgText: readTextIfExists(path.join(ompPackageDir(), 'package.json')),
    configText: readTextIfExists(path.join(OMP_AGENT_DIR, 'config.yml')),
    ponytailPkgText: readTextIfExists(ponytailPkg),
    rtkBinText: rtkBin ? readTextIfExists(rtkBin) : Promise.resolve(null),
    cavemanIndexText: readTextIfExists(cavemanIndex),
    cavemanRuleText: readTextIfExists(cavemanRule('rule.md')),
    cavemanUltraText: readTextIfExists(cavemanRule('rule-ultra.md')),
    cavemanMegacaveText: readTextIfExists(cavemanRule('rule-megacave.md')),
    rtkIndexText: readTextIfExists(rtkIndex),
    updaterIndexText: readTextIfExists(updaterIndex),
    rtkMtime: rtkBin ? fs.stat(rtkBin).catch(() => null) : Promise.resolve(null),
    ruleMtime: fs.stat(cavemanRule('rule.md')).catch(() => null),
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
  const [[ompPkgText, configText], [cavemanIndexText, rtkIndexText, updaterIndexText, ponytailPkgText], [cavemanRuleText, cavemanUltraText, cavemanMegacaveText, ruleMtime, rtkBinText, rtkMtime, rtkVersion, ponytailMtime, pricesMtime]] = await runInteractivePhase('Checking installation', () => Promise.all([
    Promise.all([
      probes.ompPkgText,
      probes.configText,
    ]),
    Promise.all([
      probes.cavemanIndexText,
      probes.rtkIndexText,
      probes.updaterIndexText,
      probes.ponytailPkgText,
    ]),
    Promise.all([
      probes.cavemanRuleText,
      probes.cavemanUltraText,
      probes.cavemanMegacaveText,
      probes.ruleMtime,
      probes.rtkBinText,
      probes.rtkMtime,
      rtkVersionProbe,
      probes.ponytailMtime,
      probes.pricesMtime,
    ]),
  ]));

  // Categorized output with a tally; success rows stay quiet (no path echoes) while failures print the expected path or fix so they stay actionable.
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
  // A host you do not use is not a fault, so it stays out of the tally and only carries the one line that installs it.
  function unused(label: string, detail: string): void {
    console.log(`  —  ${label}: not installed ${detail}`);
  }

  section('Hosts');
  for (const host of hosts) {
    // pi can hold a working tree while reading as not installed; use the tree as ground truth.
    const piTree = (host.id === 'pi' && !host.installed && existsSync(hostExtensionsDir('pi')))
      ? hostExtensionsDir('pi')
      : null;
    if (piTree !== null) {
      check(host.label, true, `extensions ${PACKAGE_NAME} ${PACKAGE_VERSION}`);
      continue;
    }
    if (!host.installed) {
      // A pi declaration without the tree or the package is a broken install, so it stays a counted row rather than reading as "not installed".
      if (host.declared) check(host.label, false, `declared (${host.declared}) but not installed`);
      else unused(host.label, `· ${host.installCmd}`);
      continue;
    }
    // One line per host, omp style: kind and version, no path echo.
    const kind = host.via === 'tree' ? 'extensions' : 'package';
    check(host.label, true, `${kind} ${PACKAGE_NAME}${host.version ? ` ${host.version}` : ''}`);
  }

  section('Extensions & plugins');

  if (hosts.find((host) => host.id === 'omp')?.via === 'package') {
    const explicitEntries = (configText ?? '').split('\n')
      .map((line) => line.trim().replace(/^-\s*/, '').replace(/^['"]|['"]$/g, ''))
      .filter((line) => line.startsWith('/') || line.startsWith('.'));
    const duplicateExtensions = [...new Set(explicitEntries.filter((entry, index) => explicitEntries.indexOf(entry) !== index))];
    check('Unique config registrations', duplicateExtensions.length === 0, duplicateExtensions.length ? duplicateExtensions.join(', ') : '');
    // A half-written tree imports a module that is absent; OMP then drops the extension.
    const extDir = path.join(tersioPluginDir, 'extensions');
    const missing = TREE_FILES.filter((file) => !existsSync(path.join(extDir, ...file.split('/'))));
    check('Extension tree', missing.length === 0, missing.length === 0
      ? `${TREE_FILES.length} files ok`
      : `${missing.length} of ${TREE_FILES.length} missing: ${missing.join(', ')}`);
  }
  section('Usage & records');
  console.log(`  Usage DB (tersio-owned · local hosted): ${usageDbPath()}`);
  const pricesAge = pricesMtime ? `(pulled ${relTime(Date.now() - pricesMtime.mtimeMs)} · ${absDate(pricesMtime.mtimeMs)})` : '';
  check('Prices feed', pricesMtime !== null, pricesAge || pricesCachePath());

  section('Add-ons');
  const ruleAge = ruleMtime ? `(updated ${relTime(Date.now() - ruleMtime.mtimeMs)} · ${absDate(ruleMtime.mtimeMs)})` : '';
  const cavemanRules = [['rule.md', cavemanRuleText], ['rule-ultra.md', cavemanUltraText], ['rule-megacave.md', cavemanMegacaveText]];
  const missingRules = cavemanRules.filter(([, text]) => text === null).map(([name]) => name);
  check('Caveman rule', missingRules.length === 0, missingRules.length ? `missing: ${missingRules.join(', ')}` : ruleAge);
  for (const [name, text] of cavemanRules) {
    if (text === null) continue;
    const problem = ruleBodyProblem(text);
    if (problem) warnLine(`Caveman ${name}`, `unusable body (${problem}) — run: tersio install`);
  }
  const rtkAge = rtkMtime ? `(updated ${relTime(Date.now() - rtkMtime.mtimeMs)} · ${absDate(rtkMtime.mtimeMs)})` : '';
  check('RTK binary', rtkBin !== null, rtkBinText === null ? 'not found in PATH' : [rtkVersion, rtkAge].filter(Boolean).join(' '));
  // rtk_run needs a host exec API, which doctor cannot assume.
  if (rtkBin === null) unused('RTK exec', '· install Tersio to place rtk in ~/.bun/bin');
  else if (!hosts.some((host) => host.installed && (host.id === 'omp' || host.id === 'opencode'))) warnLine('RTK exec', 'no installed host exposes an exec API — rtk_run is unavailable; call rtk from bash instead');
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
