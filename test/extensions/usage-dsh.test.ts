import { afterEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { zstdCompressSync } from "node:zlib";
import { agentOfSessionText, classifySessionLine, hostOfSessionFile, newSessionAccum, processSessionText, readSessionText } from "../../extensions/shared/usage-ledger.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("DeepSeek Harness transcripts", () => {
  test("model selection and assistant usage classify into one row", () => {
    const selection = classifySessionLine({ type: "model/selection", data: { provider: "magpie", model: "commandcode/deepseek/v4" } });
    expect(selection).toMatchObject({ kind: "dsh_model", model: "commandcode/deepseek/v4" });
    const usage = classifySessionLine({
      type: "assistant/message",
      time: 1793768376111,
      data: {
        usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 90 },
        message: { role: "assistant", content: [{ type: "tool-call", name: "bash" }] },
      },
    });
    expect(usage.kind).toBe("assistant_row");
    expect(usage.usage).toEqual({ input: 10, output: 4, cacheRead: 90, cacheWrite: undefined });
    expect(usage.tools).toEqual(["bash"]);
  });

  test("a whole file records the model from its selection event", () => {
    const text = [
      JSON.stringify({ type: "session", id: "s1", delegationDepth: 0 }),
      JSON.stringify({ type: "model/selection", data: { provider: "magpie", model: "commandcode/deepseek/v4" } }),
      JSON.stringify({ type: "assistant/message", time: 1793768376111, data: { usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 90 } } }),
    ].join("\n");
    const accum = newSessionAccum();
    processSessionText(accum, { codexProvider: null, dshModel: null }, text, "dsh", "main");
    expect(accum.messages).toBe(1);
    expect(accum.byHost["commandcode/deepseek/v4"]?.dsh).toMatchObject({ input: 10, output: 4, cacheRead: 90 });
    expect(accum.recent[0]).toMatchObject({ i: 10, o: 4, cr: 90, t: 1793768376111 });
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
