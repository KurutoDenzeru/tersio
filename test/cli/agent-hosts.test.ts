import { expect, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { SpawnSyncReturns } from "node:child_process";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HOSTS, byId, OWN_PATH_HOSTS } from "../../cli/agent-hosts.ts";
import { installHost, mergeHookEntry, pruneHookEntry, renderHookConfig, removeHost, stripBlock } from "../../cli/host-writers.ts";
import { START } from "../../cli/rules-pack.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const installer = path.join(root, "tersio.js");
const ALL = HOSTS.map((h) => h.id);

function tempHome(): string {
  return mkdtempSync(path.join(os.tmpdir(), "tersio-hosts-"));
}

function withHome<T>(home: string, work: () => Promise<T> | T): Promise<T> {
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  return (async () => {
    try {
      return await work();
    } finally {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  })();
}

function run(home: string, argv: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [installer, ...argv], {
    cwd: root,
    encoding: "utf8",
    timeout: 120000,
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
}

// Registry integrity: a host entry that points nowhere or claims a capability
// the docs do not support is the failure mode that silently breaks a user.

test("every registry entry carries a docs source and a label", () => {
  for (const host of HOSTS) {
    expect(host.label, host.id).toBeTruthy();
    expect(host.source, `${host.id} must cite a docs URL`).toMatch(/^https:\/\//);
    expect(host.configDir, host.id).toBeTruthy();
  }
});

test("no two hosts share an id", () => {
  expect(new Set(ALL).size).toBe(HOSTS.length);
});

test("the matrix covers every agent named in issue 17", () => {
  // Guards against a host being dropped by accident during a refactor.
  expect(ALL).toEqual([
    "omp", "opencode", "claude-code", "codex", "gemini-cli",
    "copilot-cli", "cursor", "grok-build", "pi", "openclaw", "hermes",
  ]);
});

// omp and opencode are installed by their own wiring modules, so the generic
// emitters intentionally write nothing for them.
test("hosts with their own wiring module get no generic emitter files", () => {
  for (const id of OWN_PATH_HOSTS) {
    const host = byId(id);
    expect(host, id).toBeDefined();
    expect(host?.rulesFile, `${id} must not use the generic rules emitter`).toBeNull();
    expect(host?.skillsDir, `${id} must not use the generic skills emitter`).toBeNull();
  }
});

test("a host declaring an emitter path must have the capability that writes it", () => {
  for (const host of HOSTS) {
    if (OWN_PATH_HOSTS.includes(host.id)) continue;
    if (host.rulesFile !== null) expect(host.rules, `${host.id} has a rulesFile but rules=false`).toBe(true);
    if (host.skillsDir !== null) expect(host.skills, `${host.id} has a skillsDir but skills=false`).toBe(true);
  }
});

test("a host claiming rewrite always has a hook config to write", () => {
  for (const host of HOSTS) {
    if (OWN_PATH_HOSTS.includes(host.id) || !host.rewrite) continue;
    const cfg = host.rewriteConfig;
    expect(cfg, `${host.id} claims rewrite but has no rewriteConfig`).toBeDefined();
    expect(cfg?.configFile, host.id).toBeTruthy();
    expect(cfg?.event, host.id).toBeTruthy();
    expect(renderHookConfig(host), `${host.id} must render a hook config`).toBeTruthy();
  }
});


// Install: each host gets exactly the files it can actually load.

test("installing a host writes its rules file with the tersio block", async () => {
  const home = tempHome();
  try {
    await withHome(home, async () => {
      for (const id of ALL) {
        const host = byId(id);
        if (!host || host.rulesFile === null) continue;
        await installHost(host, { quiet: true });
        const file = path.join(home, host.rulesFile);
        expect(existsSync(file), `${id} rules file at ${host.rulesFile}`).toBe(true);
        const text = readFileSync(file, "utf8");
        expect(text, id).toContain(START);
        expect(text, id).toContain("Rust Token Killer");
      }
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a host with skills support gets one SKILL.md per mode", async () => {
  const home = tempHome();
  try {
    await withHome(home, async () => {
      for (const id of ALL) {
        const host = byId(id);
        if (!host?.skillsDir) continue;
        await installHost(host, { quiet: true });
        for (const mode of ["caveman", "ponytail", "rtk"]) {
          const file = path.join(home, host.skillsDir, `tersio-${mode}`, "SKILL.md");
          expect(existsSync(file), `${id} skill ${mode}`).toBe(true);
          const text = readFileSync(file, "utf8");
          // Agent Skills spec requires name + description frontmatter.
          expect(text, `${id}/${mode}`).toMatch(/^---\nname: tersio-/);
          expect(text, `${id}/${mode}`).toMatch(/description: /);
        }
      }
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("installing twice is idempotent", async () => {
  const home = tempHome();
  try {
    await withHome(home, async () => {
      const host = byId("claude-code");
      expect(host).toBeDefined();
      if (!host) return;
      await installHost(host, { quiet: true });
      const before = readFileSync(path.join(home, ".claude", "CLAUDE.md"), "utf8");
      const second = await installHost(host, { quiet: true });
      const after = readFileSync(path.join(home, ".claude", "CLAUDE.md"), "utf8");
      expect(after, "reinstall must not duplicate the block").toBe(before);
      expect(second.files, "a no-op reinstall writes nothing").toEqual([]);
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a user's own instruction file is preserved alongside the block", async () => {
  const home = tempHome();
  try {
    await withHome(home, async () => {
      const claudeMd = path.join(home, ".claude", "CLAUDE.md");
      mkdirSync(path.dirname(claudeMd), { recursive: true });
      writeFileSync(claudeMd, "# My rules\n\nAlways use tabs.\n", "utf8");

      const host = byId("claude-code");
      if (!host) return;
      await installHost(host, { quiet: true });
      const text = readFileSync(claudeMd, "utf8");
      expect(text).toContain("Always use tabs.");
      expect(text).toContain(START);
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// The rewriter is the feature; it must actually rewrite, per host protocol.

const REWRITE_CASES: Array<{ id: string; payload: unknown; expectIn: (out: string) => boolean }> = [
  { id: "claude-code", payload: { tool_name: "Bash", tool_input: { command: "git status --short" } }, expectIn: (o) => o.includes("updatedInput") },
  { id: "codex", payload: { tool_name: "Bash", tool_input: { command: "ls -la src" } }, expectIn: (o) => o.includes("updatedInput") },
  { id: "gemini-cli", payload: { tool_name: "run_shell_command", tool_input: { command: "find . -name x" } }, expectIn: (o) => o.includes("tool_input") },
  { id: "copilot-cli", payload: { toolName: "bash", toolArgs: { command: "git status" } }, expectIn: (o) => o.includes("modifiedArgs") },
  { id: "cursor", payload: { tool_name: "Shell", tool_input: { command: "ls -la src" } }, expectIn: (o) => o.includes("updated_input") },
  { id: "hermes", payload: { args: { command: "git status --short" } }, expectIn: (o) => o.includes('"modify"') },
];

test("each rewrite hook returns the shape its host documents", async () => {
  const home = tempHome();
  try {
    await withHome(home, async () => {
      for (const c of REWRITE_CASES) {
        const host = byId(c.id);
        if (!host?.rewriteConfig) continue;
        await installHost(host, { quiet: true });
        const script = path.join(home, path.dirname(host.rewriteConfig.configFile), "tersio-rtk-rewrite.mjs");
        expect(existsSync(script), `${c.id} rewrite script`).toBe(true);

        const r = spawnSync(process.execPath, [script], { encoding: "utf8", input: JSON.stringify(c.payload), timeout: 20000 });
        const out = r.stdout.trim();
        // rtk must be on PATH for a rewrite; skip the assertion when it is not,
        // but the script must still run and exit cleanly (fail-open).
        if (out === "") {
          expect(r.status, `${c.id} must exit 0 when there is nothing to rewrite`).toBe(0);
          continue;
        }
        const parsed = JSON.parse(out) as {
          hookSpecificOutput?: { updatedInput?: { command?: string }; tool_input?: { command?: string } };
          modifiedArgs?: { command?: string };
          updated_input?: { command?: string };
          args?: { command?: string };
        };
        const hookSpecific = parsed.hookSpecificOutput ?? {};
        const rewritten = hookSpecific.updatedInput?.command ?? hookSpecific.tool_input?.command
          ?? parsed.modifiedArgs?.command ?? parsed.updated_input?.command ?? parsed.args?.command;
        expect(rewritten ?? "", `${c.id} output shape: ${out}`).toContain("rtk");
        expect(c.expectIn(out), `${c.id} used the wrong protocol: ${out}`).toBe(true);
      }
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a rewrite hook exits 0 and stays silent on a command rtk cannot rewrite", async () => {
  const home = tempHome();
  try {
    await withHome(home, async () => {
      const host = byId("claude-code");
      if (!host?.rewriteConfig) return;
      await installHost(host, { quiet: true });
      const script = path.join(home, ".claude", "tersio-rtk-rewrite.mjs");
      const r = spawnSync(process.execPath, [script], {
        encoding: "utf8",
        input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "echo hello world" } }),
        timeout: 20000,
      });
      // Fail-open contract: no output means the host runs the command unchanged.
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe("");
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a malformed hook payload does not crash the rewriter", async () => {
  const home = tempHome();
  try {
    await withHome(home, async () => {
      const host = byId("claude-code");
      if (!host?.rewriteConfig) return;
      await installHost(host, { quiet: true });
      const script = path.join(home, ".claude", "tersio-rtk-rewrite.mjs");
      for (const bad of ["", "not json", "{}", '{"tool_input":{}}']) {
        const r = spawnSync(process.execPath, [script], { encoding: "utf8", input: bad, timeout: 20000 });
        expect(r.status, `input ${JSON.stringify(bad)}`).toBe(0);
        expect(r.stdout.trim(), `input ${JSON.stringify(bad)}`).toBe("");
      }
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// Hook config merging: these files hold the user's other hooks and settings.

test("merging keeps unrelated hooks already in the config", () => {
  const existing = JSON.stringify({ version: 1, hooks: { preToolUse: [{ type: "command", bash: "echo mine" }] } }, null, 2);
  const fresh = JSON.stringify({ version: 1, hooks: { preToolUse: [{ type: "command", bash: "node /x/tersio-rtk-rewrite.mjs" }] } }, null, 2);
  const merged = mergeHookEntry(existing, fresh);
  expect(merged).toContain("echo mine");
  expect(merged).toContain("tersio-rtk-rewrite.mjs");
});

test("re-merging replaces our entry instead of stacking copies", () => {
  const fresh = JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "node /x/tersio-rtk-rewrite.mjs" }] }] } }, null, 2);
  let config = mergeHookEntry(JSON.stringify({ hooks: {} }, null, 2), fresh);
  config = mergeHookEntry(config, fresh);
  config = mergeHookEntry(config, fresh);
  const occurrences = (JSON.parse(config).hooks.PreToolUse as unknown[]).filter(
    (e) => JSON.stringify(e).includes("tersio-rtk-rewrite.mjs"),
  ).length;
  expect(occurrences, config).toBe(1);
});

test("a malformed existing hook config is left untouched", () => {
  const broken = "{ not json at all";
  expect(mergeHookEntry(broken, JSON.stringify({ hooks: {} }))).toBe(broken);
});

test("pruning removes only our hook and keeps the rest of the file", () => {
  const config = JSON.stringify({
    version: 1,
    otherSetting: true,
    hooks: {
      preToolUse: [
        { type: "command", bash: "echo mine" },
        { type: "command", bash: "node /x/tersio-rtk-rewrite.mjs" },
      ],
    },
  }, null, 2);
  const pruned = pruneHookEntry(config);
  expect(pruned).not.toBeNull();
  expect(pruned).toContain("echo mine");
  expect(pruned).toContain("otherSetting");
  expect(pruned).not.toContain("tersio-rtk-rewrite.mjs");
});

test("pruning a config that held only our hook drops the hooks key", () => {
  const config = JSON.stringify({
    version: 1,
    hooks: { preToolUse: [{ type: "command", bash: "node /x/tersio-rtk-rewrite.mjs" }] },
  }, null, 2);
  const pruned = pruneHookEntry(config);
  expect(pruned).toContain("version");
  expect(pruned).not.toContain("tersio-rtk-rewrite.mjs");
  expect(pruned).not.toContain("hooks");
});

test("pruning a yaml hook removes the whole list item, not just its command", () => {
  const yaml = [
    "hooks:",
    "  pre_tool_call:",
    '    - matcher: "bash"',
    "      command: node /x/tersio-rtk-rewrite.mjs",
    "      timeout: 10",
    "      fail_closed: true",
    '    - matcher: "other"',
    "      command: echo mine",
    "",
  ].join("\n");
  const pruned = pruneHookEntry(yaml);
  expect(pruned).not.toBeNull();
  expect(pruned).not.toContain("tersio-rtk-rewrite.mjs");
  // Sibling keys must go with the entry, or the yaml is left dangling.
  expect(pruned).not.toContain("fail_closed: true");
  // The user's own hook and the list itself survive.
  expect(pruned).toContain("echo mine");
  expect(pruned).toContain("pre_tool_call:");
});

// Removal: only our content goes.

test("removing a host deletes its files but keeps the user's content", async () => {
  const home = tempHome();
  try {
    await withHome(home, async () => {
      const host = byId("claude-code");
      if (!host) return;
      await installHost(host, { quiet: true });

      const claudeMd = path.join(home, ".claude", "CLAUDE.md");
      writeFileSync(claudeMd, `${readFileSync(claudeMd, "utf8")}\n## mine\n`, "utf8");
      const settings = path.join(home, ".claude", "settings.json");
      const withUserHook = JSON.stringify({
        version: 1,
        hooks: {
          PreToolUse: [
            { matcher: "Bash", hooks: [{ type: "command", command: "echo mine" }] },
            { matcher: "Bash", hooks: [{ type: "command", command: "node /x/tersio-rtk-rewrite.mjs" }] },
          ],
        },
      }, null, 2);
      writeFileSync(settings, withUserHook, "utf8");

      await removeHost(host, { quiet: true });

      const mdLeft = readFileSync(claudeMd, "utf8");
      expect(mdLeft).toContain("## mine");
      expect(mdLeft).not.toContain(START);

      const settingsLeft = readFileSync(settings, "utf8");
      expect(settingsLeft).toContain("echo mine");
      expect(settingsLeft).not.toContain("tersio-rtk-rewrite.mjs");

      expect(existsSync(path.join(home, ".claude", "tersio-rtk-rewrite.mjs"))).toBe(false);
      expect(existsSync(path.join(home, ".claude", "skills", "tersio-rtk"))).toBe(false);
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("removing a host does not touch a file that was never ours", async () => {
  const home = tempHome();
  try {
    await withHome(home, async () => {
      const claudeMd = path.join(home, ".claude", "CLAUDE.md");
      mkdirSync(path.dirname(claudeMd), { recursive: true });
      writeFileSync(claudeMd, "# Only my rules\n", "utf8");

      const host = byId("claude-code");
      if (!host) return;
      await removeHost(host, { quiet: true });
      expect(readFileSync(claudeMd, "utf8")).toBe("# Only my rules\n");
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("stripBlock leaves an unmarked file byte-identical", () => {
  const user = "# mine\n\nno markers\n";
  expect(stripBlock(user)).toBe(user);
});

// End to end through the real CLI.

test("install --agent for every host exits clean and writes its files", () => {
  const home = tempHome();
  try {
    const result = run(home, ["install", "--yes", "--agent", ALL.join(",")]);
    expect(result.status, result.stderr).toBe(0);
    for (const label of ["Claude Code", "OpenAI Codex", "Gemini CLI", "GitHub Copilot CLI", "Cursor", "Grok Build", "Hermes"]) {
      expect(result.stdout, `expected a ${label} step`).toContain(label);
    }
    // Every host except openclaw documents a shell-rewrite hook.
    for (const dir of [".claude", ".codex", ".gemini", ".copilot", ".cursor", ".grok", ".hermes"]) {
      expect(existsSync(path.join(home, dir)), `${dir} should have been created`).toBe(true);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 300000);

test("doctor reports ok for a selected host, then warns after uninstall removes it", () => {
  const home = tempHome();
  try {
    expect(run(home, ["install", "--yes", "--agent", "omp,claude-code,cursor"]).status).toBe(0);

    const withHosts = run(home, ["doctor"]);
    expect(withHosts.status, withHosts.stderr).toBe(0);
    expect(withHosts.stdout).toMatch(/✅ Claude Code rules/);
    expect(withHosts.stdout).toMatch(/✅ Cursor rtk hook/);

    expect(run(home, ["uninstall", "--remove-rtk", "--yes"]).status).toBe(0);

    // Uninstall clears the stored selection, so doctor falls back to detection.
    // Claude's config dir survives, so its rows return as "not installed" —
    // which is the proof the removal actually took effect.
    expect(existsSync(path.join(home, ".tersio", "agents.json")), "uninstall clears the stored selection").toBe(false);
    const after = run(home, ["doctor"]);
    expect(after.stdout).toMatch(/⚠️ Claude Code rules: warn not installed/);
    expect(after.stdout).not.toMatch(/✅ Claude Code rules/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 300000);
