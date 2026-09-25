// cli/agents.ts — which coding-agent hosts Tersio installs into, and how each
// is detected.
//
// The host list itself lives in cli/agent-hosts.ts, which carries each host's
// docs-backed paths and capabilities. This module owns the *choice*: what the
// user picked, what gets auto-detected, and where that is persisted.
//
// The choice is persisted in ~/.tersio/agents.json rather than the omp plugin
// lock file, because the lock file is OMP's own state and an OpenCode-only user
// has no omp plugin to hang settings off. A durable record is also what lets
// doctor stay quiet about a host the user deliberately opted out of, instead of
// warning forever about something they chose not to install.

import { existsSync, readFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HOSTS, byId } from './agent-hosts.ts';
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

/**
 * Resolve a host-relative path (`<configDir>/...`) to an absolute one,
 * honoring the host's own relocation env var. Registry paths are all
 * `$HOME`-relative, so a host that relocates needs its prefix swapped.
 */
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

/**
 * Hosts from the stored choice, or null when nothing valid is stored. Null is
 * distinct from an empty list on purpose: "no record" means ask or detect,
 * while an empty list means the user explicitly chose no optional hosts.
 */
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
 * config dir already exists. Keeps `install --yes`, reinstall, and CI behaving
 * exactly as they did before the prompt existed — a host nobody installed
 * never gets a directory created for it.
 *
 * OMP is special-cased to always be included: it is the flagship host and the
 * installer has always created ~/.omp even where omp is not yet installed, so
 * gating it on directory detection would regress fresh machines.
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

/** Menu rows for the install multiselect, one per host we can actually install. */
export function agentChoices(): Array<{ value: string; label: string; hint: string }> {
  return HOSTS.map((h) => ({
    value: h.id,
    label: h.label,
    hint: [
      h.rules ? 'rules pack' : null,
      h.skills ? 'skills' : null,
      h.rewrite ? 'rtk auto-rewrite' : 'rtk guidance only',
    ].filter(Boolean).join(' · '),
  }));
}

function labelFor(id: AgentId): string {
  return byId(id)?.label ?? id;
}

export { HOSTS, byId, labelFor };
export type { AgentHost, AgentId };
