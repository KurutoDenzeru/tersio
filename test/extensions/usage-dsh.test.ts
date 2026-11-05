import { afterEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { zstdCompressSync } from "node:zlib";
import { agentOfSessionText, classifySessionLine, hostOfSessionFile, newSessionAccum, processSessionText, readSessionText } from "../../extensions/shared/usage-ledger.ts";
import { foldTraces } from "../../extensions/shared/agent-stats.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("DeepSeek Harness transcripts", () => {
  test("model selection and assistant usage classify into one row", () => {
    const selection = classifySessionLine({ type: "model/selection", data: { provider: "magpie", model: "commandcode/deepseek/v4" } });
    expect(selection).toMatchObject({ kind: "dsh_model", model: "commandcode/deepseek/v4" });
    const dsh = { steps: new Map<string, number>() };
    classifySessionLine({ type: "step/start", time: 1000, data: { turn: 1, step: 1 } }, undefined, dsh);
    const usage = classifySessionLine({
      type: "assistant/message",
      time: 4000,
      data: {
        turn: 1,
        step: 1,
        usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 90 },
        stream: [{ time: 2500 }],
        message: { role: "assistant", id: "msg-1", content: [{ type: "tool-call", name: "bash" }] },
      },
    }, undefined, dsh);
    expect(usage.kind).toBe("assistant_row");
    expect(usage.usage).toEqual({ input: 10, output: 4, cacheRead: 90, cacheWrite: undefined });
    expect(usage.tools).toEqual(["bash"]);
    expect(usage.id).toBe("msg-1");
    expect(usage.durMs).toBe(3000);
    expect(usage.ttftMs).toBe(1500);
  });

  test("a whole file records the model from its selection event", () => {
    const text = [
      JSON.stringify({ type: "session", id: "s1", delegationDepth: 0 }),
      JSON.stringify({ type: "model/selection", data: { provider: "magpie", model: "commandcode/deepseek/v4" } }),
      JSON.stringify({ type: "step/start", time: 1793768370111, data: { turn: 1, step: 1 } }),
      JSON.stringify({ type: "assistant/message", time: 1793768376111, data: { turn: 1, step: 1, usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 90 }, message: { id: "msg-1" } } }),
    ].join("\n");
    const accum = newSessionAccum();
    processSessionText(accum, { codexProvider: null, dshModel: null }, text, "dsh", "main");
    expect(accum.messages).toBe(1);
    expect(accum.byHost["commandcode/deepseek/v4"]?.dsh).toMatchObject({ input: 10, output: 4, cacheRead: 90 });
    expect(accum.recent[0]).toMatchObject({ i: 10, o: 4, cr: 90, t: 1793768376111, id: "msg-1" });
    expect(accum.recent[0]?.d).toBe(6000);
  });

  test("a session file under .dsh reports dsh, and depth marks a subagent", () => {
    expect(hostOfSessionFile("/Users/me/.dsh/sessions/ws/session-1/session.v4.jsonl.zstd")).toBe("dsh");
    expect(agentOfSessionText('{"type":"session","delegationDepth":1}')).toBe("subagent");
    expect(agentOfSessionText('{"type":"session","delegationDepth":0}')).toBe("main");
  });

  test("the zstd transcript reads as text, and a broken file reads as null", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "tersio-dsh-"));
    dirs.push(dir);
    const file = path.join(dir, "session.v4.jsonl.zstd");
    writeFileSync(file, zstdCompressSync(Buffer.from('{"type":"session"}\n')));
    expect(readSessionText(file)).toBe('{"type":"session"}\n');
    writeFileSync(file, Buffer.from("not zstd"));
    expect(readSessionText(file)).toBeNull();
  });
});

describe("trace folding", () => {
  const row = (sessionFile: string) => ({
    sessionFile,
    project: "proj",
    cwd: "",
    title: null,
    requests: 1,
    tokens: 10,
    costUsd: 0,
    unpriced: 0,
    models: ["m"],
    toolCalls: 0,
    subagents: 0,
    firstTs: 1,
    lastTs: 2,
  });

  test("DeepSeek Harness sessions stay out of Tersio's trace list", () => {
    const folded = foldTraces([
      row("/Users/me/.pi/agent/sessions/proj/s1.jsonl"),
      row("/Users/me/.dsh/sessions/ws/session-1/session.v4.jsonl.zstd"),
    ]);
    expect(folded.map((entry) => entry.sessionFile)).toEqual(["/Users/me/.pi/agent/sessions/proj/s1.jsonl"]);
  });
});
