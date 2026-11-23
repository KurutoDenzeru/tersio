import process from 'node:process';
import path from 'node:path';

import {
  ensureInitializedAndWatching,
  exploreSymbol,
  findRepoRoot,
  getCodeGraph,
  getCodeGraphStatus,
  onToolFinished,
  stopAllWatchers,
  stopWatching,
  syncCodeGraph,
} from './shared.ts';
import { clearWatcherStatus, writeWatcherStatus } from './status-file.ts';
import type { HostScope } from '../shared/plugin-settings.ts';

const hosts: readonly HostScope[] = ['omp', 'pi', 'pig', 'opencode', 'codex', 'claude'];
const watchedRoots = new Set<string>();
const publishing = new Map<string, Promise<void>>();
let statusTimer: ReturnType<typeof setInterval> | undefined;

function repoRoot(root: string): string {
  return findRepoRoot(root) ?? path.resolve(root);
}

function publishWatcherStatus(root: string): Promise<void> {
  const active = publishing.get(root);
  if (active) return active;
  const publication = (async () => {
    try {
      let status = await getCodeGraphStatus(root);
      if (status.initialized && !status.isWatching && !status.isIndexing && !status.error && watchedRoots.has(root)) {
        await ensureInitializedAndWatching(root);
        status = await getCodeGraphStatus(root);
      }
      if (watchedRoots.has(root)) writeWatcherStatus(root, status);
    } catch {
      // Status I/O must not interfere with indexing.
    }
  })();
  publishing.set(root, publication);
  void publication.finally(() => {
    if (publishing.get(root) === publication) publishing.delete(root);
  });
  return publication;
}

function startStatusTimer(): void {
  if (statusTimer) return;
  statusTimer = setInterval(() => {
    for (const root of watchedRoots) void publishWatcherStatus(root);
  }, 5_000);
  statusTimer.unref();
}

function stopStatusTracking(root: string): void {
  const resolvedRoot = repoRoot(root);
  watchedRoots.delete(resolvedRoot);
  clearWatcherStatus(resolvedRoot);
  if (watchedRoots.size === 0 && statusTimer) {
    clearInterval(statusTimer);
    statusTimer = undefined;
  }
}

type WorkerRequest =
  | { id: number; op: 'ensure' | 'status' | 'sync' | 'stop' | 'index'; root: string }
  | { id: number; op: 'explore'; root: string; query: string }
  | { id: number; op: 'tool'; root: string; tool: string; isError: boolean; host: HostScope | null };

function isHost(value: unknown): value is HostScope {
  return hosts.some((host) => host === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRequest(value: unknown): WorkerRequest {
  if (!isRecord(value)) throw new Error('Request must be an object.');
  if (typeof value.id !== 'number' || !Number.isFinite(value.id))
    throw new Error('Request id must be a finite number.');
  if (typeof value.op !== 'string') throw new Error('Request op must be a string.');
  if (typeof value.root !== 'string' || value.root.length === 0)
    throw new Error('Request root must be a non-empty string.');

  switch (value.op) {
    case 'ensure':
    case 'status':
    case 'sync':
    case 'stop':
    case 'index':
      return { id: value.id, op: value.op, root: value.root };
    case 'explore':
      if (typeof value.query !== 'string' || value.query.length === 0) {
        throw new Error(`Request query is required for ${value.op}.`);
      }
      return { id: value.id, op: value.op, root: value.root, query: value.query };
    case 'tool':
      if (typeof value.tool !== 'string' || value.tool.length === 0)
        throw new Error('Request tool must be a non-empty string.');
      if (typeof value.isError !== 'boolean') throw new Error('Request isError must be a boolean.');
      if (value.host !== null && !isHost(value.host)) {
        throw new Error('Request host must be a supported host or null.');
      }
      return { id: value.id, op: 'tool', root: value.root, tool: value.tool, isError: value.isError, host: value.host };
    default:
      throw new Error(`Unknown operation: ${value.op}.`);
  }
}

function requestId(value: unknown): number | undefined {
  return isRecord(value) && typeof value.id === 'number' && Number.isFinite(value.id) ? value.id : undefined;
}

async function execute(request: WorkerRequest): Promise<unknown> {
  switch (request.op) {
    case 'ensure': {
      const result = await ensureInitializedAndWatching(request.root);
      if (result) {
        const root = repoRoot(request.root);
        watchedRoots.add(root);
        startStatusTimer();
        await publishWatcherStatus(root);
      }
      return result;
    }
    case 'status':
      return await getCodeGraphStatus(request.root);
    case 'sync':
      return await syncCodeGraph(request.root);
    case 'explore':
      return await exploreSymbol(request.query, request.root);
    case 'tool':
      onToolFinished(request.tool, request.isError, request.root, request.host);
      return null;
    case 'stop':
      stopWatching(request.root);
      stopStatusTracking(request.root);
      return null;
    case 'index': {
      const graph = await getCodeGraph(request.root, true);
      try {
        await graph.indexAll();
        return await graph.getStats();
      } finally {
        graph.close();
      }
    }
  }
}

async function handleMessage(message: unknown): Promise<void> {
  const id = requestId(message);
  let response: { id: number; result: unknown } | { id: number; error: string } | undefined;
  try {
    const request = parseRequest(message);
    response = { id: request.id, result: await execute(request) };
  } catch (error) {
    if (id !== undefined) response = { id, error: error instanceof Error ? error.message : String(error) };
  }
  if (response) process.send?.(response);
}

process.on('message', (message: unknown) => {
  void handleMessage(message);
});

process.on('disconnect', () => {
  stopAllWatchers();
  clearInterval(statusTimer);
  statusTimer = undefined;
  for (const root of watchedRoots) clearWatcherStatus(root);
  watchedRoots.clear();
  process.exit(0);
});
