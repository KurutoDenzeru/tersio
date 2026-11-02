// The agent API contract, shared by the CLI server and the dashboard.
// Types only: no Node imports, so the browser build can consume them.

export type RangeKey = '1h' | '24h' | '7d' | '30d' | '90d' | 'all';

export interface RtkRow {
  command: string;
  count: number;
  saved: number;
  avgPct: number;
  avgMs: number;
  variants?: number;
}

export type AgentView =
  | 'all' | 'overview' | 'models' | 'providers' | 'costs' | 'carbon' | 'requests'
  | 'errors' | 'traces' | 'tools' | 'projects';

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

export interface AgentRequestStats {
  requests: number;
  failed: number;
  aborted: number;
  tokens: number;
  costUsd: number;
  unpriced: number;
  /** Rows that rode along with this payload, at most `RECENT_LIMIT`. */
  shipped: number;
  medianDurationMs: number;
  p95DurationMs: number;
  medianTtftMs: number;
  oldest: number | null;
  newest: number | null;
}

export interface AgentProviderHour {
  provider: string;
  hour: number;
  totalTokens: number;
  outputTokens: number;
  requests: number;
}

export interface AgentWindowSeries {
  provider: string;
  accountKey: string;
  accountLabel: string;
  windowKey: string;
  windowLabel: string;
  points: AgentWindowPoint[];
}

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

export interface AgentTraceMarker {
  id: string;
  ts: number;
  kind: 'model' | 'think' | 'session';
  label: string;
}

export interface AgentTraceTrack {
  id: string;
  label: string;
  parentId: string | null;
  spans: AgentTraceSpan[];
}

export interface AgentTraceToolStat {
  tool: string;
  calls: number;
  errors: number;
  totalMs: number;
  avgMs: number;
  maxMs: number;
}

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
  /** What rtk kept out of context in this range, and how much of the work it took. */
  rtk: AgentRtk;
  /** What Headroom's compression saved, read through its own savings CLI. */
  headroom: AgentHeadroom;
  usageSeries: AgentWindowSeries[];
  windowInsights: AgentWindowInsight[];
  providerHourly: AgentProviderHour[];
  requestStats: AgentRequestStats;
  /** Raw failure rows inside the range, newest first: the Errors page's list. */
  errors: AgentRequestRow[];
}

export interface AgentRtk {
  /** False when rtk's database could not be read: a zero here means "not measured", never "saved nothing". */
  measured: boolean;
  /** Why the read failed, when it did. Empty on a successful read. */
  failure: string;
  commands: number;
  input: number;
  saved: number;
  avgPct: number;
  /** Commands folded by their leading verb, biggest saving first. */
  byVerb: RtkRow[];
  bashCalls: number;
  eligibleCalls: number;
  rtkCalls: number;
  missedCalls: number;
  adoptionPct: number;
}

export interface HeadroomClientRow {
  client: string;
  calls: number;
  tokensSaved: number;
}

export interface HeadroomProxyStats {
  measured: boolean;
  failure: string;
  requests: number;
  compressed: number;
  tokensSaved: number;
  avgCompressionPct: number;
}

export interface AgentHeadroom {
  /** False when the binary was absent or the read failed: a zero here means "not measured", never "saved nothing". */
  measured: boolean;
  /** Why the read failed, when it did. Empty on a successful read. */
  failure: string;
  tokensSaved: number;
  tokensBefore: number;
  costUsd: number;
  calls: number;
  savingsPercent: number;
  todayTokens: number;
  last7Tokens: number;
  last30Tokens: number;
  byClient: HeadroomClientRow[];
  /** The running proxy's own counters: requests seen and how many it compressed. */
  proxy: HeadroomProxyStats;
  /** Whether each supported host's configured model actually reaches the proxy. */
  routes: Array<{ host: string; measured: boolean; routed: boolean; text: string }>;
  /** Headroom's own routing check: proxy reachable, agents routed. */
  routing: {
    measured: boolean;
    failure: string;
    proxyUp: boolean;
    routedAgents: number;
    failing: Array<{ name: string; status: string; summary: string; hint: string | null }>;
  };
}

export interface JournalAgent {
  /** The model id in force, from the closest `model_change` before the entry. */
  model: string | null;
  thinkingLevel: string | null;
  /** The assistant mode, such as `full` or `goal`, from `mode_change`. */
  mode: string | null;
  /** Whether the model id was a fallback at the time of the change. */
  fallback: boolean | null;
}
