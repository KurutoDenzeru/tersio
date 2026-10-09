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
  /** Time to first token when the host recorded one; omp records it, pi and opencode do not — absent stays absent. */
  tf?: number;
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
  /** Tools invoked during this turn, in order. The per-request record we can actually support. */
  tools?: string[];
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

export interface UnpricedModel {
  model: string;
  tokens: number;
  messages: number;
}

export interface UsageReport {
  messages: number;
  tokens: TokenBreakdown;
  byModel: Record<string, TokenBreakdown>;
  byModelUsd: Record<string, number>;
  byModelBucketUsd: Record<string, TokenBreakdown>;
  byModelMessages: Record<string, number>;
  byHost: Record<string, Record<string, TokenBreakdown>>;
  /** Which provider served the call, from the model_change provider or the model-id prefix. */
  byProvider: Array<[string, TokenBreakdown]>;
  /** Session working directory. A "project" in the transcripts is a cwd. */
  byProject: Array<[string, TokenBreakdown]>;
  byDay: Record<string, TokenBreakdown>;
  byDayModel: Record<string, Record<string, number>>;
  /** Per-day, per-model tokens: the exact input to a model breakdown and a cost-over-time series. */
  byDayModelTokens: Record<string, Record<string, TokenBreakdown>>;
  /** Per-day requests per model, so the share chart can be request-based. */
  byDayModelRuns: Record<string, Record<string, number>>;
  /** Per-day tables, so a page can recompute its own numbers for the selected range. */
  byDayProvider: Record<string, Record<string, TokenBreakdown>>;
  byDayProject: Record<string, Record<string, TokenBreakdown>>;
  byDayErrors: Record<string, Record<string, number>>;
  /** Per-day failures per model key, so a model row can show its own error rate for the range. */
  byDayModelErrors: Record<string, Record<string, number>>;
  byDayTool: Record<string, Record<string, number>>;
  /** Vendor-reported cost per day. Empty when the host reported none. */
  byDayCost: Record<string, number>;
  /** API-equivalent cost per day, priced models only, so cost follows the selected range. */
  byDayApiUsd: Record<string, number>;
  /** Cache savings per day, priced models only. */
  byDaySavedUsd: Record<string, number>;
  /** API-equivalent cost per day per model label, so a model table follows the range. */
  byDayModelUsd: Record<string, Record<string, number>>;
  byTool: Array<[string, number]>;
  /** Reasoning tokens, billed as output by most providers. */
  reasoning: number;
  /** Runs that did not end completed, keyed by status. */
  errors: Record<string, number>;
  recent: RecentRequestRow[];
  rtkGain: RtkGain;
  rtkAdoption: RtkAdoption;
  rtkRecall: RtkRecallDiagnostics;
  /** API-equivalent total: priced models only. Unpriced usage is excluded, never defaulted. */
  usd: number;
  /** False when at least one model lacked a public price, so `usd` understates what was really spent. */
  priced: boolean;
  /** How many models had a public price, of how many ran. */
  pricingCoverage: { priced: number; total: number };
  /** Internal model key to display label, so every page names a model the same way. */
  modelLabels: Record<string, string>;
  /**
   * Catalogued rate per display label plus the provider that serves it, quoted per million tokens.
   * This is how a page shows where a price came from instead of only that one is missing.
   */
  modelRates: Record<string, { provider: string | null; known: boolean; input: number; output: number; cacheRead: number; cacheWrite: number }>;
  /** The pricing catalog's own size, so a coverage figure has a source behind it. */
  pricingCatalog: { providers: number; models: number; fetchedAt: number | null };
  /** Mean elapsed wall clock per model. Absent for a model no row carried a duration for. */
  latency: Record<string, { ms: number; n: number }>;
  /** Mean time to first token per model. OMP reports it; pi and opencode do not. */
  ttft: Record<string, { ms: number; n: number }>;
  /** Models with no public price. Excluded from `usd`, and listed so the gap stays visible. */
  unpriced: UnpricedModel[];
  savedUsd: number;
  costMeasured: number;
  co2g: number;
  energyWh: number;
  version: string;
  currency: string;
  source: "live" | "stored" | "stored-stale";
  paths: { ledger: string; sessions: string; usageDb: string };
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

export function isFileExport(): boolean {
  return typeof window !== "undefined" && window.location.protocol === "file:";
}

/** Last ETag per endpoint path, replayed as `If-None-Match` on the next request. */
const etags = new Map<string, string>();

/** Set when a request answered 304, so the caller can skip the re-render without throwing. */
const UNCHANGED = Symbol("unchanged");

/**
 * `fetch` that replays the ETag the server last sent, so a poll with no new usage events comes
 * back 304 and costs no transfer. Without this the 5s poll re-downloads the whole report.
 */
async function getJSON<T>(path: string): Promise<T | typeof UNCHANGED> {
  const tag = etags.get(path);
  const res = await fetch(path, { headers: tag ? { 'If-None-Match': tag } : undefined });
  if (res.status === 304) return UNCHANGED;
  const etag = res.headers.get('ETag');
  if (etag) etags.set(path, etag);
  return (await res.json()) as T;
}

/** `getJSON` with the unchanged marker folded away, for callers that have nothing to update. */
async function getJSONFresh<T>(path: string): Promise<T | null> {
  const body = await getJSON<T>(path);
  return body === UNCHANGED ? null : body;
}

/** Error body the dashboard server returns with a 4xx or 5xx. */
interface ApiError {
  error: string;
}

/**
 * Like getJSON, but a failed response throws the server's own message instead of parsing its body
 * into the caller's type. The session endpoints report why a transcript could not be read here.
 */
async function getJSONOk<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, signal ? { signal } : undefined);
  const body = (await res.json()) as T | ApiError;
  if (!res.ok) {
    const message = (body as ApiError).error;
    throw new Error(typeof message === "string" ? message : `HTTP ${res.status}`);
  }
  return body as T;
}

// Older snapshots and the file:// export predate the newer aggregates, so every one is defaulted here.
function normalizeReport(d: UsageReport): UsageReport {
  return {
    ...d,
    byHost: d.byHost ?? {},
    byProvider: d.byProvider ?? [],
    byProject: d.byProject ?? [],
    errors: d.errors ?? {},
    unpriced: d.unpriced ?? [],
    pricingCoverage: d.pricingCoverage ?? { priced: 0, total: 0 },
    reasoning: d.reasoning ?? 0,
    byDayProvider: d.byDayProvider ?? {},
    byDayProject: d.byDayProject ?? {},
    byDayModelTokens: d.byDayModelTokens ?? {},
    byDayModelRuns: d.byDayModelRuns ?? {},
    byDayErrors: d.byDayErrors ?? {},
    byDayTool: d.byDayTool ?? {},
    byDayCost: d.byDayCost ?? {},
    byDayApiUsd: d.byDayApiUsd ?? {},
    byDaySavedUsd: d.byDaySavedUsd ?? {},
    byDayModelUsd: d.byDayModelUsd ?? {},
    modelLabels: d.modelLabels ?? {},
    modelRates: d.modelRates ?? {},
    pricingCatalog: d.pricingCatalog ?? { providers: 0, models: 0, fetchedAt: null },
    byDayModelErrors: d.byDayModelErrors ?? {},
    latency: d.latency ?? {},
    ttft: d.ttft ?? {},
  };
}

export function useDashboardData(): { data: UsageReport | null; loading: boolean; status: string | null } {
  const [data, setData] = useState<UsageReport | null>(() => {
    const s = snap()?.data;
    return s ? normalizeReport(s) : null;
  });
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => !isFileExport() && !snap()?.data);
  // Holds the last payload's change stamp, not the payload itself: see load() below.
  const lastStamp = useRef<string>(data ? JSON.stringify(data) : "");
  const lastStatus = useRef<string>("");

  // Rides the poll below rather than opening a second interval.
  const loadStatus = useCallback(async () => {
    try {
      const s = await getJSON<{ status: string }>("status");
      if (s === UNCHANGED) return;
      if (typeof s.status !== "string" || s.status === lastStatus.current) return;
      lastStatus.current = s.status;
      setStatus(s.status);
    } catch {
      // A server without /status just leaves the banner hidden.
    }
  }, []);

  const load = useCallback(async () => {
    void loadStatus();
    try {
      const raw = await getJSON<UsageReport>("data.json");
      if (raw === UNCHANGED) return;
      // A 304 leaves the ETag path empty; nothing changed, so skip the re-render entirely.
      const stamp = `${raw.messages}|${raw.costMeasured}|${raw.recent?.length ?? 0}`;
      if (stamp === lastStamp.current) return;
      lastStamp.current = stamp;
      setData(normalizeReport(raw));
      setLoading(false);
    } catch {
      // The endpoint is served-mode only; file:// exports use the snapshot.
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
    return (await getJSONFresh<HealthReport>("health")) ?? s ?? null;
  } catch {
    return s ?? null;
  }
}

export async function fetchDoctor(fresh: boolean): Promise<DoctorReport | null> {
  const s = snap()?.doctor;
  if (isFileExport()) return s ?? null;
  try {
    return (await getJSONFresh<DoctorReport>(fresh ? "doctor?fresh=1" : "doctor")) ?? s ?? null;
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

// Session traces. The dashboard server extracts these from the pi/omp transcripts; the shapes below
// mirror that response, so this app stays standalone and never imports the server's own types.
export type SpanKind = "turn" | "model" | "tool" | "subagent" | "background";

export interface SessionListEntry {
  /** Absolute path of the main transcript. It is the key the trace endpoint takes. */
  file: string;
  folder: string | null;
  title: string | null;
  startedAt: number;
  endedAt: number;
  requests: number;
  toolCalls: number;
  subagents: number;
  totalTokens: number;
  costTotal: number;
  unpricedRequests: number;
  models: string[];
}

export interface TraceSpan {
  id: string;
  kind: SpanKind;
  start: number;
  end: number;
  label: string;
  entryId?: string;
  /** Tool arguments or task prompt, capped server-side. */
  detail?: string;
  childTrackId?: string;
  model?: string;
  ttft?: number;
  tokens?: number;
  error?: boolean;
  stop?: string;
  /** A tool call with no result yet: the span ends at the last recorded row. */
  unterminated?: boolean;
}

export interface TraceMarker {
  time: number;
  kind: "model_change" | "mode_change" | "session_exit";
  label: string;
}

export interface TraceTrack {
  id: string;
  parentId: string | null;
  label: string;
  agent: string | null;
  /** The transcript this track was read from; pair it with a span's entryId. */
  file: string;
  model: string | null;
  spans: TraceSpan[];
  markers: TraceMarker[];
}

export interface TraceToolStat {
  tool: string;
  calls: number;
  errors: number;
  totalMs: number;
  maxMs: number;
}

export interface TraceSummary {
  wallMs: number;
  modelMs: number;
  toolMs: number;
  idleMs: number;
  turns: number;
  requests: number;
  toolCalls: number;
  subagents: number;
  totalTokens: number;
  costTotal: number;
  unpricedRequests: number;
  models: string[];
  toolStats: TraceToolStat[];
}

export interface SessionTrace {
  file: string;
  title: string | null;
  cwd: string | null;
  startedAt: number;
  endedAt: number;
  tracks: TraceTrack[];
  summary: TraceSummary;
}

/** One raw transcript row, as the entry endpoint returns it. Only role and content are read. */
export interface TranscriptEntry {
  role?: unknown;
  timestamp?: unknown;
  content?: unknown;
  [key: string]: unknown;
}

/** Newest first. `q` is matched by the server against title, folder, and model ids. */
export async function fetchSessions(q: string, signal?: AbortSignal): Promise<SessionListEntry[]> {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  const query = params.toString();
  const body = await getJSONOk<{ sessions: SessionListEntry[] }>(query ? `sessions?${query}` : "sessions", signal);
  return body.sessions ?? [];
}

export async function fetchTrace(file: string, signal?: AbortSignal): Promise<SessionTrace> {
  return getJSONOk<SessionTrace>(`session/trace?file=${encodeURIComponent(file)}`, signal);
}

export async function fetchEntry(file: string, id: string, signal?: AbortSignal): Promise<TranscriptEntry> {
  const body = await getJSONOk<{ entry: TranscriptEntry }>(
    `session/entry?file=${encodeURIComponent(file)}&id=${encodeURIComponent(id)}`,
    signal,
  );
  return body.entry;
}
