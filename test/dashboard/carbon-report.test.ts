// The CO2 dialog's numbers: the per-model split, the tail fold, and the
// everyday comparisons. Every total is checked back against the shared
// EcoLogits port so the dialog cannot drift from the card.
import { expect, test } from "vitest";

import { carbonReport, fmtCo2, fmtEnergy } from "../../dashboard/app/src/lib/carbon.ts";
import type { UsageReport } from "../../dashboard/app/src/lib/data.ts";
import { footprintFor } from "../../extensions/shared/carbon.ts";

const ZERO = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function report(over: Partial<UsageReport> = {}): UsageReport {
  return {
    messages: 0,
    tokens: { ...ZERO },
    byModel: {},
    byModelUsd: {},
    byModelBucketUsd: {},
    byModelMessages: {},
    byDay: {},
    byDayModel: {},
    byTool: [],
    recent: [],
    rtkGain: { commands: 0, input: 0, saved: 0, avgPct: 0, totalMs: 0, byCommand: [] },
    rtkAdoption: { sessions: 0, bashCalls: 0, eligibleCalls: 0, rtkCalls: 0, missedCalls: 0, adoptionPct: 0 },
    rtkRecall: { mode: "disabled", entries: 0, available: false },
    usd: 0,
    priced: true,
    savedUsd: 0,
    costMeasured: 0,
    co2g: 0,
    energyWh: 0,
    version: "0.0.0-test",
    currency: "USD",
    source: "live",
    paths: { ledger: "", sessions: "", usageDb: "" },
    ...over,
  };
}

function withModels(models: Record<string, number>, over: Partial<UsageReport> = {}): UsageReport {
  const byModel: Record<string, UsageReport["tokens"]> = {};
  for (const [model, output] of Object.entries(models)) byModel[model] = { ...ZERO, output };
  return report({
    byModel,
    tokens: { ...ZERO, output: Object.values(models).reduce((a, b) => a + b, 0) },
    ...over,
  });
}

test("an empty report models nothing", () => {
  const r = carbonReport(report());
  expect(r.rows).toEqual([]);
  expect(r.totalG).toBe(0);
  expect(r.energyWh).toBe(0);
  expect(r.comparisons).toEqual([]);
  expect(r.cacheShare).toBe(0);
});

test("a missing report is handled like an empty one", () => {
  expect(carbonReport(null).rows).toEqual([]);
});

test("totals equal the shared EcoLogits model applied per model", () => {
  const models = { "claude-opus-4": 40_000, "claude-haiku-4": 250_000, "gpt-5": 12_000 };
  const r = carbonReport(withModels(models));
  const expected = Object.entries(models).reduce((sum, [m, out]) => sum + footprintFor(m, out).gco2, 0);
  expect(r.totalG).toBeCloseTo(expected, 9);
  expect(r.energyWh).toBeCloseTo(
    Object.entries(models).reduce((sum, [m, out]) => sum + footprintFor(m, out).energyWh, 0),
    9,
  );
  expect(r.outputTokens).toBe(302_000);
});

test("rows are ranked by emissions and their shares add up", () => {
  const r = carbonReport(withModels({ "claude-opus-4": 40_000, "claude-haiku-4": 900_000, "gpt-5": 12_000 }));
  const g = r.rows.map((row) => row.gco2);
  expect([...g].sort((a, b) => b - a)).toEqual(g);
  expect(r.rows.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(1, 9);
});

test("the tail folds into one row and nothing is lost", () => {
  const models: Record<string, number> = {};
  for (let i = 0; i < 9; i++) models[`claude-haiku-4-t${i}`] = (i + 1) * 1000;
  const r = carbonReport(withModels(models));
  expect(r.rows).toHaveLength(5);
  expect(r.otherCount).toBe(4);
  expect(r.rows.reduce((s, row) => s + row.gco2, 0) + r.otherG).toBeCloseTo(r.totalG, 9);
});

test("no tail means no other row", () => {
  const r = carbonReport(withModels({ "claude-haiku-4": 1000 }));
  expect(r.otherCount).toBe(0);
  expect(r.otherG).toBe(0);
});

test("models without output tokens are left out", () => {
  const r = carbonReport(withModels({ "claude-haiku-4": 0, "gpt-5": 500 }));
  expect(r.rows.map((row) => row.model)).toEqual(["gpt-5"]);
});

test("cache share counts both cache buckets over all tokens", () => {
  const tokens = { input: 10, output: 30, cacheRead: 50, cacheWrite: 10 };
  const r = carbonReport(report({ byModel: { "gpt-5": tokens }, tokens }));
  expect(r.cacheShare).toBeCloseTo(60, 9);
});

test("comparisons divide by the rate printed beside them", () => {
  const small = carbonReport(withModels({ "claude-haiku-4": 100 }));
  const driving = small.comparisons.find((c) => c.label === "Driving");
  expect(driving?.icon).toBe("car");
  expect(driving?.factor).toContain("0.24 kg per km");
  // Metres branch, so the printed number is checkable against the rate by hand.
  expect(driving?.value).toBe(`${Math.round((small.totalG / 1000 / 0.24) * 1000)} m`);

  const large = carbonReport(withModels({ "claude-opus-4": 500_000 }));
  expect(large.comparisons.find((c) => c.label === "Driving")?.value).toBe(
    `${(large.totalG / 1000 / 0.24).toFixed(1)} km`,
  );
  expect(large.comparisons).toHaveLength(4);
  expect(large.comparisons.every((c) => c.icon && c.factor)).toBeTruthy();
});

test("formatters stay readable across magnitudes", () => {
  expect(fmtCo2(0)).toBe("0 g");
  expect(fmtCo2(0.4)).toBe("<1 g");
  expect(fmtCo2(12.34)).toBe("12.3 g");
  expect(fmtCo2(1500)).toBe("1.50 kg");
  expect(fmtEnergy(0)).toBe("0 Wh");
  expect(fmtEnergy(880)).toBe("880.0 Wh");
  expect(fmtEnergy(1500)).toBe("1.50 kWh");
});