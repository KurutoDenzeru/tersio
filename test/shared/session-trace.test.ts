import { expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  extractSessionTrace,
  isSubagentFile,
  readChildTranscripts,
  sessionListEntry,
} from "../../extensions/shared/session-trace.ts";
import type { SessionTrace, TraceSpan } from "../../extensions/shared/session-trace.ts";

const BASE = Date.parse("2026-10-08T10:00:00.000Z");
const at = (ms: number): number => BASE + ms;
const iso = (ms: number): string => new Date(BASE + ms).toISOString();

function jsonl(rows: unknown[]): string {
  return rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

function span(trace: SessionTrace, id: string): TraceSpan {
  const hit = trace.tracks.flatMap((t) => t.spans).find((s) => s.id === id);
  if (!hit) throw new Error(`no span ${id}`);
  return hit;
}

/** OMP-style rows: ISO timestamps, completedAt, explicit tool_execution_start. */
function ompMainRows(): unknown[] {
  return [
    { type: "session", timestamp: iso(0), cwd: "/Users/x/proj" },
    { type: "title", timestamp: iso(0), title: "First title" },
    { type: "title_change", timestamp: iso(500), title: "Renamed" },
    { id: "t1", timestamp: iso(1000), message: { role: "user", content: "Do the thing" } },
    { type: "model_change", timestamp: iso(1500), model: "m/a" },
    {
      id: "a1",
      timestamp: iso(2000),
      message: {
        role: "assistant",
        model: "m/a",
        completedAt: iso(5000),
        ttft: 400,
        stopReason: "toolUse",
        usage: { input: 100, output: 50, cacheRead: 10, cacheWrite: 5, totalTokens: 165 },
        content: [
          { type: "text", text: "thinking" },
          { type: "toolCall", id: "c1", name: "bash", arguments: { command: "ls" } },
        ],
      },
    },
    {
      type: "custom",
      customType: "tool_execution_start",
      timestamp: iso(5500),
      data: { toolCallId: "c1", toolName: "bash", startedAt: iso(5500) },
    },
    { id: "r1", timestamp: iso(7000), message: { role: "toolResult", toolCallId: "c1", isError: false } },
    {
      id: "a2",
      timestamp: iso(8000),
      message: {
        role: "assistant",
        model: "m/a",
        completedAt: iso(9000),
        stopReason: "endTurn",
        usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0 },
      },
    },
  ];
}

test("omp transcript: spans, timings, turns, markers, summary", () => {
  const trace = extractSessionTrace("/tmp/main.jsonl", jsonl(ompMainRows()), []);

  expect(trace.title).toBe("Renamed"); // title_change wins over the automatic title
  expect(trace.cwd).toBe("/Users/x/proj");
  expect(trace.startedAt).toBe(at(0));
  expect(trace.endedAt).toBe(at(9000));
  expect(trace.tracks).toHaveLength(1);

  const track = trace.tracks[0];
  expect(track.markers).toEqual([{ time: at(1500), kind: "model_change", label: "m/a" }]);

  const a1 = span(trace, "main:a1");
  expect(a1).toMatchObject({
    kind: "model",
    start: at(2000),
    end: at(5000),
    label: "m/a",
    model: "m/a",
    ttft: 400,
    tokens: 165,
    stop: "toolUse",
    entryId: "a1",
  });

  const tool = span(trace, "main:tool:c1");
  expect(tool).toMatchObject({
    kind: "tool",
    start: at(5500), // the host's tool_execution_start, not the model's emit time
    end: at(7000),
    label: "bash",
    entryId: "r1",
    detail: JSON.stringify({ command: "ls" }),
  });
  expect(tool.unterminated).toBeUndefined();
  expect(tool.error).toBeUndefined();

  const turn = span(trace, "main:t1");
  expect(turn).toMatchObject({
    kind: "turn",
    start: at(1000),
    end: at(9000), // closes over the last activity it caused
    label: "Do the thing",
    entryId: "t1",
  });

  expect(trace.summary).toEqual({
    wallMs: 8000, // first turn to last activity
    modelMs: 4000, // 3000 + 1000
    toolMs: 1500,
    idleMs: 2500,
    turns: 1,
    requests: 2,
    toolCalls: 1,
    subagents: 0,
    totalTokens: 195, // 165 + 30
    costTotal: 0,
    unpricedRequests: 0,
    models: ["m/a"],
    toolStats: [{ tool: "bash", calls: 1, errors: 0, totalMs: 1500, maxMs: 1500 }],
  });

  expect(sessionListEntry(trace)).toEqual({
    file: "/tmp/main.jsonl",
    folder: "/Users/x/proj",
    title: "Renamed",
    startedAt: at(0),
    endedAt: at(9000),
    requests: 2,
    toolCalls: 1,
    subagents: 0,
    totalTokens: 195,
    costTotal: 0,
    unpricedRequests: 0,
    models: ["m/a"],
  });
});

test("pi transcript: row write time ends the model span, emit time starts the tool", () => {
  const rows = [
    { id: "t1", timestamp: at(1000), message: { role: "user", content: "pi turn" } },
    {
      // No completedAt, no duration: the row was written when the message finished.
      id: "a1",
      timestamp: at(6000),
      message: {
        role: "assistant",
        timestamp: iso(2000),
        model: "pi-model",
        usage: { input: 7, output: 3, cacheRead: 0, cacheWrite: 0 },
        content: [{ type: "toolCall", id: "c1", name: "read", arguments: { file: "a.txt" } }],
      },
    },
    { id: "r1", timestamp: at(7000), message: { role: "toolResult", toolCallId: "c1", isError: true } },
  ];
  const trace = extractSessionTrace("/tmp/pi.jsonl", jsonl(rows), []);

  const model = span(trace, "main:a1");
  expect(model.start).toBe(at(2000));
  expect(model.end).toBe(at(6000));
  expect(model.tokens).toBe(10); // no totalTokens field: buckets summed

  const tool = span(trace, "main:tool:c1");
  expect(tool.start).toBe(at(6000)); // no tool_execution_start: starts where the model ended
  expect(tool.end).toBe(at(7000));
  expect(tool.error).toBe(true);

  expect(trace.summary.modelMs).toBe(4000);
  expect(trace.summary.toolMs).toBe(1000);
  expect(trace.summary.toolStats[0]).toMatchObject({ tool: "read", calls: 1, errors: 1 });
});

test("tool call with no result yet ends at the last row and stays unterminated", () => {
  const rows = [
    { id: "t1", timestamp: at(1000), message: { role: "user", content: "go" } },
    {
      id: "a1",
      timestamp: at(2500),
      message: {
        role: "assistant",
        model: "m/a",
        completedAt: iso(3000),
        content: [{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "sleep 999" } }],
      },
    },
    { type: "model_change", timestamp: at(5000), model: "m/b" },
  ];
  const trace = extractSessionTrace("/tmp/live.jsonl", jsonl(rows), []);

  const tool = span(trace, "main:tool:c1");
  expect(tool.start).toBe(at(3000));
  expect(tool.end).toBe(at(5000));
  expect(tool.unterminated).toBe(true);
  expect(tool.error).toBeUndefined();
});

test("task calls link the child transcript as its own track", () => {
  const mainRows = [
    { type: "session", timestamp: iso(0), cwd: "/Users/x/proj" },
    { id: "t1", timestamp: iso(1000), message: { role: "user", content: "spawn scout" } },
    {
      id: "a1",
      timestamp: iso(2500),
      message: {
        role: "assistant",
        model: "main-model",
        completedAt: iso(3000),
        usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0 },
        content: [
          {
            type: "toolCall",
            id: "c1",
            name: "task",
            arguments: { tasks: [{ name: "Scout", agent: "scout", task: "find the thing" }] },
          },
        ],
      },
    },
    { id: "r1", timestamp: iso(4000), message: { role: "toolResult", toolCallId: "c1", isError: false } },
  ];
  const childRows = [
    { id: "ct1", timestamp: iso(2000), message: { role: "user", content: "child turn" } },
    {
      id: "ca1",
      timestamp: iso(2500),
      message: {
        role: "assistant",
        model: "child-model",
        completedAt: iso(3500),
        usage: { input: 5, output: 5, cacheRead: 0, cacheWrite: 0 },
      },
    },
  ];
  const trace = extractSessionTrace("/tmp/main.jsonl", jsonl(mainRows), [
    { file: "/sessions/stem/Scout.jsonl", text: jsonl(childRows) },
  ]);

  expect(trace.tracks).toHaveLength(2);
  const childTrack = trace.tracks[1];
  expect(childTrack).toMatchObject({ id: "Scout", parentId: "main", agent: "scout" });
  expect(childTrack.spans.some((s) => s.kind === "model" && s.label === "child-model")).toBe(true);

  const sub = span(trace, "main:sub:Scout");
  expect(sub).toMatchObject({
    kind: "subagent",
    start: at(2000),
    end: at(3500),
    label: "scout",
    childTrackId: "Scout",
  });

  const bg = span(trace, "main:bg:c1");
  expect(bg.kind).toBe("background");
  expect(bg.label).toBe("task job");
  expect(bg.detail).toContain("find the thing");

  expect(trace.summary).toMatchObject({
    subagents: 1,
    requests: 2, // one main-model span plus one child span
    toolCalls: 0, // background spans are not tool stats
    turns: 1, // the child's user row is not a main-track turn
    totalTokens: 30, // 20 main + 10 child
    models: ["child-model", "main-model"],
  });
});

test("pricing: the supplied fn sets costTotal and counts unpriced requests", () => {
  const rows = [
    {
      id: "a1",
      timestamp: at(1000),
      message: {
        role: "assistant",
        model: "legacy",
        completedAt: iso(2000),
        usage: { input: 100, output: 10, cacheRead: 0, cacheWrite: 0 },
      },
    },
    {
      id: "a2",
      timestamp: at(3000),
      message: {
        role: "assistant",
        model: "new-model",
        completedAt: iso(4000),
        usage: { input: 50, output: 10, cacheRead: 0, cacheWrite: 0 },
      },
    },
  ];
  const text = jsonl(rows);
  const price = (model: string, tokens: { input: number }): { usd: number; priced: boolean } => ({
    usd: model === "legacy" ? 0 : tokens.input * 0.001,
    priced: model !== "legacy",
  });

  const priced = extractSessionTrace("/tmp/cost.jsonl", text, [], price);
  expect(priced.summary.costTotal).toBeCloseTo(0.05);
  expect(priced.summary.unpricedRequests).toBe(1);

  // No fn supplied: cost stays at zero rather than inventing a number.
  const bare = extractSessionTrace("/tmp/cost.jsonl", text, []);
  expect(bare.summary.costTotal).toBe(0);
  expect(bare.summary.unpricedRequests).toBe(0);
});

test("isSubagentFile and readChildTranscripts follow the real directory shape", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "tersio-trace-"));
  try {
    const stem = "2026-10-08-session";
    mkdirSync(path.join(root, stem));
    writeFileSync(path.join(root, `${stem}.jsonl`), "");
    writeFileSync(path.join(root, stem, "Scout.jsonl"), jsonl([]));
    writeFileSync(path.join(root, "lonely.jsonl"), "");

    expect(isSubagentFile(path.join(root, stem, "Scout.jsonl"))).toBe(true);
    expect(isSubagentFile(path.join(root, `${stem}.jsonl`))).toBe(false);
    expect(isSubagentFile(path.join(root, "lonely.jsonl"))).toBe(false);

    const kids = readChildTranscripts(path.join(root, `${stem}.jsonl`));
    expect(kids).toHaveLength(1);
    expect(kids[0].file).toBe(path.join(root, stem, "Scout.jsonl"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
