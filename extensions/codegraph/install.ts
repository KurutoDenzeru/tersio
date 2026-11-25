import { execFile as execFileCallback } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { homeDir, isRecord, shimCommand, tersioHome } from '../shared/utils.ts';

const execFile = promisify(execFileCallback);
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const SUPPORTED_PLATFORMS = ['linux', 'darwin', 'win32'];
const SUPPORTED_ARCHITECTURES = ['x64', 'arm64'];
const INSTALL_TIMEOUT_MS = 300_000;
const SMOKE_TIMEOUT_MS = 30_000;

async function bundleExists(packageRoot: string): Promise<boolean> {
  try {
    await fs.access(path.join(packageRoot, 'lib', 'dist', 'index.js'));
    await fs.access(path.join(packageRoot, process.platform === 'win32' ? 'node.exe' : 'node'));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function isExistingBundle(destination: string): Promise<boolean> {
  try {
    await fs.lstat(destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  if (!(await bundleExists(destination))) throw new Error(`Existing CodeGraph bundle is incomplete: ${destination}`);
  return true;
}

async function readMetadata(packageRoot: string): Promise<{ name: string; version: string }> {
  const value: unknown = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  if (!isRecord(value)) throw new Error('CodeGraph package.json must contain an object');
  const metadata = value;
  if (metadata.name !== `@colbymchenry/codegraph-${process.platform}-${process.arch}`) {
    throw new Error(`Unexpected CodeGraph package name: ${String(metadata.name)}`);
  }
  if (typeof metadata.version !== 'string' || !VERSION_PATTERN.test(metadata.version)) {
    throw new Error(`Invalid CodeGraph package version: ${String(metadata.version)}`);
  }
  return { name: metadata.name, version: metadata.version };
}

async function verifyBundle(root: string, expected?: string, signal?: AbortSignal): Promise<string> {
  if (!(await bundleExists(root))) throw new Error('CodeGraph bundle is missing its entry or bundled Node runtime.');
  const metadata = await readMetadata(root);
  if (expected !== undefined && metadata.version !== expected) {
    throw new Error(`Installed CodeGraph version ${metadata.version} does not match requested ${expected}.`);
  }
  const node = path.join(root, process.platform === 'win32' ? 'node.exe' : 'node');
  const entry = path.join(root, 'lib', 'dist', 'index.js');
  const smokeRoot = await fs.mkdtemp(path.join(tersioHome(), 'codegraph', 'bundles', '.check-'));
  try {
    await execFile(
      node,
      [
        '--liftoff-only',
        '-e',
        `const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const Graph = require(process.argv[1]).CodeGraph;
  if (typeof Graph?.init !== 'function' || typeof Graph.open !== 'function') throw new Error('CodeGraph SDK is incompatible');
  for (const method of ['indexAll', 'sync', 'getStats', 'getNodesByName', 'getCallers', 'getImpactRadius', 'watch', 'unwatch', 'close']) {
    if (typeof Graph.prototype[method] !== 'function') throw new Error('CodeGraph SDK is incompatible: ' + method);
  }
  fs.mkdirSync(path.join(process.argv[2], '.git'));
  fs.writeFileSync(path.join(process.argv[2], 'sample.ts'), 'export function sample() { return 1; }');
  const graph = await Graph.init(process.argv[2]);
  try {
    await graph.indexAll();
    if ((await graph.getStats()).fileCount < 1) throw new Error('CodeGraph smoke index is empty');
  } finally {
    graph.close();
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });`,
        entry,
        smokeRoot,
      ],
      { timeout: SMOKE_TIMEOUT_MS, windowsHide: true, signal },
    );
  } finally {
    await fs.rm(smokeRoot, { recursive: true, force: true });
  }
  return metadata.version;
}

const NPMJS_REGISTRY = 'https://registry.npmjs.org';

/** The registry the bundle comes from: npmjs unless TERSIO_CODEGRAPH_REGISTRY names a mirror (for networks that block npmjs). */
export function codegraphRegistry(): string {
  const raw = process.env.TERSIO_CODEGRAPH_REGISTRY?.trim();
  if (!raw) return NPMJS_REGISTRY;
  // The value reaches `npm.cmd` through cmd.exe on Windows, so anything cmd treats as syntax is refused.
  let valid = !/[\s&|^<>%"']/.test(raw);
  if (valid) {
    try {
      valid = /^https?:$/.test(new URL(raw).protocol);
    } catch {
      valid = false;
    }
  }
  if (!valid) {
    process.emitWarning(`TERSIO_CODEGRAPH_REGISTRY is not a plain http(s) URL, so ${NPMJS_REGISTRY} is used instead.`, {
      code: 'TERSIO_CODEGRAPH_REGISTRY',
    });
    return NPMJS_REGISTRY;
  }
  return raw.replace(/\/+$/, '');
}

/**
 * Tersio's standing choice: CodeGraph's upstream telemetry stays off, for every process Tersio runs
 * and for the CLI the bundle exposes on PATH. The file is upstream's own consent store, so the bare
 * CLI reads it too; the pending queue goes with it, the way upstream's opt-out deletes unsent data.
 */
export async function disableCodeGraphTelemetry(): Promise<void> {
  const dir = path.join(homeDir(), '.codegraph');
  const configPath = path.join(dir, 'telemetry.json');
  try {
    const parsed = JSON.parse(await fs.readFile(configPath, 'utf8')) as unknown;
    if (isRecord(parsed) && parsed.enabled === false) return;
  } catch {
    /* no stored choice yet */
  }
  try {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    // The shape upstream's readConfig accepts; machine_id null pairs with enabled false.
    await fs.writeFile(
      configPath,
      `${JSON.stringify(
        {
          enabled: false,
          machine_id: null,
          consent_source: 'tersio',
          first_run_notice_shown: true,
          updated_at: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
  } catch {
    return;
  }
  try {
    for (const name of await fs.readdir(dir)) {
      if (name === 'telemetry-queue.jsonl' || name.startsWith('telemetry-queue.sending.')) {
        await fs.rm(path.join(dir, name), { force: true });
      }
    }
  } catch {
    /* a queue that cannot be read was never ours to send */
  }
}

export async function installCodeGraphBundle(version?: string, signal?: AbortSignal): Promise<string> {
  const installed = await installBundleStage(version, signal);
  // Tersio keeps CodeGraph's upstream telemetry off, for the bundle and the CLI linked beside it.
  await disableCodeGraphTelemetry();
  return installed;
}

async function installBundleStage(version?: string, signal?: AbortSignal): Promise<string> {
  if (!SUPPORTED_PLATFORMS.includes(process.platform) || !SUPPORTED_ARCHITECTURES.includes(process.arch)) {
    throw new Error(`Unsupported CodeGraph platform: ${process.platform}-${process.arch}`);
  }
  if (version !== undefined && !VERSION_PATTERN.test(version)) {
    throw new Error(`Invalid CodeGraph version: ${version}`);
  }

  const target = `${process.platform}-${process.arch}`;
  const bundlesDir = path.join(tersioHome(), 'codegraph', 'bundles');
  await fs.mkdir(bundlesDir, { recursive: true });
  if (version) {
    const existing = path.join(bundlesDir, `${target}-${version}`);
    if (await isExistingBundle(existing)) return await verifyBundle(existing, version, signal);
  }
  const stage = await fs.mkdtemp(path.join(bundlesDir, '.codegraph-'));
  try {
    const packageName = `@colbymchenry/codegraph-${target}`;
    const packageRoot = path.join(stage, 'node_modules', '@colbymchenry', `codegraph-${target}`);
    const npmArgs = [
      'install',
      '--prefix',
      stage,
      '--no-save',
      '--no-package-lock',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--no-progress',
      `--registry=${codegraphRegistry()}`,
      `${packageName}@${version ?? 'latest'}`,
    ];
    const npm = shimCommand(process.platform === 'win32' ? 'npm.cmd' : 'npm', npmArgs);
    await execFile(npm.cmd, npm.args, { timeout: INSTALL_TIMEOUT_MS, windowsHide: true, signal });
    const installed = await verifyBundle(packageRoot, version, signal);
    const destination = path.join(bundlesDir, `${target}-${installed}`);
    if (await isExistingBundle(destination)) return await verifyBundle(destination, installed, signal);
    try {
      await fs.rename(packageRoot, destination);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if ((code !== 'EEXIST' && code !== 'ENOTEMPTY') || !(await isExistingBundle(destination))) throw error;
      return await verifyBundle(destination, installed, signal);
    }
    return installed;
  } finally {
    // Windows keeps a spawned node.exe locked a beat after exit, so the smoke check's binary can still
    // be held when the stage is swept; the retries ride out that window.
    await fs.rm(stage, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
