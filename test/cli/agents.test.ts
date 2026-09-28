import { expect, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { HOSTS, byId } from "../../cli/agent-hosts.ts";
import {
  agentChoices,
  clearRetiredPaths,
  detectHosts,
  displayPath,
  hostLayer,
  installedHostIds,
  installedRows,
  installedState,
  normalizeIds,
  readSelection,
  resolveAgentSelection,
  writeSelection,
} from "../../cli/agents.ts";

function tempHome(): { home: string; cleanup: () => void } {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-agents-"));
  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

function write(home: string, rel: string, content: string): string {
  const abs = path.join(home, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
  return abs;
}

// Creates the directories a host's layer is made of.
function seedLayer(home: string, hostId: "omp" | "pi", which?: readonly string[]): string[] {
  const report = hostLayer(byId(hostId)!, home);
  const entries = which
    ? report.present.concat(report.missing).filter((e) => which.includes(e.path.split(path.sep).pop() ?? ""))
    : report.present.concat(report.missing);
  for (const entry of entries) mkdirSync(entry.path, { recursive: true });
  return entries.map((e) => e.path);
}

test("the agent menu lists every host and says what wiring it will get", () => {
  const choices = agentChoices();
  expect(choices.map((c) => c.value)).toEqual(HOSTS.map((h) => h.id));
  for (const choice of choices) {
    expect(choice.hint, `${choice.value} names no wiring`).toMatch(/rtk extension · auto-rewrite/);
  }
  const omp = choices.find((c) => c.value === "omp")!;
  expect(omp.label).toContain("extensions + Ponytail");
});

test("the menu labels every host with what is already installed", () => {
  const state = new Map([
    ["omp", { dirs: 7, installed: true }],
    ["pi", { dirs: 7, installed: true }],
  ]);
  const labels = new Map(agentChoices(state).map((c) => [c.value, c.label]));
  expect(labels.get("omp")).toBe("Oh My Pi (OMP) — 7 dirs · installed");
  expect(labels.get("pi")).toBe("Pi — 7 dirs · installed");
});

test("the menu says a host with nothing on disk is not installed", () => {
  const state = new Map([
    ["omp", { dirs: 0, installed: false }],
    ["pi", { dirs: 0, installed: false }],
  ]);
  const labels = new Map(agentChoices(state).map((c) => [c.value, c.label]));
  expect(labels.get("omp")).toBe("Oh My Pi (OMP) — nothing · not installed");
  expect(labels.get("pi")).toBe("Pi — nothing · not installed");
  expect(agentChoices().find((c) => c.value === "pi")!.label).toBe("Pi");
});

test("an uninstall menu offers only what is on disk", () => {
  const state = new Map([
    ["omp", { dirs: 7, installed: true }],
    ["pi", { dirs: 0, installed: false }],
  ]);
  expect(installedRows(state).map((c) => c.value)).toEqual(["omp"]);
  expect(agentChoices(state).map((c) => c.value)).toEqual(HOSTS.map((h) => h.id));
});

test("a host the state map does not mention keeps its row", () => {
  const sparse = new Map([["pi", { dirs: 7, installed: true }]]);
  expect(installedRows(sparse).map((c) => c.value)).toEqual(HOSTS.map((h) => h.id));
  expect(installedRows(new Map()).length).toBe(HOSTS.length);
});

test("hostLayer reports the extension tree, so a partial install reads as partial", () => {
  const { home, cleanup } = tempHome();
  try {
    const empty = hostLayer(byId("pi")!, home);
    expect(empty.present).toEqual([]);
    expect(empty.missing.length, "pi's tree is five extensions plus shared/ and lib/").toBe(7);
    expect(empty.installed).toBe(false);

    seedLayer(home, "pi", ["caveman-session"]);
    const partial = hostLayer(byId("pi")!, home);
    expect(partial.present.length).toBe(1);
    expect(partial.missing.length).toBe(6);
    expect(partial.installed).toBe(true);
  } finally {
    cleanup();
  }
});

test("omp's layer counts as installed only once the plugin is registered", () => {
  const { home, cleanup } = tempHome();
  try {
    seedLayer(home, "omp");
    expect(hostLayer(byId("omp")!, home).installed).toBe(false);
    mkdirSync(path.join(home, ".omp", "plugins", "node_modules", "@krtclcdy", "tersio"), { recursive: true });
    expect(hostLayer(byId("omp")!, home).installed).toBe(true);
  } finally {
    cleanup();
  }
});

test("installedState reads the disk, not the saved selection", () => {
  const { home, cleanup } = tempHome();
  try {
    write(home, ".tersio/agents.json", JSON.stringify({ hosts: ["omp"], updatedAt: 0 }));
    seedLayer(home, "pi", ["caveman-session"]);

    const state = installedState(home);
    expect(state.get("pi")!.dirs, "a layer on disk is installed regardless of the saved list").toBe(1);
    expect(state.get("pi")!.installed).toBe(true);
    expect(state.get("omp")!.dirs, "nothing of omp's is on disk").toBe(0);
    expect(state.get("omp")!.installed).toBe(false);
    expect(installedHostIds(state)).toEqual(["pi"]);
  } finally {
    cleanup();
  }
});

test("normalizeIds keeps registry order, drops unknowns, and de-duplicates", () => {
  expect(normalizeIds(["pi", "omp", "pi", "not-a-host"])).toEqual(["omp", "pi"]);
  expect(normalizeIds(["codex", "claude-code", "opencode"])).toEqual([]);
  expect(normalizeIds([])).toEqual([]);
});

test("an explicit --agent wins over the prompt, the saved set, and detection", async () => {
  let asked = false;
  const result = await resolveAgentSelection({
    flag: ["pi"],
    stored: ["omp"],
    detected: ["pi"],
    ask: async () => { asked = true; return ["omp"]; },
  });
  expect(result.ids).toEqual(["pi"]);
  expect(result.source).toBe("flag");
  expect(asked, "the prompt must not run when --agent is given").toBe(false);
});

test("an explicit --agent naming an uninstalled host is honoured, which is how you install it", async () => {
  const result = await resolveAgentSelection({ flag: ["pi"], stored: [], detected: [] });
  expect(result.ids).toEqual(["pi"]);
});

test("an all-unknown --agent falls through instead of selecting nothing", async () => {
  const result = await resolveAgentSelection({ flag: ["bogus"], stored: ["pi"], detected: [] });
  expect(result.ids).toEqual(["pi"]);
  expect(result.source).toBe("auto");
});

test("the prompt decides, and a cancelled prompt falls back to the automatic set", async () => {
  const asked = await resolveAgentSelection({ stored: ["omp"], detected: ["pi"], ask: async () => ["pi"] });
  expect(asked.ids).toEqual(["pi"]);
  expect(asked.source).toBe("prompt");

  const cancelled = await resolveAgentSelection({ stored: ["omp"], detected: ["pi"], ask: async () => null });
  expect(cancelled.ids).toEqual(["omp", "pi"]);
  expect(cancelled.source).toBe("auto");
});

test("an empty answer from the prompt is a valid way to clear the set", async () => {
  // The picker treats picking nothing as an answer rather than a cancel.
  const result = await resolveAgentSelection({ stored: ["omp"], detected: [], ask: async () => [] });
  expect(result.ids).toEqual([]);
  expect(result.source).toBe("prompt");
});

test("the automatic set unions the saved hosts with what is on the machine", async () => {
  const result = await resolveAgentSelection({ stored: ["omp"], detected: ["pi"] });
  expect(result.ids).toEqual(["omp", "pi"]);
  expect(result.source).toBe("auto");
  expect(result.addedByDetection).toEqual(["pi"]);
});

test("nothing saved and nothing detected is a valid answer", async () => {
  const result = await resolveAgentSelection({ stored: [], detected: [] });
  expect(result.ids).toEqual([]);
  expect(result.source).toBe("none");
});

test("uninstall resolves from the saved set only, never from detection", async () => {
  const result = await resolveAgentSelection({ stored: ["pi"], detected: [] });
  expect(result.ids).toEqual(["pi"]);
});

test("the selection round-trips through ~/.tersio/agents.json", () => {
  const { home, cleanup } = tempHome();
  try {
    expect(readSelection(home).hosts).toEqual([]);
    writeSelection(home, ["pi", "omp"]);
    expect(readSelection(home).hosts).toEqual(["omp", "pi"]);
    expect(readSelection(home).updatedAt).toBeGreaterThan(0);
    writeSelection(home, ["pi"]);
    expect(readSelection(home).hosts).toEqual(["pi"]);
  } finally {
    cleanup();
  }
});

test("a corrupt or absent selection file reads as empty rather than throwing", () => {
  const { home, cleanup } = tempHome();
  try {
    expect(readSelection(home).hosts).toEqual([]);
    write(home, ".tersio/agents.json", "{ not json");
    expect(readSelection(home).hosts).toEqual([]);
    write(home, ".tersio/agents.json", '{"hosts": "not-an-array"}');
    expect(readSelection(home).hosts).toEqual([]);
    write(home, ".tersio/agents.json", '{"hosts": ["pi", 7, null]}');
    expect(readSelection(home).hosts).toEqual(["pi"]);
  } finally {
    cleanup();
  }
});

test("detection finds a host by its config directory", () => {
  const { home, cleanup } = tempHome();
  try {
    mkdirSync(path.join(home, ".pi", "agent", "extensions"), { recursive: true });
    expect(detectHosts(home, { PATH: "" })).toContain("pi");
  } finally {
    cleanup();
  }
});

test("detection never includes omp, so the OMP default cannot appear from nothing", () => {
  const { home, cleanup } = tempHome();
  try {
    mkdirSync(path.join(home, ".omp", "agent"), { recursive: true });
    expect(detectHosts(home, { PATH: "" })).not.toContain("omp");
  } finally {
    cleanup();
  }
});

test("detection finds a host by a binary on PATH", () => {
  const { home, cleanup } = tempHome();
  try {
    const binDir = mkdtempSync(path.join(os.tmpdir(), "tersio-bin-"));
    writeFileSync(path.join(binDir, "pi"), "#!/bin/sh\n", { mode: 0o755 });
    expect(detectHosts(home, { PATH: binDir })).toContain("pi");
    rmSync(binDir, { recursive: true, force: true });
  } finally {
    cleanup();
  }
});

test("detection ignores a relocation env var pointing somewhere empty", () => {
  const { home, cleanup } = tempHome();
  try {
    const found = detectHosts(home, { PATH: "", PI_CODING_AGENT_DIR: path.join(home, "nope") });
    expect(found).not.toContain("pi");
  } finally {
    cleanup();
  }
});

test("a retired rules file only loses our block, never the user's own text", () => {
  const { home, cleanup } = tempHome();
  try {
    const agentsMd = write(
      home,
      ".pi/agent/AGENTS.md",
      "# My rules\n\nkeep me\n\n<!-- tersio:start -->\nmanaged\n<!-- tersio:end -->\n",
    );
    const removed = clearRetiredPaths(byId("pi")!, home);
    expect(removed).toEqual([agentsMd]);
    const left = readFileSync(agentsMd, "utf8");
    expect(left).toContain("keep me");
    expect(left).not.toContain("tersio:start");
    expect(clearRetiredPaths(byId("pi")!, home)).toEqual([]);
  } finally {
    cleanup();
  }
});

test("a retired rules file holding only our block is removed entirely", () => {
  const { home, cleanup } = tempHome();
  try {
    const agentsMd = write(home, ".omp/agent/AGENTS.md", "<!-- tersio:start -->\nmanaged\n<!-- tersio:end -->\n");
    clearRetiredPaths(byId("omp")!, home);
    expect(existsSync(agentsMd)).toBe(false);
  } finally {
    cleanup();
  }
});

test("a user's own AGENTS.md with no block of ours is left byte-for-byte", () => {
  const { home, cleanup } = tempHome();
  try {
    const agentsMd = write(home, ".omp/agent/AGENTS.md", "# Mine\n\nno tersio block here\n");
    expect(clearRetiredPaths(byId("omp")!, home)).toEqual([]);
    expect(readFileSync(agentsMd, "utf8")).toBe("# Mine\n\nno tersio block here\n");
  } finally {
    cleanup();
  }
});

test("a retired directory we created is removed, and a dry run removes nothing", () => {
  const { home, cleanup } = tempHome();
  try {
    const skill = path.join(home, ".pi/agent/skills/tersio-caveman/SKILL.md");
    write(home, ".pi/agent/skills/tersio-caveman/SKILL.md", "mine\n");

    const previewed = clearRetiredPaths(byId("pi")!, home, { dryRun: true });
    expect(previewed.length, "a skills directory is retired for both hosts").toBeGreaterThan(0);
    expect(existsSync(skill), "a dry run must not remove anything").toBe(true);

    clearRetiredPaths(byId("pi")!, home);
    expect(existsSync(path.join(home, ".pi/agent/skills/tersio-caveman"))).toBe(false);
  } finally {
    cleanup();
  }
});

test("displayPath shortens a path under home and leaves anything else alone", () => {
  const home = path.join(path.sep, "home", "u");
  expect(displayPath(path.join(home, ".pi", "agent"), home)).toBe("~/.pi/agent");
  expect(displayPath(path.join(path.sep, "elsewhere"), home)).toBe(path.join(path.sep, "elsewhere"));
  expect(displayPath("/x", "")).toBe("/x");
});
