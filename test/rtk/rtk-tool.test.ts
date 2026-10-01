// Zero coverage once shipped a crashing tool call; keep it covered.
import { expect, test } from "vitest";

import rtkSessionExtension from "../../extensions/rtk-session/index.ts";
import type { ExtensionApi, ExtensionCtx } from "../../extensions/shared/types.ts";
import { resetSharedComboState, setSharedComboMode } from "../../extensions/shared/session-state.ts";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

// resolveRtkBinary checks PATH first, so each test must own PATH.
function withPath(value: string, work: () => Promise<void>): Promise<void> {
  const previous = process.env.PATH;
  process.env.PATH = value;
  return work().finally(() => { process.env.PATH = previous; });
}

process.env.HOME = new URL("../definitely-missing-home", import.meta.url).pathname;
process.env.USERPROFILE = process.env.HOME;

type Exec = (cmd: string, args: string[], opts?: { signal?: AbortSignal; cwd?: string }) => Promise<{
  stdout: string;
  stderr: string;
  code: number;
  killed: boolean;
}>;

type Tool = {
  name: string;
  execute: (id: string, params: { args: string[] }, signal?: AbortSignal, onUpdate?: unknown, ctx?: ExtensionCtx) => Promise<{
    isError?: boolean;
    content: Array<{ type: string; text: string }>;
    details?: Record<string, unknown>;
  }>;
};

interface Harness { tool: Tool; ctx: ExtensionCtx; events: string[]; sessionStart: () => Promise<unknown>; }

/** `exec` is optional in the API, so the harness controls whether it exists. */
function harness(exec?: Exec, entries: Array<{ type: string; customType: string; data: Record<string, unknown> }> = []): Harness {
  let tool: Tool | undefined;
  const handlers = new Map<string, (event: unknown, ctx: ExtensionCtx | undefined) => Promise<unknown>>();
  const chain = { min: () => chain, describe: () => chain };
  const api: Record<string, unknown> = {
    setLabel() {},
    registerCommand() {},
    registerTool(t: Tool) { tool = t; },
    appendEntry() {},
    on(event: string, handler: (event: unknown, ctx: ExtensionCtx | undefined) => Promise<unknown>) { handlers.set(event, handler); },
    zod: { z: { object: (shape: Record<string, unknown>) => shape, array: () => chain, string: () => chain } },
    cwd: "/tmp",
  };
  if (exec) api.exec = exec;
  rtkSessionExtension(api as unknown as ExtensionApi);
  const ctx = {
    hasUI: true,
    sessionManager: { getBranch: () => entries },
    ui: { setStatus() {}, notify() {} },
  } as ExtensionCtx;
  const sessionStart = () => handlers.get("session_start")!({}, ctx);
  return { tool: tool!, ctx, events: [...handlers.keys()], sessionStart };
}

const text = (r: { content: Array<{ text: string }> }): string => r.content.map((c) => c.text).join("\n");

test("the tool is refused while RTK is off", async () => {
  const h = harness(async () => ({ stdout: "", stderr: "", code: 0, killed: false }));
  await h.sessionStart();
  const r = await h.tool.execute("1", { args: ["ls"] }, undefined, undefined, h.ctx);
  expect(r.isError).toBe(true);
  expect(text(r)).toMatch(/RTK mode is off/);
});

test("a host without exec reports it instead of throwing", async () => {
  const h = harness(undefined, [{ type: "custom", customType: "rtk-mode", data: { enabled: true } }]);
  await h.sessionStart();
  const r = await h.tool.execute("1", { args: ["ls"] }, undefined, undefined, h.ctx);
  expect(r.isError).toBe(true);
  expect(text(r)).toMatch(/cannot run rtk/);
});

test("a missing rtk binary reports the error instead of crashing the tool", async () => {
  const h = harness(async () => { throw new Error("spawn rtk ENOENT"); },
    [{ type: "custom", customType: "rtk-mode", data: { enabled: true } }]);
  await h.sessionStart();
  const r = await h.tool.execute("1", { args: ["ls"] }, undefined, undefined, h.ctx);
  expect(r.isError).toBe(true);
  expect(text(r)).toContain("spawn rtk ENOENT");
});

test("a non-zero exit is surfaced as an error with its output", async () => {
  const h = harness(async () => ({ stdout: "", stderr: "bad flag", code: 2, killed: false }),
    [{ type: "custom", customType: "rtk-mode", data: { enabled: true } }]);
  await h.sessionStart();
  const r = await h.tool.execute("1", { args: ["--nope"] }, undefined, undefined, h.ctx);
  expect(r.isError).toBe(true);
  expect(text(r)).toContain("bad flag");
});

test("a successful run returns combined output and no error", async () => {
  const seen: string[][] = [];
  const h = harness(async (_cmd, args) => { seen.push(args); return { stdout: "ok", stderr: "", code: 0, killed: false }; },
    [{ type: "custom", customType: "rtk-mode", data: { enabled: true } }]);
  await h.sessionStart();
  const r = await h.tool.execute("1", { args: ["git", "status"] }, undefined, undefined, h.ctx);
  expect(r.isError).toBe(false);
  expect(text(r)).toBe("ok");
  expect(seen).toEqual([["git", "status"]]);
});

test("RTK no longer registers a natural-language input handler", () => {
  // "use rtk" is ordinary English, and combo-toggle dropped its input hook for
  // exactly that reason; RTK kept one and matched both directions.
  expect(harness().events).not.toContain("input");
});

test("the tool execs the resolved rtk path, not bare `rtk`", async () => {
  // A GUI-launched host whose PATH lacks ~/.bun/bin ENOENTs on bare 'rtk'.
  await withPath("", async () => {
    const binDir = path.join(process.env.HOME as string, ".bun", "bin");
    mkdirSync(binDir, { recursive: true });
    const fake = path.join(binDir, "rtk");
    writeFileSync(fake, "#!/bin/sh\necho hi\n", { mode: 0o755 });

    const cmds: string[] = [];
    const h = harness(async (cmd) => { cmds.push(cmd); return { stdout: "ok", stderr: "", code: 0, killed: false }; },
      [{ type: "custom", customType: "rtk-mode", data: { enabled: true } }]);
    await h.sessionStart();
    const r = await h.tool.execute("1", { args: ["git", "status"] }, undefined, undefined, h.ctx);

    expect(r.isError).toBe(false);
    expect(cmds).toEqual([fake]);
    rmSync(binDir, { recursive: true, force: true });
  });
});

test("the tool falls back to bare `rtk` when no binary resolves", async () => {
  await withPath("", async () => {
    const cmds: string[] = [];
    const h = harness(async (cmd) => { cmds.push(cmd); return { stdout: "ok", stderr: "", code: 0, killed: false }; },
      [{ type: "custom", customType: "rtk-mode", data: { enabled: true } }]);
    await h.sessionStart();
    await h.tool.execute("1", { args: ["git", "status"] }, undefined, undefined, h.ctx);
    expect(cmds).toEqual(["rtk"]);
  });
});

// A subagent spawned after the parent switches modes registers its bridge
// listener late, so it keeps the session default and needs the shared-state fallback.
test("rtk_run uses shared state when a late subagent's own flag is off", async () => {
  resetSharedComboState();
  await withPath("", async () => {
    setSharedComboMode("rtk", "on");
    const cmds: string[] = [];
    // No session_start: this instance's own flag is still its start-up default.
    const sub = harness(async (cmd) => { cmds.push(cmd); return { stdout: "ok", stderr: "", code: 0, killed: false }; });

    const r = await sub.tool.execute("1", { args: ["git", "status"] }, undefined, undefined, sub.ctx);

    expect(r.isError).toBe(false);
    expect(cmds).toEqual(["rtk"]);
    resetSharedComboState();
  });
});

test("rtk_run stays refused when neither the flag nor shared state is on", async () => {
  resetSharedComboState();
  await withPath("", async () => {
    setSharedComboMode("rtk", "off");
    const h = harness(async () => ({ stdout: "ok", stderr: "", code: 0, killed: false }));

    const r = await h.tool.execute("1", { args: ["git", "status"] }, undefined, undefined, h.ctx);

    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/RTK mode is off/);
    resetSharedComboState();
  });
});
