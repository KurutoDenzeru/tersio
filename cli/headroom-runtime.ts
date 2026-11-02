// Headroom's runtime, not its configuration. A durable switch points an agent at the local proxy,
// so the proxy has to answer before the switch is written; otherwise the agent talks to a dead port.
import { execFile, spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { HEADROOM_PORT } from '../extensions/shared/headroom-proxy.ts';
import { homeDir } from '../extensions/shared/utils.ts';

const execFileP = promisify(execFile);
const PROXY_WAIT_MS = 20_000;

export interface HeadroomRuntimeResult {
  ok: boolean;
  detail: string;
}

/** The URL the agents and the dashboard use; the same override the prompt block reads. */
export function headroomProxyUrl(): string {
  return (process.env.TERSIO_HEADROOM_PROXY_URL ?? `http://127.0.0.1:${HEADROOM_PORT}/`).trim();
}

function proxyPort(): number {
  try {
    const url = new URL(headroomProxyUrl());
    if (url.port) return Number(url.port);
  } catch { /* an invalid override falls back to headroom's default */ }
  return HEADROOM_PORT;
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

/** Deployment profiles that already own this port, newest first; starting one keeps headroom's service contract. */
function deploymentProfiles(port: number): string[] {
  const dir = path.join(homeDir(), '.headroom', 'deploy');
  if (!existsSync(dir)) return [];
  const found: Array<{ profile: string; updated: string }> = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = path.join(dir, entry.name, 'manifest.json');
      if (!existsSync(file)) continue;
      try {
        const manifest = JSON.parse(readFileSync(file, 'utf8')) as { profile?: unknown; port?: unknown; updated_at?: unknown };
        if (manifest.port !== port) continue;
        found.push({
          profile: typeof manifest.profile === 'string' && manifest.profile.trim() !== '' ? manifest.profile : entry.name,
          updated: typeof manifest.updated_at === 'string' ? manifest.updated_at : '',
        });
      } catch { /* a partial manifest is not a deployment we can start */ }
    }
  } catch {
    return [];
  }
  return found.toSorted((a, b) => b.updated.localeCompare(a.updated)).map((entry) => entry.profile);
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

async function startRuntime(bin: string): Promise<HeadroomRuntimeResult> {
  const port = proxyPort();
  let failure = '';
  for (const profile of deploymentProfiles(port)) {
    try {
      await execFileP(bin, ['install', 'start', '--profile', profile], { timeout: 30_000, cwd: homeDir() });
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string };
      failure = tailOf(`${err.stdout ?? ''}\n${err.stderr ?? ''}`) || failure;
      continue;
    }
    if (await waitForRuntime()) return { ok: true, detail: `headroom deployment ${profile} started` };
    failure = `deployment ${profile} did not answer on ${headroomProxyUrl()}`;
  }
  // No saved deployment, or it could not start: headroom's own proxy is still the runtime its config expects.
  try {
    const child = spawn(bin, ['proxy', '--host', '127.0.0.1', '--port', String(port)], {
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
export async function ensureHeadroomRuntime(bin: string): Promise<HeadroomRuntimeResult> {
  if (await headroomRuntimeUp()) return { ok: true, detail: 'headroom proxy already running' };
  if (pending) return pending;
  pending = startRuntime(bin).finally(() => { pending = null; });
  return pending;
}
