import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BUN_BIN_DIR, OMP_AGENT_DIR, OMP_PLUGINS_DIR,
  PACKAGE_NAME, PACKAGE_VERSION, RTK_BINARY_NAME, removeExtensionFromConfig,
  dryRun, verbose,
  debug,
  execP, readPluginsPackage,
  writeIfChanged,
} from './common.ts';
import { execNetwork, sayTagged } from './interactive.ts';
import { wireRtkOmp, wireRtkOpencode, wireRtkPi, ensureRtkInConfig } from './rtk-wiring.ts';
import {
  RTK_RELEASE_API, type RtkRelease, fetchJson, findFile, httpsGet,
  httpsDownload, parseChecksum, readTextIfExists, rtkPlatformSpec, sha256File,
} from '../extensions/lib/utils.ts';
import { runLatestUpdate } from './update.ts';
import { EXT_DIR, OPENCODE_SERVER_SHIM, TREE_FILES, sourcePath } from './manifest.ts';
import { detectHosts, hostExtensionsDir } from './hosts.ts';

type FixTarget = 'extensions' | 'registrations' | 'rtk' | 'ponytail' | 'cli';
type FixRequest = FixTarget | 'all';

// A written tree is the install for both hosts now, so --fix restores it for whichever hosts have it, alongside the OMP package when that is present.
async function fixExtensionTrees(): Promise<void> {
  // The opencode entrypoint is foreign to pi/omp loaders: never copy it there, and remove strays.
  const forHost = (id: string): string[] => TREE_FILES.filter((file) => id === 'opencode' || !file.startsWith('opencode/'));
  const scrubOpencodeDir = async (dest: string): Promise<void> => {
    const dir = path.join(dest, 'opencode');
    if (!existsSync(dir)) return;
    if (dryRun) { sayTagged(`  [dry-run] would remove foreign ${dir}`); return; }
    await fs.rm(dir, { recursive: true, force: true });
    sayTagged(`  [rm] foreign ${dir}`);
  };
  for (const host of detectHosts()) {
    const dest = hostExtensionsDir(host.id);
    // Repair a host whose tree is partly there: a half-written tree is exactly the case this runs for, and it reads as "not installed" to the detector.
    const present = forHost(host.id).filter((file) => existsSync(path.join(dest, file))).length;
    if (present === 0) {
      if (host.id !== 'opencode') await scrubOpencodeDir(dest);
      continue;
    }
    await fs.mkdir(dest, { recursive: true });
    for (const file of forHost(host.id)) {
      const from = path.join(EXT_DIR, ...file.split('/'));
      const text = await readTextIfExists(from);
      if (text === null) sayTagged(`  [warn] bundled source missing: ${from}`);
      else await writeIfChanged(path.join(dest, file), text, { dryRun, verbose });
    }
    if (host.id !== 'opencode') await scrubOpencodeDir(dest);
    if (!dryRun) sayTagged(`  [ok] ${host.label} extension tree: ${dest}`);
  }
}

// The tree alone does nothing on OpenCode without its entrypoint registered in opencode.json.
// The tersio tree ships the rtk rewrite, so the rtk plugin entry is redundant.
async function fixOpencodeEntry(): Promise<void> {
  const { HOME } = await import('./common.ts');
  const dir = path.join(HOME, '.config', 'opencode', 'plugins', 'tersio');
  const configPath = path.join(HOME, '.config', 'opencode', 'opencode.json');
  const nested = path.join(dir, 'opencode', 'server.ts');
  if (!(await readTextIfExists(nested))) return;
  // The loader resolves <pluginDir>/server.ts, so mirror the entry at the tree root.
  await writeIfChanged(path.join(dir, 'server.ts'), OPENCODE_SERVER_SHIM, { dryRun, verbose });
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
  await fixOpencodeEntry();
  console.log('  Doctor --fix: restoring plugin extension files');
  const pluginExtDir = path.join(pluginsDir, 'node_modules', '@krtclcdy', 'tersio', 'extensions');
  await fs.mkdir(pluginExtDir, { recursive: true });

  // Rule bodies are never overwritten: they can be newer upstream fetches.
  const ruleFile = (f: string) => /^caveman-session\/rule.*\.md$/.test(f);
  for (const file of TREE_FILES) {
    const dest = path.join(pluginExtDir, ...file.split('/'));
    if (ruleFile(file) && existsSync(dest)) continue;
    const text = await readTextIfExists(sourcePath(file));
    if (text === null) sayTagged(`  [warn] bundled source missing: ${sourcePath(file)}`);
    else await writeIfChanged(dest, text, { dryRun, verbose });
  }

  // Writing is not atomic, so re-read rather than assume the tree is whole.
  if (dryRun) return;
  const missing = TREE_FILES.filter((file) => !existsSync(path.join(pluginExtDir, ...file.split('/'))));
  if (missing.length > 0) sayTagged(`  [fail] tree incomplete: ${missing.join(', ')}`);
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
  await removeExtensionFromConfig(configPath, path.join(extDir, 'combo-toggle', 'index.ts'), 'manifest-loaded combo', { dryRun, verbose });
  await removeExtensionFromConfig(configPath, ponytailExtPath, 'manifest-loaded ponytail', { dryRun, verbose });
  await removeExtensionFromConfig(configPath, path.join(extDir, 'shared', 'mode-reinforcement.ts'), 'retired mode reinforcement', { dryRun, verbose });
  const pkgPath = path.join(pluginsDir, 'package.json');
  const pkg = await readPluginsPackage(pkgPath);
  if (!(PACKAGE_NAME in pkg.dependencies)) {
    pkg.dependencies[PACKAGE_NAME] = `^${PACKAGE_VERSION}`;
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
}

async function fixPonytail(pluginsDir: string): Promise<void> {
  console.log('  Doctor --fix: restoring bundled Ponytail');
  await fs.mkdir(pluginsDir, { recursive: true });
  const pkgPath = path.join(pluginsDir, 'package.json');
  const pkg = await readPluginsPackage(pkgPath);
  // Drop the legacy separate entry: ponytail is a tersio dependency now.
  if ('@dietrichgebert/ponytail' in pkg.dependencies) {
    delete pkg.dependencies['@dietrichgebert/ponytail'];
    console.log('  [migrate] dropped separate @dietrichgebert/ponytail dependency (now bundled with tersio)');
  }
  if (!(PACKAGE_NAME in pkg.dependencies)) pkg.dependencies[PACKAGE_NAME] = `^${PACKAGE_VERSION}`;
  if (dryRun) {
    console.log('  [dry-run] would run: npm install --no-audit --no-fund (in plugins dir)');
    return;
  }
  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  await execNetwork('Restoring bundled Ponytail', 'npm', ['install', '--no-audit', '--no-fund'], { cwd: pluginsDir, timeout: 180000 }).catch((e) => {
    throw new Error(`bundled ponytail restore failed: ${(e as Error).message}`);
  });
}

async function fixCli(): Promise<void> {
  console.log('  Doctor --fix: updating CLI + add-ons');
  await runLatestUpdate();
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
  return failed;
}

export { runDoctorRepairs };

export type { FixTarget };