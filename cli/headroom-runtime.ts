// Headroom's runtime, not its configuration. A durable switch points an agent at the local proxy,
// so the proxy has to answer before the switch is written; otherwise the agent talks to a dead port.
import { execFile, spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { headroomProxyPort, headroomProxyUrl } from '../extensions/shared/headroom-proxy.ts';
import { homeDir } from '../extensions/shared/utils.ts';

export { headroomProxyPort, headroomProxyUrl };

const execFileP = promisify(execFile);
const PROXY_WAIT_MS = 20_000;

export interface HeadroomRuntimeResult {
  ok: boolean;
  detail: string;
}

/** True when headroom's own health endpoint answers, which means traffic has somewhere to go. */
export async function headroomRuntimeUp(): Promise<boolean> {
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
  const deadline = Date.now() + PROXY_WAIT_MS;
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
  try {
    const child = spawn(bin, ['proxy', ...proxyArgsForDeployment(profiles[0]?.proxyArgs ?? [], port, openAiTarget)], {
      detached: true,
      stdio: 'ignore',
      cwd: homeDir(),
    });
    child.unref();
  } catch (e) {
    return { ok: false, detail: failure || (e as Error).message };
  }
  if (await waitForRuntime()) return { ok: true, detail: 'headroom proxy started' };
  return { ok: false, detail: failure || `headroom did not answer on ${headroomProxyUrl()}` };
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
  pending = startRuntime(bin, openAiTarget).finally(() => { pending = null; });
  return pending;
}
