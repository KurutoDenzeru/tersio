import { expect, test } from "vitest";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyHeadroomGain, parseHeadroomSavings, parseHeadroomStats, readHeadroomSavings, readHeadroomStats, resetHeadroomGainMemo } from "../../extensions/shared/headroom-gain.ts";
import { fakeExecutable } from "../helpers/env.ts";

process.env.HOME = path.join(os.tmpdir(), "definitely-missing-headroom-gain-home");
process.env.USERPROFILE = process.env.HOME;
process.env.TERSIO_HOME = process.env.HOME;

// The aggregate shape `headroom savings --json` prints (schema_version 2), quoted from the real CLI.
const FIXTURE = JSON.stringify({
  schema_version: 2,
  path: "/tmp/savings_events.jsonl",
  top_model: "claude-opus-4-8",
  lifetime: { tokens_saved: 78000, tokens_before: 120000, cost_usd: 0.268, cost_effective_usd: 0.2, basis: "list", calls: 12, savings_percent: 65, new_input_tokens: 4000, new_input_savings_percent: 33.3 },
  windows: {
    today: { tokens_saved: 19000, tokens_before: 28000, cost_usd: 0.085, cost_effective_usd: 0.06, basis: "list", calls: 3, savings_percent: 67.9, new_input_tokens: 0, new_input_savings_percent: 0 },
    last_7_days: { tokens_saved: 47000, tokens_before: 70000, cost_usd: 0.225, cost_effective_usd: 0.17, basis: "list", calls: 7, savings_percent: 67.1, new_input_tokens: 0, new_input_savings_percent: 0 },
    last_30_days: { tokens_saved: 78000, tokens_before: 120000, cost_usd: 0.268, cost_effective_usd: 0.2, basis: "list", calls: 12, savings_percent: 65, new_input_tokens: 0, new_input_savings_percent: 0 },
  },
  by_model: [{ model: "claude-opus-4-8", cost_usd: 0.175 }],
  by_client: [{ client: "claude-code", calls: 4, tokens_saved: 60000 }, { client: "codex", calls: 2, tokens_saved: 18000 }],
});

test("the parser folds the aggregate into windows and breakdowns", () => {
  const gain = parseHeadroomSavings(FIXTURE);
  expect(gain.measured).toBe(true);
  expect(gain.lifetime).toEqual({ tokensSaved: 78000, tokensBefore: 120000, costUsd: 0.268, calls: 12, savingsPercent: 65 });
  expect(gain.windows.today.tokensSaved).toBe(19000);
  expect(gain.windows.last7Days.tokensSaved).toBe(47000);
  expect(gain.windows.last30Days.tokensSaved).toBe(78000);
  expect(gain.byClient).toEqual([{ client: "claude-code", calls: 4, tokensSaved: 60000 }, { client: "codex", calls: 2, tokensSaved: 18000 }]);
  expect(gain.byModel).toEqual([{ model: "claude-opus-4-8", costUsd: 0.175 }]);
});

test("a missing field prices zero instead of NaN", () => {
  const gain = parseHeadroomSavings(JSON.stringify({ lifetime: null, windows: {}, by_client: [{ client: "x" }], by_model: [null] }));
  expect(gain.lifetime.tokensSaved).toBe(0);
  expect(gain.windows.today.calls).toBe(0);
  expect(gain.byClient).toEqual([{ client: "x", calls: 0, tokensSaved: 0 }]);
  expect(gain.byModel).toEqual([{ model: "unknown", costUsd: 0 }]);
});

test("a fake headroom binary answers through its own CLI", () => {
  resetHeadroomGainMemo();
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-headroom-gain-"));
  // cmd.exe prints quotes literally, so the Windows body is the raw JSON; no backslash escapes.
  const bin = fakeExecutable(dir, "headroom", `echo '${FIXTURE}'`, `echo ${FIXTURE}`);
  const gain = readHeadroomSavings({ binary: bin });
  expect(gain.measured).toBe(true);
  expect(gain.lifetime.calls).toBe(12);
  expect(gain.byClient[0].client).toBe("claude-code");
});

test("a failing or missing binary reads unmeasured, never zero-as-data", () => {
  resetHeadroomGainMemo();
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-headroom-gain-fail-"));
  const bin = fakeExecutable(dir, "headroom", "echo boom >&2\nexit 3\n", "echo boom 1>&2\r\nexit /b 3\r\n");
  const gain = readHeadroomSavings({ binary: bin });
  expect(gain.measured).toBe(false);
  expect(gain.failure).not.toBe("");
  expect(gain.lifetime.tokensSaved).toBe(0);
  expect(readHeadroomSavings({ binary: null })).toEqual(emptyHeadroomGain("headroom binary not found in PATH"));
});

test("proxy stats parse the live counter block", () => {
  const stats = parseHeadroomStats(JSON.stringify({
    summary: { api_requests: 7, compression: { requests_compressed: 3, total_tokens_saved_all_layers: 1234, avg_compression_pct: 22.5 } },
  }));
  expect(stats.measured).toBe(true);
  expect(stats.requests).toBe(7);
  expect(stats.compressed).toBe(3);
  expect(stats.tokensSaved).toBe(1234);
  expect(stats.avgCompressionPct).toBe(22.5);
});

test("an unreachable /stats reads unmeasured", () => {
  resetHeadroomGainMemo();
  const stats = readHeadroomStats({ url: "http://127.0.0.1:1/stats", budgetMs: 300 });
  expect(stats.measured).toBe(false);
  expect(stats.failure).not.toBe("");
});

test("the memo serves the same gain until a test resets it", () => {
  resetHeadroomGainMemo();
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-headroom-gain-memo-"));
  const bin = fakeExecutable(dir, "headroom", `echo '${FIXTURE}'`, `echo ${FIXTURE}`);
  const first = readHeadroomSavings({ binary: bin });
  // A different binary would answer differently, but the 5s memo holds the first read.
  const second = readHeadroomSavings({ binary: "/definitely-other-headroom" });
  expect(second).toBe(first);
  resetHeadroomGainMemo();
  const third = readHeadroomSavings({ binary: "/definitely-other-headroom" });
  expect(third.measured).toBe(false);
});
