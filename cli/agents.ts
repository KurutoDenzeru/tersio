// cli/agents.ts — which hosts Tersio installs into, and how each is detected.
// Host paths and capabilities live in cli/agent-hosts.ts; this owns the choice.
//
// The choice goes in ~/.tersio/agents.json, not the omp lock file: a non-OMP
// user has no omp plugin to hang settings off, and a durable record is what lets
// doctor stay quiet about a host the user opted out of.

import { existsSync, readFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HOSTS, OWN_PATH_HOSTS, byId } from './agent-hosts.ts';
import type { AgentHost } from './agent-hosts.ts';
type AgentId = string;

function home(): string {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

function agentsFile(): string {
  return path.join(home(), '.tersio', 'agents.json');
}

function isAgent(value: unknown): value is AgentId {
  return typeof value === 'string' && byId(value) !== undefined;
}

/** Dedupe and drop anything unknown, so a hand-edited file cannot crash install. */
function sanitize(values: unknown): AgentId[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<AgentId>();
  for (const v of values) if (isAgent(v)) seen.add(v);
  return [...seen];
}

/** Resolve a host's config dir, honoring its own relocation env var. */
export function hostConfigDir(host: AgentHost): string {
  if (host.configDirEnv) {
    const relocated = process.env[host.configDirEnv];
    if (relocated) return relocated;
  }
  return path.join(home(), host.configDir);
}

/** Resolve a host-relative path, swapping the `$HOME` prefix for a relocated one. */
export function hostPath(host: AgentHost, relPath: string): string {
  const prefix = host.configDir;
  if (host.configDirEnv) {
    const relocated = process.env[host.configDirEnv];
    if (relocated) {
      return relPath.startsWith(`${prefix}/`) || relPath === prefix
        ? path.join(relocated, relPath.slice(prefix.length).replace(/^\//, ''))
        : path.join(relocated, relPath);
    }
  }
  return path.join(home(), relPath);
}

/** Hosts the user selected, or auto-detected when nothing is stored. */
export function selectedHosts(): AgentId[] {
  return storedAgents() ?? detectedAgents();
}

/** True when this host looks installed on the current machine. */
export function isHostPresent(host: AgentHost): boolean {
  return existsSync(hostConfigDir(host));
}

/** The stored choice, or null when there is no usable record. Null is distinct
 * from an empty list: "no record" means ask or detect, empty means the user
 * deliberately chose no optional hosts. */
export function storedAgents(): AgentId[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(agentsFile(), 'utf8') || '{}');
  } catch {
    return null;
  }
  const agents = sanitize((parsed as { agents?: unknown } | null)?.agents);
  return agents.length > 0 ? agents : null;
}

/**
 * Hosts to install for when nothing was chosen: every supported host whose
 * config dir already exists, so a host nobody installed never gets a directory
 * created for it.
 *
 * OMP is always included — the installer has always created ~/.omp even where
 * omp is not installed, so gating it on detection would regress fresh machines.
 */
export function detectedAgents(): AgentId[] {
  const detected = HOSTS.filter(isHostPresent).map((h) => h.id);
  return detected.includes('omp') ? detected : ['omp', ...detected];
}

export async function writeAgents(agents: AgentId[]): Promise<void> {
  const target = agentsFile();
  const payload = { agents: sanitize(agents), updatedAt: new Date().toISOString() };
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

/** Removes the stored choice so the next install re-detects. */
export async function clearAgents(): Promise<void> {
  await fs.rm(agentsFile(), { force: true });
}

/**
 * Menu rows for the install multiselect. The hint says what the host actually
 * gets, kept short: in an 80-column terminal a wrapping hint turns one row into
 * three lines and pushes the rest of the list into pagination.
 */
export function hostHint(host: AgentHost): string {
  const parts: string[] = [];
  if (OWN_PATH_HOSTS.includes(host.id)) parts.push('live');
  else {
    if (host.rules) parts.push('rules');
    if (host.skills) parts.push('skills');
  }
  parts.push(host.rewrite ? 'rtk hook' : 'rtk guidance');
  return isHostPresent(host) ? `${parts.join(' · ')} ✓` : parts.join(' · ');
}

export function agentChoices(): Array<{ value: string; label: string; hint: string }> {
  return HOSTS.map((h) => ({ value: h.id, label: h.label, hint: hostHint(h) }));
}

function labelFor(id: AgentId): string {
  return byId(id)?.label ?? id;
}

export { HOSTS, byId, labelFor };
export type { AgentHost, AgentId };
