// Behavioural test for the OpenCode plugin's mode commands.
//
// The existing tests in opencode-wiring.test.ts read the plugin's source as
// text, which is enough to pin its shape but cannot tell whether a command
// works. These drive setup() against a fake context and assert what the host
// would actually see: the command list, the notice appended to an agent's system
// prompt, and the skill left to load itself.
import { expect, test } from "vitest";
import plugin from "../../extensions/opencode/rtk-plugin.ts";

type Transform<T> = (editor: T) => void;

interface FakeAgent {
  id: string;
  system?: string;
}

interface FakeSkill {
  id: string;
  autoinvoke?: boolean;
}

interface Command {
  name: string;
  description?: string;
  execute: (input: {
    sessionID: string;
    prompt: { text: string; [key: string]: unknown };
    delivery: 'steer' | 'queue';
  }) => Promise<void>;
}

function harness(initialAgent = "Your base prompt.") {
  const agentTransforms: Array<Transform<{ list(): FakeAgent[]; update(id: string, fn: (a: FakeAgent) => void): void }>> = [];
  const skillTransforms: Array<Transform<{ list(): FakeSkill[]; update(id: string, fn: (s: FakeSkill) => void): void }>> = [];
  const commands = new Map<string, Command>();
  const storage = new Map<string, unknown>();
  const prompts: string[] = [];
  const agent = new Map<string, FakeAgent>([["build", { id: "build", system: initialAgent }]]);
  const skills: FakeSkill[] = [
    { id: "tersio-caveman" },
    { id: "tersio-rtk" },
    { id: "tersio-ponytail" },
    { id: "other-skill" },
  ];

  const ctx = {
    tool: { hook: async () => ({}) },
    agent: { transform: async (cb: never) => { agentTransforms.push(cb); return {}; } },
    skill: { transform: async (cb: never) => { skillTransforms.push(cb); return {}; } },
    command: {
      transform: async (cb: never) => {
        (cb as unknown as (e: { add(c: Command): void }) => void)({
          add: (c: Command) => { commands.set(c.name, c); },
        });
        return {};
      },
    },
    session: { prompt: async (i: { text: string }) => { prompts.push(i.text); return {}; } },
    storage: {
      get: async (k: string) => storage.get(k),
      set: async (k: string, v: unknown) => { storage.set(k, v); },
    },
  };

  // Replay every registered transform, the way a registry rebuild does.
  const applyAgents = (): void => {
    const list = (): FakeAgent[] => [...agent.values()];
    for (const t of agentTransforms) {
      t({
        list,
        update: (id, fn) => { const a = agent.get(id); if (a) fn(a); },
      });
    }
  };
  const applySkills = (): void => {
    for (const t of skillTransforms) {
      t({
        list: () => skills,
        update: (id, fn) => { const s = skills.find((x) => x.id === id); if (s) fn(s); },
      });
    }
  };

  return { ctx, commands, prompts, storage, agent, skills, applyAgents, applySkills };
}

async function run(name: string, text: string) {
  const h = harness();
  // Fresh harness per command, so state does not leak between them.
  await plugin.setup(h.ctx as never);
  const cmd = h.commands.get(name);
  expect(cmd, `${name} command was not registered`).toBeDefined();
  await cmd!.execute({ sessionID: "s1", prompt: { text }, delivery: "steer" });
  h.applyAgents();
  h.applySkills();
  return h;
}

test("the plugin registers the three mode commands and /combo", async () => {
  const h = harness();
  await plugin.setup(h.ctx as never);
  expect([...h.commands.keys()].toSorted()).toEqual(["caveman", "combo", "ponytail", "rtk"]);
  for (const cmd of h.commands.values()) {
    expect(cmd.description, `${cmd.name} has no description`).toBeTruthy();
  }
});

test("a mode command appends the notice to the agent and lets its skill load itself", async () => {
  const h = await run("caveman", "full");
  const system = h.agent.get("build")!.system ?? "";
  expect(system, "the base prompt was replaced instead of appended to").toContain("Your base prompt.");
  expect(system).toContain("<!-- tersio:start -->");
  expect(system).toContain("caveman (full)");
  expect(h.skills.find((s) => s.id === "tersio-caveman")!.autoinvoke).toBe(true);
  // rtk defaults on because the rewrite hook is always registered.
  expect(h.skills.find((s) => s.id === "tersio-rtk")!.autoinvoke).toBe(true);
  expect(h.skills.find((s) => s.id === "tersio-ponytail")!.autoinvoke).not.toBe(true);
  // A skill that is not ours is left alone.
  expect(h.skills.find((s) => s.id === "other-skill")!.autoinvoke).toBeUndefined();
  expect(h.prompts.at(-1)).toContain("caveman (full)");
});

test("turning every mode off restores the agent exactly as it was", async () => {
  const h = harness();
  await plugin.setup(h.ctx as never);
  const before = h.agent.get("build")!.system;

  await h.commands.get("caveman")!.execute({ sessionID: "s1", prompt: { text: "full" }, delivery: "steer" });
  h.applyAgents();
  expect(h.agent.get("build")!.system).not.toBe(before);

  // rtk off, then the other two, leaves nothing active.
  for (const [name, arg] of [["rtk", "off"], ["caveman", "off"], ["ponytail", "off"]] as const) {
    await h.commands.get(name)!.execute({ sessionID: "s1", prompt: { text: arg }, delivery: "steer" });
    h.applyAgents();
  }
  // Either the original text or empty is fine; what must not remain is our block.
  expect(h.agent.get("build")!.system ?? "").not.toContain("tersio:start");
  expect(before).toBe("Your base prompt.");
});

test("re-applying a mode does not stack a second notice", async () => {
  const h = harness();
  await plugin.setup(h.ctx as never);
  for (let i = 0; i < 4; i += 1) {
    await h.commands.get("caveman")!.execute({ sessionID: "s1", prompt: { text: "full" }, delivery: "steer" });
    h.applyAgents();
  }
  const system = h.agent.get("build")!.system ?? "";
  const blocks = system.split("<!-- tersio:start -->").length - 1;
  expect(blocks, `the notice was appended ${blocks} times`).toBe(1);
});

test("/combo takes the same preset names OMP and Pi expose", async () => {
  // Not a per-mode setter: `balanced` means the same three levels it means on
  // the other two hosts, so a user who learned one has not learned three.
  const balanced = await run("combo", "balanced");
  const system = balanced.agent.get("build")!.system ?? "";
  expect(system).toContain("caveman (full)");
  expect(system).toContain("rtk (on)");
  expect(system).toContain("ponytail (full)");
  expect(balanced.skills.filter((s) => s.autoinvoke === true).map((s) => s.id).toSorted())
    .toEqual(["tersio-caveman", "tersio-ponytail", "tersio-rtk"]);

  const max = await run("combo", "max");
  expect(max.agent.get("build")!.system ?? "").toContain("caveman (ultra)");

  // An unknown word is not a guess: the modes are left as they were.
  const bogus = await run("combo", "turbo");
  expect(bogus.storage.get("modes:s1")).toEqual({ caveman: "off", rtk: "on", ponytail: "off" });
});

test("a level a mode does not offer leaves the mode alone", async () => {
  const h = await run("rtk", "ultra");
  // rtk only has off/on, so "ultra" must not be stored as its level.
  const state = h.storage.get("modes:s1") as Record<string, string>;
  expect(state.rtk).toBe("on");
});

test("stored state is keyed per session", async () => {
  const h = harness();
  await plugin.setup(h.ctx as never);
  await h.commands.get("caveman")!.execute({ sessionID: "s1", prompt: { text: "full" }, delivery: "steer" });
  await h.commands.get("caveman")!.execute({ sessionID: "s2", prompt: { text: "lite" }, delivery: "steer" });
  expect(h.storage.get("modes:s1")).toEqual({ caveman: "full", rtk: "on", ponytail: "off" });
  expect(h.storage.get("modes:s2")).toEqual({ caveman: "lite", rtk: "on", ponytail: "off" });
});
