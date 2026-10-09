// Data contract mirroring cli/usage.ts; snapshots ride window.__TERSIO_SNAP for file://.
import { useCallback, useEffect, useRef, useState } from "react";
import { FX_SNAPSHOT, fxMoney, isCurrencyCode } from "./format";
import type { TokenBreakdown } from "./format";

export interface RecentRequestRow {
  m: string;
  i: number;
  o: number;
  t: number;
  d?: number;
  /** Which agent ran the session: pi, omp, opencode. */
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

export interface UsageReport {
  messages: number;
  tokens: TokenBreakdown;
  byModel: Record<string, TokenBreakdown>;
  byModelUsd: Record<string, number>;
  byModelBucketUsd: Record<string, TokenBreakdown>;
  byModelMessages: Record<string, number>;
  byHost: Record<string, Record<string, TokenBreakdown>>;
  byDay: Record<string, TokenBreakdown>;
  byDayModel: Record<string, Record<string, number>>;
  byTool: Array<[string, number]>;
  recent: RecentRequestRow[];
  rtkGain: RtkGain;
  rtkAdoption: RtkAdoption;
  rtkRecall: RtkRecallDiagnostics;
  usd: number;
  priced: boolean;
  savedUsd: number;
  costMeasured: number;
  co2g: number;
  energyWh: number;
  version: string;
  currency: string;
  source: "live" | "stored" | "stored-stale";
  paths: { ledger: string; sessions: string; usageDb: string };
}

export type OmpRange = "1h" | "24h" | "7d" | "30d" | "90d" | "all";

export const OMP_RANGES: readonly OmpRange[] = ["1h", "24h", "7d", "30d", "90d", "all"];

export const OMP_RANGE_LABEL: Record<OmpRange, string> = {
  "1h": "1 hour",
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  all: "All time",
};

export function isOmpRange(v: unknown): v is OmpRange {
  return typeof v === "string" && (OMP_RANGES as readonly string[]).includes(v);
}

export interface OmpTokenMix {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface OmpOverall extends OmpTokenMix {
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

export interface OmpRow extends OmpTokenMix {
  key: string;
  /** The provider this row belongs to. Empty when the group is not per provider. */
  provider: string;
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

export interface OmpBucket {
  ts: number;
  requests: number;
  errors: number;
  tokens: number;
  costUsd: number;
}

export interface OmpHour {
  hour: number;
  requests: number;
  errors: number;
  tokens: number;
  costUsd: number;
}

export interface OmpAgentShare extends OmpTokenMix {
  agentType: string;
  requests: number;
  costUsd: number;
}

export interface OmpRequestRow {
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

export interface OmpErrorGroup {
  signature: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  latest: OmpRequestRow;
  models: Array<{ model: string; provider: string; count: number }>;
}

export interface OmpErrorModelRow {
  model: string;
  provider: string;
  count: number;
}

export interface OmpTraceRow {
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

export interface OmpToolRow {
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

export interface OmpWindowPoint {
  ts: number;
  usedFraction: number | null;
}

export interface OmpWindowAccount {
  accountKey: string;
  email: string | null;
  accountId: string | null;
  usedFraction: number | null;
  status: string | null;
  resetsAt: number | null;
  recordedAt: number;
  peak: number;
  points: OmpWindowPoint[];
}

export interface OmpWindow {
  provider: string;
  limitId: string;
  label: string;
  windowLabel: string | null;
  usedFraction: number | null;
  status: string | null;
  resetsAt: number | null;
  recordedAt: number | null;
  peak: number;
  points: OmpWindowPoint[];
  accounts: OmpWindowAccount[];
}

export interface OmpRequestStats {
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

export interface OmpProviderHour {
  provider: string;
  hour: number;
  totalTokens: number;
  outputTokens: number;
  requests: number;
}

export interface OmpUsageWindowPoint {
  ts: number;
  usedFraction: number | null;
  exhausted: boolean;
}

export interface OmpUsageWindowSeries {
  provider: string;
  accountKey: string;
  accountLabel: string;
  windowKey: string;
  windowLabel: string;
  points: OmpUsageWindowPoint[];
}

export interface OmpWindowInsight {
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

export interface OmpTranscriptEntry {
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
export interface OmpModelPerformancePoint {
  ts: number;
  requests: number;
  avgTokensPerSecond: number | null;
  avgTtftMs: number | null;
}

export interface OmpSessionTrace {
  sessionFile: string;
  project: string;
  entries: OmpTranscriptEntry[];
  truncated: boolean;
}

/** The three payloads the request drawer renders: the output message, the journal entry, and the stats row. */
export interface OmpRequestPayload {
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

const EMPTY_REQUEST_PAYLOAD: OmpRequestPayload = {
  output: null,
  entry: null,
  messageRole: "",
  agent: { model: null, thinkingLevel: null, mode: null, fallback: null },
};

export interface OmpStats {
  available: boolean;
  range: OmpRange;
  bucketMs: number;
  cutoff: number;
  generatedAt: number;
  overall: OmpOverall;
  byModel: OmpRow[];
  byProvider: OmpRow[];
  byProject: OmpRow[];
  byAgentType: OmpAgentShare[];
  series: OmpBucket[];
  seriesByProvider: Array<{ provider: string; points: OmpBucket[] }>;
  modelSeries: Array<{ model: string; points: OmpBucket[] }>;
  modelPerformance: Array<{ model: string; provider: string; points: OmpModelPerformancePoint[] }>;
  hourOfDay: OmpHour[];
  topModels: OmpRow[];
  recent: OmpRequestRow[];
  errorGroups: OmpErrorGroup[];
  errorModels: OmpErrorModelRow[];
  traces: OmpTraceRow[];
  tools: OmpToolRow[];
  toolsByModel: OmpToolRow[];
  toolSeries: Array<{ ts: number; tool: string; calls: number; errors: number }>;
  usageSeries: OmpUsageWindowSeries[];
  windowInsights: OmpWindowInsight[];
  providerHourly: OmpProviderHour[];
  requestStats: OmpRequestStats;
  /** Raw failure rows inside the range, newest first: the Errors page's list. */
  errors: OmpRequestRow[];
}

export type OmpView =
  | "all" | "overview" | "models" | "providers" | "costs" | "requests"
  | "errors" | "traces" | "tools" | "projects";

export const OMP_VIEWS: readonly OmpView[] = [
  "all", "overview", "models", "providers", "costs", "requests",
  "errors", "traces", "tools", "projects",
];

/** One snapshot per window and view, so returning to a page is instant. */
const ompCache = new Map<string, OmpStats>();

/**
 * The omp aggregate for one page. Each view asks the server for only the parts it renders,
 * so a page payload stays small; the response is memoized per window and view.
 */
export function useOmpData(range: OmpRange, view: OmpView): { omp: OmpStats | null; loading: boolean } {
  const key = `${range}|${view}`;
  const [omp, setOmp] = useState<OmpStats | null>(() => snapOmp() ?? ompCache.get(key) ?? null);
  const [loading, setLoading] = useState(() => !isFileExport() && !ompCache.has(key) && !snapOmp());

  useEffect(() => {
    if (isFileExport()) return;
    const held = ompCache.get(key);
    if (held) {
      setOmp(held);
      setLoading(false);
    }
    let live = true;
    const load = async (): Promise<void> => {
      try {
        const next = await getJSON<{ omp: OmpStats }>(`api/omp?range=${range}&view=${view}`);
        if (!live) return;
        ompCache.set(key, next.omp);
        setOmp(next.omp);
        setLoading(false);
      } catch {
        // A dashboard without the route keeps whatever it already showed.
        if (live) setLoading(false);
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

  return { omp, loading };
}

/** One session transcript, for the Traces page's timeline. */
export function useSessionTrace(file: string | null): { trace: OmpSessionTrace | null; loading: boolean } {
  const [trace, setTrace] = useState<OmpSessionTrace | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!file || isFileExport()) {
      setTrace(null);
      return;
    }
    let live = true;
    setLoading(true);
    getJSON<OmpSessionTrace>(`api/omp/session?file=${encodeURIComponent(file)}`)
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
export function useOmpRequestEntry(file: string | null, entryId: string | null): { entry: OmpRequestPayload; loading: boolean } {
  const [entry, setEntry] = useState<OmpRequestPayload>(EMPTY_REQUEST_PAYLOAD);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!file || !entryId || isFileExport()) {
      setEntry(EMPTY_REQUEST_PAYLOAD);
      return;
    }
    let live = true;
    setLoading(true);
    getJSON<OmpRequestPayload>(`api/omp/entry?file=${encodeURIComponent(file)}&entry=${encodeURIComponent(entryId)}`)
      .then((next) => {
        if (live) setEntry(next);
      })
      .catch(() => {
        if (live) setEntry(EMPTY_REQUEST_PAYLOAD);
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
  data?: UsageReport;
  omp?: OmpStats;
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

function snapOmp(): OmpStats | null {
  return snap()?.omp ?? null;
}

export function isFileExport(): boolean {
  return typeof window !== "undefined" && window.location.protocol === "file:";
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(path);
  return (await res.json()) as T;
}

function normalizeReport(d: UsageReport): UsageReport {
  return { ...d, byHost: d.byHost ?? {} };
}

export function useDashboardData(): { data: UsageReport | null; loading: boolean; status: string | null } {
  const [data, setData] = useState<UsageReport | null>(() => {
    const s = snap()?.data;
    return s ? normalizeReport(s) : null;
  });
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => !isFileExport() && !snap()?.data);
  const lastJson = useRef<string>(data ? JSON.stringify(data) : "");
  const lastStatus = useRef<string>("");

  // Rides the poll below rather than opening a second interval.
  const loadStatus = useCallback(async () => {
    try {
      const s = (await getJSON<{ status: string }>("status")).status;
      if (typeof s !== "string" || s === lastStatus.current) return;
      lastStatus.current = s;
      setStatus(s);
    } catch {
      // A server without /status just leaves the banner hidden.
    }
  }, []);

  const load = useCallback(async () => {
    void loadStatus();
    try {
      const raw = await getJSON<UsageReport>("data.json");
      const d = normalizeReport(raw);
      const json = JSON.stringify(raw);
      if (json === lastJson.current) return;
      lastJson.current = json;
      setData(d);
      setLoading(false);
    } catch {
      // Served mode only has the endpoint; file:// exports use the snapshot.
    } finally {
      setLoading(false);
    }
  }, [loadStatus]);

  useEffect(() => {
    if (isFileExport()) return;
    // Initial load always runs; the poll below skips hidden tabs.
    void load();
    const id = setInterval(() => {
      if (!document.hidden) void load();
    }, 5000);
    const onVis = (): void => {
      if (!document.hidden) void load();
    };
    const onDemand = (): void => {
      void load();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("tersio:reload", onDemand);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("tersio:reload", onDemand);
    };
  }, [load]);

  return { data, loading, status };
}

export interface FxState {
  cur: string;
  rates: Record<string, number>;
  live: boolean;
}

export function useFx(serverDefault: string | undefined): {
  fx: FxState;
  money: (v: number) => string;
  applyCurrency: (code: string) => void;
} {
  const [fx, setFx] = useState<FxState>(() => {
    let cur = "USD";
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
