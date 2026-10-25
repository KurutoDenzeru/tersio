// Totals check back against the shared EcoLogits port.
import { expect, test } from "vitest";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { carbonReportForAgents } from "../../dashboard/app/src/lib/carbon.ts";
import { displayModel, errorRateTone, hostOfSession, vendorOf } from "../../dashboard/app/src/lib/format.ts";
import { graphOf, graphWeeks, streaksOf, stripOf } from "../../dashboard/app/src/lib/graph.ts";
import { requestDetailJson } from "../../dashboard/app/src/components/request-drawer.tsx";
import type { AgentOverall, AgentRow, AgentStats, RecentRequestRow } from "../../dashboard/app/src/lib/data.ts";
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

test("provider-prefixed keys fold into vendor-first labels", () => {
  expect(displayModel("space-bunny")).toBe("Stealth - Space-Bunny");
  expect(displayModel("opencode/Openai/gpt-5.2-Codex")).toBe("OpenAI - GPT-5.2-Codex");
  expect(displayModel("opencode/Github-Copilot/claude-Haiku-4.5")).toBe("Anthropic - Claude - Haiku-4.5");
  expect(displayModel("opencode/Google/claude-Opus-4-5-Thinking")).toBe("Anthropic - Claude - Opus-4-5-Thinking");
  expect(displayModel("meta/Muse-Spark-1.3-Contributor")).toBe("Meta - Muse-Spark-1.3-Contributor");
  expect(displayModel("Gpt-6-Luna")).toBe("OpenAI - GPT-6-Luna");
  expect(displayModel("Swe-1-6-Slow")).toBe("Cognition - SWE-1-6-Slow");
  expect(displayModel("opencode/nvidia/minimaxai/minimax-m2.7")).toBe("Minimax-M2.7");
  expect(displayModel("opencode/nvidia/google/gemma-4-31b-it")).toBe("Google - Gemma-4-31B-IT");
  expect(displayModel("opencode/kilo/stealth/space-bunny-alpha")).toBe("Stealth - Space-Bunny");
  // Codex wraps the gateway and the provider, so the model's own id supplies both the name and the mark.
  expect(displayModel("codex/openai/zcode/glm-5.3-flash")).toBe("Z.ai - GLM-5.3-Flash");
  expect(vendorOf("codex/openai/zcode/glm-5.3-flash")).toMatchObject({ name: "Z.ai", slug: "zdotai" });
});

test("folded labels pass through untouched", () => {
  expect(displayModel("Stealth - Space-Bunny")).toBe("Stealth - Space-Bunny");
  expect(displayModel("OpenAI - GPT-5.2-Codex")).toBe("OpenAI - GPT-5.2-Codex");
  expect(displayModel("Anthropic - Claude - Haiku-4.5")).toBe("Anthropic - Claude - Haiku-4.5");
  expect(displayModel("Cognition - SWE-1-6-Slow")).toBe("Cognition - SWE-1-6-Slow");
});

test("labels skip a redundant vendor prefix and keep unknowns readable", () => {
  // DeepSeek spells itself with a capital S, so the label says the vendor once in its own spelling.
  expect(displayModel("Deepseek-V4.1-Flash")).toBe("DeepSeek - V4.1-Flash");
  expect(displayModel("deepseek/deepseek-reasoner")).toBe("DeepSeek - Reasoner");
  expect(displayModel("opencode/Github-Copilot/oswe-Vscode-Prime")).toBe("Github-Copilot - Oswe-Vscode-Prime");
  expect(displayModel("llama-3.3-70b")).toBe("Meta - Llama-3.3-70B");
});

test("vendor mapping covers Alibaba, InclusionAI, xAI, and open weights", () => {
  expect(vendorOf("llama-3.3-70b").name).toBe("Meta");
  expect(vendorOf("Qwen3.8-Flash").name).toBe("Alibaba");
  expect(displayModel("Qwen3.8-Flash")).toBe("Alibaba - Qwen3.8-Flash");
  expect(vendorOf("opencode/inclusionai/ling-3.1-flash").name).toBe("InclusionAI");
  expect(displayModel("opencode/inclusionai/ling-3.1-flash")).toBe("InclusionAI - Ling-3.1-Flash");
  expect(vendorOf("opencode/Github-Copilot/grok-code-fast-1").name).toBe("xAI");
  expect(displayModel("opencode/Github-Copilot/grok-code-fast-1")).toBe("xAI - Grok-Code-Fast-1");
  expect(vendorOf("opencode/Github-Copilot/claude-Haiku-4.5").name).toBe("Anthropic");
});

// omp's error-rate thresholds: 1% stops being noise, 5% stops being acceptable.
test("an error rate picks its tone on the omp stats thresholds", () => {
  expect(errorRateTone(0)).toBe("ok");
  expect(errorRateTone(0.004)).toBe("ok");
  expect(errorRateTone(0.0099)).toBe("ok");
  expect(errorRateTone(0.01)).toBe("warn");
  expect(errorRateTone(0.0499)).toBe("warn");
  expect(errorRateTone(0.05)).toBe("bad");
  expect(errorRateTone(0.5)).toBe("bad");
});

// The host mark reads the agent from the transcript path; a wrong omp path drew the pi logo on every OMP row.
const root = path.join(homedir(), ".omp", "agent", "sessions");

test("an omp session path reads as the OMP host", () => {
  // This is the shape omp writes today: `~/.omp/agent/sessions/<project>/<file>.jsonl`.
  expect(hostOfSession(path.join(root, "-Documents-Projects-Personal-tersio", "2026-10-12T14-48-05-216Z_x.jsonl")))
    .toEqual({ label: "OMP", host: "omp" });
});

test("the older `.agent/agent/sessions` spelling still reads as OMP", () => {
  expect(hostOfSession("/Users/u/.agent/agent/sessions/-proj/s.jsonl")).toEqual({ label: "OMP", host: "omp" });
});

test("pi and OpenCode keep their own hosts", () => {
  expect(hostOfSession(path.join(homedir(), ".pi", "agent", "sessions", "-proj", "s.jsonl")))
    .toEqual({ label: "Pi", host: "pi" });
  expect(hostOfSession(path.join(homedir(), ".config", "opencode", "agent", "sessions", "-proj", "s.jsonl")))
    .toEqual({ label: "OpenCode", host: "opencode" });
  expect(hostOfSession(path.join(homedir(), ".codex", "sessions", "2026", "10", "24", "rollout.jsonl")))
    .toEqual({ label: "Codex", host: "codex" });
});

test("an unrelated path falls back to OMP rather than guessing a host", () => {
  expect(hostOfSession("/tmp/elsewhere/s.jsonl")).toEqual({ label: "OMP", host: "unknown" });
});

// Fail on unknown Icon names, including dynamic sources lucide may rename.
const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "../../dashboard/app");
const components = path.join(appDir, "src/components");

// Resolve lucide-react from the dashboard app, not the root package.
const require = createRequire(path.join(appDir, "package.json"));
const { icons } = require("lucide-react") as { icons: Record<string, unknown> };

// Must match Icon.tsx's toPascal: "trash-2" -> "Trash2".
function toPascal(name: string): string {
  return name
    .split("-")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join("");
}

function iconNamesIn(file: string): Array<string> {
  const src = readFileSync(file, "utf8");
  // `s` matches a name on its own line; only string literals, so name={foo} is skipped, not guessed.
  const direct = [...src.matchAll(/<Icon\b[^>]*?\bname="([^"]+)"/gs)].map((m) => m[1]);
  // EmptyState renders an Icon internally, so its icon prop counts too.
  const empty = [...src.matchAll(/<EmptyState\b[^>]*?\bicon="([^"]+)"/gs)].map((m) => m[1]);
  // Dynamic icons reach <Icon name={...}> through icon: "..." pairs.
  const meta = [...src.matchAll(/\bicon:\s*"([^"]+)"/g)].map((m) => m[1]);
  return [...direct, ...empty, ...meta];
}

const libFiles = ["src/lib/format.ts", "src/lib/carbon.ts"].map((f) => path.join(appDir, f));

function zoneGlyphsIn(file: string): Array<string> {
  const src = readFileSync(file, "utf8");
  // Zone helpers return ["glyph", "label", "cls"]; the glyph is the icon name.
  return [...src.matchAll(/return\s*\[\s*"([^"]+)"/g)].map((m) => m[1]);
}

const files = readdirSync(components)
  .filter((f) => f.endsWith(".tsx") && f !== "Icon.tsx")
  .map((f) => path.join(components, f));

const all = files.flatMap((f) => iconNamesIn(f).map((name) => ({ file: path.basename(f), name })));
const libNames = libFiles.flatMap((f) => zoneGlyphsIn(f).map((name) => ({ file: path.relative(appDir, f), name })));
// The token strip lived in savings.tsx, which went with the usage page; nothing replaces it.
const dynamic = libNames;

test("every icon name resolves to a real lucide icon", () => {
  const broken = [...all, ...dynamic]
    .filter(({ name }) => !(toPascal(name) in icons))
    .map(({ file, name }) => `${file}: "${name}" -> ${toPascal(name)} not in lucide`);
  expect(broken, broken.join("\n")).toEqual([]);
});

const ROW: RecentRequestRow = {
  m: "opencode/github-copilot/claude-haiku-4.5",
  i: 2575,
  o: 140,
  t: 1790849074029,
  d: 3238,
  h: "opencode",
  cr: 128,
  est: 0,
  st: "completed",
  id: "msg_be5f66639001FzeXG2XfsYp946",
};

test("request detail carries the recorded fields and nothing invented", () => {
  const detail = requestDetailJson(ROW);
  expect(detail).toMatchObject({
    id: "msg_be5f66639001FzeXG2XfsYp946",
    model: "Anthropic - Claude - Haiku-4.5",
    modelKey: "opencode/github-copilot/claude-haiku-4.5",
    vendor: "Anthropic",
    agent: "opencode",
    status: "completed",
    inputTokens: 2575,
    outputTokens: 140,
    cacheReadTokens: 128,
    cacheWriteTokens: 0,
    elapsedMs: 3238,
  });
  expect(detail).not.toHaveProperty("requestID");
  expect(detail).not.toHaveProperty("headers");
  expect(typeof detail.time).toBe("string");
});

// The share grid spans the whole range window: from the Sunday on or before its start to the day the server ran.
const DAY = 86_400_000;
const HOUR = 3_600_000;
/** A fixed "now", so a window's shape never depends on the day the suite runs. */
const NOW = Date.UTC(2026, 9, 12);
/** A Sunday, so a window that opens on it starts a column. */
const SUNDAY = Date.UTC(2026, 8, 27);

interface Opts {
  cutoff?: number;
  generatedAt?: number;
}

function stats(range: AgentStats["range"], bucketMs: number, buckets: Array<[number, number]>, opts: Opts = {}): AgentStats {
  return {
    range,
    bucketMs,
    cutoff: opts.cutoff ?? 0,
    generatedAt: opts.generatedAt ?? NOW,
    series: buckets.map(([ts, tokens]) => ({ ts, requests: 1, errors: 0, tokens, costUsd: 0 })),
  } as unknown as AgentStats;
}

test("the window opens on the Sunday on or before the range's start", () => {
  // 2026-09-27 is a Sunday, so a cutoff of 09-28 still opens that column.
  const start = Date.UTC(2026, 8, 28);
  const cells = graphOf(stats("90d", DAY, [[start, 10]], { cutoff: start }));
  expect(cells[0]!.ts).toBe(SUNDAY);
  // The grid runs to the day the server ran, not to the newest bucket.
  expect(cells[cells.length - 1]!.ts).toBe(NOW);
  expect(cells).toHaveLength(16);
});

test("a day with no bucket draws as an empty cell, so leading gaps stay visible", () => {
  // The first bucket lands five days into the window, so five quiet boxes open it.
  const cells = graphOf(stats("90d", DAY, [[SUNDAY + 5 * DAY, 40]], { cutoff: SUNDAY, generatedAt: SUNDAY + 9 * DAY }));
  expect(cells).toHaveLength(10);
  expect(cells.slice(0, 5).map((c) => c.level)).toEqual([0, 0, 0, 0, 0]);
  expect(cells.slice(0, 5).every((c) => c.tokens === 0)).toBe(true);
  expect(cells[5]!.tokens).toBe(40);
});

test("a day bucket becomes one cell per weekday, Sunday first", () => {
  const cells = graphOf(
    stats("7d", DAY, [[SUNDAY, 10], [SUNDAY + DAY, 20], [SUNDAY + 2 * DAY, 30], [SUNDAY + 3 * DAY, 40]], {
      cutoff: SUNDAY,
      generatedAt: SUNDAY + 3 * DAY,
    }),
  );
  expect(cells).toHaveLength(4);
  // Rows are weekdays, so Sunday is day 0 and the following Monday is row 1.
  expect(cells.map((c) => c.day)).toEqual([0, 1, 2, 3]);
  expect(cells.every((c) => c.week === 0)).toBe(true);
  expect(cells.map((c) => c.tokens)).toEqual([10, 20, 30, 40]);
});

test("an empty bucket keeps a cell at level zero, and the busiest day is level four", () => {
  const cells = graphOf(
    stats(
      "30d",
      DAY,
      [
        [SUNDAY, 100],
        [SUNDAY + DAY, 0],
        [SUNDAY + 2 * DAY, 50],
        [SUNDAY + 3 * DAY, 10],
        [SUNDAY + 4 * DAY, 25],
      ],
      { cutoff: SUNDAY, generatedAt: SUNDAY + 4 * DAY },
    ),
  );
  expect(cells.map((c) => c.level)).toEqual([4, 0, 2, 1, 1]);
  expect(cells.map((c) => c.label)).toEqual(["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"]);
});

test("buckets shorter than a day fold into their UTC day", () => {
  const cells = graphOf(
    stats("24h", HOUR, [[SUNDAY, 5], [SUNDAY + 6 * HOUR, 7], [SUNDAY + 23 * HOUR, 3]], { cutoff: SUNDAY, generatedAt: SUNDAY }),
  );
  expect(cells).toHaveLength(1);
  expect(cells[0]!.tokens).toBe(15);
  expect(cells[0]!.label).toBe("2026-09-27");
});

test("the grid caps at 53 weeks and ends on the day the server ran", () => {
  const cells = graphOf(stats("all", DAY, [[SUNDAY - 400 * DAY, 3]], { generatedAt: NOW }));
  expect(graphWeeks(cells)).toBe(53);
  expect(cells[cells.length - 1]!.ts).toBe(NOW);
});

test("an all-time window draws the whole year even when its newest day is the only one with data", () => {
  // The card reads this grid as a contribution log, so a year of quiet cells is the point, not a gap.
  const cells = graphOf(stats("all", DAY, [[NOW, 10]], { generatedAt: NOW }));
  expect(graphWeeks(cells)).toBe(53);
  // A year of columns: the first opens on a Sunday, so the grid holds one partial week plus 52 full ones.
  expect(cells.length).toBeGreaterThan(360);
  expect(cells.length).toBeLessThanOrEqual(53 * 7);
  expect(cells.filter((c) => c.tokens > 0)).toHaveLength(1);
  // A bounded window still opens on its own cutoff, so a quiet range keeps drawing nothing.
  expect(graphOf(stats("24h", DAY, [], { cutoff: NOW }))).toEqual([]);
});

test("no buckets draws no graph", () => {
  expect(graphOf(stats("90d", DAY, [], { cutoff: NOW - 90 * DAY }))).toEqual([]);
});

test("the strip opens at the range's start and keeps quiet slots", () => {
  const start = Date.UTC(2026, 8, 20);
  const { unit, bars } = stripOf(stats("30d", DAY, [[start + 9 * DAY, 40]], { cutoff: start, generatedAt: start + 9 * DAY }));
  expect(unit).toBe("day");
  expect(bars).toHaveLength(10);
  expect(bars.slice(0, 9).every((b) => b.tokens === 0)).toBe(true);
  expect(bars[9]!.tokens).toBe(40);
});

test("the strip caps at 90 bars and keeps the newest ones", () => {
  const start = Date.UTC(2026, 8, 20);
  const { bars } = stripOf(stats("all", DAY, [[start, 10], [NOW, 20]], { cutoff: NOW - 400 * DAY, generatedAt: NOW }));
  expect(bars).toHaveLength(90);
  expect(bars[0]!.tokens).toBe(0);
  expect(bars[89]!.tokens).toBe(20);
});

interface Fact {
  perDay: Map<number, number>;
  start: number;
  end: number;
  activeDays: number;
  peakTokens: number;
  peakTs: number | null;
}

/** Day totals for a run of daily token values ending at `endTs`. */
function facts(tokens: number[], endTs = NOW): Fact {
  const perDay = new Map<number, number>();
  for (const [i, v] of tokens.entries()) if (v > 0) perDay.set(endTs - (tokens.length - 1 - i) * DAY, v);
  const start = endTs - (Math.max(tokens.length, 1) - 1) * DAY;
  let activeDays = 0;
  let peakTokens = 0;
  let peakTs: number | null = null;
  for (let ts = start; ts <= endTs; ts += DAY) {
    const v = perDay.get(ts) ?? 0;
    if (v <= 0) continue;
    activeDays += 1;
    if (v > peakTokens) {
      peakTokens = v;
      peakTs = ts;
    }
  }
  return { perDay, start, end: endTs, activeDays, peakTokens, peakTs };
}

test("the longest streak is the longest run of consecutive active days", () => {
  const s = streaksOf(facts([5, 5, 5, 0, 0, 7, 9]));
  expect(s.longest.days).toBe(3);
  expect(s.current.days).toBe(2);
  expect(s.activeDays).toBe(5);
  expect(s.peakTokens).toBe(9);
  expect(s.peakTs).toBe(NOW);
});

test("a run that stopped two days before the window's end is not a live streak", () => {
  // The window's last two days carry nothing, so the run ended before yesterday.
  const s = streaksOf(facts([5, 5, 5, 0, 0, 7, 0, 0]));
  expect(s.longest.days).toBe(3);
  expect(s.current.days).toBe(0);
  expect(s.current.endTs).toBe(null);
});

test("a live streak counts through yesterday, not only through today", () => {
  // Today is still open, so a run that ends yesterday is live.
  const yesterday = NOW - DAY;
  const s = streaksOf(facts([4], yesterday));
  expect(s.current.days).toBe(1);
  expect(s.current.endTs).toBe(yesterday);
});

test("a window with no activity has neither a streak nor a peak", () => {
  const s = streaksOf(facts([0, 0, 0, 0]));
  expect(s.current.days).toBe(0);
  expect(s.longest.days).toBe(0);
  expect(s.activeDays).toBe(0);
  expect(s.peakTokens).toBe(0);
  expect(s.peakTs).toBe(null);
});
