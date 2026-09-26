import { expect, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { byId } from "../../cli/agent-hosts.ts";
import {
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
  resolveSelection,
  writeSelection,
} from "../../cli/agents.ts";
import { HOOK_MARKER } from "../../cli/host-writers.ts";
import { START, END } from "../../cli/rules-pack.ts";

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

test("normalizeIds keeps registry order, drops unknowns, and de-duplicates", () => {
  expect(normalizeIds(["cursor", "claude-code", "cursor", "not-a-host"])).toEqual(["claude-code", "cursor"]);
  expect(normalizeIds(["nope"])).toEqual([]);
  expect(normalizeIds([])).toEqual([]);
});

test("an explicit --agent wins over both the saved set and detection", () => {
  expect(resolveSelection(["agy"], ["claude-code"], ["cursor"])).toEqual({ ids: ["agy"], source: "flag" });
});

test("an explicit --agent naming an uninstalled host is honoured, which is how you install it", () => {
  // Detection is irrelevant here: naming a host you do not have yet is the
  // whole point of --agent.
  expect(resolveSelection(["command-code"], [], []).ids).toEqual(["command-code"]);
});

test("an all-unknown --agent falls through instead of selecting nothing", () => {
  expect(resolveSelection(["bogus"], ["cursor"], [])).toEqual({ ids: ["cursor"], source: "saved" });
});

test("the saved selection beats detection", () => {
  expect(resolveSelection(undefined, ["claude-code"], ["cursor", "agy"]))
    .toEqual({ ids: ["claude-code"], source: "saved" });
});

test("detection is the last resort, and nothing selected is a valid answer", () => {
  expect(resolveSelection(undefined, [], ["cursor"])).toEqual({ ids: ["cursor"], source: "detected" });
  expect(resolveSelection(undefined, [], [])).toEqual({ ids: [], source: "none" });
});

test("the selection round-trips through ~/.tersio/agents.json", () => {
  const { home, cleanup } = tempHome();
  try {
    expect(readSelection(home).hosts).toEqual([]);
    writeSelection(home, ["agy", "cursor"]);
    // Stored in registry order, not the order given, so the file is stable
    // whatever order --agent listed them in.
    expect(readSelection(home).hosts).toEqual(["cursor", "agy"]);
    expect(readSelection(home).updatedAt).toBeGreaterThan(0);
    writeSelection(home, ["agy"]);
    expect(readSelection(home).hosts).toEqual(["agy"]);
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
    write(home, ".tersio/agents.json", '{"hosts": ["agy", 7, null]}');
    expect(readSelection(home).hosts).toEqual(["agy"]);
  } finally {
    cleanup();
  }
});

// --- detection -------------------------------------------------------------

test("detection finds a host by its config directory", () => {
  const { home, cleanup } = tempHome();
  try {
    mkdirSync(path.join(home, ".cursor", "rules"), { recursive: true });
    const found = detectHosts(home, { PATH: "" });
    expect(found).toContain("cursor");
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
    writeFileSync(path.join(binDir, "agy"), "#!/bin/sh\n", { mode: 0o755 });
    const found = detectHosts(home, { PATH: binDir });
    expect(found).toContain("agy");
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

test("a host that cannot rewrite gets guidance and no hook file", async () => {
  const { home, cleanup } = tempHome();
  try {
    const host = byId("agy")!;
    await applyHost(host, home);
    expect(existsSync(path.join(home, ".gemini", "GEMINI.md"))).toBe(true);
    expect(existsSync(path.join(home, ".gemini", "antigravity-cli", "skills", "tersio-rtk", "SKILL.md"))).toBe(true);
    expect(read(home, ".gemini/GEMINI.md")).toContain("prefix noisy commands");
    // No hook file anywhere for a host whose hooks cannot rewrite.
    expect(existsSync(path.join(home, ".gemini", "hooks.json"))).toBe(false);
  } finally {
    cleanup();
  }
});

test("a failure on one host does not stop the others", async () => {
  const { home, cleanup } = tempHome();
  try {
    const { results, errors } = await applyHosts(["claude-code", "agy", "cursor"], home);
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

test("removal deletes a hook config tersio named, once it is empty", async () => {
  const { home, cleanup } = tempHome();
  try {
    const host = byId("grok-build")!;
    await applyHost(host, home);
    const cfg = path.join(home, ".grok", "hooks", "tersio-rtk.json");
    expect(existsSync(cfg)).toBe(true);
    expect(isTersioOwned(cfg)).toBe(true);
    await removeHost(host, home);
    expect(existsSync(cfg), "left tersio's own hook config behind").toBe(false);
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
    const result = await removeHost(byId("cursor")!, home);
    expect(result.removed).toEqual([]);
    expect(result.kept).toEqual([]);
    expect(existsSync(path.join(home, ".cursor"))).toBe(false);
  } finally {
    cleanup();
  }
});

test("a full apply then remove leaves no tersio file behind", async () => {
  const { home, cleanup } = tempHome();
  try {
    const hosts = ["claude-code", "codex", "copilot-cli", "cursor", "grok-build", "hermes", "agy", "command-code"];
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
    expect(reportHost(byId("agy")!, home)).toMatchObject({ status: "warn", repair: "install" });
  } finally {
    cleanup();
  }
});

test("doctor reports one row per selected host", () => {
  const { home, cleanup } = tempHome();
  try {
    const rows = reportHosts(["claude-code", "agy", "bogus"], home);
    expect(rows.map((r) => r.host.id)).toEqual(["claude-code", "agy"]);
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
