// Status-bar ownership regression: while a Combo preset is active, the combo bar
// is the only status line — caveman and rtk must not paint their own bars
// alongside it. This regressed when the `balanced` preset was added: caveman and
// rtk's suppression checks hardcoded medium/max, so balanced leaked through and
// the status bar showed both `🪨 caveman: FULL` and the combo bar.
import { expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import cavemanSessionExtension from "../../extensions/omp/caveman-session/index.ts";
import comboToggleExtension from "../../extensions/omp/combo-toggle/index.ts";
import rtkSessionExtension from "../../extensions/omp/rtk-session/index.ts";
import { getSharedComboState, resetSharedComboState } from "../../extensions/shared/session-state.ts";
import type { ExtensionApi, ExtensionCtx, SessionEntry } from "../../extensions/shared/types.ts";

// ponytail: hermetic HOME — the combo fallback reads the real lock file, so
// without this the suite depends on the developer's own comboDefault.
process.env.HOME = new URL("../definitely-missing-home", import.meta.url).pathname;
process.env.USERPROFILE = process.env.HOME;

interface Harness {
  statuses: Map<string, string>;
  notifications: string[];
  entries: SessionEntry[];
  pi: { combo: ExtensionApi; caveman: ExtensionApi; rtk: ExtensionApi; handlers: Map<string, (event: unknown, ctx: ExtensionCtx) => Promise<unknown>> };
  ctx: ExtensionCtx;
}

function harness(): Harness {
  const statuses = new Map<string, string>();
  const notifications: string[] = [];
  const entries: SessionEntry[] = [];
  const mk = (): ExtensionApi & { handlers: Map<string, (event: unknown, ctx: ExtensionCtx) => Promise<unknown>>; commands: Map<string, (arg: string, ctx: ExtensionCtx) => Promise<unknown>> } => {
    const handlers = new Map<string, (event: unknown, ctx: ExtensionCtx) => Promise<unknown>>();
    const commands = new Map<string, (arg: string, ctx: ExtensionCtx) => Promise<unknown>>();
    return {
      handlers,
      commands,
      setLabel: () => { },
      registerCommand: (name, config) => { commands.set(name, config.handler as (arg: string, ctx: ExtensionCtx) => Promise<unknown>); },
      registerTool: () => { },
      on: (event, handler) => { handlers.set(event, handler as (event: unknown, ctx: ExtensionCtx) => Promise<unknown>); },
      appendEntry: (customType, data) => { entries.push({ type: "custom", customType, data } as SessionEntry); },
      zod: { z: { object: (shape) => shape, array: () => ({ min: () => ({ describe: () => ({}) }) }), string: () => ({}) } },
    } as unknown as ExtensionApi & typeof handlers & { commands: typeof commands };
  };
  const pi = { combo: mk(), caveman: mk(), rtk: mk(), handlers: new Map() };
  const ctx = {
    hasUI: true,
    ui: {
      setStatus: (key: string, value?: string) => { if (value === undefined) statuses.delete(key); else statuses.set(key, value); },
      notify: (message: string) => { notifications.push(message); },
    },
    sessionManager: { getBranch: () => entries },
  } as unknown as ExtensionCtx;
  comboToggleExtension(pi.combo);
  cavemanSessionExtension(pi.caveman);
  rtkSessionExtension(pi.rtk);
  return { statuses, notifications, entries, pi, ctx };
}

test("combo balanced announces one line and paints no status row", async () => {
  resetSharedComboState();
  const { statuses, notifications, pi, ctx } = harness();
  await pi.combo.handlers.get("session_start")!({}, ctx);
  await pi.caveman.handlers.get("session_start")!({}, ctx);
  await pi.rtk.handlers.get("session_start")!({}, ctx);

  await pi.combo.commands.get("combo")!("balanced", ctx);
  expect(notifications.at(-1)).toBe("Combo balanced on: 🧩 combo BALANCED: 🪨caveman=FULL ⚡rtk=ON 🦥ponytail=FULL");

  // The race that surfaced the original bug: caveman/rtk reconcile after combo
  // takes the state. Nothing may reach the footer.
  await pi.caveman.handlers.get("agent_start")!({}, ctx);
  await pi.rtk.handlers.get("agent_start")!({}, ctx);
  expect([...statuses.keys()], "balanced paints no status row at all").toEqual([]);
  resetSharedComboState();
});

test("fresh host suppresses individual bars from persisted entries before combo reconciles", async () => {
  // Real OMP regression: caveman/rtk load before combo and restore their modes
  // from persisted entries, but the combo bar never appeared because the
  // suppression check reads the in-process bridge, which only combo's
  // (UI-gated) reconcile populated. Persisted combo entries alone must drive
  // suppression, with or without combo's session_start having run.
  resetSharedComboState();
  const { statuses, pi, ctx, entries } = harness();
  entries.push(
    { type: "custom", customType: "caveman-mode", data: { mode: "full" } } as SessionEntry,
    { type: "custom", customType: "rtk-mode", data: { enabled: true } } as SessionEntry,
    { type: "custom", customType: "ponytail-mode", data: { mode: "full" } } as SessionEntry,
    { type: "custom", customType: "combo-level", data: { level: "balanced" } } as SessionEntry,
  );
  // Post-reload session_start: UI objects exist, but hasUI is not yet truthy.
  const noUiCtx = { ...ctx, hasUI: false } as ExtensionCtx;
  await pi.caveman.handlers.get("session_start")!({}, noUiCtx);
  await pi.rtk.handlers.get("session_start")!({}, noUiCtx);
  expect(!statuses.has("caveman"), "caveman bar suppressed from persisted combo-level").toBeTruthy();
  expect(!statuses.has("rtk"), "rtk bar suppressed from persisted combo-level").toBeTruthy();
  await pi.combo.handlers.get("session_start")!({}, noUiCtx);
  expect([...statuses.keys()], "persisted preset paints nothing").toEqual([]);
  resetSharedComboState();
});

test("every preset suppresses individual bars; off and custom behave correctly", async () => {
  for (const preset of ["medium", "balanced", "max"] as const) {
    resetSharedComboState();
    const h = harness();
    await h.pi.combo.handlers.get("session_start")!({}, h.ctx);
    await h.pi.caveman.handlers.get("session_start")!({}, h.ctx);
    await h.pi.rtk.handlers.get("session_start")!({}, h.ctx);
    await h.pi.combo.commands.get("combo")!(preset, h.ctx);
    await h.pi.caveman.handlers.get("agent_start")!({}, h.ctx);
    await h.pi.rtk.handlers.get("agent_start")!({}, h.ctx);
    expect([...h.statuses.keys()], `${preset} leaves the footer clear`).toEqual([]);
    expect(h.notifications.at(-1)).toMatch(new RegExp(`^Combo ${preset} on: `));
  }

  // /combo off persists caveman=off + rtk=off: everything off, no bars.
  resetSharedComboState();
  const off = harness();
  await off.pi.combo.handlers.get("session_start")!({}, off.ctx);
  await off.pi.caveman.handlers.get("session_start")!({}, off.ctx);
  await off.pi.rtk.handlers.get("session_start")!({}, off.ctx);
  // On, then off: an already-dark session has nothing to announce, so the
  // transition is what makes the off line worth a line in the conversation.
  await off.pi.combo.commands.get("combo")!("balanced", off.ctx);
  await off.pi.combo.commands.get("combo")!("off", off.ctx);
  await off.pi.caveman.handlers.get("agent_start")!({}, off.ctx);
  await off.pi.rtk.handlers.get("agent_start")!({}, off.ctx);
  expect(off.statuses.size, "combo off turns everything off: no bars").toBe(0);
  const comboLines = off.notifications.filter((n) => n.startsWith("Combo "));
  expect(comboLines, "both transitions announced once each").toHaveLength(2);
  expect(comboLines.at(-1)).toMatch(/^Combo off: /);

  // Custom mix (individual modes set, combo inactive): individual bars return.
  resetSharedComboState();
  const custom = harness();
  await custom.pi.combo.handlers.get("session_start")!({}, custom.ctx);
  await custom.pi.caveman.handlers.get("session_start")!({}, custom.ctx);
  await custom.pi.rtk.handlers.get("session_start")!({}, custom.ctx);
  await custom.pi.caveman.commands.get("caveman")!("full", custom.ctx);
  await custom.pi.rtk.commands.get("rtk")!("on", custom.ctx);
  await custom.pi.combo.handlers.get("agent_start")!({}, custom.ctx);
  expect(custom.statuses.has("caveman") && custom.statuses.has("rtk"), "individual bars restored for a custom mix").toBeTruthy();
  // Only the sibling commands speak here: an individual mode in a session that
  // never had a preset is not a combo transition.
  expect(custom.notifications.filter((n) => n.startsWith("Combo ")), "no combo line for a custom mix").toEqual([]);
  resetSharedComboState();
});
test("combo default applies past unrelated session entries", async () => {
  // The statusbar gap: the old gate checked `!sessionEntries(ctx).length`,
  // so any pre-existing entry blocked the combo default and the bar never
  // painted. Only persisted *mode* entries may block it.
  const home = mkdtempSync(path.join(os.tmpdir(), "combo-fallback-"));
  mkdirSync(path.join(home, ".omp", "plugins"), { recursive: true });
  writeFileSync(
    path.join(home, ".omp", "plugins", "omp-plugins.lock.json"),
    JSON.stringify({ plugins: {}, settings: { "@krtclcdy/tersio": { comboDefault: "balanced" } } }),
    "utf8",
  );
  const previous = process.env.HOME;
  process.env.HOME = home;
  try {
    resetSharedComboState();
    const h = harness();
    h.entries.push({ type: "note", customType: "something-else", data: {} } as unknown as SessionEntry);
    await h.pi.combo.handlers.get("session_start")!({}, h.ctx);
    expect(getSharedComboState().level).toBe("balanced");
    expect(h.notifications.at(-1)).toMatch(/^Combo balanced on: /);
  } finally {
    if (previous === undefined) delete process.env.HOME;
    else process.env.HOME = previous;
    rmSync(home, { recursive: true, force: true });
    resetSharedComboState();
  }
});

test("combo default persists preset entries so resume keeps the preset", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "combo-fallback-"));
  mkdirSync(path.join(home, ".omp", "plugins"), { recursive: true });
  writeFileSync(
    path.join(home, ".omp", "plugins", "omp-plugins.lock.json"),
    JSON.stringify({ plugins: {}, settings: { "@krtclcdy/tersio": { comboDefault: "balanced" } } }),
    "utf8",
  );
  const previous = process.env.HOME;
  process.env.HOME = home;
  try {
    resetSharedComboState();
    const h = harness();
    await h.pi.combo.handlers.get("session_start")!({}, h.ctx);
    expect(h.entries.map((e) => e.customType).sort()).toEqual(["caveman-mode", "combo-level", "ponytail-mode", "rtk-mode"]);
    expect(h.entries.find((e) => e.customType === "combo-level")?.data?.level).toBe("balanced");
    expect(getSharedComboState().level).toBe("balanced");
    expect(h.notifications.at(-1)).toMatch(/ponytail=FULL/);
  } finally {
    if (previous === undefined) delete process.env.HOME;
    else process.env.HOME = previous;
    rmSync(home, { recursive: true, force: true });
    resetSharedComboState();
  }
});

test("a UI-less event must not deafen the line to later bridge updates", async () => {
  // The bar used to freeze on "combo BALANCED" after a pre-attach session_start
  // because the remembered ctx had no `ui`. The announcement has the same
  // dependency, so the same regression is checked here: the line must still
  // follow the bridge, and must not repeat itself for an unchanged state.
  resetSharedComboState();
  const { notifications, pi, ctx } = harness();
  await pi.combo.handlers.get("session_start")!({}, ctx);
  await pi.caveman.handlers.get("session_start")!({}, ctx);
  await pi.rtk.handlers.get("session_start")!({}, ctx);
  await pi.combo.commands.get("combo")!("balanced", ctx);
  expect(notifications.at(-1)).toMatch(/^Combo balanced on: /);

  // Pre-attach session_start: hasUI false and no ui object at all.
  const headless = { hasUI: false, sessionManager: ctx.sessionManager } as unknown as ExtensionCtx;
  await pi.combo.handlers.get("session_start")!({}, headless);
  const afterHeadless = notifications.length;
  await pi.combo.handlers.get("session_start")!({}, headless);
  expect(notifications.length, "an unchanged state does not repeat the line").toBe(afterHeadless);

  // A sibling mode change publishes through the bridge; combo's listener runs
  // with no ctx, so it must still reach the remembered interactive ctx.
  await pi.caveman.commands.get("caveman")!("off", ctx);

  expect(getSharedComboState().level, "the mix is no longer a preset").toBe("custom");
  expect(notifications.filter((n) => n.startsWith("Combo ")), "each state announced once").toHaveLength(2);
  expect(notifications.find((n) => n.startsWith("Combo custom"))).toMatch(/^Combo custom: /);
  resetSharedComboState();
});
