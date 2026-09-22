import { expect, test } from "vitest";

import rtkSessionExtension from "../../extensions/rtk-session/index.ts";
import type { ExtensionApi, ExtensionCtx, SessionEntry } from "../../extensions/shared/types.ts";

process.env.HOME = new URL("../definitely-missing-home", import.meta.url).pathname;
process.env.USERPROFILE = process.env.HOME;

type EventHandler = (event: unknown, ctx: ExtensionCtx | undefined) => Promise<unknown>;

function harness(entries: SessionEntry[]): { handlers: Map<string, EventHandler>; notifications: string[] } {
  const handlers = new Map<string, EventHandler>();
  const notifications: string[] = [];
  const chain = { min: () => chain, describe: () => chain };
  rtkSessionExtension({
    setLabel() {},
    registerCommand() {},
    registerTool() {},
    appendEntry() {},
    on(event: string, handler: EventHandler) { handlers.set(event, handler); },
    zod: { z: { object: (shape: Record<string, unknown>) => shape, array: () => chain, string: () => chain } },
  } as unknown as ExtensionApi);
  return { handlers, notifications };
}

function context(entries: SessionEntry[], notifications: string[]): ExtensionCtx {
  return {
    hasUI: true,
    sessionManager: { getBranch: () => entries },
    ui: {
      setStatus() {},
      notify(message: string) { notifications.push(message); },
    },
  } as ExtensionCtx;
}

test("restore skips a corrupt latest rtk-mode entry and uses the older valid one", async () => {
  const entries: SessionEntry[] = [
    { type: "custom", customType: "rtk-mode", data: { enabled: true } },
    { type: "custom", customType: "rtk-mode", data: { enabled: "maybe" } },
  ];
  const { handlers, notifications } = harness(entries);
  await handlers.get("session_start")!({}, context(entries, notifications));
  expect(notifications.at(-1)).toBe("RTK loaded: on");
});
