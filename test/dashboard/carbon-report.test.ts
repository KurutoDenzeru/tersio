// Totals check back against the shared EcoLogits port.
import { expect, test } from "vitest";

import { carbonReportForAgents } from "../../dashboard/app/src/lib/carbon.ts";
import type { AgentOverall, AgentRow, AgentStats } from "../../dashboard/app/src/lib/data.ts";
import { footprintFor } from "../../extensions/shared/carbon.ts";

const MIX: AgentOverall = {
  input: 9000,
  output: 3000,
  cacheRead: 6000,
  cacheWrite: 2000,
  total: 20_000,
  requests: 12,
  failed: 0,
  successful: 12,
  errorRate: 0,
  cacheRate: 0.3,
  cacheSavings: 0,
  costUsd: 1,
  unpricedRequests: 0,
  avgDurationMs: 0,
  avgTtftMs: 0,
  avgTokensPerSecond: 0,
  firstTs: null,
  lastTs: null,
};

function ompRow(key: string, provider: string, output: number): AgentRow {
  return {
    key,
    provider,
    requests: 1,
    failed: 0,
    errorRate: 0,
    cacheRate: 0,
    cacheSavings: 0,
    costUsd: 0,
    unpricedRequests: 0,
    avgDurationMs: 0,
    avgTtftMs: 0,
    avgTokensPerSecond: 0,
    firstTs: null,
    lastTs: null,
    models: 1,
    input: 0,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    total: output,
  };
}

function agentStats(rows: AgentRow[]): AgentStats {
  return {
    available: true,
    range: "7d",
    bucketMs: 86_400_000,
    cutoff: 0,
    generatedAt: 0,
    overall: MIX,
    byModel: rows,
    byProvider: [],
    byProject: [],
    byAgentType: [],
    series: [],
    seriesByProvider: [],
    modelSeries: [],
    modelPerformance: [],
    hourOfDay: [],
    topModels: [],
    recent: [],
    errorGroups: [],
    errorModels: [],
    traces: [],
    tools: [],
    toolsByModel: [],
    toolSeries: [],
    usageSeries: [],
    windowInsights: [],
    providerHourly: [],
    requestStats: {
      requests: 12,
      failed: 0,
      aborted: 0,
      tokens: 20_000,
      costUsd: 1,
      unpriced: 0,
      medianDurationMs: 0,
      p95DurationMs: 0,
      medianTtftMs: 0,
      oldest: null,
      newest: null,
    },
    errors: [],
  };
}

test("the agent adapter totals from the shared EcoLogits model", () => {
  const models: Array<[string, string, number]> = [
    ["claude-opus-4", "anthropic", 40_000],
    ["claude-haiku-4", "anthropic", 250_000],
    ["gpt-5", "openai", 12_000],
  ];
  const r = carbonReportForAgents(agentStats(models.map(([k, p, o]) => ompRow(k, p, o))));
  const expected = models.reduce((sum, [m, , out]) => sum + footprintFor(m, out).gco2, 0);
  expect(r.totalG).toBeCloseTo(expected, 9);
  expect(r.energyWh).toBeCloseTo(
    models.reduce((sum, [m, , out]) => sum + footprintFor(m, out).energyWh, 0),
    9,
  );
  expect(r.outputTokens).toBe(302_000);
});

test("the agent adapter keeps every model, not just the folded five", () => {
  const rows = Array.from({ length: 9 }, (_, i) => ompRow(`claude-haiku-4-t${i}`, "anthropic", (i + 1) * 1000));
  const r = carbonReportForAgents(agentStats(rows));
  expect(r.rows).toHaveLength(5);
  expect(r.all).toHaveLength(9);
  expect(r.otherCount).toBe(4);
  const g = r.all.map((row) => row.gco2);
  expect([...g].sort((a, b) => b - a)).toEqual(g);
});

test("the agent adapter names the routing service and the parameter provenance", () => {
  const r = carbonReportForAgents(agentStats([ompRow("claude-opus-4", "magpie", 40_000), ompRow("Stealth-Space-Bunny", "commandcode", 500)]));
  const byKey = new Map(r.all.map((row) => [row.model, row]));
  // The routing service wins over the provider the port attributes the model to.
  expect(byKey.get("claude-opus-4")?.provider).toBe("magpie");
  expect(byKey.get("claude-opus-4")?.paramSource).toBe("registry");
  expect(byKey.get("Stealth-Space-Bunny")?.paramSource).toBe("default");
  expect(r.all.every((row) => row.label && row.energyWh > 0 && row.share > 0)).toBeTruthy();
});

test("a missing agent snapshot is handled like an empty one", () => {
  expect(carbonReportForAgents(null).all).toEqual([]);
  expect(carbonReportForAgents(agentStats([])).totalG).toBe(0);
  expect(carbonReportForAgents(agentStats([ompRow("claude-haiku-4", "anthropic", 0)])).all).toEqual([]);
});