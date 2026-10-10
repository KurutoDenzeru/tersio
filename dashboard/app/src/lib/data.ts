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
  cacheSavings: number;
  costUsd: number;
  unpricedRequests: number;
  avgDurationMs: number;
  avgTtftMs: number;
  avgTokensPerSecond: number;
  firstTs: number | null;
  lastTs: number | null;
}

export interface AgentRow extends AgentTokenMix {
  key: string;
  /** The provider this row belongs to. Empty when the group is not per provider. */
  provider: string;
  /** The row's estimate split by billing component. */
  costMix: AgentCostMix;
  requests: number;
  failed: number;
  errorRate: number;
  cacheRate: number;
  cacheSavings: number;
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

export interface AgentTraceRow {
  sessionFile: string;
  project: string;
  requests: number;
  tokens: number;
  costUsd: number;
  unpriced: number;
  models: number;
  toolCalls: number;
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

export interface AgentTranscriptEntry {
  ts: number;
  kind: "user" | "assistant" | "tool" | "system";
  label: string;
  detail: string;
  model: string;
  provider: string;
  tool: string;
  tokens: number;
  costUsd: number;
  durationMs: number | null;
  isError: boolean;
}

/** Throughput and first-token latency for one model and provider in one bucket. */
export interface AgentModelPerformancePoint {
  ts: number;
  requests: number;
  avgTokensPerSecond: number | null;
  avgTtftMs: number | null;
}

export interface AgentSessionTrace {
  sessionFile: string;
  project: string;
  entries: AgentTranscriptEntry[];
  truncated: boolean;
}

/** The three payloads the request drawer renders: the output message, the journal entry, and the stats row. */
export interface AgentRequestPayload {
  /** The model's message, carried by the journal entry. `null` for a row with no payload. */
  output: unknown;
  /** The raw journal line for the entry. */
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
  usageSeries: AgentWindowSeries[];
  windowInsights: AgentWindowInsight[];
  providerHourly: AgentProviderHour[];
  requestStats: AgentRequestStats;
  /** Raw failure rows inside the range, newest first: the Errors page's list. */
  errors: AgentRequestRow[];
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

/**
 * The agent aggregate for one page. Each view asks the server for only the parts it renders,
 * so a page payload stays small; the response is memoized per window and view.
 */
export function useAgentData(range: AgentRange, view: AgentView): {
  agent: AgentStats | null;
  loading: boolean;
  /** True when the server never answered JSON: a stale process, not an empty database. */
  stale: boolean;
} {
  const key = `${range}|${view}`;
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
        const next = await getJSON<{ agent: AgentStats }>(`api/agent?range=${range}&view=${view}`);
        if (!live) return;
        agentCache.set(key, next.agent);
        setAgent(next.agent);
        setStale(false);
        setLoading(false);
      } catch {
        // A newer page against an older server process: the route answers with HTML. Say so,
        // because "no database" would blame a database that is sitting right there.
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
  }, [key, range, view]);

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
  opencode: string | null;
  opencodePath: string | null;
  /** Config root, e.g. ~/.config/opencode */
  opencodeDir: string | null;
  provider: string | null;
  rtk: { present: boolean; version: string | null; path: string };
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
