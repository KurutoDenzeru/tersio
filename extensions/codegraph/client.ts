import { type ChildProcess, fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveHostBinary } from '../shared/utils.ts';
import { CODEGRAPH_WRITE_TOOLS, findRepoRoot, resolveCodeGraphLibrary } from './shared.ts';
import type { HostScope } from '../shared/plugin-settings.ts';
import { readCodegraphDefault, readCodegraphSync } from '../shared/plugin-settings.ts';
import { clearWatcherStatus, readWatcherStatus, writeWatcherStatus } from './status-file.ts';
import { installCodeGraphBundle } from './install.ts';
import type { CodeGraphStats, CodeGraphStatus, ExploreResult } from './types.ts';

type Request =
  | { op: 'ensure' | 'status' | 'sync' | 'index' | 'stop'; root: string }
  | { op: 'explore' | 'complexity'; root: string; query: string }
  | { op: 'tool'; root: string; tool: string; isError: boolean; host: HostScope | null };

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

interface Worker {
  child: ChildProcess;
  pending: Map<number, Pending>;
}

let worker: Worker | undefined;

interface Bootstrap {
  controller: AbortController;
  roots: Map<string, ((message: string) => void) | undefined>;
  done?: Promise<void>;
}

let bootstrap: Bootstrap | undefined;
const bootstrapStatusRoots = new Set<string>();
const bootstrapRetryAfter = new Map<string, number>();
let bootstrapCleanupRegistered = false;
let nextId = 0;

function publishBootstrapStatus(entry: string, error?: string): void {
  try {
    writeWatcherStatus(entry, { isWatching: false, isIndexing: error === undefined, error });
    bootstrapStatusRoots.add(entry);
  } catch {
    // Status reporting must not prevent installation.
  }
}

function setReferenced(child: ChildProcess, active: boolean): void {
  if (active) {
    child.ref();
    child.channel?.ref?.();
  } else {
    child.channel?.unref?.();
    child.unref();
  }
}

function startWorker(): Worker {
  if (worker?.child.connected) return worker;
  const lib = resolveCodeGraphLibrary();
  if (!lib) throw new Error('CodeGraph bundle is not installed.');
  const bundledNode = path.resolve(path.dirname(lib), '..', '..', process.platform === 'win32' ? 'node.exe' : 'node');
  const node = existsSync(bundledNode)
    ? bundledNode
    : resolveHostBinary(process.platform === 'win32' ? 'node.exe' : 'node');
  if (!node) throw new Error('CodeGraph requires Node.js 22.5 or later.');
  const sourceEntry = fileURLToPath(new URL('./worker.ts', import.meta.url));
  const entry = existsSync(sourceEntry) ? sourceEntry : fileURLToPath(new URL('./worker.js', import.meta.url));
  const child = fork(entry, [], {
    execPath: node,
    execArgv: ['--liftoff-only'],
    env: { ...process.env, CODEGRAPH_LIB_PATH: lib },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    windowsHide: true,
  });
  const instance: Worker = { child, pending: new Map() };
  worker = instance;
  child.on('message', (message: unknown) => {
    if (!message || typeof message !== 'object' || !('id' in message) || typeof message.id !== 'number') return;
    const waiting = instance.pending.get(message.id);
    if (!waiting) return;
    instance.pending.delete(message.id);
    if ('error' in message && typeof message.error === 'string') waiting.reject(new Error(message.error));
    else if ('result' in message) waiting.resolve(message.result);
    else waiting.reject(new Error('Invalid response from CodeGraph worker.'));
    if (instance.pending.size === 0) setReferenced(child, false);
  });
  const fail = (error: Error): void => {
    if (worker === instance) worker = undefined;
    for (const waiting of instance.pending.values()) waiting.reject(error);
    instance.pending.clear();
  };
  child.once('error', fail);
  child.once('exit', (code, signal) => {
    fail(new Error(`CodeGraph worker exited (${signal ?? code ?? 'unknown'}).`));
  });
  setReferenced(child, false);
  return instance;
}

function request<T>(payload: Request): Promise<T> {
  let instance: Worker;
  try {
    instance = startWorker();
  } catch (error) {
    return Promise.reject(error);
  }
  const id = ++nextId;
  setReferenced(instance.child, true);
  return new Promise<T>((resolve, reject) => {
    instance.pending.set(id, { resolve: (value) => resolve(value as T), reject });
    instance.child.send({ id, ...payload }, (error) => {
      if (!error) return;
      const waiting = instance.pending.get(id);
      instance.pending.delete(id);
      waiting?.reject(error);
      if (instance.pending.size === 0) setReferenced(instance.child, false);
    });
  });
}

function bootstrapRuntime(root: string, report?: (message: string) => void): void {
  if (bootstrap && !bootstrap.controller.signal.aborted) {
    if (!bootstrap.roots.has(root) || report) bootstrap.roots.set(root, report);
    return;
  }
  const state: Bootstrap = { controller: new AbortController(), roots: new Map([[root, report]]) };
  bootstrap = state;
  if (!bootstrapCleanupRegistered) {
    bootstrapCleanupRegistered = true;
    process.once('exit', () => {
      for (const entry of bootstrapStatusRoots) clearWatcherStatus(entry);
    });
  }
  const fail = (entry: string, callback: ((message: string) => void) | undefined, error: unknown): void => {
    const message = error instanceof Error ? (error.message.split('\n')[0] ?? error.name) : String(error);
    publishBootstrapStatus(entry, message);
    bootstrapRetryAfter.set(entry, Date.now() + 60_000);
    try {
      callback?.(message);
    } catch {
      // A host notification must not interrupt other repositories.
    }
  };
  publishBootstrapStatus(root);
  const timer = setInterval(() => {
    for (const entry of state.roots.keys()) publishBootstrapStatus(entry);
  }, 5_000);
  timer.unref();
  state.done = (async () => {
    try {
      await installCodeGraphBundle(undefined, state.controller.signal);
      for (const [entry, callback] of state.roots) {
        if (state.controller.signal.aborted) break;
        try {
          if (!(await request<boolean>({ op: 'ensure', root: entry })))
            throw new Error('CodeGraph could not start indexing.');
          clearWatcherStatus(entry);
          bootstrapStatusRoots.delete(entry);
          bootstrapRetryAfter.delete(entry);
        } catch (error) {
          fail(entry, callback, error);
        }
        state.roots.delete(entry);
      }
    } catch (error) {
      if (!state.controller.signal.aborted) {
        for (const [entry, callback] of state.roots) fail(entry, callback, error);
      }
    } finally {
      clearInterval(timer);
      if (bootstrap === state) bootstrap = undefined;
    }
  })();
}

export async function ensureInitializedAndWatching(
  root = process.cwd(),
  report?: (message: string) => void,
): Promise<boolean> {
  const project = findRepoRoot(root);
  if (!project) return false;
  if (!resolveCodeGraphLibrary()) {
    if (
      process.env.PI_OFFLINE === '1' ||
      process.env.CODEGRAPH_LIB_PATH ||
      (bootstrapRetryAfter.get(project) ?? 0) > Date.now()
    )
      return false;
    bootstrapRuntime(project, report);
    return true;
  }
  return request({ op: 'ensure', root: project });
}

export async function getCodeGraphStatus(root = process.cwd()): Promise<CodeGraphStatus> {
  if (!resolveCodeGraphLibrary()) {
    const observed = readWatcherStatus(findRepoRoot(root) ?? root);
    return {
      initialized: false,
      nodeCount: 0,
      edgeCount: 0,
      fileCount: 0,
      dbSizeBytes: 0,
      isWatching: observed?.isWatching ?? false,
      isIndexing: observed?.isIndexing ?? false,
      watcherObserved: observed !== null,
      error: observed?.error ?? (observed?.isIndexing ? undefined : 'CodeGraph bundle is not installed.'),
    };
  }
  const status = await request<CodeGraphStatus>({ op: 'status', root });
  const observed = readWatcherStatus(findRepoRoot(root) ?? root);
  return {
    ...status,
    watcherObserved: observed !== null,
    isWatching: status.isWatching || observed?.isWatching === true,
    isIndexing: status.isIndexing || observed?.isIndexing === true,
    error: observed?.error ?? status.error,
  };
}

export const syncCodeGraph = (root = process.cwd()): Promise<CodeGraphStats | null> => request({ op: 'sync', root });
export const indexCodeGraph = (root = process.cwd()): Promise<CodeGraphStats> => request({ op: 'index', root });
export const exploreSymbol = (query: string, root = process.cwd()): Promise<ExploreResult> =>
  request({ op: 'explore', root, query });
export async function getComplexityScore(
  query: string,
  root = process.cwd(),
): Promise<{ maxBlastRadius: number; affectedFiles: number }> {
  try {
    return await request({ op: 'complexity', root, query });
  } catch {
    return { maxBlastRadius: 0, affectedFiles: 0 };
  }
}

export async function stopWatching(root = process.cwd()): Promise<void> {
  const project = findRepoRoot(root) ?? path.resolve(root);
  bootstrap?.roots.delete(project);
  clearWatcherStatus(project);
  bootstrapStatusRoots.delete(project);
  if (bootstrap && bootstrap.roots.size === 0) {
    bootstrap.controller.abort();
    await bootstrap.done;
  }
  if (worker?.child.connected) await request({ op: 'stop', root });
}

export function onToolFinished(tool: string, isError: boolean, root: string, host?: HostScope | null): void {
  if (isError || readCodegraphDefault(host) !== 'on' || readCodegraphSync() !== 'live') return;
  const name = tool.toLowerCase();
  if (CODEGRAPH_WRITE_TOOLS[name] !== true && name !== 'bash' && name !== 'shell') return;
  const ready = worker?.child.connected ? Promise.resolve(true) : ensureInitializedAndWatching(root);
  void ready
    .then((ok) => (ok ? request({ op: 'tool', root, tool, isError, host: host ?? null }) : undefined))
    .catch(() => undefined);
}
