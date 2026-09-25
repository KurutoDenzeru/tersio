import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const installer = path.join(root, "tersio.js");
const SELF = "@krtclcdy/tersio";
const PONYTAIL = "@dietrichgebert/ponytail";

function run(home: string, ...args: string[]) {
  return spawnSync(process.execPath, [installer, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 15000,
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
}

function seed(home: string) {
  const extDir = path.join(home, ".omp", "agent", "extensions");
  for (const dir of ["caveman-session", "rtk-session", "combo-toggle", "shared", "lib", "aaa-combo-boot", "ai-addons-updater"]) {
    mkdirSync(path.join(extDir, dir), { recursive: true });
    writeFileSync(path.join(extDir, dir, "index.js"), "// seeded", "utf8");
  }
  writeFileSync(path.join(extDir, "rtk.ts"), "// rtk omp wiring", "utf8");
  writeFileSync(
    path.join(home, ".omp", "agent", "config.yml"),
    ["extensions:", "  - ./extensions/caveman-session/index.ts", "  - ./extensions/combo-toggle/index.ts", "  - ./extensions/shared/mode-reinforcement.ts", "  - ./extensions/ponytail-pi-extension/index.js", ""].join("\n"),
    "utf8",
  );
  const pluginsDir = path.join(home, ".omp", "plugins");
  mkdirSync(path.join(pluginsDir, "node_modules", PONYTAIL, "pi-extension"), { recursive: true });
  mkdirSync(path.join(pluginsDir, "node_modules", SELF), { recursive: true });
  writeFileSync(path.join(pluginsDir, "node_modules", PONYTAIL, "package.json"), "{}", "utf8");
  writeFileSync(path.join(pluginsDir, "node_modules", SELF, "package.json"), "{}", "utf8");
  writeFileSync(
    path.join(pluginsDir, "package.json"),
    JSON.stringify({ dependencies: { [PONYTAIL]: "x", [SELF]: "y" } }),
    "utf8",
  );
  writeFileSync(
    path.join(pluginsDir, "omp-plugins.lock.json"),
    JSON.stringify({ plugins: { [PONYTAIL]: {}, [SELF]: {} }, settings: {} }),
    "utf8",
  );
  mkdirSync(path.join(home, ".bun", "bin"), { recursive: true });
  writeFileSync(path.join(home, ".bun", "bin", "rtk"), "fake", "utf8");
}

test("uninstall removes extension dirs, self registration, and combo config entries", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-uninstall-"));
  try {
    seed(home);
    const result = run(home, "uninstall", "--yes");

    expect(result.status, result.stderr).toBe(0);
    const extDir = path.join(home, ".omp", "agent", "extensions");
    for (const dir of ["caveman-session", "rtk-session", "combo-toggle", "shared", "lib", "aaa-combo-boot", "ai-addons-updater"]) {
      expect(!existsSync(path.join(extDir, dir)), `${dir} removed`).toBeTruthy();
    }
    const pkg = JSON.parse(readFileSync(path.join(home, ".omp", "plugins", "package.json"), "utf8"));
    expect(!(SELF in pkg.dependencies), "self dep removed").toBeTruthy();
    expect(!existsSync(path.join(home, ".omp", "plugins", "node_modules", SELF)), "self package removed").toBeTruthy();
    const config = readFileSync(path.join(home, ".omp", "agent", "config.yml"), "utf8");
    expect(config).not.toMatch(/combo-toggle/);
    expect(config).not.toMatch(/mode-reinforcement/);
    expect(config).toMatch(/caveman-session/);
    // Ponytail ships with the presets, so a full uninstall removes it; the rtk binary stays.
    expect(!existsSync(path.join(home, ".omp", "plugins", "node_modules", PONYTAIL)), "ponytail removed by default").toBeTruthy();
    expect(existsSync(path.join(home, ".bun", "bin", "rtk")), "rtk binary kept").toBeTruthy();
    expect(existsSync(path.join(extDir, "rtk.ts")), "rtk OMP wiring kept with the binary").toBeTruthy();
    expect(config).not.toMatch(/ponytail/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("uninstall removes the bundled ponytail copy even with no legacy dep entry", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-uninstall-"));
  try {
    seed(home);
    // Post-bundle state: no separate dep or lock entry, only the
    // tersio-owned directory.
    const pluginsDir = path.join(home, ".omp", "plugins");
    writeFileSync(
      path.join(pluginsDir, "package.json"),
      JSON.stringify({ dependencies: { [SELF]: "y" } }),
      "utf8",
    );
    writeFileSync(
      path.join(pluginsDir, "omp-plugins.lock.json"),
      JSON.stringify({ plugins: { [SELF]: {} }, settings: {} }),
      "utf8",
    );
    const result = run(home, "uninstall", "--yes");

    expect(result.status, result.stderr).toBe(0);
    expect(!existsSync(path.join(pluginsDir, "node_modules", PONYTAIL)), "bundled ponytail removed").toBeTruthy();
    const config = readFileSync(path.join(home, ".omp", "agent", "config.yml"), "utf8");
    expect(config).not.toMatch(/ponytail/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("uninstall --keep-ponytail keeps the plugin, dep, lock entry, and config line", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-uninstall-"));
  try {
    seed(home);
    const result = run(home, "uninstall", "--yes", "--keep-ponytail");

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(path.join(home, ".omp", "plugins", "node_modules", PONYTAIL)), "ponytail package kept").toBeTruthy();
    const pkg = JSON.parse(readFileSync(path.join(home, ".omp", "plugins", "package.json"), "utf8"));
    expect(PONYTAIL in pkg.dependencies, "ponytail dep kept").toBeTruthy();
    const lock = JSON.parse(readFileSync(path.join(home, ".omp", "plugins", "omp-plugins.lock.json"), "utf8"));
    expect(PONYTAIL in lock.plugins, "ponytail lock entry kept").toBeTruthy();
    const config = readFileSync(path.join(home, ".omp", "agent", "config.yml"), "utf8");
    expect(config).toMatch(/ponytail/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("uninstall with removal flags drops ponytail, its lock entry, and the rtk binary", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-uninstall-"));
  try {
    seed(home);
    const result = run(home, "uninstall", "--yes", "--remove-ponytail", "--remove-rtk");

    expect(result.status, result.stderr).toBe(0);
    expect(!existsSync(path.join(home, ".omp", "plugins", "node_modules", PONYTAIL)), "ponytail package removed").toBeTruthy();
    const pkg = JSON.parse(readFileSync(path.join(home, ".omp", "plugins", "package.json"), "utf8"));
    expect(!(PONYTAIL in pkg.dependencies), "ponytail dep removed").toBeTruthy();
    const lock = JSON.parse(readFileSync(path.join(home, ".omp", "plugins", "omp-plugins.lock.json"), "utf8"));
    expect(!(PONYTAIL in lock.plugins), "ponytail lock entry removed").toBeTruthy();
    expect(!existsSync(path.join(home, ".bun", "bin", "rtk")), "rtk binary removed").toBeTruthy();
    expect(!existsSync(path.join(home, ".omp", "agent", "extensions", "rtk.ts")), "rtk OMP wiring removed with the binary").toBeTruthy();
    const config = readFileSync(path.join(home, ".omp", "agent", "config.yml"), "utf8");
    expect(config).not.toMatch(/ponytail/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("uninstall dry-run changes no files", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-uninstall-"));
  try {
    seed(home);
    const pluginsPkg = path.join(home, ".omp", "plugins", "package.json");
    const configPath = path.join(home, ".omp", "agent", "config.yml");
    const beforePkg = readFileSync(pluginsPkg, "utf8");
    const beforeConfig = readFileSync(configPath, "utf8");
    const result = run(home, "uninstall", "--yes", "--dry-run", "--remove-ponytail", "--remove-rtk");

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(pluginsPkg, "utf8")).toBe(beforePkg);
    expect(readFileSync(configPath, "utf8")).toBe(beforeConfig);
    expect(existsSync(path.join(home, ".omp", "agent", "extensions", "shared"))).toBeTruthy();
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// The preview is the consent prompt, so a host whose files are about to be
// removed must be named in it. This previously listed only OMP and OpenCode.
test("uninstall previews every selected agent, not just OMP and OpenCode", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-uninstall-agents-"));
  try {
    mkdirSync(path.join(home, ".omp", "agent"), { recursive: true });
    const install = spawnSync(
      process.execPath,
      [installer, "install", "--yes", "--agent", "omp,opencode,cursor,hermes,claude-code"],
      { cwd: root, encoding: "utf8", timeout: 120000, env: { ...process.env, HOME: home, USERPROFILE: home } },
    );
    expect(install.status, install.stderr).toBe(0);

    const result = run(home, "uninstall", "--yes", "--dry-run", "--remove-rtk");

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Cursor/);
    expect(result.stdout).toMatch(/Hermes/);
    expect(result.stdout).toMatch(/Claude Code/);
    // No version-specific OpenCode wording in user-facing output.
    expect(result.stdout).not.toMatch(/opencode v2/i);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 300000);

// The preview is the consent prompt, so it must name what is actually on disk.
// The stored selection is a preference: a host can be selected and then fail
// its write, and listing it as installed is noise that hides the hosts which
// are really there.
test("uninstall previews only the agents that actually have files", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-uninstall-scope-"));
  try {
    mkdirSync(path.join(home, ".omp", "agent"), { recursive: true });
    mkdirSync(path.join(home, ".tersio"), { recursive: true });
    // Five selected, but only three are installed.
    writeFileSync(
      path.join(home, ".tersio", "agents.json"),
      JSON.stringify({ agents: ["omp", "opencode", "cursor", "grok-build", "pi"] }),
      "utf8",
    );
    const install = spawnSync(
      process.execPath,
      [installer, "install", "--yes", "--agent", "omp,opencode,cursor"],
      { cwd: root, encoding: "utf8", timeout: 120000, env: { ...process.env, HOME: home, USERPROFILE: home } },
    );
    expect(install.status, install.stderr).toBe(0);

    const result = run(home, "uninstall", "--yes", "--dry-run", "--remove-rtk");

    expect(result.status, result.stderr).toBe(0);
    // Installed hosts appear, with what they have.
    expect(result.stdout).toMatch(/Cursor — rules, caveman skill/);
    expect(result.stdout).toMatch(/opencode rtk plugin/);
    // Selected but never installed hosts must not appear anywhere.
    expect(result.stdout).not.toMatch(/Grok Build/);
    expect(result.stdout).not.toMatch(/\bPi —/);
    // No version-specific OpenCode wording in user-facing output.
    expect(result.stdout).not.toMatch(/opencode v2/i);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 300000);

test("uninstall on a fresh home removes no agent files even when hosts are selected", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-uninstall-fresh-"));
  try {
    mkdirSync(path.join(home, ".omp", "agent"), { recursive: true });
    mkdirSync(path.join(home, ".tersio"), { recursive: true });
    writeFileSync(
      path.join(home, ".tersio", "agents.json"),
      JSON.stringify({ agents: ["omp", "opencode", "cursor", "grok-build", "pi"] }),
      "utf8",
    );

    const result = run(home, "uninstall", "--yes", "--dry-run", "--remove-rtk");

    expect(result.status, result.stderr).toBe(0);
    for (const label of ["Grok Build", "Cursor", "Pi"]) {
      expect(result.stdout, label).not.toContain(`${label} —`);
    }
    expect(result.stdout).not.toMatch(/would remove .*\.config\/opencode/);
    expect(result.stdout).not.toMatch(/would remove .*\.cursor\//);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 300000);

test("uninstall removes the previewed agents and keeps the user's own content", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-uninstall-roundtrip-"));
  try {
    mkdirSync(path.join(home, ".omp", "agent"), { recursive: true });
    const install = spawnSync(
      process.execPath,
      [installer, "install", "--yes", "--agent", "omp,opencode,cursor,claude-code"],
      { cwd: root, encoding: "utf8", timeout: 120000, env: { ...process.env, HOME: home, USERPROFILE: home } },
    );
    expect(install.status, install.stderr).toBe(0);

    const cursorRule = path.join(home, ".cursor", "rules", "tersio.mdc");
    const claudeMd = path.join(home, ".claude", "CLAUDE.md");
    appendFileSync(cursorRule, "\n## my own rule\n");
    appendFileSync(claudeMd, "\n## mine\n");

    const result = run(home, "uninstall", "--yes", "--remove-rtk");
    expect(result.status, result.stderr).toBe(0);

    // Everything Tersio wrote is gone.
    expect(existsSync(path.join(home, ".cursor", "skills", "tersio-caveman"))).toBe(false);
    expect(existsSync(path.join(home, ".cursor", "tersio-rtk-rewrite.mjs"))).toBe(false);
    expect(existsSync(path.join(home, ".claude", "skills", "tersio-rtk"))).toBe(false);
    expect(existsSync(path.join(home, ".config", "opencode", "plugins", "tersio-rtk.ts"))).toBe(false);
    // The user's own content survives.
    expect(readFileSync(cursorRule, "utf8")).toContain("my own rule");
    expect(readFileSync(claudeMd, "utf8")).toContain("mine");
    // The stored selection is cleared so a later install re-detects.
    expect(existsSync(path.join(home, ".tersio", "agents.json"))).toBe(false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 300000);

test("uninstall previews only files that exist, and lists the Pi rtk extension", () => {
  // A Pi-only machine never had the OMP extension directories, but the preview
  // listed all of them as "will remove" — noise that buried the one real line.
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-uninstall-preview-"));
  try {
    const piExt = path.join(home, ".pi", "agent", "extensions", "rtk.ts");
    mkdirSync(path.dirname(piExt), { recursive: true });
    writeFileSync(piExt, "export default async function () {}\n", "utf8");
    writeFileSync(path.join(home, ".pi", "agent", "AGENTS.md"), "<!-- tersio:start -->\nrule\n<!-- tersio:end -->\n", "utf8");
    mkdirSync(path.join(home, ".tersio"), { recursive: true });
    writeFileSync(path.join(home, ".tersio", "agents.json"), JSON.stringify({ agents: ["pi"] }), "utf8");

    const result = run(home, "uninstall", "--dry-run", "--remove-rtk");
    expect(result.status, result.stderr).toBe(0);
    const listed = result.stdout.split("\n").filter((l) => l.startsWith("  ") && !l.includes("[dry-run]"));
    // The real artifact is named.
    expect(listed.some((l) => l.includes(piExt)), `expected the Pi extension in:\n${listed.join("\n")}`).toBe(true);
    // Nothing that was never created is promised.
    for (const ghost of ["/.omp/agent/extensions/caveman-session", "/.omp/agent/extensions/rtk-session"]) {
      expect(listed.some((l) => l.includes(ghost)), `must not list absent ${ghost}`).toBe(false);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 60000);
