// cli/agents.ts — host selection, persistence, and the filesystem side of
// writing a host's files.
//
// Split from the OMP install path on purpose: install.ts, uninstall.ts, and
// doctor.ts are built around ~/.omp, and routing a dozen other hosts through
// them would mean rewriting the working OMP path to suit them. This module owns
// the generic half. The OMP path is untouched, and omp/opencode are listed here
// for selection and detection only — their rewrite belongs to cli/rtk-wiring.ts
// and cli/opencode-wiring.ts.
//
// Deliberately free of cli/common.ts imports (argv side effects) so tests can
// load it directly. `home` is always passed in rather than read from the
// environment, so a test can point it at a throwaway directory.
import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import path from 'node:path';
import { HOSTS, byId, hasStaticHook, isLiveExtension, isOwnPath, type AgentHost } from './agent-hosts.ts';
import { planHost, removeFromHookConfig, type ExistingHostFiles, type HostArtifact, type HostPlan } from './host-writers.ts';
import { removeMarkedBlock, START, END } from './rules-pack.ts';
import { reportOmpLayer } from './omp-layer.ts';
import { reportPiLayer } from './pi-layer.ts';

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
export function wiringHint(host: AgentHost): string {
  if (hasStaticHook(host)) return 'hook · auto-rewrite';
  if (isLiveExtension(host)) {
    if (host.rewriteOwner === 'plugin') return 'plugin · auto-rewrite';
    return 'rtk extension · auto-rewrite';
  }
  return 'guidance only · no auto-rewrite';
}

/** `$HOME`-relative form of a path, for previews that must stay readable. */
export function displayPath(target: string, home: string): string {
  if (!home) return target;
  const prefix = home.endsWith(path.sep) ? home : `${home}${path.sep}`;
  if (!target.startsWith(prefix)) return target;
  return `~/${target.slice(prefix.length).split(path.sep).join('/')}`;
}

/** Short, user-facing name for what a planned artifact is. */
const ARTIFACT_LABELS: Record<HostArtifact['kind'], string> = {
  rules: 'rules',
  skill: 'skill',
  'hook-config': 'hook config',
  'hook-script': 'rtk hook',
};


/**
 * What tersio has already put on this machine for one host. `installed` is what
 * the menu cares about: the difference between "this row is empty" and "this
 * row is already done".
 */
export interface HostInstallState {
  count: number;
  installed: boolean;
  /** True when `count` is extension directories rather than files. */
  dirs: boolean;
}

/**
 * The agent menu, in registry order. The install marker goes in the *label*,
 * not the hint: clack 1.8 renders a hint only on the cursor row and on ticked
 * rows, so anything in the hint was invisible on exactly the rows being
 * compared. Without `state` the rows are bare names, which is all the dashboard
 * needs — it has no filesystem to read.
 */
export function agentChoices(state?: ReadonlyMap<string, HostInstallState>): AgentChoice[] {
  return HOSTS.map((host) => {
    const info = state?.get(host.id);
    if (!info) {
      return {
        value: host.id,
        label: host.id === 'omp' ? `${host.label} (extensions + Ponytail)` : host.label,
        hint: wiringHint(host),
      };
    }
    const unit = info.dirs ? (info.count === 1 ? 'dir' : 'dirs') : (info.count === 1 ? 'file' : 'files');
    const mark = info.installed ? 'installed' : 'not installed';
    return {
      value: host.id,
      label: `${host.label} — ${info.count} ${unit} · ${mark}`,
      hint: wiringHint(host),
    };
  });
}

/**
 * The rows an uninstall menu should offer, given what is on disk. A host with
 * nothing of ours is not offered at all: a "Claude Code — 0 files · not
 * installed" row answers a question nobody asked. A host absent from `state` is
 * kept, because the dashboard calls agentChoices with no filesystem to read.
 */
export function installedRows(state: ReadonlyMap<string, HostInstallState>): AgentChoice[] {
  return agentChoices(state).filter((choice) => state.get(choice.value)?.installed !== false);
}

/**
 * What tersio has installed for each host, read from the filesystem. Both menus
 * seed from this, not from the saved selection: that file is a preference, so
 * it can name a host since cleaned by hand and omit one that is very much
 * installed. The disk is the only honest source.
 */
export function installedState(home: string): Map<string, HostInstallState> {
  const state = new Map<string, HostInstallState>();
  const counts = new Map(planRemove(HOSTS.map((h) => h.id), home).hosts.map((p) => [p.host.id, p.lines.length]));
  for (const host of HOSTS) {
    if (host.id === 'omp') continue;
    const count = counts.get(host.id) ?? 0;
    // Pi also owns an extension tree the generic emitters never see, so its
    // count is its files plus the directories the layer found.
    const layerDirs = host.id === 'pi' ? reportPiLayer(home, isDir).extensions.length : 0;
    const total = count + layerDirs;
    state.set(host.id, { count: total, installed: total > 0, dirs: layerDirs > 0 });
  }
  // Oh My Pi owns no host artifacts: its files are the layer's extension dirs.
  const layer = reportOmpLayer(home, isDir);
  const count = layer.extensions.length;
  state.set('omp', { count, installed: layer.installed && count > 0, dirs: true });
  return state;
}

/** Host ids tersio has already installed something for. */
export function installedHostIds(state: ReadonlyMap<string, HostInstallState>): string[] {
  return normalizeIds([...state].filter(([, info]) => info.installed).map(([id]) => id));
}

/** True when the path is a directory. The layer's artifacts are directories. */
function isDir(target: string): boolean {
  try {
    return fsSync.statSync(target).isDirectory();
  } catch {
    return false;
  }
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
 * Resolves which hosts a run acts on: an explicit `--agent` wins outright, even
 * for a host not installed, because naming one you do not have yet is how you
 * install it. Failing that a prompt, then the union of saved and detected.
 *
 * That last step is a union rather than "saved wins" because a saved choice is
 * a preference, not evidence: returning it verbatim silently skipped a host
 * that was present and running but never ticked. The prompt is seeded with the
 * union so those hosts are visible and pre-ticked.
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
  // content, so the artifact is written verbatim; the only decision left is
  // whether that differs from what is on disk.
  const changed = artifact.content !== existing;
  if (options.dryRun) return { path: artifact.absPath, changed };
  if (!changed && options.onlyChanged) return { path: artifact.absPath, changed: false };
  await fs.mkdir(path.dirname(artifact.absPath), { recursive: true });
  if (changed) await fs.writeFile(artifact.absPath, artifact.content, 'utf8');
  return { path: artifact.absPath, changed };
}

/** Writes one host's artifacts, reading the files it is about to touch first. */
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
 * Strips only tersio's own content, never a user's file. A merged file loses
 * the marked block and goes entirely if nothing of the user's is left; a file
 * tersio created outright (a skill, a hook script) is removed completely. A
 * config file the user also owns keeps everything but our entry, even when that
 * leaves it nearly empty — deleting a user's `settings.json` to tidy up one
 * hook is not a trade worth making.
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
      // A skill takes its containing directory so no empty folder is left
      // behind, but never the shared parent — the user may keep their own.
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
 * True when a hook config no longer configures any hook, so a vestigial
 * `version` key does not count as content. Decides only whether a file *tersio
 * named* can be deleted outright; a file the user owns never is.
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

// --- install planning -------------------------------------------------------

/** One line of the install plan: a label, a path, and whether it is new. */
export interface PlanLine {
  label: string;
  path: string;
  /** True when the file is not on disk yet, so the run creates it. */
  new: boolean;
}

export interface HostPlanPreview {
  host: AgentHost;
  /** The wiring this host will get, in the same words the menu used. */
  wiring: string;
  lines: PlanLine[];
}

export interface InstallPlan {
  /** The hosts the run writes, in registry order. */
  selected: AgentHost[];
  hosts: HostPlanPreview[];
  /** Total new files across every selected host. */
  newFiles: number;
  /** Files already correct, so the run leaves them alone. */
  unchanged: number;
}

/**
 * What an install will do to one host, as data. Built from `planHost` and the
 * live filesystem, so the preview and `applyHosts` can never disagree: both ask
 * the same planner for the same artifacts. A rewrite owned by a wiring module
 * (omp, opencode, pi) has no artifact here, so the plan says so in words.
 *
 * The decision is the one `applyHost` makes, not whether a path exists. A
 * `block` merge renders against the file's *current* content, so existence
 * reported a merged rules file as "already in place" while the run rewrote it.
 */
async function planHostInstall(host: AgentHost, home: string): Promise<HostPlanPreview> {
  // The same two files `applyHost` reads: a merge rendered as if the file were
  // empty is how the plan and the writer come to disagree.
  const existing: ExistingHostFiles = {};
  if (host.rules && host.rulesFile) existing.rulesFile = await readIfExists(path.join(home, host.rulesFile));
  if (host.rewriteConfig) {
    existing.hookConfig = await readIfExists(path.join(home, host.rewriteConfig.configFile));
  }
  const plan = planHost(host, home, existing);
  const lines: PlanLine[] = plan.artifacts.map((artifact) => ({
    label: ARTIFACT_LABELS[artifact.kind],
    path: artifact.absPath,
    new: !existsSyncSafe(artifact.absPath),
  }));
  return { host, wiring: wiringHint(host), lines };
}

/**
 * The install plan for a resolved host selection, printed before anything is
 * written. Async because a merge must read what is on disk before it renders.
 */
export async function planInstall(ids: readonly string[], home: string): Promise<InstallPlan> {
  const selected = normalizeIds(ids).map((id) => byId(id)).filter((host): host is AgentHost => host !== undefined);
  const hosts = await Promise.all(selected.map((host) => planHostInstall(host, home)));
  const lines = hosts.flatMap((preview) => preview.lines);
  return {
    selected,
    hosts,
    newFiles: lines.filter((line) => line.new).length,
    unchanged: lines.filter((line) => !line.new).length,
  };
}

// --- removal planning -------------------------------------------------------

/** One path in the removal plan, grouped under the host that owns it. */
export interface RemovalLine {
  label: string;
  path: string;
}

export interface HostRemovalPreview {
  host: AgentHost;
  /** The wiring this host had, in the same words the menu used. */
  wiring: string;
  lines: RemovalLine[];
}

export interface RemovalPlan {
  hosts: HostRemovalPreview[];
  files: number;
}

/**
 * What an uninstall will do to a resolved host selection, as data. Only
 * artifacts still holding tersio's content are listed, so the preview cannot
 * imply more is at stake than the run will touch. A host with nothing left is
 * dropped entirely: "nothing found" is a result, not a plan.
 */
export function planRemove(ids: readonly string[], home: string): RemovalPlan {
  const hosts = normalizeIds(ids)
    .map((id) => byId(id))
    .filter((host): host is AgentHost => host !== undefined)
    .map((host) => {
      // planHost is the source of the artifact list; the filesystem only says
      // which still hold our content, so the label stays a real kind.
      const lines = planHost(host, home).artifacts
        .filter((artifact) => existsSyncSafe(artifact.absPath))
        .map((artifact) => ({ label: ARTIFACT_LABELS[artifact.kind], path: artifact.absPath }));
      return { host, wiring: wiringHint(host), lines };
    })
    .filter((preview) => preview.lines.length > 0);
  return { hosts, files: hosts.reduce((sum, preview) => sum + preview.lines.length, 0) };
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
 * Inspects a host and reports one row. `tersio doctor` prints it, and
 * `doctor --fix` drives off the same `repair` string, so a row can never claim
 * a repair that install would not perform.
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
