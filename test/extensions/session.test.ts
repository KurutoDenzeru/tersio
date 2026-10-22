import { afterEach, expect, test } from "vitest";
import fs, { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path, { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import cavemanSessionExtension from "../../extensions/caveman/index.ts";
import comboToggleExtension from "../../extensions/combo/index.ts";
import tersioCommandsExtension from "../../extensions/commands/index.ts";
import rtkSessionExtension from "../../extensions/rtk/session.ts";
import plugin from "../../extensions/server.ts";
import {
  hostSelect,
  injectPromptText,
  isPiHost,
  onHostEvent,
  setExtensionLabel,
  stringArrayToolParams,
} from "../../extensions/shared/host.ts";
import {
  OMP_SUBAGENT_MARKER,
  getSharedComboState,
  isOmpSubagentPrompt,
  resetSharedComboState,
  setSharedComboListener,
  setSharedComboMode,
} from "../../extensions/shared/session-state.ts";
import { formatStatus } from "../../extensions/shared/status.ts";
import type { ExtensionApi, ExtensionCtx, SessionEntry, SystemPromptEvent } from "../../extensions/shared/types.ts";
import { fakeRtkBin, withHome as inHome } from "../helpers/env.ts";

// ponytail: hermetic HOME — session-start fallbacks read the real lock file, so the suite must not use it.
// fileURLToPath, not `.pathname`: a URL pathname on Windows is `/D:/...`, which path.join turns into `D:\D:\...`.
process.env.HOME = fileURLToPath(new URL("../definitely-missing-home/session", import.meta.url));
process.env.USERPROFILE = process.env.HOME;
// The bare fixture is HOME to a dozen siblings, so TERSIO_HOME must sit under it: afterEach deletes it.
process.env.TERSIO_HOME = join(process.env.HOME, ".tersio");

/** The repo root, so a rule body can be read from the file the extension reads. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Windows opens a browser through cmd.exe, not a `start` executable.
const IS_WINDOWS = process.platform === "win32";

// The bash rewrite shells out to the rtk on PATH, so each test owns PATH and HOME.
// The Windows form is a `.cmd` shim, because CreateProcess runs no bare script.
async function withFakeRtk(script: string | null, cmdScript: string, work: () => Promise<void>): Promise<void> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-oc-rtk-"));
  const previous = { PATH: process.env.PATH, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  try {
    const bin = path.join(dir, "bin");
    mkdirSync(bin, { recursive: true });
    if (script !== null) {
      const body = script.replace(/^#!\/bin\/sh\n/, "");
      fakeRtkBin(bin, body.split("\n"), cmdScript);
    }
    process.env.PATH = bin;
    process.env.HOME = dir;
    process.env.USERPROFILE = dir;
    await work();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

function fakeCtx(): {
  ctx: unknown;
  hooks: Record<string, Array<(event: never) => unknown>>;
  commands: Map<string, { execute: (input: never) => Promise<void> }>;
  prompts: Array<{ sessionID: string; text: string }>;
  store: Map<string, unknown>;
  skills: Array<{ id: string; name: string; description: string; path: string; content: string }>;
} {
  const hooks: Record<string, Array<(event: never) => unknown>> = {};
  const commands = new Map<string, { execute: (input: never) => Promise<void> }>();
  const prompts: Array<{ sessionID: string; text: string }> = [];
  const store = new Map<string, unknown>();
  const skills: Array<{ id: string }> = [];
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
    skill: {
      transform: async (fn: (editor: { add: (skill: never) => void }) => void): Promise<void> => {
        fn({ add: (skill: never) => skills.push(skill as never) });
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
  return { ctx, hooks, commands, prompts, store, skills };
}

async function fire(hooks: Record<string, Array<(event: never) => unknown>>, name: string, event: unknown): Promise<void> {
  for (const fn of hooks[name] ?? []) await fn(event as never);
}

// The fake host implements only what the mode extensions touch, so it cannot wear the real Context type.
function setup(ctx: unknown): Promise<void> {
  return (plugin as unknown as { setup(c: unknown): Promise<void> }).setup(ctx);
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

// A plugin dir gets no node_modules walk, so the ruleset ships beside the entry and must be found from there.
test("the opencode entry registers the bundled ponytail skills", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-oc-skills-"));
  const prevHome = process.env.TERSIO_HOME;
  try {
    process.env.TERSIO_HOME = path.join(home, ".tersio");
    mkdirSync(process.env.TERSIO_HOME, { recursive: true });
    // The installer writes this beside the entry; the test seeds it where the entry resolves it from.
    const bundle = path.join(root, "extensions", "ponytail-bundle", "skills");
    mkdirSync(bundle, { recursive: true });
    const names = ["ponytail", "ponytail-audit", "ponytail-debt", "ponytail-gain", "ponytail-help", "ponytail-review"];
    for (const name of names) {
      mkdirSync(path.join(bundle, name), { recursive: true });
      writeFileSync(
        path.join(bundle, name, "SKILL.md"),
        `---\nname: ${name}\ndescription: >\n  A bundled skill for the ${name} command.\n  Wrapped the way upstream writes it.\n---\n\nBODY FOR ${name}.\n`,
        "utf8",
      );
    }
    const { ctx, skills } = fakeCtx();
    await setup(ctx);

    expect(skills.map((skill) => skill.id).sort()).toEqual([...names].sort());
    for (const skill of skills) {
      // A folded description that leaked its marker or newline reads to the model as a truncated one.
      expect(skill.description, `${skill.id} description is one line`).not.toMatch(/[\n>]/);
      expect(skill.description, `${skill.id} description is non-empty`).toContain("bundled skill");
      expect(skill.content, `${skill.id} carries its body`).toContain(`BODY FOR ${skill.id}`);
    }
  } finally {
    rmSync(path.join(root, "extensions", "ponytail-bundle"), { recursive: true, force: true });
    if (prevHome === undefined) delete process.env.TERSIO_HOME;
    else process.env.TERSIO_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  }
});

// Unseen session IDs restore their own entries, or fall back to the default.
test("opencode sessions restore modes independently", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-oc-home-"));
  const prevHome = process.env.TERSIO_HOME;
  try {
    process.env.TERSIO_HOME = path.join(home, ".tersio");
    mkdirSync(process.env.TERSIO_HOME, { recursive: true });
    writeFileSync(
      path.join(process.env.TERSIO_HOME, "settings.json"),
      JSON.stringify({ comboDefault: "balanced", cavemanDefault: "full", rtkDefault: true, ponytailDefault: "full", pstackDefault: "on" }),
      "utf8",
    );
    const { ctx, hooks, commands, prompts, store } = fakeCtx();
    await setup(ctx);

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

// rtk ships an OpenCode plugin of its own. Tersio does the rewrite here instead, so the host loads one plugin.
test("the bash hook rewrites a command through the resolved rtk binary", async () => {
  await withFakeRtk("#!/bin/sh\nprintf '{\"command\":\"rtk compact %s\"}\\n' \"$3\"\n", "echo {\"command\":\"rtk compact %~3\"}", async () => {
    const { ctx, hooks, store } = fakeCtx();
    await setup(ctx);
    // The gate reads this entry, so state it rather than inherit a sibling test's default.
    store.set("entries:ses-on", [{ type: "custom", customType: "rtk-mode", data: { enabled: true } }]);
    const event = { tool: "bash", sessionID: "ses-on", input: { command: "git status" } };
    await fire(hooks, "execute.before", event);
    expect(event.input.command).toBe("rtk compact git status");
  });
});

// rtk's OpenCode hook answers {} when the rewrite would change what OpenCode's own permission rules
// decide, so a denied command stays denied. The hook must honour that answer.
test("the bash hook leaves a command alone when rtk's OpenCode hook refuses the rewrite", async () => {
  await withFakeRtk("#!/bin/sh\nprintf '{}\\n'\n", "echo {}", async () => {
    const { ctx, hooks, store } = fakeCtx();
    await setup(ctx);
    store.set("entries:ses-on", [{ type: "custom", customType: "rtk-mode", data: { enabled: true } }]);
    const event = { tool: "bash", sessionID: "ses-on", input: { command: "git push --force" } };
    await fire(hooks, "execute.before", event);
    expect(event.input.command).toBe("git push --force");
  });
});

// An rtk that predates the OpenCode hook answers nothing to it, and the plain rewrite still stands.
test("the bash hook falls back to the plain rewrite on an rtk without the OpenCode hook", async () => {
  const posix = "if [ \"$1\" = \"rewrite\" ]; then echo \"rtk plain $2\"; exit 0; fi\necho 'unknown subcommand: hook'\nexit 101";
  const windows = "if \"%~1\"==\"rewrite\" (echo rtk plain %~2 & exit /b 0)\necho unknown subcommand: hook\nexit /b 101";
  await withFakeRtk(`#!/bin/sh\n${posix}\n`, windows, async () => {
    const { ctx, hooks, store } = fakeCtx();
    await setup(ctx);
    store.set("entries:ses-on", [{ type: "custom", customType: "rtk-mode", data: { enabled: true } }]);
    const event = { tool: "bash", sessionID: "ses-on", input: { command: "git status" } };
    await fire(hooks, "execute.before", event);
    expect(event.input.command).toBe("rtk plain git status");
  });
});

// The after-hook is the only surface for built-in grep and glob output, and it must mutate in place.
test("the after hook condenses a large grep result and leaves the rest untouched", async () => {
  const big = `src/a.ts:1:${"a line of grep output \n".repeat(120)}`;
  await withFakeRtk("#!/bin/sh\necho '2 matches in 1F:'\n", "echo 2 matches in 1F:", async () => {
    const { ctx, hooks, store } = fakeCtx();
    await setup(ctx);
    store.set("entries:ses-on", [{ type: "custom", customType: "rtk-mode", data: { enabled: true } }]);
    store.set("entries:ses-off", [{ type: "custom", customType: "rtk-mode", data: { enabled: false } }]);

    const hit = { tool: "grep", status: "completed", sessionID: "ses-on", result: { content: [{ type: "text", text: big }] } };
    await fire(hooks, "execute.after", hit);
    // batch `echo` ends the line with CRLF, so the ending is normalized before the text is compared.
    const condensed = String((hit.result.content[0] as { text: string }).text).replace(/\r\n/g, "\n");
    expect(condensed).toBe("2 matches in 1F:\n");

    // An error carries no result, so there is nothing to replace.
    const failed = { tool: "grep", status: "error", sessionID: "ses-on", error: { message: "boom" } };
    await fire(hooks, "execute.after", failed);
    expect(failed).not.toHaveProperty("result");

    // A small result stays byte for byte: the spawn would cost more than it saves.
    const small = { tool: "grep", status: "completed", sessionID: "ses-on", result: { content: [{ type: "text", text: "one hit" }] } };
    await fire(hooks, "execute.after", small);
    expect(small.result.content).toEqual([{ type: "text", text: "one hit" }]);

    const other = { tool: "read", status: "completed", sessionID: "ses-on", result: { content: [{ type: "text", text: big }] } };
    await fire(hooks, "execute.after", other);
    expect(other.result.content).toEqual([{ type: "text", text: big }]);

    // A session with rtk off keeps its output, so the mode is per session.
    const off = { tool: "glob", status: "completed", sessionID: "ses-off", result: { content: [{ type: "text", text: big }] } };
    await fire(hooks, "execute.after", off);
    expect(off.result.content).toEqual([{ type: "text", text: big }]);
  });
});

test("the after hook keeps the original when rtk is absent", async () => {
  const big = "x".repeat(2000);
  await withFakeRtk(null, "", async () => {
    const { ctx, hooks, store } = fakeCtx();
    await setup(ctx);
    store.set("entries:ses-on", [{ type: "custom", customType: "rtk-mode", data: { enabled: true } }]);
    const event = { tool: "glob", status: "completed", sessionID: "ses-on", result: { content: [{ type: "text", text: big }] } };
    await fire(hooks, "execute.after", event);
    expect(event.result.content).toEqual([{ type: "text", text: big }]);
  });
});

test("the bash hook leaves other tools and rtk-less hosts alone", async () => {
  await withFakeRtk("#!/bin/sh\necho \"rtk compact $2\"\n", "echo rtk compact %~2", async () => {
    const { ctx, hooks } = fakeCtx();
    await setup(ctx);
    const other = { tool: "read", input: { command: "git status" } };
    await fire(hooks, "execute.before", other);
    expect(other.input.command).toBe("git status");
  });

  await withFakeRtk(null, "", async () => {
    const { ctx, hooks } = fakeCtx();
    await setup(ctx);
    const bash = { tool: "bash", input: { command: "git status" } };
    await fire(hooks, "execute.before", bash);
    expect(bash.input.command).toBe("git status");
  });
});

// OpenCode shares the omp extension code, so the mode bodies must land here too; nothing asserted it before.
test("the context hook injects the Caveman, Ponytail, and RTK bodies", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-oc-inject-"));
  const prevHome = process.env.TERSIO_HOME;
  try {
    process.env.TERSIO_HOME = path.join(home, ".tersio");
    mkdirSync(process.env.TERSIO_HOME, { recursive: true });
    writeFileSync(
      path.join(process.env.TERSIO_HOME, "settings.json"),
      JSON.stringify({ cavemanDefault: "full", ponytailDefault: "full", rtkDefault: true, comboDefault: "off" }),
      "utf8",
    );
    const { ctx, hooks } = fakeCtx();
    await setup(ctx);

    const event = { sessionID: "ses-inject", system: [{ type: "text", text: "BASE" }] };
    await fire(hooks, "context", event);
    const joined = event.system.map((part) => part.text).join("\n");

    // The Caveman body is the rule file itself, byte for byte, so it tracks upstream exactly.
    const rule = readFileSync(
      path.join(root, "extensions", "caveman", "rule.md"),
      "utf8",
    );
    expect(joined).toContain(rule);
    // Ponytail comes from the vendored copy, not from the built-in fallback.
    expect(joined).toMatch(/PONYTAIL MODE ACTIVE — level: full/);
    expect(joined).toMatch(/RTK guidance active/);
    // The base prompt is untouched and nothing is injected twice.
    expect(event.system[0].text).toBe("BASE");
    const occurrences = joined.split(rule).length - 1;
    expect(occurrences, "the rule body appears exactly once").toBe(1);
  } finally {
    if (prevHome === undefined) delete process.env.TERSIO_HOME;
    else process.env.TERSIO_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  }
});

// Ponytail is the one add-on the plugin does not own on pi: upstream's pi extension writes it.
test("the context hook skips Ponytail on a pi host and keeps the rest", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-oc-pi-"));
  const prevHome = process.env.TERSIO_HOME;
  const prevPi = process.env.PI_CODING_AGENT;
  const prevPiDir = process.env.PI_CODING_AGENT_DIR;
  try {
    process.env.TERSIO_HOME = path.join(home, ".tersio");
    mkdirSync(process.env.TERSIO_HOME, { recursive: true });
    writeFileSync(
      path.join(process.env.TERSIO_HOME, "settings.json"),
      JSON.stringify({ cavemanDefault: "full", ponytailDefault: "full", rtkDefault: true, comboDefault: "off" }),
      "utf8",
    );
    process.env.PI_CODING_AGENT = "true";
    // The skip needs the marker on disk, so pin the agent dir: reading the real one made this test pass only where an upstream extension happened to be installed.
    process.env.PI_CODING_AGENT_DIR = path.join(home, "pi-agent");
    mkdirSync(path.join(process.env.PI_CODING_AGENT_DIR, "ponytail", "pi-extension"), { recursive: true });
    writeFileSync(
      path.join(process.env.PI_CODING_AGENT_DIR, "ponytail", "pi-extension", "index.js"),
      "// upstream marker\n",
      "utf8",
    );
    const { ctx, hooks } = fakeCtx();
    await setup(ctx);

    const event = { sessionID: "ses-pi", system: [{ type: "text", text: "BASE" }] };
    await fire(hooks, "context", event);
    const joined = event.system.map((part) => part.text).join("\n");

    const rule = readFileSync(path.join(root, "extensions", "caveman", "rule.md"), "utf8");
    expect(joined).toContain(rule);
    expect(joined).toMatch(/RTK guidance active/);
    expect(joined).not.toMatch(/PONYTAIL MODE ACTIVE/);
  } finally {
    if (prevHome === undefined) delete process.env.TERSIO_HOME;
    else process.env.TERSIO_HOME = prevHome;
    if (prevPi === undefined) delete process.env.PI_CODING_AGENT;
    else process.env.PI_CODING_AGENT = prevPi;
    if (prevPiDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prevPiDir;
    rmSync(home, { recursive: true, force: true });
  }
});

// ponytail: hermetic HOME — session-start fallbacks read the real lock file. The bare fixture is HOME to a dozen siblings, so TERSIO_HOME sits under it and afterEach deletes it.

const MARKED_PROMPT = `System instructions.\n${OMP_SUBAGENT_MARKER}`;
const UNMARKED_PROMPT = "System instructions for an unrelated headless session.";

type CommandHandler = (args: string, ctx: TestCtx) => Promise<void>;
type EventHandler = (event: unknown, ctx: TestCtx | undefined) => Promise<unknown>;

interface TestPi {
  commands: Map<string, CommandHandler>;
  handlers: Map<string, EventHandler>;
  zod: { z: { object: (shape: Record<string, unknown>) => Record<string, unknown>; array: () => { min: () => TestChain; describe: () => TestChain }; string: () => TestChain } };
  setLabel(): void;
  registerCommand(name: string, config: { handler: CommandHandler }): void;
  registerTool(): void;
  on(event: string, handler: EventHandler): void;
  appendEntry(customType: string, data: Record<string, unknown>): void;
}

interface TestChain {
  min: () => TestChain;
  describe: () => TestChain;
}

interface TestCtx {
  hasUI: boolean;
  notifications: string[];
  sessionManager: { getBranch: () => SessionEntry[] };
  ui: {
    notify(message: string): void;
  };
  reload(): Promise<void>;
}

type TestExtension = (pi: ExtensionApi) => void;

function fakePi(sessionEntries: SessionEntry[] = []): TestPi {
  const commands = new Map<string, CommandHandler>();
  const handlers = new Map<string, EventHandler>();
  const chain: TestChain = { min: () => chain, describe: () => chain };
  const pi: TestPi = {
    commands,
    handlers,
    zod: { z: { object: (shape) => shape, array: () => chain, string: () => chain } },
    setLabel() { },
    registerCommand(name, config) { commands.set(name, config.handler); },
    registerTool() { },
    on(event, handler) { handlers.set(event, handler); },
    appendEntry(customType, data) { sessionEntries.push({ type: "custom", customType, data }); },
  };
  return pi;
}

function context(entries: SessionEntry[] = [], hasUI = false): TestCtx {
  const notifications: string[] = [];
  return {
    hasUI,
    notifications,
    sessionManager: { getBranch: () => entries },
    ui: {
      notify(message) { notifications.push(message); },
      setStatus(_n: string, v: string | undefined) { if (v !== undefined) notifications.push(v); },
    },
    async reload() { },
  };
}

function instantiate(factory: TestExtension, entries: SessionEntry[] = []): TestPi {
  const pi = fakePi(entries);
  factory(pi as unknown as ExtensionApi);
  return pi;
}

async function command(pi: TestPi, name: string, value: string, ctx: TestCtx): Promise<void> {
  await pi.commands.get(name)!(value, ctx);
}

async function inject(pi: TestPi, systemPrompt: string | string[], ctx?: TestCtx): Promise<{ systemPrompt?: string[] } | undefined> {
  return (await pi.handlers.get("before_agent_start")!({ systemPrompt }, ctx)) as { systemPrompt?: string[] } | undefined;
}

function instruction(result: { systemPrompt?: string[] } | undefined) {
  return result?.systemPrompt?.at(-1) || "";
}

/** The Ponytail body the vendored copy ships, read as `combo/index.ts` does. */
async function upstreamPonytail(level: string): Promise<string> {
  // The vendored copy sits beside the extensions, so the subpath is a plain path.
  const extensionDir = fileURLToPath(new URL("../../extensions/combo/index.ts", import.meta.url));
  const file = join(dirname(extensionDir), '..', 'ponytail', 'hooks', 'ponytail-instructions.js');
  expect(file, "the vendored ponytail copy carries its instruction builder").toBeTypeOf("string");
  const mod = (await import(pathToFileURL(file!).href)) as {
    getPonytailInstructions?: (l: string) => string;
    default?: { getPonytailInstructions?: (l: string) => string };
  };
  const build = mod.getPonytailInstructions ?? mod.default?.getPonytailInstructions;
  expect(build, "the vendored ponytail copy exports its instruction builder").toBeTypeOf("function");
  return build!(level);
}

// The last status line, filtered out from the other notify traffic.
function status(notifications: string[]): string {
  return notifications.filter((n) => n.startsWith("🧩 COMBO")).at(-1) || "";
}

test("parent Combo max is inherited by separately instantiated marked children", async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [];
  const parent = instantiate(comboToggleExtension, entries);
  await command(parent, "combo", "max", context(entries, true));
  const childCaveman = instantiate(cavemanSessionExtension);
  const childRtk = instantiate(rtkSessionExtension);
  const childCombo = instantiate(comboToggleExtension);

  expect(getSharedComboState()).toEqual({
    level: "max", caveman: "ultra", rtk: "on", ponytail: "ultra", pstack: "on",
  });
  expect(instruction(await inject(childCaveman, MARKED_PROMPT))).toMatch(/Caveman ultra active/);
  expect(instruction(await inject(childRtk, MARKED_PROMPT))).toMatch(/RTK guidance active/);

  const ponytail = instruction(await inject(childCombo, MARKED_PROMPT));
  expect(ponytail).toMatch(/# Ponytail/);
  expect(ponytail).toMatch(/PONYTAIL MODE ACTIVE — level: ultra/);
  expect(ponytail).toMatch(/root cause/i);
  // Compares against the vendored copy, not quoted words: v5 reworded the ladder and dropped "YAGNI".
  expect(ponytail.startsWith(await upstreamPonytail("ultra"))).toBe(true);
});

test("lite maps to Caveman lite, RTK on, and Ponytail lite", async () => {
  resetSharedComboState();
  const parent = instantiate(comboToggleExtension);
  await command(parent, "combo", "lite", context([], true));
  const prompt = ["System instructions.", OMP_SUBAGENT_MARKER];

  expect(getSharedComboState()).toEqual({
    level: "lite", caveman: "lite", rtk: "on", ponytail: "lite", pstack: "on",
  });
  expect(instruction(await inject(instantiate(cavemanSessionExtension), prompt))).toMatch(/Caveman lite active/);
  expect(instruction(await inject(instantiate(rtkSessionExtension), prompt))).toMatch(/RTK guidance active/);
  expect(instruction(await inject(instantiate(comboToggleExtension), prompt))).toMatch(/PONYTAIL MODE ACTIVE — level: lite/);
});

test("Combo off gives marked children no inherited guidance", async () => {
  resetSharedComboState();
  const parent = instantiate(comboToggleExtension);
  const ctx = context([], true);
  await command(parent, "combo", "max", ctx);
  await command(parent, "combo", "off", ctx);

  expect(getSharedComboState()).toEqual({
    level: "off", caveman: "off", rtk: "off", ponytail: "off", pstack: "off",
  });
  for (const factory of [cavemanSessionExtension, rtkSessionExtension, comboToggleExtension]) {
    expect(await inject(instantiate(factory), MARKED_PROMPT)).toBe(undefined);
  }
});

test("an unmarked headless prompt does not make caveman or rtk inherit", async () => {
  resetSharedComboState();
  const parent = instantiate(comboToggleExtension);
  await command(parent, "combo", "max", context([], true));

  // Caveman and rtk stay gated on the marker, so an unmarked prompt inherits nothing.
  for (const factory of [cavemanSessionExtension, rtkSessionExtension]) {
    const child = instantiate(factory);
    await child.handlers.get("session_start")?.({}, context([], false));
    expect(await inject(child, UNMARKED_PROMPT)).toBe(undefined);
  }
});

// A worker's session_start carries no Tersio entries; reconciling that wiped shared state.
test("a worker's empty session_start leaves the parent's modes inherited", async () => {
  resetSharedComboState();
  const parent = instantiate(comboToggleExtension);
  await command(parent, "combo", "max", context([], true));

  for (const [factory, expected] of [
    [cavemanSessionExtension, /Caveman ultra active/],
    [rtkSessionExtension, /RTK guidance active/],
    [comboToggleExtension, /PONYTAIL MODE ACTIVE/],
  ] as const) {
    const worker = instantiate(factory);
    await worker.handlers.get("session_start")?.({}, context([], false));
    expect(getSharedComboState().level, "shared state survives the worker's session_start").toBe("max");
    expect(instruction(await inject(worker, MARKED_PROMPT)), "worker inherits").toMatch(expected);
  }
});

test("headless child session_start cannot reset the parent bridge", async () => {
  resetSharedComboState();
  const parent = instantiate(comboToggleExtension);
  await command(parent, "combo", "max", context([], true));
  const childCombo = instantiate(comboToggleExtension);

  await childCombo.handlers.get("session_start")!({}, context([], false));

  expect(getSharedComboState().level).toBe("max");
  expect(instruction(await inject(childCombo, MARKED_PROMPT))).toMatch(/level: ultra/);
});

test("interactive top-level session_start with no entries resets bridge off", async () => {
  resetSharedComboState();
  const parent = instantiate(comboToggleExtension);
  await command(parent, "combo", "max", context([], true));
  const nextSession = instantiate(comboToggleExtension);

  await nextSession.handlers.get("session_start")!({}, context([], true));

  expect(getSharedComboState().level).toBe("off");
  for (const factory of [cavemanSessionExtension, rtkSessionExtension, comboToggleExtension]) {
    expect(await inject(instantiate(factory), MARKED_PROMPT)).toBe(undefined);
  }
});

test("individual Caveman change immediately makes Combo CUSTOM and children inherit actual mix", async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [];
  const combo = instantiate(comboToggleExtension, entries);
  const comboCtx = context(entries, true);
  await command(combo, "combo", "max", comboCtx);
  const caveman = instantiate(cavemanSessionExtension, entries);

  await command(caveman, "caveman", "lite", context(entries, true));

  expect(getSharedComboState()).toEqual({
    level: "custom", caveman: "lite", rtk: "on", ponytail: "ultra", pstack: "on",
  });
  expect(status(comboCtx.notifications)).toBe("🧩 COMBO CUSTOM: 🪨 caveman=LITE | 🗜️ rtk=ON | 🧠 ponytail=ULTRA | 🥔 pstack=ON");
  expect(instruction(await inject(instantiate(cavemanSessionExtension), MARKED_PROMPT))).toMatch(/Caveman lite active/);
  expect(instruction(await inject(instantiate(rtkSessionExtension), MARKED_PROMPT))).toMatch(/RTK guidance active/);
  expect(instruction(await inject(instantiate(comboToggleExtension), MARKED_PROMPT))).toMatch(/level: ultra/);

  await command(caveman, "caveman", "ultra", context(entries, true));
  expect(getSharedComboState().level).toBe("max");
  expect(status(comboCtx.notifications)).toBe("🧩 COMBO MAX: 🪨 caveman=ULTRA | 🗜️ rtk=ON | 🧠 ponytail=ULTRA | 🥔 pstack=ON");
});

test("individual RTK change returns Combo to its preset when values realign", async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [];
  const combo = instantiate(comboToggleExtension, entries);
  const comboCtx = context(entries, true);
  await command(combo, "combo", "max", comboCtx);
  const rtk = instantiate(rtkSessionExtension, entries);

  await command(rtk, "rtk", "off", context(entries, true));

  expect(getSharedComboState()).toEqual({
    level: "custom", caveman: "ultra", rtk: "off", ponytail: "ultra", pstack: "on",
  });
  expect(status(comboCtx.notifications)).toBe("🧩 COMBO CUSTOM: 🪨 caveman=ULTRA | 🗜️ rtk=OFF | 🧠 ponytail=ULTRA | 🥔 pstack=ON");
  expect(await inject(instantiate(rtkSessionExtension), MARKED_PROMPT)).toBe(undefined);

  await command(rtk, "rtk", "on", context(entries, true));
  expect(getSharedComboState().level).toBe("max");
  expect(status(comboCtx.notifications)).toBe("🧩 COMBO MAX: 🪨 caveman=ULTRA | 🗜️ rtk=ON | 🧠 ponytail=ULTRA | 🥔 pstack=ON");
});

test("individually matching preset values activates Combo", async () => {
  resetSharedComboState();
  const entries = [
    { type: "custom", customType: "caveman-mode", data: { mode: "ultra" } },
    { type: "custom", customType: "ponytail-mode", data: { mode: "ultra" } },
    { type: "custom", customType: "pstack-mode", data: { mode: "on" } },
  ];
  const combo = instantiate(comboToggleExtension, entries);
  const comboCtx = context(entries, true);
  const rtk = instantiate(rtkSessionExtension, entries);

  await command(combo, "combo", "status", comboCtx);
  await command(rtk, "rtk", "on", context(entries, true));
  expect(getSharedComboState()).toEqual({
    level: "max", caveman: "ultra", rtk: "on", ponytail: "ultra", pstack: "on",
  });
  expect(status(comboCtx.notifications)).toBe("🧩 COMBO MAX: 🪨 caveman=ULTRA | 🗜️ rtk=ON | 🧠 ponytail=ULTRA | 🥔 pstack=ON");
});

test("Combo status restores the preset indicator when persisted modes realign", async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [];
  const combo = instantiate(comboToggleExtension, entries);
  const ctx = context(entries, true);
  await command(combo, "combo", "max", ctx);
  entries.push({ type: "custom", customType: "ponytail-mode", data: { mode: "lite" } });

  await command(combo, "combo", "status", ctx);

  expect(getSharedComboState()).toEqual({
    level: "custom", caveman: "ultra", rtk: "on", ponytail: "lite", pstack: "on",
  });
  expect(status(ctx.notifications)).toBe("🧩 COMBO CUSTOM: 🪨 caveman=ULTRA | 🗜️ rtk=ON | 🧠 ponytail=LITE | 🥔 pstack=ON");
  expect(instruction(await inject(instantiate(comboToggleExtension), MARKED_PROMPT))).toMatch(/level: lite/);

  entries.push({ type: "custom", customType: "ponytail-mode", data: { mode: "ultra" } });
  await command(combo, "combo", "status", ctx);
  expect(getSharedComboState()).toEqual({
    level: "max", caveman: "ultra", rtk: "on", ponytail: "ultra", pstack: "on",
  });
  expect(status(ctx.notifications)).toBe("🧩 COMBO MAX: 🪨 caveman=ULTRA | 🗜️ rtk=ON | 🧠 ponytail=ULTRA | 🥔 pstack=ON");
});

test("redundant trailing entries do not drop a matching preset (#21)", async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [];
  const combo = instantiate(comboToggleExtension, entries);
  const ctx = context(entries, true);
  await command(combo, "combo", "max", ctx);
  // Entry replay on resume: same values appended after combo-level, so the preset must survive.
  entries.push({ type: "custom", customType: "ponytail-mode", data: { mode: "ultra" } });
  entries.push({ type: "custom", customType: "caveman-mode", data: { mode: "ultra" } });
  entries.push({ type: "custom", customType: "rtk-mode", data: { enabled: true } });
  await command(combo, "combo", "status", ctx);
  expect(getSharedComboState()).toEqual({
    level: "max", caveman: "ultra", rtk: "on", ponytail: "ultra", pstack: "on",
  });
  expect(status(ctx.notifications)).toBe("🧩 COMBO MAX: 🪨 caveman=ULTRA | 🗜️ rtk=ON | 🧠 ponytail=ULTRA | 🥔 pstack=ON");
  resetSharedComboState();
});

test("mode commands confirm the session-wide active set", async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [];
  const combo = instantiate(comboToggleExtension, entries);
  const ctx = context(entries, true);
  await command(combo, "combo", "max", ctx);
  expect(status(ctx.notifications)).toBe("🧩 COMBO MAX: 🪨 caveman=ULTRA | 🗜️ rtk=ON | 🧠 ponytail=ULTRA | 🥔 pstack=ON");
  const caveman = instantiate(cavemanSessionExtension, entries);
  const cavemanCtx = context(entries, true);
  await command(caveman, "caveman", "full", cavemanCtx);
  expect(status(cavemanCtx.notifications)).toBe("🧩 COMBO CUSTOM: 🪨 caveman=FULL | 🗜️ rtk=ON | 🧠 ponytail=ULTRA | 🥔 pstack=ON");
  const rtk = instantiate(rtkSessionExtension, entries);
  const rtkCtx = context(entries, true);
  await command(rtk, "rtk", "off", rtkCtx);
  expect(status(rtkCtx.notifications)).toBe("🧩 COMBO CUSTOM: 🪨 caveman=FULL | 🗜️ rtk=OFF | 🧠 ponytail=ULTRA | 🥔 pstack=ON");
  resetSharedComboState();
});

test("Combo status names the preset, and a later mode entry moves it to CUSTOM", async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [];
  const combo = instantiate(comboToggleExtension, entries);
  const ctx = context(entries, true);

  await command(combo, "combo", "lite", ctx);
  expect(status(ctx.notifications)).toBe("🧩 COMBO LITE: 🪨 caveman=LITE | 🗜️ rtk=ON | 🧠 ponytail=LITE | 🥔 pstack=ON");

  entries.push({ type: "custom", customType: "ponytail-mode", data: { mode: "ultra" } });
  await command(combo, "combo", "status", ctx);
  expect(status(ctx.notifications)).toBe("🧩 COMBO CUSTOM: 🪨 caveman=LITE | 🗜️ rtk=ON | 🧠 ponytail=ULTRA | 🥔 pstack=ON");
});

test("Combo does not duplicate existing Ponytail guidance", async () => {
  resetSharedComboState();
  const parent = instantiate(comboToggleExtension);
  await command(parent, "combo", "lite", context([], true));
  const prompt = [OMP_SUBAGENT_MARKER, "PONYTAIL MODE ACTIVE — level: lite"];

  expect(await inject(instantiate(comboToggleExtension), prompt)).toBe(undefined);
});

test("caveman restores mode from session_branch instead of using stale in-memory state", async () => {
  const pi = instantiate(cavemanSessionExtension);
  await pi.handlers.get("session_start")!(
    {},
    context([{ type: "custom", customType: "caveman-mode", data: { mode: "full" } }], true)
  );

  await pi.handlers.get("session_branch")!(
    {},
    context([{ type: "custom", customType: "caveman-mode", data: { mode: "off" } }], true)
  );

  expect(await inject(pi, UNMARKED_PROMPT)).toBe(undefined);
});

test("rtk restores enabled state from session_branch instead of using stale in-memory state", async () => {
  const pi = instantiate(rtkSessionExtension);
  await pi.handlers.get("session_start")!(
    {},
    context([{ type: "custom", customType: "rtk-mode", data: { enabled: true } }], true)
  );

  await pi.handlers.get("session_branch")!(
    {},
    context([{ type: "custom", customType: "rtk-mode", data: { enabled: false } }], true)
  );

  expect(await inject(pi, UNMARKED_PROMPT)).toBe(undefined);
});


// The literal prompt read out of the installed omp binary; MARKED_PROMPT would not catch the marker drifting.
const REAL_OMP_SUBAGENT_PROMPT = `Worker agent: delegated tasks.

Tools: FULL access (edit, write, bash, grep, read, etc.); MUST use as needed to complete task.
MUST hyperfocus assigned task; NEVER deviate.`;

test("the default marker matches the prompt omp actually sends", () => {
  expect(OMP_SUBAGENT_MARKER).toBe("Worker agent: delegated tasks.");
  expect(isOmpSubagentPrompt(REAL_OMP_SUBAGENT_PROMPT)).toBe(true);
});

test("caveman and rtk reach a subagent on the real omp prompt", async () => {
  resetSharedComboState();
  const parent = instantiate(comboToggleExtension);
  await command(parent, "combo", "max", context([], true));

  // A subagent starts with flags off, so this passes only on a recognised prompt plus shared state.
  expect(instruction(await inject(instantiate(cavemanSessionExtension), REAL_OMP_SUBAGENT_PROMPT)))
    .toMatch(/Caveman ultra active/);
  expect(instruction(await inject(instantiate(rtkSessionExtension), REAL_OMP_SUBAGENT_PROMPT)))
    .toMatch(/RTK guidance active/);
});

test("only the omp host is told about the rtk proxy daemon", async () => {
  resetSharedComboState();
  const parent = instantiate(comboToggleExtension);
  await command(parent, "combo", "max", context([], true));

  // The proxy daemon can only carry omp's model traffic, so only omp hears about it.
  expect(instruction(await inject(instantiate(rtkSessionExtension), MARKED_PROMPT))).toMatch(/rtk llm-proxy setup/);

  const piHost = instantiate(rtkSessionExtension) as TestPi & { hostId?: string };
  piHost.hostId = "pi";
  const piResult = (await piHost.handlers.get("before_agent_start")!({ systemPrompt: MARKED_PROMPT }, undefined)) as { systemPrompt?: unknown };
  const piText = typeof piResult?.systemPrompt === "string" ? piResult.systemPrompt : "";
  expect(piText).toMatch(/RTK guidance active/);
  expect(piText).not.toMatch(/llm-proxy/);
});

test("a parent session is not mistaken for a subagent", async () => {
  resetSharedComboState();
  const parent = instantiate(comboToggleExtension);
  await command(parent, "combo", "max", context([], true));

  // Unmarked, so each extension falls back to its own off-by-default flag.
  expect(await inject(instantiate(cavemanSessionExtension), "Regular parent session.")).toBe(undefined);
  expect(await inject(instantiate(rtkSessionExtension), "Regular parent session.")).toBe(undefined);
});

// The store is $TERSIO_HOME itself; os.homedir() ignores HOME.
const TERSIO_DIR = process.env.TERSIO_HOME as string;

// Caveman's block is ours, so a level switch replaces it rather than stacking.
test("a caveman level switch removes the previous level's block", async () => {
  resetSharedComboState();
  const parent = instantiate(comboToggleExtension);
  await command(parent, "combo", "max", context([], true));
  const child = instantiate(cavemanSessionExtension);

  setSharedComboMode("caveman", "lite");
  const first = (await inject(child, "Base."))?.systemPrompt ?? [];

  setSharedComboMode("caveman", "ultra");
  const joined = ((await inject(child, first))?.systemPrompt ?? []).join("\n");

  expect(joined).toMatch(/Caveman ultra active/);
  expect(joined).not.toMatch(/Caveman lite active/);
});

function writeSettings(value: unknown): void {
  mkdirSync(TERSIO_DIR, { recursive: true });
  writeFileSync(join(TERSIO_DIR, "settings.json"), JSON.stringify(value), "utf8");
}

afterEach(() => rmSync(TERSIO_DIR, { recursive: true, force: true }));

test("settings.json overrides the marker when OMP rewords its prompt", async () => {
  writeSettings({ subagentMarkers: ["You are a delegated worker."] });
  resetSharedComboState();
  const parent = instantiate(comboToggleExtension);
  await command(parent, "combo", "max", context([], true));

  // The stale default no longer matches; the configured marker does.
  expect(instruction(await inject(instantiate(cavemanSessionExtension), OMP_SUBAGENT_MARKER))).toBe("");
  expect(instruction(await inject(instantiate(cavemanSessionExtension), "You are a delegated worker.")))
    .toMatch(/Caveman ultra active/);
});

test("a malformed marker setting falls back to the default", () => {
  writeSettings({ subagentMarkers: "not an array" });
  expect(isOmpSubagentPrompt(OMP_SUBAGENT_MARKER)).toBe(true);

  writeSettings({ subagentMarkers: ["", 42, null] });
  expect(isOmpSubagentPrompt(OMP_SUBAGENT_MARKER)).toBe(true);
});

test("caveman and rtk do not re-inject into a prompt that already carries them", async () => {
  resetSharedComboState();
  const parent = instantiate(comboToggleExtension);
  await command(parent, "combo", "lite", context([], true));

  for (const [factory, expected] of [
    [cavemanSessionExtension, /Caveman lite active/],
    [rtkSessionExtension, /RTK guidance active/],
  ] as const) {
    const pi = instantiate(factory);
    const first = instruction(await inject(pi, MARKED_PROMPT));
    expect(first).toMatch(expected);

    // A host that re-presents the mutated prompt must not get a second copy.
    const carried = ["System instructions.", OMP_SUBAGENT_MARKER, first];
    expect(await inject(pi, carried)).toBe(undefined);
  }
});

// No-reload sync: /combo and /tersio switch modes without reloading; sibling mirrors stay in step.


// Hermetic HOME + usage file: combo falls back to lock-file defaults and the router writes the temp ledger.
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
    ui: { notify: (m: string) => { notifications.push(m); }, setStatus: (_n: string, v: string | undefined) => { if (v !== undefined) notifications.push(v); } },
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
  expect(notifications.filter((n) => n.startsWith("🧩 COMBO"))).toContain(
    "🧩 COMBO MAX: 🪨 caveman=ULTRA | 🗜️ rtk=ON | 🧠 ponytail=ULTRA | 🥔 pstack=ON",
  );
  const cave = (await caveman.handlers.get("before_agent_start")!(MAIN_PROMPT, ctx)) as { systemPrompt: string[] };
  expect(cave.systemPrompt.join("\n")).toMatch(/Caveman ultra/);
  const rtkOut = (await rtk.handlers.get("before_agent_start")!(MAIN_PROMPT, ctx)) as { systemPrompt: string[] };
  expect(rtkOut.systemPrompt.join("\n")).toMatch(/RTK guidance active/);
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

// Additive listeners grew per session; the bridge is keyed now.



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

type handlerReturnsHandler = (args: string, ctx: unknown) => Promise<unknown>;

const loadExtension = async (segments: readonly string[]) => {
  const url = new URL(`file:///${path.join(root, "extensions", ...segments).replace(/\\/g, "/")}`);
  return (await import(url.href)).default as (pi: FakePi) => void;
};

// Every extension entry point, each registering exactly one command.
const EXTENSIONS = [["caveman", "index.ts"], ["pstack", "index.ts"], ["combo", "index.ts"], ["rtk", "session.ts"], ["commands", "index.ts"], ["updater", "index.ts"]] as const;

interface FakePi {
  commands: Map<string, handlerReturnsHandler>;
  registerCommand(name: string, config: { handler: handlerReturnsHandler }): void;
  registerTool(): void;
  registerShortcut(): void;
  registerFlag(): void;
  setLabel(): void;
  on(): void;
  exec(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }>;
  appendEntry(customType: string, data: Record<string, unknown>): void;
  cwd: string;
  env: NodeJS.ProcessEnv;
  ui: { notify(): void; select(): Promise<undefined> };
  events: { on(): void; emit(): void };
}

const createPi = (): FakePi => {
  const commands = new Map<string, handlerReturnsHandler>();
  const noop = (): void => {};
  return {
    commands,
    registerCommand(name, config) { commands.set(name, config.handler); },
    registerTool: noop,
    registerShortcut: noop,
    registerFlag: noop,
    setLabel: noop,
    on: noop as () => void,
    exec: async () => ({ stdout: "", stderr: "", code: 0 }),
    appendEntry: noop as (customType: string, data: Record<string, unknown>) => void,
    cwd: root,
    env: { ...process.env },
    ui: { notify: noop, select: async () => undefined },
    events: { on: noop as () => void, emit: noop as () => void },
  };
};

const ctx = { hasUI: false, ui: { notify: (): void => {} }, cwd: root, sessionManager: { getBranch: () => [] } };

// A resolved value starts a model turn, so a handler that already printed everything must resolve undefined.
test("no tersio command handler resolves a value", async () => {
  const seen: string[] = [];
  for (const name of EXTENSIONS) {
    const install = await loadExtension(name);
    const pi = createPi();
    install(pi);
    // Without this the loop below would pass vacuously for an extension that registered nothing.
    expect(pi.commands.size, `${name} must register at least one command`).toBeGreaterThan(0);
    for (const [command, handler] of pi.commands) {
      expect(await handler("", ctx), `/${command} in ${name} must resolve undefined`).toBeUndefined();
      seen.push(`/${command}`);
    }
  }
  // The mode switches the tree owns, so a dropped registration fails here rather than passing quietly.
  for (const command of ["/caveman", "/pstack", "/rtk", "/combo", "/ponytail", "/tersio", "/ai-addons"]) {
    expect(seen, `${command} must be registered`).toContain(command);
  }
});

// Cancelling must not roll the modes back, so every session entry is written before the status line goes out.
test("a combo change is persisted before the host is told about it", async () => {
  const install = await loadExtension(["combo", "index.ts"]);
  const pi = createPi();
  const order: string[] = [];
  pi.appendEntry = (customType: string) => { order.push(`entry:${customType}`); };
  pi.ui = { ...pi.ui, notify: (message: string) => { order.push(`notify:${message}`); }, setStatus: (_n: string, v?: string) => { if (v !== undefined) order.push(`setstatus:${v}`); } } as unknown as typeof pi.ui;
  install(pi);

  await pi.commands.get("combo")?.("balanced", { ...ctx, hasUI: true, ui: pi.ui });

  // Every mode entry lands first, in the preset's own order.
  expect(order.slice(0, 5)).toEqual([
    "entry:caveman-mode",
    "entry:rtk-mode",
    "entry:ponytail-mode",
    "entry:pstack-mode",
    "entry:combo-level",
  ]);
  const notices = order.slice(5);
  expect(notices).toEqual([
    "setstatus:🧩 COMBO BALANCED: 🪨 caveman=FULL | 🗜️ rtk=ON | 🧠 ponytail=FULL | 🥔 pstack=ON",
  ]);
});

// The six host differences, one test each; OMP is the pi fork that injects `pi.zod`, which is the detection.


function zodStub() {
  // zod chains keep the whole API after min()/describe(); the stub does too, so the adapter meets a faithful shape.
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
    // pi's setLabel(entryId, label) marks a session entry, so it takes two arguments, not an extension name.
    setLabel: (entryId: string, label?: string) => { labels.push(`${entryId}:${label ?? ""}`); },
    on: (event: string) => { events.push(event); },
  } as unknown as ExtensionApi;
  return { pi, labels, events };
}

test("the host is read from the zod injection, and only OMP gets a label", () => {
  expect(isPiHost(ompHost().pi)).toBe(false);
  expect(isPiHost(piHost().pi)).toBe(true);

  const omp = ompHost();
  setExtensionLabel(omp.pi, "RTK session toggle");
  expect(omp.labels).toEqual(["RTK session toggle"]);

  const pi = piHost();
  setExtensionLabel(pi.pi, "RTK session toggle");
  expect(pi.labels, "pi's setLabel(entryId, label) would mark a session entry").toEqual([]);
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

test("a cancelled select comes back as undefined", async () => {
  const ui = { select: async () => undefined };
  expect(await hostSelect(piHost().pi, ui as never, "title", [{ label: "off" }])).toBeUndefined();
  expect(await hostSelect(ompHost().pi, undefined, "title", [{ label: "off" }])).toBeUndefined();
});

test("injectPromptText replaces the prompt on OMP and appends on pi", () => {
  const ompEvent: SystemPromptEvent = { systemPrompt: ["base one", "base two"] };
  expect(injectPromptText(ompHost().pi, ompEvent, { text: "MODE ON" })).toEqual({ systemPrompt: ["base one", "base two", "MODE ON"] });

  const piEvent: SystemPromptEvent = { systemPrompt: "base", systemPromptOptions: { appendSystemPrompt: "existing" } };
  expect(injectPromptText(piHost().pi, piEvent, { text: "MODE ON" })).toBeUndefined();
  expect(piEvent.systemPromptOptions?.appendSystemPrompt).toBe("existing\n\nMODE ON");

  const bare = { systemPrompt: "" } as SystemPromptEvent;
  injectPromptText(piHost().pi, bare, { text: "MODE ON" });
  expect(bare.systemPromptOptions?.appendSystemPrompt).toBeUndefined();
});

test("a hole in an OMP prompt array does not crash the injector", () => {
  // OMP has shipped an array with a non-string in it; `part.includes` on undefined killed the extension.
  const holey = { systemPrompt: ["base", undefined, { text: "obj" }] } as unknown as SystemPromptEvent;
  expect(injectPromptText(ompHost().pi, holey, { text: "MODE ON" })).toEqual({ systemPrompt: ["base", "MODE ON"] });
  expect(injectPromptText(ompHost().pi, { systemPrompt: undefined } as unknown as SystemPromptEvent, { text: "MODE ON" }))
    .toEqual({ systemPrompt: ["MODE ON"] });
});

test("a tagged block owns its pi section instead of replacing the whole prompt", () => {
  const sections: Record<string, string> = { preamble: "base" };
  const event: SystemPromptEvent = { systemPrompt: "base", systemPromptOptions: { appendSystemPrompt: "", sections } };

  // A section-aware host mutates in place, so nothing is returned and the prompt is untouched.
  expect(injectPromptText(piHost().pi, event, { text: "RULES ONE", sectionTag: "caveman" })).toBeUndefined();
  expect(sections).toEqual({ preamble: "base", caveman: "RULES ONE" });
  expect(event.systemPromptOptions?.appendSystemPrompt, "the append slot is left alone").toBe("");

  // The same tag is replaced in place, so a level switch cannot stack two blocks.
  injectPromptText(piHost().pi, event, { text: "RULES TWO", sectionTag: "caveman" });
  expect(sections.caveman).toBe("RULES TWO");
  expect(Object.keys(sections).filter((name) => name === "caveman")).toHaveLength(1);

  // Without a tag the block still lands, in the append slot.
  injectPromptText(piHost().pi, event, { text: "UNTAGGED" });
  expect(sections.caveman).toBe("RULES TWO");
  expect(event.systemPromptOptions?.appendSystemPrompt).toBe("UNTAGGED");
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

type restoreEventHandler = (event: unknown, ctx: ExtensionCtx | undefined) => Promise<unknown>;

function harness(_entries: SessionEntry[]): { handlers: Map<string, restoreEventHandler>; notifications: string[] } {
  const handlers = new Map<string, restoreEventHandler>();
  const notifications: string[] = [];
  const chain = { min: () => chain, describe: () => chain };
  rtkSessionExtension({
    setLabel() {},
    registerCommand() {},
    registerTool() {},
    appendEntry() {},
    on(event: string, handler: restoreEventHandler) { handlers.set(event, handler); },
    zod: { z: { object: (shape: Record<string, unknown>) => shape, array: () => chain, string: () => chain } },
  } as unknown as ExtensionApi);
  return { handlers, notifications };
}

function restoreContext(entries: SessionEntry[], notifications: string[]): ExtensionCtx {
  return {
    hasUI: true,
    sessionManager: { getBranch: () => entries },
    ui: {
            setStatus(name: string, v: string | undefined) { if (v !== undefined && name === 'tersio') notifications.push(v); },
      notify(message: string) { notifications.push(message); },
    },
  } as ExtensionCtx;
}

test("restore skips a corrupt latest rtk-mode entry and uses the older valid one", async () => {
  const entries: SessionEntry[] = [
    { type: "custom", customType: "rtk-mode", data: { enabled: true } },
    // Corrupt on purpose: the declared type is boolean, the stored value is not.
    { type: "custom", customType: "rtk-mode", data: { enabled: "maybe" as unknown as boolean } },
  ];
  const { handlers, notifications } = harness(entries);
  await handlers.get("session_start")!({}, restoreContext(entries, notifications));
  // The corrupt trailing entry is skipped, so the branch restores rtk=on.
  expect(notifications.at(-1)).toBe("🧩 COMBO CUSTOM: 🪨 caveman=OFF | 🗜️ rtk=ON | 🧠 ponytail=OFF | 🥔 pstack=OFF");
});

const withHome = (run: (home: string) => Promise<void>): Promise<void> =>
  inHome((home) => run(home).finally(() => resetSharedComboState()));

function firstRunHarness(selection: string | undefined, hasUI = true): { handlers: Map<string, (event: unknown, ctx: ExtensionCtx) => Promise<unknown>>; entries: SessionEntry[]; prompts: string[]; ctx: ExtensionCtx } {
  const handlers = new Map<string, (event: unknown, ctx: ExtensionCtx) => Promise<unknown>>();
  const entries: SessionEntry[] = [];
  const prompts: string[] = [];
  const pi = {
    // The injected zod is how the extensions recognise an OMP host.
    zod: { z: {} },
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
  return JSON.parse(readFileSync(path.join(home, ".tersio", "settings.json"), "utf8")) as Record<string, unknown>;
}

test("interactive OMP install selects and persists a Combo default", async () => {
  await withHome(async (home) => {
    const h = firstRunHarness("balanced");
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
    const h = firstRunHarness(undefined);
    await h.handlers.get("session_start")!({}, h.ctx);
    expect(readSettings(home)).toMatchObject({ comboDefault: "off", comboSetupComplete: true });
    await h.handlers.get("session_start")!({}, h.ctx);
    expect(h.prompts).toHaveLength(1);
  });
});

test("headless session_start leaves setup for the first interactive agent_start", async () => {
  await withHome(async (home) => {
    const h = firstRunHarness("balanced", false);
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
      JSON.stringify({ plugins: {}, settings: { "@krtclcdy/tersio": { comboDefault: "lite", comboSetupComplete: true } } }),
      "utf8",
    );
    const h = firstRunHarness("balanced");
    await h.handlers.get("session_start")!({}, h.ctx);
    expect(h.prompts).toHaveLength(0);
  });
});

test("a persisted Combo default applies to a new empty session", async () => {
  await withHome(async (home) => {
    mkdirSync(path.join(home, ".tersio"), { recursive: true });
    writeFileSync(path.join(home, ".tersio", "settings.json"), JSON.stringify({
      comboDefault: "balanced",
      comboSetupComplete: true,
      cavemanDefault: "full",
      rtkDefault: true,
      ponytailDefault: "full",
      pstackDefault: "on",
    }), "utf8");

    const h = firstRunHarness(undefined);
    await h.handlers.get("session_start")!({}, h.ctx);

    expect(h.prompts).toHaveLength(0);
    expect(h.entries.find((entry) => entry.customType === "combo-level")?.data?.level).toBe("balanced");

    h.ctx.sessionManager = { getBranch: () => [] };
    await h.handlers.get("before_agent_start")!({ systemPrompt: [] }, h.ctx);
    expect(getSharedComboState().level).toBe("balanced");
  });
});

test("a headless session still restores saved modes and injects the Ponytail block", async () => {
  // `host -p` has no UI, and a benchmark on omp measured Block 0 for every Ponytail level and for the Ponytail part of every Combo: Ponytail reads the shared bridge and only a UI session published to it.
  await withHome(async (home) => {
    mkdirSync(path.join(home, ".tersio"), { recursive: true });
    writeFileSync(path.join(home, ".tersio", "settings.json"), JSON.stringify({
      comboDefault: "off",
      comboSetupComplete: true,
      cavemanDefault: "off",
      rtkDefault: false,
      ponytailDefault: "full",
    }), "utf8");

    const h = firstRunHarness(undefined, false);
    await h.handlers.get("session_start")!({}, h.ctx);

    const result = await h.handlers.get("before_agent_start")!({ systemPrompt: [] }, h.ctx) as { systemPrompt: string[] };
    expect(result.systemPrompt.at(-1)).toMatch(/PONYTAIL MODE ACTIVE — level: full/);
  });
});

test("a headless worker still inherits the parent's Ponytail level", async () => {
  // The saved default must not reach a subagent branch: the parent's own level already published, so the bridge is no longer clear and the worker's start publishes nothing.
  await withHome(async (home) => {
    mkdirSync(path.join(home, ".tersio"), { recursive: true });
    writeFileSync(path.join(home, ".tersio", "settings.json"), JSON.stringify({
      comboDefault: "off",
      comboSetupComplete: true,
      ponytailDefault: "lite",
    }), "utf8");

    const parent = firstRunHarness(undefined, true);
    await parent.handlers.get("session_start")!({}, parent.ctx);
    // The parent runs at its saved default, so the worker's inheritance is not simply the default.
    expect(instruction(await parent.handlers.get("before_agent_start")!({ systemPrompt: [] }, parent.ctx))).toMatch(/level: lite/);

    const worker = firstRunHarness(undefined, false);
    await worker.handlers.get("session_start")!({}, worker.ctx);
    expect(getSharedComboState().ponytail, "a worker start publishes nothing").toBe("lite");
    expect(instruction(await worker.handlers.get("before_agent_start")!({ systemPrompt: [] }, worker.ctx))).toMatch(/level: lite/);
  });
});

test("a stored pstack default survives without a sibling mode key", async () => {
  // `tersio install --pstack-default on` alone must not be read back as the Combo preset's `off`.
  await withHome(async (home) => {
    mkdirSync(path.join(home, ".tersio"), { recursive: true });
    writeFileSync(path.join(home, ".tersio", "settings.json"), JSON.stringify({
      comboDefault: "off",
      comboSetupComplete: true,
      pstackDefault: "on",
    }), "utf8");

    const h = firstRunHarness(undefined);
    await h.handlers.get("session_start")!({}, h.ctx);

    expect(h.entries.find((entry) => entry.customType === "pstack-mode")?.data?.mode).toBe("on");
    expect(getSharedComboState().pstack).toBe("on");
  });
});

test("a new session restores persisted per-mode defaults with the Combo preset", async () => {
  await withHome(async (home) => {
    mkdirSync(path.join(home, ".tersio"), { recursive: true });
    writeFileSync(path.join(home, ".tersio", "settings.json"), JSON.stringify({
      comboDefault: "balanced",
      comboSetupComplete: true,
      cavemanDefault: "off",
      rtkDefault: false,
      ponytailDefault: "lite",
    }), "utf8");

    const h = firstRunHarness(undefined);
    await h.handlers.get("session_start")!({}, h.ctx);

    expect(getSharedComboState()).toMatchObject({
      level: "custom",
      caveman: "off",
      rtk: "off",
      ponytail: "lite",
    });
  });
});

// The status line must appear in every session type, and must not repeat itself.



interface statusTestPi {
  commands: Map<string, CommandHandler>;
  handlers: Map<string, EventHandler>;
  zod: { z: { object: (shape: Record<string, unknown>) => Record<string, unknown>; array: () => statusTestChain; string: () => statusTestChain } };
  setLabel(): void;
  registerCommand(name: string, config: { handler: CommandHandler }): void;
  registerTool(): void;
  on(event: string, handler: EventHandler): void;
  appendEntry(customType: string, data: Record<string, unknown>): void;
}


interface statusTestChain {
  min: () => statusTestChain;
  describe: () => statusTestChain;
}


interface statusTestCtx {
  hasUI: boolean;
  notifications: string[];
  sessionManager: { getBranch: () => SessionEntry[] };
  ui: { notify(message: string): void };
  reload(): Promise<void>;
}

type statusExtensionCtx = statusTestCtx;

function statusFakePi(entries: SessionEntry[] = []): statusTestPi {
  const commands = new Map<string, CommandHandler>();
  const handlers = new Map<string, EventHandler>();
  const chain: statusTestChain = { min: () => chain, describe: () => chain };
  return {
    commands,
    handlers,
    // Present `zod` marks this as the OMP host; without it the fake reads as pi and skips the shared events.
    zod: { z: { object: (shape) => shape, array: () => chain, string: () => chain } },
    setLabel() { },
    registerCommand(name, config) { commands.set(name, config.handler); },
    registerTool() { },
    on(event, handler) { handlers.set(event, handler); },
    appendEntry(customType, data) { entries.push({ type: "custom", customType, data }); },
  };
}

function statusContext(entries: SessionEntry[] = [], hasUI = true): statusTestCtx {
  const notifications: string[] = [];
  return {
    hasUI,
    notifications,
    sessionManager: { getBranch: () => entries },
    ui: {
    notify(message) { notifications.push(message); },
    setStatus(_name, value) { if (value !== undefined) notifications.push(value); },
  },
    async reload() { },
  };
}

/** Lines the status module sent, not every notice. */
function statuses(notifications: string[]): string[] {
  return notifications.filter((n) => n.startsWith("🧩 COMBO"));
}

function statusInstantiate(factory: (pi: ExtensionApi) => void, entries: SessionEntry[] = []): statusTestPi {
  const pi = statusFakePi(entries);
  factory(pi as unknown as ExtensionApi);
  return pi;
}

async function statusFire(pi: statusTestPi, event: string, ctx: statusTestCtx): Promise<void> {
  await pi.handlers.get(event)!({}, ctx);
}

const SESSION_EVENTS = ["session_start", "session_switch", "session_branch", "session_compact"] as const;

test("a new session announces the status", async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [];
  const pi = statusInstantiate(comboToggleExtension, entries);
  const ctx = statusContext(entries);
  await pi.commands.get("combo")!("max", ctx);
  await statusFire(pi, "session_start", statusContext(entries));

  const pi2 = statusInstantiate(comboToggleExtension, entries);
  const resumed = statusContext(entries);
  await statusFire(pi2, "session_start", resumed);
  expect(statuses(resumed.notifications)).toEqual(["🧩 COMBO MAX: 🪨 caveman=ULTRA | 🗜️ rtk=ON | 🧠 ponytail=ULTRA | 🥔 pstack=ON"]);
});

test("every session event announces the status, and an unchanged state stays silent", async () => {
  for (const event of SESSION_EVENTS) {
    resetSharedComboState();
    const entries: SessionEntry[] = [];
    const pi = statusInstantiate(comboToggleExtension, entries);
    const ctx = statusContext(entries);
    await pi.commands.get("combo")!("balanced", ctx);

    const fresh = statusContext(entries);
    const worker = statusInstantiate(comboToggleExtension, entries);
    await statusFire(worker, event, fresh);
    expect(statuses(fresh.notifications), `${event} announces`).toEqual([
      "🧩 COMBO BALANCED: 🪨 caveman=FULL | 🗜️ rtk=ON | 🧠 ponytail=FULL | 🥔 pstack=ON",
    ]);

    // A second restore of the same state repaints nothing new on the bar.
    const repeat = statusContext(entries);
    const worker2 = statusInstantiate(comboToggleExtension, entries);
    await statusFire(worker2, event, repeat);
    await statusFire(worker2, event, repeat);
    expect(statuses(repeat.notifications), `${event} dedupes`).toHaveLength(1);
  }
});

test("a subagent session announces the inherited status", async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [];
  const parent = statusInstantiate(comboToggleExtension, entries);
  await parent.commands.get("combo")!("max", statusContext(entries));

  // A worker's branch carries no Tersio entries, and no UI of its own.
  for (const factory of [comboToggleExtension, cavemanSessionExtension, rtkSessionExtension]) {
    const worker = statusInstantiate(factory);
    const ctx = statusContext([], false);
    await statusFire(worker, "session_start", ctx);
    expect(statuses(ctx.notifications)).toEqual([
      "🧩 COMBO MAX: 🪨 caveman=ULTRA | 🗜️ rtk=ON | 🧠 ponytail=ULTRA | 🥔 pstack=ON",
    ]);
  }
});

test("the status survives compaction and still matches the live state", async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [];
  const pi = statusInstantiate(comboToggleExtension, entries);
  const ctx = statusContext(entries);
  await pi.commands.get("combo")!("lite", ctx);

  const afterCompact = statusContext(entries);
  const worker = statusInstantiate(comboToggleExtension, entries);
  await statusFire(worker, "session_compact", afterCompact);

  expect(statuses(afterCompact.notifications)).toEqual([
    "🧩 COMBO LITE: 🪨 caveman=LITE | 🗜️ rtk=ON | 🧠 ponytail=LITE | 🥔 pstack=ON",
  ]);
  expect(formatStatus(getSharedComboState())).toBe(statuses(afterCompact.notifications)[0]);
});

test("persisted entries win over the configured default", async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [
    { type: "custom", customType: "combo-level", data: { level: "max" } },
    { type: "custom", customType: "caveman-mode", data: { mode: "ultra" } },
    { type: "custom", customType: "rtk-mode", data: { enabled: true } },
    { type: "custom", customType: "ponytail-mode", data: { mode: "ultra" } },
  ];
  const pi = statusInstantiate(comboToggleExtension, entries);
  const ctx = statusContext(entries);
  await statusFire(pi, "session_start", ctx);

  // HOME points at a missing dir, so any default read here is "off".
  expect(statuses(ctx.notifications)).toEqual([
    "🧩 COMBO MAX: 🪨 caveman=ULTRA | 🗜️ rtk=ON | 🧠 ponytail=ULTRA | 🥔 pstack=ON",
  ]);
});

test("a mode command reports the new state, and /tersio status agrees", async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [];
  const combo = statusInstantiate(comboToggleExtension, entries);
  const ctx = statusContext(entries);
  await combo.commands.get("combo")!("max", ctx);
  expect(statuses(ctx.notifications)).toEqual([
    "🧩 COMBO MAX: 🪨 caveman=ULTRA | 🗜️ rtk=ON | 🧠 ponytail=ULTRA | 🥔 pstack=ON",
  ]);

  const tersio = statusInstantiate(tersioCommandsExtension, entries);
  const asked = statusContext(entries);
  await tersio.commands.get("tersio")!("status", asked);
  expect(statuses(asked.notifications)).toEqual([
    "🧩 COMBO MAX: 🪨 caveman=ULTRA | 🗜️ rtk=ON | 🧠 ponytail=ULTRA | 🥔 pstack=ON",
  ]);
});

test("the status never reaches the model context", async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [];
  const combo = statusInstantiate(comboToggleExtension, entries);
  const ctx = statusContext(entries);
  await combo.commands.get("combo")!("max", ctx);

  const injected = await combo.handlers.get("before_agent_start")!(
    { systemPrompt: "Base." }, ctx,
  ) as { systemPrompt?: string[] } | undefined;

  // Only the ponytail block may be injected; the status line is display-only.
  const blocks = injected?.systemPrompt ?? [];
  expect(blocks).toHaveLength(2);
  expect(blocks.join("\n")).not.toContain("COMBO MAX");
});

test("a marked subagent prompt still injects guidance and stays consistent with the status", async () => {
  resetSharedComboState();
  const entries: SessionEntry[] = [];
  const parent = statusInstantiate(comboToggleExtension, entries);
  await parent.commands.get("combo")!("max", statusContext(entries));

  const prompt = ["System instructions.", OMP_SUBAGENT_MARKER];
  const worker = statusInstantiate(cavemanSessionExtension);
  const injected = await worker.handlers.get("before_agent_start")!({ systemPrompt: prompt }, undefined) as { systemPrompt?: string[] };
  expect(injected?.systemPrompt?.at(-1)).toMatch(/Caveman ultra active/);
  expect(formatStatus(getSharedComboState())).toBe("🧩 COMBO MAX: 🪨 caveman=ULTRA | 🗜️ rtk=ON | 🧠 ponytail=ULTRA | 🥔 pstack=ON");
});
test("the combo line names every mode, so every other surface keeps its text", () => {
  expect(formatStatus({ level: "balanced", caveman: "full", rtk: "on", ponytail: "full", pstack: "off" }))
    .toBe("🧩 COMBO BALANCED: 🪨 caveman=FULL | 🗜️ rtk=ON | 🧠 ponytail=FULL | 🥔 pstack=OFF");
});

const tersioDir = fs.mkdtempSync(path.join(os.tmpdir(), "tersio-router-"));
process.env.TERSIO_USAGE_FILE = path.join(tersioDir, "usage.jsonl");

type tersioHandler = (args: string, ctx: ExtensionCtx) => Promise<void>;

function tersioHarness(execImpl?: (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string; code: number }>) {
  let command: tersioHandler = async () => { };
  const appended: Array<{ type: string; data: Record<string, unknown> }> = [];
  const notifications: string[] = [];
  const execCalls: Array<{ cmd: string; args: string[] }> = [];
  let reloaded = 0;
  tersioCommandsExtension({
    setLabel() { },
    registerCommand(_name: string, config: { handler: tersioHandler }) { command = config.handler; },
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
  const h = tersioHarness();
  await h.command("help", h.ctx);
  for (const sub of ["status", "check", "update", "dashboard", "usage"]) {
    expect(h.notifications.join("\n")).toMatch(new RegExp(`/tersio ${sub}`));
  }
});

test("/tersio mode switches redirect to their own commands", async () => {
  for (const sub of ["caveman full", "rtk on", "ponytail full", "combo max"]) {
    const h = tersioHarness();
    await h.command(sub, h.ctx);
    expect(h.appended.length, `${sub} writes no entries`).toBe(0);
    expect(h.notifications.join("\n")).toMatch(new RegExp(`Use /${sub.split(" ")[0]} instead`));
  }
});

test("/tersio unknown warns with help", async () => {
  const h = tersioHarness();
  await h.command("frobnicate", h.ctx);
  expect(h.notifications.join("\n")).toMatch(/Unknown subcommand/);
});

test("/tersio update without target shows usage", async () => {
  const h = tersioHarness();
  await h.command("update", h.ctx);
  expect(h.notifications.join("\n")).toMatch(/Usage: \/tersio update/);
});

test("/tersio usage reports ledger rows", async () => {
  const h = tersioHarness();
  await h.command("usage", h.ctx);
  expect(h.notifications.join("\n")).toMatch(/tersio usage: \d+ rows/);
});
test("/tersio dashboard exports and opens the Dashboard", async () => {
  const h = tersioHarness();
  await h.command("dashboard", h.ctx);
  expect(h.execCalls[0].cmd).toBe("tersio");
  expect(h.execCalls[0].args.slice(0, 2)).toEqual(["dashboard", "--export"]);
  expect(h.execCalls[0].args[2]).toMatch(/tersio-dashboard-.*\.html/);
  // `start` is a cmd.exe builtin, not an executable, so the open routes through the shell there.
  if (IS_WINDOWS) {
    expect(h.execCalls[1].cmd).toBe(process.env.ComSpec || "cmd.exe");
    expect(h.execCalls[1].args.slice(0, 4)).toEqual(["/d", "/s", "/c", "start"]);
  } else {
    expect(["open", "xdg-open"].includes(h.execCalls[1].cmd), JSON.stringify(h.execCalls)).toBeTruthy();
  }
  expect(h.notifications.join("\n")).toMatch(/dashboard: opened in your browser/);
});

test("/tersio dashboard falls back to the shell command on failure", async () => {
  const h = tersioHarness(async () => ({ stdout: "", stderr: "nope", code: 1 }));
  await h.command("dashboard", h.ctx);
  expect(h.notifications.join("\n")).toMatch(/tersio dashboard --open/);
});

test("/tersio gain is no longer a dashboard alias", async () => {
  const h = tersioHarness();
  await h.command("gain", h.ctx);
  expect(h.execCalls).toHaveLength(0);
  expect(h.notifications.join("\n")).toMatch(/Unknown subcommand: gain/);
});
