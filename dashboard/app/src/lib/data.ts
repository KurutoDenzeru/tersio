// Data contract mirroring cli/usage.ts; snapshots ride window.__TERSIO_SNAP for file://.
import { useCallback, useEffect, useState } from "react";
import { FX_SNAPSHOT, fxMoney, isCurrencyCode } from "./format";

export interface RecentRequestRow {
  m: string;
  i: number;
  o: number;
  t: number;
  d?: number;
  /** Which agent ran the session: pi, agent, opencode. */
  h?: string;
  cr?: number;
  cw?: number;
  usd?: number;
  st: "completed" | "aborted" | "error";
  code?: number;
  note?: string;
  est: number;
  /** Message id when the host provides one. */
  id?: string;
}

export interface RtkCommandRow {
  command: string;
  count: number;
  saved: number;
  avgPct: number;
  avgMs: number;
}

export interface RtkGain {
  commands: number;
  input: number;
  saved: number;
  avgPct: number;
  totalMs: number;
  byCommand: RtkCommandRow[];
}

export interface RtkAdoption {
  sessions: number;
  bashCalls: number;
  eligibleCalls: number;
  rtkCalls: number;
  missedCalls: number;
  adoptionPct: number;
}

export interface RtkRecallDiagnostics {
  mode: "sqlite" | "tee" | "disabled" | "unknown";
  entries: number;
  available: boolean;
}


export type AgentRange = "1h" | "24h" | "7d" | "30d" | "90d" | "all";

export const AGENT_RANGES: readonly AgentRange[] = ["1h", "24h", "7d", "30d", "90d", "all"];

export const AGENT_RANGE_LABEL: Record<AgentRange, string> = {
  "1h": "1 hour",
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  all: "All time",
};

export function isAgentRange(v: unknown): v is AgentRange {
  return typeof v === "string" && (AGENT_RANGES as readonly string[]).includes(v);
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
  /** The provider this row belongs to. Empty when the group is not per provider. */
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
  models: number;
}

export interface AgentBucket {
  ts: number;
  requests: number;
  errors: number;
  tokens: number;
  costUsd: number;
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
}

export interface AgentWindowAccount {
  accountKey: string;
  email: string | null;
  accountId: string | null;
  usedFraction: number | null;
  status: string | null;
  resetsAt: number | null;
  recordedAt: number;
  peak: number;
  points: AgentWindowPoint[];
}

export interface AgentWindow {
  provider: string;
  limitId: string;
  label: string;
  windowLabel: string | null;
  usedFraction: number | null;
  status: string | null;
  resetsAt: number | null;
  recordedAt: number | null;
  peak: number;
  points: AgentWindowPoint[];
  accounts: AgentWindowAccount[];
}

export interface AgentRequestStats {
  requests: number;
  failed: number;
  aborted: number;
  tokens: number;
  costUsd: number;
  unpriced: number;
  /** Rows that rode along with this payload, at most the server's row cap. */
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

export interface AgentWindowPoint {
  ts: number;
  usedFraction: number | null;
  exhausted: boolean;
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
  estTokensPerWindow: number | null;
  peakConcurrentFraction: number;
  idealAccounts: number;
  exhaustedEvents: number;
}

/** Kind of one trace span: a user turn, a model call, a tool call, or session metadata. */
export type AgentTraceSpanKind = "turn" | "model" | "tool" | "background";

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
  stopped: "completed" | "aborted" | "failed";
  /** Journal entry id, so the drawer can read the full payload on demand. */
  entryId: string;
}

/** A mode or title change: drawn as a diamond on the timeline. */
export interface AgentTraceMarker {
  id: string;
  ts: number;
  kind: "model" | "think" | "session";
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

/** One session transcript as a flamegraph. */
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
  /** True when the session ran past the span cap, so the newest spans are all that ride along. */
  truncated: boolean;
}

/** Throughput and first-token latency for one model and provider in one bucket. */
export interface AgentModelPerformancePoint {
  ts: number;
  requests: number;
  avgTokensPerSecond: number | null;
  avgTtftMs: number | null;
}

/** The three payloads the request drawer renders: the output message, the journal entry, and the stats row. */
export interface AgentRequestPayload {
  /** The model's message, carried by the journal entry. `null` for a row with no payload. */
  output: unknown;
  entry: unknown;
  /** `assistant`, `toolResult`, `user`, or empty when the entry carries no message. */
  messageRole: string;
  /** The agent state in force when the request ran. */
  agent: {
    model: string | null;
    thinkingLevel: string | null;
    mode: string | null;
    fallback: boolean | null;
  };
}

const EMPTY_AGENT_PAYLOAD: AgentRequestPayload = {
  output: null,
  entry: null,
  messageRole: "",
  agent: { model: null, thinkingLevel: null, mode: null, fallback: null },
};

export interface AgentStats {
  available: boolean;
  range: AgentRange;
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
  /** What rtk kept out of context in this range, and how much of the bash work it took. */
  rtk: AgentRtk;
  headroom: AgentHeadroom;
  usageSeries: AgentWindowSeries[];
  windowInsights: AgentWindowInsight[];
  providerHourly: AgentProviderHour[];
  requestStats: AgentRequestStats;
  /** Raw failure rows inside the range, newest first: the Errors page's list. */
  errors: AgentRequestRow[];
}

/** One folded rtk verb: `rtk read`, `rtk grep`, with the bytes it kept and how many full commands it hides. */
export interface RtkVerbRow {
  command: string;
  count: number;
  saved: number;
  avgPct: number;
  avgMs: number;
  variants?: number;
}

/** rtk's own savings and adoption. `measured: false` means "not measured", never "saved nothing". */
export interface AgentRtk {
  measured: boolean;
  failure: string;
  commands: number;
  input: number;
  saved: number;
  avgPct: number;
  byVerb: RtkVerbRow[];
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

export interface AgentHeadroom {
  measured: boolean;
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
  /** Headroom's own routing check: is the proxy up, are agents routed. */
  routing: {
    measured: boolean;
    failure: string;
    proxyUp: boolean;
    routedAgents: number;
    failing: Array<{ name: string; status: string; summary: string; hint: string | null }>;
  };
}

export type AgentView =
  | "all" | "overview" | "models" | "providers" | "costs" | "carbon" | "requests"
  | "errors" | "traces" | "tools" | "projects";

export const AGENT_VIEWS: readonly AgentView[] = [
  "all", "overview", "models", "providers", "costs", "carbon", "requests",
  "errors", "traces", "tools", "projects",
];

/** One snapshot per window and view, so returning to a page is instant. */
const agentCache = new Map<string, AgentStats>();

/** Ask every mounted reader for a fresh read, the way a page change does. */
export function requestReload(): void {
  window.dispatchEvent(new Event("tersio:reload"));
}

/** The agent aggregate for one page; each view asks only for the parts it renders, keeping the payload small. */
export function useAgentData(range: AgentRange, view: AgentView, offset = 0): {
  agent: AgentStats | null;
  loading: boolean;
  /** True when the server never answered JSON: a stale process, not an empty database. */
  stale: boolean;
} {
  const key = `${range}|${view}|${offset}`;
  const [agent, setAgent] = useState<AgentStats | null>(() => snapAgent() ?? agentCache.get(key) ?? null);
  const [loading, setLoading] = useState(() => !isFileExport() && !agentCache.has(key) && !snapAgent());
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (isFileExport()) return;
    const held = agentCache.get(key);
    if (held) {
      setAgent(held);
      setLoading(false);
    }
    let live = true;
    const load = async (): Promise<void> => {
      try {
        const next = await getJSON<{ agent: AgentStats }>(`api/agent?range=${range}&view=${view}&offset=${offset}`);
        if (!live) return;
        agentCache.set(key, next.agent);
        setAgent(next.agent);
        setStale(false);
        setLoading(false);
      } catch {
// A newer page against an older server process: the route answers with HTML, so say so rather than blaming the db.
        if (live) {
          setStale(true);
          setLoading(false);
        }
      }
    };
    void load();
    const id = setInterval(() => {
      if (!document.hidden) void load();
    }, 30_000);
    const onVis = (): void => {
      if (!document.hidden) void load();
    };
    const onDemand = (): void => {
      void load();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("tersio:reload", onDemand);
    return () => {
      live = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("tersio:reload", onDemand);
    };
  }, [key, range, view, offset]);

  return { agent, loading, stale };
}

/** One session transcript, for the Traces page's timeline. */
export function useSessionTrace(file: string | null): { trace: AgentSessionTrace | null; loading: boolean } {
  const [trace, setTrace] = useState<AgentSessionTrace | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!file || isFileExport()) {
      setTrace(null);
      return;
    }
    let live = true;
    setLoading(true);
    getJSON<AgentSessionTrace>(`api/agent/session?file=${encodeURIComponent(file)}`)
      .then((next) => {
        if (!live) return;
        setTrace(next);
      })
      .catch(() => {
        if (live) setTrace(null);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [file]);

  return { trace, loading };
}

/** The journal payload behind one request, read when the request drawer opens. */
export function useAgentRequestEntry(file: string | null, entryId: string | null): { entry: AgentRequestPayload; loading: boolean } {
  const [entry, setEntry] = useState<AgentRequestPayload>(EMPTY_AGENT_PAYLOAD);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!file || !entryId || isFileExport()) {
      setEntry(EMPTY_AGENT_PAYLOAD);
      return;
    }
    let live = true;
    setLoading(true);
    getJSON<AgentRequestPayload>(`api/agent/entry?file=${encodeURIComponent(file)}&entry=${encodeURIComponent(entryId)}`)
      .then((next) => {
        if (live) setEntry(next);
      })
      .catch(() => {
        if (live) setEntry(EMPTY_AGENT_PAYLOAD);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [file, entryId]);

  return { entry, loading };
}

/** One dashboard call: its JSON answer, or null when the server does not answer. A refusal still carries its reason. */
async function apiJson<T>(path: string, body?: unknown): Promise<T | null> {
  try {
    const r = await fetch(path, body === undefined
      ? undefined
      : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

/** The canvas node layout, stored tersio-side so a dashboard restart on a new port keeps it. */
export async function fetchPipelinePositions(): Promise<Record<string, unknown> | null> {
  const body = await apiJson<{ positions?: Record<string, unknown> }>("/api/pipeline/positions");
  return body ? body.positions ?? {} : null;
}

export async function postPipelinePositions(positions: Record<string, unknown>): Promise<boolean> {
  return (await apiJson<{ ok?: boolean }>("/api/pipeline/positions", { positions }))?.ok === true;
}

/** Which headroom wrap targets are present on this machine, and which install durably. */
export interface HeadroomWrapTarget {
  name: string;
  label?: string;
  /** True when headroom's own init installs this tool, so the integration survives restarts. */
  durable?: boolean;
  /** True when the only setup is a per-session wrap; the row names it instead of offering a switch. */
  manual?: boolean;
  /** True when headroom's own install apply has a durable path Tersio does not manage. */
  headroomInstall?: boolean;
  /** True when the durable block is already present in the tool's own config. */
  installed?: boolean;
}

export interface HeadroomWrapState {
  targets: Array<HeadroomWrapTarget>;
}

export async function fetchWrapTargets(): Promise<HeadroomWrapState | null> {
  const body = await apiJson<{ targets?: Array<HeadroomWrapTarget> }>("/api/headroom/wrap");
  return body?.targets ? { targets: body.targets } : null;
}

/** The canvas mirrors the wrap record in browser storage; the server copy stays the source of truth. */
const WRAP_KEY = "tersio.headroom.wrap.v1";

export function readStoredWraps(): Record<string, true> {
  try {
    return JSON.parse(localStorage.getItem(WRAP_KEY) ?? "{}") as Record<string, true>;
  } catch {
    return {};
  }
}

/** Mirrors the record for the canvas, and tells it to redraw; a private-mode write just skips. */
export function storeWraps(wraps: Record<string, true>): void {
  try { localStorage.setItem(WRAP_KEY, JSON.stringify(wraps)); } catch { /* private mode */ }
  window.dispatchEvent(new Event("tersio:wrap-changed"));
}

/** The wrap record, stored tersio-side so every browser sees the same switches. */
export async function fetchHeadroomWraps(): Promise<Record<string, unknown> | null> {
  const body = await apiJson<{ wraps?: Record<string, unknown> }>("/api/headroom/wraps");
  return body ? body.wraps ?? {} : null;
}

export async function postHeadroomWraps(wraps: Record<string, unknown>): Promise<boolean> {
  return (await apiJson<{ ok?: boolean }>("/api/headroom/wraps", { wraps }))?.ok === true;
}

/** Starts headroom's own runtime; a durable switch is useless while the proxy is down. */
export async function postHeadroomRuntime(): Promise<{ ok: boolean; detail?: string; error?: string } | null> {
  return apiJson("/api/headroom/runtime", {});
}

/** Runs headroom's documented wrap command for one tool, detached. */
export async function postHeadroomWrap(name: string, action: "wrap" | "unwrap" = "wrap"): Promise<{ ok: boolean; detail: string; error?: string } | null> {
  return apiJson("/api/headroom/wrap", { name, action });
}

/** One vendor row from the scorecard: the installed version against the latest release. */
export interface VendorRow {
  source: string;
  pin: string | null;
  upstream: string | null;
}

/** Refreshes the scorecard and returns the row for one vendor tool. */
export async function checkVendor(tool: "Headroom" | "RTK"): Promise<VendorRow | null> {
  try {
    const check = await fetch("/api/upstream/check", { method: "POST", signal: AbortSignal.timeout(120_000) });
    if (!check.ok) return null;
    await fetch("/api/upstream");
    const r = await fetch("/api/upstream");
    if (!r.ok) return null;
    const body = (await r.json()) as { card?: { sources?: VendorRow[] } };
    return body.card?.sources?.find((row) => row.source === tool) ?? null;
  } catch {
    return null;
  }
}

/** The vendor footer's actions: update in the background, or remove the binary. */
export async function postVendorAction(tool: "headroom" | "rtk", action: "update" | "uninstall"): Promise<{ ok: boolean; detail: string; error?: string } | null> {
  return apiJson(`/api/vendor/${action}`, { tool });
}

export async function installHeadroom(budgetMs = 180_000): Promise<{ present: boolean; error: string | null }> {
  try {
    const start = await fetch("/api/headroom/install", { method: "POST" })
      .then((r) => r.json()) as { ok?: boolean; present?: boolean; error?: string } | null;
    if (start?.present) return { present: true, error: null };
    if (start && start.ok === false) return { present: false, error: start.error ?? "the install could not start" };
    const started = Date.now();
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const job = await fetch("/api/headroom/install").then((r) => r.json()).catch(() => null) as { present?: boolean; code?: number | null; error?: string | null } | null;
      if (job?.present) return { present: true, error: null };
      if (job && job.code !== null && job.code !== undefined) return { present: false, error: job.error || "the pip run failed" };
      if (Date.now() - started > budgetMs) return { present: false, error: "the install is still running — check ~/.tersio/headroom-install.log" };
    }
  } catch {
    return { present: false, error: "the dashboard server refused the install request" };
  }
}

export interface HealthReport {
  tersio: string;
  node: string;
  platform: string;
  /** The omp binary's version, when it is installed. */
  omp: string | null;
  ompPath: string | null;
  /** Config root, e.g. ~/.omp */
  ompDir: string | null;
  pi: string | null;
  piPath: string | null;
  /** Config root, e.g. ~/.pi */
  piDir: string | null;
  pig: string | null;
  pigPath: string | null;
  pigDir: string | null;
  opencode: string | null;
  opencodePath: string | null;
  /** Config root, e.g. ~/.config/opencode */
  opencodeDir: string | null;
  provider: string | null;
  rtk: { present: boolean; version: string | null; path: string };
  headroom: { present: boolean; version: string | null; path: string };
  /** The versions this build's own tree pins for the Tersio-forked modes; pstack has no upstream version. */
  modes: { caveman: string | null; ponytail: string | null; pstack: string | null };
  home: string;
}

export interface DoctorRow {
  label: string;
  ok: boolean;
  detail: string;
  group: string;
}

export interface DoctorReport {
  rows: DoctorRow[];
  checkedAt: number;
  schedule: "manual" | "daily" | "weekly" | "monthly";
}

interface TersioSnap {
  /** Display currency baked by --currency or the stored default. */
  currency?: string;
  agent?: AgentStats;
  health?: HealthReport;
  doctor?: DoctorReport;
}

declare global {
  interface Window {
    __TERSIO_SNAP?: TersioSnap | null;
  }
}

function snap(): TersioSnap | null {
  return typeof window !== "undefined" && window.__TERSIO_SNAP ? window.__TERSIO_SNAP : null;
}

function snapAgent(): AgentStats | null {
  return snap()?.agent ?? null;
}

export function isFileExport(): boolean {
  return typeof window !== "undefined" && window.location.protocol === "file:";
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(path);
  return (await res.json()) as T;
}



export interface FxState {
  cur: string;
  rates: Record<string, number>;
  live: boolean;
}

export function useFx(serverDefault?: string | null): {
  fx: FxState;
  money: (v: number) => string;
  applyCurrency: (code: string) => void;
} {
  const [fx, setFx] = useState<FxState>(() => {
    // The exporter bakes the display currency, so an exported file opens in the same currency.
    let cur = snap()?.currency ?? "USD";
    let rates = { ...FX_SNAPSHOT };
    try {
      const saved = localStorage.getItem("tersio-fx-cur");
      if (saved && isCurrencyCode(saved)) cur = saved;
      const savedFx = JSON.parse(localStorage.getItem("tersio-fx") ?? "null") as {
        rates?: Record<string, number>;
      } | null;
      if (savedFx?.rates?.USD === 1) rates = savedFx.rates;
    } catch {
      // Private mode: snapshot defaults stand.
    }
    if (cur === "USD" && serverDefault && isCurrencyCode(serverDefault)) cur = serverDefault;
    return { cur, rates, live: false };
  });

  useEffect(() => {
    if (typeof fetch !== "function" || typeof AbortController === "undefined") return;
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 4000);
    fetch("https://api.frankfurter.app/latest?from=USD", { signal: ctl.signal })
      .then((r) => r.json())
      .then((j: { rates?: Record<string, number> }) => {
        clearTimeout(to);
        if (!j?.rates) return;
        const ok = Object.keys(FX_SNAPSHOT).every((k) => k === "USD" || typeof j.rates?.[k] === "number");
        if (!ok) return;
        setFx((f) => {
          const rates = { USD: 1, ...j.rates } as Record<string, number>;
          try {
            localStorage.setItem("tersio-fx", JSON.stringify({ rates, ts: Date.now() }));
          } catch {
            // Ignore quota errors.
          }
          return { ...f, rates, live: true };
        });
      })
      .catch(() => clearTimeout(to));
    return () => clearTimeout(to);
  }, []);

  const applyCurrency = useCallback((code: string) => {
    if (!isCurrencyCode(code)) return;
    setFx((f) => ({ ...f, cur: code }));
    try {
      localStorage.setItem("tersio-fx-cur", code);
    } catch {
      // Ignore.
    }
    if (!isFileExport() && typeof fetch === "function") {
      fetch("currency", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currency: code }),
      }).catch(() => {
        // Best-effort persist; the picker already repainted.
      });
    }
  }, []);

  const money = useCallback((v: number) => fxMoney(v, fx.cur, fx.rates), [fx.cur, fx.rates]);

  return { fx, money, applyCurrency };
}

export async function fetchHealth(): Promise<HealthReport | null> {
  const s = snap()?.health;
  if (isFileExport()) return s ?? null;
  try {
    return await getJSON<HealthReport>("health");
  } catch {
    return s ?? null;
  }
}

export async function fetchDoctor(fresh: boolean): Promise<DoctorReport | null> {
  const s = snap()?.doctor;
  if (isFileExport()) return s ?? null;
  try {
    return await getJSON<DoctorReport>(fresh ? "doctor?fresh=1" : "doctor");
  } catch {
    return s ?? null;
  }
}

export async function postDoctorSchedule(
  schedule: DoctorReport["schedule"],
): Promise<DoctorReport | null> {
  try {
    const res = await fetch("doctor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schedule }),
    });
    return (await res.json()) as DoctorReport;
  } catch {
    return null;
  }
}

export async function postDoctorFix(): Promise<{ ok: boolean; failed: string[] } | null> {
  try {
    const res = await fetch("doctor/fix", { method: "POST" });
    return (await res.json()) as { ok: boolean; failed: string[] };
  } catch {
    return null;
  }
}

export async function postReset(): Promise<boolean> {
  try {
    const res = await fetch("reset", { method: "POST" });
    return res.ok;
  } catch {
    return false;
  }
}

export type UpdateSchedule = "off" | "daily" | "weekly" | "monthly";
export type UpdateStatus = "idle" | "checking" | "applying";

/** Mirrors the server's view in cli/dashboard-update.ts: one payload the toast and the About pane share. */
export interface UpdateView {
  current: string;
  /** The version the running build carries, behind `current` until the page reloads. */
  running: string;
  latest: string | null;
  source: "npm" | "github" | null;
  npmLatest: string | null;
  available: boolean;
  prompt: boolean;
  schedule: UpdateSchedule;
  lastCheck: number | null;
  dueIn: number | null;
  snoozeIn: number | null;
  skipped: string | null;
  status: UpdateStatus;
  log: string[];
  error: string | null;
}

export async function fetchUpdate(): Promise<UpdateView | null> {
  // A static export has no server, so it also has no update state to report.
  if (isFileExport()) return null;
  try {
    return await getJSON<UpdateView>("api/update");
  } catch {
    return null;
  }
}

/** The version baked into a static export, which cannot ask a server for one. */
export function snapshotVersion(): string | null {
  return snap()?.health?.tersio ?? null;
}

export async function postUpdateCheck(): Promise<UpdateView | null> {
  try {
    const res = await fetch("api/update/check", { method: "POST" });
    return (await res.json()) as UpdateView;
  } catch {
    return null;
  }
}

export async function postUpdateApply(): Promise<UpdateView | null> {
  try {
    const res = await fetch("api/update/apply", { method: "POST" });
    return (await res.json()) as UpdateView;
  } catch {
    return null;
  }
}

export interface UpdatePrefs {
  schedule?: UpdateSchedule;
  action?: "snooze" | "now" | "skip";
  version?: string;
}

export async function postUpdatePrefs(prefs: UpdatePrefs): Promise<UpdateView | null> {
  try {
    const res = await fetch("api/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(prefs),
    });
    return (await res.json()) as UpdateView;
  } catch {
    return null;
  }
}
