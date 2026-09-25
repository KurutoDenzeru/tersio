import { expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import tersioCommandsExtension from "../../extensions/tersio-commands/index.ts";
import type { ExtensionApi, ExtensionCtx } from "../../extensions/shared/types.ts";

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
  for (const sub of ["status", "check", "update", "dashboard", "usage"]) {
    expect(h.notifications.join("\n")).toMatch(new RegExp(`/tersio ${sub}`));
  }
});

test("/tersio mode switches redirect to their own commands", async () => {
  for (const sub of ["caveman full", "rtk on", "ponytail full", "combo max"]) {
    const h = harness();
    await h.command(sub, h.ctx);
    expect(h.appended.length, `${sub} writes no entries`).toBe(0);
    expect(h.notifications.join("\n")).toMatch(new RegExp(`Use /${sub.split(" ")[0]} instead`));
  }
});

test("/tersio unknown warns with help", async () => {
  const h = harness();
  await h.command("frobnicate", h.ctx);
  expect(h.notifications.join("\n")).toMatch(/Unknown subcommand/);
});

test("/tersio update without target shows usage", async () => {
  const h = harness();
  await h.command("update", h.ctx);
  expect(h.notifications.join("\n")).toMatch(/Usage: \/tersio update/);
});

test("/tersio usage reports ledger rows", async () => {
  const h = harness();
  await h.command("usage", h.ctx);
  expect(h.notifications.join("\n")).toMatch(/tersio usage: \d+ rows/);
});
test("/tersio dashboard exports and opens the Dashboard", async () => {
  const h = harness();
  await h.command("dashboard", h.ctx);
  expect(h.execCalls[0].cmd).toBe("tersio");
  expect(h.execCalls[0].args.slice(0, 2)).toEqual(["dashboard", "--export"]);
  expect(h.execCalls[0].args[2]).toMatch(/tersio-dashboard-.*\.html/);
  expect(["open", "xdg-open", "start"].includes(h.execCalls[1].cmd), JSON.stringify(h.execCalls)).toBeTruthy();
  expect(h.notifications.join("\n")).toMatch(/dashboard: opened in your browser/);
});

test("/tersio dashboard falls back to the shell command on failure", async () => {
  const h = harness(async () => ({ stdout: "", stderr: "nope", code: 1 }));
  await h.command("dashboard", h.ctx);
  expect(h.notifications.join("\n")).toMatch(/tersio dashboard --open/);
});

test("/tersio gain is no longer a dashboard alias", async () => {
  const h = harness();
  await h.command("gain", h.ctx);
  expect(h.execCalls).toHaveLength(0);
  expect(h.notifications.join("\n")).toMatch(/Unknown subcommand: gain/);
});
