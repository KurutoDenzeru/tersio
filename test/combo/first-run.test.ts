import { expect, test } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import comboToggleExtension from "../../extensions/combo-toggle/index.ts";
import { resetSharedComboState } from "../../extensions/shared/session-state.ts";
import type { ExtensionApi, ExtensionCtx, SessionEntry } from "../../extensions/shared/types.ts";

function withHome(run: (home: string) => Promise<void>): Promise<void> {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-combo-setup-"));
  const previous = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  return run(home).finally(() => {
    if (previous.HOME === undefined) delete process.env.HOME;
    else process.env.HOME = previous.HOME;
    if (previous.USERPROFILE === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previous.USERPROFILE;
    rmSync(home, { recursive: true, force: true });
    resetSharedComboState();
  });
}

function harness(selection: string | undefined, hasUI = true): { handlers: Map<string, (event: unknown, ctx: ExtensionCtx) => Promise<unknown>>; entries: SessionEntry[]; prompts: string[]; ctx: ExtensionCtx } {
  const handlers = new Map<string, (event: unknown, ctx: ExtensionCtx) => Promise<unknown>>();
  const entries: SessionEntry[] = [];
  const prompts: string[] = [];
  const pi = {
    setLabel: () => { },
    registerCommand: () => { },
    registerTool: () => { },
    on: (event: string, handler: (event: unknown, ctx: ExtensionCtx) => Promise<unknown>) => { handlers.set(event, handler); },
    appendEntry: (customType: string, data: Record<string, unknown>) => { entries.push({ type: "custom", customType, data }); },
  } as unknown as ExtensionApi;
  const ctx = {
    hasUI,
    sessionManager: { getBranch: () => entries },
    ui: {
      select: async (title: string) => { prompts.push(title); return selection; },
      setStatus: () => { },
      notify: () => { },
    },
  } as unknown as ExtensionCtx;
  comboToggleExtension(pi);
  return { handlers, entries, prompts, ctx };
}

function readSettings(home: string): Record<string, unknown> {
  const lock = JSON.parse(readFileSync(path.join(home, ".omp", "plugins", "omp-plugins.lock.json"), "utf8")) as { settings?: Record<string, Record<string, unknown>> };
  return lock.settings?.["@krtclcdy/tersio"] ?? {};
}

test("interactive OMP install selects and persists a Combo default", async () => {
  await withHome(async (home) => {
    const h = harness("balanced");
    await h.handlers.get("session_start")!({}, h.ctx);

    expect(h.prompts).toHaveLength(1);
    expect(h.entries.find((entry) => entry.customType === "combo-level")?.data?.level).toBe("balanced");
    expect(readSettings(home)).toMatchObject({
      comboDefault: "balanced",
      comboSetupComplete: true,
      cavemanDefault: "full",
      rtkDefault: true,
      ponytailDefault: "full",
    });

    await h.handlers.get("session_start")!({}, h.ctx);
    expect(h.prompts, "setup prompt never repeats").toHaveLength(1);
  });
});

test("canceling first-run setup records off and never repeats", async () => {
  await withHome(async (home) => {
    const h = harness(undefined);
    await h.handlers.get("session_start")!({}, h.ctx);
    expect(readSettings(home)).toMatchObject({ comboDefault: "off", comboSetupComplete: true });
    await h.handlers.get("session_start")!({}, h.ctx);
    expect(h.prompts).toHaveLength(1);
  });
});

test("headless session_start leaves setup for the first interactive agent_start", async () => {
  await withHome(async (home) => {
    const h = harness("balanced", false);
    await h.handlers.get("session_start")!({}, h.ctx);
    expect(h.prompts).toHaveLength(0);
    const lockPath = path.join(home, ".omp", "plugins", "omp-plugins.lock.json");
    expect(existsSync(lockPath)).toBe(false);

    const interactiveCtx = { ...h.ctx, hasUI: true };
    await h.handlers.get("agent_start")!({}, interactiveCtx);
    expect(h.prompts).toHaveLength(1);
    expect(readSettings(home)).toMatchObject({ comboDefault: "balanced", comboSetupComplete: true });
  });
});

test("existing marked install does not prompt", async () => {
  await withHome(async (home) => {
    mkdirSync(path.join(home, ".omp", "plugins"), { recursive: true });
    writeFileSync(
      path.join(home, ".omp", "plugins", "omp-plugins.lock.json"),
      JSON.stringify({ plugins: {}, settings: { "@krtclcdy/tersio": { comboDefault: "medium", comboSetupComplete: true } } }),
      "utf8",
    );
    const h = harness("balanced");
    await h.handlers.get("session_start")!({}, h.ctx);
    expect(h.prompts).toHaveLength(0);
  });
});
