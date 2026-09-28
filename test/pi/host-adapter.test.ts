// The six host differences, one test each, on both hosts. OMP is the pi fork
// that injects `pi.zod`; pi does not, and that is the whole detection.
import { expect, test } from "vitest";

import {
  hostSelect,
  injectPromptText,
  isPiHost,
  onHostEvent,
  setExtensionLabel,
  stringArrayToolParams,
} from "../../extensions/shared/host.ts";
import { themeStatus } from "../../extensions/shared/session-state.ts";
import type { ExtensionApi, ExtensionCtx, SystemPromptEvent } from "../../extensions/shared/types.ts";

function zodStub() {
  // zod chains keep the whole API after min() and describe(); the stub does too
  // so the adapter is exercised against a faithful shape.
  const chain = (kind: string): Record<string, unknown> => {
    const node: Record<string, unknown> = { kind };
    node.min = (n: number) => chain(`${kind}.min(${n})`);
    node.describe = (text: string) => chain(`${kind}.describe(${text})`);
    return node;
  };
  return { z: { object: (shape: object) => ({ kind: "object", shape }), array: () => chain("array"), string: () => chain("string") } };
}

function ompHost() {
  const labels: string[] = [];
  const events: string[] = [];
  const pi = {
    zod: zodStub(),
    setLabel: (label: string) => { labels.push(label); },
    on: (event: string) => { events.push(event); },
  } as unknown as ExtensionApi;
  return { pi, labels, events };
}

function piHost() {
  const labels: string[] = [];
  const events: string[] = [];
  const pi = {
    // pi's setLabel(entryId, label) marks a session entry, so it takes two
    // arguments; calling it with an extension name would be wrong.
    setLabel: (entryId: string, label?: string) => { labels.push(`${entryId}:${label ?? ""}`); },
    on: (event: string) => { events.push(event); },
  } as unknown as ExtensionApi;
  return { pi, labels, events };
}

test("isPiHost reads the zod injection, not a host name", () => {
  expect(isPiHost(ompHost().pi)).toBe(false);
  expect(isPiHost(piHost().pi)).toBe(true);
});

test("setExtensionLabel labels the extension on OMP and never on pi", () => {
  const omp = ompHost();
  setExtensionLabel(omp.pi, "RTK session toggle");
  expect(omp.labels).toEqual(["RTK session toggle"]);

  const pi = piHost();
  setExtensionLabel(pi.pi, "RTK session toggle");
  expect(pi.labels, "pi would label a session entry with the extension name").toEqual([]);
});

test("onHostEvent registers session_branch on OMP and skips it on pi", () => {
  const handler = () => undefined;
  const omp = ompHost();
  onHostEvent(omp.pi, "session_branch", handler);
  onHostEvent(omp.pi, "session_tree", handler);
  expect(omp.events).toEqual(["session_branch", "session_tree"]);

  const pi = piHost();
  onHostEvent(pi.pi, "session_branch", handler);
  onHostEvent(pi.pi, "session_tree", handler);
  expect(pi.events, "pi reports a branch switch as session_tree").toEqual(["session_tree"]);
});

test("hostSelect returns the option label on both hosts", async () => {
  const options = [
    { label: "off", description: "Keep every Tersio mode inactive" },
    { label: "balanced", description: "caveman=full, rtk=on, ponytail=full" },
  ];
  const ompPick: string[] = [];
  const ompUi = { select: async (_t: string, picked: unknown) => { ompPick.push(...(picked as Array<{ label: string }>).map((o) => o.label)); return "balanced"; } };
  expect(await hostSelect(ompHost().pi, ompUi as never, "title", options)).toBe("balanced");
  expect(ompPick, "OMP keeps the object options").toEqual(["off", "balanced"]);

  const piPick: string[] = [];
  const piUi = { select: async (_t: string, picked: string[]) => { piPick.push(...picked); return "balanced — caveman=full, rtk=on, ponytail=full"; } };
  expect(await hostSelect(piHost().pi, piUi as never, "title", options)).toBe("balanced");
  expect(piPick, "pi takes plain strings").toEqual([
    "off — Keep every Tersio mode inactive",
    "balanced — caveman=full, rtk=on, ponytail=full",
  ]);
});

test("hostSelect passes a cancelled dialog through as undefined", async () => {
  const ui = { select: async () => undefined };
  expect(await hostSelect(piHost().pi, ui as never, "title", [{ label: "off" }])).toBeUndefined();
  expect(await hostSelect(ompHost().pi, undefined, "title", [{ label: "off" }])).toBeUndefined();
});

test("injectPromptText replaces the prompt on OMP and appends on pi", () => {
  const ompEvent: SystemPromptEvent = { systemPrompt: ["base one", "base two"] };
  expect(injectPromptText(ompHost().pi, ompEvent, "MODE ON")).toEqual({ systemPrompt: ["base one", "base two", "MODE ON"] });

  const piEvent: SystemPromptEvent = { systemPrompt: "base", systemPromptOptions: { appendSystemPrompt: "existing" } };
  expect(injectPromptText(piHost().pi, piEvent, "MODE ON")).toBeUndefined();
  expect(piEvent.systemPromptOptions?.appendSystemPrompt).toBe("existing\n\nMODE ON");

  const bare = { systemPrompt: "" } as SystemPromptEvent;
  injectPromptText(piHost().pi, bare, "MODE ON");
  expect(bare.systemPromptOptions?.appendSystemPrompt).toBeUndefined();
});

test("stringArrayToolParams speaks zod on OMP and JSON Schema on pi", () => {
  const spec = { minItems: 1, description: "Arguments passed to rtk" };
  const ompParams = stringArrayToolParams(ompHost().pi, "args", spec) as { kind: string; shape: Record<string, { kind: string }> };
  expect(ompParams.kind, "OMP needs a zod schema").toBe("object");
  expect(ompParams.shape.args.kind, "the zod chain keeps min() and describe()").toBe("array.min(1).describe(Arguments passed to rtk)");

  expect(stringArrayToolParams(piHost().pi, "args", spec)).toEqual({
    type: "object",
    properties: { args: { type: "array", items: { type: "string" }, minItems: 1, description: "Arguments passed to rtk" } },
    required: ["args"],
  });
});

test("themeStatus colors on OMP and stays plain on pi", () => {
  const themed = { theme: { fg: (role: string, text: string) => `<${role}>${text}</>` } };
  expect(themeStatus(themed, "⚡", "rtk: ON", true)).toBe("<accent>⚡</> <muted>rtk: ON</>");
  expect(themeStatus({ theme: undefined }, "⚡", "rtk: ON", true), "pi has no ctx.ui.theme").toBe("⚡ rtk: ON");
  expect(themeStatus(undefined, "⚡", "rtk: ON")).toBe("⚡ rtk: ON");
});

test("the pi event context carries what the adapters read", () => {
  const ctx = { hasUI: false, cwd: "/tmp", sessionManager: { getBranch: () => [] } } as unknown as ExtensionCtx;
  expect(ctx.hasUI).toBe(false);
  expect(themeStatus(ctx.ui, "x", "y")).toBe("x y");
});
