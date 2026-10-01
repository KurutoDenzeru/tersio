// Pure per-report CO2 totals; depth lives in the shared EcoLogits port.

import { ECOLOGITS_VERSION, footprintFor } from "../../../../extensions/shared/carbon.ts";
import { displayModel } from "./format";
import type { UsageReport } from "./data";

// Published per-unit averages, each printed beside its result so a reader can
// redo the arithmetic. None of them describes the reader's own life.
const KG_PER_KM_DRIVEN = 0.24; // EPA: 4.6 t/yr over 12,000 mi
const WH_PER_PHONE_CHARGE = 15; // ~12 Wh cell plus charging losses
const G_PER_STREAM_HOUR = 10; // Netflix, per hour of playback
const WH_PER_HOUSEHOLD_DAY = 29_600; // EIA: ~10,800 kWh/yr, residential

/** Above this the tail folds into one row, the way Activity folds its models. */
const MAX_ROWS = 5;

interface CarbonRow {
  model: string;
  label: string;
  gco2: number;
  /** Fraction of the total, 0 to 1. */
  share: number;
}

export interface Comparison {
  label: string;
  icon: string;
  value: string;
  factor: string;
}

export interface CarbonReport {
  totalG: number;
  energyWh: number;
  outputTokens: number;
  rows: CarbonRow[];
  otherG: number;
  otherCount: number;
  comparisons: Comparison[];
  /** Cache reads and writes as a share of all tokens. */
  cacheShare: number;
  ecologits: string;
}

const EMPTY: CarbonReport = {
  totalG: 0,
  energyWh: 0,
  outputTokens: 0,
  rows: [],
  otherG: 0,
  otherCount: 0,
  comparisons: [],
  cacheShare: 0,
  ecologits: ECOLOGITS_VERSION,
};

export function fmtCo2(g: number): string {
  if (!(g > 0)) return "0 g";
  if (g < 1) return "<1 g";
  if (g < 1000) return `${g.toFixed(1)} g`;
  return `${(g / 1000).toFixed(2)} kg`;
}

export function fmtEnergy(wh: number): string {
  if (!(wh > 0)) return "0 Wh";
  if (wh < 1000) return `${wh.toFixed(1)} Wh`;
  return `${(wh / 1000).toFixed(2)} kWh`;
}

function fmtKm(km: number): string {
  if (!(km > 0)) return "0 km";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 100) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString("en-US")} km`;
}

function fmtCount(n: number): string {
  if (!(n > 0)) return "0";
  if (n < 1) return "<1";
  if (n < 100) return n.toFixed(1);
  return Math.round(n).toLocaleString("en-US");
}

function comparisonsFor(totalG: number, energyWh: number): Comparison[] {
  // Nothing to compare against, so the caller shows its empty state; this also
  // keeps a missing report and an empty one on the same shape.
  if (!(totalG > 0) && !(energyWh > 0)) return [];
  // "at X per Y" keeps each tile to one short sentence, and short enough not to clip.
  return [
    {
      label: "Driving",
      icon: "car",
      value: fmtKm(totalG / 1000 / KG_PER_KM_DRIVEN),
      factor: `at ${KG_PER_KM_DRIVEN} kg per km`,
    },
    {
      label: "Phone charges",
      icon: "smartphone",
      value: fmtCount(energyWh / WH_PER_PHONE_CHARGE),
      factor: `at ${WH_PER_PHONE_CHARGE} Wh per charge`,
    },
    {
      label: "Streaming",
      icon: "monitor-play",
      value: `${fmtCount(totalG / G_PER_STREAM_HOUR)} h`,
      factor: `at ${G_PER_STREAM_HOUR} g per hour`,
    },
    {
      // Days, not a share of one day: a heavy month passes 100%, which means nothing.
      label: "Home power",
      icon: "plug",
      value: `${(energyWh / WH_PER_HOUSEHOLD_DAY).toFixed(1)} days`,
      factor: `at ${(WH_PER_HOUSEHOLD_DAY / 1000).toFixed(1)} kWh per day`,
    },
  ];
}

export function carbonReport(data: UsageReport | null): CarbonReport {
  if (!data) return EMPTY;

  // Only output tokens are billed, so a model with none contributes nothing.
  const all = Object.entries(data.byModel ?? {})
    .map(([model, b]) => ({ model, label: displayModel(model), gco2: footprintFor(model, b.output ?? 0).gco2 }))
    .filter((r) => r.gco2 > 0)
    .sort((a, b) => b.gco2 - a.gco2);

  const totalG = all.reduce((sum, r) => sum + r.gco2, 0);
  const rows = all.slice(0, MAX_ROWS).map((r) => ({ ...r, share: totalG ? r.gco2 / totalG : 0 }));
  const rest = all.slice(MAX_ROWS);
  const energyWh = all.reduce((sum, r) => sum + footprintFor(r.model, data.byModel[r.model]?.output ?? 0).energyWh, 0);
  const outputTokens = Object.values(data.byModel ?? {}).reduce((sum, b) => sum + (b.output ?? 0), 0);

  const t = data.tokens ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const tokenTotal = t.input + t.output + t.cacheRead + t.cacheWrite;

  return {
    totalG,
    energyWh,
    outputTokens,
    rows,
    otherG: rest.reduce((sum, r) => sum + r.gco2, 0),
    otherCount: rest.length,
    comparisons: comparisonsFor(totalG, energyWh),
    cacheShare: tokenTotal ? ((t.cacheRead + t.cacheWrite) / tokenTotal) * 100 : 0,
    ecologits: ECOLOGITS_VERSION,
  };
}