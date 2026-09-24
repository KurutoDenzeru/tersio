// Dashboard data contract. Mirrors cli/usage.ts UsageReport plus the
// /health and /doctor endpoints served by cli/dashboard.ts. The hook polls
// data.json every 5s while served and visible, exactly like the original
// load(); identical payloads skip re-render. Export snapshots ride
// window.__TERSIO_SNAP so file:// renders without a server.
import { useCallback, useEffect, useRef, useState } from "react";
import { FX_SNAPSHOT, fxMoney, isCurrencyCode } from "./format";
import type { TokenBreakdown } from "./format";

export interface RecentRequestRow {
  m: string;
  i: number;
  o: number;
  t: number;
  d?: number;
  cr?: number;
  cw?: number;
  usd?: number;
  st: "completed" | "aborted" | "error";
  code?: number;
  note?: string;
  est: number;
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

export interface UsageReport {
  messages: number;
  tokens: TokenBreakdown;
  byModel: Record<string, TokenBreakdown>;
  byModelUsd: Record<string, number>;
  byModelBucketUsd: Record<string, TokenBreakdown>;
  byModelMessages: Record<string, number>;
  byDay: Record<string, TokenBreakdown>;
  byDayModel: Record<string, Record<string, number>>;
  byTool: Array<[string, number]>;
  recent: RecentRequestRow[];
  rtkGain: RtkGain;
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

export interface HealthReport {
  tersio: string;
  node: string;
  platform: string;
  omp: string | null;
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

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(path);
  return (await res.json()) as T;
}

export function useDashboardData(): UsageReport | null {
  const [data, setData] = useState<UsageReport | null>(() => snap()?.data ?? null);
  const lastJson = useRef<string>(data ? JSON.stringify(data) : "");

  const load = useCallback(async () => {
    if (typeof document !== "undefined" && document.hidden) return;
    try {
      const d = await getJSON<UsageReport>("data.json");
      const json = JSON.stringify(d);
      if (json === lastJson.current) return;
      lastJson.current = json;
      setData(d);
    } catch {
      // Served mode only has the endpoint; file:// exports use the snapshot.
    }
  }, []);

  useEffect(() => {
    if (isFileExport()) return;
    load();
    const id = setInterval(load, 5000);
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

  return data;
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
