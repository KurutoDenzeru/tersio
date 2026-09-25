import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUN_BIN_DIR, OMP_AGENT_DIR, OMP_PLUGINS_DIR,
  PACKAGE_NAME, PACKAGE_VERSION, RTK_BINARY_NAME, removeExtensionFromConfig,
  dryRun, verbose,
  debug,
  execP, readPluginsPackage,
  writeIfChanged,
} from './common.ts';
import { execNetwork } from './interactive.ts';
import { wireRtkOmp, ensureRtkInConfig } from './rtk-wiring.ts';
import {
  CAVEMAN_REMOTE_RULE, RTK_RELEASE_API, RtkRelease, fetchJson, findFile, httpsGet,
  httpsDownload, parseChecksum, readTextIfExists, rtkPlatformSpec, sha256File,
} from '../extensions/lib/utils.ts';
import { runLatestUpdate } from './update.ts';

type FixTarget = 'extensions' | 'registrations' | 'rtk' | 'ponytail' | 'cli';
type FixRequest = FixTarget | 'all';

const EXT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'extensions');
const SOURCES: Array<[string, string]> = [
  [path.join(EXT_DIR, 'shared', 'session-state.ts'), path.join('shared', 'session-state.ts')],
  [path.join(EXT_DIR, 'shared', 'types.ts'), path.join('shared', 'types.ts')],
  [path.join(EXT_DIR, 'lib', 'utils.ts'), path.join('lib', 'utils.ts')],
  [path.join(EXT_DIR, 'shared', 'plugin-settings.ts'), path.join('shared', 'plugin-settings.ts')],
  [path.join(EXT_DIR, 'shared', 'usage-ledger.ts'), path.join('shared', 'usage-ledger.ts')],
  [path.join(EXT_DIR, 'shared', 'pricing.ts'), path.join('shared', 'pricing.ts')],
  [path.join(EXT_DIR, 'shared', 'carbon.ts'), path.join('shared', 'carbon.ts')],
  [path.join(EXT_DIR, 'caveman-session', 'index.ts'), path.join('caveman-session', 'index.ts')],
  [path.join(EXT_DIR, 'caveman-session', 'rule.md'), path.join('caveman-session', 'rule.md')],
  [path.join(EXT_DIR, 'rtk-session', 'index.ts'), path.join('rtk-session', 'index.ts')],
  [path.join(EXT_DIR, 'ai-addons-updater', 'index.ts'), path.join('ai-addons-updater', 'index.ts')],
  [path.join(EXT_DIR, 'combo-toggle', 'index.ts'), path.join('combo-toggle', 'index.ts')],
  [path.join(EXT_DIR, 'tersio-commands', 'index.ts'), path.join('tersio-commands', 'index.ts')],
];

async function fixExtensions(pluginsDir: string): Promise<void> {
  console.log('  Doctor --fix: restoring plugin extension files');
  const tersioPluginDir = path.join(pluginsDir, 'node_modules', '@krtclcdy', 'tersio');
  const pluginExtDir = path.join(tersioPluginDir, 'extensions');
  await fs.mkdir(pluginExtDir, { recursive: true });

  for (const [from, to] of SOURCES) {
    const text = await readTextIfExists(from);
    if (text === null) console.log(`  [warn] bundled source missing: ${from}`);
    else await writeIfChanged(path.join(pluginExtDir, to), text, { dryRun, verbose });
  }

  const ruleDest = path.join(pluginExtDir, 'caveman-session', 'rule.md');
  if ((await readTextIfExists(ruleDest)) === null) {
    const bundled = await readTextIfExists(path.join(EXT_DIR, 'caveman-session', 'rule.md'));
    if (bundled !== null) {
      await writeIfChanged(ruleDest, bundled, { dryRun, verbose });
    } else {
      const rule = await Promise.race([
        httpsGet(CAVEMAN_REMOTE_RULE).catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
      ]);
      if (rule !== null) await writeIfChanged(ruleDest, rule, { dryRun, verbose });
      else console.log('  [warn] Caveman rule unreachable and no bundled rule exists');
    }
  }
}

async function fixRegistrations(agentDir: string, pluginsDir: string): Promise<void> {
  console.log('  Doctor --fix: repairing config.yml registrations');
  const configPath = path.join(agentDir, 'config.yml');
  if ((await readTextIfExists(configPath)) === null) {
    if (dryRun) console.log(`  [dry-run] would create ${configPath}`);
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
    if (dryRun) console.log(`  [dry-run] would register ${PACKAGE_NAME} in ${pkgPath}`);
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
    console.log(`  [dry-run] would download a checksum-verified rtk to ${binDest} and wire it into OMP`);
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
    if (checks) {
      const expected = parseChecksum(checks, asset.name);
      if (expected && await sha256File(archivePath) !== expected) throw new Error(`checksum mismatch for ${asset.name}`);
      debug('RTK checksum verified');
    }
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
      if (!dryRun) console.log(`  [ok] ${label}`);
    } catch (e) {
      failed.push(label);
      console.log(`  [fail] ${label}: ${((e as Error).message || '').slice(0, 200)}`);
    }
  };
  if (want('extensions')) await attempt('extensions', () => fixExtensions(OMP_PLUGINS_DIR));
  if (want('registrations')) await attempt('registrations', () => fixRegistrations(OMP_AGENT_DIR, OMP_PLUGINS_DIR));
  if (want('rtk')) await attempt('rtk', () => fixRtk(BUN_BIN_DIR));
  if (want('ponytail')) await attempt('ponytail', () => fixPonytail(OMP_PLUGINS_DIR));
  if (want('cli')) await attempt('cli', fixCli);
  return failed;
}

export { runDoctorRepairs, FixTarget };