import { expect, test } from "vitest";

import comboToggleExtension, { ponytailFallback } from "../../extensions/combo-toggle/index.ts";
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
    // The injected zod is how the extensions recognise an OMP host.
    zod: { z: {} },
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


test("the no-package fallback carries each intensity", () => {
  expect(ponytailFallback("lite")).toMatch(/simplest correct solution/);
  expect(ponytailFallback("full")).toMatch(/minimum correct solution/);
  expect(ponytailFallback("ultra")).toMatch(/YAGNI/);
});

test("a marked subagent prompt gets the installed ponytail instructions", async () => {
  // Ponytail is a Tersio dependency, so the package resolves beside the
  // extension in a checkout and in every install layout.
  expect(await injectMarked("ultra")).toMatch(/# Ponytail/);
  expect(await injectMarked("ultra")).toMatch(/PONYTAIL MODE ACTIVE — level: ultra/);
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

test("review is not a runtime mode", async () => {
  expect(await injectMarked("review")).toBe("");
});

test("off mode and unmarked prompts get no injection", async () => {
  resetSharedComboState();
  setSharedComboMode("ponytail", "off");
  expect(await injectHandler()({ systemPrompt: `Base.\n${OMP_SUBAGENT_MARKER}` }, undefined)).toBe(undefined);

  resetSharedComboState();
  setSharedComboMode("ponytail", "ultra");
  expect(await injectHandler()({ systemPrompt: "Base." }, undefined)).toBe(undefined);
});
