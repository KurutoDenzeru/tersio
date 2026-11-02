// cli/doctor.ts — installation health checks.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, promises as fs } from 'node:fs';
import path from 'node:path';
import {
  HOME, OMP_AGENT_DIR, PACKAGE_NAME, PACKAGE_VERSION,
  args, dryRun, fix, yes,
  BUN_BIN_DIR, OMP_BIN,
  execP, relTime, shimCommand,
} from './common.ts';
import { detectHosts, dshPackageDir, hostExtensionsDir, ompPackageDir, piPonytailPackageDir, pigPonytailPackageDir } from './hosts.ts';
import type { DetectedHost } from './hosts.ts';
import { GENERATED_TREE_FILES } from './manifest.ts';
import { askInteractiveChoice, askInteractiveConfirm, runInteractivePhase } from './interactive.ts';
import { usageDbPath } from '../extensions/shared/usage-store.ts';
import { readHeadroomDoctor } from '../extensions/shared/headroom-gain.ts';
import { headroomProxyPort } from '../extensions/shared/headroom-proxy.ts';
import { piAgentDir, pigAgentDir, readTextIfExists, resolveHeadroomBinary, resolveHostBinary, resolveRtkBinary, rtkPlatformSpec, ruleBodyProblem } from '../extensions/shared/utils.ts';
import { sqliteScript, statsDbPath } from '../extensions/shared/agent-stats.ts';
import { OMP_SUBAGENT_MARKER } from '../extensions/shared/session-state.ts';
import { PI_PONYTAIL_FILES, PONYTAIL_BUNDLE_FILES, PONYTAIL_VERSION, TREE_PSTACK_FILES, isObsoleteTreeFile, treeFileText, treeFilesFor } from './manifest.ts';
import { serviceRunning, serviceState } from './doctor-fix.ts';
import { readState } from '../extensions/shared/state.ts';
import { CAVEMAN_PIN } from './upstream.ts';
import { newerThan } from './update.ts';

/** Bytes at the scale a transcript gap reads in: `5.6M`, not `5571992`. */
function shortBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)}G`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)}M`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)}K`;
  return `${bytes}B`;
}

/** What a stale file needs: a newer upstream body is a review, an older install is an install. */
export function cavemanBodyHint(): string {
  const tag = readState().cavemanUpstream?.tag;
  if (tag && newerThan(tag, CAVEMAN_PIN)) {
    return `the installed body is from ${tag}, this build ships ${CAVEMAN_PIN.replace(/^v/, '')} — review the diff and bump the pin in cli/upstream.ts`;
  }
  return 'run: tersio install --host <host>';
}

interface DoctorSummary {
  ok: number;
  warn: number;
  missing: number;
}

/** Zero-padded two-digit number, for the doctor's date rows. */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function absDate(ms: number): string {
  const d = new Date(ms);
  const h24 = d.getHours();
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}-${d.getFullYear()}, ${pad2(h24 % 12 || 12)}:${pad2(d.getMinutes())} ${h24 >= 12 ? 'PM' : 'AM'}`;
}

// An unused host is not a fault: out of the tally, carrying only the one line that installs it.
function reportUnused(label: string, detail: string): void {
  console.log(`  —  ${label}: not installed ${detail}`);
}

// Session defaults come from tersio's store; naming the source keeps a harness from reading as a second default.

async function runDoctor(recheck = false): Promise<DoctorSummary> {
  console.log('\n=== Tersio Doctor ===');

  // OMP loads the plugin from its plugins dir; pi from its npm dir, per its settings.json.
  const rtkBin = resolveRtkBinary();
  // Headroom is the user's own opt-in install, so the row only reports it and never installs.
  const headroomBin = resolveHeadroomBinary();
  // OpenCode's own binary, when installed: `~/.opencode/bin` first, then PATH.
  const opencodeBin = resolveHostBinary('opencode', path.join(HOME, '.opencode', 'bin'));
  // One source for the installed plugin path, so the doctor follows a package rename.
  const tersioPluginDir = ompPackageDir();

  // Ponytail rides inside this tree: one vendored copy, and the fork ships index.ts while an older package holds index.js.
  const ponytailIndex = ['index.ts', 'index.js']
    .map((base) => path.join(tersioPluginDir, 'extensions', 'ponytail', 'pi-extension', base))
    .find((at) => existsSync(at))
    ?? path.join(tersioPluginDir, 'extensions', 'ponytail', 'pi-extension', 'index.ts');
  const cavemanIndex = path.join(tersioPluginDir, 'extensions', 'caveman', 'index.ts');
  const cavemanRule = (name: string) => path.join(tersioPluginDir, 'extensions', 'caveman', name);
  // The pstack body is a Tersio fork with no remote, so the check proves it is usable, not current.
  const pstackRule = path.join(tersioPluginDir, 'extensions', 'pstack', 'rule.md');
  const rtkIndex = path.join(tersioPluginDir, 'extensions', 'rtk', 'session.ts');
  const updaterIndex = path.join(tersioPluginDir, 'extensions', 'shared', 'updater.ts');

  // Probes start concurrently and report in fixed order as data settles; each resolves instead of rejecting.
  const hosts = detectHosts();

  // Only hosts with their own copy are compared: omp's copy is the reference. Paths hang off the package root.
  const ponytailLoads: Record<string, { dir: string; files: readonly string[] }> = {
    pi: { dir: piPonytailPackageDir(piAgentDir()), files: PI_PONYTAIL_FILES },
    pig: { dir: pigPonytailPackageDir(pigAgentDir()), files: PI_PONYTAIL_FILES },
    opencode: { dir: path.join(hostExtensionsDir('opencode'), 'ponytail-bundle'), files: PONYTAIL_BUNDLE_FILES },
    // The dsh bundle mounts the whole tersio package, so its Ponytail copy rides inside it.
    dsh: { dir: path.join(dshPackageDir(), 'extensions', 'ponytail'), files: PI_PONYTAIL_FILES },
  };
  // One hook cannot stand for the set: 5.1 and 5.2 ship the same instructions file and differ inside a skill.
  const ponytailStale: string[] = [];
  const ponytailSource = path.join(tersioPluginDir, 'extensions', 'ponytail');
  for (const host of hosts.filter((h) => h.installed)) {
    const copy = ponytailLoads[host.id];
    if (!copy) continue;
    for (const rel of copy.files) {
      const ref = await readTextIfExists(path.join(ponytailSource, ...rel.split('/')));
      if (ref === null) continue;
      const theirs = await readTextIfExists(path.join(copy.dir, ...rel.split('/')));
      if (theirs !== ref) ponytailStale.push(`${host.id}/${rel}`);
    }
  }
  // One comparison per read file catches three directions: dropped, not received, debris left under a dropped name.
  const treeStale: string[] = [];
  const treeMissing: string[] = [];
  const treeOrphan: string[] = [];
  // The tree a host loads: omp reads the plugin package, every other host its own directory.
  const treeBaseFor = (host: DetectedHost): string =>
    host.id === 'omp' ? path.join(tersioPluginDir, 'extensions') : hostExtensionsDir(host.id);
  // Only an install this build recognises is compared; a partial tree is debris, and the host row already names the command that clears it.
  for (const host of hosts.filter((h) => h.installed)) {
    const treeId = host.id === 'omp' ? 'opencode' : host.id;
    const base = treeBaseFor(host);
    let onDisk = new Set(hostTreeFiles(base).filter((rel) => path.extname(rel) !== '.js'));
    // The dsh bundle is the whole tersio package: only its own subpath is Tersio's to judge, so the package's other files (the OpenCode entry, the mode trees) never read as debris.
    if (treeId === 'dsh') onDisk = new Set([...onDisk].filter((rel) => rel.startsWith('dsh/')));
    const expected = new Set(treeFilesFor(treeId));
    const every = new Set([...onDisk, ...expected]);
    for (const rel of every) {
      // Reference is this CLI's own definition, not `tersioPluginDir`, which compares the tree to itself.
      const reference = treeFileText(rel);
      const at = path.join(base, ...rel.split('/'));
      // One debris definition for detection and repair, so a row can only name what a repair removes.
      if (isObsoleteTreeFile(rel, treeId)) treeOrphan.push(`${host.id}/${rel}`);
      else if (!expected.has(rel)) continue;
      else if (!onDisk.has(rel)) treeMissing.push(`${host.id}/${rel}`);
      // No reference means this build dropped the entry: debris, not a mismatch.
      else if (reference === null) continue;
      else {
        const theirs = await readTextIfExists(at);
        if (theirs === null) treeMissing.push(`${host.id}/${rel}`);
        else if (theirs !== reference) treeStale.push(`${host.id}/${rel}`);
      }
    }
  }
  // A host reading as installed whose tree is short of this build's declared files: the pair loop above cannot see a file that is absent on both sides.
  const unwrittenTreeFiles = async (): Promise<string[]> => {
    const out: string[] = [];
    for (const host of hosts.filter((h) => h.installed)) {
      const treeId = host.id === 'omp' ? 'opencode' : host.id;
      const base = treeBaseFor(host);
      for (const rel of treeFilesFor(treeId)) {
        if (existsSync(path.join(base, ...rel.split('/')))) continue;
        if (host.id === 'omp' && GENERATED_TREE_FILES[rel] !== undefined) continue;
        out.push(`${host.id}/${rel}`);
      }
    }
    return out;
  };
  const probes = {
    ompPkgText: readTextIfExists(path.join(ompPackageDir(), 'package.json')),
    configText: readTextIfExists(path.join(OMP_AGENT_DIR, 'config.yml')),
    ponytailPkgText: readTextIfExists(ponytailIndex),
    rtkBinText: rtkBin ? readTextIfExists(rtkBin) : Promise.resolve(null),
    cavemanIndexText: readTextIfExists(cavemanIndex),
    cavemanRuleText: readTextIfExists(cavemanRule('rule.md')),
    cavemanLiteText: readTextIfExists(cavemanRule('rule-lite.md')),
    cavemanMegacaveLiteText: readTextIfExists(cavemanRule('rule-megacave-lite.md')),
    cavemanMegacaveUltraText: readTextIfExists(cavemanRule('rule-megacave-ultra.md')),
    cavemanUltraText: readTextIfExists(cavemanRule('rule-ultra.md')),
    cavemanMegacaveText: readTextIfExists(cavemanRule('rule-megacave.md')),
    pstackRuleText: readTextIfExists(pstackRule),
    pstackTreeFiles: Promise.all(
      TREE_PSTACK_FILES.map((rel) => readTextIfExists(path.join(tersioPluginDir, "extensions", ...rel.split("/")))),
    ),
    rtkIndexText: readTextIfExists(rtkIndex),
    updaterIndexText: readTextIfExists(updaterIndex),
    rtkMtime: rtkBin ? fs.stat(rtkBin).catch(() => null) : Promise.resolve(null),
    ruleMtime: fs.stat(cavemanRule('rule.md')).catch(() => null),
    ponytailMtime: fs.stat(ponytailIndex).catch(() => null),
  };
  const rtkVersionProbe: Promise<string | null> = rtkBin ? execP(rtkBin, ['--version'], { timeout: 5000 }).then(
    (r) => r.stdout.trim() || r.stderr.trim() || null,
    (e) => {
      const err = e as { stdout?: string; stderr?: string };
      return err.stdout?.trim() || err.stderr?.trim() || null;
    },
  ) : Promise.resolve(null);
  const headroomVersionProbe: Promise<string | null> = headroomBin ? execP(headroomBin, ['--version'], { timeout: 5000 }).then(
    (r) => r.stdout.trim() || r.stderr.trim() || null,
    (e) => {
      const err = e as { stdout?: string; stderr?: string };
      return err.stdout?.trim() || err.stderr?.trim() || null;
    },
  ) : Promise.resolve(null);
  // A manager that lost its daemonized process reads stopped, while the orphan still holds the port.
  const opencodeServiceProbe: Promise<{ status: string; live: boolean } | null> = opencodeBin
    ? Promise.resolve(serviceState())
    : Promise.resolve(null);
  const [[_ompPkgText, _configText], [_cavemanIndexText, _rtkIndexText, _updaterIndexText, ponytailPkgText], [cavemanRuleText, cavemanLiteText, cavemanMegacaveLiteText, cavemanMegacaveUltraText, cavemanUltraText, cavemanMegacaveText, pstackRuleText, pstackTreeFiles, ruleMtime, rtkBinText, rtkMtime, rtkVersion, ponytailMtime, headroomVersionRaw], opencodeService] = await runInteractivePhase('Checking installation', () => Promise.all([
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
      probes.cavemanLiteText,
      probes.cavemanMegacaveLiteText,
      probes.cavemanMegacaveUltraText,
      probes.cavemanUltraText,
      probes.cavemanMegacaveText,
      probes.pstackRuleText,
      probes.pstackTreeFiles,
      probes.ruleMtime,
      probes.rtkBinText,
      probes.rtkMtime,
      rtkVersionProbe,
      probes.ponytailMtime,
      headroomVersionProbe,
    ]),
    opencodeServiceProbe,
  ]));

  // Success rows stay quiet (no path echoes); failures print the expected path or fix so they stay actionable.
  const tally = { ok: 0, missing: 0, warn: 0 };
  function check(label: string, ok: boolean, detail = ''): void {
    if (ok) { tally.ok++; console.log(`  ✅ ${label}: ok${detail ? ` ${detail}` : ''}`); }
    else { tally.missing++; console.log(`  ❌ ${label}: MISSING${detail ? ` ${detail}` : ''}`); }
  }
  function warnLine(label: string, detail: string): void {
    tally.warn++;
    console.log(`  ⚠️ ${label}: warn ${detail}`);
  }

  // A Windows failure names its cause here: several rows below silently degrade when the platform has no rtk build, and a wrong home would move every one of them.
  section('Platform');
  const rtkSpec = rtkPlatformSpec();
  check('Platform', rtkSpec !== null, `${process.platform}/${process.arch}${rtkSpec ? ` · node ${process.version} · rtk ${rtkSpec.triple}` : ''}`);
  if (rtkSpec === null) {
    // Windows on ARM today: rtk publishes no build, so the RTK rows read as not installed.
    console.log(`      rtk publishes no build for ${process.platform}/${process.arch}; every RTK row below reads as missing`);
  }
  console.log(`  Usage DB: ${usageDbPath()} (local only)`);

  section('Hosts');
  for (const host of hosts) {
    if (!host.installed) {
      // A partial tree is debris, not an install: the host reads as missing, and the same row names the cleanup.
      const leftover = host.id !== 'dsh' && existsSync(hostExtensionsDir(host.id));
      if (leftover) {
        reportUnused(host.label, `· leftover files — tersio uninstall --host ${host.id}`);
        continue;
      }
      if (host.declared) check(host.label, false, `declared (${host.declared}) but not installed`);
      else reportUnused(host.label, `· ${host.installCmd}`);
      continue;
    }
    // One line per host, omp style: kind and version, no path echo.
    const kind = host.via === 'tree' ? 'extensions' : 'package';
    check(host.label, true, `${kind} ${PACKAGE_NAME}${host.version ? ` ${host.version}` : ''}`);
  }

  // A version apart means omp can load a tree of two releases.
  const ompHost = hosts.find((host) => host.id === 'omp');
  if (ompHost?.version && ompHost.version !== PACKAGE_VERSION) {
    warnLine('OMP plugin package', `v${ompHost.version} while this CLI is v${PACKAGE_VERSION} — run: tersio install --host omp`);
  }

  // A healthy service adds no row: the host row already names the install, and this row only shows when the manager's report and the live process disagree.
  if (opencodeService) {
    const running = serviceRunning(opencodeService.status);
    if (!running && opencodeService.live) {
      warnLine('OpenCode service', `a serve process is alive but the service reads ${opencodeService.status} — run: tersio doctor --fix service`);
    } else if (running && !opencodeService.live) {
      warnLine('OpenCode service', 'the service reports running but no serve process is alive — run: tersio doctor --fix service');
    }
  }

  // Pages read omp's own index, which advances only while an omp process owns it, so a stall reads as empty.
  const indexLag = statsIndexLag();
  if (indexLag) warnLine('omp stats index', indexLag);

  section('Add-ons');
  const ruleAge = ruleMtime ? `(updated ${relTime(Date.now() - ruleMtime.mtimeMs)} · ${absDate(ruleMtime.mtimeMs)})` : '';
  const cavemanRules = [['rule.md', cavemanRuleText], ['rule-lite.md', cavemanLiteText], ['rule-megacave-lite.md', cavemanMegacaveLiteText], ['rule-megacave-ultra.md', cavemanMegacaveUltraText], ['rule-ultra.md', cavemanUltraText], ['rule-megacave.md', cavemanMegacaveText]];
  const missingRules = cavemanRules.filter(([, text]) => text === null).map(([name]) => name);
  // The body carries no version, so the release it came from is the number: the pinned one, or the one a pull recorded.
  const cavemanRelease = (readState().cavemanUpstream?.tag ?? CAVEMAN_PIN).replace(/^v/, '');
  check('Caveman rule', missingRules.length === 0, missingRules.length ? `missing: ${missingRules.join(', ')}` : [cavemanRelease, ruleAge].filter(Boolean).join(' '));
  for (const [name, text] of cavemanRules) {
    if (text === null) continue;
    const problem = ruleBodyProblem(text);
    if (problem) warnLine(`Caveman ${name}`, `unusable body (${problem}) — run: tersio install`);
  }
  // pstack is opt-in, so a missing or unusable body costs only the sessions that asked for it.
  check('pstack rule', pstackRuleText !== null, pstackRuleText === null ? 'missing — run: tersio install' : '');
  if (pstackRuleText !== null) {
    const problem = ruleBodyProblem(pstackRuleText);
    if (problem) warnLine('pstack rule.md', `unusable body (${problem}) — run: tersio install`);
  }
  // The index routes to files, so a tree with the rule but no leaves serves a mode that cannot apply.
  const pstackOnDisk: Record<string, true> = {};
  TREE_PSTACK_FILES.forEach((rel: string, i: number) => {
    if (pstackTreeFiles[i] !== null) pstackOnDisk[rel] = true;
  });
  const pstackMissing = TREE_PSTACK_FILES.filter((rel: string) => !pstackOnDisk[rel]).map((rel: string) => rel.replace(/^pstack\//, ''));
  if (pstackMissing.length > 0) {
    warnLine('pstack tree', `missing ${pstackMissing.length} file${pstackMissing.length === 1 ? '' : 's'}: ${pstackMissing.slice(0, 6).join(', ')}${pstackMissing.length > 6 ? ` +${pstackMissing.length - 6} more` : ''} — run: tersio install`);
  }
  // A verbatim sentence read out of omp's own prompt, so a re-worded release stops Caveman reaching subagents.
  const subagentGap = subagentMarkerStatus(ompBinary());
  if (subagentGap) warnLine('Caveman subagent marker', subagentGap);
  // A tree on an older body serves until its install step runs; debris needs the sweeper instead.
  if (treeStale.length > 0) {
    warnLine('Per-host add-on files',
      `stale in ${treeStale.length} file${treeStale.length === 1 ? '' : 's'}: ${treeStale.slice(0, 6).join(', ')}` +
      `${treeStale.length > 6 ? ` +${treeStale.length - 6} more` : ''} — ${cavemanBodyHint()}`);
  }
  if (treeMissing.length > 0) {
    warnLine('Per-host add-on files',
      `never installed in ${treeMissing.length} file${treeMissing.length === 1 ? '' : 's'}: ${treeMissing.join(', ')}` +
      ` — run: tersio install --host <host>`);
  }
  if (treeOrphan.length > 0) {
    warnLine('Per-host add-on files',
      `orphaned in ${treeOrphan.length} file${treeOrphan.length === 1 ? '' : 's'}: ${treeOrphan.join(', ')}` +
      ` — run: tersio doctor --fix extensions`);
  }
  // A count of pairs compared cannot show a file that is absent from disk and absent from the declaration, so assert every declared file landed.
  const unwritten = await unwrittenTreeFiles();
  if (unwritten.length > 0) {
    check('Add-on tree content', false,
      `${unwritten.length} declared file${unwritten.length === 1 ? '' : 's'} not written for a host reading as installed: ${unwritten.slice(0, 6).join(', ')}${unwritten.length > 6 ? ` +${unwritten.length - 6} more` : ''} — run: tersio doctor --fix extensions`);
  }
  const rtkAge = rtkMtime ? `(updated ${relTime(Date.now() - rtkMtime.mtimeMs)} · ${absDate(rtkMtime.mtimeMs)})` : '';
  check('RTK binary', rtkBin !== null, rtkBinText === null ? 'not found in PATH' : [rtkVersion, rtkAge].filter(Boolean).join(' '));
  // rtk_run needs a host exec API, which doctor cannot assume.
  if (rtkBin === null) reportUnused('RTK exec', '· install Tersio to place rtk in ~/.bun/bin');
  else if (!hosts.some((host) => host.installed && (host.id === 'omp' || host.id === 'opencode'))) warnLine('RTK exec', 'no installed host exposes an exec API — rtk_run is unavailable; call rtk from bash instead');
  if (rtkBinText !== null && !rtkVersion) warnLine('RTK version', 'unavailable — binary may not be executable');
  // Headroom is the user's own opt-in install, so the line stays informational: out of the tally either way.
  const headroomVersion = headroomVersionRaw?.match(/version\s+(\S+)/)?.[1] ?? headroomVersionRaw ?? '';
  if (headroomBin !== null) {
    // Its own doctor is the only source that says whether traffic actually flows.
    const routing = readHeadroomDoctor({ binary: headroomBin, port: headroomProxyPort() });
    const failing = routing.checks.filter((c) => c.status === 'fail');
    const warned = routing.checks.filter((c) => c.status === 'warn');
    const detail = routing.measured
      ? failing.length > 0
        ? ` · routing: ${failing[0].name} failing (${failing[0].summary})${failing[0].hint ? ` — ${failing[0].hint}` : ''}`
        : warned.length > 0
          ? ` · routing: ${warned.length} warning${warned.length === 1 ? '' : 's'} (${warned[0].summary})`
          : ' · routing: ok'
      : ` · routing: ${routing.failure || 'unmeasured'}`;
    console.log(`  —  Headroom: ${headroomVersion || 'version unavailable'}${detail}`);
  } else {
    console.log('  —  Headroom: not installed · optional: pip install "headroom-ai[all]", then /headroom on');
  }
  const ponytailAge = ponytailMtime ? `(updated ${relTime(Date.now() - ponytailMtime.mtimeMs)} · ${absDate(ponytailMtime.mtimeMs)})` : '';
  check('Ponytail', ponytailPkgText !== null, [PONYTAIL_VERSION, ponytailAge].filter(Boolean).join(' '));
  if (ponytailStale.length > 0) {
    warnLine('Ponytail per-host bodies',
      `stale in ${ponytailStale.length} file${ponytailStale.length === 1 ? '' : 's'}: ${ponytailStale.slice(0, 6).join(', ')}` +
      `${ponytailStale.length > 6 ? ` +${ponytailStale.length - 6} more` : ''} — run: tersio install --host <host>`);
  }
  // Offline-safe: the registry call is best-effort, and silence means no row rather than a stale one.
  const ponytailVersionGap = await ponytailLatestGap(PONYTAIL_VERSION);
  if (ponytailVersionGap) warnLine('Ponytail version', `${ponytailVersionGap} — run: tersio update --apply-update --yes`);

  const total = tally.ok + tally.missing + tally.warn;
  console.log(`\n  Summary: ${total} checks — ✅ ${tally.ok} ok, ⚠️ ${tally.warn} warn, ❌ ${tally.missing} missing`);

  if (!recheck && tally.missing + tally.warn > 0 && (fix || dryRun)) {
    await runDoctorFix(tally);
  } else if (!recheck && tally.missing + tally.warn > 0) {
    console.log('\n  Run `tersio doctor --fix` to repair the rows above.');
  }
  return tally;
}

type FixTarget = 'extensions' | 'registrations' | 'rtk' | 'ponytail' | 'cli' | 'service';
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
  const valid: FixTarget[] = ['extensions', 'registrations', 'rtk', 'ponytail', 'cli', 'service'];
  if (!valid.includes(raw as FixTarget)) {
    console.error(`[fail] Invalid --fix scope: ${raw}. Valid: ${valid.join(', ')}`);
    process.exit(1);
  }
  return raw as FixTarget;
}

/** omp's binary on PATH, or null, resolved against omp's own name the way `resolveRtkBinary` walks for rtk. */
function ompBinary(): string | null {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, OMP_BIN);
    if (existsSync(candidate)) return candidate;
  }
  const managed = path.join(BUN_BIN_DIR, OMP_BIN);
  return existsSync(managed) ? managed : null;
}

/** `"installed < latest"` when npm answers, else null: silence means "no row", not "stale". */
async function ponytailLatestGap(local: string): Promise<string | null> {
  if (!local) return null;
  try {
    // Advisory, with a short budget; `TERSIO_PONYTAIL_URL` points it at a stub, as the update check does.
    const url = process.env.TERSIO_PONYTAIL_URL || 'https://registry.npmjs.org/@dietrichgebert/ponytail/latest';
    const res = await fetch(url, { signal: AbortSignal.timeout(2500), headers: { accept: 'application/json' } });
    const meta = (await res.json()) as { version?: string };
    const remote = meta?.version;
    if (!remote || remote === local) return null;
    return `${local} installed, ${remote} is the latest`;
  } catch {
    return null;
  }
}

/** Add-on files under a host's tree, repo-relative, empty when absent: `node_modules` is skipped as a hoisted dep. */
function hostTreeFiles(base: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.DS_Store') continue;
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), child);
      else out.push(child);
    }
  };
  walk(base, '');
  return out;
}

/** Whether omp's strings still carry Caveman's marker sentence: null = no gap, string = warning; pi unchecked. */
function subagentMarkerStatus(ompBin: string | null): string | null {
  if (!ompBin) return null;
  let haystack: string;
  try {
    const shim = shimCommand(ompBin, ['--version']);
    haystack = execFileSync(shim.cmd, shim.args, { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] })
      + readFileSync(ompBin, 'utf8');
  } catch {
    // A binary that will not run is the version row's problem, not this one's.
    return null;
  }
  if (haystack.includes(OMP_SUBAGENT_MARKER)) return null;
  return `not found in ${path.basename(ompBin)} — Caveman will not reach subagents until OMP_SUBAGENT_MARKER in extensions/shared/session-state.ts is updated`;
}

async function runDoctorFix(tally: DoctorSummary): Promise<void> {
  const problems: string[] = [];
  if (tally.missing > 0) problems.push(`${tally.missing} missing`);
  if (tally.warn > 0) problems.push(`${tally.warn} warn`);
  const scoped = fixScope();
  let targets: FixRequest[];
  if (scoped) {
    targets = [scoped];
  } else {
    targets = ['all'];
  }
  // A dry run still reaches the repairs: each write is guarded, so the flag only skips prompts a preview cannot ask.
  if (dryRun) {
    console.log(`\n  [dry-run] would repair ${problems.join(' + ') || 'nothing'} (extensions, stale config.yml entries, rtk wiring, ponytail refresh, CLI update, opencode service)`);
    const { runDoctorRepairs } = await import('./doctor-fix.ts');
    await runDoctorRepairs(targets);
    return;
  }
  if (scoped && !yes) {
    const go = await askInteractiveConfirm(`Repair "${scoped}" now?`);
    if (go.status !== 'confirmed' || !go.value) { process.exitCode = 130; return; }
  } else if (!scoped && !yes) {
    const picked = await askInteractiveChoice('Doctor — what should I repair?', [
      { value: 'all', label: 'Fix everything', hint: `${tally.missing + tally.warn} rows` },
      { value: 'extensions', label: 'Missing extension files', hint: 'copy sources from this CLI' },
      { value: 'registrations', label: 'config.yml registrations', hint: 'remove stale entries; keep manifest-owned extensions out' },
      { value: 'rtk', label: 'RTK binary + wiring', hint: 'download checksum-verified binary, rtk init' },
      { value: 'ponytail', label: 'Ponytail package', hint: 'bundled reinstall via tersio dep' },
      { value: 'cli', label: 'CLI update', hint: 'latest tersio + delegated refresh' },
      { value: 'service', label: 'OpenCode service', hint: 'stop an orphaned serve process, then start it' },
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
  if (again.missing + again.warn === 0) console.log('  Doctor --fix: all checks pass. Restart your agent.');
  else console.log(`  Doctor --fix: still ${again.missing} missing + ${again.warn} warn — rerun or repair manually.`);
}

/** How far omp's transcript index lags the transcripts on disk, or null when behind or unreadable. */
function statsIndexLag(): string | null {
  const statsDb = statsDbPath();
  if (!existsSync(statsDb)) return null;
  try {
    // Same WAL-safe reader as the aggregate, so this probe creates no side files beside a database omp has open.
    const rows = sqliteScript(statsDb, 'SELECT session_file, offset FROM file_offsets;\n')
      .split('\n')
      .filter((line: string) => line.includes('\t'))
      .map((line: string) => line.split('\t'));
    if (rows.length === 0) return null;
    // A page shows the gap behind the freshest transcript, so the newest file sets the number, not the sum.
    let worstBytes = 0;
    let freshest = '';
    for (const [file, offsetText] of rows) {
      let size: number;
      try {
        size = statSync(file).size;
      } catch {
        continue; // a rotated or deleted transcript is not a lag
      }
      const behind = size - Number(offsetText);
      if (behind > worstBytes) {
        worstBytes = behind;
        freshest = file;
      }
    }
    if (worstBytes < 4096) return null;
    const when = relTime(Date.now() - statSync(statsDb).mtimeMs);
    return `${shortBytes(worstBytes)} of ${path.basename(freshest)} unread, last written ${when === 'just now' ? 'moments ago' : when} — run: omp stats`;
  } catch {
    return null; // no SQLite engine, or an unreadable index: nothing to report
  }
}

function section(name: string): void {
  console.log(`\n${name}`);
}
export { runDoctor };