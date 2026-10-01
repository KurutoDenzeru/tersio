// Hosts instantiate extensions per session and expose no teardown hook, so an
// additive listener Set grew by one per session for the life of the process and
// a closed session's closure kept painting a dead status bar. The bridge is
// keyed now, so re-registering replaces the stale closure instead of stacking.
import { expect, test } from "vitest";

import cavemanSessionExtension from "../../extensions/caveman-session/index.ts";
import rtkSessionExtension from "../../extensions/rtk-session/index.ts";
import comboToggleExtension from "../../extensions/combo-toggle/index.ts";
import { setSharedComboListener, setSharedComboMode } from "../../extensions/shared/session-state.ts";
import type { ExtensionApi } from "../../extensions/shared/types.ts";

process.env.HOME = new URL("../definitely-missing-home", import.meta.url).pathname;
process.env.USERPROFILE = process.env.HOME;

function instance(): ExtensionApi {
  const chain = { min: () => chain, describe: () => chain };
  return {
    setLabel() {},
    registerCommand() {},
    registerTool() {},
    appendEntry() {},
    on() {},
    zod: { z: { object: (shape: Record<string, unknown>) => shape, array: () => chain, string: () => chain } },
  } as unknown as ExtensionApi;
}

function listenerCount(): number {
  const bridge = (globalThis as Record<symbol, unknown>)[Symbol.for("tersio/combo-session-state")] as
    { listeners?: Map<string, unknown> } | undefined;
  return bridge?.listeners?.size ?? 0;
}

test("repeated instantiation does not grow the bridge listeners", () => {
  const before = listenerCount();
  for (let i = 0; i < 8; i++) {
    cavemanSessionExtension(instance());
    rtkSessionExtension(instance());
    comboToggleExtension(instance());
  }
  // One key per add-on; the additive Set this replaced reached 16.
  expect(listenerCount() - before).toBeLessThanOrEqual(3);
});

test("re-registering a key replaces the previous listener", () => {
  let first = 0;
  let second = 0;
  setSharedComboListener("k", () => { first++; });
  setSharedComboListener("k", () => { second++; });
  setSharedComboMode("caveman", "lite");
  expect([first, second]).toEqual([0, 1]);
});

test("distinct keys keep their own listener", () => {
  let a = 0;
  let b = 0;
  setSharedComboListener("a", () => { a++; });
  setSharedComboListener("b", () => { b++; });
  setSharedComboMode("rtk", "on");
  expect([a, b]).toEqual([1, 1]);
});
