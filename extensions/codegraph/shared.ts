// CodeGraph Engine bridge and shared operations.
// Resolves local or global CodeGraph runtime, initializes indices, and executes graph queries.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { homeDir, tersioHome } from '../shared/utils.ts';
import type { CodegraphSyncMode, HostScope } from '../shared/plugin-settings.ts';
import { readCodegraphDefault, readCodegraphSync } from '../shared/plugin-settings.ts';
import type {
  CallerResult,
  CodeGraphStats,
  CodeGraphStatus,
  ExploreResult,
  ImpactRadiusResult,
  Node,
} from './types.ts';

const require = createRequire(import.meta.url);

// Dynamic type for upstream CodeGraph instance
interface UpstreamCodeGraph {
  indexAll(): Promise<void>;
  sync(options?: { paths?: string[] }): Promise<unknown>;
  getStats(): Promise<CodeGraphStats>;
  getNodesByName(name: string): Promise<Node[]>;
  searchNodes(query: string): Promise<Node[]>;
  getCallers(nodeId: string): Promise<CallerResult[]>;
  getImpactRadius(nodeId: string): Promise<ImpactRadiusResult>;
  watch(options?: { debounceMs?: number }): boolean;
  unwatch(): boolean;
  isWatching(): boolean;
  /** Absent on older upstream bundles. */
  isWatcherDegraded?(): boolean;
  getWatcherDegradedReason?(): string | null;
  isIndexing(): boolean;
  close(): void;
}

interface UpstreamCodeGraphClass {
  isInitialized(projectRoot: string): boolean;
  init(projectRoot: string): Promise<UpstreamCodeGraph>;
  open(projectRoot: string): Promise<UpstreamCodeGraph>;
}

/**
 * Locate the CodeGraph bundle library.
 */
export function resolveCodeGraphLibrary(): string | null {
  const custom = process.env.CODEGRAPH_LIB_PATH;
  if (custom && fs.existsSync(custom)) return custom;

  const target = `${process.platform}-${process.arch}`;
  const bundled = [
    newestBundledLibrary(path.join(tersioHome(), 'codegraph', 'bundles'), target),
    newestBundledLibrary(path.join(homeDir(), '.codegraph', 'bundles'), target),
  ]
    .filter((lib): lib is string => lib !== null)
    .toSorted((a, b) =>
      compareVersions(
        path.basename(path.resolve(b, '..', '..', '..')).slice(target.length + 1),
        path.basename(path.resolve(a, '..', '..', '..')).slice(target.length + 1),
      ),
    );
  if (bundled[0]) return bundled[0];

  // Also check if installed in node_modules
  try {
    return require.resolve(`@colbymchenry/codegraph-${target}/lib/dist/index.js`);
  } catch {
    /* not in node_modules */
    return null;
  }
}

/**
 * Bundle folders are named `<target>` or `<target>-<version>`. The highest version wins, so the
 * choice never depends on the order readdir returns.
 */
function newestBundledLibrary(bundlesDir: string, target: string): string | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(bundlesDir);
  } catch {
    return null;
  }
  const candidates = entries
    .filter((entry) => entry === target || entry.startsWith(`${target}-`))
    .map((entry) => ({
      lib: path.join(bundlesDir, entry, 'lib', 'dist', 'index.js'),
      version: entry.slice(target.length + 1),
    }))
    .filter((candidate) => fs.existsSync(candidate.lib))
    .toSorted((a, b) => compareVersions(b.version, a.version));
  return candidates[0]?.lib ?? null;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * The git repository root at or above `start`, or null. The home directory and the filesystem root
 * are never treated as projects: indexing them would walk the user's whole disk.
 */
export function findRepoRoot(start = process.cwd()): string | null {
  const home = path.resolve(homeDir());
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) {
      return dir === home || path.dirname(dir) === dir ? null : dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function requireRepoRoot(projectRoot: string): string {
  const root = findRepoRoot(projectRoot);
  if (!root) throw new Error(`CodeGraph needs a git repository at or above ${projectRoot}; none found.`);
  return root;
}

/** Whether the repository holding `projectRoot` already has a CodeGraph index on disk. */
export function hasCodeGraphIndex(projectRoot = process.cwd()): boolean {
  const root = findRepoRoot(projectRoot);
  const lib = resolveCodeGraphLibrary();
  if (!root || !lib) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(lib) as { CodeGraph: UpstreamCodeGraphClass };
    return mod.CodeGraph.isInitialized(root);
  } catch {
    return false;
  }
}

/**
 * Open or initialize CodeGraph for the git repository holding a project directory.
 */
export async function getCodeGraph(projectRoot = process.cwd(), autoInit = true): Promise<UpstreamCodeGraph> {
  const lib = resolveCodeGraphLibrary();
  if (!lib) {
    throw new Error(
      'CodeGraph bundle is not installed. Install via npm: npm i -g @colbymchenry/codegraph or run `codegraph` once.',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require(lib) as { CodeGraph: UpstreamCodeGraphClass };
  const CG = mod.CodeGraph;

  const root = requireRepoRoot(projectRoot);
  if (!hasCodeGraphIndex(root)) {
    if (!autoInit) {
      throw new Error(`CodeGraph is not initialized in ${root}. Run init first.`);
    }
    return await CG.init(root);
  }

  return await CG.open(root);
}

/**
 * Explore a symbol or query across the codebase.
 */
export async function exploreSymbol(query: string, projectRoot = process.cwd()): Promise<ExploreResult> {
  const building = activeWatchers.get(requireRepoRoot(projectRoot));
  // A build in progress means half an index: wait for the whole one rather than half the callers.
  await waitFor(building?.settled, FIRST_INDEX_WAIT_MS);
  if (building?.status === 'indexing') {
    throw new Error('CodeGraph is still building its first index for this repository; try again shortly.');
  }
  const cg = await getCodeGraph(projectRoot, true);
  try {
    let nodes = await cg.getNodesByName(query);
    if (nodes.length === 0 && typeof cg.searchNodes === 'function') {
      nodes = await cg.searchNodes(query);
    }

    const symbols: ExploreResult['symbols'] = [];

    for (const node of nodes.slice(0, 10)) {
      const callers = await cg.getCallers(node.id);
      const impact = await cg.getImpactRadius(node.id);
      const files = new Set<string>();
      for (const hit of impact.nodes?.values() ?? []) if (hit.filePath) files.add(hit.filePath);
      symbols.push({
        node,
        callers,
        blastRadius: {
          affectedNodes: impact.nodes?.size ?? 0,
          affectedFiles: files.size,
          affectedEdges: impact.edges?.length ?? 0,
        },
      });
    }

    return { query, symbols };
  } finally {
    cg.close();
  }
}

/**
 * The one rendering of an explore answer: the extension tool, the MCP tool, and the CLI all print
 * this, so the three never drift.
 */
export function formatExplore(result: ExploreResult, callers = 5): string {
  if (result.symbols.length === 0) return `CodeGraph: No symbols found matching "${result.query}".`;
  const lines = [`# CodeGraph Explore: "${result.query}"`, `Found ${result.symbols.length} symbol(s):`];
  for (const symbol of result.symbols) {
    const { node, callers: found, blastRadius } = symbol;
    lines.push(
      `\n## ${node.kind} ${node.qualifiedName ?? node.name} (${node.filePath}:${node.startLine})`,
    );
    if (node.signature) lines.push(`Signature: \`${node.signature}\``);
    lines.push(`Blast radius: ${blastRadius.affectedNodes} nodes across ${blastRadius.affectedFiles} file(s)`);
    if (found.length === 0) {
      lines.push('No direct callers recorded in graph.');
      continue;
    }
    lines.push(`Callers (${found.length}):`);
    for (const caller of found.slice(0, callers))
      lines.push(`  - ${caller.node.qualifiedName ?? caller.node.name} in ${caller.node.filePath}:${caller.node.startLine}`);
    if (found.length > callers) lines.push(`  ... and ${found.length - callers} more callers`);
  }
  return lines.join('\n');
}

// Sync mode -> interval. `live` uses the upstream FileWatcher instead; `manual` has no timer.
const SYNC_PERIOD_MS: Partial<Record<CodegraphSyncMode, number>> = {
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
};

// The interval `live` falls back to while its FileWatcher is unavailable or degraded.
const DEGRADED_SYNC_MS = 60_000;

// Shell tools are not here: while the FileWatcher is healthy it already sees shell-made edits, and a
// sync after every shell call (including read-only ones) would rescan the tree for nothing.
export const CODEGRAPH_WRITE_TOOLS: Readonly<Record<string, true>> = {
  write: true,
  edit: true,
  patch: true,
  apply_diff: true,
};

const SHELL_TOOLS: Readonly<Record<string, true>> = { bash: true, shell: true };

interface ActiveWatcher {
  root: string;
  status: 'indexing' | 'ready' | 'failed';
  cg?: UpstreamCodeGraph;
  error?: string;
  watching: boolean;
  /** Resolves when the first build finishes, so a query can wait for a whole index instead of half of one. */
  settled?: Promise<void>;
  syncTimer?: NodeJS.Timeout;
  syncPeriodMs?: number;
  syncing?: Promise<void>;
}

// Keyed by repository root. An entry is set before any await, so a second ensure call joins it.
const activeWatchers = new Map<string, ActiveWatcher>();
const syncDebounceTimers = new Map<string, NodeJS.Timeout>();
let cleanupRegistered = false;

// Upstream FileWatcher debounce, and the pause that coalesces a burst of tool edits into one sync.
const WATCH_DEBOUNCE_MS = 1500;
const SYNC_DEBOUNCE_MS = 500;
// How long a query waits on a first-time build before it hands the retry back to the caller.
const FIRST_INDEX_WAIT_MS = 60_000;

function closeQuietly(cg: UpstreamCodeGraph | undefined): void {
  try {
    cg?.close();
  } catch {
    /* best effort */
  }
}

/** Wait for work to settle, but not past the limit: a huge first build hands the retry back instead. */
async function waitFor(work: Promise<void> | undefined, ms: number): Promise<void> {
  if (!work) return;
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  try {
    await Promise.race([work, limit]);
  } finally {
    clearTimeout(timer);
  }
}

function disposeWatcher(root: string): void {
  const entry = activeWatchers.get(root);
  activeWatchers.delete(root);
  clearTimeout(syncDebounceTimers.get(root));
  syncDebounceTimers.delete(root);
  if (!entry) return;
  clearInterval(entry.syncTimer);
  try {
    if (entry.watching) entry.cg?.unwatch();
  } catch {
    /* best effort */
  }
  closeQuietly(entry.cg);
}

function registerProcessCleanup(): void {
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  // 'exit' only: a SIGINT/SIGTERM listener would stop the host process from exiting on its own.
  process.once('exit', stopAllWatchers);
}

/**
 * Bring a repository's index up to date and keep it current, as the sync mode says. Non-blocking:
 * a missing index is built in the background. Returns false when no repository or runtime applies.
 */
export async function ensureInitializedAndWatching(projectRoot = process.cwd()): Promise<boolean> {
  const root = findRepoRoot(projectRoot);
  if (!root || !resolveCodeGraphLibrary()) return false;

  const existing = activeWatchers.get(root);
  if (existing && existing.status !== 'failed') {
    applySyncMode(existing);
    return true;
  }
  // A failed start is retried on the next session rather than on every edit.
  if (existing) disposeWatcher(root);

  registerProcessCleanup();
  const entry: ActiveWatcher = { root, status: 'indexing', watching: false };
  activeWatchers.set(root, entry);
  if (hasCodeGraphIndex(root)) {
    // Opening an existing index is quick, so the watcher is live when the caller resumes.
    await initializeWatcher(entry);
    return entry.status !== 'failed';
  }
  // A first-time build can take minutes: it runs in the background, and status reports isIndexing.
  entry.settled = initializeWatcher(entry);
  return true;
}

async function initializeWatcher(entry: ActiveWatcher): Promise<void> {
  const hadIndex = hasCodeGraphIndex(entry.root);
  let cg: UpstreamCodeGraph | undefined;
  try {
    cg = await getCodeGraph(entry.root, true);
    if (!hadIndex) await cg.indexAll();
    if (activeWatchers.get(entry.root) !== entry) {
      // Stopped while indexing: nothing should keep this handle open.
      closeQuietly(cg);
      return;
    }
    entry.cg = cg;
    entry.status = 'ready';
    entry.error = undefined;
    applySyncMode(entry);
    if (hadIndex && readCodegraphSync() !== 'manual') void syncInBackground(entry);
  } catch (err) {
    closeQuietly(cg);
    if (activeWatchers.get(entry.root) !== entry) return;
    entry.status = 'failed';
    entry.error = (err as Error).message;
  }
}

/** Reconcile a ready index with the current sync mode: live watcher, interval timer, or neither. */
function applySyncMode(entry: ActiveWatcher): void {
  const cg = entry.cg;
  if (entry.status !== 'ready' || !cg) return;

  const mode = readCodegraphSync();
  const wantWatch = mode === 'live';
  if (wantWatch && !entry.watching) {
    try {
      entry.watching = cg.watch({ debounceMs: WATCH_DEBOUNCE_MS });
    } catch (err) {
      entry.error = (err as Error).message;
    }
  }
  if (!wantWatch && entry.watching) {
    try {
      cg.unwatch();
    } catch {
      /* best effort */
    }
    entry.watching = false;
  }

  // Live sync must not die with its watcher: when watch() fails or the watcher degrades (inotify
  // limit, lock contention), a short interval keeps the index moving.
  const degraded = wantWatch && !watcherHealthy(entry);
  if (degraded) entry.error ??= cg.getWatcherDegradedReason?.() ?? 'file watcher unavailable; syncing on an interval';
  const period = SYNC_PERIOD_MS[mode] ?? (degraded ? DEGRADED_SYNC_MS : undefined);
  if (entry.syncTimer && entry.syncPeriodMs !== period) {
    clearInterval(entry.syncTimer);
    entry.syncTimer = undefined;
  }
  if (period !== undefined && !entry.syncTimer) {
    entry.syncTimer = setInterval(() => void syncInBackground(entry), period);
    entry.syncTimer.unref();
    entry.syncPeriodMs = period;
  }
}

/** True when the live FileWatcher is running and has not degraded. */
function watcherHealthy(entry: ActiveWatcher): boolean {
  return entry.watching && entry.cg?.isWatcherDegraded?.() !== true;
}

async function runSync(entry: ActiveWatcher): Promise<void> {
  if (entry.status !== 'ready' || !entry.cg) return;
  try {
    await entry.cg.sync();
    entry.error = undefined;
  } catch (err) {
    entry.error = (err as Error).message;
    throw err;
  }
}

// One sync per index at a time: the debounce, the interval and an explicit sync share it.
function syncEntry(entry: ActiveWatcher): Promise<void> {
  if (!entry.syncing) {
    entry.syncing = runSync(entry).finally(() => {
      entry.syncing = undefined;
    });
  }
  return entry.syncing;
}

async function syncInBackground(entry: ActiveWatcher): Promise<void> {
  // The failure is already on entry.error for the status view; a background timer has no caller to throw to.
  await syncEntry(entry).catch(() => undefined);
}

/**
 * Trigger a debounced incremental sync on the repository holding `projectRoot`.
 * Callers gate on the `live` sync mode; this function does not read it.
 */
export function triggerDebouncedSync(projectRoot = process.cwd()): void {
  const root = findRepoRoot(projectRoot);
  if (!root) return;

  clearTimeout(syncDebounceTimers.get(root));
  const delayMs = SYNC_DEBOUNCE_MS;
  const timer = setTimeout(() => {
    syncDebounceTimers.delete(root);
    void runDebouncedSync(root);
  }, delayMs);
  timer.unref();
  syncDebounceTimers.set(root, timer);
}

async function runDebouncedSync(root: string): Promise<void> {
  const entry = activeWatchers.get(root);
  if (!entry) {
    // Live sync was switched on mid-session: start the watcher and index now.
    await ensureInitializedAndWatching(root);
    return;
  }
  if (entry.status === 'ready') await syncInBackground(entry);
}

/**
 * A finished tool call may have changed files. In `live` mode that schedules an incremental sync;
 * any other mode, or CodeGraph off, does nothing. Shell calls can write anywhere, so they only
 * sync when the FileWatcher is not covering them (it failed to start or has degraded).
 */
export function onToolFinished(toolName: string, isError: boolean, cwd: string, host?: HostScope | null): void {
  if (isError) return;
  const tool = toolName.toLowerCase();
  const writes = CODEGRAPH_WRITE_TOOLS[tool] === true;
  if (!writes && SHELL_TOOLS[tool] !== true) return;
  if (readCodegraphDefault(host) !== 'on' || readCodegraphSync() !== 'live') return;

  const root = findRepoRoot(cwd);
  const entry = root ? activeWatchers.get(root) : undefined;
  const uncovered = entry !== undefined && entry.status === 'ready' && !watcherHealthy(entry);
  // A watcher that degraded after it started is noticed here, and the fallback timer is armed.
  if (entry && uncovered) applySyncMode(entry);
  if (writes || uncovered) triggerDebouncedSync(cwd);
}

/**
 * Synchronize the index immediately and return updated stats. Throws when the sync fails.
 */
export async function syncCodeGraph(projectRoot = process.cwd()): Promise<CodeGraphStats | null> {
  const root = requireRepoRoot(projectRoot);
  const entry = activeWatchers.get(root);
  if (entry) {
    if (entry.status !== 'ready' || !entry.cg) throw new Error('CodeGraph is still indexing this repository.');
    await syncEntry(entry);
    return await entry.cg.getStats();
  }
  // A repository with no index yet has nothing to sync against; build it instead of reporting zero nodes.
  const hadIndex = hasCodeGraphIndex(root);
  const cg = await getCodeGraph(root, true);
  try {
    if (hadIndex) await cg.sync();
    else await cg.indexAll();
    return await cg.getStats();
  } finally {
    cg.close();
  }
}

async function readStats(root: string): Promise<CodeGraphStats> {
  const cg = await getCodeGraph(root, false);
  try {
    return await cg.getStats();
  } finally {
    cg.close();
  }
}

/**
 * Get the current operational status of CodeGraph for a project directory.
 */
export async function getCodeGraphStatus(projectRoot = process.cwd()): Promise<CodeGraphStatus> {
  const empty: CodeGraphStatus = {
    initialized: false,
    nodeCount: 0,
    edgeCount: 0,
    fileCount: 0,
    dbSizeBytes: 0,
    isWatching: false,
    isIndexing: false,
  };
  const root = findRepoRoot(projectRoot);
  if (!root) return empty;

  const entry = activeWatchers.get(root);
  const live = {
    isWatching: entry ? watcherHealthy(entry) : false,
    isIndexing: entry?.status === 'indexing',
    error: entry?.error,
  };
  if (entry?.status === 'indexing' || !hasCodeGraphIndex(root)) {
    return { ...empty, ...live };
  }

  try {
    const stats = entry?.cg ? await entry.cg.getStats() : await readStats(root);
    return {
      initialized: true,
      nodeCount: stats.nodeCount,
      edgeCount: stats.edgeCount,
      fileCount: stats.fileCount,
      dbSizeBytes: stats.dbSizeBytes,
      lastUpdated: stats.lastUpdated,
      // The stats already carry both breakdowns; the dashboard charts them, so they travel.
      ...(stats.nodesByKind ? { nodesByKind: stats.nodesByKind } : {}),
      ...(stats.filesByLanguage ? { filesByLanguage: stats.filesByLanguage } : {}),
      ...live,
    };
  } catch (err) {
    return { ...empty, ...live, error: (err as Error).message };
  }
}

/**
 * Stop watching and clean up active watcher for a project.
 */
export function stopWatching(projectRoot = process.cwd()): void {
  disposeWatcher(findRepoRoot(projectRoot) ?? path.resolve(projectRoot));
}

/**
 * Stop all active watchers across all projects (useful for testing or full exit).
 */
export function stopAllWatchers(): void {
  for (const root of Array.from(activeWatchers.keys())) {
    disposeWatcher(root);
  }
}
