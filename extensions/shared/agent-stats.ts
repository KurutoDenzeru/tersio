// extensions/shared/agent-stats.ts: read-only aggregate over the agent statistics databases.
// Today that is omp's stats.db and agent.db, so the naming stays host-neutral. Every metric
// matches @oh-my-pi/omp-stats: same SQL facts, same rules. Missing sqlite3 or a
// missing table degrades to zeros, never to a thrown error.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SQLITE_READ_BUFFER } from './usage-ledger.ts';

export type RangeKey = '1h' | '24h' | '7d' | '30d' | '90d' | 'all';

export const RANGES: readonly RangeKey[] = ['1h', '24h', '7d', '30d', '90d', 'all'];

export function isRangeKey(v: unknown): v is RangeKey {
  return typeof v === 'string' && (RANGES as readonly string[]).includes(v);
}

/** A page fetches only the parts it renders, so a route payload stays small. */
export type AgentView =
  | 'all' | 'overview' | 'models' | 'providers' | 'costs' | 'carbon' | 'requests'
  | 'errors' | 'traces' | 'tools' | 'projects';

export const AGENT_VIEWS: readonly AgentView[] = [
  'all', 'overview', 'models', 'providers', 'costs', 'carbon', 'requests',
  'errors', 'traces', 'tools', 'projects',
];

export function isAgentView(v: unknown): v is AgentView {
  return typeof v === 'string' && (AGENT_VIEWS as readonly string[]).includes(v);
}

/** Query group names, matching the blocks readStatsDb issues. */
const VIEW_PARTS: Record<AgentView, readonly string[]> = {
  all: ['overall', 'byModel', 'byProvider', 'byAgentType', 'byProject', 'series', 'hourOfDay', 'recent', 'errors', 'traces',
    'seriesByProvider', 'modelSeries', 'modelPerformance', 'tools', 'windows', 'providerHourly'],
  overview: ['overall', 'byModel', 'byProvider', 'byAgentType', 'byProject', 'series', 'hourOfDay', 'recent',
    'seriesByProvider', 'modelSeries'],
  models: ['overall', 'byModel', 'modelSeries', 'modelPerformance', 'series'],
  providers: ['overall', 'byProvider', 'series', 'seriesByProvider', 'providerHourly', 'windows'],
  // `modelSeries` feeds the per-model stack, so the page's first paint is not an empty chart.
  costs: ['overall', 'byModel', 'series', 'modelSeries'],
  // The Carbon page needs the same two facts as Costs: per-model output tokens and the mix.
  carbon: ['overall', 'byModel'],
  requests: ['recent'],
  errors: ['errors', 'overall', 'byModel', 'recent'],
  traces: ['traces'],
  tools: ['overall', 'tools'],
  projects: ['overall', 'byProject'],
};

/** Window length in ms. `all` has no cutoff, so it reads as 0. */
const RANGE_MS: Record<RangeKey, number> = {
  '1h': 3_600_000,
  '24h': 86_400_000,
  '7d': 604_800_000,
  '30d': 2_592_000_000,
  '90d': 7_776_000_000,
  all: 0,
};

/** Bucket width per range, measured against the reference: 5 minutes, then 1 hour, then 1 day. */
const BUCKET_MS: Record<RangeKey, number> = {
  '1h': 300_000,
  '24h': 3_600_000,
  '7d': 86_400_000,
  '30d': 86_400_000,
  '90d': 86_400_000,
  all: 86_400_000,
};

/** A series never renders more than this many buckets; a wider span coarsens the bucket. */
const MAX_BUCKETS = 1500;

const RECENT_LIMIT = 200;
const ERROR_LIMIT = 300;
const TRACE_LIMIT = 300;
const TOOL_MODEL_LIMIT = 300;
const SERIES_PROVIDERS = 8;
const SERIES_MODELS = 12;

export function statsDbPath(): string {
  return process.env.TERSIO_AGENT_STATS_DB ?? path.join(os.homedir(), '.omp', 'stats.db');
}

export function agentDbPath(): string {
  return process.env.TERSIO_AGENT_SESSIONS_DB ?? path.join(os.homedir(), '.omp', 'agent', 'agent.db');
}

export interface AgentTokenMix {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface AgentCostMix {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

/** Output cost is the remainder: omp prices the whole request and the three cache-side parts. */
function costMixOf(f: Facts): AgentCostMix {
  const input = f.costInput;
  const cacheRead = f.costCacheRead;
  const cacheWrite = f.costCacheWrite;
  return {
    input,
    cacheRead,
    cacheWrite,
    output: Math.max(0, f.costUsd - input - cacheRead - cacheWrite),
    total: f.costUsd,
  };
}

export interface AgentOverall extends AgentTokenMix {
  /** The estimate split the way a bill splits it: input, output, cache read, cache write. */
  costMix: AgentCostMix;
  requests: number;
  failed: number;
  successful: number;
  errorRate: number;
  cacheRate: number;
  costUsd: number;
  unpricedRequests: number;
  avgDurationMs: number;
  avgTtftMs: number;
  avgTokensPerSecond: number;
  /** The longest single request in the range; null when none carries a duration. */
  maxDurationMs: number | null;
  firstTs: number | null;
  lastTs: number | null;
}

export interface AgentRow extends AgentTokenMix {
  key: string;
  /** The provider this row belongs to, empty when the group is not per provider. */
  provider: string;
  /** The row's estimate split by billing component. */
  costMix: AgentCostMix;
  requests: number;
  failed: number;
  errorRate: number;
  cacheRate: number;
  costUsd: number;
  unpricedRequests: number;
  avgDurationMs: number;
  avgTtftMs: number;
  avgTokensPerSecond: number;
  firstTs: number | null;
  lastTs: number | null;
  /** Providers only: how many models the provider served. */
  models: number;
}

export interface AgentBucket {
  ts: number;
  requests: number;
  errors: number;
  tokens: number;
  costUsd: number;
}

/** Throughput and first-token latency for one model and provider in one bucket. */
export interface AgentModelPerformancePoint {
  ts: number;
  requests: number;
  avgTokensPerSecond: number | null;
  avgTtftMs: number | null;
}

export interface AgentHour {
  hour: number;
  requests: number;
  errors: number;
  tokens: number;
  costUsd: number;
}

export interface AgentTypeShare extends AgentTokenMix {
  agentType: string;
  requests: number;
  costUsd: number;
}

export interface AgentRequestRow {
  ts: number;
  provider: string;
  model: string;
  project: string;
  api: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  costUsd: number;
  unpriced: boolean;
  durationMs: number | null;
  ttftMs: number | null;
  stopReason: string;
  errorMessage: string | null;
  agentType: string;
  sessionFile: string;
  entryId: string;
}

export interface AgentErrorGroup {
  signature: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  latest: AgentRequestRow;
  models: Array<{ model: string; provider: string; count: number }>;
}

export interface AgentErrorModelRow {
  model: string;
  provider: string;
  count: number;
}

/** One session row on the Traces page: a root session with its child transcripts folded in. */
export interface AgentTraceRow {
  /** Absolute root session file path, which is also the trace key. */
  sessionFile: string;
  /** Mangled session folder from the stats database. */
  project: string;
  /** Working directory from the root session's own journal line, when it still reads. */
  cwd: string;
  /** The session's own title, when it still reads. */
  title: string | null;
  requests: number;
  tokens: number;
  costUsd: number;
  unpriced: number;
  /** Every model the session and its children ran on, sorted. */
  models: string[];
  toolCalls: number;
  /** Child transcripts folded into this row. */
  subagents: number;
  firstTs: number;
  lastTs: number;
}

export interface AgentToolRow {
  tool: string;
  calls: number;
  errors: number;
  argsChars: number;
  resultChars: number;
  totalTokensShare: number;
  outputTokensShare: number;
  costShare: number;
  unpricedShare: number;
  lastUsed: number | null;
  model: string;
  provider: string;
}

export interface AgentWindowPoint {
  ts: number;
  usedFraction: number | null;
  exhausted: boolean;
}

/** The Requests page's summary row, computed over the loaded window. */
export interface AgentRequestStats {
  requests: number;
  failed: number;
  aborted: number;
  tokens: number;
  costUsd: number;
  unpriced: number;
  medianDurationMs: number;
  p95DurationMs: number;
  medianTtftMs: number;
  oldest: number | null;
  newest: number | null;
}

/** Peak burn hours: one row per provider per local hour. */
export interface AgentProviderHour {
  provider: string;
  hour: number;
  totalTokens: number;
  outputTokens: number;
  requests: number;
}

/** One account's utilization series inside one window. */
export interface AgentWindowSeries {
  provider: string;
  accountKey: string;
  accountLabel: string;
  windowKey: string;
  windowLabel: string;
  points: AgentWindowPoint[];
}

/** What one subscription window costs in quota terms. */
export interface AgentWindowInsight {
  provider: string;
  windowKey: string;
  windowLabel: string;
  accounts: number;
  cycles: number;
  fractionConsumed: number;
  /** Tokens one full window buys, extrapolated from local burn. */
  estTokensPerWindow: number | null;
  /** Peak of the sum across accounts: 1.7 means demand held 1.7 windows at once. */
  peakConcurrentFraction: number;
  /** Accounts needed to keep the peak under the target utilization. */
  idealAccounts: number;
  exhaustedEvents: number;
}

/** Kind of one trace span: a user turn, a model call, a tool call, or session metadata. */
export type AgentTraceSpanKind = 'turn' | 'model' | 'tool' | 'background';

/** One span on the flamegraph: an interval with the identity and cost of the work it holds. */
export interface AgentTraceSpan {
  /** Entry id from the journal, or `${entryId}#${index}` for one of a message's tool calls. */
  id: string;
  kind: AgentTraceSpanKind;
  /** Short name: the tool, the model, or `Prompt`. */
  label: string;
  /** First line of the text the span carries. */
  detail: string;
  start: number;
  end: number;
  model: string;
  provider: string;
  tool: string;
  tokens: number;
  costUsd: number;
  isError: boolean;
  /** How the request stopped, from the assistant message's stop reason. */
  stopped: 'completed' | 'aborted' | 'failed';
  /** Journal entry id, so the drawer can read the full payload on demand. */
  entryId: string;
}

/** A mode or title change: drawn as a diamond on the timeline. */
export interface AgentTraceMarker {
  id: string;
  ts: number;
  kind: 'model' | 'think' | 'session';
  label: string;
}

/** One flamegraph row: the main session, or a subagent's own row. */
export interface AgentTraceTrack {
  id: string;
  label: string;
  parentId: string | null;
  spans: AgentTraceSpan[];
}

/** Duration totals for one tool across the session: total, mean, and the longest single call. */
export interface AgentTraceToolStat {
  tool: string;
  calls: number;
  errors: number;
  totalMs: number;
  avgMs: number;
  maxMs: number;
}

/** The nine headline figures the reference trace view opens with. */
export interface AgentTraceSummary {
  wallMs: number;
  modelMs: number;
  toolMs: number;
  idleMs: number;
  turns: number;
  requests: number;
  toolCalls: number;
  agents: number;
  totalTokens: number;
  costUsd: number;
}

export interface AgentSessionTrace {
  sessionFile: string;
  project: string;
  title: string;
  cwd: string;
  startedAt: number;
  endedAt: number;
  tracks: AgentTraceTrack[];
  markers: AgentTraceMarker[];
  summary: AgentTraceSummary;
  toolStats: AgentTraceToolStat[];
  truncated: boolean;
}

export interface AgentStats {
  available: boolean;
  range: RangeKey;
  bucketMs: number;
  cutoff: number;
  generatedAt: number;
  overall: AgentOverall;
  byModel: AgentRow[];
  byProvider: AgentRow[];
  byProject: AgentRow[];
  byAgentType: AgentTypeShare[];
  series: AgentBucket[];
  seriesByProvider: Array<{ provider: string; points: AgentBucket[] }>;
  modelSeries: Array<{ model: string; points: AgentBucket[] }>;
  /** Per-bucket throughput and TTFT per model and provider: the model detail chart. */
  modelPerformance: Array<{ model: string; provider: string; points: AgentModelPerformancePoint[] }>;
  hourOfDay: AgentHour[];
  topModels: AgentRow[];
  recent: AgentRequestRow[];
  errorGroups: AgentErrorGroup[];
  errorModels: AgentErrorModelRow[];
  traces: AgentTraceRow[];
  tools: AgentToolRow[];
  toolsByModel: AgentToolRow[];
  toolSeries: Array<{ ts: number; tool: string; calls: number; errors: number }>;
  usageSeries: AgentWindowSeries[];
  windowInsights: AgentWindowInsight[];
  providerHourly: AgentProviderHour[];
  requestStats: AgentRequestStats;
  /** Raw failure rows inside the range, newest first: the Errors page's list. */
  errors: AgentRequestRow[];
}

export function emptyAgentStats(range: RangeKey = '24h'): AgentStats {
  return {
    available: false,
    range,
    bucketMs: BUCKET_MS[range],
    cutoff: 0,
    generatedAt: Date.now(),
    overall: {
      requests: 0, failed: 0, successful: 0, errorRate: 0, cacheRate: 0,
      costUsd: 0, unpricedRequests: 0,
      avgDurationMs: 0, avgTtftMs: 0, avgTokensPerSecond: 0, maxDurationMs: null,
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0,
      costMix: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      firstTs: null, lastTs: null,
    },
    byModel: [], byProvider: [], byProject: [], byAgentType: [],
    series: [], seriesByProvider: [], modelSeries: [], modelPerformance: [], hourOfDay: [], topModels: [],
    recent: [], errorGroups: [], errorModels: [], traces: [],
    tools: [], toolsByModel: [], toolSeries: [],
    usageSeries: [], windowInsights: [], providerHourly: [],
    requestStats: {
      requests: 0, failed: 0, aborted: 0, tokens: 0, costUsd: 0, unpriced: 0,
      medianDurationMs: 0, p95DurationMs: 0, medianTtftMs: 0, oldest: null, newest: null,
    },
    errors: [],
  };
}

// ---------------------------------------------------------------- sqlite access

/**
 * The omp databases run in WAL mode. Ordered fallbacks, each verified against the live pair:
 * `-readonly` needs the `-shm` side file, `immutable=1` silently ignores a WAL, and a copy of
 * db + wal + shm replays the log to the same row count the running server reports.
 */
export function sqliteScript(db: string, script: string): string {
  if (!fs.existsSync(db)) throw new Error(`missing database: ${db}`);
  const opts = {
    encoding: 'utf8' as const,
    timeout: 30_000,
    stdio: ['pipe', 'pipe', 'ignore'] as ['pipe', 'pipe', 'ignore'],
    maxBuffer: SQLITE_READ_BUFFER,
    input: script,
  };
  try {
    return execFileSync('sqlite3', ['-separator', '\t', '-readonly', db], opts);
  } catch { /* the side files may be gone; try the next rung */ }
  if (!fs.existsSync(`${db}-wal`)) {
    try {
      return execFileSync('sqlite3', ['-separator', '\t', `file:${db}?immutable=1`], opts);
    } catch { /* fall through to the copy */ }
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tersio-omp-'));
  const target = path.join(dir, path.basename(db));
  try {
    fs.copyFileSync(db, target);
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(`${db}${suffix}`)) fs.copyFileSync(`${db}${suffix}`, `${target}${suffix}`);
    }
    return execFileSync('sqlite3', ['-separator', '\t', '-readonly', target], opts);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const BLOCK = '@@blk@@';

function blocks(out: string): Map<string, string[][]> {
  const map = new Map<string, string[][]>();
  let current: string[][] | null = null;
  for (const line of out.split('\n')) {
    if (!line) continue;
    if (line.startsWith(BLOCK)) {
      current = [];
      map.set(line.slice(BLOCK.length), current);
      continue;
    }
    if (current) current.push(line.split('\t'));
  }
  return map;
}

/**
 * One sqlite3 call for a group of queries. A failing statement aborts the script, so the
 * partial output is kept and only the missing blocks re-run one at a time.
 */
function readBlocks(db: string, queries: Array<[name: string, sql: string]>): Map<string, string[][]> {
  const script = queries.map(([name, sql]) => `SELECT '${BLOCK}${name}';\n${sql};\n`).join('');
  try {
    return blocks(sqliteScript(db, script));
  } catch (error) {
    // A failing statement aborts the script, so its stdout holds every block that ran.
    if (!error || typeof error !== 'object' || !('stdout' in error) || typeof error.stdout !== 'string') throw error;
    const merged = blocks(error.stdout);
    for (const [name, sql] of queries) {
      if (merged.has(name)) continue;
      try {
        for (const [k, rows] of blocks(sqliteScript(db, `SELECT '${BLOCK}${name}';\n${sql};\n`))) merged.set(k, rows);
      } catch { /* an unavailable table leaves its key absent */ }
    }
    return merged;
  }
}

function tableColumns(db: string, table: string): Set<string> {
  try {
    const out = sqliteScript(db, `SELECT name FROM pragma_table_info('${table}');\n`);
    return new Set(out.split('\n').map((l) => l.trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

function num(v: string | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(v: string | undefined): number | null {
  if (v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** A text column must stay on one line: the parser splits rows on tabs and newlines. */
function txt(column: string): string {
  return `replace(replace(replace(COALESCE(${column}, ''), char(10), ' '), char(13), ' '), char(9), ' ')`;
}

// ------------------------------------------------------------------- sql builders

/** The unpriced rule, copied from the reference: a subscription route with no price is not "free". */
function unpricedSql(p = ''): string {
  return `CASE WHEN ${p}total_tokens > 0 AND ${p}cost_total = 0
    AND (${p}provider = 'xai-oauth' OR ${p}cost_unpriced = 1) THEN 1 ELSE 0 END`;
}

/** The additive facts every messages group reads. */
function messageFacts(p = ''): string {
  return [
    'COUNT(*)',
    `SUM(CASE WHEN ${p}stop_reason = 'error' THEN 1 ELSE 0 END)`,
    `SUM(${p}input_tokens)`,
    `SUM(${p}output_tokens)`,
    `SUM(${p}cache_read_tokens)`,
    `SUM(${p}cache_write_tokens)`,
    `SUM(${p}total_tokens)`,
    `TOTAL(${p}cost_total)`,
    `TOTAL(${p}cost_input)`,
    `TOTAL(${p}cost_cache_read)`,
    `TOTAL(${p}cost_cache_write)`,
    `SUM(${unpricedSql(p)})`,
    `TOTAL(${p}duration)`,
    `COUNT(${p}duration)`,
    `TOTAL(${p}ttft)`,
    `COUNT(${p}ttft)`,
    `TOTAL(CASE WHEN ${p}duration > 0 THEN ${p}output_tokens * 1000.0 / ${p}duration END)`,
    `COUNT(CASE WHEN ${p}duration > 0 THEN 1 END)`,
    `MIN(${p}timestamp)`,
    `MAX(${p}timestamp)`,
    `MAX(${p}duration)`,
  ].join(', ');
}

/** The zero and null literals an older omp schema needs in place of a named column. */
const SHIMS: ReadonlyArray<readonly [string, string]> = [
  ['stop_reason', "''"],
  ['cost_no_cache_input', '0'],
  ['cost_input', '0'],
  ['cost_cache_read', '0'],
  ['cost_cache_write', '0'],
  ['cost_unpriced', '0'],
  ['provider', "''"],
  ['folder', "''"],
  ['agent_type', "''"],
];

/** Applies the shims: a column the table does not hold reads as its literal. */
function withShims(sql: string, cols: Set<string>): string {
  let out = sql;
  for (const [column, literal] of SHIMS) {
    if (cols.has(column)) continue;
    out = out.split(column).join(literal);
  }
  return out;
}

interface Facts {
  requests: number; failed: number;
  input: number; output: number; cacheRead: number; cacheWrite: number; total: number;
  costUsd: number;
  costInput: number; costCacheRead: number; costCacheWrite: number;
  unpriced: number;
  durationSum: number; durationN: number; ttftSum: number; ttftN: number;
  tpsSum: number; tpsN: number;
  maxDurationMs: number | null;
  firstTs: number | null; lastTs: number | null;
}

function parseFacts(row: string[] | undefined, at: number): Facts {
  const g = (i: number): number => num(row?.[at + i]);
  return {
    requests: g(0), failed: g(1),
    input: g(2), output: g(3), cacheRead: g(4), cacheWrite: g(5), total: g(6),
    costUsd: g(7),
    costInput: g(8), costCacheRead: g(9), costCacheWrite: g(10),
    unpriced: g(11),
    durationSum: g(12), durationN: g(13), ttftSum: g(14), ttftN: g(15),
    tpsSum: g(16), tpsN: g(17),
    firstTs: numOrNull(row?.[at + 18]), lastTs: numOrNull(row?.[at + 19]),
    maxDurationMs: numOrNull(row?.[at + 20]),
  };
}

function mix(f: Facts): AgentTokenMix {
  return { input: f.input, output: f.output, cacheRead: f.cacheRead, cacheWrite: f.cacheWrite, total: f.total };
}

const cacheRateOf = (f: Facts): number => (f.input + f.cacheRead > 0 ? f.cacheRead / (f.input + f.cacheRead) : 0);

function overallOf(f: Facts): AgentOverall {
  return {
    ...mix(f),
    costMix: costMixOf(f),
    requests: f.requests,
    failed: f.failed,
    successful: f.requests - f.failed,
    errorRate: f.requests > 0 ? f.failed / f.requests : 0,
    cacheRate: cacheRateOf(f),
    costUsd: f.costUsd,
    unpricedRequests: f.unpriced,
    avgDurationMs: f.durationN > 0 ? f.durationSum / f.durationN : 0,
    avgTtftMs: f.ttftN > 0 ? f.ttftSum / f.ttftN : 0,
    avgTokensPerSecond: f.tpsN > 0 ? f.tpsSum / f.tpsN : 0,
    maxDurationMs: f.maxDurationMs,
    firstTs: f.firstTs,
    lastTs: f.lastTs,
  };
}

function rowOf(key: string, f: Facts, models: number, provider = ''): AgentRow {
  return {
    ...mix(f),
    key,
    provider,
    costMix: costMixOf(f),
    requests: f.requests,
    failed: f.failed,
    errorRate: f.requests > 0 ? f.failed / f.requests : 0,
    cacheRate: cacheRateOf(f),
    costUsd: f.costUsd,
    unpricedRequests: f.unpriced,
    avgDurationMs: f.durationN > 0 ? f.durationSum / f.durationN : 0,
    avgTtftMs: f.ttftN > 0 ? f.ttftSum / f.ttftN : 0,
    avgTokensPerSecond: f.tpsN > 0 ? f.tpsSum / f.tpsN : 0,
    firstTs: f.firstTs,
    lastTs: f.lastTs,
    models,
  };
}

function rangeWhere(cutoff: number, column = 'timestamp'): string {
  return cutoff > 0 ? `WHERE ${column} >= ${Math.floor(cutoff)}` : '';
}

/** Utilization is a fraction with float noise; four decimals keep the payload small. */
function round4(v: number | null): number | null {
  return v === null ? null : Math.round(v * 1e4) / 1e4;
}

// ------------------------------------------------------------------- the aggregate

function bucketSize(range: RangeKey, firstTs: number | null, lastTs: number | null): number {
  const base = BUCKET_MS[range];
  if (firstTs === null || lastTs === null) return base;
  const span = Math.max(0, lastTs - firstTs);
  if (span / base <= MAX_BUCKETS) return base;
  return Math.max(base, Math.ceil(span / MAX_BUCKETS / base) * base);
}

// ------------------------------------------------------------------- the aggregate

function readStatsDb(db: string, cutoff: number, bucketMs: number, cols: Set<string>, parts: Set<string>): Partial<AgentStats> {
  const where = rangeWhere(cutoff);
  const errCol = cols.has('error_message') ? txt('error_message') : "''";
  const apiCol = cols.has('api') ? txt('api') : "''";
  const errorWhere = `WHERE stop_reason = 'error'${cutoff > 0 ? ` AND timestamp >= ${Math.floor(cutoff)}` : ''}`;

  const requestColumns = `timestamp, ${txt('provider')}, ${txt('model')}, ${txt('folder')}, ${apiCol},
    input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens,
    cost_total, ${unpricedSql()}, duration, ttft, ${txt('stop_reason')}, ${errCol},
    ${txt('agent_type')}, ${txt('session_file')}, ${txt('entry_id')}`;

  const out = readBlocks(db, [
    ['overall', `SELECT ${messageFacts()} FROM messages ${where}`],
    ['byModel', `SELECT ${txt('model')}, ${txt('provider')}, ${messageFacts()} FROM messages ${where} GROUP BY model, provider ORDER BY 3 DESC`],
    ['byProvider', `SELECT ${txt('provider')}, COUNT(DISTINCT model), ${messageFacts()} FROM messages ${where} GROUP BY provider ORDER BY 3 DESC`],
    ['byAgentType', `SELECT ${txt('agent_type')}, ${messageFacts()} FROM messages ${where} GROUP BY 1 ORDER BY 2 DESC`],
    ['byProject', `SELECT ${txt('folder')}, ${messageFacts()} FROM messages ${where} GROUP BY 1 ORDER BY 2 DESC`],
    ['series', `SELECT (timestamp / ${bucketMs}) * ${bucketMs}, COUNT(*),
        SUM(CASE WHEN stop_reason = 'error' THEN 1 ELSE 0 END),
        SUM(total_tokens), TOTAL(cost_total) FROM messages ${where} GROUP BY 1 ORDER BY 1`],
    ['hourOfDay', `SELECT CAST(strftime('%H', timestamp / 1000, 'unixepoch', 'localtime') AS INTEGER),
        COUNT(*), SUM(CASE WHEN stop_reason = 'error' THEN 1 ELSE 0 END), SUM(total_tokens), TOTAL(cost_total)
        FROM messages ${where} GROUP BY 1 ORDER BY 1`],
    ['recent', `SELECT ${requestColumns} FROM messages ${where} ORDER BY timestamp DESC LIMIT ${RECENT_LIMIT}`],
    ['errors', `SELECT ${requestColumns} FROM messages ${errorWhere} ORDER BY timestamp DESC LIMIT ${ERROR_LIMIT}`],
    ['traces', `SELECT ${txt('session_file')}, MAX(${txt('folder')}),
        COUNT(*), SUM(total_tokens), TOTAL(cost_total), SUM(${unpricedSql()}),
        MIN(timestamp), MAX(timestamp + COALESCE(duration, 0))
        FROM messages ${where} GROUP BY session_file ORDER BY 8 DESC LIMIT ${TRACE_LIMIT}`],
  ].filter(([name]) => parts.has(name)).map(([name, sql]) => [name, withShims(sql, cols)] as [string, string]));

  // The trace rows are read per file, then folded per root. The model list and the tool counts are
  // read across every transcript and keyed by root, so a child that fell outside the window still
  // folds into the session it belongs to.
  const traceModels = readTraceModels(db);
  const traceTools = readTraceToolCounts(db);
  const traces = foldTraces((out.get('traces') ?? []).map((r) => {
    // Both readers are keyed by root, so every file of a session reads the session's totals.
    const root = rootSessionFile(r[0] ?? '');
    return {
      sessionFile: r[0] ?? '', project: r[1] ?? '', cwd: '', title: null,
      requests: num(r[2]), tokens: num(r[3]), costUsd: num(r[4]), unpriced: num(r[5]),
      models: traceModels.get(root) ?? [],
      toolCalls: traceTools.get(root) ?? 0,
      subagents: 0, firstTs: num(r[6]), lastTs: num(r[7]),
    };
  }));
  applySessionMetadata(traces);

  const requestRows = (rows: string[][]): AgentRequestRow[] => rows.map((r) => ({
    ts: num(r[0]),
    provider: r[1] ?? '',
    model: r[2] ?? '',
    project: r[3] ?? '',
    api: r[4] ?? '',
    input: num(r[5]), output: num(r[6]), cacheRead: num(r[7]), cacheWrite: num(r[8]), totalTokens: num(r[9]),
    costUsd: num(r[10]),
    unpriced: num(r[11]) > 0,
    durationMs: numOrNull(r[12]),
    ttftMs: numOrNull(r[13]),
    stopReason: r[14] ?? '',
    errorMessage: r[15] || null,
    agentType: r[16] ?? '',
    sessionFile: r[17] ?? '',
    entryId: r[18] ?? '',
  }));

  const errorRows = requestRows(out.get('errors') ?? []);
  const errorCounts = new Map<string, AgentErrorModelRow>();
  for (const row of errorRows) {
    const key = `${row.model}\u0000${row.provider}`;
    const hit = errorCounts.get(key);
    if (hit) hit.count += 1;
    else errorCounts.set(key, { model: row.model, provider: row.provider, count: 1 });
  }

  const byModel = (out.get('byModel') ?? [])
    .map((r) => rowOf(r[0] ?? '', parseFacts(r, 2), 0, r[1] ?? ''));

  return {
    overall: overallOf(parseFacts(out.get('overall')?.[0], 0)),
    byModel,
    byProvider: (out.get('byProvider') ?? []).map((r) => rowOf(r[0] ?? '', parseFacts(r, 2), num(r[1]), r[0] ?? '')),
    byProject: (out.get('byProject') ?? []).map((r) => rowOf(r[0] ?? '', parseFacts(r, 1), 0)),
    byAgentType: (out.get('byAgentType') ?? []).map((r) => {
      const f = parseFacts(r, 1);
      return { ...mix(f), agentType: r[0] ?? '', requests: f.requests, costUsd: f.costUsd };
    }),
    series: (out.get('series') ?? []).map((r) => ({
      ts: num(r[0]), requests: num(r[1]), errors: num(r[2]), tokens: num(r[3]), costUsd: num(r[4]),
    })),
    hourOfDay: (out.get('hourOfDay') ?? []).map((r) => ({
      hour: num(r[0]), requests: num(r[1]), errors: num(r[2]), tokens: num(r[3]), costUsd: num(r[4]),
    })),
    recent: requestRows(out.get('recent') ?? []),
    errorGroups: groupErrors(errorRows),
    errors: errorRows,
    errorModels: [...errorCounts.values()].toSorted((a, b) => b.count - a.count),
    traces: traces,
  };
}

/**
 * Fold every child transcript into its root session, the way the reference lists them.
 *
 * A subagent writes its own file under its root's folder, so a row grouped by file alone would
 * show one row per subagent. Each root holds its children's requests, tokens, cost, models, and
 * time, counts the children folded in, and keeps the row even when its own file is gone.
 */
function foldTraces(rows: AgentTraceRow[]): AgentTraceRow[] {
  const byRoot = new Map<string, AgentTraceRow>();
  for (const row of rows) {
    const rootFile = rootSessionFile(row.sessionFile);
    const held = byRoot.get(rootFile);
    if (!held) {
      byRoot.set(rootFile, { ...row, sessionFile: rootFile, models: [...row.models] });
      continue;
    }
    held.requests += row.requests;
    held.tokens += row.tokens;
    held.costUsd += row.costUsd;
    held.unpriced += row.unpriced;
    held.models = [...new Set([...held.models, ...row.models])].toSorted();
    held.firstTs = Math.min(held.firstTs, row.firstTs);
    held.lastTs = Math.max(held.lastTs, row.lastTs);
    held.subagents += 1;
  }
  return [...byRoot.values()]
    .map((row) => ({ ...row, models: row.models.toSorted() }))
    .toSorted((a, b) => b.lastTs - a.lastTs);
}

/** The root session file for a transcript, which is itself when it is already a root. */
export function rootSessionFile(sessionFile: string): string {
  const marker = '/sessions/';
  const at = sessionFile.indexOf(marker);
  if (at < 0) return sessionFile;
  const base = sessionFile.slice(0, at + marker.length);
  const parts = sessionFile.slice(at + marker.length).split('/');
  // `<project>/<root>.jsonl` is a root; `<project>/<root>/<child>.jsonl` belongs to that root.
  if (parts.length < 3) return sessionFile;
  return `${base}${parts[0]}/${parts[1]}.jsonl`;
}

/** Same normalization as the reference: ids and counters collapse, an HTTP status does not. */
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const PREFIXED_ID_RE = /\b(?:req|msg|call|toolu|chatcmpl|resp|run|gen)[-_][A-Za-z0-9_-]{6,}/g;
const HEX_RE = /\b[0-9a-f]{12,}\b/gi;
const NUMBER_RE = /(?<![\w.-])\d+(?:\.\d+)?/g;
const HTTP_STATUS_RE = /^[1-5]\d\d$/;
const SIGNATURE_MAX = 180;

export function errorSignature(message: string | null): string {
  if (!message?.trim()) return 'Unknown error';
  const normalized = message
    .replace(/\s+/g, ' ')
    .trim()
    .replace(UUID_RE, '<id>')
    .replace(PREFIXED_ID_RE, '<id>')
    .replace(HEX_RE, '<hex>')
    .replace(NUMBER_RE, (n) => (HTTP_STATUS_RE.test(n) ? n : 'N'));
  return normalized.length > SIGNATURE_MAX ? `${normalized.slice(0, SIGNATURE_MAX - 1)}…` : normalized;
}

function groupErrors(rows: AgentRequestRow[]): AgentErrorGroup[] {
  const groups = new Map<string, AgentErrorGroup>();
  for (const row of rows) {
    const signature = errorSignature(row.errorMessage);
    const hit = groups.get(signature);
    if (!hit) {
      groups.set(signature, {
        signature, count: 1, firstSeen: row.ts, lastSeen: row.ts, latest: row,
        models: [{ model: row.model, provider: row.provider, count: 1 }],
      });
      continue;
    }
    hit.count += 1;
    hit.firstSeen = Math.min(hit.firstSeen, row.ts);
    hit.lastSeen = Math.max(hit.lastSeen, row.ts);
    const model = hit.models.find((m) => m.model === row.model && m.provider === row.provider);
    if (model) model.count += 1;
    else hit.models.push({ model: row.model, provider: row.provider, count: 1 });
    if (row.ts >= hit.latest.ts) hit.latest = row;
  }
  return [...groups.values()]
    .map((g) => ({ ...g, models: g.models.toSorted((a, b) => b.count - a.count) }))
    .toSorted((a, b) => b.count - a.count || b.lastSeen - a.lastSeen);
}

function readProviderSeries(db: string, cutoff: number, bucketMs: number): Array<{ provider: string; points: AgentBucket[] }> {
  const out = readBlocks(db, [['providerSeries', `SELECT ${txt('provider')}, (timestamp / ${bucketMs}) * ${bucketMs},
      COUNT(*), SUM(total_tokens), TOTAL(cost_total)
      FROM messages ${rangeWhere(cutoff)} GROUP BY 1, 2 ORDER BY 1, 2`]]);
  const perProvider = new Map<string, { cost: number; points: AgentBucket[] }>();
  for (const r of out.get('providerSeries') ?? []) {
    const provider = r[0] ?? '';
    const held = perProvider.get(provider) ?? { cost: 0, points: [] };
    const point: AgentBucket = { ts: num(r[1]), requests: num(r[2]), errors: 0, tokens: num(r[3]), costUsd: num(r[4]) };
    held.points.push(point);
    held.cost += point.costUsd;
    perProvider.set(provider, held);
  }
  return [...perProvider.entries()]
    .toSorted((a, b) => b[1].cost - a[1].cost)
    .slice(0, SERIES_PROVIDERS)
    .map(([provider, held]) => ({ provider, points: held.points }));
}

function readToolSeries(db: string, cutoff: number, bucketMs: number): Partial<AgentStats> {
  const cols = tableColumns(db, 'tool_calls');
  if (!cols.has('tool_name')) return {};
  const join = 'LEFT JOIN messages m ON m.session_file = t.session_file AND m.entry_id = t.entry_id';
  const where = `WHERE t.timestamp >= ${Math.floor(cutoff)}`;
  const facts = (bucket: string, extra: string): string => `
    ${bucket},
    ${txt('t.tool_name')}, ${txt('t.model')}, ${txt('t.provider')},
    COUNT(*),
    SUM(CASE WHEN t.is_error = 1 THEN 1 ELSE 0 END),
    SUM(t.args_chars),
    SUM(COALESCE(t.result_chars, 0)),
    TOTAL(COALESCE(m.total_tokens, 0) * 1.0 / t.calls_in_turn),
    TOTAL(COALESCE(m.output_tokens, 0) * 1.0 / t.calls_in_turn),
    TOTAL(COALESCE(m.cost_total, 0) / t.calls_in_turn),
    TOTAL(CASE WHEN COALESCE(m.total_tokens, 0) > 0 AND COALESCE(m.cost_total, 0) = 0
      AND (m.provider = 'xai-oauth' OR m.cost_unpriced = 1) THEN 1 ELSE 0 END * 1.0 / t.calls_in_turn),
    MAX(t.timestamp)${extra}`;
  const out = readBlocks(db, [
    ['byTool', `SELECT ${facts("'-'", '')} FROM tool_calls t ${join} ${where} GROUP BY t.tool_name ORDER BY 5 DESC`],
    ['byToolModel', `SELECT ${facts("'-'", ', t.model, t.provider')} FROM tool_calls t ${join} ${where}
      GROUP BY t.tool_name, t.model, t.provider ORDER BY 5 DESC LIMIT ${TOOL_MODEL_LIMIT}`],
    ['toolSeries', `SELECT (t.timestamp / ${bucketMs}) * ${bucketMs}, ${txt('t.tool_name')}, COUNT(*),
      SUM(CASE WHEN t.is_error = 1 THEN 1 ELSE 0 END) FROM tool_calls t ${where} GROUP BY 1, 2 ORDER BY 1`],
  ]);
  const parseTool = (r: string[], at: number): AgentToolRow => ({
    tool: r[1] ?? '',
    calls: num(r[4]),
    errors: num(r[5]),
    argsChars: num(r[6]),
    resultChars: num(r[7]),
    totalTokensShare: num(r[8]),
    outputTokensShare: num(r[9]),
    costShare: num(r[10]),
    unpricedShare: num(r[11]),
    lastUsed: numOrNull(r[12]),
    model: r[at] ?? '',
    provider: r[at + 1] ?? '',
  });
  return {
    tools: (out.get('byTool') ?? []).map((r) => parseTool(r, 13)),
    toolsByModel: (out.get('byToolModel') ?? []).map((r) => parseTool(r, 13)),
    toolSeries: (out.get('toolSeries') ?? []).map((r) => ({
      ts: num(r[0]), tool: r[1] ?? '', calls: num(r[2]), errors: num(r[3]),
    })),
  };
}

/** Tool calls per root session, with every child transcript folded in. */
function readTraceToolCounts(db: string): Map<string, number> {
  const counts = new Map<string, number>();
  try {
    const out = sqliteScript(db, 'SELECT session_file, COUNT(*) FROM tool_calls GROUP BY 1;\n');
    for (const line of out.split('\n')) {
      if (!line.trim()) continue;
      const [file, count] = line.split('\t');
      if (!file) continue;
      const root = rootSessionFile(file);
      counts.set(root, (counts.get(root) ?? 0) + num(count));
    }
  } catch { /* no tool rows: keep zero */ }
  return counts;
}

/** Distinct models per root session, with every child transcript folded in. */
function readTraceModels(db: string): Map<string, string[]> {
  const models = new Map<string, Set<string>>();
  try {
    const out = sqliteScript(db, 'SELECT session_file, model FROM messages GROUP BY session_file, model;\n');
    for (const line of out.split('\n')) {
      if (!line.trim()) continue;
      const [file, model] = line.split('\t');
      if (!file || !model) continue;
      const set = models.get(rootSessionFile(file)) ?? new Set<string>();
      set.add(model);
      models.set(rootSessionFile(file), set);
    }
  } catch { /* an unreadable table leaves the list empty */ }
  return new Map([...models.entries()].map(([file, set]) => [file, [...set].toSorted()]));
}

/**
 * Each root session's own title and working directory, read from the head of its transcript.
 *
 * The `session` line carries the working directory and the `title` line sits above it, so one head
 * read answers both. A rotated or unreadable file leaves the row's folder and file name to speak.
 */
function applySessionMetadata(traces: AgentTraceRow[]): void {
  for (const trace of traces) {
    if (!trace.sessionFile.endsWith('.jsonl')) continue;
    let fd: number | null = null;
    try {
      fd = fs.openSync(trace.sessionFile, 'r');
      const buffer = Buffer.alloc(32 * 1024);
      const read = fs.readSync(fd, buffer, 0, buffer.length, 0);
      for (const line of buffer.toString('utf8', 0, read).split('\n')) {
        if (!line.trim()) continue;
        if (line.includes('"cwd"') && !trace.cwd) {
          const match = line.match(/"cwd"\s*:\s*"([^"]+)"/);
          if (match) trace.cwd = match[1];
        }
        if (line.includes('"title"') && !trace.title) {
          const match = line.match(/"title"\s*:\s*"([^"]*)"/);
          if (match) trace.title = match[1] || null;
        }
        if (trace.cwd && trace.title) break;
      }
    } catch { /* a file that no longer reads keeps its empty metadata */ }
    finally {
      if (fd !== null) fs.closeSync(fd);
    }
  }
}

/** Daily tokens and cost for the busiest models: the Models table sparkline. */
function readModelSeries(db: string, cutoff: number, bucketMs: number): Array<{ model: string; points: AgentBucket[] }> {
  const scope = rangeWhere(cutoff);
  const top = `model IN (SELECT model FROM messages ${scope} GROUP BY model ORDER BY COUNT(*) DESC LIMIT ${SERIES_MODELS})`;
  const clause = scope ? `${scope} AND ${top}` : `WHERE ${top}`;
  const out = readBlocks(db, [['modelSeries', `SELECT ${txt('model')}, (timestamp / ${bucketMs}) * ${bucketMs},
      COUNT(*), SUM(total_tokens), TOTAL(cost_total) FROM messages ${clause} GROUP BY 1, 2 ORDER BY 1, 2`]]);
  const perModel = new Map<string, AgentBucket[]>();
  for (const r of out.get('modelSeries') ?? []) {
    const model = r[0] ?? '';
    const points = perModel.get(model) ?? [];
    points.push({ ts: num(r[1]), requests: num(r[2]), errors: 0, tokens: num(r[3]), costUsd: num(r[4]) });
    perModel.set(model, points);
  }
  return [...perModel.entries()].map(([model, points]) => ({ model, points }));
}

/**
 * Throughput and first-token latency per bucket for the busiest models, the chart behind a
 * model's expanded row. Both averages are null in a bucket where no request carried the timing,
 * because a non-null zero would draw a flat line through a real gap.
 */
function readModelPerformance(db: string, cutoff: number, bucketMs: number): Array<{ model: string; provider: string; points: AgentModelPerformancePoint[] }> {
  const scope = rangeWhere(cutoff);
  const top = `model IN (SELECT model FROM messages ${scope} GROUP BY model ORDER BY COUNT(*) DESC LIMIT ${SERIES_MODELS})`;
  const clause = scope ? `${scope} AND ${top}` : `WHERE ${top}`;
  const out = readBlocks(db, [['modelPerformance', `SELECT ${txt('model')}, ${txt('provider')}, (timestamp / ${bucketMs}) * ${bucketMs},
      COUNT(*),
      TOTAL(CASE WHEN duration > 0 THEN output_tokens * 1000.0 / duration END),
      COUNT(CASE WHEN duration > 0 THEN 1 END),
      TOTAL(ttft),
      COUNT(ttft)
      FROM messages ${clause} GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`]]);
  const groups = new Map<string, { model: string; provider: string; points: AgentModelPerformancePoint[] }>();
  for (const r of out.get('modelPerformance') ?? []) {
    const key = `${r[0] ?? ''}\u0000${r[1] ?? ''}`;
    const group = groups.get(key) ?? { model: r[0] ?? '', provider: r[1] ?? '', points: [] };
    const durationN = num(r[5]);
    const ttftN = num(r[7]);
    group.points.push({
      ts: num(r[2]),
      requests: num(r[3]),
      avgTokensPerSecond: durationN > 0 ? num(r[4]) / durationN : null,
      avgTtftMs: ttftN > 0 ? num(r[6]) / ttftN : null,
    });
    groups.set(key, group);
  }
  return [...groups.values()];
}

// ------------------------------------------------------------ subscription windows

/** Reference constants for the quota half, copied from the omp implementation. */
const WINDOW_RESET_DROP = 0.05;
const WINDOW_MIN_EXTRAPOLATION = 0.1;
const WINDOW_TARGET_PEAK = 0.9;
const WINDOW_EXHAUSTED = 0.999;
const WINDOW_MAX_POINTS = 400;

interface WindowSample {
  provider: string;
  accountKey: string;
  accountLabel: string;
  limitId: string;
  label: string;
  windowLabel: string;
  ts: number;
  usedFraction: number | null;
  exhausted: boolean;
}

/** Peak per bucket, so a utilization spike survives the cap. */
function downsampleWindow(points: AgentWindowPoint[]): AgentWindowPoint[] {
  if (points.length <= WINDOW_MAX_POINTS) return points;
  const first = points[0].ts;
  const last = points[points.length - 1].ts;
  const bucket = Math.max(1, Math.ceil((last - first) / WINDOW_MAX_POINTS));
  const out: AgentWindowPoint[] = [];
  let mark = -1;
  for (const point of points) {
    const b = Math.floor((point.ts - first) / bucket);
    if (b !== mark) {
      out.push(point);
      mark = b;
      continue;
    }
    const held = out[out.length - 1];
    if ((point.usedFraction ?? -1) >= (held.usedFraction ?? -1)) out[out.length - 1] = point;
  }
  return out;
}

/**
 * Peak of the sum across accounts at any sampled instant, forward filling each account's last
 * known fraction. A peak of 1.7 means demand simultaneously held 1.7 windows of quota.
 */
function peakConcurrent(samples: WindowSample[]): number {
  const events = samples.filter((sample) => sample.usedFraction !== null).toSorted((a, b) => a.ts - b.ts);
  const current = new Map<string, number>();
  let sum = 0;
  let peak = 0;
  for (const event of events) {
    const fraction = event.usedFraction ?? 0;
    sum += fraction - (current.get(event.accountKey) ?? 0);
    current.set(event.accountKey, fraction);
    if (sum > peak) peak = sum;
  }
  return peak;
}

/** The limit label, plus the window label when it adds information. */
function windowDisplayLabel(sample: WindowSample): string {
  if (!sample.windowLabel || sample.label.toLowerCase().includes(sample.windowLabel.toLowerCase())) return sample.label;
  return `${sample.label} · ${sample.windowLabel}`;
}

/** Quota snapshots from agent.db, oldest first. Windows group by provider and limit id. */
function readWindowSamples(cutoff: number): WindowSample[] {
  const db = agentDbPath();
  if (!fs.existsSync(db) || tableColumns(db, 'usage_history').size === 0) return [];
  const out = readBlocks(db, [['windows', `SELECT ${txt('provider')}, ${txt('account_key')},
      ${txt('email')}, ${txt('account_id')}, ${txt('limit_id')}, ${txt('label')}, ${txt('window_label')},
      used_fraction, status, recorded_at
      FROM usage_history ${rangeWhere(cutoff, 'recorded_at')} ORDER BY recorded_at`]]);
  return (out.get('windows') ?? []).map((r) => {
    const usedFraction = numOrNull(r[7]);
    const status = r[8] || null;
    return {
      provider: r[0] ?? '',
      accountKey: r[1] ?? '',
      accountLabel: r[2] || r[3] || r[1] || '',
      limitId: r[4] ?? '',
      label: r[5] ?? '',
      windowLabel: r[6] ?? '',
      ts: num(r[9]),
      usedFraction,
      exhausted: status === 'exhausted' || (usedFraction !== null && usedFraction >= WINDOW_EXHAUSTED),
    };
  });
}

/**
 * Utilization series and per-window insights. A window is one `(provider, limitId)` pair: distinct
 * limits can share a duration label, and merging them interleaves unrelated fractions per account.
 */
function computeWindows(
  samples: WindowSample[],
  tokensByProvider: Map<string, number>,
): { usageSeries: AgentWindowSeries[]; windowInsights: AgentWindowInsight[] } {
  const groups = new Map<string, WindowSample[]>();
  for (const sample of samples) {
    const key = `${sample.provider}\u0000${sample.limitId}`;
    const held = groups.get(key);
    if (held) held.push(sample);
    else groups.set(key, [sample]);
  }

  const usageSeries: AgentWindowSeries[] = [];
  const windowInsights: AgentWindowInsight[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    const windowLabel = windowDisplayLabel(group[group.length - 1]);
    const accounts = new Map<string, WindowSample[]>();
    for (const sample of group) {
      const held = accounts.get(sample.accountKey);
      if (held) held.push(sample);
      else accounts.set(sample.accountKey, [sample]);
    }

    let fractionConsumed = 0;
    let cycles = 0;
    let exhaustedEvents = 0;
    for (const [accountKey, accountSamples] of accounts) {
      usageSeries.push({
        provider: first.provider,
        accountKey,
        accountLabel: accountSamples[accountSamples.length - 1].accountLabel,
        windowKey: first.limitId,
        windowLabel,
        points: downsampleWindow(accountSamples.map((sample) => ({
          ts: sample.ts,
          usedFraction: round4(sample.usedFraction),
          exhausted: sample.exhausted,
        }))),
      });

      let previous: number | null = null;
      let wasExhausted = false;
      for (const sample of accountSamples) {
        if (sample.exhausted && !wasExhausted) exhaustedEvents += 1;
        wasExhausted = sample.exhausted;
        if (sample.usedFraction === null) continue;
        if (previous !== null) {
          const delta = sample.usedFraction - previous;
          if (delta > 0) fractionConsumed += delta;
          else if (delta < -WINDOW_RESET_DROP) cycles += 1;
        }
        previous = sample.usedFraction;
      }
    }

    const providerTokens = tokensByProvider.get(first.provider) ?? 0;
    const peak = peakConcurrent(group);
    windowInsights.push({
      provider: first.provider,
      windowKey: first.limitId,
      windowLabel,
      accounts: accounts.size,
      cycles,
      fractionConsumed,
      estTokensPerWindow:
        providerTokens > 0 && fractionConsumed >= WINDOW_MIN_EXTRAPOLATION
          ? Math.round(providerTokens / fractionConsumed)
          : null,
      peakConcurrentFraction: peak,
      idealAccounts: Math.max(1, Math.ceil(peak / WINDOW_TARGET_PEAK)),
      exhaustedEvents,
    });
  }

  usageSeries.sort(
    (a, b) =>
      a.provider.localeCompare(b.provider) ||
      a.windowKey.localeCompare(b.windowKey) ||
      a.accountLabel.localeCompare(b.accountLabel),
  );
  windowInsights.sort((a, b) => a.provider.localeCompare(b.provider) || b.fractionConsumed - a.fractionConsumed);
  return { usageSeries, windowInsights };
}

/** Tokens per provider over the range: the currency a window insight extrapolates in. */
function readProviderTokens(db: string, cutoff: number): Map<string, number> {
  const out = readBlocks(db, [['providerTokens', `SELECT ${txt('provider')}, SUM(total_tokens)
      FROM messages ${rangeWhere(cutoff)} GROUP BY 1`]]);
  return new Map((out.get('providerTokens') ?? []).map((r) => [r[0] ?? '', num(r[1])]));
}

/** Peak burn hours: one row per provider per local hour, the shape the reference charts. */
function readProviderHourly(db: string, cutoff: number): AgentProviderHour[] {
  const out = readBlocks(db, [['providerHourly', `SELECT ${txt('provider')},
      CAST(strftime('%H', timestamp / 1000, 'unixepoch', 'localtime') AS INTEGER),
      SUM(total_tokens), SUM(output_tokens), COUNT(*)
      FROM messages ${rangeWhere(cutoff)} GROUP BY 1, 2`]]);
  return (out.get('providerHourly') ?? []).map((r) => ({
    provider: r[0] ?? '',
    hour: num(r[1]),
    totalTokens: num(r[2]),
    outputTokens: num(r[3]),
    requests: num(r[4]),
  }));
}

/** Middle value, ignoring nulls. The Requests page summarises latency this way. */
function median(values: Array<number | null | undefined>): number {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)).toSorted((a, b) => a - b);
  if (nums.length === 0) return 0;
  const mid = nums.length >> 1;
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

/** The Requests page summary, computed over the rows the payload carries. */
function computeRequestStats(rows: AgentRequestRow[]): AgentRequestStats {
  const durations = rows.map((row) => row.durationMs);
  const sorted = durations.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)).toSorted((a, b) => a - b);
  const pick = (q: number): number => (sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]);
  const times = rows.map((row) => row.ts);
  return {
    requests: rows.length,
    failed: rows.filter((row) => row.stopReason === 'error').length,
    aborted: rows.filter((row) => row.stopReason === 'aborted').length,
    tokens: rows.reduce((sum, row) => sum + row.totalTokens, 0),
    costUsd: rows.reduce((sum, row) => sum + row.costUsd, 0),
    unpriced: rows.filter((row) => row.unpriced).length,
    medianDurationMs: median(durations),
    p95DurationMs: pick(0.95),
    medianTtftMs: median(rows.map((row) => row.ttftMs)),
    oldest: times.length ? Math.min(...times) : null,
    newest: times.length ? Math.max(...times) : null,
  };
}

/** How many spans one trace ships. A long session holds thousands; the transcript virtualises. */
const TRACE_SPAN_LIMIT = 6000;
/** How much of a message body a span carries: enough for one transcript line. */
const TRACE_DETAIL_MAX = 120;

/** First non-empty line of a message body, for the span's detail line. */
function firstLine(parts: Array<Record<string, unknown>>): string {
  const text = parts
    .map((part) => String(part.text ?? part.thinking ?? ''))
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .find(Boolean);
  return text ? text.slice(0, TRACE_DETAIL_MAX) : '';
}

/** How a request stopped, read from the assistant message's stop reason. */
function stopState(stopReason: string): AgentTraceSpan['stopped'] {
  if (stopReason === 'error') return 'failed';
  if (stopReason === 'aborted') return 'aborted';
  return 'completed';
}

/** Tool names that hand the work to another agent, for the Agents figure. */
const AGENT_TOOLS = new Set(['task', 'subagent']);

/**
 * One session transcript as spans, tracks, markers, and totals.
 *
 * An assistant message stamps its completion and its `duration` says when the call began, so a
 * model span runs `ts - duration` to `ts`. A tool call is emitted by the message requesting it and
 * closed by the `toolResult` with the same call id, so the two bound a tool span. A user message
 * opens a turn the next user message closes, and everything that is not a message rides along as a
 * marker, since it happened at a point in time rather than across one.
 */
export function readSessionTrace(sessionFile: string, limit = TRACE_SPAN_LIMIT): AgentSessionTrace {
  const project = sessionFile.split('/sessions/')[1]?.split('/')[0] ?? '';
  const empty: AgentSessionTrace = {
    sessionFile, project, title: '', cwd: project, startedAt: 0, endedAt: 0,
    tracks: [], markers: [], summary: emptyTraceSummary(), toolStats: [], truncated: false,
  };
  if (!sessionFile.endsWith('.jsonl') || !fs.existsSync(sessionFile)) return empty;

  let text: string;
  try {
    text = fs.readFileSync(sessionFile, 'utf8');
  } catch {
    return empty;
  }

  // Pass one: pull each line into the shape the spans are cut from.
  type Raw = {
    entryId: string; ts: number; role: string; tool: string; detail: string;
    model: string; provider: string; tokens: number; costUsd: number;
    durationMs: number | null; startAt: number | null; isError: boolean;
    stopped: AgentTraceSpan['stopped']; callId: string; calls: Array<{ id: string; name: string }>;
  };
  const raw: Raw[] = [];
  const markers: AgentTraceMarker[] = [];
  let title = '';
  let truncated = false;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const entryId = String(parsed.id ?? '');
    // The line's stamp is when the entry landed; the message's own stamp, a number, is when it began.
    const ts = Date.parse(String(parsed.timestamp ?? '')) || 0;
    const own = (parsed.message as { timestamp?: unknown } | undefined)?.timestamp;
    const startAt = typeof own === 'number' && Number.isFinite(own) ? own : null;
    if (parsed.type !== 'message') {
      const marker = markerFor(entryId, ts, parsed);
      if (marker) markers.push(marker);
      if (parsed.type === 'title' && typeof parsed.title === 'string') title = parsed.title;
      continue;
    }
    const message = (parsed.message ?? {}) as Record<string, unknown>;
    const content = Array.isArray(message.content) ? message.content as Array<Record<string, unknown>> : [];
    const usage = (message.usage ?? {}) as Record<string, unknown>;
    const cost = (usage.cost ?? {}) as Record<string, unknown>;
    raw.push({
      entryId,
      ts,
      role: String(message.role ?? ''),
      tool: String(message.toolName ?? ''),
      detail: firstLine(content),
      model: String(message.model ?? ''),
      provider: String(message.provider ?? ''),
      tokens: num(String(usage.totalTokens ?? 0)),
      costUsd: num(String(cost.total ?? 0)),
      durationMs: typeof message.duration === 'number' ? message.duration : null,
      startAt,
      isError: message.isError === true,
      stopped: stopState(String(message.stopReason ?? '')),
      callId: String(message.toolCallId ?? ''),
      calls: content
        .filter((part) => part.type === 'toolCall')
        .map((part) => ({ id: String(part.id ?? ''), name: String(part.name ?? 'tool') })),
    });
  }

  // A tool result closes the call it names, so the call's span runs to it.
  const resultAt = new Map<string, Raw>();
  const callIds = new Set<string>();
  for (const row of raw) {
    for (const call of row.calls) if (call.id) callIds.add(call.id);
    if (row.role === 'toolResult' && row.callId && !resultAt.has(row.callId)) resultAt.set(row.callId, row);
  }

  const built: AgentTraceSpan[] = [];
  let turnOpen: AgentTraceSpan | null = null;
  for (const row of raw) {
    const base = {
      model: row.model, provider: row.provider, tokens: row.tokens, costUsd: row.costUsd,
      isError: row.isError, entryId: row.entryId,
    };
    if (row.role === 'assistant') {
      // A model call runs from its own start stamp to the line's stamp; the duration is the cross-check.
      const start = row.startAt !== null && row.startAt < row.ts ? row.startAt : row.durationMs && row.durationMs > 0 ? row.ts - row.durationMs : row.ts;
      if (turnOpen) turnOpen.end = start;
      turnOpen = null;
      built.push({ ...base, id: row.entryId || `model-${built.length}`, kind: 'model', label: row.model || 'assistant',
        detail: row.detail, start, end: row.ts, tool: '', stopped: row.stopped });
      row.calls.forEach((call, index) => {
        const result = call.id ? resultAt.get(call.id) : undefined;
        const end = result ? Math.max(result.ts, row.ts) : row.ts;
        built.push({ ...base, id: `${row.entryId}#${index}`, kind: 'tool', label: call.name, detail: result?.detail ?? '',
          start: row.ts, end, tool: call.name, isError: result ? result.isError : base.isError, stopped: 'completed' });
      });
      continue;
    }
    if (row.role === 'toolResult') {
      // A result whose call was compacted away still ran: draw it as a point.
      if (row.callId && callIds.has(row.callId)) continue;
      built.push({ ...base, id: row.entryId || `tool-${built.length}`, kind: 'tool', label: row.tool || 'tool',
        detail: row.detail, start: row.ts, end: row.ts, tool: row.tool, stopped: 'completed' });
      continue;
    }
    if (row.role === 'user') {
      if (turnOpen) turnOpen.end = row.ts;
      turnOpen = { ...base, id: `turn-${built.length}`, kind: 'turn', label: 'Prompt', detail: row.detail,
        start: row.ts, end: row.ts, tool: '', stopped: 'completed' };
      built.push(turnOpen);
      continue;
    }
    built.push({ ...base, id: row.entryId || `bg-${built.length}`, kind: 'background', label: row.role || 'system',
      detail: row.detail, start: row.ts, end: row.ts, tool: '', stopped: 'completed' });
  }

  const lastEnd = built.reduce((max, span) => Math.max(max, span.end), 0);
  if (turnOpen) turnOpen.end = Math.max(turnOpen.end, lastEnd);
  // A session longer than the cap keeps its newest spans: the opening minutes are the least useful.
  const spans = built.length > limit ? built.slice(-limit) : built;
  if (built.length > limit) truncated = true;
  spans.sort((a, b) => a.start - b.start);
  const startedAt = spans.length ? Math.min(...spans.map((span) => span.start)) : 0;
  const endedAt = spans.length ? Math.max(...spans.map((span) => span.end)) : 0;

  return {
    sessionFile, project, title, cwd: project, startedAt, endedAt,
    tracks: [{ id: 'main', label: 'Session', parentId: null, spans }],
    markers: markers.toSorted((a, b) => a.ts - b.ts),
    summary: summarizeTrace(spans, startedAt, endedAt),
    toolStats: buildToolStats(spans),
    truncated,
  };
}

/** A non-message journal entry, when it marks a change worth a diamond on the timeline. */
function markerFor(entryId: string, ts: number, parsed: Record<string, unknown>): AgentTraceMarker | null {
  const kind = String(parsed.type ?? '');
  if (kind === 'model_change') return { id: entryId || `model-${ts}`, ts, kind: 'model', label: String(parsed.model ?? 'model') };
  if (kind === 'thinking_level_change') {
    return { id: entryId || `think-${ts}`, ts, kind: 'think', label: String(parsed.level ?? 'thinking') };
  }
  if (kind === 'session') return { id: entryId || `session-${ts}`, ts, kind: 'session', label: 'session started' };
  // Only the changes ride along: a session fires hundreds of events that would bury the diamonds.
  return null;
}

/** The empty summary, for a file that no longer reads. */
function emptyTraceSummary(): AgentTraceSummary {
  return { wallMs: 0, modelMs: 0, toolMs: 0, idleMs: 0, turns: 0, requests: 0, toolCalls: 0, agents: 0, totalTokens: 0, costUsd: 0 };
}

/** The nine figures: wall time split into model, tool, and idle, then the work counts. */
function summarizeTrace(spans: AgentTraceSpan[], startedAt: number, endedAt: number): AgentTraceSummary {
  const wallMs = endedAt > startedAt ? endedAt - startedAt : 0;
  let modelMs = 0;
  let toolMs = 0;
  let totalTokens = 0;
  let costUsd = 0;
  for (const span of spans) {
    const held = Math.max(0, span.end - span.start);
    if (span.kind === 'model') modelMs += held;
    if (span.kind === 'tool') toolMs += held;
    if (span.kind === 'model') totalTokens += span.tokens;
    if (span.kind === 'model') costUsd += span.costUsd;
  }
  return {
    wallMs,
    modelMs,
    toolMs,
    // Idle is what no span covered: wall time minus the time a model or a tool held.
    idleMs: Math.max(0, wallMs - modelMs - toolMs),
    turns: spans.filter((span) => span.kind === 'turn').length,
    requests: spans.filter((span) => span.kind === 'model').length,
    toolCalls: spans.filter((span) => span.kind === 'tool').length,
    agents: spans.filter((span) => span.kind === 'tool' && AGENT_TOOLS.has(span.tool)).length,
    totalTokens,
    costUsd,
  };
}

/** Per-tool duration totals, longest first. */
function buildToolStats(spans: AgentTraceSpan[]): AgentTraceToolStat[] {
  const byTool = new Map<string, number[]>();
  for (const span of spans) {
    if (span.kind !== 'tool') continue;
    const held = Math.max(0, span.end - span.start);
    const list = byTool.get(span.tool || 'tool') ?? [];
    list.push(held);
    byTool.set(span.tool || 'tool', list);
  }
  return [...byTool.entries()]
    .map(([tool, held]) => {
      const sorted = held.toSorted((a, b) => a - b);
      const totalMs = sorted.reduce((sum, value) => sum + value, 0);
      return {
        tool,
        calls: held.length,
        errors: spans.filter((span) => span.kind === 'tool' && (span.tool || 'tool') === tool && span.isError).length,
        totalMs,
        avgMs: totalMs / Math.max(1, sorted.length),
        maxMs: sorted[held.length - 1] ?? 0,
      };
    })
    .toSorted((a, b) => b.totalMs - a.totalMs);
}

/** The agent settings in force when a request ran, read from the journal's change entries. */
export interface JournalAgent {
  /** The model id in force, from the closest `model_change` before the entry. */
  model: string | null;
  thinkingLevel: string | null;
  /** The assistant mode, such as `full` or `goal`, from `mode_change`. */
  mode: string | null;
  /** Whether the model id was a fallback at the time of the change. */
  fallback: boolean | null;
}

/** The payload a request with no readable entry returns, so the route always answers with one shape. */
export function emptyRequestEntry(): { entry: unknown; output: unknown; messageRole: string; agent: JournalAgent } {
  return { entry: null, output: null, messageRole: '', agent: { model: null, thinkingLevel: null, mode: null, fallback: null } };
}

/**
 * One request's journal payload, read on demand by the request drawer. `entry` is the raw
 * journal line, `output` is the message that line carries, and `agent` is the agent state in
 * force when the request ran. All are empty when the entry journals nothing: a `model_usage`
 * row carries no message, and a deleted session cannot be re-read.
 */
export function readAgentRequestEntry(
  sessionFile: string,
  entryId: string,
): { entry: unknown; output: unknown; messageRole: string; agent: JournalAgent } {
  const empty = emptyRequestEntry();
  if (!entryId || !sessionFile.endsWith('.jsonl') || !fs.existsSync(sessionFile)) return empty;
  let text: string;
  try {
    text = fs.readFileSync(sessionFile, 'utf8');
  } catch {
    return empty;
  }
  const agent = { ...empty.agent };
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (String(parsed.id ?? '') !== entryId) {
      // A change entry updates the state every later request sees.
      if (parsed.type === 'model_change') {
        agent.model = String(parsed.model ?? '') || null;
        agent.fallback = parsed.resolvedModelIsFallback === true;
      } else if (parsed.type === 'thinking_level_change') {
        agent.thinkingLevel = String(parsed.thinkingLevel ?? '') || null;
      } else if (parsed.type === 'mode_change') {
        agent.mode = String(parsed.mode ?? '') || null;
      }
      continue;
    }
    const message = (parsed.message ?? null) as Record<string, unknown> | null;
    return { entry: parsed, output: message, messageRole: message ? String(message.role ?? '') : '', agent };
  }
  return empty;
}


/** Reads both omp databases. `available` is false when stats.db holds no `messages` table. */
export function readAgentStats(range: RangeKey = '24h', view: AgentView = 'all', now = Date.now()): AgentStats {
  const span = RANGE_MS[range];
  const cutoff = span > 0 ? now - span : 0;
  const parts = new Set(VIEW_PARTS[view]);
  const stats = emptyAgentStats(range);
  stats.cutoff = cutoff;

  const db = statsDbPath();
  const cols = fs.existsSync(db) ? tableColumns(db, 'messages') : new Set<string>();
  if (cols.size === 0) {
    if (parts.has('windows')) Object.assign(stats, computeWindows(readWindowSamples(cutoff), new Map()));
    return stats;
  }

  // The bucket width depends on the span, so the bounds come first.
  const bounds = readBlocks(db, [['bounds', `SELECT MIN(timestamp), MAX(timestamp) FROM messages ${rangeWhere(cutoff)}`]]);
  const [firstTs, lastTs] = bounds.get('bounds')?.[0] ?? [];
  stats.bucketMs = bucketSize(range, numOrNull(firstTs), numOrNull(lastTs));

  Object.assign(stats, readStatsDb(db, cutoff, stats.bucketMs, cols, parts));
  if (parts.has('seriesByProvider')) stats.seriesByProvider = readProviderSeries(db, cutoff, stats.bucketMs);
  if (parts.has('modelSeries')) stats.modelSeries = readModelSeries(db, cutoff, stats.bucketMs);
  if (parts.has('modelPerformance')) stats.modelPerformance = readModelPerformance(db, cutoff, stats.bucketMs);
  if (parts.has('tools')) Object.assign(stats, readToolSeries(db, cutoff, stats.bucketMs));
  if (stats.byModel.length > 0) stats.topModels = stats.byModel.slice(0, 12);
  if (parts.has('providerHourly')) stats.providerHourly = readProviderHourly(db, cutoff);
  if (parts.has('recent')) stats.requestStats = computeRequestStats(stats.recent);
  if (parts.has('windows')) {
    Object.assign(stats, computeWindows(readWindowSamples(cutoff), readProviderTokens(db, cutoff)));
  }
  stats.available = true;
  return stats;
}
