import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import cavemanSessionExtension from "../../extensions/caveman-session/index.js";
import comboToggleExtension from "../../extensions/combo-toggle/index.js";
import modeReinforcementExtension from "../../extensions/shared/mode-reinforcement.js";
import rtkSessionExtension from "../../extensions/rtk-session/index.js";
import {
  OMP_SUBAGENT_MARKER,
  getSharedComboState,
  resetSharedComboState,
} from "../../extensions/shared/session-state.js";
import type { ExtensionApi, ExtensionCtx, SessionEntry } from "../../extensions/shared/types.js";

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

async function withoutInstalledPonytail<T>(callback: () => Promise<T>): Promise<T> {
  const missingHome = fileURLToPath(new URL("../definitely-missing-home", import.meta.url));
  const previous = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = missingHome;
  process.env.USERPROFILE = missingHome;
  try {
    return await callback();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("parent Combo max is inherited by separately instantiated marked children", async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [];
  const parent = instantiate(comboToggleExtension, entries);
  await command(parent, "combo", "max", context(entries, true));
  const childCaveman = instantiate(cavemanSessionExtension);
  const childRtk = instantiate(rtkSessionExtension);
  const childCombo = instantiate(comboToggleExtension);

  assert.deepEqual(getSharedComboState(), {
    level: "max", caveman: "ultra", rtk: "on", ponytail: "ultra",
  });
  assert.match(instruction(await inject(childCaveman, MARKED_PROMPT)), /Caveman ultra active/);
  assert.match(instruction(await inject(childRtk, MARKED_PROMPT)), /RTK mode active/);

  const ponytail = instruction(await withoutInstalledPonytail(() => inject(childCombo, MARKED_PROMPT)));
  assert.match(ponytail, /PONYTAIL MODE ACTIVE — level: ultra/);
  assert.match(ponytail, /root cause/i);
  assert.match(ponytail, /Standard library/i);
  assert.match(ponytail, /YAGNI/);
  assert.match(ponytail, /Verify/);
});

test("medium maps to Caveman lite, RTK on, and Ponytail lite", async () => {
  resetSharedComboState();
  const parent = instantiate(comboToggleExtension);
  await command(parent, "combo", "medium", context([], true));
  const prompt = ["System instructions.", OMP_SUBAGENT_MARKER];

  assert.deepEqual(getSharedComboState(), {
    level: "medium", caveman: "lite", rtk: "on", ponytail: "lite",
  });
  assert.match(instruction(await inject(instantiate(cavemanSessionExtension), prompt)), /Caveman lite active/);
  assert.match(instruction(await inject(instantiate(rtkSessionExtension), prompt)), /RTK mode active/);
  assert.match(
    instruction(await withoutInstalledPonytail(() => inject(instantiate(comboToggleExtension), prompt))),
    /PONYTAIL MODE ACTIVE — level: lite/
  );
});

test("Combo off gives marked children no inherited guidance", async () => {
  resetSharedComboState();
  const parent = instantiate(comboToggleExtension);
  const ctx = context([], true);
  await command(parent, "combo", "max", ctx);
  await command(parent, "combo", "off", ctx);

  assert.deepEqual(getSharedComboState(), {
    level: "off", caveman: "off", rtk: "off", ponytail: "off",
  });
  for (const factory of [cavemanSessionExtension, rtkSessionExtension, comboToggleExtension]) {
    assert.equal(await inject(instantiate(factory), MARKED_PROMPT), undefined);
  }
});

test("unmarked headless prompts never inherit active parent modes", async () => {
  resetSharedComboState();
  const parent = instantiate(comboToggleExtension);
  await command(parent, "combo", "max", context([], true));

  for (const factory of [cavemanSessionExtension, rtkSessionExtension, comboToggleExtension]) {
    const child = instantiate(factory);
    await child.handlers.get("session_start")?.({}, context([], false));
    assert.equal(await inject(child, UNMARKED_PROMPT), undefined);
  }
});

test("headless child session_start cannot reset the parent bridge", async () => {
  resetSharedComboState();
  const parent = instantiate(comboToggleExtension);
  await command(parent, "combo", "max", context([], true));
  const childCombo = instantiate(comboToggleExtension);

  await childCombo.handlers.get("session_start")!({}, context([], false));

  assert.equal(getSharedComboState().level, "max");
  assert.match(
    instruction(await withoutInstalledPonytail(() => inject(childCombo, MARKED_PROMPT))),
    /level: ultra/
  );
});

test("interactive top-level session_start with no entries resets bridge off", async () => {
  resetSharedComboState();
  const parent = instantiate(comboToggleExtension);
  await command(parent, "combo", "max", context([], true));
  const nextSession = instantiate(comboToggleExtension);

  await nextSession.handlers.get("session_start")!({}, context([], true));

  assert.equal(getSharedComboState().level, "off");
  for (const factory of [cavemanSessionExtension, rtkSessionExtension, comboToggleExtension]) {
    assert.equal(await inject(instantiate(factory), MARKED_PROMPT), undefined);
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

  assert.deepEqual(getSharedComboState(), {
    level: "custom", caveman: "lite", rtk: "on", ponytail: "ultra",
  });
  assert.equal(comboCtx.statuses.get("combo"), undefined);
  assert.match(instruction(await inject(instantiate(cavemanSessionExtension), MARKED_PROMPT)), /Caveman lite active/);
  assert.match(instruction(await inject(instantiate(rtkSessionExtension), MARKED_PROMPT)), /RTK mode active/);
  assert.match(
    instruction(await withoutInstalledPonytail(() => inject(instantiate(comboToggleExtension), MARKED_PROMPT))),
    /level: ultra/
  );

  await command(caveman, "caveman", "ultra", context(entries, true));
  assert.equal(getSharedComboState().level, "max");
  assert.match(comboCtx.statuses.get("combo")!, /combo MAX: 🪨caveman=ULTRA ⚡rtk=ON 🦥ponytail=ULTRA/);
});

test("individual RTK change returns Combo to its preset when values realign", async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [];
  const combo = instantiate(comboToggleExtension, entries);
  const comboCtx = context(entries, true);
  await command(combo, "combo", "max", comboCtx);
  const rtk = instantiate(rtkSessionExtension, entries);

  await command(rtk, "rtk", "off", context(entries, true));

  assert.deepEqual(getSharedComboState(), {
    level: "custom", caveman: "ultra", rtk: "off", ponytail: "ultra",
  });
  assert.equal(comboCtx.statuses.get("combo"), undefined);
  assert.equal(await inject(instantiate(rtkSessionExtension), MARKED_PROMPT), undefined);

  await command(rtk, "rtk", "on", context(entries, true));
  assert.equal(getSharedComboState().level, "max");
  assert.match(comboCtx.statuses.get("combo")!, /combo MAX: 🪨caveman=ULTRA ⚡rtk=ON 🦥ponytail=ULTRA/);
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
  assert.deepEqual(getSharedComboState(), {
    level: "max", caveman: "ultra", rtk: "on", ponytail: "ultra",
  });
  assert.match(comboCtx.statuses.get("combo")!, /combo MAX: 🪨caveman=ULTRA ⚡rtk=ON 🦥ponytail=ULTRA/);
});

test("Combo status restores the preset indicator when persisted modes realign", async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [];
  const combo = instantiate(comboToggleExtension, entries);
  const ctx = context(entries, true);
  await command(combo, "combo", "max", ctx);
  entries.push({ type: "custom", customType: "ponytail-mode", data: { mode: "lite" } });

  await command(combo, "combo", "status", ctx);

  assert.deepEqual(getSharedComboState(), {
    level: "custom", caveman: "ultra", rtk: "on", ponytail: "lite",
  });
  assert.equal(ctx.notifications.at(-1), "Combo: INACTIVE (caveman=ultra rtk=on ponytail=lite)");
  assert.match(
    instruction(await withoutInstalledPonytail(() => inject(instantiate(comboToggleExtension), MARKED_PROMPT))),
    /level: lite/
  );

  entries.push({ type: "custom", customType: "ponytail-mode", data: { mode: "ultra" } });
  await command(combo, "combo", "status", ctx);
  assert.deepEqual(getSharedComboState(), {
    level: "max", caveman: "ultra", rtk: "on", ponytail: "ultra",
  });
  assert.match(ctx.statuses.get("combo")!, /combo MAX: 🪨caveman=ULTRA ⚡rtk=ON 🦥ponytail=ULTRA/);
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
  assert.deepEqual(getSharedComboState(), {
    level: "max", caveman: "ultra", rtk: "on", ponytail: "ultra",
  });
  assert.match(ctx.statuses.get("combo")!, /combo MAX: 🪨caveman=ULTRA ⚡rtk=ON 🦥ponytail=ULTRA/);
  resetSharedComboState();
});

test("mode commands confirm the session-wide active set", async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [];
  const combo = instantiate(comboToggleExtension, entries);
  const ctx = context(entries, true);
  await command(combo, "combo", "max", ctx);
  assert.equal(
    ctx.notifications.at(-1),
    "Combo max on — caveman=ULTRA, rtk=ON, ponytail=ULTRA active for this session."
  );
  const caveman = instantiate(cavemanSessionExtension, entries);
  const cavemanCtx = context(entries, true);
  await command(caveman, "caveman", "full", cavemanCtx);
  assert.equal(
    cavemanCtx.notifications.at(-1),
    "Caveman full on — terse replies for this session. Active: caveman=FULL, rtk=ON, ponytail=ULTRA."
  );
  const rtk = instantiate(rtkSessionExtension, entries);
  const rtkCtx = context(entries, true);
  await command(rtk, "rtk", "off", rtkCtx);
  assert.equal(
    rtkCtx.notifications.at(-1),
    "RTK off. Active: caveman=FULL, rtk=OFF, ponytail=ULTRA."
  );
  resetSharedComboState();
});

test("Combo indicator appears only after a Combo preset", async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [];
  const combo = instantiate(comboToggleExtension, entries);
  const ctx = context(entries, true);

  await command(combo, "combo", "medium", ctx);
  assert.match(ctx.statuses.get("combo")!, /combo MEDIUM: 🪨caveman=LITE ⚡rtk=ON 🦥ponytail=LITE/);

  entries.push({ type: "custom", customType: "ponytail-mode", data: { mode: "ultra" } });
  await command(combo, "combo", "status", ctx);
  assert.equal(ctx.statuses.get("combo"), undefined);
});

test("mode reinforcement follows each top-level turn without persisting duplicates", async () => {
  resetSharedComboState();
  const entries = [
    { type: "custom", customType: "caveman-mode", data: { mode: "wenyan" } },
    { type: "custom", customType: "rtk-mode", data: { enabled: true } },
    { type: "custom", customType: "ponytail-mode", data: { mode: "ultra" } },
  ];
  const reinforcement = instantiate(modeReinforcementExtension, entries);
  const ctx = context(entries, true);

  for (const prompt of ["First turn.", "Later turn with long history."]) {
    const result = await inject(reinforcement, prompt, ctx);
    assert.equal(
      instruction(result),
      "SUPREME TOKEN SAVER MODES ACTIVE: caveman=wenyan · rtk=on · ponytail=ultra. Keep these active for the entire response: concise Caveman prose, RTK for eligible noisy shell output, and the smallest correct Ponytail solution. Do not weaken or disable a mode unless the user explicitly asks."
    );
  }

  const first = await inject(reinforcement, "Prompt.", ctx);
  assert.equal(await inject(reinforcement, ["Prompt.", instruction(first)], ctx), undefined);
});


test("Combo does not duplicate existing Ponytail guidance", async () => {
  resetSharedComboState();
  const parent = instantiate(comboToggleExtension);
  await command(parent, "combo", "medium", context([], true));
  const prompt = [OMP_SUBAGENT_MARKER, "PONYTAIL MODE ACTIVE — level: lite"];

  assert.equal(await inject(instantiate(comboToggleExtension), prompt), undefined);
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

  assert.equal(await inject(pi, UNMARKED_PROMPT), undefined);
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

  assert.equal(await inject(pi, UNMARKED_PROMPT), undefined);
});
