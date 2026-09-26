import { expect, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { HOSTS, byId } from "../../cli/agent-hosts.ts";
import {
  agentChoices,
  applyHost,
  applyHosts,
  detectHosts,
  isTersioOwned,
  normalizeIds,
  readSelection,
  removeHost,
  removeHosts,
  reportHost,
  reportHosts,
  resolveAgentSelection,
  writeSelection,
} from "../../cli/agents.ts";
import { HOOK_MARKER } from "../../cli/host-writers.ts";
import { START } from "../../cli/rules-pack.ts";

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

function read(home: string, rel: string): string {
  return readFileSync(path.join(home, rel), "utf8");
}

// --- selection -------------------------------------------------------------

test("the agent menu lists every host and says what wiring it will get", () => {
  const choices = agentChoices();
  expect(choices.map((c) => c.value)).toEqual(HOSTS.map((h) => h.id));
  const byId_ = new Map(choices.map((c) => [c.value, c.hint]));

  // The hint is the only thing telling the user what the rewrite will do, so
  // each wiring class has to be distinguishable.
  expect(byId_.get("claude-code")).toMatch(/hook · auto-rewrite/);
  expect(byId_.get("opencode")).toMatch(/plugin · auto-rewrite/);
  expect(byId_.get("pi")).toMatch(/rtk extension · auto-rewrite/);
  expect(byId_.get("codex")).toMatch(/hook · auto-rewrite/);
  expect(byId_.get("claude-code")).toMatch(/hook · auto-rewrite/);
  // No host is guidance-only any more, so the hint must never say so.
  for (const hint of byId_.values()) {
    expect(hint).not.toBe("guidance only · no auto-rewrite");
  }
  // omp is the reference host, and the menu says so.
  expect(byId_.get("omp")).toMatch(/^reference host · /);
});

test("normalizeIds keeps registry order, drops unknowns, and de-duplicates", () => {
  expect(normalizeIds(["codex", "claude-code", "codex", "not-a-host"])).toEqual(["claude-code", "codex"]);
  expect(normalizeIds(["nope"])).toEqual([]);
  expect(normalizeIds([])).toEqual([]);
});

test("an explicit --agent wins over the prompt, the saved set, and detection", async () => {
  let asked = false;
  const result = await resolveAgentSelection({
    flag: ["pi"],
    stored: ["claude-code"],
    detected: ["codex"],
    ask: async () => { asked = true; return ["pi"]; },
  });
  expect(result.ids).toEqual(["pi"]);
  expect(result.source).toBe("flag");
  expect(asked, "the prompt must not run when --agent is given").toBe(false);
});

test("an explicit --agent naming an uninstalled host is honoured, which is how you install it", async () => {
  // Detection is irrelevant here: naming a host you do not have yet is the
  // whole point of --agent.
  const result = await resolveAgentSelection({ flag: ["pi"], stored: [], detected: [] });
  expect(result.ids).toEqual(["pi"]);
});

test("an all-unknown --agent falls through instead of selecting nothing", async () => {
  const result = await resolveAgentSelection({ flag: ["bogus"], stored: ["codex"], detected: [] });
  expect(result.ids).toEqual(["codex"]);
  expect(result.source).toBe("auto");
});

test("the prompt decides, and a cancelled prompt falls back to the automatic set", async () => {
  const asked = await resolveAgentSelection({
    stored: ["claude-code"],
    detected: ["codex"],
    ask: async () => ["pi"],
  });
  expect(asked.ids).toEqual(["pi"]);
  expect(asked.source).toBe("prompt");

  const cancelled = await resolveAgentSelection({
    stored: ["claude-code"],
    detected: ["codex"],
    ask: async () => null,
  });
  expect(cancelled.ids).toEqual(["claude-code", "codex"]);
  expect(cancelled.source).toBe("auto");
});

test("an empty answer from the prompt is a valid way to clear the set", async () => {
  // required: false, so picking nothing is an answer rather than a cancel.
  const result = await resolveAgentSelection({
    stored: ["claude-code", "codex"],
    detected: [],
    ask: async () => [],
  });
  expect(result.ids).toEqual([]);
  expect(result.source).toBe("prompt");
});

test("the automatic set unions the saved hosts with what is on the machine", async () => {
  // A saved choice is a preference, not evidence. Returning it verbatim meant a
  // host that was installed and running, but never ticked in an earlier menu,
  // was silently skipped and never written.
  const result = await resolveAgentSelection({
    stored: ["claude-code"],
    detected: ["codex", "pi"],
  });
  expect(result.ids).toEqual(["claude-code", "codex", "pi"]);
  expect(result.source).toBe("auto");
  expect(result.addedByDetection).toEqual(["codex", "pi"]);
});

test("nothing saved and nothing detected is a valid answer", async () => {
  const result = await resolveAgentSelection({ stored: [], detected: [] });
  expect(result.ids).toEqual([]);
  expect(result.source).toBe("none");
});

test("uninstall resolves from the saved set only, never from detection", async () => {
  // Removal acts on what tersio wrote. A host that merely happens to be
  // installed was never a target, so detection must not widen it.
  const result = await resolveAgentSelection({ stored: ["claude-code"], detected: [] });
  expect(result.ids).toEqual(["claude-code"]);
});

test("the selection round-trips through ~/.tersio/agents.json", () => {
  const { home, cleanup } = tempHome();
  try {
    expect(readSelection(home).hosts).toEqual([]);
    writeSelection(home, ["pi", "codex"]);
    // Stored in registry order, not the order given, so the file is stable
    // whatever order --agent listed them in.
    expect(readSelection(home).hosts).toEqual(["codex", "pi"]);
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

// --- detection -------------------------------------------------------------

test("detection finds a host by its config directory", () => {
  const { home, cleanup } = tempHome();
  try {
    mkdirSync(path.join(home, ".codex", "rules"), { recursive: true });
    const found = detectHosts(home, { PATH: "" });
    expect(found).toContain("codex");
  } finally {
    cleanup();
  }
});

test("detection never includes an own-path host, so the OMP default cannot appear from nothing", () => {
  const { home, cleanup } = tempHome();
  try {
    // omp and opencode are wired by their own modules; detection must not
    // silently opt a user into them.
    const found = detectHosts(home, { PATH: "" });
    expect(found).not.toContain("omp");
    expect(found).not.toContain("opencode");
  } finally {
    cleanup();
  }
});

test("detection finds a host by a binary on PATH", () => {
  const { home, cleanup } = tempHome();
  try {
    const binDir = mkdtempSync(path.join(os.tmpdir(), "tersio-bin-"));
    writeFileSync(path.join(binDir, "pi"), "#!/bin/sh\n", { mode: 0o755 });
    const found = detectHosts(home, { PATH: binDir });
    expect(found).toContain("pi");
    rmSync(binDir, { recursive: true, force: true });
  } finally {
    cleanup();
  }
});

test("detection ignores a relocation env var pointing somewhere empty", () => {
  const { home, cleanup } = tempHome();
  try {
    // CODEX_HOME set but empty must not count as "installed", or every user
    // with the var exported would be reported as configured.
    const found = detectHosts(home, { PATH: "", CODEX_HOME: path.join(home, "nope") });
    expect(found).not.toContain("codex");
  } finally {
    cleanup();
  }
});

// --- applying --------------------------------------------------------------

test("applying a static-hook host writes its rules, skills, and hook", async () => {
  const { home, cleanup } = tempHome();
  try {
    const host = byId("claude-code")!;
    const result = await applyHost(host, home);
    expect(result.written.length).toBeGreaterThan(0);
    for (const p of result.written) expect(existsSync(p), `${p} was not written`).toBe(true);
    expect(existsSync(path.join(home, ".claude", "CLAUDE.md"))).toBe(true);
    expect(existsSync(path.join(home, ".claude", "skills", "tersio-caveman", "SKILL.md"))).toBe(true);
    expect(existsSync(path.join(home, ".claude", "settings.json"))).toBe(true);
    expect(existsSync(path.join(home, ".claude", "tersio-rtk-rewrite.mjs"))).toBe(true);
  } finally {
    cleanup();
  }
});

test("applying twice changes nothing the second time", async () => {
  const { home, cleanup } = tempHome();
  try {
    const host = byId("codex")!;
    await applyHost(host, home);
    const second = await applyHost(host, home);
    expect(second.written).toEqual([]);
    expect(second.unchanged.length).toBeGreaterThan(0);
  } finally {
    cleanup();
  }
});

test("applying preserves the user's own instructions and hooks", async () => {
  const { home, cleanup } = tempHome();
  try {
    const host = byId("claude-code")!;
    write(home, ".claude/CLAUDE.md", "# My rules\n\nNever touch main.\n");
    write(home, ".claude/settings.json", JSON.stringify({
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo mine" }] }] },
    }));
    await applyHost(host, home);
    const md = read(home, ".claude/CLAUDE.md");
    expect(md).toContain("Never touch main.");
    expect(md).toContain(START);
    const settings = JSON.parse(read(home, ".claude/settings.json")) as Record<string, any>;
    expect(JSON.stringify(settings)).toContain("echo mine");
    expect(settings.hooks.PreToolUse).toHaveLength(2);
  } finally {
    cleanup();
  }
});

test("a dry run reports the plan and writes nothing", async () => {
  const { home, cleanup } = tempHome();
  try {
    const host = byId("claude-code")!;
    const result = await applyHost(host, home, { dryRun: true });
    expect(result.planned.length).toBeGreaterThan(0);
    expect(result.written).toEqual([]);
    expect(existsSync(path.join(home, ".claude"))).toBe(false);
  } finally {
    cleanup();
  }
});

test("a live-extension host gets its rules and skills but no hook file", async () => {
  const { home, cleanup } = tempHome();
  try {
    // pi's rewrite is rtk's own extension, so tersio writes no hook for it.
    const host = byId("pi")!;
    await applyHost(host, home);
    expect(existsSync(path.join(home, ".pi", "agent", "AGENTS.md"))).toBe(true);
    expect(existsSync(path.join(home, ".pi", "agent", "skills", "tersio-rtk", "SKILL.md"))).toBe(true);
    expect(read(home, ".pi/agent/AGENTS.md")).toContain("filters output before the model reads it");
    expect(existsSync(path.join(home, ".pi", "agent", "hooks.json"))).toBe(false);
    expect(existsSync(path.join(home, ".pi", "agent", "tersio-rtk-rewrite.mjs"))).toBe(false);
  } finally {
    cleanup();
  }
});

test("a failure on one host does not stop the others", async () => {
  const { home, cleanup } = tempHome();
  try {
    const { results, errors } = await applyHosts(["claude-code", "pi", "codex"], home);
    expect(results.length).toBe(3);
    expect(errors).toEqual([]);
  } finally {
    cleanup();
  }
});

// --- removing --------------------------------------------------------------

test("removal strips our block but keeps the user's own instructions", async () => {
  const { home, cleanup } = tempHome();
  try {
    const host = byId("claude-code")!;
    write(home, ".claude/CLAUDE.md", "# My rules\n\nNever touch main.\n");
    await applyHost(host, home);
    await removeHost(host, home);
    const md = read(home, ".claude/CLAUDE.md");
    expect(md).not.toContain(START);
    expect(md).not.toContain("Caveman");
    expect(md).toContain("Never touch main.");
  } finally {
    cleanup();
  }
});

test("a file that held nothing but our block is removed entirely", async () => {
  const { home, cleanup } = tempHome();
  try {
    const host = byId("claude-code")!;
    await applyHost(host, home);
    expect(existsSync(path.join(home, ".claude", "CLAUDE.md"))).toBe(true);
    await removeHost(host, home);
    expect(existsSync(path.join(home, ".claude", "CLAUDE.md")), "left an empty file behind").toBe(false);
  } finally {
    cleanup();
  }
});

test("removal deletes the skill directory, not just the file in it", async () => {
  const { home, cleanup } = tempHome();
  try {
    const host = byId("claude-code")!;
    await applyHost(host, home);
    await removeHost(host, home);
    expect(existsSync(path.join(home, ".claude", "skills", "tersio-caveman"))).toBe(false);
    // The shared parent stays: a user may keep their own skills there, and
    // deleting it would take their work with it.
    expect(existsSync(path.join(home, ".claude", "skills")), "removed the user's skills dir").toBe(true);
  } finally {
    cleanup();
  }
});

test("removal leaves a user's own skills in the shared directory alone", async () => {
  const { home, cleanup } = tempHome();
  try {
    const host = byId("claude-code")!;
    write(home, ".claude/skills/my-own/SKILL.md", "---\nname: my-own\ndescription: mine\n---\n");
    await applyHost(host, home);
    await removeHost(host, home);
    expect(existsSync(path.join(home, ".claude", "skills", "tersio-rtk"))).toBe(false);
    expect(existsSync(path.join(home, ".claude", "skills", "my-own", "SKILL.md")), "deleted the user's skill").toBe(true);
  } finally {
    cleanup();
  }
});

test("removal keeps a user's settings.json and takes only our hook out of it", async () => {
  const { home, cleanup } = tempHome();
  try {
    const host = byId("claude-code")!;
    write(home, ".claude/settings.json", JSON.stringify({
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo mine" }] }] },
    }));
    await applyHost(host, home);
    await removeHost(host, home);
    const settings = JSON.parse(read(home, ".claude/settings.json")) as Record<string, any>;
    expect(JSON.stringify(settings)).toContain("echo mine");
    expect(JSON.stringify(settings)).not.toContain(HOOK_MARKER);
    expect(existsSync(path.join(home, ".claude", "settings.json")), "deleted the user's config").toBe(true);
  } finally {
    cleanup();
  }
});

test("removal empties our hook entry without deleting the user's config file", async () => {
  const { home, cleanup } = tempHome();
  try {
    // No supported host uses a tersio-named hook config any more, so every hook
    // config is a file the user also owns and must survive with only our entry
    // removed. That makes the delete-when-empty branch unreachable today.
    for (const host of HOSTS.filter((h) => h.rewriteConfig)) {
      expect(isTersioOwned(host.rewriteConfig!.configFile), `${host.id} owns a tersio-named config`).toBe(false);
    }

    const host = byId("codex")!;
    await applyHost(host, home);
    const cfg = path.join(home, ".codex", "hooks.json");
    expect(existsSync(cfg)).toBe(true);
    await removeHost(host, home);
    expect(existsSync(cfg), "deleted a config file the user owns").toBe(true);
    const after = JSON.parse(readFileSync(cfg, "utf8")) as Record<string, unknown>;
    expect(JSON.stringify(after)).not.toContain("tersio-rtk-rewrite.mjs");
  } finally {
    cleanup();
  }
});

test("removal takes the rewriter script with it", async () => {
  const { home, cleanup } = tempHome();
  try {
    const host = byId("codex")!;
    await applyHost(host, home);
    const script = path.join(home, ".codex", "tersio-rtk-rewrite.mjs");
    expect(existsSync(script)).toBe(true);
    await removeHost(host, home);
    expect(existsSync(script)).toBe(false);
  } finally {
    cleanup();
  }
});

test("removing a host that was never installed touches nothing", async () => {
  const { home, cleanup } = tempHome();
  try {
    const result = await removeHost(byId("codex")!, home);
    expect(result.removed).toEqual([]);
    expect(result.kept).toEqual([]);
    expect(existsSync(path.join(home, ".codex"))).toBe(false);
  } finally {
    cleanup();
  }
});

test("a full apply then remove leaves no tersio file behind", async () => {
  const { home, cleanup } = tempHome();
  try {
    const hosts = ["claude-code", "codex", "opencode", "pi"];
    await applyHosts(hosts, home);
    await removeHosts(hosts, home);
    const leftovers: string[] = [];
    const walk = (dir: string): void => {
      let entries: string[] = [];
      try {
        entries = readdirSync(dir);
      } catch { return; }
      for (const entry of entries) {
        const abs = path.join(dir, entry);
        if (entry.includes("tersio")) {
          leftovers.push(abs);
          continue;
        }
        let isDir = false;
        try {
          isDir = statSync(abs).isDirectory();
        } catch { /* vanished mid-walk */ }
        if (isDir) walk(abs);
      }
    };
    walk(home);
    expect(leftovers, `left behind: ${leftovers.join(", ")}`).toEqual([]);
  } finally {
    cleanup();
  }
});

// --- reporting -------------------------------------------------------------

test("a fully installed host reports healthy, with no repair pending", () => {
  const { home, cleanup } = tempHome();
  try {
    const host = byId("claude-code")!;
    expect(reportHost(host, home).status).toBe("warn");
    expect(reportHost(host, home).repair).toBe("install");
  } finally {
    cleanup();
  }
});

test("a healthy row is quiet about repair and names the rewrite path", () => {
  const { home, cleanup } = tempHome();
  try {
    expect(reportHost(byId("pi")!, home)).toMatchObject({ status: "warn", repair: "install" });
  } finally {
    cleanup();
  }
});

test("doctor reports one row per selected host", () => {
  const { home, cleanup } = tempHome();
  try {
    const rows = reportHosts(["claude-code", "pi", "bogus"], home);
    expect(rows.map((r) => r.host.id)).toEqual(["claude-code", "pi"]);
    for (const row of rows) {
      expect(row.detail.length).toBeGreaterThan(0);
      expect(row.missing.length).toBeGreaterThan(0);
    }
  } finally {
    cleanup();
  }
});

test("a missing rewrite hook is called out, because a host that ignores it looks wired", async () => {
  const { home, cleanup } = tempHome();
  try {
    const host = byId("claude-code")!;
    await applyHost(host, home);
    rmSync(path.join(home, ".claude", "settings.json"), { force: true });
    const row = reportHost(host, home);
    expect(row.status).toBe("warn");
    expect(row.detail).toContain("rewrite hook");
    expect(row.repair).toBe("install");
  } finally {
    cleanup();
  }
});
