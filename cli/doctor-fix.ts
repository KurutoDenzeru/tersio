import { existsSync, promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {
  BUN_BIN_DIR, HOME, NPM_BIN, OMP_AGENT_DIR, OMP_PLUGINS_DIR,
  PACKAGE_NAME, PACKAGE_VERSION, RTK_BINARY_NAME, removeExtensionFromConfig,
  dryRun, verbose,
  debug,
  execP, readPluginsPackage,
  shimCommand,
} from './common.ts';
import { execNetwork, sayTagged } from './interactive.ts';
import { wireRtkOmp, wireRtkOpencode, wireRtkPi, wireRtkPig, ensureRtkInConfig } from './rtk-wiring.ts';
import {
  RTK_RELEASE_API, fetchJson, findFile, httpsGet,
  httpsDownload, parseChecksum, readTextIfExists, resolveHostBinary, rtkPlatformSpec, sha256File,
} from '../extensions/shared/utils.ts';
import type { RtkRelease } from '../extensions/shared/utils.ts';
import { runLatestUpdate } from './update.ts';
import { OPENCODE_ENTRY, PONYTAIL_PKG, TREE_FILES, isObsoleteTreeFile, syncPluginManifest, syncTreeFiles, treeFilesFor } from './manifest.ts';
import { detectHosts, hostExtensionsDir } from './hosts.ts';

type FixTarget = 'extensions' | 'registrations' | 'rtk' | 'ponytail' | 'cli' | 'service';
type FixRequest = FixTarget | 'all';

/** Pids of `opencode serve --service` processes whose service manager no longer tracks them. The orphan holds the managed port, so the next start exits 1. */
export function serviceOrphanPids(): string[] {
  const bin = resolveHostBinary('opencode', path.join(HOME, '.opencode', 'bin'));
  if (!bin) return [];
  const shim = shimCommand(bin, ['service', 'status']);
  let status = '';
  try {
    status = spawnSync(shim.cmd, shim.args, { encoding: 'utf8' }).stdout.trim().toLowerCase();
  } catch {
    return [];
  }
  if (serviceRunning(status)) return [];
  const grepShim = shimCommand('pgrep', ['-f', 'opencode serve --service']);
  let out = '';
  try {
    out = spawnSync(grepShim.cmd, grepShim.args, { encoding: 'utf8' }).stdout ?? '';
  } catch { return []; }
  // Only digits: the value comes from another process, and `process.kill` throws on anything else.
  return out.split(/[\s,]+/).filter((line: string) => /^\d+$/.test(line.trim())).map((line: string) => line.trim());
}

/** Whether OpenCode reports its service running, and whether a serve process is alive. */
export function serviceState(): { status: string; live: boolean } | null {
  const bin = resolveHostBinary('opencode', path.join(HOME, '.opencode', 'bin'));
  if (!bin) return null;
  const shim = shimCommand(bin, ['service', 'status']);
  let status = '';
  try {
    status = spawnSync(shim.cmd, shim.args, { encoding: 'utf8' }).stdout.trim().toLowerCase();
  } catch {
    return null;
  }
  if (status === '') return null;
  let live = false;
  try {
    const grepShim = shimCommand('pgrep', ['-f', 'opencode serve --service']);
    const out = spawnSync(grepShim.cmd, grepShim.args, { encoding: 'utf8' }).stdout ?? '';
    live = out.split(/[\s,]+/).some((line: string) => /^\d+$/.test(line.trim()));
  } catch { live = false; }
  return { status, live };
}

/** A running service reports its URL, so the word is only one of the answers. */
export function serviceRunning(status: string): boolean {
  return status === 'running' || status.startsWith('http://') || status.startsWith('https://');
}

/** Every obsolete file under `dest`, or an empty list. `treeFilesFor` is what the install writes. */
async function obsoleteFiles(dest: string, id: 'omp' | 'pi' | 'opencode' | 'pig'): Promise<string[]> {
  const keep = new Set(treeFilesFor(id));
  const out: string[] = [];
  const walk = async (dir: string, rel: string): Promise<void> => {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      const at = path.join(dir, entry.name);
      if (entry.isDirectory()) { await walk(at, child); continue; }
      if (keep.has(child)) continue;
      if (isObsoleteTreeFile(child, id)) out.push(child);
    }
  };
  await walk(dest, '');
  return out;
}

/** Obsolete top-level directories, empty or not: a debris name is a whole directory, so a repair must drop the directory, not only the files inside it. */
async function obsoleteDirs(dest: string, id: 'omp' | 'pi' | 'opencode' | 'pig'): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try { entries = await fs.readdir(dest, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (isObsoleteTreeFile(entry.name, id)) out.push(entry.name);
  }
  return out;
}

// A written tree is the install for both hosts, so --fix restores it for whichever hosts have it.
  const forHost = (id: string): readonly string[] => treeFilesFor(id as 'omp' | 'pi' | 'opencode' | 'pig');
  // Older trees nested the entry; a repair under the old filter may have left it at the root, so remove both strays.
  const scrubOpencodeEntry = async (dest: string): Promise<void> => {
    for (const target of [path.join(dest, OPENCODE_ENTRY), path.join(dest, 'opencode')]) {
      if (!existsSync(target)) continue;
      if (dryRun) { sayTagged(`  [dry-run] would remove foreign ${target}`); continue; }
      await fs.rm(target, { recursive: true, force: true });
      sayTagged(`  [rm] foreign ${target}`);
    }
  };
  const ruleFile = (f: string): boolean => /^caveman\/rule.*\.md$/.test(f);

async function fixExtensionTrees(): Promise<void> {
  // The entry imports @opencode/plugin, which pi, pig and omp lack, so one shared filter keeps repairs out of their trees.
  for (const host of detectHosts()) {
    const dest = hostExtensionsDir(host.id);
    // Repair a partly-present tree: a half-written one is this run's case, and it reads as "not installed".
    const present = forHost(host.id).filter((file) => existsSync(path.join(dest, file))).length;
    if (present === 0) {
      if (host.id !== 'opencode') await scrubOpencodeEntry(dest);
      continue;
    }
    await fs.mkdir(dest, { recursive: true });
    const missing = await syncTreeFiles(dest, forHost(host.id), { dryRun, verbose });
    for (const from of missing) sayTagged(`  [warn] bundled source missing: ${from}`);
    // Writing the current tree repairs stale and missing at once; dropped debris needs removal, else it survives.
    const debris = (await obsoleteFiles(dest, host.id as 'omp' | 'pi' | 'opencode' | 'pig')).toSorted();
    for (const rel of debris) {
      const at = path.join(dest, ...rel.split('/'));
      if (dryRun) { sayTagged(`  [dry-run] would remove debris ${at}`); continue; }
      await fs.rm(at, { force: true });
      sayTagged(`  [rm] debris ${at}`);
    }
    for (const rel of await obsoleteDirs(dest, host.id as 'omp' | 'pi' | 'opencode' | 'pig')) {
      const at = path.join(dest, ...rel.split('/'));
      if (dryRun) { sayTagged(`  [dry-run] would remove debris dir ${at}`); continue; }
      await fs.rm(at, { recursive: true, force: true });
      sayTagged(`  [rm] debris dir ${at}`);
    }
    if (host.id !== 'opencode') await scrubOpencodeEntry(dest);
    if (!dryRun) sayTagged(`  [ok] ${host.label} extension tree: ${dest}`);
  }
}

// On OpenCode the tree is inert without its entry in opencode.json, and the rtk plugin entry is redundant beside it.
async function fixOpencodeEntry(): Promise<void> {
  const dir = path.join(HOME, '.config', 'opencode', 'plugins', 'tersio');
  const configPath = path.join(HOME, '.config', 'opencode', 'opencode.json');
  // The loader resolves <pluginDir>/server.ts: an entry at the extensions root leaves a shim to a nested copy.
  const nested = path.join(dir, 'opencode');
  const staleNested = (await readTextIfExists(path.join(nested, 'server.ts'))) !== null;
  await syncTreeFiles(dir, TREE_FILES.filter((file) => !file.includes('/')), { dryRun, verbose });
  if (staleNested && !dryRun) await fs.rm(nested, { recursive: true, force: true }).catch(() => {});
  if (dryRun) sayTagged(`  [dry-run] would remove the redundant rtk plugin entry`);
  else await fs.rm(path.join(HOME, '.config', 'opencode', 'plugins', 'rtk.ts'), { force: true }).catch(() => {});
  const raw = await readTextIfExists(configPath);
  let config: Record<string, unknown> = {};
  try { config = raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { return; }
  const plugins = Array.isArray(config.plugins) ? [...config.plugins] as unknown[] : [];
  const kept = plugins.filter((p) => typeof p !== 'string' || !p.endsWith('/opencode/plugins/rtk.ts'));
  if (kept.length === plugins.length && kept.includes(dir)) return;
  kept.push(dir);
  config.plugins = kept;
  if (dryRun) { sayTagged(`  [dry-run] would register tersio in ${configPath}`); return; }
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  sayTagged(`  [ok] OpenCode plugin entry: ${configPath}`);
}

async function fixExtensions(pluginsDir: string): Promise<void> {
  await fixExtensionTrees();

  // Register OpenCode only when the host is actually installed.
  if (detectHosts().some((host) => host.id === 'opencode' && host.installed)) {
    await fixOpencodeEntry();
  }
  console.log('  Doctor --fix: restoring plugin extension files');
  const pluginExtDir = path.join(pluginsDir, 'node_modules', '@krtclcdy', 'tersio', 'extensions');
  await fs.mkdir(pluginExtDir, { recursive: true });

  // Rule bodies are never overwritten: they can be newer upstream fetches.
  const missing = await syncTreeFiles(pluginExtDir, TREE_FILES, { dryRun, verbose }, (file: string) => ruleFile(file) && existsSync(path.join(pluginExtDir, ...file.split('/'))));
  for (const from of missing) sayTagged(`  [warn] bundled source missing: ${from}`);

  // omp loads this tree, so its debris is what doctor reports: the package tree, compared against every entry.
  const debris = (await obsoleteFiles(pluginExtDir, 'opencode')).toSorted();
  for (const rel of debris) {
    const at = path.join(pluginExtDir, ...rel.split('/'));
    if (dryRun) { sayTagged(`  [dry-run] would remove debris ${at}`); continue; }
    await fs.rm(at, { force: true });
    sayTagged(`  [rm] debris ${at}`);
  }
  for (const rel of await obsoleteDirs(pluginExtDir, 'opencode')) {
    const at = path.join(pluginExtDir, ...rel.split('/'));
    if (dryRun) { sayTagged(`  [dry-run] would remove debris dir ${at}`); continue; }
    await fs.rm(at, { recursive: true, force: true });
    sayTagged(`  [rm] debris dir ${at}`);
  }

  // A synced tree is not enough: omp loads only the entries its manifest names.
  await syncPluginManifest(path.dirname(pluginExtDir), { dryRun, verbose });

  // Writing is not atomic, so re-read rather than assume the tree is whole.
  if (dryRun) return;
  const stillMissing = TREE_FILES.filter((file) => !existsSync(path.join(pluginExtDir, ...file.split('/'))));
  if (stillMissing.length > 0) sayTagged(`  [fail] tree incomplete: ${stillMissing.join(', ')}`);
  else sayTagged(`  [ok] extension tree: ${TREE_FILES.length} files`);
}

async function fixRegistrations(agentDir: string, pluginsDir: string): Promise<void> {
  console.log('  Doctor --fix: repairing config.yml registrations');
  const configPath = path.join(agentDir, 'config.yml');
  if ((await readTextIfExists(configPath)) === null) {
    if (dryRun) sayTagged(`  [dry-run] would create ${configPath}`);
    else {
      await fs.mkdir(agentDir, { recursive: true });
      await fs.writeFile(configPath, 'extensions:\n', 'utf8');
    }
  }
  const extDir = path.join(agentDir, 'extensions');
  const rtkTs = path.join(extDir, 'rtk.ts');
  if ((await readTextIfExists(rtkTs)) !== null) await ensureRtkInConfig({ dryRun, verbose });
  const ponytailExtPath = path.join(pluginsDir, 'node_modules', '@dietrichgebert', 'ponytail', 'pi-extension', 'index.js');
  // A tree from before the fold still names `combo-toggle`; both lines name the same module.
  await removeExtensionFromConfig(configPath, path.join(extDir, 'combo', 'index.ts'), 'manifest-loaded combo', { dryRun, verbose });
  await removeExtensionFromConfig(configPath, path.join(extDir, 'combo-toggle', 'index.ts'), 'retired manifest-loaded combo', { dryRun, verbose });
  await removeExtensionFromConfig(configPath, ponytailExtPath, 'manifest-loaded ponytail', { dryRun, verbose });
  await removeExtensionFromConfig(configPath, path.join(extDir, 'shared', 'mode-reinforcement.ts'), 'retired mode reinforcement', { dryRun, verbose });
  const pkgPath = path.join(pluginsDir, 'package.json');
  const pkg = await readPluginsPackage(pkgPath);
  // The exact version: a range lets npm install a release this CLI never wrote.
  if (pkg.dependencies[PACKAGE_NAME] !== PACKAGE_VERSION) {
    pkg.dependencies[PACKAGE_NAME] = PACKAGE_VERSION;
    if (dryRun) sayTagged(`  [dry-run] would register ${PACKAGE_NAME} in ${pkgPath}`);
    else {
      await fs.mkdir(pluginsDir, { recursive: true });
      await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    }
  }
}

async function fixRtk(binDir: string): Promise<void> {
  console.log('  Doctor --fix: repairing RTK binary + wiring');
  const binDest = path.join(binDir, RTK_BINARY_NAME);
  if (dryRun) {
    sayTagged(`  [dry-run] would download a checksum-verified rtk to ${binDest} and wire it into the installed hosts`);
    return;
  }
  const spec = rtkPlatformSpec();
  if (!spec) throw new Error(`unsupported platform ${process.platform}/${process.arch}`);
  const release = await fetchJson<RtkRelease>(RTK_RELEASE_API);
  const asset = (release.assets || []).find((a) => a.name === `rtk-${spec.triple}${spec.ext}`);
  const checksAsset = (release.assets || []).find((a) => a.name === 'checksums.txt');
  if (!asset || !checksAsset) throw new Error(`required assets missing in release ${release.tag_name}`);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tersio-doctor-rtk-'));
  try {
    const archivePath = path.join(tmpDir, asset.name);
    const [checks] = await Promise.all([
      httpsGet(checksAsset.browser_download_url).catch(() => null),
      httpsDownload(asset.browser_download_url, archivePath),
    ]);
    // Same rule as the installer: an unverifiable binary is not installed.
    const unverified = (why: string): Error => new Error(`${why} for ${asset.name}. Re-run with --allow-unverified to accept it`);
    if (!checks) throw unverified('checksums.txt could not be downloaded');
    const expected = parseChecksum(checks, asset.name);
    if (!expected) throw unverified('checksums.txt has no entry');
    if (await sha256File(archivePath) !== expected) throw new Error(`checksum mismatch for ${asset.name}`);
    debug('RTK checksum verified');
    const extractDir = path.join(tmpDir, 'extracted');
    await fs.mkdir(extractDir, { recursive: true });
    if (asset.name.endsWith('.zip')) await execP('powershell', ['Expand-Archive', '-Path', archivePath, '-DestinationPath', extractDir, '-Force'], { timeout: 60000 });
    else await execP('tar', ['xzf', archivePath, '-C', extractDir], { timeout: 60000 });
    const found = await findFile(extractDir, RTK_BINARY_NAME);
    if (!found) throw new Error(`${RTK_BINARY_NAME} not found in ${asset.name}`);
    await fs.mkdir(path.dirname(binDest), { recursive: true });
    await fs.copyFile(binDest, `${binDest}.bak`).catch(() => { });
    await fs.copyFile(found, binDest);
    if (process.platform !== 'win32') await fs.chmod(binDest, 0o755);
    await execP(binDest, ['--version'], { timeout: 30000, shell: false });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => { });
  }
  if (!(await wireRtkOmp(binDest, { dryRun, verbose }))) throw new Error('rtk wiring failed');
  // Fail-open: a missing host wire must not fail the repair.
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  if (existsSync(path.join(home, '.config', 'opencode', 'plugins', 'tersio'))) {
    await wireRtkOpencode(binDest, { dryRun, verbose });
  }
  if (existsSync(path.join(home, '.pi', 'agent', 'extensions'))) {
    await wireRtkPi(binDest, { dryRun, verbose });
  }
  if (existsSync(path.join(home, '.pig', 'agent', 'extensions'))) {
    await wireRtkPig(binDest, { dryRun, verbose });
  }
}

async function fixPonytail(pluginsDir: string): Promise<void> {
  // Ponytail rides inside tersio now. The old dependency made a host list it as a second plugin,
  // so the repair drops the entry, the override, and the sibling copy the host still discovers.
  console.log('  Doctor --fix: drop the separate Ponytail package');
  await fs.mkdir(pluginsDir, { recursive: true });
  const pkgPath = path.join(pluginsDir, 'package.json');
  const pkg = await readPluginsPackage(pkgPath);
  pkg.dependencies[PACKAGE_NAME] = PACKAGE_VERSION;
  const hadEntry = PONYTAIL_PKG in pkg.dependencies;
  delete pkg.dependencies[PONYTAIL_PKG];
  if (typeof pkg.overrides === 'object' && pkg.overrides !== null) {
    const overrides = { ...pkg.overrides as Record<string, string> };
    delete overrides[PONYTAIL_PKG];
    if (Object.keys(overrides).length === 0) delete pkg.overrides;
    else pkg.overrides = overrides;
  }
  const sibling = path.join(pluginsDir, 'node_modules', '@dietrichgebert', 'ponytail');
  if (dryRun) {
    if (hadEntry) sayTagged(`  [dry-run] would drop ${PONYTAIL_PKG} from ${pkgPath}, and ${sibling} when present`);
    console.log('  [dry-run] would write the plugin manifest, then run: npm install --no-audit --no-fund (in plugins dir)');
    return;
  }
  if (hadEntry) console.log(`  [migrate] dropped ${PONYTAIL_PKG} (now bundled in tersio)`);
  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  await fs.rm(sibling, { recursive: true, force: true }).catch(() => undefined);
  await execNetwork('Restoring bundled Ponytail', NPM_BIN, ['install', '--no-audit', '--no-fund'], { cwd: pluginsDir, timeout: 180000 }).catch((e) => {
    throw new Error(`bundled ponytail restore failed: ${(e as Error).message}`);
  });
}

/** The decisive line of a failed command, so one [warn] line carries the reason. */
function shortError(e: unknown): string {
  return (((e as Error & { stderr?: string }).stderr) || (e as Error).message || '').trim().slice(0, 200);
}

async function fixCli(): Promise<void> {
  console.log('  Doctor --fix: updating CLI + add-ons');
  await runLatestUpdate();
}

/** OpenCode's manager can lose its daemonized serve process, so `stop` and `restart` cannot reach it: kill the orphan by pid, then start the service again. */
async function fixOpencodeService(): Promise<void> {
  const orphans = serviceOrphanPids();
  if (orphans.length === 0) {
    sayTagged('  [skip] no orphaned OpenCode serve process; the service answers');
    return;
  }
  for (const pid of orphans) {
    if (dryRun) { sayTagged(`  [dry-run] would stop the orphaned serve process (pid ${pid})`); continue; }
    try {
      process.kill(Number(pid), 'SIGTERM');
      sayTagged(`  [ok] stopped the orphaned serve process (pid ${pid})`);
    } catch (e) {
      sayTagged(`  [warn] pid ${pid} already gone: ${shortError(e)}`);
    }
  }
  if (dryRun) return;
  await new Promise((resolve) => setTimeout(resolve, 500));
  const bin = resolveHostBinary('opencode', path.join(HOME, '.opencode', 'bin'));
  if (!bin) { sayTagged('  [warn] opencode not found on PATH; start it with `opencode service start`'); return; }
  const shim = shimCommand(bin, ['service', 'start']);
  await execNetwork('Starting the OpenCode service', shim.cmd, shim.args, { timeout: 60000 }).catch((e) => {
    throw new Error(`service start failed: ${shortError(e)}`);
  });
}

async function runDoctorRepairs(targets: FixRequest[]): Promise<string[]> {
  const all = targets.includes('all');
  const want = (t: FixTarget): boolean => all || targets.includes(t);
  if (dryRun) console.log('Preview — no changes will be written.\n');
  const failed: string[] = [];
  const attempt = async (label: string, work: () => Promise<void>): Promise<void> => {
    try {
      await work();
      if (!dryRun) sayTagged(`  [ok] ${label}`);
    } catch (e) {
      failed.push(label);
      sayTagged(`  [fail] ${label}: ${((e as Error).message || '').slice(0, 200)}`);
    }
  };
  if (want('extensions')) await attempt('extensions', () => fixExtensions(OMP_PLUGINS_DIR));
  if (want('registrations')) await attempt('registrations', () => fixRegistrations(OMP_AGENT_DIR, OMP_PLUGINS_DIR));
  if (want('rtk')) await attempt('rtk', () => fixRtk(BUN_BIN_DIR));
  if (want('ponytail')) await attempt('ponytail', () => fixPonytail(OMP_PLUGINS_DIR));
  if (want('cli')) await attempt('cli', fixCli);
  if (want('service')) await attempt('opencode service', fixOpencodeService);
  return failed;
}

export { runDoctorRepairs };
export type { FixTarget };