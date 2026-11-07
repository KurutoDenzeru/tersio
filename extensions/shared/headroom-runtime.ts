// Headroom's runtime, not its configuration. A durable switch points an agent at the local proxy,
// so the proxy has to answer before the switch is written; otherwise the agent talks to a dead port.
import { execFile, execFileSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { headroomProxyPort, headroomProxyUrl } from './headroom-proxy.ts';
import { homeDir, tersioHome } from './utils.ts';

export { headroomProxyPort, headroomProxyUrl };

const execFileP = promisify(execFile);
/** The wait window, read per call so a test or a wrapper can shorten it. */
function proxyWaitMs(): number {
  const configured = Number(process.env.TERSIO_HEADROOM_WAIT_MS ?? '');
  return Number.isFinite(configured) && configured > 0 ? configured : 20_000;
}

export interface HeadroomRuntimeResult {
  ok: boolean;
  detail: string;
}

/** One health request; a busy proxy can miss a single 1.5s window under load. */
async function proxyAnswers(): Promise<boolean> {
  try {
    const res = await fetch(new URL('/readyz', headroomProxyUrl()), {
      signal: AbortSignal.timeout(1_500),
      headers: { accept: 'application/json' },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** True when headroom's own health endpoint answers, which means traffic has somewhere to go. */
export async function headroomRuntimeUp(): Promise<boolean> {
  if (await proxyAnswers()) return true;
  await new Promise((resolve) => setTimeout(resolve, 400));
  return proxyAnswers();
}

/**
 * Every live `headroom proxy` process. Each copy holds hundreds of megabytes, and only the one on
 * this port serves the agents, so the list is what a stray is measured against.
 */
function parsePids(text: string): number[] {
  return text
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

export function headroomProxyPids(): number[] {
  try {
    if (process.platform === 'win32') {
      // No pgrep, and tasklist prints no command line; PowerShell can match on it.
      const script = "Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'python*' -and $_.CommandLine -like '*headroom.cli proxy*' } | ForEach-Object { $_.ProcessId }";
      return parsePids(execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 8_000, windowsHide: true }));
    }
    return parsePids(execFileSync('pgrep', ['-f', 'headroom.cli proxy'], { encoding: 'utf8', timeout: 3_000 }));
  } catch {
    return [];
  }
}

/** Stop proxies that answer nowhere useful: first politely, then for real. */
export function reapProxies(pids: number[]): void {
  for (const pid of pids) {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
  }
  const deadline = Date.now() + 2_000;
  let alive = new Set(pids);
  while (alive.size > 0 && Date.now() < deadline) {
    const seen = new Set(headroomProxyPids());
    alive = new Set(Array.from(alive).filter((pid) => seen.has(pid)));
    if (alive.size > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  for (const pid of alive) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  }
}

interface DeploymentProfile {
  profile: string;
  updated: string;
  proxyArgs: string[];
  manifestFile: string;
}

/** Deployment profiles that already own this port, newest first; starting one keeps headroom's service contract. */
function deploymentProfiles(port: number): DeploymentProfile[] {
  const dir = path.join(homeDir(), '.headroom', 'deploy');
  if (!existsSync(dir)) return [];
  const found: DeploymentProfile[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = path.join(dir, entry.name, 'manifest.json');
      if (!existsSync(file)) continue;
      try {
        const manifest = JSON.parse(readFileSync(file, 'utf8')) as {
          profile?: unknown;
          port?: unknown;
          updated_at?: unknown;
          proxy_args?: unknown;
        };
        if (manifest.port !== port) continue;
        const args = Array.isArray(manifest.proxy_args)
          ? manifest.proxy_args.filter((arg): arg is string => typeof arg === 'string')
          : [];
        found.push({
          profile: typeof manifest.profile === 'string' && manifest.profile.trim() !== '' ? manifest.profile : entry.name,
          updated: typeof manifest.updated_at === 'string' ? manifest.updated_at : '',
          proxyArgs: args,
          manifestFile: file,
        });
      } catch { /* a partial manifest is not a deployment we can start */ }
    }
  } catch {
    return [];
  }
  return found.toSorted((a, b) => b.updated.localeCompare(a.updated));
}

/** Replace one flag and its value, or append it when absent. */
function withFlag(args: string[], flag: string, value: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === flag) { i += 1; continue; }
    if (args[i]!.startsWith(`${flag}=`)) continue;
    out.push(args[i]!);
  }
  out.push(flag, value);
  return out;
}

/** Reuse the deployment's own flags, so a fallback start keeps its mode, backend, and limits. */
export function proxyArgsForDeployment(proxyArgs: string[], port: number, openAiTarget?: string | null): string[] {
  let base = proxyArgs.length ? [...proxyArgs] : ['--host', '127.0.0.1', '--port', String(port)];
  for (let i = 0; i < base.length; i += 1) {
    if (base[i] === '--port' && i + 1 < base.length) base[i + 1] = String(port);
    else if (base[i].startsWith('--port=')) base[i] = `--port=${port}`;
  }
  if (!base.some((arg) => arg === '--port' || arg.startsWith('--port='))) base.push('--port', String(port));
  if (!base.some((arg) => arg === '--host' || arg.startsWith('--host='))) base.push('--host', '127.0.0.1');
  if (openAiTarget) base = withFlag(base, '--openai-api-url', openAiTarget);
  return base;
}

/** Writes the gateway into a saved deployment, so a restart routes OpenAI traffic to it. */
function configureDeployment(entry: DeploymentProfile, target: string): boolean {
  try {
    const manifest = JSON.parse(readFileSync(entry.manifestFile, 'utf8')) as Record<string, unknown>;
    const before = JSON.stringify(manifest);
    const baseEnv = manifest.base_env && typeof manifest.base_env === 'object' ? manifest.base_env as Record<string, string> : {};
    baseEnv.OPENAI_TARGET_API_URL = target;
    manifest.base_env = baseEnv;
    manifest.proxy_args = withFlag(entry.proxyArgs.length ? entry.proxyArgs : [], '--openai-api-url', target);
    entry.proxyArgs = manifest.proxy_args as string[];
    const after = JSON.stringify(manifest);
    if (before === after) return false;
    writeFileSync(entry.manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

function tailOf(text: string): string {
  return text.trim().split('\n').filter(Boolean).slice(-2).join(' · ');
}

async function waitForRuntime(): Promise<boolean> {
  const deadline = Date.now() + proxyWaitMs();
  while (Date.now() < deadline) {
    if (await headroomRuntimeUp()) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

async function startRuntime(bin: string, openAiTarget?: string | null): Promise<HeadroomRuntimeResult> {
  const port = headroomProxyPort();
  const profiles = deploymentProfiles(port);
  let failure = '';
  for (const entry of profiles) {
    if (openAiTarget) configureDeployment(entry, openAiTarget);
    try {
      await execFileP(bin, ['install', 'start', '--profile', entry.profile], { timeout: 30_000, cwd: homeDir() });
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string };
      failure = tailOf(`${err.stdout ?? ''}\n${err.stderr ?? ''}`) || failure;
      continue;
    }
    if (await waitForRuntime()) return { ok: true, detail: `headroom deployment ${entry.profile} started` };
    failure = `deployment ${entry.profile} did not answer on ${headroomProxyUrl()}`;
  }
  // No saved deployment, or it could not start: headroom's own proxy is still the runtime its config expects.
  // Reuse the newest manifest's flags, so a fallback start does not silently drift from its mode or backend.
  let spawnFailure = '';
  try {
    const child = spawn(bin, ['proxy', ...proxyArgsForDeployment(profiles[0]?.proxyArgs ?? [], port, openAiTarget)], {
      detached: true,
      stdio: 'ignore',
      cwd: homeDir(),
    });
    // A missing binary reports through the error event, not a throw; without this it crashes the caller.
    child.on('error', (e: Error) => { spawnFailure = e.message; });
    child.unref();
  } catch (e) {
    return { ok: false, detail: failure || (e as Error).message };
  }
  if (spawnFailure) return { ok: false, detail: spawnFailure };
  if (await waitForRuntime()) return { ok: true, detail: 'headroom proxy started' };
  return { ok: false, detail: failure || `headroom did not answer on ${headroomProxyUrl()}` };
}

/**
 * One start at a time, across processes. Several agents launch together at login; without this, each
 * one reaps and starts, and headroom's deployment manager answers a busy port with a second proxy.
 */
function startLockFile(): string {
  return path.join(tersioHome(), 'headroom-start.lock');
}

function acquireStartLock(): boolean {
  const file = startLockFile();
  try { writeFileSync(file, String(process.pid), { flag: 'wx' }); return true; } catch { /* held */ }
  try {
    // A crashed start can leave the file behind; the wait window is the lifetime of a real start.
    if (Date.now() - statSync(file).mtimeMs > 30_000) {
      rmSync(file, { force: true });
      return acquireStartLock();
    }
  } catch { /* vanished between the two calls: try once more */ }
  return false;
}

function releaseStartLock(): void {
  try { rmSync(startLockFile(), { force: true }); } catch { /* already gone */ }
}

let pending: Promise<HeadroomRuntimeResult> | null = null;

/** Start headroom's runtime once, or report why it could not answer. Concurrent callers share one start. */
export async function ensureHeadroomRuntime(bin: string, openAiTarget?: string | null): Promise<HeadroomRuntimeResult> {
  if (await headroomRuntimeUp()) {
    if (!openAiTarget) return { ok: true, detail: 'headroom proxy already running' };
    const entry = deploymentProfiles(headroomProxyPort())[0];
    if (!entry || !configureDeployment(entry, openAiTarget)) return { ok: true, detail: 'headroom proxy already running' };
    try {
      await execFileP(bin, ['install', 'restart', '--profile', entry.profile], { timeout: 30_000, cwd: homeDir() });
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string };
      return { ok: false, detail: tailOf(`${err.stdout ?? ''}\n${err.stderr ?? ''}`) || 'headroom restart failed' };
    }
    return (await waitForRuntime())
      ? { ok: true, detail: `headroom deployment ${entry.profile} restarted with ${openAiTarget}` }
      : { ok: false, detail: `headroom did not answer on ${headroomProxyUrl()} after restart` };
  }
  if (pending) return pending;
  if (!acquireStartLock()) {
    // Another Tersio process is starting it: wait for that one instead of racing into a second proxy.
    return (await waitForRuntime())
      ? { ok: true, detail: 'headroom proxy started by another tersio process' }
      : { ok: false, detail: 'another tersio process is starting headroom' };
  }
  try {
    // Nothing answers on this port. A proxy that exists anyway is someone's (another port, another
    // tool), so it is never killed from here: starting a second one is what multiplies the memory.
    if (await headroomRuntimeUp()) return { ok: true, detail: 'headroom proxy already running' };
    if (headroomProxyPids().length > 0) {
      return { ok: false, detail: `a headroom proxy is already running on another port — run: tersio doctor --fix headroom (${headroomProxyUrl()})` };
    }
    pending = startRuntime(bin, openAiTarget).finally(() => { pending = null; });
    return await pending;
  } finally {
    releaseStartLock();
  }
}
