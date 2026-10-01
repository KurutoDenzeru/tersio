import { afterEach, expect, test } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import cavemanSessionExtension from "../../extensions/caveman-session/index.ts";
import comboToggleExtension from "../../extensions/combo-toggle/index.ts";
import rtkSessionExtension from "../../extensions/rtk-session/index.ts";
import {
  OMP_SUBAGENT_MARKER,
  getSharedComboState,
  isOmpSubagentPrompt,
  resetSharedComboState,
  setSharedComboMode,
} from "../../extensions/shared/session-state.ts";
import type { ExtensionApi, SessionEntry } from "../../extensions/shared/types.ts";

// ponytail: hermetic HOME — session-start fallbacks read the real lock file,
// so without this the suite depends on the developer's own defaults.
process.env.HOME = new URL("../definitely-missing-home", import.meta.url).pathname;
process.env.USERPROFILE = process.env.HOME;

const MARKED_PROMPT = `System instructions.\n${OMP_SUBAGENT_MARKER}`;
const UNMARKED_PROMPT = "System instructions for an unrelated headless session.";

type CommandHandler = (args: string, ctx: TestCtx) => Promise<void>;
type EventHandler = (event: unknown, ctx: TestCtx | undefined) => Promise<unknown>;

interface TestPi {
  commands: Map<string, CommandHandler>;
  handlers: Map<string, EventHandler>;
  zod: { z: { object: (shape: Record<string, unknown>) => Record<string, unknown>; array: () => { min: () => TestChain; describe: () => TestChain }; string: () => TestChain } };
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
  statuses: Map<string, string>;
  notifications: string[];
  sessionManager: { getBranch: () => SessionEntry[] };
  ui: {
    setStatus(name: string, value: string | undefined): void;
    notify(message: string): void;
  };
  reload(): Promise<void>;
}

type TestExtension = (pi: ExtensionApi) => void;

function fakePi(sessionEntries: SessionEntry[] = []): TestPi {
  const commands = new Map<string, CommandHandler>();
  const handlers = new Map<string, EventHandler>();
  const chain: TestChain = { min: () => chain, describe: () => chain };
  const pi: TestPi = {
    commands,
    handlers,
    zod: { z: { object: (shape) => shape, array: () => chain, string: () => chain } },
    setLabel() { },
    registerCommand(name, config) { commands.set(name, config.handler); },
    registerTool() { },
    on(event, handler) { handlers.set(event, handler); },
    appendEntry(customType, data) { sessionEntries.push({ type: "custom", customType, data }); },
  };
  return pi;
}

function context(entries: SessionEntry[] = [], hasUI = false): TestCtx {
  const statuses = new Map<string, string>();
  const notifications: string[] = [];
  return {
    hasUI,
    statuses,
    notifications,
    sessionManager: { getBranch: () => entries },
    ui: {
      setStatus(name, value) { if (value === undefined) statuses.delete(name); else statuses.set(name, value); },
      notify(message) { notifications.push(message); },
    },
    async reload() { },
  };
}

function instantiate(factory: TestExtension, entries: SessionEntry[] = []): TestPi {
  const pi = fakePi(entries);
  factory(pi as unknown as ExtensionApi);
  return pi;
}

async function command(pi: TestPi, name: string, value: string, ctx: TestCtx): Promise<void> {
  await pi.commands.get(name)!(value, ctx);
}

async function inject(pi: TestPi, systemPrompt: string | string[], ctx?: TestCtx): Promise<{ systemPrompt?: string[] } | undefined> {
  return (await pi.handlers.get("before_agent_start")!({ systemPrompt }, ctx)) as { systemPrompt?: string[] } | undefined;
}

function instruction(result: { systemPrompt?: string[] } | undefined) {
  return result?.systemPrompt?.at(-1) || "";
}

test("parent Combo max is inherited by separately instantiated marked children", async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [];
  const parent = instantiate(comboToggleExtension, entries);
  await command(parent, "combo", "max", context(entries, true));
  const childCaveman = instantiate(cavemanSessionExtension);
  const childRtk = instantiate(rtkSessionExtension);
  const childCombo = instantiate(comboToggleExtension);

  expect(getSharedComboState()).toEqual({
    level: "max", caveman: "ultra", rtk: "on", ponytail: "ultra",
  });
  expect(instruction(await inject(childCaveman, MARKED_PROMPT))).toMatch(/Caveman ultra active/);
  expect(instruction(await inject(childRtk, MARKED_PROMPT))).toMatch(/RTK guidance active/);

  const ponytail = instruction(await inject(childCombo, MARKED_PROMPT));
  expect(ponytail).toMatch(/# Ponytail/);
  expect(ponytail).toMatch(/PONYTAIL MODE ACTIVE — level: ultra/);
  expect(ponytail).toMatch(/root cause/i);
  expect(ponytail).toMatch(/YAGNI/);
});

test("medium maps to Caveman lite, RTK on, and Ponytail lite", async () => {
  resetSharedComboState();
  const parent = instantiate(comboToggleExtension);
  await command(parent, "combo", "medium", context([], true));
  const prompt = ["System instructions.", OMP_SUBAGENT_MARKER];

  expect(getSharedComboState()).toEqual({
    level: "medium", caveman: "lite", rtk: "on", ponytail: "lite",
  });
  expect(instruction(await inject(instantiate(cavemanSessionExtension), prompt))).toMatch(/Caveman lite active/);
  expect(instruction(await inject(instantiate(rtkSessionExtension), prompt))).toMatch(/RTK guidance active/);
  expect(instruction(await inject(instantiate(comboToggleExtension), prompt))).toMatch(/PONYTAIL MODE ACTIVE — level: lite/);
});

test("Combo off gives marked children no inherited guidance", async () => {
  resetSharedComboState();
  const parent = instantiate(comboToggleExtension);
  const ctx = context([], true);
  await command(parent, "combo", "max", ctx);
  await command(parent, "combo", "off", ctx);

  expect(getSharedComboState()).toEqual({
    level: "off", caveman: "off", rtk: "off", ponytail: "off",
  });
  for (const factory of [cavemanSessionExtension, rtkSessionExtension, comboToggleExtension]) {
    expect(await inject(instantiate(factory), MARKED_PROMPT)).toBe(undefined);
  }
});

test("an unmarked headless prompt does not make caveman or rtk inherit", async () => {
  resetSharedComboState();
  const parent = instantiate(comboToggleExtension);
  await command(parent, "combo", "max", context([], true));

  // Caveman and rtk stay gated on the marker, so an unmarked prompt inherits nothing.
  for (const factory of [cavemanSessionExtension, rtkSessionExtension]) {
    const child = instantiate(factory);
    await child.handlers.get("session_start")?.({}, context([], false));
    expect(await inject(child, UNMARKED_PROMPT)).toBe(undefined);
  }
});

// A worker's session_start carries no Tersio entries; reconciling that wiped shared state.
test("a worker's empty session_start leaves the parent's modes inherited", async () => {
  resetSharedComboState();
  const parent = instantiate(comboToggleExtension);
  await command(parent, "combo", "max", context([], true));

  for (const [factory, expected] of [
    [cavemanSessionExtension, /Caveman ultra active/],
    [rtkSessionExtension, /RTK guidance active/],
    [comboToggleExtension, /PONYTAIL MODE ACTIVE/],
  ] as const) {
    const worker = instantiate(factory);
    await worker.handlers.get("session_start")?.({}, context([], false));
    expect(getSharedComboState().level, "shared state survives the worker's session_start").toBe("max");
    expect(instruction(await inject(worker, MARKED_PROMPT)), "worker inherits").toMatch(expected);
  }
});

test("headless child session_start cannot reset the parent bridge", async () => {
  resetSharedComboState();
  const parent = instantiate(comboToggleExtension);
  await command(parent, "combo", "max", context([], true));
  const childCombo = instantiate(comboToggleExtension);

  await childCombo.handlers.get("session_start")!({}, context([], false));

  expect(getSharedComboState().level).toBe("max");
  expect(instruction(await inject(childCombo, MARKED_PROMPT))).toMatch(/level: ultra/);
});

test("interactive top-level session_start with no entries resets bridge off", async () => {
  resetSharedComboState();
  const parent = instantiate(comboToggleExtension);
  await command(parent, "combo", "max", context([], true));
  const nextSession = instantiate(comboToggleExtension);

  await nextSession.handlers.get("session_start")!({}, context([], true));

  expect(getSharedComboState().level).toBe("off");
  for (const factory of [cavemanSessionExtension, rtkSessionExtension, comboToggleExtension]) {
    expect(await inject(instantiate(factory), MARKED_PROMPT)).toBe(undefined);
  }
});

test("individual Caveman change immediately makes Combo CUSTOM and children inherit actual mix", async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [];
  const combo = instantiate(comboToggleExtension, entries);
  const comboCtx = context(entries, true);
  await command(combo, "combo", "max", comboCtx);
  const caveman = instantiate(cavemanSessionExtension, entries);

  await command(caveman, "caveman", "lite", context(entries, true));

  expect(getSharedComboState()).toEqual({
    level: "custom", caveman: "lite", rtk: "on", ponytail: "ultra",
  });
  expect(comboCtx.statuses.get("combo")).toBe(undefined);
  expect(instruction(await inject(instantiate(cavemanSessionExtension), MARKED_PROMPT))).toMatch(/Caveman lite active/);
  expect(instruction(await inject(instantiate(rtkSessionExtension), MARKED_PROMPT))).toMatch(/RTK guidance active/);
  expect(instruction(await inject(instantiate(comboToggleExtension), MARKED_PROMPT))).toMatch(/level: ultra/);

  await command(caveman, "caveman", "ultra", context(entries, true));
  expect(getSharedComboState().level).toBe("max");
  expect(comboCtx.statuses.get("combo")!).toMatch(/combo MAX: 🪨caveman=ULTRA ⚡rtk=ON 🦥ponytail=ULTRA/);
});

test("individual RTK change returns Combo to its preset when values realign", async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [];
  const combo = instantiate(comboToggleExtension, entries);
  const comboCtx = context(entries, true);
  await command(combo, "combo", "max", comboCtx);
  const rtk = instantiate(rtkSessionExtension, entries);

  await command(rtk, "rtk", "off", context(entries, true));

  expect(getSharedComboState()).toEqual({
    level: "custom", caveman: "ultra", rtk: "off", ponytail: "ultra",
  });
  expect(comboCtx.statuses.get("combo")).toBe(undefined);
  expect(await inject(instantiate(rtkSessionExtension), MARKED_PROMPT)).toBe(undefined);

  await command(rtk, "rtk", "on", context(entries, true));
  expect(getSharedComboState().level).toBe("max");
  expect(comboCtx.statuses.get("combo")!).toMatch(/combo MAX: 🪨caveman=ULTRA ⚡rtk=ON 🦥ponytail=ULTRA/);
});

test("individually matching preset values activates Combo", async () => {
  resetSharedComboState();
  const entries = [
    { type: "custom", customType: "caveman-mode", data: { mode: "ultra" } },
    { type: "custom", customType: "ponytail-mode", data: { mode: "ultra" } },
  ];
  const combo = instantiate(comboToggleExtension, entries);
  const comboCtx = context(entries, true);
  const rtk = instantiate(rtkSessionExtension, entries);

  await command(combo, "combo", "status", comboCtx);
  await command(rtk, "rtk", "on", context(entries, true));
  expect(getSharedComboState()).toEqual({
    level: "max", caveman: "ultra", rtk: "on", ponytail: "ultra",
  });
  expect(comboCtx.statuses.get("combo")!).toMatch(/combo MAX: 🪨caveman=ULTRA ⚡rtk=ON 🦥ponytail=ULTRA/);
});

test("Combo status restores the preset indicator when persisted modes realign", async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [];
  const combo = instantiate(comboToggleExtension, entries);
  const ctx = context(entries, true);
  await command(combo, "combo", "max", ctx);
  entries.push({ type: "custom", customType: "ponytail-mode", data: { mode: "lite" } });

  await command(combo, "combo", "status", ctx);

  expect(getSharedComboState()).toEqual({
    level: "custom", caveman: "ultra", rtk: "on", ponytail: "lite",
  });
  expect(ctx.notifications.at(-1)).toBe("Combo: INACTIVE (caveman=ultra rtk=on ponytail=lite)");
  expect(instruction(await inject(instantiate(comboToggleExtension), MARKED_PROMPT))).toMatch(/level: lite/);

  entries.push({ type: "custom", customType: "ponytail-mode", data: { mode: "ultra" } });
  await command(combo, "combo", "status", ctx);
  expect(getSharedComboState()).toEqual({
    level: "max", caveman: "ultra", rtk: "on", ponytail: "ultra",
  });
  expect(ctx.statuses.get("combo")!).toMatch(/combo MAX: 🪨caveman=ULTRA ⚡rtk=ON 🦥ponytail=ULTRA/);
});

test("redundant trailing entries do not drop a matching preset (#21)", async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [];
  const combo = instantiate(comboToggleExtension, entries);
  const ctx = context(entries, true);
  await command(combo, "combo", "max", ctx);
  // Entry replay on resume / upstream re-affirming its mode: same values,
  // appended after combo-level. The preset must survive.
  entries.push({ type: "custom", customType: "ponytail-mode", data: { mode: "ultra" } });
  entries.push({ type: "custom", customType: "caveman-mode", data: { mode: "ultra" } });
  entries.push({ type: "custom", customType: "rtk-mode", data: { enabled: true } });
  await command(combo, "combo", "status", ctx);
  expect(getSharedComboState()).toEqual({
    level: "max", caveman: "ultra", rtk: "on", ponytail: "ultra",
  });
  expect(ctx.statuses.get("combo")!).toMatch(/combo MAX: 🪨caveman=ULTRA ⚡rtk=ON 🦥ponytail=ULTRA/);
  resetSharedComboState();
});

test("mode commands confirm the session-wide active set", async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [];
  const combo = instantiate(comboToggleExtension, entries);
  const ctx = context(entries, true);
  await command(combo, "combo", "max", ctx);
  expect(ctx.notifications.at(-1)).toBe("Combo max on — caveman=ULTRA, rtk=ON, ponytail=ULTRA active for this session.");
  const caveman = instantiate(cavemanSessionExtension, entries);
  const cavemanCtx = context(entries, true);
  await command(caveman, "caveman", "full", cavemanCtx);
  expect(cavemanCtx.notifications.at(-1)).toBe("Caveman full on — terse replies for this session. Active: caveman=FULL, rtk=ON, ponytail=ULTRA.");
  const rtk = instantiate(rtkSessionExtension, entries);
  const rtkCtx = context(entries, true);
  await command(rtk, "rtk", "off", rtkCtx);
  expect(rtkCtx.notifications.at(-1)).toBe("RTK off. Active: caveman=FULL, rtk=OFF, ponytail=ULTRA.");
  resetSharedComboState();
});

test("Combo indicator appears only after a Combo preset", async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [];
  const combo = instantiate(comboToggleExtension, entries);
  const ctx = context(entries, true);

  await command(combo, "combo", "medium", ctx);
  expect(ctx.statuses.get("combo")!).toMatch(/combo MEDIUM: 🪨caveman=LITE ⚡rtk=ON 🦥ponytail=LITE/);

  entries.push({ type: "custom", customType: "ponytail-mode", data: { mode: "ultra" } });
  await command(combo, "combo", "status", ctx);
  expect(ctx.statuses.get("combo")).toBe(undefined);
});

test("Combo does not duplicate existing Ponytail guidance", async () => {
  resetSharedComboState();
  const parent = instantiate(comboToggleExtension);
  await command(parent, "combo", "medium", context([], true));
  const prompt = [OMP_SUBAGENT_MARKER, "PONYTAIL MODE ACTIVE — level: lite"];

  expect(await inject(instantiate(comboToggleExtension), prompt)).toBe(undefined);
});

test("caveman restores mode from session_branch instead of using stale in-memory state", async () => {
  const pi = instantiate(cavemanSessionExtension);
  await pi.handlers.get("session_start")!(
    {},
    context([{ type: "custom", customType: "caveman-mode", data: { mode: "full" } }], true)
  );

  await pi.handlers.get("session_branch")!(
    {},
    context([{ type: "custom", customType: "caveman-mode", data: { mode: "off" } }], true)
  );

  expect(await inject(pi, UNMARKED_PROMPT)).toBe(undefined);
});

test("rtk restores enabled state from session_branch instead of using stale in-memory state", async () => {
  const pi = instantiate(rtkSessionExtension);
  await pi.handlers.get("session_start")!(
    {},
    context([{ type: "custom", customType: "rtk-mode", data: { enabled: true } }], true)
  );

  await pi.handlers.get("session_branch")!(
    {},
    context([{ type: "custom", customType: "rtk-mode", data: { enabled: false } }], true)
  );

  expect(await inject(pi, UNMARKED_PROMPT)).toBe(undefined);
});


// The literal prompt read out of the installed omp binary. MARKED_PROMPT feeds
// the constant back into the suite, so it cannot catch the marker drifting.
const REAL_OMP_SUBAGENT_PROMPT = `Worker agent: delegated tasks.

Tools: FULL access (edit, write, bash, grep, read, etc.); MUST use as needed to complete task.
MUST hyperfocus assigned task; NEVER deviate.`;

test("the default marker matches the prompt omp actually sends", () => {
  expect(OMP_SUBAGENT_MARKER).toBe("Worker agent: delegated tasks.");
  expect(isOmpSubagentPrompt(REAL_OMP_SUBAGENT_PROMPT)).toBe(true);
});

test("caveman and rtk reach a subagent on the real omp prompt", async () => {
  resetSharedComboState();
  const parent = instantiate(comboToggleExtension);
  await command(parent, "combo", "max", context([], true));

  // A subagent starts with its own flags at off, so this only passes when the
  // prompt is recognised and shared state is used.
  expect(instruction(await inject(instantiate(cavemanSessionExtension), REAL_OMP_SUBAGENT_PROMPT)))
    .toMatch(/Caveman ultra active/);
  expect(instruction(await inject(instantiate(rtkSessionExtension), REAL_OMP_SUBAGENT_PROMPT)))
    .toMatch(/RTK guidance active/);
});

test("a parent session is not mistaken for a subagent", async () => {
  resetSharedComboState();
  const parent = instantiate(comboToggleExtension);
  await command(parent, "combo", "max", context([], true));

  // Unmarked, so each extension falls back to its own off-by-default flag.
  expect(await inject(instantiate(cavemanSessionExtension), "Regular parent session.")).toBe(undefined);
  expect(await inject(instantiate(rtkSessionExtension), "Regular parent session.")).toBe(undefined);
});

// These cover the settings override only; the default wording needs a live OMP.
const TERSIO_DIR = join(process.env.HOME as string, ".tersio");

// Caveman's block is ours, so a level switch replaces it rather than stacking.
test("a caveman level switch removes the previous level's block", async () => {
  resetSharedComboState();
  const parent = instantiate(comboToggleExtension);
  await command(parent, "combo", "max", context([], true));
  const child = instantiate(cavemanSessionExtension);

  setSharedComboMode("caveman", "lite");
  const first = (await inject(child, "Base."))?.systemPrompt ?? [];

  setSharedComboMode("caveman", "ultra");
  const joined = ((await inject(child, first))?.systemPrompt ?? []).join("\n");

  expect(joined).toMatch(/Caveman ultra active/);
  expect(joined).not.toMatch(/Caveman lite active/);
});

function writeSettings(value: unknown): void {
  mkdirSync(TERSIO_DIR, { recursive: true });
  writeFileSync(join(TERSIO_DIR, "settings.json"), JSON.stringify(value), "utf8");
}

afterEach(() => rmSync(TERSIO_DIR, { recursive: true, force: true }));

test("settings.json overrides the marker when OMP rewords its prompt", async () => {
  writeSettings({ subagentMarkers: ["You are a delegated worker."] });
  resetSharedComboState();
  const parent = instantiate(comboToggleExtension);
  await command(parent, "combo", "max", context([], true));

  // The stale default no longer matches; the configured marker does.
  expect(instruction(await inject(instantiate(cavemanSessionExtension), OMP_SUBAGENT_MARKER))).toBe("");
  expect(instruction(await inject(instantiate(cavemanSessionExtension), "You are a delegated worker.")))
    .toMatch(/Caveman ultra active/);
});

test("a malformed marker setting falls back to the default", () => {
  writeSettings({ subagentMarkers: "not an array" });
  expect(isOmpSubagentPrompt(OMP_SUBAGENT_MARKER)).toBe(true);

  writeSettings({ subagentMarkers: ["", 42, null] });
  expect(isOmpSubagentPrompt(OMP_SUBAGENT_MARKER)).toBe(true);
});

test("caveman and rtk do not re-inject into a prompt that already carries them", async () => {
  resetSharedComboState();
  const parent = instantiate(comboToggleExtension);
  await command(parent, "combo", "medium", context([], true));

  for (const [factory, expected] of [
    [cavemanSessionExtension, /Caveman lite active/],
    [rtkSessionExtension, /RTK guidance active/],
  ] as const) {
    const pi = instantiate(factory);
    const first = instruction(await inject(pi, MARKED_PROMPT));
    expect(first).toMatch(expected);

    // A host that re-presents the mutated prompt must not get a second copy.
    const carried = ["System instructions.", OMP_SUBAGENT_MARKER, first];
    expect(await inject(pi, carried)).toBe(undefined);
  }
});
