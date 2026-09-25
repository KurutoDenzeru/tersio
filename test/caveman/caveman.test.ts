import { expect, test } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import cavemanSessionExtension from "../../extensions/caveman-session/index.ts";
import { resetSharedComboState } from "../../extensions/shared/session-state.ts";
import type { ExtensionApi, SessionEntry } from "../../extensions/shared/types.ts";

process.env.HOME = new URL("../definitely-missing-home", import.meta.url).pathname;
process.env.USERPROFILE = process.env.HOME;

type CommandHandler = (args: string, ctx: TestCtx) => Promise<void>;
type EventHandler = (event: unknown, ctx: TestCtx | undefined) => Promise<unknown>;

interface TestPi {
  commands: Map<string, CommandHandler>;
  handlers: Map<string, EventHandler>;
}

interface TestCtx {
  notifications: string[];
  sessionManager: { getBranch: () => SessionEntry[] };
  ui: { setStatus(): void; notify(message: string): void };
}

function harness(entries: SessionEntry[] = []): { pi: TestPi; ctx: TestCtx } {
  const commands = new Map<string, CommandHandler>();
  const handlers = new Map<string, EventHandler>();
  const notifications: string[] = [];
  cavemanSessionExtension({
    setLabel() {},
    registerCommand(name: string, config: { handler: CommandHandler }) { commands.set(name, config.handler); },
    registerTool() {},
    appendEntry(customType: string, data: Record<string, unknown>) { entries.push({ type: "custom", customType, data }); },
    on(event: string, handler: EventHandler) { handlers.set(event, handler); },
  } as unknown as ExtensionApi);
  const ctx = {
    hasUI: true,
    notifications,
    sessionManager: { getBranch: () => entries },
    ui: { setStatus() {}, notify(message: string) { notifications.push(message); } },
  };
  return { pi: { commands, handlers }, ctx: ctx as TestCtx };
}

async function caveman(entries: SessionEntry[], arg: string): Promise<string[]> {
  resetSharedComboState();
  const { pi, ctx } = harness(entries);
  await pi.commands.get("caveman")!(arg, ctx);
  return ctx.notifications;
}

test("bare /caveman and /caveman on enable full", async () => {
  for (const arg of ["", "on"]) {
    const notifications = await caveman([], arg);
    expect(notifications.at(-1)).toMatch(/Caveman full on — terse replies/);
  }
});

test("each mode confirms with an on notification, off with an off notification", async () => {
  for (const mode of ["lite", "ultra", "wenyan-lite", "wenyan-full", "wenyan-ultra"]) {
    const notifications = await caveman([], mode);
    expect(notifications.at(-1)).toMatch(new RegExp(`Caveman ${mode} on — terse replies`));
  }
  const legacy = await caveman([], "wenyan");
  expect(legacy.at(-1)).toMatch(/Caveman wenyan-full on — terse replies/);
  const notifications = await caveman([], "off");
  expect(notifications.at(-1)).toMatch(/^Caveman off\. Active: /);
});

test("status reports the current mode, unknown args show usage", async () => {
  resetSharedComboState();
  const { pi, ctx } = harness();
  await pi.commands.get("caveman")!("ultra", ctx);
  await pi.commands.get("caveman")!("status", ctx);
  expect(ctx.notifications.at(-1)).toBe("Caveman: ultra");
  await pi.commands.get("caveman")!("bogus", ctx);
  expect(ctx.notifications.at(-1)).toBe("Usage: /caveman [lite|full|ultra|wenyan-lite|wenyan-full|wenyan-ultra|off|status]");
});

test("natural-language off commands switch the mode off", async () => {
  for (const text of ["stop caveman", "Normal mode!", "caveman off"]) {
    resetSharedComboState();
    const { pi, ctx } = harness();
    await pi.commands.get("caveman")!("full", ctx);
    await pi.handlers.get("input")!({ text, source: "user" }, ctx);
    await pi.commands.get("caveman")!("status", ctx);
    expect(ctx.notifications.at(-1)).toBe("Caveman: off");
  }
});

test("input from extensions never toggles the mode", async () => {
  resetSharedComboState();
  const { pi, ctx } = harness();
  await pi.commands.get("caveman")!("full", ctx);
  await pi.handlers.get("input")!({ text: "stop caveman", source: "extension" }, ctx);
  await pi.commands.get("caveman")!("status", ctx);
  expect(ctx.notifications.at(-1)).toBe("Caveman: full");
});

test("session_start restores the persisted mode, fresh sessions use the default", async () => {
  resetSharedComboState();
  const restored = harness([{ type: "custom", customType: "caveman-mode", data: { mode: "wenyan" } }]);
  await restored.pi.handlers.get("session_start")!({}, restored.ctx);
  expect(restored.ctx.notifications.at(-1)).toBe("Caveman loaded: wenyan-full");

  resetSharedComboState();
  const fresh = harness();
  await fresh.pi.handlers.get("session_start")!({}, fresh.ctx);
  expect(fresh.ctx.notifications.at(-1)).toBe("Caveman loaded: off");
});

test("legacy plugin default normalizes to wenyan-full and injects rules", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-caveman-default-"));
  const lockDir = path.join(home, ".omp", "plugins");
  mkdirSync(lockDir, { recursive: true });
  writeFileSync(path.join(lockDir, "omp-plugins.lock.json"), JSON.stringify({
    settings: { "@krtclcdy/tersio": { cavemanDefault: "wenyan" } },
  }), "utf8");
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
    resetSharedComboState();
    const { pi, ctx } = harness();
    await pi.handlers.get("session_start")!({}, ctx);
    expect(ctx.notifications.at(-1)).toBe("Caveman loaded: wenyan-full");
    const injected = await pi.handlers.get("before_agent_start")!({ systemPrompt: "Base." }, ctx) as { systemPrompt: string[] };
    expect(injected.systemPrompt.at(-1)).toMatch(/maximum classical terseness/i);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  }
});

test("before_agent_start injects the per-mode instruction, nothing when off", async () => {
  for (const [mode, pattern] of [["lite", /Caveman lite active/], ["ultra", /Maximum terse prose/], ["wenyan-full", /maximum classical terseness/i], ["wenyan-lite", /semi-classical/i], ["wenyan-ultra", /extreme classical/i]] as const) {
    resetSharedComboState();
    const { pi, ctx } = harness();
    await pi.commands.get("caveman")!(mode, ctx);
    const result = await pi.handlers.get("before_agent_start")!({ systemPrompt: "Base." }, ctx) as { systemPrompt: string[] };
    expect(result.systemPrompt).toHaveLength(2);
    expect(result.systemPrompt.at(-1)).toMatch(pattern);
  }

  resetSharedComboState();
  const { pi, ctx } = harness();
  const result = await pi.handlers.get("before_agent_start")!({ systemPrompt: "Base." }, ctx);
  expect(result).toBe(undefined);
});

test("full mode injects the rule file", async () => {
  resetSharedComboState();
  const { pi, ctx } = harness();
  await pi.commands.get("caveman")!("full", ctx);
  const result = await pi.handlers.get("before_agent_start")!({ systemPrompt: "Base." }, ctx) as { systemPrompt: string[] };
  expect(result.systemPrompt.at(-1)).toMatch(/Caveman full active/);
  expect(result.systemPrompt.at(-1)).toMatch(/Only fluff die/);
  expect(result.systemPrompt.at(-1)).toMatch(/ASD-STE100 Simplified Technical English/);
  expect(result.systemPrompt.at(-1)).toMatch(/No tool-call narration/);
  expect(result.systemPrompt.at(-1)).toMatch(/wenyan-lite\|wenyan-full\|wenyan-ultra/);
 });
