// cli/doctor.ts — installation health checks.
import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  OMP_AGENT_DIR, OMP_PLUGINS_DIR, RTK_BINARY_NAME,
  agentFlag, args, dryRun, fix, yes,
  execP, parseJsonObject, relTime,
} from './common.ts';
import { askInteractiveChoice, askInteractiveConfirm, runInteractivePhase } from './interactive.ts';
import { usageDbPath } from '../extensions/shared/usage-store.ts';
import { pricesCachePath } from '../extensions/shared/pricing.ts';
import { readTextIfExists, resolveRtkBinary } from '../extensions/lib/utils.ts';
import { displayPath, findHostBinary, installedHostIds, installedState, readSelection, reportHosts } from './agents.ts';
import { HOSTS, byId } from './agent-hosts.ts';
import { reportOmpLayer, ompLayer } from './omp-layer.ts';
import { reportPiLayer, piLayer } from './pi-layer.ts';

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
  // A row follows what the user has, not what the machine could have. A host
  // whose config dir merely exists is *detected*, not installed, and four
  // "warn 6 file(s) missing — run: tersio install" rows for agents that were
  // never used is noise that buries the two rows that matter. Installed or
  // saved is the bar, and the saved half is what keeps "I installed this and it
  // went missing" visible. An explicit `--agent` still wins outright, as it
  // does everywhere else. OMP and the Pi layer below already worked this way.
  const wanted = agentFlag.length > 0
    ? new Set(agentFlag)
    : new Set([...installedHostIds(installedState(home)), ...readSelection(home).hosts]);
  // Every host in scope reports through the same row, omp and pi included:
  // each names the files it needs, its version and its path, and the two
  // extension hosts add a layer line below. omp used to be excluded here
  // because it had no static files to report, which is what left it the
  // only host whose artifacts the report never enumerated.
  const hostIds = HOSTS.filter((h) => wanted.has(h.id)).map((h) => h.id);
  section('Agent hosts');
  if (hostIds.length === 0) {
    // Derived from the registry so dropping a host cannot leave a stale id
    // advertised here.
    console.log('  ℹ️  none installed — `tersio install --agent <id>` adds one');
  } else {
    // Every host row names what was found and where, so a row is checkable
    // rather than just a verdict. The binary is the useful path when there is
    // one; a host set up with no CLI on PATH — Codex on a machine that only has
    // the desktop app — falls back to its config dir, which is still real.
    interface HostProbe { bin: string | null; version: string | null }
    const probes = new Map<string, HostProbe>(await Promise.all(hostIds.map(async (id): Promise<[string, HostProbe]> => {
      const host = byId(id);
      const bin = host ? findHostBinary(host) : null;
      if (!bin) return [id, { bin: null, version: null }];
      const out = await execP(bin, ['--version'], { timeout: 5000 }).then((r) => r.stdout.trim() || null, () => null);
      return [id, { bin, version: out }];
    })));
    for (const row of reportHosts(hostIds, home)) {
      const label = row.host.label;
      const probe = probes.get(row.host.id);
      const where = probe?.bin ?? displayPath(path.join(home, row.host.configDir), home);
      const who = probe?.version ? `${probe.version} ` : '';
      if (row.status === 'warn') {
        const first = row.missing[0] ? ` (${row.missing[0]})` : '';
        warnLine(label, `${who}${row.missing.length} file(s) missing${first} · ${where} — run: tersio install --agent ${row.host.id}`);
      } else {
        check(label, true, `${who}${row.detail.replace(`${label}: `, '')} · ${where}`);
      }
    }
  }
  // The hosts this report says nothing about, in one line. Omitting the rows
  // must not also omit the discovery: the id is all anyone needs to add one.
  const notInstalled = HOSTS.filter((h) => h.id !== 'omp' && !wanted.has(h.id)).map((h) => h.id);
  if (notInstalled.length > 0) {
    console.log(`  ℹ️  not installed: ${notInstalled.join(', ')} — \`tersio install --agent <id>\``);
  }

  // OMP belongs in the host list, not in a section of its own: it is one host
  // among several, and its artifacts are extension directories rather than
  // files. The row appears only when the plugin is actually installed, so a
  // machine that never had the Oh My Pi layer is not told it is missing.
  const ompReport = reportOmpLayer(home, existsSync);
  if (ompReport.installed) {
    const ompLabel = 'Oh My Pi (OMP)';
    const extCount = ompReport.extensions.length;
    // The layer row names where those directories are, the same way the host
    // rows above do: the path is what makes the row checkable.
    const where = displayPath(ompLayer(home, RTK_BINARY_NAME).extDir, home);
    if (ompReport.missing.length === 0) {
      check(ompLabel, true, `plugin + ${extCount} extension director${extCount === 1 ? 'y' : 'ies'} · ${where}`);
    } else {
      warnLine(ompLabel, `${ompReport.missing.length} extension dir(s) missing · ${where} — run: tersio install --agent omp`);
    }
  }

  // Pi's extension layer, same shape as OMP's: a row appears only when the
  // tree is actually on disk, so a machine that never installed it is not
  // told it is missing.
  const piReport = reportPiLayer(home, existsSync);
  if (piReport.installed) {
    const piLabel = 'Pi extension layer';
    const present = piReport.extensions.length;
    const where = displayPath(piLayer(home).extDir, home);
    if (piReport.missing.length === 0) {
      check(piLabel, true, `${present} extension/module director${present === 1 ? 'y' : 'ies'} · ${where}`);
    } else {
      warnLine(piLabel, `${piReport.missing.length} extension dir(s) missing · ${where} — run: tersio install --agent pi`);
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
