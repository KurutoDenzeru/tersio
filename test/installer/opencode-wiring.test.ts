import { expect, test } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { applyMarkedBlock, installOpenCodeRtk, openCodeAgentsPath, openCodePluginPath, removeMarkedBlock, removeOpenCodeRtk } from "../../cli/opencode-wiring.ts";
import { packCommands } from "../../cli/rules-pack.ts";
import { installer, repoRoot, tempHome, withHome } from "../helpers/home.ts";

const root = repoRoot;
const PLUGIN_SOURCE = readFileSync(path.join(root, "extensions", "opencode", "rtk-plugin.ts"), "utf8");
const START = "<!-- tersio:rtk:start -->";
const END = "<!-- tersio:rtk:end -->";

// Consumer-visible invariants only: the plugin lands where OpenCode V2
// auto-discovers it, the guidance block is idempotent, and removal restores
// the user's own AGENTS.md byte for byte.

test("install writes the plugin and guidance into the opencode config dir", async () => {
  const home = tempHome();
  try {
    await withHome(home, async () => {
      const result = await installOpenCodeRtk(PLUGIN_SOURCE, { quiet: true });
      expect(result).toEqual({ plugin: true, guidance: true, commands: 4 });

      const plugin = readFileSync(openCodePluginPath(), "utf8");
      expect(plugin).toBe(PLUGIN_SOURCE);
      // V2 loads only a default export with an id; a V1 function export is rejected.
      expect(plugin).toContain("id: 'tersio-rtk'");
      expect(plugin).toMatch(/export default plugin/);
      expect(plugin).not.toContain("@opencode-ai/plugin");

      const agents = readFileSync(openCodeAgentsPath(), "utf8");
      expect(agents).toContain(START);
      expect(agents).toContain(END);
      expect(agents).toContain("rtk git status");
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("reinstall is idempotent and never duplicates the guidance block", async () => {
  const home = tempHome();
  try {
    await withHome(home, async () => {
      await installOpenCodeRtk(PLUGIN_SOURCE, { quiet: true });
      const second = await installOpenCodeRtk(PLUGIN_SOURCE, { quiet: true });
      expect(second).toEqual({ plugin: false, guidance: false, commands: 0 });

      const agents = readFileSync(openCodeAgentsPath(), "utf8");
      expect(agents.split(START)).toHaveLength(2);
      expect(agents.split(END)).toHaveLength(2);
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("install preserves user content around the guidance block", async () => {
  const home = tempHome();
  try {
    await withHome(home, async () => {
      const configDir = path.join(home, ".config", "opencode");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(path.join(configDir, "AGENTS.md"), "# My rules\n\nAlways use tabs.\n", "utf8");

      await installOpenCodeRtk(PLUGIN_SOURCE, { quiet: true });
      const agents = readFileSync(openCodeAgentsPath(), "utf8");
      expect(agents).toMatch(/^# My rules\n\nAlways use tabs\./);
      expect(agents).toContain(START);
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a second install refreshes edited guidance instead of stacking blocks", async () => {
  const home = tempHome();
  try {
    await withHome(home, async () => {
      await installOpenCodeRtk(PLUGIN_SOURCE, { quiet: true });
      const agentsPath = openCodeAgentsPath();
      const tampered = readFileSync(agentsPath, "utf8").replace("rtk git status", "STALE TEXT");
      writeFileSync(agentsPath, tampered, "utf8");

      await installOpenCodeRtk(PLUGIN_SOURCE, { quiet: true });
      const agents = readFileSync(agentsPath, "utf8");
      expect(agents).toContain("rtk git status");
      expect(agents).not.toContain("STALE TEXT");
      expect(agents.split(START)).toHaveLength(2);
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("removeOpenCodeRtk deletes the plugin and restores AGENTS.md", async () => {
  const home = tempHome();
  try {
    await withHome(home, async () => {
      const configDir = path.join(home, ".config", "opencode");
      mkdirSync(configDir, { recursive: true });
      const agentsPath = path.join(configDir, "AGENTS.md");
      const original = "# My rules\n\nAlways use tabs.\n";
      writeFileSync(agentsPath, original, "utf8");

      await installOpenCodeRtk(PLUGIN_SOURCE, { quiet: true });
      expect(existsSync(openCodePluginPath())).toBe(true);

      const removed = await removeOpenCodeRtk({ quiet: true });
      expect(removed).toBe(true);
      expect(existsSync(openCodePluginPath())).toBe(false);
      expect(readFileSync(agentsPath, "utf8")).toBe(original);
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("removeOpenCodeRtk deletes an AGENTS.md that held only Tersio content", async () => {
  const home = tempHome();
  try {
    await withHome(home, async () => {
      await installOpenCodeRtk(PLUGIN_SOURCE, { quiet: true });
      await removeOpenCodeRtk({ quiet: true });
      expect(existsSync(openCodeAgentsPath())).toBe(false);
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("removeOpenCodeRtk is a no-op when nothing was installed", async () => {
  const home = tempHome();
  try {
    await withHome(home, () => removeOpenCodeRtk({ quiet: true })).then((removed) => {
      expect(removed).toBe(false);
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("dry-run writes nothing to disk", async () => {
  const home = tempHome();
  try {
    await withHome(home, async () => {
      await installOpenCodeRtk(PLUGIN_SOURCE, { quiet: true, dryRun: true });
      expect(existsSync(openCodePluginPath())).toBe(false);
      expect(existsSync(openCodeAgentsPath())).toBe(false);
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("dry-run removal reports without deleting", async () => {
  const home = tempHome();
  try {
    await withHome(home, async () => {
      await installOpenCodeRtk(PLUGIN_SOURCE, { quiet: true });
      await removeOpenCodeRtk({ quiet: true, dryRun: true });
      expect(existsSync(openCodePluginPath())).toBe(true);
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("marked-block helpers are symmetric and leave foreign content alone", () => {
  const start = "<!-- x:start -->";
  const end = "<!-- x:end -->";

  expect(applyMarkedBlock(null, "block", start, end)).toBe("block");
  // No trailing newline: the block is appended after a blank line, so the
  // user's own last line is preserved verbatim ahead of it.
  expect(applyMarkedBlock("user", "block", start, end)).toBe("user\n\nblock");
  expect(applyMarkedBlock("user\n", "block", start, end)).toBe("user\n\nblock");
  // Whitespace-only counts as empty: the block becomes the whole file rather
  // than being appended to padding.
  expect(applyMarkedBlock("  \n", "block", start, end)).toBe("block");

  const marked = `${start}\nblock\n${end}`;
  const once = applyMarkedBlock(`head\n\n${marked}\ntail\n`, marked, start, end);
  const twice = applyMarkedBlock(once, marked, start, end);
  expect(twice).toBe(once);
  expect(once).toBe(`head\n\n${marked}\ntail\n`);

  expect(removeMarkedBlock("no markers here", start, end)).toBe("no markers here");

  expect(removeMarkedBlock("  \n", start, end)).toBe("  \n");
});

// Regression: doctor warned "run: tersio install" for the plugin, but
// `doctor --fix rtk` never touched ~/.config/opencode, and the repair ran after
// the rtk download so an offline failure skipped it. Asserted strictly: the
// plugin must exist regardless of whether the network half succeeded.
test("doctor --fix rtk repairs a missing OpenCode plugin even when the rtk download fails", () => {
  const home = tempHome();
  try {
    // No PATH at all: `tar` is unresolvable, so the binary download fails and
    // the OpenCode repair must still run.
    const env = { ...process.env, HOME: home, USERPROFILE: home, PATH: home };
    mkdirSync(path.join(home, ".omp", "plugins"), { recursive: true });
    // The OpenCode host is present on this machine, so doctor must report it.
    mkdirSync(path.join(home, ".config", "opencode"), { recursive: true });

    const before = spawnSync(process.execPath, [installer, "doctor"], { cwd: root, encoding: "utf8", env, timeout: 20000 });
    expect(before.stdout, before.stderr).toMatch(/⚠️ OpenCode RTK plugin: warn not installed/);
    expect(before.stdout, before.stderr).toMatch(/⚠️ OpenCode rtk guidance: warn/);

    spawnSync(process.execPath, [installer, "doctor", "--fix", "rtk", "--yes"], { cwd: root, encoding: "utf8", env, timeout: 120000 });

    // Resolve against the spawned HOME. `openCodePluginPath()` reads *this*
    // process's HOME, where the plugin is already installed — the assertions
    // would pass for the wrong reason and fail only in CI.
    const pluginInHome = path.join(home, ".config", "opencode", "plugins", "tersio-rtk.ts");
    const agentsInHome = path.join(home, ".config", "opencode", "AGENTS.md");
    expect(existsSync(pluginInHome), "the OpenCode plugin must be written by the rtk repair scope").toBe(true);
    expect(readFileSync(pluginInHome, "utf8")).toBe(PLUGIN_SOURCE);
    expect(readFileSync(agentsInHome, "utf8")).toContain(START);

    const after = spawnSync(process.execPath, [installer, "doctor"], { cwd: root, encoding: "utf8", env, timeout: 20000 });
    expect(after.stdout, after.stderr).toMatch(/✅ OpenCode RTK plugin: ok/);
    expect(after.stdout, after.stderr).toMatch(/✅ OpenCode rtk guidance: ok/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 150000);

// OpenCode custom commands (https://opencode.ai/docs/commands): a markdown file
// per command in ~/.config/opencode/commands/, the filename becoming the slash
// command. These are prompt templates, not runtime hooks — they cannot flip
// extension state the way OMP's /caveman does, so the prompt states the mode
// for the rest of the conversation instead.

test("install writes the four command files with valid frontmatter and $ARGUMENTS", async () => {
  const home = tempHome();
  try {
    await withHome(home, async () => {
      await installOpenCodeRtk(PLUGIN_SOURCE, { quiet: true });
      for (const name of ["caveman", "rtk", "ponytail", "combo"]) {
        const file = path.join(home, ".config", "opencode", "commands", `${name}.md`);
        expect(existsSync(file), `${name}.md must be written`).toBe(true);
        const text = readFileSync(file, "utf8");
        // OpenCode needs frontmatter with a description, or the command has none.
        expect(text, `${name}.md frontmatter`).toMatch(/^---\ndescription: .+\n---\n/);
        expect(text, `${name}.md must take an argument`).toContain("$ARGUMENTS");
        expect(text, `${name}.md must be removable by marker`).toContain("<!-- tersio:command -->");
      }
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("the command text is the same mode body every other host receives", async () => {
  // Derived from cli/rules-pack.ts, so this guards the derivation rather than
  // re-asserting the text: if the two ever diverge, this fails.
  const home = tempHome();
  try {
    await withHome(home, async () => {
      await installOpenCodeRtk(PLUGIN_SOURCE, { quiet: true });
      const bodies = packCommands();
      const caveman = readFileSync(path.join(home, ".config", "opencode", "commands", "caveman.md"), "utf8");
      const rtkCmd = readFileSync(path.join(home, ".config", "opencode", "commands", "rtk.md"), "utf8");
      for (const line of bodies.caveman.split("\n").slice(0, 2)) {
        expect(caveman, "caveman body must match rules-pack").toContain(line);
      }
      for (const line of bodies.rtk.split("\n").slice(0, 2)) {
        expect(rtkCmd, "rtk body must match rules-pack").toContain(line);
      }
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("combo documents the four presets so /combo balanced is usable", async () => {
  const home = tempHome();
  try {
    await withHome(home, async () => {
      await installOpenCodeRtk(PLUGIN_SOURCE, { quiet: true });
      const combo = readFileSync(path.join(home, ".config", "opencode", "commands", "combo.md"), "utf8");
      for (const level of ["off", "medium", "balanced", "max"]) {
        expect(combo, `combo must document ${level}`).toContain(`\`${level}\``);
      }
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("uninstall removes every Tersio command and leaves the user's alone", async () => {
  const home = tempHome();
  try {
    await withHome(home, async () => {
      const dir = path.join(home, ".config", "opencode", "commands");
      mkdirSync(dir, { recursive: true });
      // A user command, and a user file that happens to share one of our names.
      writeFileSync(path.join(dir, "mine.md"), "---\ndescription: mine\n---\n\nkeep me\n", "utf8");
      writeFileSync(path.join(dir, "caveman.md"), "---\ndescription: my own\n---\n\nmy rules\n", "utf8");

      await installOpenCodeRtk(PLUGIN_SOURCE, { quiet: true });
      // Our overwrite of the user's caveman.md is recoverable.
      expect(readFileSync(path.join(dir, "caveman.md.bak"), "utf8")).toContain("my rules");

      await removeOpenCodeRtk({ quiet: true });
      expect(existsSync(path.join(dir, "caveman.md")), "ours must be gone").toBe(false);
      expect(existsSync(path.join(dir, "rtk.md")), "ours must be gone").toBe(false);
      expect(existsSync(path.join(dir, "ponytail.md")), "ours must be gone").toBe(false);
      expect(existsSync(path.join(dir, "combo.md")), "ours must be gone").toBe(false);
      expect(existsSync(path.join(dir, "caveman.md.bak")), "the .bak must be cleaned too").toBe(false);
      expect(existsSync(path.join(dir, "mine.md")), "the user's own command must survive").toBe(true);
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("dry-run writes no command files", async () => {
  const home = tempHome();
  try {
    await withHome(home, async () => {
      await installOpenCodeRtk(PLUGIN_SOURCE, { quiet: true, dryRun: true });
      expect(existsSync(path.join(home, ".config", "opencode", "commands", "caveman.md"))).toBe(false);
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
