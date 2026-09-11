import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import tersioCommandsExtension from "../extensions/tersio-commands/index.js";
import { getSharedComboState, setSharedComboLevel } from "../extensions/shared/session-state.js";
import type { ExtensionApi, ExtensionCtx } from "../extensions/shared/types.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tersio-router-"));
process.env.TERSIO_USAGE_FILE = path.join(dir, "usage.jsonl");

type Handler = (args: string, ctx: ExtensionCtx) => Promise<void>;

function harness(execImpl?: (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string; code: number }>) {
  let command: Handler = async () => { };
  const appended: Array<{ type: string; data: Record<string, unknown> }> = [];
  const notifications: string[] = [];
  const execCalls: Array<{ cmd: string; args: string[] }> = [];
  let reloaded = 0;
  tersioCommandsExtension({
    setLabel() { },
    registerCommand(_name: string, config: { handler: Handler }) { command = config.handler; },
    appendEntry(type: string, data: Record<string, unknown>) { appended.push({ type, data }); },
    exec: async (cmd: string, args: string[]) => {
      execCalls.push({ cmd, args });
      if (execImpl) return execImpl(cmd, args);
      return { stdout: "", stderr: "", code: 0 };
    },
  } as unknown as ExtensionApi);
  const ctx = {
    hasUI: true,
    sessionManager: { getBranch: () => [] },
    ui: { setStatus() { }, notify(m: string) { notifications.push(m); } },
    reload: async () => { reloaded += 1; },
  } as unknown as ExtensionCtx;
  return { command, appended, notifications, execCalls, reloaded: () => reloaded, ctx };
}

test("/tersio help lists every subcommand", async () => {
  const h = harness();
  await h.command("help", h.ctx);
  for (const sub of ["caveman", "combo", "rtk", "ponytail", "status", "check", "update", "gain", "usage"]) {
    assert.match(h.notifications.join("\n"), new RegExp(`/tersio ${sub}`));
  }
});

test("/tersio caveman full persists entries, bridge, ledger, reload", async () => {
  setSharedComboLevel("off");
  const h = harness();
  await h.command("caveman full", h.ctx);
  assert.deepEqual(h.appended, [{ type: "caveman-mode", data: { mode: "full" } }]);
  assert.equal(getSharedComboState().caveman, "full");
  assert.equal(h.reloaded(), 1);
  assert.match(h.notifications.join("\n"), /Caveman full on/);
});

test("/tersio caveman bogus warns and writes nothing", async () => {
  const h = harness();
  await h.command("caveman bogus", h.ctx);
  assert.equal(h.appended.length, 0);
  assert.equal(h.reloaded(), 0);
  assert.match(h.notifications.join("\n"), /Usage: \/tersio caveman/);
});

test("/tersio rtk off toggles bridge entry", async () => {
  const h = harness();
  await h.command("rtk off", h.ctx);
  assert.deepEqual(h.appended, [{ type: "rtk-mode", data: { enabled: false } }]);
  assert.equal(getSharedComboState().rtk, "off");
});

test("/tersio combo max writes all four entries", async () => {
  const h = harness();
  await h.command("combo max", h.ctx);
  assert.deepEqual(h.appended.map((a) => a.type), ["caveman-mode", "rtk-mode", "ponytail-mode", "combo-level"]);
  assert.equal(getSharedComboState().level, "max");
});

test("/tersio unknown warns with help", async () => {
  const h = harness();
  await h.command("frobnicate", h.ctx);
  assert.match(h.notifications.join("\n"), /Unknown subcommand/);
});

test("/tersio update without target shows usage", async () => {
  const h = harness();
  await h.command("update", h.ctx);
  assert.match(h.notifications.join("\n"), /Usage: \/tersio update/);
});

test("/tersio usage reports ledger rows", async () => {
  const h = harness();
  await h.command("usage", h.ctx);
  assert.match(h.notifications.join("\n"), /tersio usage: \d+ rows/);
});
test("/tersio gain exports and opens the dashboard", async () => {
  const h = harness();
  await h.command("gain", h.ctx);
  assert.equal(h.execCalls[0].cmd, "tersio");
  assert.deepEqual(h.execCalls[0].args.slice(0, 2), ["dashboard", "--export"]);
  assert.match(h.execCalls[0].args[2], /tersio-gain-.*\.html/);
  assert.ok(["open", "xdg-open", "start"].includes(h.execCalls[1].cmd), JSON.stringify(h.execCalls));
  assert.match(h.notifications.join("\n"), /dashboard opened in your browser/);
});

test("/tersio gain falls back to the shell command on failure", async () => {
  const h = harness(async () => ({ stdout: "", stderr: "nope", code: 1 }));
  await h.command("gain", h.ctx);
  assert.match(h.notifications.join("\n"), /tersio dashboard --open/);
});
