// No-reload sync: /combo and /tersio mode switches must persist entries,
// publish shared state, notify — and never reload the session. Sibling
// mirrors sync live via bridge listeners, so the next turn injects the new
// mode like a normal input message.
import { expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import cavemanSessionExtension from "../../extensions/caveman-session/index.ts";
import comboToggleExtension from "../../extensions/combo-toggle/index.ts";
import rtkSessionExtension from "../../extensions/rtk-session/index.ts";
import tersioCommandsExtension from "../../extensions/tersio-commands/index.ts";
import { getSharedComboState, resetSharedComboState } from "../../extensions/shared/session-state.ts";
import type { ExtensionApi, ExtensionCtx } from "../../extensions/shared/types.ts";

// Hermetic HOME + usage file: combo falls back to lock-file defaults and the
// tersio router appends ledger rows without touching the real machine.
process.env.HOME = new URL("../definitely-missing-home", import.meta.url).pathname;
process.env.USERPROFILE = process.env.HOME;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tersio-noreload-"));
process.env.TERSIO_USAGE_FILE = path.join(dir, "usage.jsonl");

type Handler = (event: unknown, ctx: ExtensionCtx) => Promise<unknown>;
type Command = (args: string, ctx: ExtensionCtx) => Promise<unknown>;

interface Mini {
  commands: Map<string, Command>;
  handlers: Map<string, Handler>;
}

function mini(): Mini & { api: ExtensionApi } {
  const commands = new Map<string, Command>();
  const handlers = new Map<string, Handler>();
  const api = {
    setLabel: () => { },
    registerCommand: (name: string, config: { handler: Command }) => { commands.set(name, config.handler); },
    registerTool: () => { },
    on: (event: string, handler: Handler) => { handlers.set(event, handler); },
    appendEntry: () => { },
    exec: async () => ({ stdout: "", stderr: "", code: 0 }),
    zod: { z: { object: (shape: unknown) => shape, array: () => ({ min: () => ({ describe: () => ({}) }) }), string: () => ({}) } },
  } as unknown as ExtensionApi;
  return { commands, handlers, api };
}

function ctxWithReloadCounter() {
  const notifications: string[] = [];
  let reloaded = 0;
  const ctx = {
    hasUI: true,
    ui: { setStatus: () => { }, notify: (m: string) => { notifications.push(m); } },
    sessionManager: { getBranch: () => [] },
    reload: async () => { reloaded += 1; },
  } as unknown as ExtensionCtx;
  return { ctx, notifications, reloaded: () => reloaded };
}

const MAIN_PROMPT = { systemPrompt: ["user says hi"] };

test("/combo max syncs sibling mirrors with no reload", async () => {
  resetSharedComboState();
  const combo = mini();
  const caveman = mini();
  const rtk = mini();
  comboToggleExtension(combo.api);
  cavemanSessionExtension(caveman.api);
  rtkSessionExtension(rtk.api);
  const { ctx, notifications, reloaded } = ctxWithReloadCounter();

  await combo.commands.get("combo")!("max", ctx);

  expect(reloaded()).toBe(0);
  expect(notifications.join("\n")).toMatch(/Combo max on/);
  const cave = (await caveman.handlers.get("before_agent_start")!(MAIN_PROMPT, ctx)) as { systemPrompt: string[] };
  expect(cave.systemPrompt.join("\n")).toMatch(/Caveman ultra/);
  const rtkOut = (await rtk.handlers.get("before_agent_start")!(MAIN_PROMPT, ctx)) as { systemPrompt: string[] };
  expect(rtkOut.systemPrompt.join("\n")).toMatch(/RTK mode active/);
  resetSharedComboState();
});

test("/tersio no longer duplicates mode switches", async () => {
  resetSharedComboState();
  const tersio = mini();
  tersioCommandsExtension(tersio.api);
  const { ctx, notifications, reloaded } = ctxWithReloadCounter();

  await tersio.commands.get("tersio")!("combo max", ctx);

  expect(reloaded()).toBe(0);
  expect(getSharedComboState().level, "redirect writes nothing").toBe("off");
  expect(notifications.join("\n")).toMatch(/Use \/combo instead/);
  resetSharedComboState();
});
