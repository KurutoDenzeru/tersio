import test from "node:test";
import assert from "node:assert/strict";
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
    ["extensions:", "  - ./extensions/caveman-session/index.js", "  - ./extensions/combo-toggle/index.js", "  - ./extensions/shared/mode-reinforcement.js", "  - ./extensions/ponytail-pi-extension/index.js", ""].join("\n"),
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

    assert.equal(result.status, 0, result.stderr);
    const extDir = path.join(home, ".omp", "agent", "extensions");
    for (const dir of ["caveman-session", "rtk-session", "combo-toggle", "shared", "lib", "aaa-combo-boot", "ai-addons-updater"]) {
      assert.ok(!existsSync(path.join(extDir, dir)), `${dir} removed`);
    }
    const pkg = JSON.parse(readFileSync(path.join(home, ".omp", "plugins", "package.json"), "utf8"));
    assert.ok(!(SELF in pkg.dependencies), "self dep removed");
    assert.ok(!existsSync(path.join(home, ".omp", "plugins", "node_modules", SELF)), "self package removed");
    const config = readFileSync(path.join(home, ".omp", "agent", "config.yml"), "utf8");
    assert.doesNotMatch(config, /combo-toggle/);
    assert.doesNotMatch(config, /mode-reinforcement/);
    assert.match(config, /caveman-session/);
    // Ponytail ships with the presets, so a full uninstall removes it; the rtk binary stays.
    assert.ok(!existsSync(path.join(home, ".omp", "plugins", "node_modules", PONYTAIL)), "ponytail removed by default");
    assert.ok(existsSync(path.join(home, ".bun", "bin", "rtk")), "rtk binary kept");
    assert.ok(existsSync(path.join(extDir, "rtk.ts")), "rtk OMP wiring kept with the binary");
    assert.doesNotMatch(config, /ponytail/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("uninstall --keep-ponytail keeps the plugin, dep, lock entry, and config line", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-uninstall-"));
  try {
    seed(home);
    const result = run(home, "uninstall", "--yes", "--keep-ponytail");

    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(path.join(home, ".omp", "plugins", "node_modules", PONYTAIL)), "ponytail package kept");
    const pkg = JSON.parse(readFileSync(path.join(home, ".omp", "plugins", "package.json"), "utf8"));
    assert.ok(PONYTAIL in pkg.dependencies, "ponytail dep kept");
    const lock = JSON.parse(readFileSync(path.join(home, ".omp", "plugins", "omp-plugins.lock.json"), "utf8"));
    assert.ok(PONYTAIL in lock.plugins, "ponytail lock entry kept");
    const config = readFileSync(path.join(home, ".omp", "agent", "config.yml"), "utf8");
    assert.match(config, /ponytail/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("uninstall with removal flags drops ponytail, its lock entry, and the rtk binary", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-uninstall-"));
  try {
    seed(home);
    const result = run(home, "uninstall", "--yes", "--remove-ponytail", "--remove-rtk");

    assert.equal(result.status, 0, result.stderr);
    assert.ok(!existsSync(path.join(home, ".omp", "plugins", "node_modules", PONYTAIL)), "ponytail package removed");
    const pkg = JSON.parse(readFileSync(path.join(home, ".omp", "plugins", "package.json"), "utf8"));
    assert.ok(!(PONYTAIL in pkg.dependencies), "ponytail dep removed");
    const lock = JSON.parse(readFileSync(path.join(home, ".omp", "plugins", "omp-plugins.lock.json"), "utf8"));
    assert.ok(!(PONYTAIL in lock.plugins), "ponytail lock entry removed");
    assert.ok(!existsSync(path.join(home, ".bun", "bin", "rtk")), "rtk binary removed");
    assert.ok(!existsSync(path.join(home, ".omp", "agent", "extensions", "rtk.ts")), "rtk OMP wiring removed with the binary");
    const config = readFileSync(path.join(home, ".omp", "agent", "config.yml"), "utf8");
    assert.doesNotMatch(config, /ponytail/);
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

    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(pluginsPkg, "utf8"), beforePkg);
    assert.equal(readFileSync(configPath, "utf8"), beforeConfig);
    assert.ok(existsSync(path.join(home, ".omp", "agent", "extensions", "shared")));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
