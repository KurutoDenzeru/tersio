// Host selection, persistence, and the filesystem side of asking what a host has on disk.
import fsSync from 'node:fs';
import path from 'node:path';
import { HOSTS, REWRITE_WIRING, type AgentHost } from './agent-hosts.ts';
import { reportOmpLayer, type LayerEntry } from './omp-layer.ts';
import { reportPiLayer } from './pi-layer.ts';

const SELECTION_FILE = 'agents.json';

// Marker pair for the one file we still merge into: a user's own AGENTS.md.
const START = '<!-- tersio:start -->';
const END = '<!-- tersio:end -->';

interface Selection {
  hosts: string[];
  updatedAt: number;
}

function selectionPath(home: string): string {
  return path.join(home, '.tersio', SELECTION_FILE);
}

// Host ids only, in registry order, de-duplicated, unknown ids dropped.
export function normalizeIds(ids: readonly string[]): string[] {
  const wanted = new Set(ids);
  return HOSTS.filter((h) => wanted.has(h.id)).map((h) => h.id);
}

// One row in the agent menu, with a hint naming the wiring the host will get.
export interface AgentChoice {
  value: string;
  label: string;
  hint: string;
}

// `$HOME`-relative form of a path, for previews that must stay readable.
export function displayPath(target: string, home: string): string {
  if (!home) return target;
  const prefix = home.endsWith(path.sep) ? home : `${home}${path.sep}`;
  if (!target.startsWith(prefix)) return target;
  return `~/${target.slice(prefix.length).split(path.sep).join('/')}`;
}

// What tersio has put on this machine for one host.
export interface HostInstallState {
  // Extension directories a live layer owns.
  dirs: number;
  installed: boolean;
}

// The install marker goes in the *label*: clack renders hints on the cursor row only.
export function agentChoices(state?: ReadonlyMap<string, HostInstallState>): AgentChoice[] {
  return HOSTS.map((host) => {
    const info = state?.get(host.id);
    if (!info) {
      return {
        value: host.id,
        label: host.id === 'omp' ? `${host.label} (extensions + Ponytail)` : host.label,
        hint: REWRITE_WIRING,
      };
    }
    const mark = info.installed ? 'installed' : 'not installed';
    const size = info.dirs > 0 ? `${info.dirs} dir${info.dirs === 1 ? '' : 's'}` : 'nothing';
    return { value: host.id, label: `${host.label} — ${size} · ${mark}`, hint: REWRITE_WIRING };
  });
}

// An uninstall row for a host with nothing of ours answers a question nobody asked.
export function installedRows(state: ReadonlyMap<string, HostInstallState>): AgentChoice[] {
  return agentChoices(state).filter((choice) => state.get(choice.value)?.installed !== false);
}

// True when the path is a directory. The layer's artifacts are directories.
function isDir(target: string): boolean {
  try {
    return fsSync.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

// What a host's extension tree looks like on disk.
export interface HostLayer {
  // Directory the host loads its extensions from.
  extDir: string;
  // The host's own plugin registration, when it has one (OMP).
  plugin: string | null;
  present: LayerEntry[];
  missing: LayerEntry[];
  // True when any part of the host's install is on disk.
  installed: boolean;
}

// Reads one host's layer off the filesystem.
export function hostLayer(host: AgentHost, home: string): HostLayer {
  if (host.id === 'omp') {
    const report = reportOmpLayer(home, isDir);
    return {
      extDir: path.join(home, '.omp', 'agent', 'extensions'),
      plugin: report.pluginPath,
      present: report.extensions,
      missing: report.missing,
      installed: report.installed,
    };
  }
  const report = reportPiLayer(home, isDir);
  return {
    extDir: path.join(home, '.pi', 'agent', 'extensions'),
    plugin: null,
    present: report.extensions,
    missing: report.missing,
    installed: report.installed,
  };
}

// Both menus seed from the disk, not from the saved selection.
export function installedState(home: string): Map<string, HostInstallState> {
  const state = new Map<string, HostInstallState>();
  for (const host of HOSTS) {
    const layer = hostLayer(host, home);
    // A partial tree is a partial install; omp's row also needs its plugin registration, which can be pruned while the...
    state.set(host.id, {
      dirs: layer.present.length,
      installed: layer.installed && layer.present.length > 0,
    });
  }
  return state;
}

// Host ids tersio has already installed something for.
export function installedHostIds(state: ReadonlyMap<string, HostInstallState>): string[] {
  return normalizeIds([...state].filter(([, info]) => info.installed).map(([id]) => id));
}

export type AskAgents = () => Promise<string[] | null>;

export type SelectionSource = 'flag' | 'prompt' | 'auto' | 'none';

export interface SelectionResult {
  ids: string[];
  source: SelectionSource;
  // Hosts present on the machine that the stored set did not mention.
  addedByDetection: string[];
}

// An explicit `--agent` wins outright, even for a host not installed.
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

// A config dir, or a binary on PATH. Detection only widens the default set.
export function detectHosts(home: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const found: string[] = [];
  for (const host of HOSTS) {
    if (host.autoDetect === false) continue;
    const dir = path.join(home, host.configDir);
    if (isDir(dir)) {
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

// A host's binary on PATH, or null. Shared with the dashboard.
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
  // A bare `cmd` resolves to the system shell on Windows.
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

// Paths an earlier version wrote and this one no longer does. `ours` is removed outright;
export function clearRetiredPaths(
  host: AgentHost,
  home: string,
  options: { dryRun?: boolean } = {},
): string[] {
  const removed: string[] = [];
  for (const entry of host.retired ?? []) {
    const target = path.join(home, entry.path);
    if (entry.kind === 'merged') {
      let current: string | null = null;
      try {
        current = fsSync.readFileSync(target, 'utf8');
      } catch {
        current = null;
      }
      if (current === null) continue;
      const stripped = removeMarkedBlock(current);
      if (stripped === current) continue;
      if (!options.dryRun) {
        if (stripped === null) fsSync.rmSync(target, { force: true });
        else fsSync.writeFileSync(target, stripped, 'utf8');
      }
      removed.push(target);
      continue;
    }
    if (!isDir(target) && !existsSyncSafe(target)) continue;
    if (!options.dryRun) {
      try {
        fsSync.rmSync(target, { recursive: true, force: true });
      } catch {
        continue;
      }
    }
    removed.push(target);
  }
  return removed;
}

// Removes the marked block and the blank line it introduced. Null when nothing is left.
function removeMarkedBlock(existing: string): string | null {
  const from = existing.indexOf(START);
  const to = existing.indexOf(END);
  if (from === -1 || to === -1 || to <= from) return existing;
  const before = existing.slice(0, from).replace(/\n+$/, '\n');
  const after = existing.slice(to + END.length).replace(/^\n+/, '');
  const merged = `${before}${after}`;
  return merged.trim() ? merged : null;
}

function existsSyncSafe(p: string): boolean {
  try {
    return fsSync.existsSync(p);
  } catch {
    return false;
  }
}

export { selectionPath };
