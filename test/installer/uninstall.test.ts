import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cliEnv } from "../helpers/env.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const installer = path.join(root, "tersio.js");
const SELF = "@krtclcdy/tersio";
const PONYTAIL = "@dietrichgebert/ponytail";

function run(home: string, ...args: string[]) {
  return spawnSync(process.execPath, [installer, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 15000,
    env: cliEnv(home),
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
    ["extensions:", "  - ./extensions/caveman-session/index.ts", "  - ./extensions/combo-toggle/index.ts", "  - ./extensions/shared/mode-reinforcement.ts", "  - ./extensions/rtk.ts", "  - /home/u/.omp/agent/extensions/rtk.ts", "  - ./extensions/ponytail-pi-extension/index.js", ""].join("\n"),
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
  // Backups this CLI leaves behind.
  writeFileSync(path.join(home, ".omp", "agent", "config.yml.bak"), "extensions: []\n", "utf8");
  const pluginCaveman = path.join(pluginsDir, "node_modules", SELF, "extensions", "caveman-session");
  mkdirSync(pluginCaveman, { recursive: true });
  writeFileSync(path.join(pluginCaveman, "rule.md"), "fetched rule", "utf8");
  writeFileSync(path.join(pluginCaveman, "rule.md.bak"), "previous rule", "utf8");
  writeFileSync(path.join(pluginCaveman, "rule-ultra.md.bak"), "previous ultra", "utf8");
  writeFileSync(path.join(pluginCaveman, "rule-megacave.md.bak"), "previous wenyan", "utf8");
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
    // The wiring goes with the rest, or OMP keeps loading a hook for a package
    // that is gone. The binary stays: it is a shared tool on PATH.
    expect(existsSync(path.join(extDir, "rtk.ts")), "rtk wiring removed").toBeFalsy();
    expect(config).not.toMatch(/rtk\.ts/);
    expect(config).not.toMatch(/ponytail/);
    expect(!existsSync(path.join(home, ".omp", "agent", "config.yml.bak")), "config.yml backup removed").toBeTruthy();
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("uninstall removes the caveman rule backup from the plugin tree", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-uninstall-"));
  try {
    seed(home);
    const result = run(home, "uninstall", "--yes");

    expect(result.status, result.stderr).toBe(0);
    const cavemanDir = path.join(home, ".omp", "plugins", "node_modules", SELF, "extensions", "caveman-session");
    expect(!existsSync(cavemanDir), "plugin tree removed").toBeTruthy();
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("uninstall dry-run leaves backups in place", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-uninstall-"));
  try {
    seed(home);
    const cavemanDir = path.join(home, ".omp", "plugins", "node_modules", SELF, "extensions", "caveman-session");
    const result = run(home, "uninstall", "--yes", "--dry-run");

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(path.join(home, ".omp", "agent", "config.yml.bak")), "config.yml backup kept on dry run").toBeTruthy();
    for (const name of ["rule.md.bak", "rule-ultra.md.bak", "rule-megacave.md.bak"]) {
      expect(existsSync(path.join(cavemanDir, name)), `${name} kept on dry run`).toBeTruthy();
    }
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

// Neither `--host pi` nor auto-selecting the only installed host reached a
// prompt, so pi files were removed with no confirmation and nothing to review.
// From the install manifest: a hand-written copy drifted, and the drift made a
// complete install look absent, so uninstall skipped.
const { TREE_FILES: PI_TREE } = await import(new URL("file:///" + path.join(root, "cli/manifest.ts").replace(/\\/g, "/")).href);

function seedPi(home: string): void {
  const extDir = path.join(home, ".pi", "agent", "extensions");
  for (const rel of PI_TREE) {
    const target = path.join(extDir, rel);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, "// seeded", "utf8");
  }
  mkdirSync(path.join(home, ".tersio"), { recursive: true });
  writeFileSync(path.join(home, ".tersio", "settings.json"), "{}", "utf8");
}

function runPi(home: string, answer: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [installer, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 15000,
    env: cliEnv(home),
    input: `${answer}\n`,
  });
  const extDir = path.join(home, ".pi", "agent", "extensions");
  return { result, extDir, intact: existsSync(path.join(extDir, "caveman-session", "index.ts")) };
}

test("uninstall --host pi lists what it removes and aborts on a declined confirm", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-uninstall-pi-"));
  try {
    seedPi(home);
    const { result, extDir, intact } = runPi(home, "n", "uninstall", "--host", "pi");

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Will remove:/);
    expect(result.stdout).toMatch(/Proceed\? \[y\/N\]/);
    expect(result.stdout).toMatch(/Aborted/);
    expect(intact, "caveman-session kept after declining").toBeTruthy();
    expect(existsSync(path.join(home, ".tersio", "settings.json")), "session defaults kept").toBeTruthy();
    expect(existsSync(extDir), "the pi tree still exists").toBeTruthy();
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("uninstall --host pi proceeds when the confirm is accepted", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-uninstall-pi-"));
  try {
    seedPi(home);
    const { result, intact } = runPi(home, "y", "uninstall", "--host", "pi");

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Proceed\? \[y\/N\]/);
    expect(intact, "caveman-session removed after confirming").toBeFalsy();
    expect(existsSync(path.join(home, ".tersio", "settings.json")), "session defaults removed").toBeFalsy();
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("uninstall --host pi --yes removes without prompting", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-uninstall-pi-"));
  try {
    seedPi(home);
    const { result, intact } = runPi(home, "", "uninstall", "--host", "pi", "--yes");

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout, "no prompt when --yes is given").not.toMatch(/Proceed\?/);
    expect(intact, "caveman-session removed").toBeFalsy();
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// Loose extensions/rtk.ts was a silent no-op for pi; preview must mention it.
function seedPiRtk(home: string): string {
  const wiring = path.join(home, ".pi", "agent", "extensions", "rtk.ts");
  writeFileSync(wiring, "// rtk wiring", "utf8");
  return wiring;
}

test("uninstall --host pi --remove-rtk removes the rtk wiring file", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-uninstall-pi-"));
  try {
    seedPi(home);
    const wiring = seedPiRtk(home);
    const { result } = runPi(home, "", "uninstall", "--host", "pi", "--yes", "--remove-rtk");

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout, "preview lists the wiring file").toMatch(/rtk\.ts/);
    expect(existsSync(wiring), "rtk wiring removed").toBeFalsy();
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("uninstall --host pi keeps rtk wiring without --remove-rtk", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-uninstall-pi-"));
  try {
    seedPi(home);
    const wiring = seedPiRtk(home);
    const { result } = runPi(home, "", "uninstall", "--host", "pi", "--yes");

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(wiring), "rtk is the user's, so it stays").toBeTruthy();
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("uninstall --host pi --dry-run --remove-rtk leaves the wiring file in place", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-uninstall-pi-"));
  try {
    seedPi(home);
    const wiring = seedPiRtk(home);
    const { result } = runPi(home, "", "uninstall", "--host", "pi", "--dry-run", "--remove-rtk");

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/would remove/);
    expect(existsSync(wiring), "dry run removes nothing").toBeTruthy();
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
