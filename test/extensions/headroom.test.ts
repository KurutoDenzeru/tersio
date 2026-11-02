import { expect, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import headroomSessionExtension, { HEADROOM_INSTALL_HINT, headroomInstruction } from "../../extensions/headroom/index.ts";
import comboToggleExtension from "../../extensions/combo/index.ts";
import { getSharedComboState, resetSharedComboState } from "../../extensions/shared/session-state.ts";
import { durableConfigInstalled } from "../../extensions/shared/headroom-proxy.ts";
import { resolveHeadroomBinary } from "../../extensions/shared/utils.ts";
import type { ExtensionApi, SessionEntry } from "../../extensions/shared/types.ts";
import { fakeExecutable, withHome } from "../helpers/env.ts";
import { createServer } from "node:http";

// fileURLToPath, not `.pathname`: a URL pathname on Windows is `/D:/...`, which path.join doubles into `D:\D:\...`.
process.env.HOME = fileURLToPath(new URL("../definitely-missing-home/headroom", import.meta.url));
process.env.USERPROFILE = process.env.HOME;
process.env.TERSIO_HOME = process.env.HOME;

type CommandHandler = (args: string, ctx: TestCtx) => Promise<void>;
type EventHandler = (event: unknown, ctx: TestCtx | undefined) => Promise<unknown>;

interface TestCtx {
  notifications: string[];
  statuses: Map<string, string>;
  entries: SessionEntry[];
  sessionManager: { getBranch: () => SessionEntry[] };
  ui: { setStatus(name: string, value: string | undefined): void; notify(message: string): void };
}

function harness(entries: SessionEntry[] = [], hostId: "omp" | "pi" | "pig" | "opencode" = "omp"): { handlers: Map<string, EventHandler>; commands: Map<string, CommandHandler>; ctx: TestCtx } {
  const commands = new Map<string, CommandHandler>();
  const handlers = new Map<string, EventHandler>();
  const notifications: string[] = [];
  const statuses = new Map<string, string>();
  headroomSessionExtension({
    hostId,
    setLabel() {},
    registerCommand(name: string, config: { handler: CommandHandler }) { commands.set(name, config.handler); },
    registerTool() {},
    appendEntry(customType: string, data: Record<string, unknown>) { entries.push({ type: "custom", customType, data }); },
    on(event: string, handler: EventHandler) { handlers.set(event, handler); },
  } as unknown as ExtensionApi);
  const ctx: TestCtx = {
    notifications,
    statuses,
    entries,
    sessionManager: { getBranch: () => entries },
    ui: {
      // setStatus doubles as the status source, keyed like the host footer.
      setStatus(name: string, v: string | undefined) { if (v !== undefined) { statuses.set(name, v); if (name === "tersio") notifications.push(v); } },
      notify(message: string) { notifications.push(message); },
    },
  };
  return { handlers, commands, ctx };
}

/** Runs the command with PATH narrowed so the headroom probe is deterministic. */
async function withPath(headroomDir: string | null, run: () => Promise<void>): Promise<void> {
  const previousPath = process.env.PATH;
  if (headroomDir === null) process.env.PATH = "/definitely-no-headroom-here";
  else process.env.PATH = `${headroomDir}${path.delimiter}${previousPath}`;
  try {
    await run();
  } finally {
    process.env.PATH = previousPath;
  }
}

const ON_LINE = "🧩 COMBO CUSTOM: 🪨 caveman=OFF | 🗜️ rtk=OFF | 🍃 headroom=ON | 🧠 ponytail=OFF | 🥔 pstack=OFF";
const OFF_LINE = "🧩 COMBO OFF";
const HINT = `Headroom binary not found on PATH. Install it yourself with: ${HEADROOM_INSTALL_HINT}`;

test("/headroom on persists the mode, names it in the footer, and warns when the binary is absent", async () => {
  await withPath(null, async () => {
    resetSharedComboState();
    const entries: SessionEntry[] = [];
    const { commands, ctx } = harness(entries);
    await commands.get("headroom")!("on", ctx);
    expect(ctx.entries.at(-1)).toEqual({ type: "custom", customType: "headroom-mode", data: { mode: "on" } });
    expect(ctx.notifications).toEqual([ON_LINE, HINT]);
    expect(getSharedComboState().headroom).toBe("on");
    // The state keeps the preset level (all three owned modes are off); the CUSTOM wording is render-side.
    expect(getSharedComboState().level).toBe("off");
  });
});

test("a present binary toggles without the install warning", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-headroom-bin-"));
  fakeExecutable(dir, process.platform === "win32" ? "headroom.exe" : "headroom", "#!/bin/sh\nexit 0\n", "exit /b 0");
  await withPath(dir, async () => {
    resetSharedComboState();
    const { commands, ctx } = harness([]);
    await commands.get("headroom")!("on", ctx);
    expect(ctx.notifications).toEqual([ON_LINE]);
  });
});

test("/headroom off beside all-off modes collapses to COMBO OFF", async () => {
  await withPath(null, async () => {
    resetSharedComboState();
    const entries: SessionEntry[] = [];
    const { commands, ctx } = harness(entries);
    await commands.get("headroom")!("on", ctx);
    await commands.get("headroom")!("off", ctx);
    expect(ctx.notifications.at(-1)).toBe(OFF_LINE);
    expect(getSharedComboState().headroom).toBe("off");
  });
});

test("/headroom status repaints the bar and an unknown arg warns usage", async () => {
  await withPath(null, async () => {
    resetSharedComboState();
    const entries: SessionEntry[] = [{ type: "custom", customType: "headroom-mode", data: { mode: "on" } }];
    const { commands, handlers, ctx } = harness(entries);
    await handlers.get("session_start")!({}, ctx);
    await commands.get("headroom")!("status", ctx);
    expect(ctx.notifications.at(-1)).toBe(ON_LINE);
    await commands.get("headroom")!("bright", ctx);
    expect(ctx.notifications.at(-1)).toBe("Usage: /headroom [on|off|status]");
  });
});

test("the shared off phrase clears the mode from the input hook", async () => {
  await withPath(null, async () => {
    resetSharedComboState();
    const entries: SessionEntry[] = [];
    const { handlers, commands, ctx } = harness(entries);
    await commands.get("headroom")!("on", ctx);
    await handlers.get("input")!({ text: "normal mode", source: "user" }, ctx);
    expect(ctx.entries.at(-1)).toEqual({ type: "custom", customType: "headroom-mode", data: { mode: "off" } });
    expect(ctx.notifications.at(-1)).toBe(OFF_LINE);
  });
});

test("a session_start restores the persisted mode", async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [{ type: "custom", customType: "headroom-mode", data: { mode: "on" } }];
  const { handlers, ctx } = harness(entries);
  await handlers.get("session_start")!({}, ctx);
  expect(ctx.notifications.at(-1)).toBe(ON_LINE);
});

test("the configured default starts a fresh session with headroom on", async () => {
  await withHome(async (home) => {
    mkdirSync(path.join(home, ".tersio"), { recursive: true });
    writeFileSync(path.join(home, ".tersio", "settings.json"), `${JSON.stringify({ headroomDefault: "on" })}\n`, "utf8");
    expect(existsSync(path.join(home, ".tersio", "settings.json"))).toBe(true);
    resetSharedComboState();
    // A default without session entries lands on the bar through the combo publish, exactly as pstack's does.
    const comboCommands = new Map<string, CommandHandler>();
    const comboHandlers = new Map<string, EventHandler>();
    const comboEntries: SessionEntry[] = [];
    comboToggleExtension({
      setLabel() {},
      registerCommand(name: string, config: { handler: CommandHandler }) { comboCommands.set(name, config.handler); },
      registerTool() {},
      appendEntry(customType: string, data: Record<string, unknown>) { comboEntries.push({ type: "custom", customType, data }); },
      on(event: string, handler: EventHandler) { comboHandlers.set(event, handler); },
    } as unknown as ExtensionApi);
    const comboCtx: TestCtx = {
      notifications: [], statuses: new Map(), entries: comboEntries,
      sessionManager: { getBranch: () => comboEntries },
      ui: { setStatus(name: string, v: string | undefined) { if (v !== undefined) { comboCtx.statuses.set(name, v); if (name === "tersio") comboCtx.notifications.push(v); } }, notify() {} },
    };
    const { handlers, ctx } = harness([]);
    await handlers.get("session_start")!({}, ctx);
    await comboHandlers.get("session_start")!({}, comboCtx);
    expect(comboCtx.notifications.at(-1)).toBe(ON_LINE);
    expect(getSharedComboState().headroom).toBe("on");
  });
});

test("a pip --user script dir that is off PATH still resolves, through the pinned home", async () => {
  await withHome(async (home) => {
    // pip's user scripts land here on Linux, and uv's tool shims land here everywhere.
    const localBin = path.join(home, ".local", "bin");
    const bin = fakeExecutable(localBin, process.platform === "win32" ? "headroom.exe" : "headroom", "#!/bin/sh\nexit 0\n", "exit /b 0");
    const previousPath = process.env.PATH;
    process.env.PATH = "/definitely-no-headroom-here";
    try {
      // A fresh HOME must not inherit a user base computed from the real one.
      expect(resolveHeadroomBinary()).toBe(bin);
    } finally {
      process.env.PATH = previousPath;
    }
  });
});

test("an active mode injects one replaceable block only when the binary and its runtime are up", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-headroom-bin-"));
  fakeExecutable(dir, process.platform === "win32" ? "headroom.exe" : "headroom", "#!/bin/sh\nexit 0\n", "exit /b 0");
  const server = createServer((_req, res) => { res.writeHead(200); res.end("ok"); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const previousUrl = process.env.TERSIO_HEADROOM_PROXY_URL;
  process.env.TERSIO_HEADROOM_PROXY_URL = `http://127.0.0.1:${port}/`;
  try {
    await withPath(dir, async () => {
      resetSharedComboState();
      const entries: SessionEntry[] = [];
      const { handlers, commands, ctx } = harness(entries);
      await commands.get("headroom")!("on", ctx);
      const prompt = { systemPrompt: ["base"] };
      const first = await handlers.get("before_agent_start")!(prompt, undefined) as { systemPrompt?: string | string[] } | undefined;
      // A pi host gets one string; OMP gets an array whose last block is ours.
      const injected = typeof first?.systemPrompt === "string" ? first.systemPrompt : first?.systemPrompt?.at(-1);
      expect(injected).toContain("🍃 HEADROOM MODE ACTIVE");
      // The same body is matched whole, so a re-presented prompt cannot stack it.
      const second = await handlers.get("before_agent_start")!({ systemPrompt: [...(prompt.systemPrompt ?? []), headroomInstruction()] }, undefined);
      expect(second).toBeUndefined();
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previousUrl === undefined) delete process.env.TERSIO_HEADROOM_PROXY_URL;
    else process.env.TERSIO_HEADROOM_PROXY_URL = previousUrl;
  }
  // Without the binary the block would lie to the model, so the extension stays silent while the mode stays on.
  await withPath(null, async () => {
    resetSharedComboState();
    const entries: SessionEntry[] = [{ type: "custom", customType: "headroom-mode", data: { mode: "on" } }];
    const { handlers, ctx } = harness(entries);
    await handlers.get("session_start")!({}, ctx);
    const none = await handlers.get("before_agent_start")!({ systemPrompt: ["base"] }, undefined);
    expect(none).toBeUndefined();
  });
  // A binary with no runtime behind it compresses nothing, so the block stays out.
  process.env.TERSIO_HEADROOM_PROXY_URL = "http://127.0.0.1:1/";
  try {
    await withPath(dir, async () => {
      resetSharedComboState();
      const entries: SessionEntry[] = [{ type: "custom", customType: "headroom-mode", data: { mode: "on" } }];
      const { handlers, ctx } = harness(entries);
      await handlers.get("session_start")!({}, ctx);
      const none = await handlers.get("before_agent_start")!({ systemPrompt: ["base"] }, undefined);
      expect(none).toBeUndefined();
    });
  } finally {
    if (previousUrl === undefined) delete process.env.TERSIO_HEADROOM_PROXY_URL;
    else process.env.TERSIO_HEADROOM_PROXY_URL = previousUrl;
  }
});

test("a durable config block reads as installed for omp and opencode", () => {
  withHome((home) => {
    const omp = path.join(home, ".omp", "agent", "models.yml");
    mkdirSync(path.dirname(omp), { recursive: true });
    writeFileSync(omp, "providers:\n  anthropic:\n    baseUrl: http://127.0.0.1:8787\n", "utf8");
    expect(durableConfigInstalled("omp"), "no marker yet").toBe(false);
    writeFileSync(omp, "# managed by `headroom wrap omp`\nproviders:\n  anthropic:\n    baseUrl: http://127.0.0.1:8787\n", "utf8");
    expect(durableConfigInstalled("omp")).toBe(true);
    const opencode = path.join(home, ".config", "opencode", "opencode.json");
    mkdirSync(path.dirname(opencode), { recursive: true });
    writeFileSync(opencode, "{\n  \"provider\": {}\n}\n", "utf8");
    expect(durableConfigInstalled("opencode"), "no provider block yet").toBe(false);
    writeFileSync(opencode, "{\n  \"provider\": {\n    \"headroom\": {}\n  }\n}\n", "utf8");
    expect(durableConfigInstalled("opencode")).toBe(true);
  });
});

test("pi and PiG refuse the mode instead of promising compression they cannot route", async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [];
  const { commands, handlers, ctx } = harness(entries, "pi");
  await commands.get("headroom")!("on", ctx);
  expect(entries).toEqual([]);
  expect(ctx.notifications.at(-1)).toContain("Headroom does not support this agent");
  const prompt = await handlers.get("before_agent_start")?.(
    { systemPrompt: ["base"] },
    ctx,
  ) as { systemPrompt?: string[] } | undefined;
  expect(prompt).toBeUndefined();
});
