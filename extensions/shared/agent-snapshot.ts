// The agent-stats layer the dashboard and the MCP server both read: one memo, one across-restart cache,
// and the sync throttle, so two entry points answer from the same rules instead of drifting apart.
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { cacheDelete, cacheGet, cacheKeys, cachePut, cacheStamp } from './cache-store.ts';
import { agentDbPath, readAgentStats, statsDbPath } from './agent-stats.ts';
import type { AgentStats, AgentView, RangeKey } from './agent-types.ts';
import { tersioHome } from './utils.ts';
import { syncUsageDb } from './usage-store.ts';

/** The range a page opens on, matching the reference dashboard. */
export const DEFAULT_AGENT_RANGE: RangeKey = '24h';

/** Poll memo TTL: every poll re-reads the aggregate, so a repeat poll reuses the last answer. */
const AGENT_REFRESH_MS = 30_000;

/** A sync walks every transcript, so it runs at most this often even while a poll outruns it. */
const AGENT_SYNC_MS = 60_000;

let agentMemo: {
  range: RangeKey;
  view: AgentView;
  offset: number;
  stamp: string;
  at: number;
  value: AgentStats;
} | null = null;

let lastSyncAt = 0;

function fileStamp(file: string): string {
  try {
    const stat = statSync(file);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return '-';
  }
}

/** Both sources: the usage store carries every host's rows, agent.db only omp's quota snapshots. */
function storeStamp(): string {
  return `${fileStamp(statsDbPath())}|${fileStamp(agentDbPath())}`;
}

/** Bumped when the payload shape changes, so a cached row from an older build is never read as the new shape. */
const AGENT_CACHE_VERSION = 2;

/** One cache row per range and view, so a restarted server serves what the last one built. */
function agentCacheKey(range: RangeKey, view: AgentView, offset: number): string {
  return `dashboard.agent.v${AGENT_CACHE_VERSION}.${range}-${view}-${offset}`;
}

/** The loose JSON cache an older build wrote moves into the ledger once, then leaves the data home. */
let agentCacheMigrated = false;
function migrateAgentCache(): void {
  if (agentCacheMigrated) return;
  agentCacheMigrated = true;
  const dir = path.join(tersioHome(), 'cache', 'agent');
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      try {
        cachePut(`dashboard.agent.${name.slice(0, -5)}`, readFileSync(path.join(dir, name), 'utf8'));
      } catch {
        /* one unreadable file costs one rebuild */
      }
    }
    rmSync(path.join(tersioHome(), 'cache'), { recursive: true, force: true });
  } catch {
    /* no legacy cache */
  }
}

/** A cached payload is reused only while the store it was built from is unchanged. */
function readAgentCache(key: string, stamp: string): AgentStats | null {
  const text = cacheGet(key);
  if (text === null) return null;
  try {
    const raw = JSON.parse(text) as { stamp?: string; value?: AgentStats };
    if (raw.stamp !== stamp || !raw.value) return null;
    return raw.value;
  } catch {
    return null;
  }
}

function writeAgentCache(key: string, stamp: string, value: AgentStats): void {
  cachePut(key, JSON.stringify({ stamp, value }));
}

/** Keep the cache small: the newest rows are the ones a page opens on. */
function pruneAgentCache(): void {
  const rows = cacheKeys('dashboard.agent.')
    .map((key) => ({ key, at: cacheStamp(key) }))
    .toSorted((a, b) => b.at - a.at);
  for (const row of rows.slice(24)) cacheDelete(row.key);
}

/** Syncs before reading past the throttle; without it a page misses pi and OpenCode rows. */
export function agentStats(range: RangeKey, view: AgentView = 'all', offset = 0): AgentStats {
  const stamp = storeStamp();
  const held = agentMemo;
  if (
    held &&
    held.range === range &&
    held.view === view &&
    held.offset === offset &&
    held.stamp === stamp &&
    Date.now() - held.at < AGENT_REFRESH_MS
  ) {
    return held.value;
  }
  // A payload built from this exact store is reused across restarts, so a page never waits for the scan again.
  migrateAgentCache();
  const key = agentCacheKey(range, view, offset);
  const cached = readAgentCache(key, stamp);
  if (cached) {
    agentMemo = { range, view, offset, stamp, at: Date.now(), value: cached };
    return cached;
  }
  if (Date.now() - lastSyncAt >= AGENT_SYNC_MS) {
    lastSyncAt = Date.now();
    try {
      syncUsageDb();
    } catch {
      /* a store that will not write still reads the rows it already holds */
    }
  }
  const value = readAgentStats(range, view, Date.now(), offset);
  const builtStamp = storeStamp();
  agentMemo = { range, view, offset, stamp: builtStamp, at: Date.now(), value };
  writeAgentCache(key, builtStamp, value);
  pruneAgentCache();
  return value;
}
