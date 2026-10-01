// While a Combo preset is active the combo bar is the only status line. The
// suppression checks once hardcoded medium/max, so `balanced` showed both.
import { expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import cavemanSessionExtension from "../../extensions/caveman-session/index.ts";
import comboToggleExtension from "../../extensions/combo-toggle/index.ts";
import rtkSessionExtension from "../../extensions/rtk-session/index.ts";
import { getSharedComboState, resetSharedComboState } from "../../extensions/shared/session-state.ts";
import type { ExtensionApi, ExtensionCtx, SessionEntry } from "../../extensions/shared/types.ts";

// Hermetic HOME: the combo fallback reads the real lock file.
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
  expect(statuses.has("combo"), "combo bar present").toBeTruthy();
  expect(statuses.get("combo") || "").not.toMatch(/caveman: FULL/);

  // The race that surfaced the bug: siblings reconcile after combo paints.
  await pi.caveman.handlers.get("agent_start")!({}, ctx);
  await pi.rtk.handlers.get("agent_start")!({}, ctx);
  expect([...statuses.keys()], "combo bar is the only status line under balanced").toEqual(["combo"]);
  expect(statuses.get("combo") || "").toMatch(/BALANCED/);
  resetSharedComboState();
});

test("fresh host suppresses individual bars from persisted entries before combo reconciles", async () => {
  // Suppression reads the in-process bridge, which only combo's UI-gated
  // reconcile populates, so persisted entries alone must drive it.
  resetSharedComboState();
  const { statuses, pi, ctx, entries } = harness();
  entries.push(
    { type: "custom", customType: "caveman-mode", data: { mode: "full" } } as SessionEntry,
    { type: "custom", customType: "rtk-mode", data: { enabled: true } } as SessionEntry,
    { type: "custom", customType: "ponytail-mode", data: { mode: "full" } } as SessionEntry,
    { type: "custom", customType: "combo-level", data: { level: "balanced" } } as SessionEntry,
  );
  // Post-reload session_start: UI objects exist, hasUI does not yet.
  const noUiCtx = { ...ctx, hasUI: false } as ExtensionCtx;
  await pi.caveman.handlers.get("session_start")!({}, noUiCtx);
  await pi.rtk.handlers.get("session_start")!({}, noUiCtx);
  expect(!statuses.has("caveman"), "caveman bar suppressed from persisted combo-level").toBeTruthy();
  expect(!statuses.has("rtk"), "rtk bar suppressed from persisted combo-level").toBeTruthy();
  await pi.combo.handlers.get("session_start")!({}, noUiCtx);
  expect(statuses.get("combo") || "", "combo bar painted from persisted state").toMatch(/BALANCED/);
  expect([...statuses.keys()]).toEqual(["combo"]);
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
    expect([...h.statuses.keys()], `${preset} leaves only the combo bar`).toEqual(["combo"]);
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
  expect(off.statuses.size, "combo off turns everything off: no bars").toBe(0);

  // Custom mix (individual modes set, combo inactive): individual bars return.
  resetSharedComboState();
  const custom = harness();
  await custom.pi.combo.handlers.get("session_start")!({}, custom.ctx);
  await custom.pi.caveman.handlers.get("session_start")!({}, custom.ctx);
  await custom.pi.rtk.handlers.get("session_start")!({}, custom.ctx);
  await custom.pi.caveman.commands.get("caveman")!("full", custom.ctx);
  await custom.pi.rtk.commands.get("rtk")!("on", custom.ctx);
  await custom.pi.combo.handlers.get("agent_start")!({}, custom.ctx);
  expect(!custom.statuses.has("combo"), "no combo bar for a custom mix").toBeTruthy();
  expect(custom.statuses.has("caveman") && custom.statuses.has("rtk"), "individual bars restored for a custom mix").toBeTruthy();
  resetSharedComboState();
});
test("combo default applies past unrelated session entries", async () => {
  // Only persisted *mode* entries may block the combo default.
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
    expect(h.statuses.get("combo") || "").toMatch(/BALANCED/);
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
    expect(h.entries.map((e) => e.customType).sort()).toEqual(["caveman-mode", "combo-level", "ponytail-mode", "rtk-mode"]);
    expect(h.entries.find((e) => e.customType === "combo-level")?.data?.level).toBe("balanced");
    expect(getSharedComboState().level).toBe("balanced");
    expect(h.statuses.get("combo") || "").toMatch(/BALANCED/);
    expect(h.statuses.get("combo") || "").toMatch(/ponytail=FULL/);
  } finally {
    if (previous === undefined) delete process.env.HOME;
    else process.env.HOME = previous;
    rmSync(home, { recursive: true, force: true });
    resetSharedComboState();
  }
});

test("a UI-less event must not deafen the bar to later bridge updates", async () => {
  // Symptom: the bar stayed "combo BALANCED" after the modes went off, because
  // a UI-less session_start got remembered and every bare syncStatus() returned.
  resetSharedComboState();
  const { statuses, pi, ctx } = harness();
  await pi.combo.handlers.get("session_start")!({}, ctx);
  await pi.caveman.handlers.get("session_start")!({}, ctx);
  await pi.rtk.handlers.get("session_start")!({}, ctx);
  await pi.combo.commands.get("combo")!("balanced", ctx);
  expect(statuses.get("combo") || "").toMatch(/BALANCED/);

  // Pre-attach session_start: hasUI false and no ui object at all.
  const headless = { hasUI: false, sessionManager: ctx.sessionManager } as unknown as ExtensionCtx;
  await pi.combo.handlers.get("session_start")!({}, headless);

  // A sibling mode change publishes through the bridge; combo's listener runs
  // with no ctx, so it must still paint through the remembered interactive ctx.
  await pi.caveman.commands.get("caveman")!("off", ctx);

  expect(getSharedComboState().level, "the mix is no longer a preset").toBe("custom");
  expect(statuses.get("combo"), "combo bar clears rather than freezing on BALANCED").toBe(undefined);
  resetSharedComboState();
});

// A replaced session painted through the old ctx, threw, and aborted restore.
test("a replaced session does not paint through the stale ctx", async () => {
  resetSharedComboState();
  const { statuses, entries, pi, ctx } = harness();

  await pi.combo.handlers.get("session_start")!({}, ctx);
  await pi.caveman.handlers.get("session_start")!({}, ctx);
  await pi.rtk.handlers.get("session_start")!({}, ctx);
  await pi.combo.commands.get("combo")!("balanced", ctx);
  expect(statuses.get("combo") || "").toMatch(/BALANCED/);

  // The remembered ctx, revocable the way pi revokes one: live now, stale once
  // the session is replaced.
  let live = true;
  const revocable = {
    hasUI: true,
    get ui(): ExtensionCtx["ui"] {
      if (!live) throw new Error("This extension ctx is stale after session replacement or reload.");
      return { setStatus: (k: string, v?: string) => { if (v === undefined) statuses.delete(k); else statuses.set(k, v); }, notify: () => { } };
    },
    sessionManager: { getBranch: () => entries },
  } as unknown as ExtensionCtx;
  await pi.combo.handlers.get("session_start")!({}, revocable);
  live = false; // the session is replaced from here on

  // A sibling mode change publishes through the bridge; combo's listener runs
  // with no ctx and must skip the stale one instead of throwing.
  await expect(pi.caveman.commands.get("caveman")!("full", ctx)).resolves.not.toThrow();

  // The replacement session restores from the persisted entries, so the preset
  // comes back rather than being lost to the throw.
  const fresh = {
    hasUI: true,
    ui: { setStatus: (k: string, v?: string) => { if (v === undefined) statuses.delete(k); else statuses.set(k, v); }, notify: () => { } },
    sessionManager: { getBranch: () => entries },
  } as unknown as ExtensionCtx;
  await expect(pi.combo.handlers.get("session_start")!({}, fresh)).resolves.not.toThrow();
  await expect(pi.caveman.handlers.get("session_start")!({}, fresh)).resolves.not.toThrow();
  await expect(pi.rtk.handlers.get("session_start")!({}, fresh)).resolves.not.toThrow();

  expect(statuses.get("combo") || "", "the preset survives the session replacement").toMatch(/BALANCED/);
  resetSharedComboState();
});
