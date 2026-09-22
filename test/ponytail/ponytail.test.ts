import { expect, test } from "vitest";

import comboToggleExtension from "../../extensions/combo-toggle/index.ts";
import {
  OMP_SUBAGENT_MARKER,
  resetSharedComboState,
  setSharedComboMode,
} from "../../extensions/shared/session-state.ts";
import type { ExtensionApi, ExtensionCtx } from "../../extensions/shared/types.ts";

process.env.HOME = new URL("../definitely-missing-home", import.meta.url).pathname;
process.env.USERPROFILE = process.env.HOME;

type EventHandler = (event: unknown, ctx: ExtensionCtx | undefined) => Promise<unknown>;

function injectHandler(): EventHandler {
  let handler!: EventHandler;
  comboToggleExtension({
    setLabel() {},
    registerCommand() {},
    registerTool() {},
    appendEntry() {},
    on(event: string, h: EventHandler) { if (event === "before_agent_start") handler = h; },
  } as unknown as ExtensionApi);
  return handler;
}

async function injectMarked(ponytail: string): Promise<string> {
  resetSharedComboState();
  setSharedComboMode("ponytail", ponytail);
  const result = await injectHandler()({ systemPrompt: `Base.\n${OMP_SUBAGENT_MARKER}` }, undefined);
  const prompt = (result as { systemPrompt?: string[] } | undefined)?.systemPrompt;
  return prompt?.at(-1) ?? "";
}

test("review fallback targets avoidable complexity", async () => {
  expect(await injectMarked("review")).toMatch(/PONYTAIL MODE ACTIVE — level: review/);
  expect(await injectMarked("review")).toMatch(/avoidable complexity/);
});

test("lite and full fallbacks carry their intensities", async () => {
  expect(await injectMarked("lite")).toMatch(/simplest correct solution/);
  expect(await injectMarked("full")).toMatch(/minimum correct solution/);
  expect(await injectMarked("ultra")).toMatch(/YAGNI/);
});

test("existing ponytail guidance is not duplicated", async () => {
  resetSharedComboState();
  setSharedComboMode("ponytail", "ultra");
  const result = await injectHandler()(
    { systemPrompt: [OMP_SUBAGENT_MARKER, "PONYTAIL MODE ACTIVE — level: ultra"] },
    undefined,
  );
  expect(result).toBe(undefined);
});

test("off mode and unmarked prompts get no injection", async () => {
  resetSharedComboState();
  setSharedComboMode("ponytail", "off");
  expect(await injectHandler()({ systemPrompt: `Base.\n${OMP_SUBAGENT_MARKER}` }, undefined)).toBe(undefined);

  resetSharedComboState();
  setSharedComboMode("ponytail", "ultra");
  expect(await injectHandler()({ systemPrompt: "Base." }, undefined)).toBe(undefined);
});
