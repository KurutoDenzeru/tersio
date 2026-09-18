// Status-bar ownership regression: while a Combo preset is active, the combo bar
// is the only status line — caveman and rtk must not paint their own bars
// alongside it. This regressed when the `balanced` preset was added: caveman and
// rtk's suppression checks hardcoded medium/max, so balanced leaked through and
// the status bar showed both `🪨 caveman: FULL` and the combo bar.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import cavemanSessionExtension from "../../extensions/caveman-session/index.js";
import comboToggleExtension from "../../extensions/combo-toggle/index.js";
import rtkSessionExtension from "../../extensions/rtk-session/index.js";
import { getSharedComboState, resetSharedComboState } from "../../extensions/shared/session-state.js";
import type { ExtensionApi, ExtensionCtx, SessionEntry } from "../../extensions/shared/types.js";

// ponytail: hermetic HOME — the combo fallback reads the real lock file, so
// without this the suite depends on the developer's own comboDefault.
process.env.HOME = new URL("../definitely-missing-home", import.meta.url).pathname;
process.env.USERPROFILE = process.env.HOME;

interface Harness {
  statuses: Map<string, string>;
  entries: SessionEntry[];
  pi: { combo: ExtensionApi; caveman: ExtensionApi; rtk: ExtensionApi; handlers: Map<string, (event: unknown, ctx: ExtensionCtx) => Promise<unknown>> };
  ctx: ExtensionCtx;
}

function harness(): Harness {
  const statuses = new Map<string, string>();
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
      notify: () => { },
    },
    sessionManager: { getBranch: () => entries },
  } as unknown as ExtensionCtx;
  comboToggleExtension(pi.combo);
  cavemanSessionExtension(pi.caveman);
  rtkSessionExtension(pi.rtk);
  return { statuses, entries, pi, ctx };
}

test("combo balanced suppresses the individual caveman and rtk bars", async () => {
  resetSharedComboState();
  const { statuses, pi, ctx } = harness();
  await pi.combo.handlers.get("session_start")!({}, ctx);
  await pi.caveman.handlers.get("session_start")!({}, ctx);
  await pi.rtk.handlers.get("session_start")!({}, ctx);

  await pi.combo.commands.get("combo")!("balanced", ctx);
  assert.ok(statuses.has("combo"), "combo bar present");
  assert.doesNotMatch(statuses.get("combo") || "", /caveman: FULL/);

  // The race that surfaced the bug: caveman/rtk reconcile after combo paints.
  await pi.caveman.handlers.get("agent_start")!({}, ctx);
  await pi.rtk.handlers.get("agent_start")!({}, ctx);
  assert.deepEqual([...statuses.keys()], ["combo"], "combo bar is the only status line under balanced");
  assert.match(statuses.get("combo") || "", /BALANCED/);
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
  assert.ok(!statuses.has("caveman"), "caveman bar suppressed from persisted combo-level");
  assert.ok(!statuses.has("rtk"), "rtk bar suppressed from persisted combo-level");
  await pi.combo.handlers.get("session_start")!({}, noUiCtx);
  assert.match(statuses.get("combo") || "", /BALANCED/, "combo bar painted from persisted state");
  assert.deepEqual([...statuses.keys()], ["combo"]);
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
    assert.deepEqual([...h.statuses.keys()], ["combo"], `${preset} leaves only the combo bar`);
  }

  // /combo off persists caveman=off + rtk=off: everything off, no bars.
  resetSharedComboState();
  const off = harness();
  await off.pi.combo.handlers.get("session_start")!({}, off.ctx);
  await off.pi.caveman.handlers.get("session_start")!({}, off.ctx);
  await off.pi.rtk.handlers.get("session_start")!({}, off.ctx);
  await off.pi.combo.commands.get("combo")!("off", off.ctx);
  await off.pi.caveman.handlers.get("agent_start")!({}, off.ctx);
  await off.pi.rtk.handlers.get("agent_start")!({}, off.ctx);
  assert.equal(off.statuses.size, 0, "combo off turns everything off: no bars");

  // Custom mix (individual modes set, combo inactive): individual bars return.
  resetSharedComboState();
  const custom = harness();
  await custom.pi.combo.handlers.get("session_start")!({}, custom.ctx);
  await custom.pi.caveman.handlers.get("session_start")!({}, custom.ctx);
  await custom.pi.rtk.handlers.get("session_start")!({}, custom.ctx);
  await custom.pi.caveman.commands.get("caveman")!("full", custom.ctx);
  await custom.pi.rtk.commands.get("rtk")!("on", custom.ctx);
  await custom.pi.combo.handlers.get("agent_start")!({}, custom.ctx);
  assert.ok(!custom.statuses.has("combo"), "no combo bar for a custom mix");
  assert.ok(custom.statuses.has("caveman") && custom.statuses.has("rtk"), "individual bars restored for a custom mix");
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
    assert.equal(getSharedComboState().level, "balanced");
    assert.match(h.statuses.get("combo") || "", /BALANCED/);
  } finally {
    if (previous === undefined) delete process.env.HOME;
    else process.env.HOME = previous;
    rmSync(home, { recursive: true, force: true });
    resetSharedComboState();
  }
});

test("combo default persists preset entries so resume keeps the bar", async () => {
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
    assert.deepEqual(
      h.entries.map((e) => e.customType).sort(),
      ["caveman-mode", "combo-level", "ponytail-mode", "rtk-mode"],
    );
    assert.equal(h.entries.find((e) => e.customType === "combo-level")?.data?.level, "balanced");
    assert.equal(getSharedComboState().level, "balanced");
    assert.match(h.statuses.get("combo") || "", /BALANCED/);
    assert.match(h.statuses.get("combo") || "", /ponytail=FULL/);
  } finally {
    if (previous === undefined) delete process.env.HOME;
    else process.env.HOME = previous;
    rmSync(home, { recursive: true, force: true });
    resetSharedComboState();
  }
});

test("a UI-less event must not deafen the bar to later bridge updates", async () => {
  // Reported symptom: the bar kept showing "combo BALANCED" while the session's
  // modes had actually gone off. Cause: syncStatus remembered a ctx with no `ui`
  // (a session_start that fires before the TUI attaches), so the bridge-listener
  // path — which calls syncStatus() with no ctx and therefore paints through the
  // remembered one — silently returned early forever, freezing the bar.
  resetSharedComboState();
  const { statuses, pi, ctx } = harness();
  await pi.combo.handlers.get("session_start")!({}, ctx);
  await pi.caveman.handlers.get("session_start")!({}, ctx);
  await pi.rtk.handlers.get("session_start")!({}, ctx);
  await pi.combo.commands.get("combo")!("balanced", ctx);
  assert.match(statuses.get("combo") || "", /BALANCED/);

  // Pre-attach session_start: hasUI false and no ui object at all.
  const headless = { hasUI: false, sessionManager: ctx.sessionManager } as unknown as ExtensionCtx;
  await pi.combo.handlers.get("session_start")!({}, headless);

  // A sibling mode change publishes through the bridge; combo's listener runs
  // with no ctx, so it must still paint through the remembered interactive ctx.
  await pi.caveman.commands.get("caveman")!("off", ctx);

  assert.equal(getSharedComboState().level, "custom", "the mix is no longer a preset");
  assert.equal(statuses.get("combo"), undefined, "combo bar clears rather than freezing on BALANCED");
  resetSharedComboState();
});
