import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    // A full uninstall names OMP: the extension layer follows the selection, so a flagless run now keeps it rather than...
    const result = run(home, "uninstall", "--yes", "--agent", "omp");

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
    // Post-bundle state: no separate dep or lock entry, only the tersio-owned directory.
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
    const result = run(home, "uninstall", "--yes", "--agent", "omp");

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
    const result = run(home, "uninstall", "--yes", "--agent", "omp", "--keep-ponytail");

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
    const result = run(home, "uninstall", "--yes", "--agent", "omp", "--remove-ponytail", "--remove-rtk");

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

test("uninstall --agent pi clears its extension tree, keeps the layer and binary, and leaves a user rules file alone", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-uninstall-"));
  try {
    seed(home);
    mkdirSync(path.join(home, ".pi", "agent", "extensions"), { recursive: true });
    // A user's own global rules, in a path tersio no longer writes. It must survive.
    const userRules = path.join(home, ".pi", "agent", "AGENTS.md");
    writeFileSync(userRules, "# my rules\n", "utf8");
    const piRtk = path.join(home, ".pi", "agent", "extensions", "rtk.ts");
    writeFileSync(piRtk, "// rtk pi wiring", "utf8");
    const piTersio = path.join(home, ".pi", "agent", "extensions", "tersio.ts");
    writeFileSync(piTersio, "// tersio pi extension", "utf8");
    const result = run(home, "uninstall", "--yes", "--verbose", "--agent", "pi");

    expect(result.status, result.stderr).toBe(0);
    expect(!existsSync(piRtk), "pi rtk extension removed").toBeTruthy();
    expect(!existsSync(piTersio), "pi tersio extension removed").toBeTruthy();
    expect(!existsSync(path.join(home, ".pi", "agent", "skills", "tersio-caveman")), "pi skills removed").toBeTruthy();
    expect(existsSync(userRules), "a user's rules file is left alone").toBeTruthy();
    expect(readFileSync(userRules, "utf8"), "and left byte-for-byte").toBe("# my rules\n");
    expect(result.stdout).toMatch(/extensions\/rtk\.ts/);
    // The plan names only the selected host: the unselected OMP layer stays out of both the preview and the run.
    expect(result.stdout).not.toMatch(/Oh My Pi — \d+ extension director/);
    // Host-agnostic closing line: a Pi-only run must not say restart OMP.
    expect(result.stdout).toMatch(/Done — restart your agents/);
    expect(result.stdout).not.toMatch(/Restart OMP/);
    // A Pi-only run must not touch the OMP layer or the shared binary.
    expect(existsSync(path.join(home, ".omp", "agent", "extensions", "caveman-session", "index.js")), "OMP layer kept").toBeTruthy();
    expect(existsSync(path.join(home, ".bun", "bin", "rtk")), "rtk binary kept").toBeTruthy();
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
    const result = run(home, "uninstall", "--yes", "--dry-run", "--agent", "omp", "--remove-ponytail", "--remove-rtk");

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(pluginsPkg, "utf8")).toBe(beforePkg);
    expect(readFileSync(configPath, "utf8")).toBe(beforeConfig);
    expect(existsSync(path.join(home, ".omp", "agent", "extensions", "shared"))).toBeTruthy();
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
