// cli/agents.ts — host selection, persistence, and the filesystem side of
// writing a host's files.
//
// Split from the OMP install path on purpose: install.ts, uninstall.ts, and
// doctor.ts are all built around ~/.omp, and routing eleven other hosts through
// them would mean rewriting the working OMP path to suit them. This module owns
// the generic half, and each command calls into it.
//
// The OMP path is untouched. omp and opencode are listed here for selection and
// detection only — their rewrite is owned by cli/rtk-wiring.ts and
// cli/opencode-wiring.ts, so this module writes their rules and skills only if
// the registry names a path, and never a hook.
//
// Deliberately free of cli/common.ts imports (argv side effects) so tests can
// load it directly. `home` is always passed in rather than read from the
// environment, so a test can point it at a throwaway directory.
import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import path from 'node:path';
import { HOSTS, byId, hasStaticHook, isLiveExtension, isOwnPath, type AgentHost } from './agent-hosts.ts';
import { planHost, removeFromHookConfig, type HostArtifact, type HostPlan } from './host-writers.ts';
import { removeMarkedBlock, START, END } from './rules-pack.ts';

const SELECTION_FILE = 'agents.json';

interface Selection {
  hosts: string[];
  updatedAt: number;
}

function selectionPath(home: string): string {
  return path.join(home, '.tersio', SELECTION_FILE);
}

/** Host ids only, in registry order, de-duplicated, unknown ids dropped. */
export function normalizeIds(ids: readonly string[]): string[] {
  const wanted = new Set(ids);
  return HOSTS.filter((h) => wanted.has(h.id)).map((h) => h.id);
}

/** One row in the agent menu, with a hint naming the wiring the host will get. */
export interface AgentChoice {
  value: string;
  label: string;
  hint: string;
}

/** What a host's rewrite will actually be, so the menu can say so up front. */
function wiringHint(host: AgentHost): string {
  if (hasStaticHook(host)) return 'hook · auto-rewrite';
  if (isLiveExtension(host)) {
    if (host.rewriteOwner === 'plugin') return 'plugin · auto-rewrite';
    return 'rtk extension · auto-rewrite';
  }
  return 'guidance only · no auto-rewrite';
}

/** The agent menu, in registry order, with the reference host first. */
export function agentChoices(): AgentChoice[] {
  return HOSTS.map((host) => ({
    value: host.id,
    label: host.label,
    hint: host.id === 'omp' ? `reference host · ${wiringHint(host)}` : wiringHint(host),
  }));
}

export type AskAgents = () => Promise<string[] | null>;

export type SelectionSource = 'flag' | 'prompt' | 'auto' | 'none';

export interface SelectionResult {
  ids: string[];
  source: SelectionSource;
  /** Hosts present on the machine that the stored set did not mention. */
  addedByDetection: string[];
}

/**
 * Resolves which hosts a run acts on.
 *
 * Precedence: an explicit `--agent` wins outright, even when a host is not
 * installed, because naming a host you do not have yet is how you install it.
 * Failing that, an interactive prompt when one is available. Failing that, the
 * union of the saved set and what is detected.
 *
 * That last step is a union rather than "saved wins", and it is deliberate. A
 * saved choice is a preference, not evidence of what is installed: returning it
 * verbatim meant a host that was present and running, but never ticked in an
 * earlier menu, was silently skipped and never written. The prompt is still
 * seeded with the union so those hosts are visible and pre-ticked rather than
 * invisible.
 */
export async function resolveAgentSelection(opts: {
  flag?: readonly string[];
  stored: readonly string[];
  detected: readonly string[];
  ask?: AskAgents;
}): Promise<SelectionResult> {
  const fromFlag = normalizeIds(opts.flag ?? []);
  if (fromFlag.length > 0) {
    return { ids: fromFlag, source: 'flag', addedByDetection: [] };
  }

  const stored = normalizeIds(opts.stored);
  const detected = normalizeIds(opts.detected);
  const union = normalizeIds([...stored, ...detected]);
  const addedByDetection = union.filter((id) => !stored.includes(id));

  if (opts.ask) {
    const answer = await opts.ask();
    if (answer !== null) {
      return { ids: normalizeIds(answer), source: 'prompt', addedByDetection };
    }
  }

  return { ids: union, source: union.length > 0 ? 'auto' : 'none', addedByDetection };
}

export function readSelection(home: string): Selection {
  try {
    const raw = fsSync.readFileSync(selectionPath(home), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return { hosts: [], updatedAt: 0 };
    const record = parsed as Record<string, unknown>;
    const hosts = Array.isArray(record.hosts) ? record.hosts.filter((h): h is string => typeof h === 'string') : [];
    const updatedAt = typeof record.updatedAt === 'number' ? record.updatedAt : 0;
    return { hosts: normalizeIds(hosts), updatedAt };
  } catch {
    return { hosts: [], updatedAt: 0 };
  }
}

export function writeSelection(home: string, ids: readonly string[]): void {
  const target = selectionPath(home);
  fsSync.mkdirSync(path.dirname(target), { recursive: true });
  const payload: Selection = { hosts: normalizeIds(ids), updatedAt: Date.now() };
  fsSync.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

/**
 * Hosts that look present on this machine: a config dir, or a binary on PATH.
 * Detection only widens the default set — it never overrides a host the user
 * named explicitly, and it never includes a host whose directory is empty.
 */
export function detectHosts(home: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const found: string[] = [];
  for (const host of HOSTS) {
    if (isOwnPath(host)) continue;
    const dir = path.join(home, host.configDir);
    let hasDir = false;
    try {
      hasDir = fsSync.statSync(dir).isDirectory();
    } catch { /* absent is the normal case */ }
    if (hasDir) {
      found.push(host.id);
      continue;
    }
    const relocated = host.configDirEnv ? env[host.configDirEnv] : undefined;
    const onPath = relocated && relocated.trim() !== ''
      ? false
      : host.binaries.some((b) => hasBinary(b, env));
    if (onPath) found.push(host.id);
  }
  return found;
}

/**
 * Absolute path of a host's binary on PATH, or null when it is not installed.
 *
 * Shared with the dashboard so both agree on what "installed" means. The bare
 * `cmd` name is never probed on Windows, where it resolves to the system shell.
 */
export function findHostBinary(host: AgentHost, env: NodeJS.ProcessEnv = process.env): string | null {
  if (process.platform === 'win32') {
    const relocated = host.configDirEnv ? env[host.configDirEnv] : undefined;
    if (relocated && relocated.trim() !== '') return null;
  }
  const raw = env.PATH ?? env.Path ?? env.path ?? '';
  if (!raw) return null;
  const sep = process.platform === 'win32' ? ';' : ':';
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const binary of host.binaries) {
    if (process.platform === 'win32' && binary === 'cmd') continue;
    for (const dir of raw.split(sep)) {
      if (!dir) continue;
      for (const ext of exts) {
        const candidate = path.join(dir, binary + ext);
        try {
          if (fsSync.statSync(candidate).isFile()) return candidate;
        } catch { /* keep looking */ }
      }
    }
  }
  return null;
}

function hasBinary(name: string, env: NodeJS.ProcessEnv): boolean {
  // Never probe a bare `cmd` on Windows: it resolves to the system shell, so a
  // probe would report Command Code installed on every Windows machine.
  if (process.platform === 'win32' && name === 'cmd') return false;
  const raw = env.PATH ?? env.Path ?? env.path ?? '';
  if (!raw) return false;
  const sep = process.platform === 'win32' ? ';' : ':';
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of raw.split(sep)) {
    if (!dir) continue;
    for (const ext of exts) {
      try {
        if (fsSync.statSync(path.join(dir, name + ext)).isFile()) return true;
      } catch { /* keep looking */ }
    }
  }
  return false;
}

// --- applying --------------------------------------------------------------

export interface ApplyOptions {
  dryRun?: boolean;
  quiet?: boolean;
  /** Omit files whose content already matches, to keep reinstall quiet. */
  onlyChanged?: boolean;
}

export interface ApplyResult {
  host: AgentHost;
  written: string[];
  unchanged: string[];
  planned: string[];
}

/** True when a file tersio created itself, so deleting it cannot touch a user's. */
function isTersioOwned(absPath: string): boolean {
  const base = path.basename(absPath);
  return base.startsWith('tersio-') || base.startsWith('tersio.');
}

async function readIfExists(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

async function writeArtifact(
  artifact: HostArtifact,
  existing: string | null,
  options: ApplyOptions,
): Promise<{ path: string; changed: boolean }> {
  // Every merge mode is resolved by planHost against the file's current
  // content, so the artifact is written verbatim. The only decision left is
  // whether that differs from what is already on disk.
  const changed = artifact.content !== existing;
  if (options.dryRun) return { path: artifact.absPath, changed };
  if (!changed && options.onlyChanged) return { path: artifact.absPath, changed: false };
  await fs.mkdir(path.dirname(artifact.absPath), { recursive: true });
  if (changed) await fs.writeFile(artifact.absPath, artifact.content, 'utf8');
  return { path: artifact.absPath, changed };
}

/**
 * Writes one host's artifacts, reading the current state of the files it is
 * about to touch so a merge sees the user's real content.
 */
export async function applyHost(host: AgentHost, home: string, options: ApplyOptions = {}): Promise<ApplyResult> {
  const existing: { rulesFile?: string | null; hookConfig?: string | null } = {};
  if (host.rules && host.rulesFile) {
    existing.rulesFile = await readIfExists(path.join(home, host.rulesFile));
  }
  if (host.rewriteConfig) {
    existing.hookConfig = await readIfExists(
      path.join(home, host.rewriteConfig.configFile),
    );
  }

  const plan = planHost(host, home, existing);
  const result: ApplyResult = { host, written: [], unchanged: [], planned: [] };
  for (const artifact of plan.artifacts) {
    if (options.dryRun) {
      result.planned.push(artifact.absPath);
      continue;
    }
    const current = await readIfExists(artifact.absPath);
    const { changed } = await writeArtifact(artifact, current, options);
    (changed ? result.written : result.unchanged).push(artifact.absPath);
  }
  return result;
}

/** Applies several hosts, continuing past a failure so one bad host is not fatal. */
export async function applyHosts(
  ids: readonly string[],
  home: string,
  options: ApplyOptions = {},
): Promise<{ results: ApplyResult[]; errors: Array<{ host: string; error: string }> }> {
  const results: ApplyResult[] = [];
  const errors: Array<{ host: string; error: string }> = [];
  for (const id of normalizeIds(ids)) {
    const host = byId(id);
    if (!host) continue;
    try {
      results.push(await applyHost(host, home, options));
    } catch (e) {
      errors.push({ host: id, error: (e as Error).message });
    }
  }
  return { results, errors };
}

// --- removing --------------------------------------------------------------

export interface RemoveResult {
  host: AgentHost;
  removed: string[];
  /** Paths left in place because a user's own content remains. */
  kept: string[];
}

/**
 * Strips only tersio's own content, never a user's file.
 *
 * A merged file loses the marked block; if nothing of the user's is left, the
 * whole file goes. A file tersio created outright (a skill, a hook script) is
 * removed completely. A config file the user also owns keeps everything except
 * our entry, even when that leaves it nearly empty — deleting a user's
 * `settings.json` to tidy up one hook is not a trade worth making.
 */
export async function removeHost(host: AgentHost, home: string, options: ApplyOptions = {}): Promise<RemoveResult> {
  const plan = planHost(host, home);
  const result: RemoveResult = { host, removed: [], kept: [] };
  const event = host.rewriteConfig?.event;

  for (const artifact of plan.artifacts) {
    const current = await readIfExists(artifact.absPath);
    if (current === null) continue;

    if (options.dryRun) {
      result.removed.push(artifact.absPath);
      continue;
    }

    if (artifact.kind === 'rules' && artifact.merge === 'block') {
      const stripped = removeMarkedBlock(current, START, END);
      if (stripped === null) {
        await fs.rm(artifact.absPath, { force: true });
        result.removed.push(artifact.absPath);
      } else if (stripped !== current) {
        await fs.writeFile(artifact.absPath, stripped, 'utf8');
        result.removed.push(artifact.absPath);
      } else {
        result.kept.push(artifact.absPath);
      }
      continue;
    }

    if (artifact.kind === 'skill' || artifact.kind === 'hook-script') {
      // Skill dirs and the rewriter script are ours outright. Remove the
      // containing directory for a skill so no empty folder is left behind,
      // but never the shared parent — the user may keep their own skills there.
      const target = artifact.kind === 'skill' ? path.dirname(artifact.absPath) : artifact.absPath;
      await fs.rm(target, { recursive: true, force: true });
      result.removed.push(target);
      continue;
    }

    if (artifact.kind === 'hook-config' && artifact.merge === 'json' && event) {
      const next = removeFromHookConfig(current, event);
      if (next === current) {
        result.kept.push(artifact.absPath);
        continue;
      }
      // A config file we named is ours; one the user owns keeps its identity.
      if (isTersioOwned(artifact.absPath) && isEffectivelyEmptyHookConfig(next)) {
        await fs.rm(artifact.absPath, { force: true });
        result.removed.push(artifact.absPath);
      } else {
        await fs.writeFile(artifact.absPath, next, 'utf8');
        result.removed.push(artifact.absPath);
      }
      continue;
    }

    if (artifact.merge === 'whole' && isTersioOwned(artifact.absPath)) {
      await fs.rm(artifact.absPath, { force: true });
      result.removed.push(artifact.absPath);
      continue;
    }

    result.kept.push(artifact.absPath);
  }
  return result;
}

/**
 * True when a hook config no longer configures any hook. Used only to decide
 * whether a file *tersio named* can be deleted outright, so a vestigial
 * `version` key must not count as content. A file the user owns is never
 * deleted on this basis, whatever it contains.
 */
function isEffectivelyEmptyHookConfig(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object') return false;
    const hooks = (parsed as Record<string, unknown>).hooks;
    if (hooks === undefined) return true;
    return typeof hooks === 'object' && hooks !== null && Object.keys(hooks as Record<string, unknown>).length === 0;
  } catch {
    return false;
  }
}

export async function removeHosts(
  ids: readonly string[],
  home: string,
  options: ApplyOptions = {},
): Promise<{ results: RemoveResult[]; errors: Array<{ host: string; error: string }> }> {
  const results: RemoveResult[] = [];
  const errors: Array<{ host: string; error: string }> = [];
  for (const id of normalizeIds(ids)) {
    const host = byId(id);
    if (!host) continue;
    try {
      results.push(await removeHost(host, home, options));
    } catch (e) {
      errors.push({ host: id, error: (e as Error).message });
    }
  }
  return { results, errors };
}

// --- reporting -------------------------------------------------------------

export type HostRowStatus = 'ok' | 'warn' | 'missing' | 'guidance' | 'live';

export interface HostRow {
  host: AgentHost;
  status: HostRowStatus;
  detail: string;
  /** What doctor --fix would do, or null when there is nothing to repair. */
  repair: string | null;
  present: string[];
  missing: string[];
}

/**
 * Inspects a host and reports one row. This is what `tersio doctor` prints per
 * host, and `doctor --fix` drives off the same `repair` string, so a row can
 * never claim a repair that install would not perform.
 */
export function reportHost(host: AgentHost, home: string): HostRow {
  const plan: HostPlan = planHost(host, home);
  const present: string[] = [];
  const missing: string[] = [];
  for (const artifact of plan.artifacts) {
    if (existsSyncSafe(artifact.absPath)) present.push(artifact.absPath);
    else missing.push(artifact.absPath);
  }

  if (missing.length === 0) {
    return { host, status: healthyStatus(plan), detail: healthyDetail(plan), repair: null, present, missing };
  }

  const wantsHook = plan.artifacts.some((a) => a.kind === 'hook-config');
  const detail = wantsHook
    ? `${host.label}: ${missing.length} of ${plan.artifacts.length} files missing, including the rewrite hook`
    : `${host.label}: ${missing.length} of ${plan.artifacts.length} files missing`;
  return { host, status: 'warn', detail, repair: 'install', present, missing };
}

function healthyStatus(plan: HostPlan): HostRowStatus {
  if (plan.liveExtension) return 'live';
  if (plan.guidanceOnly) return 'guidance';
  return 'ok';
}

function healthyDetail(plan: HostPlan): string {
  const count = plan.artifacts.length;
  if (plan.liveExtension) {
    return `${plan.host.label}: ${count} files, rewrite owned by ${plan.host.rewriteOwner ?? 'a wiring module'}`;
  }
  if (plan.guidanceOnly) {
    return `${plan.host.label}: ${count} files, guidance only (no documented rewrite)`;
  }
  return `${plan.host.label}: ${count} files, rewrite hook installed`;
}

function existsSyncSafe(p: string): boolean {
  try {
    return fsSync.existsSync(p);
  } catch {
    return false;
  }
}

export function reportHosts(ids: readonly string[], home: string): HostRow[] {
  return normalizeIds(ids).flatMap((id) => {
    const host = byId(id);
    return host ? [reportHost(host, home)] : [];
  });
}

export { isEffectivelyEmptyHookConfig, isTersioOwned, selectionPath, writeArtifact };
