import { expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import plugin from "../../extensions/opencode/server.ts";

// Fake OpenCode plugin host: captures hooks/commands and keeps storage in memory.
function fakeCtx(): {
  ctx: unknown;
  hooks: Record<string, Array<(event: never) => unknown>>;
  commands: Map<string, { execute: (input: never) => Promise<void> }>;
  prompts: Array<{ sessionID: string; text: string }>;
  store: Map<string, unknown>;
} {
  const hooks: Record<string, Array<(event: never) => unknown>> = {};
  const commands = new Map<string, { execute: (input: never) => Promise<void> }>();
  const prompts: Array<{ sessionID: string; text: string }> = [];
  const store = new Map<string, unknown>();
  const ctx = {
    storage: {
      get: async (key: string): Promise<unknown> => store.get(key),
      set: async (key: string, value: unknown): Promise<void> => {
        store.set(key, value);
      },
    },
    location: { directory: path.join(os.tmpdir(), "tersio-oc-work") },
    command: {
      transform: async (fn: (editor: { add: (cmd: never) => void }) => void): Promise<void> => {
        fn({ add: (cmd: never) => commands.set((cmd as { name: string }).name, cmd as never) });
      },
    },
    tool: {
      transform: async (): Promise<void> => {},
      hook: async (name: string, fn: (event: never) => unknown): Promise<void> => {
        (hooks[name] ??= []).push(fn);
      },
    },
    session: {
      hook: async (name: string, fn: (event: never) => unknown): Promise<void> => {
        (hooks[name] ??= []).push(fn);
      },
      prompt: async (req: { sessionID: string; text: string }): Promise<void> => {
        prompts.push(req);
      },
    },
  };
  return { ctx, hooks, commands, prompts, store };
}

async function fire(hooks: Record<string, Array<(event: never) => unknown>>, name: string, event: unknown): Promise<void> {
  for (const fn of hooks[name] ?? []) await fn(event as never);
}

async function runCommand(
  commands: Map<string, { execute: (input: never) => Promise<void> }>,
  prompts: Array<{ sessionID: string; text: string }>,
  sid: string,
  text: string,
): Promise<string> {
  const combo = commands.get("combo");
  expect(combo, "combo command registered").toBeDefined();
  await combo?.execute({ sessionID: sid, prompt: { text } } as never);
  expect(prompts.length).toBeGreaterThan(0);
  return prompts[prompts.length - 1].text;
}

// Mode changes must not leak across sessions; unseen IDs restore own entries or default.
test("opencode sessions restore modes independently", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-oc-home-"));
  const prevHome = process.env.TERSIO_HOME;
  try {
    process.env.TERSIO_HOME = path.join(home, ".tersio");
    mkdirSync(process.env.TERSIO_HOME, { recursive: true });
    writeFileSync(
      path.join(process.env.TERSIO_HOME, "settings.json"),
      JSON.stringify({ comboDefault: "balanced", cavemanDefault: "full", rtkDefault: true, ponytailDefault: "full" }),
      "utf8",
    );
    const { ctx, hooks, commands, prompts, store } = fakeCtx();
    await (plugin as unknown as { setup(ctx: unknown): Promise<void> }).setup(ctx);

    await fire(hooks, "prompt", { sessionID: "ses-a", prompt: { text: "hi" } });
    const offReply = await runCommand(commands, prompts, "ses-a", "/combo off");
    expect(offReply).toMatch(/OFF/);

    await fire(hooks, "prompt", { sessionID: "ses-b", prompt: { text: "hi" } });
    const statusReply = await runCommand(commands, prompts, "ses-b", "/combo status");
    expect(statusReply).toMatch(/BALANCED/);

    const lastLevel = (key: string): string | undefined => {
      const all = ((store.get(key) ?? []) as Array<{ customType?: string; data?: { level?: string } }>)
        .filter((e) => e.customType === "combo-level")
        .map((e) => String(e.data?.level));
      return all[all.length - 1];
    };
    expect(lastLevel("entries:ses-a")).toBe("off");
    expect(lastLevel("entries:ses-b")).toBe("balanced");
  } finally {
    if (prevHome === undefined) delete process.env.TERSIO_HOME;
    else process.env.TERSIO_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  }
});
