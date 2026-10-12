// Every failure path must keep the original output: a wrong filtered result is worse.
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";

import rtkFilterExtension, {
  FILTER_BY_TOOL,
  MIN_FILTER_BYTES,
  filterThroughRtk,
  filterableText,
  rtkActive,
} from "../../extensions/rtk-filter/index.ts";
import type { FilterExec } from "../../extensions/rtk-filter/index.ts";
import { resetSharedComboState, setSharedComboMode } from "../../extensions/shared/session-state.ts";
import type { ExtensionApi, ExtensionCtx, SessionEntry, ToolResultEvent } from "../../extensions/shared/types.ts";

process.env.HOME = new URL("../definitely-missing-home", import.meta.url).pathname;
process.env.USERPROFILE = process.env.HOME;
process.env.TERSIO_HOME = process.env.HOME;

/** A `rtk` file on PATH, so `resolveRtkBinary` finds a binary the stub exec never spawns. */
function withFakeRtk(work: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), "tersio-rtk-bin-"));
  const bin = path.join(dir, "rtk");
  writeFileSync(bin, "#!/bin/sh\nexit 0\n", "utf8");
  chmodSync(bin, 0o755);
  const previous = process.env.PATH;
  process.env.PATH = dir;
  return work(dir).finally(() => {
    process.env.PATH = previous;
    rmSync(dir, { recursive: true, force: true });
  });
}

function big(marker = "match"): string {
  const line = `src/file.ts:12:${marker} a line of grep output that the filter should drop\n`;
  return line.repeat(Math.ceil(MIN_FILTER_BYTES / line.length) + 5);
}

type Entries = SessionEntry[];
type Handler = (event: ToolResultEvent, ctx: ExtensionCtx) => Promise<unknown>;

function harness(exec: FilterExec | undefined, entries: Entries = []) {
  const handlers = new Map<string, Handler>();
  const api: Record<string, unknown> = {
    setLabel() {},
    registerCommand() {},
    registerTool() {},
    appendEntry() {},
    on(event: string, handler: Handler) { handlers.set(event, handler); },
    cwd: "/tmp",
  };
  if (exec) api.exec = exec;
  rtkFilterExtension(api as unknown as ExtensionApi);
  const ctx = { hasUI: false, sessionManager: { getBranch: () => entries } } as ExtensionCtx;
  const has = (name: string): boolean => handlers.has(name);
  return { fire: (event: ToolResultEvent) => handlers.get("tool_result")!(event, ctx), has };
}

const grepEvent = (text: string): ToolResultEvent => ({ toolName: "grep", content: [{ type: "text", text }] });

test("a grep result over the threshold is replaced by the rtk filter", async () => {
  await withFakeRtk(async () => {
    resetSharedComboState();
    const calls: Array<{ cmd: string; args: string[]; timeout?: number }> = [];
    const h = harness(async (cmd, args, opts) => {
      calls.push({ cmd, args, timeout: opts?.timeout });
      return { stdout: "3 matches in 1F:\n  src/file.ts (3)\n", code: 0 };
    }, [{ type: "custom", customType: "rtk-mode", data: { enabled: true } }]);

    const result = await h.fire(grepEvent(big())) as { content: Array<{ type: string; text: string }> };

    expect(result.content).toEqual([{ type: "text", text: "3 matches in 1F:\n  src/file.ts (3)\n" }]);
    expect(calls[0].cmd, "an absolute shell, so a minimal PATH cannot break the spawn").toBe("/bin/sh");
    expect(calls[0].args[0]).toBe("-c");
    expect(calls[0].args[1]).toMatch(/pipe -f grep/);
    // A hung filter must not stall the tool result.
    expect(calls[0].timeout).toBe(5000);
    // The payload file is removed, so the gathered text does not pile up in /tmp.
    const redirected = calls[0].args[1].match(/< "([^"]+)"/);
    expect(redirected, "the filter reads the payload from a file").not.toBeNull();
    expect(existsSync(redirected![1])).toBe(false);
  });
});

test("glob is filtered as find, and read is never filtered", async () => {
  expect(FILTER_BY_TOOL.get("glob")).toBe("find");
  expect(FILTER_BY_TOOL.get("grep")).toBe("grep");
  expect(FILTER_BY_TOOL.get("read"), "a filtered read would not match the file being edited").toBeUndefined();

  await withFakeRtk(async () => {
    resetSharedComboState();
    let called = 0;
    const exec: FilterExec = async () => { called += 1; return { stdout: "small", code: 0 }; };
    const h = harness(exec, [{ type: "custom", customType: "rtk-mode", data: { enabled: true } }]);

    const globbed = await h.fire({ toolName: "glob", content: [{ type: "text", text: big() }] }) as { content: Array<{ text: string }> };
    expect(globbed.content[0].text).toBe("small");

    expect(await h.fire({ toolName: "read", content: [{ type: "text", text: big() }] })).toBeUndefined();
    expect(called, "read spawns no filter").toBe(1);
  });
});

test("small, error, mixed, and empty results are left alone", async () => {
  await withFakeRtk(async () => {
    resetSharedComboState();
    let called = 0;
    const exec: FilterExec = async () => { called += 1; return { stdout: "x", code: 0 }; };
    const h = harness(exec, [{ type: "custom", customType: "rtk-mode", data: { enabled: true } }]);

    expect(await h.fire(grepEvent("src/a.ts:1:tiny\n"))).toBeUndefined();
    expect(await h.fire({ ...grepEvent(big()), isError: true })).toBeUndefined();
    expect(await h.fire({ toolName: "grep", content: [{ type: "text", text: big() }, { type: "image" }] })).toBeUndefined();
    expect(await h.fire({ toolName: "grep", content: [] })).toBeUndefined();
    expect(await h.fire({ toolName: "grep" })).toBeUndefined();
    expect(called, "none of those reach the filter").toBe(0);
  });
});

test("rtk off, a failed filter, and a filter that would grow the text all keep the original", async () => {
  await withFakeRtk(async () => {
    resetSharedComboState();
    const text = big();
    const off = harness(async () => ({ stdout: "short", code: 0 }), [{ type: "custom", customType: "rtk-mode", data: { enabled: false } }]);
    expect(await off.fire(grepEvent(text))).toBeUndefined();

    const failing = harness(async () => ({ stdout: "short", code: 2 }), [{ type: "custom", customType: "rtk-mode", data: { enabled: true } }]);
    expect(await failing.fire(grepEvent(text)), "a non-zero exit is untrustworthy").toBeUndefined();

    const growing = harness(async () => ({ stdout: `${text}${text}`, code: 0 }), [{ type: "custom", customType: "rtk-mode", data: { enabled: true } }]);
    expect(await growing.fire(grepEvent(text))).toBeUndefined();

    const blank = harness(async () => ({ stdout: "   \n", code: 0 }), [{ type: "custom", customType: "rtk-mode", data: { enabled: true } }]);
    expect(await blank.fire(grepEvent(text))).toBeUndefined();

    const throwing = harness(async () => { throw new Error("spawn sh ENOENT"); }, [{ type: "custom", customType: "rtk-mode", data: { enabled: true } }]);
    expect(await throwing.fire(grepEvent(text))).toBeUndefined();
  });
});

test("a host without exec registers nothing", () => {
  resetSharedComboState();
  const h = harness(undefined, [{ type: "custom", customType: "rtk-mode", data: { enabled: true } }]);
  expect(h.has("tool_result")).toBe(false);
});

test("rtkActive prefers the session entry over the shared switch", () => {
  resetSharedComboState();
  setSharedComboMode("rtk", "on");
  expect(rtkActive([{ type: "custom", customType: "rtk-mode", data: { enabled: false } }]), "an explicit /rtk off wins").toBe(false);
  expect(rtkActive([{ type: "custom", customType: "rtk-mode", data: { enabled: true } }])).toBe(true);
  expect(rtkActive([{ type: "custom", customType: "rtk-mode", data: { mode: "nonsense" } }]), "a malformed entry falls back").toBe(true);
  expect(rtkActive(undefined)).toBe(true);
});

test("filterableText decodes plain text parts and refuses everything else", () => {
  expect(filterableText([{ type: "text", text: "a" }, { type: "text", text: "b" }])).toBe("a\nb");
  expect(filterableText([{ type: "text" }]), "a part with no text reads as empty").toBe("");
  expect(filterableText([{ type: "text", text: "a" }, { type: "image" }])).toBeNull();
  expect(filterableText([])).toBeNull();
  expect(filterableText(undefined)).toBeNull();
  expect(filterableText("already a string"), "OpenCode hands parts, never a bare string").toBeNull();
});

test("filterThroughRtk reports null instead of throwing when the binary is gone", async () => {
  const exec: FilterExec = async () => { throw new Error("spawn sh ENOENT"); };
  const gone = path.join(tmpdir(), "tersio-no-rtk", "rtk");
  expect(await filterThroughRtk(exec, { bin: gone, filter: "grep", text: big() })).toBeNull();
});
