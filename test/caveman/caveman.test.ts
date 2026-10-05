import { expect, test } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cavemanSessionExtension from "../../extensions/caveman-session/index.ts";
import { resetSharedComboState } from "../../extensions/shared/session-state.ts";
import type { ExtensionApi, SessionEntry } from "../../extensions/shared/types.ts";
import { readCavemanDefault } from "../../extensions/shared/plugin-settings.ts";

process.env.HOME = new URL("../definitely-missing-home", import.meta.url).pathname;
process.env.USERPROFILE = process.env.HOME;
process.env.TERSIO_HOME = process.env.HOME;

type CommandHandler = (args: string, ctx: TestCtx) => Promise<void>;
type EventHandler = (event: unknown, ctx: TestCtx | undefined) => Promise<unknown>;

interface TestPi {
  commands: Map<string, CommandHandler>;
  handlers: Map<string, EventHandler>;
}

interface TestCtx {
  notifications: string[];
  statuses: Map<string, string>;
  sessionManager: { getBranch: () => SessionEntry[] };
  ui: { setStatus(name: string, value: string | undefined): void; notify(message: string): void };
}

function harness(entries: SessionEntry[] = []): { pi: TestPi; ctx: TestCtx } {
  const commands = new Map<string, CommandHandler>();
  const handlers = new Map<string, EventHandler>();
  const notifications: string[] = [];
  // The real setStatus API is keyed; `notifications` mirrors the existing assertions on the
  // combo line, and `statuses` keeps every key so the caveman slot can be asserted too.
  const statuses = new Map<string, string>();
  cavemanSessionExtension({
    // The injected zod is how the extensions recognise an OMP host.
    zod: { z: {} },
    setLabel() {},
    registerCommand(name: string, config: { handler: CommandHandler }) { commands.set(name, config.handler); },
    registerTool() {},
    appendEntry(customType: string, data: Record<string, unknown>) { entries.push({ type: "custom", customType, data }); },
    on(event: string, handler: EventHandler) { handlers.set(event, handler); },
  } as unknown as ExtensionApi);
  const ctx = {
    hasUI: true,
    notifications,
    statuses,
    sessionManager: { getBranch: () => entries },
    ui: {
      setStatus(name: string, v: string | undefined) { if (v !== undefined) { statuses.set(name, v); if (name === 'tersio') notifications.push(v); } },
      notify(message: string) { notifications.push(message); },
    },
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
    expect(notifications.at(-1)).toMatch(/🧩 combo CUSTOM: 🪨caveman=FULL/);
  }
});

test("each mode reports itself in the shared status line", async () => {
  for (const mode of ["lite", "ultra", "megacave-lite", "megacave-full", "megacave-ultra"]) {
    const notifications = await caveman([], mode);
    expect(notifications.at(-1)).toMatch(new RegExp(`🪨caveman=${mode.toUpperCase()} `));
  }
  for (const legacy of ["wenyan", "wenyan-full"]) {
    const notifications = await caveman([], legacy);
    expect(notifications.at(-1)).toMatch(/🪨caveman=MEGACAVE-FULL /);
  }
});

test("turning caveman off collapses the status to the off line", async () => {
  const notifications = await caveman([], "off");
  expect(notifications.at(-1)).toBe("🧩 combo OFF");
});

test("status reports the current mode, unknown args show usage", async () => {
  resetSharedComboState();
  const { pi, ctx } = harness();
  await pi.commands.get("caveman")!("ultra", ctx);
  await pi.commands.get("caveman")!("status", ctx);
  expect(ctx.notifications.at(-1)).toMatch(/🪨caveman=ULTRA/);
  await pi.commands.get("caveman")!("bogus", ctx);
  expect(ctx.notifications.at(-1)).toBe("Usage: /caveman [lite|full|ultra|megacave-lite|megacave-full|megacave-ultra|off|status]");
});

test("natural-language off commands switch the mode off", async () => {
  for (const text of ["stop caveman", "Normal mode!", "caveman off"]) {
    resetSharedComboState();
    const { pi, ctx } = harness();
    await pi.commands.get("caveman")!("full", ctx);
    await pi.handlers.get("input")!({ text, source: "user" }, ctx);
    await pi.commands.get("caveman")!("status", ctx);
    expect(ctx.notifications.at(-1)).toBe("🧩 combo OFF");
  }
});

test("input from extensions never toggles the mode", async () => {
  resetSharedComboState();
  const { pi, ctx } = harness();
  await pi.commands.get("caveman")!("full", ctx);
  await pi.handlers.get("input")!({ text: "stop caveman", source: "extension" }, ctx);
  await pi.commands.get("caveman")!("status", ctx);
  expect(ctx.notifications.at(-1)).toMatch(/🪨caveman=FULL/);
});

test("session_start restores the persisted mode, fresh sessions use the default", async () => {
  resetSharedComboState();
  const restored = harness([{ type: "custom", customType: "caveman-mode", data: { mode: "wenyan" } }]);
  await restored.pi.handlers.get("session_start")!({}, restored.ctx);
  // A session entry written under the old name restores onto the canonical one.
  expect(restored.ctx.notifications.at(-1)).toMatch(/🪨caveman=MEGACAVE-FULL/);

  resetSharedComboState();
  const fresh = harness();
  await fresh.pi.handlers.get("session_start")!({}, fresh.ctx);
  expect(fresh.ctx.notifications.at(-1)).toBe("🧩 combo OFF");
});

test("legacy plugin default normalizes to megacave-full and injects rules", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-caveman-default-"));
  const lockDir = path.join(home, ".omp", "plugins");
  mkdirSync(lockDir, { recursive: true });
  writeFileSync(path.join(lockDir, "omp-plugins.lock.json"), JSON.stringify({
    settings: { "@krtclcdy/tersio": { cavemanDefault: "wenyan" } },
  }), "utf8");
  const previous = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, TERSIO_HOME: process.env.TERSIO_HOME };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.TERSIO_HOME = home;
  try {
    resetSharedComboState();
    const { pi, ctx } = harness();
    await pi.handlers.get("session_start")!({}, ctx);
    // The legacy `wenyan` value survives the lookup verbatim, so the mode the
    // session starts in is the normalized one, and it is that mode's block that
    // lands in the prompt.
    expect(readCavemanDefault()).toBe("wenyan");
    const injected = await pi.handlers.get("before_agent_start")!({ systemPrompt: "Base." }, ctx) as { systemPrompt: string[] };
    expect(injected.systemPrompt.at(-1)).toMatch(/Caveman megacave-full active/);
    expect(injected.systemPrompt.at(-1)).toMatch(/以文言答/);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(home, { recursive: true, force: true });
  }
});

test("before_agent_start injects the per-mode instruction, nothing when off", async () => {
  for (const [mode, pattern] of [["lite", /Caveman lite active/], ["ultra", /Caveman ultra active/], ["megacave-full", /Caveman megacave-full active/i], ["megacave-lite", /Caveman megacave-lite active/i], ["megacave-ultra", /Caveman megacave-ultra active/i]] as const) {
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
  expect(result.systemPrompt.at(-1)).toMatch(/megacave-lite\|megacave-full\|megacave-ultra/);
 });


test("each level injects its own rule file verbatim, with no paraphrase alongside it", async () => {
  const extDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "extensions", "caveman-session");
  const bodies = {
    lite: "rule.md", full: "rule.md",
    ultra: "rule-ultra.md",
    "megacave-lite": "rule-megacave.md", "megacave-full": "rule-megacave.md", "megacave-ultra": "rule-megacave.md",
  } as const;
  for (const [mode, file] of Object.entries(bodies)) {
    resetSharedComboState();
    const { pi, ctx } = harness();
    await pi.commands.get("caveman")!(mode, ctx);
    const result = await pi.handlers.get("before_agent_start")!({ systemPrompt: "Base." }, ctx) as { systemPrompt: string[] };

    // One source of truth per level: its rule file, byte for byte.
    const rule = readFileSync(path.join(extDir, file), "utf8");
    expect(result.systemPrompt.at(-1)).toBe(`Caveman ${mode} active for this session.\n${rule}`);
  }
  // The registers actually differ.
  expect(readFileSync(path.join(extDir, bodies.ultra), "utf8")).not.toBe(readFileSync(path.join(extDir, bodies.full), "utf8"));
  expect(readFileSync(path.join(extDir, bodies["megacave-full"]), "utf8")).not.toBe(readFileSync(path.join(extDir, bodies.full), "utf8"));
});

test("a missing rule.md names the fix instead of shipping a degraded paraphrase", async () => {
  // A missing rule is a visible failure, not a lossy paraphrase.
  const source = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "extensions", "caveman-session", "index.ts"),
    "utf8",
  );
  expect(source).not.toMatch(/FALLBACK_FULL_RULE/);
  expect(source).toMatch(/is missing\. Run: tersio doctor --fix extensions/);
});

test("the caveman status slot carries the mode for the model's status reply", async () => {
  resetSharedComboState();
  const { pi, ctx } = harness([]);
  await pi.commands.get("caveman")!("ultra", ctx);
  expect(ctx.statuses.get("caveman")).toBe("Caveman mode: ultra");
  expect(ctx.statuses.get("tersio")).toMatch(/🧩 combo CUSTOM: 🪨caveman=ULTRA/);

  await pi.commands.get("caveman")!("off", ctx);
  expect(ctx.statuses.get("caveman")).toBe("Caveman mode: unknown");
});
