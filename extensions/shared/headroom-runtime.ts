// Headroom's runtime, not its configuration. A durable switch points an agent at the local proxy,
// so the proxy has to answer before the switch is written; otherwise the agent talks to a dead port.
import { execFile, execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  HEADROOM_UPSTREAM_ENV,
  HEADROOM_UPSTREAM_FLAG,
  headroomProxyPort,
  headroomProxyUrl,
  type HeadroomUpstreams,
  UPSTREAM_DIALECTS,
  upstreamEntries,
  upstreamMismatches,
} from './headroom-proxy.ts';
import { cacheGet, cachePut } from './cache-store.ts';
import { homeDir, resolveHeadroomBinary, tersioHome } from './utils.ts';

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

export function headroomProxyPids(port?: number): number[] {
  const pids = rawProxyPids();
  // A port scopes the list to the proxies Tersio owns, so another tool's proxy on another port is never stopped.
  return port === undefined ? pids : pids.filter((pid) => proxyPortOf(pid) === port);
}

/** The value of one flag in an argv, in `--flag value` or `--flag=value` form, or undefined when absent. */
function flagValue(args: string[], flag: string): string | undefined {
  const at = args.findIndex((arg) => arg === flag || arg.startsWith(`${flag}=`));
  if (at < 0) return undefined;
  return args[at] === flag ? args[at + 1] : args[at]!.slice(flag.length + 1);
}

/**
 * The upstreams the running proxy was started with, read from its live argv: the flags it was given,
 * not the saved deployment. A dialect whose flag is absent is left out, which means headroom's public
 * default. Null when no proxy on this port can be read, so nothing about it is proven.
 */
export function liveHeadroomUpstreams(port: number = headroomProxyPort()): HeadroomUpstreams | null {
  const pid = headroomProxyPids(port)[0];
  if (pid === undefined) return null;
  const argv = proxyArgvOf(pid);
  if (argv === null) return null;
  const args = argv.split(/\s+/);
  const live: HeadroomUpstreams = {};
  for (const dialect of UPSTREAM_DIALECTS) {
    const url = flagValue(args, HEADROOM_UPSTREAM_FLAG[dialect]);
    if (url) live[dialect] = url;
  }
  return live;
}

/**
 * Every live `headroom proxy` process, whatever port it serves. `pgrep -f` matches both the
 * console-script launcher and `python -m headroom.cli`; the interpreter check excludes shells.
 */
function rawProxyPids(): number[] {
  try {
    if (process.platform === 'win32') {
      const script =
        "Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'python*' -and $_.CommandLine -like '*headroom* proxy*' } | ForEach-Object { $_.ProcessId }";
      return parsePids(
        execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
          encoding: 'utf8',
          timeout: 8_000,
          windowsHide: true,
        }),
      );
    }
    return parsePids(
      execFileSync('pgrep', ['-f', 'headroom(\\.cli)? proxy'], { encoding: 'utf8', timeout: 3_000 }),
    ).filter(isPythonProcess);
  } catch {
    return [];
  }
}

/** Match the Python launcher in argv: `ps comm` reports `headroom` for console-script processes. */
function isPythonProcess(pid: number): boolean {
  const argv = proxyArgvOf(pid);
  return argv !== null && /(?:^|\/)python(?:\d+(?:\.\d+)*)?(?=\s)/i.test(argv) && /headroom(?:\.cli)? proxy/.test(argv);
}

/** The argv of one proxy process, or null when this platform will not say. */
function proxyArgvOf(pid: number): string | null {
  try {
    return process.platform === 'linux'
      ? readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\u0000').join(' ')
      : execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8', timeout: 3_000 });
  } catch {
    return null;
  }
}

/** The `--port` a proxy process was started with, or null when its argv does not say. */
function proxyPortOf(pid: number): number | null {
  const match = proxyArgvOf(pid)?.match(/--port[\s=]+(\d+)/);
  const port = match ? Number(match[1]) : NaN;
  return Number.isFinite(port) && port > 0 ? port : null;
}

/** Stop proxies that answer nowhere useful: first politely, then for real. */
export function reapProxies(pids: number[], waitMs = 2_000): void {
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
  const deadline = Date.now() + waitMs;
  let alive = new Set(pids);
  while (alive.size > 0 && Date.now() < deadline) {
    const seen = new Set(headroomProxyPids());
    alive = new Set(Array.from(alive).filter((pid) => seen.has(pid)));
    if (alive.size > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  for (const pid of alive) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* gone */
    }
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
          profile:
            typeof manifest.profile === 'string' && manifest.profile.trim() !== '' ? manifest.profile : entry.name,
          updated: typeof manifest.updated_at === 'string' ? manifest.updated_at : '',
          proxyArgs: args,
          manifestFile: file,
        });
      } catch {
        /* a partial manifest is not a deployment we can start */
      }
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
    if (args[i] === flag) {
      i += 1;
      continue;
    }
    if (args[i]!.startsWith(`${flag}=`)) continue;
    out.push(args[i]!);
  }
  out.push(flag, value);
  return out;
}

/** The measured floor of a running proxy; below this a machine cannot carry it. */
const HEADROOM_FLOOR_MB = 320;

/**
 * Total physical memory in MB, or null when the platform will not say. A machine that cannot carry
 * the proxy should not be handed a 320MB daemon it never asked for.
 */
function totalMemoryMb(): number | null {
  try {
    if (process.platform === 'darwin') {
      const bytes = Number(execFileSync('sysctl', ['-n', 'hw.memsize'], { encoding: 'utf8', timeout: 3_000 }).trim());
      return Number.isFinite(bytes) && bytes > 0 ? Math.round(bytes / 1048576) : null;
    }
    if (process.platform === 'linux') {
      const text = readFileSync('/proc/meminfo', 'utf8');
      const kb = Number(text.match(/^MemTotal:\s+(\d+)\s+kB/m)?.[1] ?? '');
      return Number.isFinite(kb) && kb > 0 ? Math.round(kb / 1024) : null;
    }
    if (process.platform === 'win32') {
      const out = execFileSync(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory'],
        { encoding: 'utf8', timeout: 8_000, windowsHide: true },
      );
      const bytes = Number(out.trim());
      return Number.isFinite(bytes) && bytes > 0 ? Math.round(bytes / 1048576) : null;
    }
  } catch {
    /* an unreadable total is not a refusal */
  }
  return null;
}

/**
 * A machine too small for the proxy is told so instead of being given one. Under 2GB the daemon is a
 * sixth of RAM before the agent runs, so the default is off and the reason is the measured floor.
 */
export function headroomFitsMachine(): { fits: boolean; detail: string; totalMb: number | null } {
  // An operator who knows their machine overrides the guess; the floor is still printed.
  if (process.env.TERSIO_HEADROOM_FORCE === '1')
    return { fits: true, detail: 'forced on by TERSIO_HEADROOM_FORCE', totalMb: totalMemoryMb() };
  const totalMb = totalMemoryMb();
  if (totalMb === null) return { fits: true, detail: 'memory size unknown, so the proxy is allowed', totalMb };
  return {
    fits: totalMb >= 2048,
    detail:
      totalMb >= 2048
        ? `${totalMb}MB total memory carries a ${HEADROOM_FLOOR_MB}MB proxy`
        : `${totalMb}MB total memory is too small for a ${HEADROOM_FLOOR_MB}MB proxy`,
    totalMb,
  };
}

/**
 * The bundled Kompress ONNX model costs about 326MB, and it loads at startup whether or not a turn ever
 * reaches it: measured on this machine, footprint falls from 600MB to 274MB with it off, and threads from
 * 23 to 9. The work is largely done by the cheaper engines that stay on: Code-Aware AST compression,
 * the compression cache, and CCR. One of 131 learned patterns had routed through Kompress, so the default
 * trades a model almost never used for a footprint every user pays. An explicit flag still wins.
 */
const HEADROOM_MEMORY_DEFAULTS: ReadonlyArray<{ flag: string; value: string; unless: readonly string[] }> = [
  // Turning the model back on is the opposite flag, so it has to count as "already chosen".
  { flag: '--disable-kompress', value: '', unless: ['--disable-kompress', '--enable-kompress'] },
];

/** Adds a bound only when the deployment has not already chosen, either way, so an explicit choice wins. */
function withDefaultFlag(args: string[], flag: string, value: string, unless: readonly string[]): string[] {
  const present = unless.some((name) => args.some((arg) => arg === name || arg.startsWith(`${name}=`)));
  if (present) return args;
  return value === '' ? [...args, flag] : [...args, flag, value];
}

/** Reuse the deployment's own flags, so a fallback start keeps its mode, backend, and limits. */
export function proxyArgsForDeployment(proxyArgs: string[], port: number, upstreams: HeadroomUpstreams = {}): string[] {
  let base = proxyArgs.length ? [...proxyArgs] : ['--host', '127.0.0.1', '--port', String(port)];
  for (let i = 0; i < base.length; i += 1) {
    if (base[i] === '--port' && i + 1 < base.length) base[i + 1] = String(port);
    else if (base[i].startsWith('--port=')) base[i] = `--port=${port}`;
  }
  if (!base.some((arg) => arg === '--port' || arg.startsWith('--port='))) base.push('--port', String(port));
  if (!base.some((arg) => arg === '--host' || arg.startsWith('--host='))) base.push('--host', '127.0.0.1');
  for (const [dialect, url] of upstreamEntries(upstreams)) base = withFlag(base, HEADROOM_UPSTREAM_FLAG[dialect], url);
  for (const bound of HEADROOM_MEMORY_DEFAULTS) base = withDefaultFlag(base, bound.flag, bound.value, bound.unless);
  return base;
}

/** Writes each requested upstream into a saved deployment, so a restart routes that dialect to it. */
function configureDeployment(entry: DeploymentProfile, upstreams: HeadroomUpstreams): boolean {
  try {
    const manifest = JSON.parse(readFileSync(entry.manifestFile, 'utf8')) as Record<string, unknown>;
    const before = JSON.stringify(manifest);
    const baseEnv =
      manifest.base_env && typeof manifest.base_env === 'object' ? (manifest.base_env as Record<string, string>) : {};
    let args = entry.proxyArgs.length ? entry.proxyArgs : [];
    for (const [dialect, url] of upstreamEntries(upstreams)) {
      baseEnv[HEADROOM_UPSTREAM_ENV[dialect]] = url;
      args = withFlag(args, HEADROOM_UPSTREAM_FLAG[dialect], url);
    }
    manifest.base_env = baseEnv;
    manifest.proxy_args = args;
    entry.proxyArgs = args;
    const after = JSON.stringify(manifest);
    if (before === after) return false;
    writeFileSync(entry.manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

async function waitForRuntime(): Promise<boolean> {
  const deadline = Date.now() + proxyWaitMs();
  while (Date.now() < deadline) {
    if (await headroomRuntimeUp()) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

/**
 * Start the proxy directly, not through `install start`. That command leaves a second Python
 * process running the profile for the life of the proxy, and it costs about 82MB to forward a
 * start. The flags the saved deployment recorded are reused, so the runtime keeps its mode,
 * backend, and upstream.
 */
async function startRuntime(bin: string, upstreams: HeadroomUpstreams = {}): Promise<HeadroomRuntimeResult> {
  const port = headroomProxyPort();
  const profiles = deploymentProfiles(port);
  if (upstreamEntries(upstreams).length > 0) {
    for (const entry of profiles) configureDeployment(entry, upstreams);
  }
  const args = proxyArgsForDeployment(profiles[0]?.proxyArgs ?? [], port, upstreams);
  let spawnFailure = '';
  try {
    const child = spawn(bin, ['proxy', ...args], {
      detached: true,
      stdio: 'ignore',
      cwd: homeDir(),
    });
    // A missing binary reports through the error event, not a throw; without this it crashes the caller.
    child.on('error', (e: Error) => {
      spawnFailure = e.message;
    });
    child.unref();
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
  if (spawnFailure) return { ok: false, detail: spawnFailure };
  if (await waitForRuntime()) {
    recordStartedProxy(port);
    return { ok: true, detail: 'headroom proxy started' };
  }
  // The direct start did not answer: fall back to headroom's own launcher, which knows its supervisor.
  for (const entry of profiles) {
    try {
      await execFileP(bin, ['install', 'start', '--profile', entry.profile], { timeout: 30_000, cwd: homeDir() });
    } catch {
      continue;
    }
    if (await waitForRuntime()) return { ok: true, detail: `headroom deployment ${entry.profile} started` };
  }
  return { ok: false, detail: `headroom did not answer on ${headroomProxyUrl()}` };
}

const START_LOCK_STALE_MS = 30_000;

/**
 * One start at a time, across processes. Several agents launch together at login; without this, each
 * one reaps and starts, and headroom's deployment manager answers a busy port with a second proxy.
 */
function startLockFile(): string {
  return path.join(tersioHome(), 'headroom-start.lock');
}

function startLockOwnerIsAlive(file: string): boolean {
  let pid: number;
  try {
    pid = Number(readFileSync(file, 'utf8').split(':', 1)[0]);
  } catch {
    return false;
  }
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}

function acquireStartLock(): string | null {
  const file = startLockFile();
  // The data home may not exist yet on a first run; `wx` above would fail with ENOENT and read as held.
  try {
    mkdirSync(path.dirname(file), { recursive: true });
  } catch {
    /* the write below reports the real problem */
  }
  const owner = `${process.pid}:${randomUUID()}`;
  try {
    writeFileSync(file, owner, { flag: 'wx' });
    return owner;
  } catch {
    /* held */
  }
  try {
    if (Date.now() - statSync(file).mtimeMs > START_LOCK_STALE_MS && !startLockOwnerIsAlive(file)) {
      const reclaimFile = `${file}.reclaim`;
      const reclaimOwner = `${process.pid}:${randomUUID()}`;
      const reclaimTemp = `${reclaimFile}.${randomUUID()}`;
      let ownsReclaimTemp = false;
      try {
        mkdirSync(reclaimTemp);
        ownsReclaimTemp = true;
        writeFileSync(path.join(reclaimTemp, 'owner'), reclaimOwner, { flag: 'wx' });
        if (existsSync(reclaimFile)) {
          rmSync(reclaimTemp, { recursive: true, force: true });
          return null;
        }
        renameSync(reclaimTemp, reclaimFile);
        ownsReclaimTemp = false;
      } catch {
        if (ownsReclaimTemp) rmSync(reclaimTemp, { recursive: true, force: true });
        // shortcut: an orphaned gate blocks recovery; remove it only after confirming no reclaimer remains.
        return null;
      }
      try {
        // Recheck under the gate; another contender may have replaced the stale lock already.
        if (Date.now() - statSync(file).mtimeMs <= START_LOCK_STALE_MS || startLockOwnerIsAlive(file)) return null;
        rmSync(file, { force: true });
        writeFileSync(file, owner, { flag: 'wx' });
        return owner;
      } finally {
        try {
          if (readFileSync(path.join(reclaimFile, 'owner'), 'utf8') === reclaimOwner)
            rmSync(reclaimFile, { recursive: true, force: true });
        } catch {
          /* a failed cleanup remains fail-closed */
        }
      }
    }
  } catch {
    /* vanished between the two calls: try once more */
  }
  return null;
}

function releaseStartLock(owner: string): void {
  const file = startLockFile();
  try {
    if (readFileSync(file, 'utf8') === owner) rmSync(file, { force: true });
  } catch {
    /* already gone or owned by another start */
  }
}

/** Stop every proxy this machine runs. The routes are put back before this is called. */
export async function stopHeadroomRuntime(
  bin?: string | null,
  options: { fast?: boolean } = {},
): Promise<HeadroomRuntimeResult> {
  const port = headroomProxyPort();
  // Only a proxy this data home started, or one a deployment here owns, is Tersio's to stop. Another
  // tool's proxy on the same default port, or one from a different home, is left running.
  const deployments = deploymentProfiles(port);
  if (deployments.length === 0 && !weStartedProxy(port))
    return { ok: true, detail: 'no headroom proxy of ours to stop' };
  const pids = headroomProxyPids(port);
  if (pids.length === 0) return { ok: true, detail: 'no headroom proxy was running' };
  // headroom's own stop releases the deployment it recorded, so a later start keeps its manifest.
  // A session quit has a 2s handler budget, so it skips the launcher and lets the reaper do the work.
  const binPath = bin === undefined ? resolveHeadroomBinary() : bin;
  if (binPath && !options.fast) {
    for (const entry of deployments) {
      try {
        await execFileP(binPath, ['install', 'stop', '--profile', entry.profile], { timeout: 30_000, cwd: homeDir() });
      } catch {
        /* the reaper below is the backstop */
      }
    }
  }
  const left = headroomProxyPids(port);
  if (left.length > 0) reapProxies(left, options.fast ? 400 : 2_000);
  const remaining = headroomProxyPids(port).length;
  if (remaining === 0) clearProxyRecord();
  return remaining === 0
    ? { ok: true, detail: `stopped ${pids.length} headroom proxy process(es)` }
    : { ok: false, detail: 'a headroom proxy is still running' };
}

/** What this data home started, so a proxy with no headroom deployment is still ours to stop. */
const PROXY_RECORD_KEY = 'headroom.proxy';

function recordStartedProxy(port: number): void {
  try {
    cachePut(PROXY_RECORD_KEY, JSON.stringify({ port, at: Date.now(), pid: process.pid }));
  } catch {
    /* the stop path falls back to a deployment lookup */
  }
}

function clearProxyRecord(): void {
  try {
    cachePut(PROXY_RECORD_KEY, '');
  } catch {
    /* already gone */
  }
}

/** True when this data home started the proxy on that port, with or without a headroom deployment. */
function weStartedProxy(port: number): boolean {
  const text = cacheGet(PROXY_RECORD_KEY);
  if (text === null || text === '') return false;
  try {
    const raw = JSON.parse(text) as { port?: unknown };
    return raw.port === port;
  } catch {
    return false;
  }
}

/**
 * A running agent's claim on the proxy. One proxy serves the machine, and every session refreshes its
 * own claim, so the newest timestamp says whether any agent is still alive. Without this, a proxy
 * started by a session that has since quit would hold its memory forever.
 */
const LEASE_KEY = 'headroom.leases';

/** How long a claim counts as live; a session that dies without a shutdown stops refreshing it. */
const LEASE_TTL_MS = 20 * 60_000;

function readLeases(): Record<string, number> {
  const text = cacheGet(LEASE_KEY);
  if (text === null) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function writeLeases(leases: Record<string, number>): void {
  try {
    cachePut(LEASE_KEY, JSON.stringify(leases));
  } catch {
    /* a claim that will not write only delays the stop */
  }
}

function writeLease(sessionId: string): void {
  const now = Date.now();
  const leases = readLeases();
  // A dead session's claim is dropped here, so the row cannot grow without bound.
  for (const [id, at] of Object.entries(leases)) {
    if (!Number.isFinite(at) || now - at > LEASE_TTL_MS) delete leases[id];
  }
  leases[sessionId] = now;
  writeLeases(leases);
}

function dropLease(sessionId: string): void {
  const leases = readLeases();
  delete leases[sessionId];
  writeLeases(leases);
}

/** Refresh this session's lease; a long session must not let it expire. */
export function touchHeadroomLease(sessionId: string): void {
  writeLease(sessionId);
}

/** Release the session claim, not the shared proxy that persistent model endpoints still reference. */
export async function releaseHeadroomLease(sessionId: string): Promise<HeadroomRuntimeResult> {
  dropLease(sessionId);
  return { ok: true, detail: 'session released; proxy kept for configured model routes' };
}

let pending: Promise<HeadroomRuntimeResult> | null = null;

/** Start headroom's runtime once, or report why it could not answer. Concurrent callers share one start. */
export async function ensureHeadroomRuntime(
  bin: string,
  upstreams: HeadroomUpstreams = {},
): Promise<HeadroomRuntimeResult> {
  if (await headroomRuntimeUp()) {
    // The saved deployment says nothing about what the running process forwards, so only its live argv counts.
    if (upstreamMismatches(upstreams, liveHeadroomUpstreams()).length === 0)
      return { ok: true, detail: 'headroom proxy already running' };
    return {
      ok: false,
      detail: 'shared headroom proxy has different upstreams; the existing runtime was left running',
    };
  }
  const startLockOwner = acquireStartLock();
  if (startLockOwner === null) {
    const reclaim = `${startLockFile()}.reclaim`;
    if (existsSync(reclaim) && !startLockOwnerIsAlive(path.join(reclaim, 'owner'))) {
      return {
        ok: false,
        detail: `headroom recovery is blocked by ${reclaim}; verify no reclaimer is active before removing it`,
      };
    }
    // Another Tersio process is starting it: wait for that one instead of racing into a second proxy.
    return (await waitForRuntime())
      ? { ok: true, detail: 'headroom proxy started by another tersio process' }
      : { ok: false, detail: 'another tersio process is starting headroom' };
  }
  try {
    // Nothing answers on this port. A proxy that exists anyway is someone's (another port, another
    // tool), so it is never killed from here: starting a second one is what multiplies the memory.
    if (await headroomRuntimeUp()) return { ok: true, detail: 'headroom proxy already running' };
    const port = headroomProxyPort();
    const running = headroomProxyPids();
    // Only a proxy whose argv names a different port belongs to someone else. One on this port is
    // mid-boot: it takes about nine seconds to bind, and starting a second beside it doubles the memory.
    // A pid whose port cannot be read is not attributable, so it never blocks a start.
    const elsewhere = running.filter((pid) => {
      const own = proxyPortOf(pid);
      return own !== null && own !== port;
    });
    if (elsewhere.length > 0) {
      return {
        ok: false,
        detail: `a headroom proxy is already running on another port — run: tersio doctor --fix headroom (${headroomProxyUrl()})`,
      };
    }
    if (running.length > 0) {
      return (await waitForRuntime())
        ? { ok: true, detail: 'headroom proxy was already starting on this port' }
        : { ok: false, detail: `a headroom proxy on ${headroomProxyUrl()} never answered` };
    }
    pending = startRuntime(bin, upstreams).finally(() => {
      pending = null;
    });
    return await pending;
  } finally {
    releaseStartLock(startLockOwner);
  }
}
