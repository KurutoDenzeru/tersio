// The status line must appear in every session type, and must not repeat
// itself. Before this, the status was a status bar that vanished on most hosts.
import { expect, test } from "vitest";

import cavemanSessionExtension from "../../extensions/caveman-session/index.ts";
import comboToggleExtension from "../../extensions/combo-toggle/index.ts";
import rtkSessionExtension from "../../extensions/rtk-session/index.ts";
import tersioCommandsExtension from "../../extensions/tersio-commands/index.ts";
import {
  OMP_SUBAGENT_MARKER,
  getSharedComboState,
  resetSharedComboState,
} from "../../extensions/shared/session-state.ts";
import { formatStatus } from "../../extensions/shared/status.ts";
import type { ExtensionApi, SessionEntry } from "../../extensions/shared/types.ts";

// Both are needed: `os.homedir()` ignores HOME on macOS, so HOME alone still
// reads the developer's real ~/.tersio settings.
process.env.HOME = new URL("../definitely-missing-home", import.meta.url).pathname;
process.env.TERSIO_HOME = process.env.HOME;

interface TestPi {
  commands: Map<string, CommandHandler>;
  handlers: Map<string, EventHandler>;
  zod: { z: { object: (shape: Record<string, unknown>) => Record<string, unknown>; array: () => TestChain; string: () => TestChain } };
  setLabel(): void;
  registerCommand(name: string, config: { handler: CommandHandler }): void;
  registerTool(): void;
  on(event: string, handler: EventHandler): void;
  appendEntry(customType: string, data: Record<string, unknown>): void;
}


interface TestChain {
  min: () => TestChain;
  describe: () => TestChain;
}


interface TestCtx {
  hasUI: boolean;
  notifications: string[];
  sessionManager: { getBranch: () => SessionEntry[] };
  ui: { notify(message: string): void };
  reload(): Promise<void>;
}

type ExtensionCtx = TestCtx;

function fakePi(entries: SessionEntry[] = []): TestPi {
  const commands = new Map<string, CommandHandler>();
  const handlers = new Map<string, EventHandler>();
  const chain: TestChain = { min: () => chain, describe: () => chain };
  return {
    commands,
    handlers,
    // Present `zod` marks this as the OMP host; without it the adapters treat
    // the fake as pi and skip the shared events.
    zod: { z: { object: (shape) => shape, array: () => chain, string: () => chain } },
    setLabel() { },
    registerCommand(name, config) { commands.set(name, config.handler); },
    registerTool() { },
    on(event, handler) { handlers.set(event, handler); },
    appendEntry(customType, data) { entries.push({ type: "custom", customType, data }); },
  };
}

function context(entries: SessionEntry[] = [], hasUI = true): TestCtx {
  const notifications: string[] = [];
  return {
    hasUI,
    notifications,
    sessionManager: { getBranch: () => entries },
    ui: { notify(message) { notifications.push(message); } },
    async reload() { },
  };
}

/** Lines the status module sent, not every notice. */
function statuses(notifications: string[]): string[] {
  return notifications.filter((n) => n.startsWith("🧩 combo"));
}

function instantiate(factory: (pi: ExtensionApi) => void, entries: SessionEntry[] = []): TestPi {
  const pi = fakePi(entries);
  factory(pi as unknown as ExtensionApi);
  return pi;
}

async function fire(pi: TestPi, event: string, ctx: TestCtx): Promise<void> {
  await pi.handlers.get(event)!({}, ctx);
}

const SESSION_EVENTS = ["session_start", "session_switch", "session_branch", "session_compact"] as const;

test("a new session announces the status", async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [];
  const pi = instantiate(comboToggleExtension, entries);
  const ctx = context(entries);
  await pi.commands.get("combo")!("max", ctx);
  await fire(pi, "session_start", context(entries));

  const pi2 = instantiate(comboToggleExtension, entries);
  const resumed = context(entries);
  await fire(pi2, "session_start", resumed);
  expect(statuses(resumed.notifications)).toEqual(["🧩 combo MAX: 🪨caveman=ULTRA ⚡rtk=ON 🦥ponytail=ULTRA"]);
});

test("every session event announces the status, and an unchanged state stays silent", async () => {
  for (const event of SESSION_EVENTS) {
    resetSharedComboState();
    const entries: SessionEntry[] = [];
    const pi = instantiate(comboToggleExtension, entries);
    const ctx = context(entries);
    await pi.commands.get("combo")!("balanced", ctx);

    const fresh = context(entries);
    const worker = instantiate(comboToggleExtension, entries);
    await fire(worker, event, fresh);
    expect(statuses(fresh.notifications), `${event} announces`).toEqual([
      "🧩 combo BALANCED: 🪨caveman=FULL ⚡rtk=ON 🦥ponytail=FULL",
    ]);

    // A second restore of the same state must not repeat the line.
    const repeat = context(entries);
    const worker2 = instantiate(comboToggleExtension, entries);
    await fire(worker2, event, repeat);
    await fire(worker2, event, repeat);
    expect(statuses(repeat.notifications), `${event} dedupes`).toHaveLength(1);
  }
});

test("a subagent session announces the inherited status", async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [];
  const parent = instantiate(comboToggleExtension, entries);
  await parent.commands.get("combo")!("max", context(entries));

  // A worker's branch carries no Tersio entries, and no UI of its own.
  for (const factory of [comboToggleExtension, cavemanSessionExtension, rtkSessionExtension]) {
    const worker = instantiate(factory);
    const ctx = context([], false);
    await fire(worker, "session_start", ctx);
    expect(statuses(ctx.notifications)).toEqual([
      "🧩 combo MAX: 🪨caveman=ULTRA ⚡rtk=ON 🦥ponytail=ULTRA",
    ]);
  }
});

test("the status survives compaction and still matches the live state", async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [];
  const pi = instantiate(comboToggleExtension, entries);
  const ctx = context(entries);
  await pi.commands.get("combo")!("medium", ctx);

  const afterCompact = context(entries);
  const worker = instantiate(comboToggleExtension, entries);
  await fire(worker, "session_compact", afterCompact);

  expect(statuses(afterCompact.notifications)).toEqual([
    "🧩 combo MEDIUM: 🪨caveman=LITE ⚡rtk=ON 🦥ponytail=LITE",
  ]);
  expect(formatStatus(getSharedComboState())).toBe(statuses(afterCompact.notifications)[0]);
});

test("persisted entries win over the configured default", async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [
    { type: "custom", customType: "combo-level", data: { level: "max" } },
    { type: "custom", customType: "caveman-mode", data: { mode: "ultra" } },
    { type: "custom", customType: "rtk-mode", data: { enabled: true } },
    { type: "custom", customType: "ponytail-mode", data: { mode: "ultra" } },
  ];
  const pi = instantiate(comboToggleExtension, entries);
  const ctx = context(entries);
  await fire(pi, "session_start", ctx);

  // HOME points at a missing dir, so any default read here is "off".
  expect(statuses(ctx.notifications)).toEqual([
    "🧩 combo MAX: 🪨caveman=ULTRA ⚡rtk=ON 🦥ponytail=ULTRA",
  ]);
});

test("a mode command reports the new state, and /tersio status agrees", async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [];
  const combo = instantiate(comboToggleExtension, entries);
  const ctx = context(entries);
  await combo.commands.get("combo")!("max", ctx);
  expect(statuses(ctx.notifications)).toEqual([
    "🧩 combo MAX: 🪨caveman=ULTRA ⚡rtk=ON 🦥ponytail=ULTRA",
  ]);

  const tersio = instantiate(tersioCommandsExtension, entries);
  const asked = context(entries);
  await tersio.commands.get("tersio")!("status", asked);
  expect(statuses(asked.notifications)).toEqual([
    "🧩 combo MAX: 🪨caveman=ULTRA ⚡rtk=ON 🦥ponytail=ULTRA",
  ]);
});

test("the status never reaches the model context", async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [];
  const combo = instantiate(comboToggleExtension, entries);
  const ctx = context(entries);
  await combo.commands.get("combo")!("max", ctx);

  const injected = await combo.handlers.get("before_agent_start")!(
    { systemPrompt: "Base." }, ctx,
  ) as { systemPrompt?: string[] } | undefined;

  // Only the ponytail block may be injected; the status line is display-only.
  const blocks = injected?.systemPrompt ?? [];
  expect(blocks).toHaveLength(2);
  expect(blocks.join("\n")).not.toContain("combo MAX");
});

test("a marked subagent prompt still injects guidance and stays consistent with the status", async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [];
  const parent = instantiate(comboToggleExtension, entries);
  await parent.commands.get("combo")!("max", context(entries));

  const prompt = ["System instructions.", OMP_SUBAGENT_MARKER];
  const worker = instantiate(cavemanSessionExtension);
  const injected = await worker.handlers.get("before_agent_start")!({ systemPrompt: prompt }, undefined) as { systemPrompt?: string[] };
  expect(injected?.systemPrompt?.at(-1)).toMatch(/Caveman ultra active/);
  expect(formatStatus(getSharedComboState())).toBe("🧩 combo MAX: 🪨caveman=ULTRA ⚡rtk=ON 🦥ponytail=ULTRA");
});