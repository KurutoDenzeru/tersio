import { expect, test } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ensureExtensionInConfig,
  normalizeExtensionsKey,
  removeExtensionFromConfig,
} from "../../cli/common.ts";
import { GENERATED_TREE_FILES, TREE_FILES, sourcePath, treeFilesFor } from "../../cli/manifest.ts";
import {
  readCavemanDefault,
  readComboDefault,
  readPluginSettings,
  readRtkDefault,
} from "../../extensions/shared/plugin-settings.ts";
import { readUsageDb, syncUsageDb } from "../../extensions/shared/usage-store.ts";
import { ruleBodyProblem } from "../../extensions/shared/utils.ts";
import { sqliteExec } from "../../extensions/shared/sqlite.ts";
import { cliEnv, fakeExecutable, fakeRtkBin, hasSqlite, isWindows, withHome } from "../helpers/env.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const installer = path.join(root, "dist", "tersio.js");
const SELF = "@krtclcdy/tersio";

// Session defaults live in ~/.tersio/settings.json; callers pass the package-keyed shape the old lock used.
function writeLock(home: string, settings: Record<string, unknown>): void {
  const dir = path.join(home, ".tersio");
  mkdirSync(dir, { recursive: true });
  const values = (settings["@krtclcdy/tersio"] ?? settings) as Record<string, unknown>;
  writeFileSync(path.join(dir, "settings.json"), JSON.stringify(values, null, 2), "utf8");
}

test("readPluginSettings seeds from the OMP lock an older install wrote", () => {
  withHome((home) => {
    const dir = path.join(home, ".omp", "plugins");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "omp-plugins.lock.json"), JSON.stringify({
      plugins: {},
      settings: { "@krtclcdy/tersio": { comboDefault: "max", cavemanDefault: "wenyan", rtkDefault: true } },
    }), "utf8");
    expect(readComboDefault()).toBe("max");
    expect(readCavemanDefault()).toBe("wenyan");
    expect(readRtkDefault()).toBe(true);
  });
});

test("readPluginSettings prefers ~/.tersio/settings.json over the lock file", () => {
  withHome((home) => {
    writeLock(home, { "@krtclcdy/tersio": { comboDefault: "lite" } });
    const dir = path.join(home, ".omp", "plugins");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "omp-plugins.lock.json"), JSON.stringify({
      plugins: {},
      settings: { "@krtclcdy/tersio": { comboDefault: "max" } },
    }), "utf8");
    expect(readComboDefault()).toBe("lite");
  });
});

test("readPluginSettings returns defaults when no lock file exists", () => {
  withHome(() => {
    expect(readComboDefault()).toBe("off");
    expect(readCavemanDefault()).toBe("off");
    expect(readRtkDefault()).toBe(false);
    expect(readPluginSettings()).toEqual({});
  });
});

test("readPluginSettings picks up values from ~/.tersio/settings.json", () => {
  withHome((home) => {
    writeLock(home, { "@krtclcdy/tersio": { comboDefault: "max", cavemanDefault: "wenyan", rtkDefault: true } });
    expect(readComboDefault()).toBe("max");
    expect(readCavemanDefault()).toBe("wenyan");
    expect(readRtkDefault()).toBe(true);
  });
});

test("readPluginSettings ignores invalid values and other plugins", () => {
  withHome((home) => {
    writeLock(home, {
      "other-plugin": { comboDefault: "max" },
      "@krtclcdy/tersio": { comboDefault: "yolo", cavemanDefault: 42, rtkDefault: "yes" },
    });
    expect(readComboDefault()).toBe("off");
    expect(readCavemanDefault()).toBe("off");
    expect(readRtkDefault()).toBe(false);
  });
});

test("readPluginSettings tolerates a corrupt lock file", () => {
  withHome((home) => {
    const dir = path.join(home, ".omp", "plugins");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "omp-plugins.lock.json"), "{ not json", "utf8");
    expect(readComboDefault()).toBe("off");
    expect(readPluginSettings()).toEqual({});
  });
});

type RunResult = { status: number | null; stdout: string; stderr: string };

function run(...args: string[]): RunResult {
  // Missing home: user-scope dests never exist, so dry-run previews it all.
  const missingHome = path.join(root, "test", "definitely-missing-home");
  const result = spawnSync(process.execPath, [installer, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 15000,
    env: cliEnv(missingHome),
  });
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

test("installer accepts session-default flags and reports them", () => {
  const result = run("install", "--dry-run", "--yes", "--combo-default", "lite");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(/Defaults: combo=lite/);
  expect(result.stdout).toMatch(/RTK session — install session mode/);
  expect(result.stdout).toMatch(/Tersio commands — install \/tersio root command/);

  // A scripted flag written before the rename still lands on the lite preset.
  const retired = run("install", "--dry-run", "--yes", "--combo-default", "medium");
  expect(retired.status, retired.stderr).toBe(0);
  expect(retired.stdout).toMatch(/Defaults: combo=lite/);
  expect(retired.stdout).not.toMatch(/Invalid --combo-default/);
});

test("installer rejects invalid default values", () => {
  const badCombo = run("install", "--dry-run", "--yes", "--combo-default", "ultra");
  expect(badCombo.status).toBe(1);
  expect(badCombo.stderr).toMatch(/Invalid --combo-default/);

  const badRtk = run("install", "--dry-run", "--yes", "--rtk-default", "maybe");
  expect(badRtk.status).toBe(1);
  expect(badRtk.stderr).toMatch(/Invalid --rtk-default/);

  const badCaveman = run("install", "--dry-run", "--yes", "--caveman-default", "max");
  expect(badCaveman.status).toBe(1);
  expect(badCaveman.stderr).toMatch(/Invalid --caveman-default/);
});

test("installer rejects removed project/both scopes", () => {
  for (const scope of ["project", "both", "bogus"]) {
    const bad = run("install", "--dry-run", "--yes", "--scope", scope);
    expect(bad.status, scope).toBe(1);
    expect(bad.stderr).toMatch(/Project scope was removed/);
  }
  const legacy = run("install", "--dry-run", "--yes", "--scope", "user");
  expect(legacy.status, legacy.stderr).toBe(0);
});

test("installer dry-run installs every user-scope extension", () => {
  const result = run("install", "--dry-run", "--yes");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(/RTK session — install session mode/);
  expect(result.stdout).toMatch(/Caveman — install session mode and rule bodies/);
  expect(result.stdout).toMatch(/Tersio commands — install \/tersio root command/);
  expect(result.stdout).not.toMatch(/mode reinforcement/i);
});

test("installer does not add manifest-owned extensions to config.yml", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-install-registrations-"));
  const previous = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    const result = spawnSync(process.execPath, [installer, "install", "--dry-run", "--yes"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: cliEnv(home),
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toMatch(/would.*config\.yml.*(?:combo|ponytail)/i);
  } finally {
    if (previous.HOME === undefined) delete process.env.HOME;
    else process.env.HOME = previous.HOME;
    if (previous.USERPROFILE === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previous.USERPROFILE;
    rmTree(home);
  }
});

test("package manifest declares always-on extensions plus updater feature and settings", () => {
  const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
    omp?: { extensions?: string[]; features?: Record<string, unknown>; settings?: Record<string, unknown> };
  };
  for (const ext of manifest.omp?.extensions ?? []) {
    const compiled = path.join(root, ext);
    expect(existsSync(compiled), `always-on entry exists: ${ext}`).toBeTruthy();
  }
  expect(manifest.omp?.extensions).toEqual([
    "./extensions/caveman/index.ts",
    "./extensions/pstack/index.ts",
    "./extensions/rtk/session.ts",
    "./extensions/rtk/filter.ts",
    "./extensions/combo/index.ts",
    "./extensions/commands/index.ts",
  ]);
  const features = manifest.omp?.features ?? {};
  expect(Object.keys(features)).toEqual(["updater"]);
  const updater = features.updater as { default?: boolean; extensions?: string[] };
  expect(updater.default, "updater defaults on").toBe(true);
  for (const ext of updater.extensions ?? []) {
    const compiled = path.join(root, ext);
    expect(existsSync(compiled), `updater entry exists: ${ext}`).toBeTruthy();
  }
  const settings = manifest.omp?.settings ?? {};

  const combo = settings.comboDefault as { type?: string; values?: string[]; default?: string };
  expect(combo.type).toBe("enum");
  expect(combo.values).toEqual(["off", "lite", "balanced", "max"]);
  expect(combo.default).toBe("off");

  const rtk = settings.rtkDefault as { type?: string; default?: boolean };
  expect(rtk.type).toBe("boolean");
  expect(rtk.default).toBe(false);

  const currency = settings.currency as { type?: string; values?: string[]; default?: string };
  expect(currency.type).toBe("enum");
  expect(currency.values).toEqual(["USD", "PHP", "EUR", "GBP", "JPY", "KRW", "SGD", "AUD", "CAD", "INR"]);
  expect(currency.default).toBe("USD");
});

test("installer accepts --ponytail-default override and reports it", () => {
  const result = run("install", "--dry-run", "--yes", "--ponytail-default", "full");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(/ponytail=full/);
});

test("installer rejects review as a Ponytail default", () => {
  const bad = run("install", "--dry-run", "--yes", "--ponytail-default", "review");
  expect(bad.status).toBe(1);
  expect(bad.stderr).toMatch(/Invalid --ponytail-default/);
});

test("installer accepts a --pstack-default override and reports it", () => {
  const result = run("install", "--dry-run", "--yes", "--pstack-default", "on");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(/pstack=on/);
});

test("installer rejects a pstack level it does not have", () => {
  const bad = run("install", "--dry-run", "--yes", "--pstack-default", "full");
  expect(bad.status).toBe(1);
  expect(bad.stderr).toMatch(/Invalid --pstack-default/);
});

test("update rejects an unknown host before doing anything", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-update-host-"));
  try {
    const result = spawnSync(process.execPath, [installer, "update", "--host", "codex", "--yes"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: cliEnv(home),
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Invalid --host: codex/);
  } finally {
    rmTree(home);
  }
});

test("apply-update without flags preserves stored combo defaults", () => {
  // Clobber regression: `tersio update` delegates to --apply-update with no flags, wiping the default.
  const home = mkdtempSync(path.join(os.tmpdir(), "omp-preserve-test-"));
  try {
    writeLock(home, {
      "@krtclcdy/tersio": {
        comboDefault: "balanced",
        cavemanDefault: "full",
        rtkDefault: true,
        ponytailDefault: "full",
        pstackDefault: "on",
      },
    });
    const result = spawnSync(process.execPath, [installer, "--apply-update", "--dry-run", "--yes"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: cliEnv(home),
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Defaults: combo=balanced \(caveman=full · rtk=on · ponytail=full · pstack=on\)/);
  } finally {
    rmTree(home);
  }
});

// The OMP agent tree holds rtk's wiring only; an install drops older extension copies omp would merge.
const PACKAGE_VERSION = (JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { version: string }).version;
const extDir = (home: string): string => path.join(home, ".omp", "agent", "extensions");
const pluginExt = (home: string): string => path.join(home, ".omp", "plugins", "node_modules", "@krtclcdy", "tersio", "extensions");

// These two track upstream, so a networked install may fetch a newer revision than the bundle holds.
const UPSTREAM_BODIES = new Set(["caveman/rule-ultra.md", "caveman/rule-megacave.md"]);

/** Every declared file must land byte-identical: a step that forgets a directory leaves the published copy in place, and doctor then reports it stale. */
function expectTreeByteIdentical(base: string, files: readonly string[]): void {
  for (const rel of files) {
    if (GENERATED_TREE_FILES[rel] !== undefined) continue;
    const at = path.join(base, ...rel.split("/"));
    expect(existsSync(at), `${rel} written`).toBe(true);
    if (UPSTREAM_BODIES.has(rel)) continue;
    expect(readFileSync(at, "utf8"), `${rel} matches this build`).toBe(readFileSync(sourcePath(rel), "utf8"));
  }
}

// What an install before the single-owner fix left behind.
const RETIRED = ["ai-addons-updater", "combo-toggle", "lib", "rtk-filter", "rtk-session", "shared", "tersio-commands"];

function runOmpInstall(home: string, extraEnv: Record<string, string>, ...args: string[]) {
  return spawnSync(process.execPath, [installer, "install", "--host", "omp", ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 30000,
    env: cliEnv(home, extraEnv),
  });
}

/** A throwaway home whose agent tree looks like the live one before the fix. */
function tempHome(): string {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-omp-owner-"));
  const ext = extDir(home);
  mkdirSync(path.join(home, ".omp", "plugins"), { recursive: true });
  for (const dir of RETIRED) {
    mkdirSync(path.join(ext, dir), { recursive: true });
    writeFileSync(path.join(ext, dir, "index.ts"), "// retired copy\n", "utf8");
  }
  // rtk's own wiring, which config.yml registers by path, and a foreign directory.
  writeFileSync(path.join(ext, "rtk.ts"), "// rtk wiring\n", "utf8");
  mkdirSync(path.join(ext, "herdr"), { recursive: true });
  writeFileSync(path.join(ext, "herdr", "index.js"), "// not ours\n", "utf8");
  writeFileSync(path.join(home, ".omp", "agent", "config.yml"), "extensions:\n  - /x/rtk.ts\n", "utf8");
  return home;
}

/** Windows keeps a handle on a just-touched tree for a moment, so the removal retries instead of
 * throwing EBUSY out of a test's `finally` block. */
function rmTree(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}

/** The plugin state a successful install leaves, with a seeded rtk so no test downloads 18MB from GitHub. */
function pluginPresent(home: string): void {
  const pkg = path.join(home, ".omp", "plugins", "node_modules", "@krtclcdy", "tersio");
  mkdirSync(path.join(pkg, "extensions"), { recursive: true });
  writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "@krtclcdy/tersio", version: PACKAGE_VERSION }), "utf8");
  fakeRtkBin(path.join(home, ".bun", "bin"));
}

/** Both package managers fail, so no plugin is registered and the agent tree is the fallback. A seeded rtk
 * goes with it, because an absent one downloads 18MB from GitHub and the assertions here are about the tree. */
function noPackageManagers(home: string): Record<string, string> {
  fakeRtkBin(path.join(home, ".bun", "bin"));
  const stub = mkdtempSync(path.join(os.tmpdir(), "tersio-omp-nopm-"));
  fakeExecutable(stub, "npm", "exit 1", "exit /b 1");
  fakeExecutable(stub, "bun", "exit 1", "exit /b 1");
  return { PATH: [stub, process.env.PATH || ""].join(path.delimiter) };
}

test("dry run reports the retired copies and removes nothing", () => {
  const home = tempHome();
  try {
    pluginPresent(home);
    const before = readdirSync(extDir(home)).toSorted();
    const result = runOmpInstall(home, {}, "--dry-run", "--yes", "--verbose");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Add-ons load from: the OMP plugin manifest/);
    expect(result.stdout).toMatch(/Retired agent copies — remove/);
    // The manifest decides what omp loads, so the install reports the manifest write it would make.
    expect(result.stdout).toMatch(/would write .*@krtclcdy[\\/]tersio[\\/]package\.json/);
    expect(readdirSync(extDir(home)).toSorted()).toEqual(before);
  } finally {
    rmTree(home);
  }
});

test("a registered plugin writes the plugin tree and drops the agent copies", () => {
  const home = tempHome();
  try {
    pluginPresent(home);
    const result = runOmpInstall(home, {}, "--yes");
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(path.join(pluginExt(home), "combo", "index.ts")), "combo lands in the plugin tree").toBe(true);
    expect(existsSync(path.join(pluginExt(home), "caveman", "index.ts")), "caveman lands in the plugin tree").toBe(true);
    // omp loads no OpenCode entry, but the package ships one, so the install writes it as the repair does.
    expect(existsSync(path.join(pluginExt(home), "server.ts")), "the package entry lands too").toBe(true);
    for (const dir of RETIRED) {
      expect(existsSync(path.join(extDir(home), dir)), `${dir} removed`).toBe(false);
    }
    // rtk's wiring and anything foreign survive, and the config keeps its entries.
    expect(existsSync(path.join(extDir(home), "rtk.ts")), "rtk wiring kept").toBe(true);
    expect(existsSync(path.join(extDir(home), "herdr")), "foreign dir kept").toBe(true);
    expect(readFileSync(path.join(home, ".omp", "agent", "config.yml"), "utf8")).toMatch(/rtk\.ts/);
    expectTreeByteIdentical(pluginExt(home), treeFilesFor("opencode"));
  } finally {
    rmTree(home);
  }
});

// One build, or the tree holds two releases and fails to load.
test("the plugin package is pinned to this build, and a skewed tree is rewritten", () => {
  const home = tempHome();
  try {
    pluginPresent(home);
    const pkgDir = path.join(home, ".omp", "plugins", "node_modules", "@krtclcdy", "tersio");
    writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify({ name: "@krtclcdy/tersio", version: "99.0.0" }), "utf8");
    mkdirSync(path.join(pkgDir, "extensions", "shared"), { recursive: true });
    writeFileSync(path.join(pkgDir, "extensions", "shared", "utils.ts"), "// an older release\n", "utf8");
    const stub = mkdtempSync(path.join(os.tmpdir(), "tersio-omp-npm-"));
    fakeExecutable(stub, "npm", "exit 0", "exit /b 0");
    const result = runOmpInstall(home, { PATH: [stub, process.env.PATH || ""].join(path.delimiter) }, "--yes");
    expect(result.status, result.stderr).toBe(0);
    const pkg = JSON.parse(readFileSync(path.join(home, ".omp", "plugins", "package.json"), "utf8"));
    expect(pkg.dependencies["@krtclcdy/tersio"], "the plugin package is pinned to this build").toBe(PACKAGE_VERSION);
    expectTreeByteIdentical(pluginExt(home), treeFilesFor("opencode"));
  } finally {
    rmTree(home);
  }
});

test("without the plugin the agent tree is the fallback and keeps its copies", () => {
  const home = tempHome();
  try {
    const result = runOmpInstall(home, noPackageManagers(home), "--yes");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Add-ons load from: the agent tree/);
    for (const dir of RETIRED) {
      expect(existsSync(path.join(extDir(home), dir)), `${dir} kept as the fallback`).toBe(true);
    }
    expect(existsSync(path.join(extDir(home), "rtk.ts")), "rtk wiring kept").toBe(true);
  } finally {
    rmTree(home);
  }
});

// The normalizer lives in cli/common.ts (import-safe), so this exercises shared behavior directly.
test("config writer normalizes `extensions: null` before appending list items", () => {
  for (const candidate of ["extensions: null", "extensions: ~", "extensions: []", "extensions:"]) {
    const lines = ["foo: 1", candidate, "bar: 2"];
    expect(normalizeExtensionsKey(lines), candidate).toBe(true);
    expect(lines[1], candidate).toBe("extensions:");
  }
  const healthy = ["extensions: foo", "  - /x/y.js"];
  expect(normalizeExtensionsKey(healthy)).toBe(false);
  expect(healthy).toEqual(["extensions: foo", "  - /x/y.js"]);
});

function withConfig(body: string): { dir: string; file: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-config-"));
  const file = path.join(dir, "config.yml");
  writeFileSync(file, body, "utf8");
  return { dir, file };
}

test("ensure drops the legacy compiled twin instead of duplicating it", async () => {
  const { dir, file } = withConfig("extensions:\n  - /home/u/.omp/agent/extensions/combo-toggle/index.js\n");
  try {
    await ensureExtensionInConfig(file, "/home/u/.omp/agent/extensions/combo-toggle/index.ts", "combo", {});
    const body = readFileSync(file, "utf8");
    expect(body).toMatch(/combo-toggle\/index\.ts/);
    expect(body).not.toMatch(/combo-toggle\/index\.js/);
  } finally {
    rmTree(dir);
  }
});


test("ensure leaves .js entries alone when the new path is also .js", async () => {
  const { dir, file } = withConfig("extensions:\n  - /x/ponytail/pi-extension/index.js\n");
  try {
    await ensureExtensionInConfig(file, "/x/ponytail/pi-extension/index.js", "ponytail", {});
    expect(readFileSync(file, "utf8")).toMatch(/pi-extension\/index\.js/);
  } finally {
    rmTree(dir);
  }
});

test("retired extension cleanup removes absolute and relative matching registrations", async () => {
  const { dir, file } = withConfig("extensions:\n  - /x/agent/extensions/shared/mode-reinforcement.ts\n  - ./extensions/shared/mode-reinforcement.ts\n  - /x/read.ts\n");
  try {
    expect(await removeExtensionFromConfig(file, "/x/agent/extensions/shared/mode-reinforcement.ts", "retired mode reinforcement", {})).toBe(true);
    expect(readFileSync(file, "utf8")).toBe("extensions:\n  - /x/read.ts\n");
    expect(await removeExtensionFromConfig(file, "/x/agent/extensions/shared/mode-reinforcement.ts", "retired mode reinforcement", {})).toBe(false);
  } finally {
    rmTree(dir);
  }
});

function home(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  const agent = path.join(dir, ".pi", "agent");
  mkdirSync(agent, { recursive: true });
  writeFileSync(path.join(agent, "settings.json"), JSON.stringify({ packages: ["npm:pi-subagents", "npm:@dietrichgebert/ponytail"] }, null, 2));
  return dir;
}

const offline = (dir: string): NodeJS.ProcessEnv => cliEnv(dir, { PI_OFFLINE: "1" });

test("pi install writes a local Ponytail package and drops the npm spec", () => {
  const dir = home("tersio-pi-ponytail-");
  try {
    execFileSync(process.execPath, [installer, "install", "--host", "pi", "--yes"], {
      cwd: root, encoding: "utf8", timeout: 120000, env: offline(dir),
    });

    const agent = path.join(dir, ".pi", "agent");
    const pkg = JSON.parse(readFileSync(path.join(agent, "ponytail", "package.json"), "utf8")) as { pi?: { extensions: string[] } };
    expect(pkg.pi?.extensions).toEqual(["./pi-extension/index.js"]);
    expect(readFileSync(path.join(agent, "ponytail", "pi-extension", "index.js"), "utf8")).toMatch(/getPonytailInstructions/);
    expect(readFileSync(path.join(agent, "ponytail", "skills", "ponytail", "SKILL.md"), "utf8")).toMatch(/lazy senior developer/i);

    // A local path is what stops pi version-checking the package.
    const settings = JSON.parse(readFileSync(path.join(agent, "settings.json"), "utf8")) as { packages: string[] };
    expect(settings.packages).not.toContain("npm:@dietrichgebert/ponytail");
    expect(settings.packages).toContain(path.join(agent, "ponytail"));
    expect(settings.packages).toContain("npm:pi-subagents");
  } finally {
    rmTree(dir);
  }
}, 150000);

test("pi install writes every Caveman rule body", () => {
  const dir = home("tersio-pi-rules-");
  try {
    execFileSync(process.execPath, [installer, "install", "--host", "pi", "--yes"], {
      cwd: root, encoding: "utf8", timeout: 120000, env: offline(dir),
    });
    const caveman = path.join(dir, ".pi", "agent", "extensions", "caveman");
    // rule.md and rule-lite.md are our forks and ship verbatim; the other two track upstream, so byte equality would flake.
    expect(readFileSync(path.join(caveman, "rule.md"), "utf8")).toBe(readFileSync(path.join(root, "extensions", "caveman", "rule.md"), "utf8"));
    for (const name of ["rule-lite.md", "rule-megacave-lite.md", "rule-megacave-ultra.md"]) expect(readFileSync(path.join(caveman, name), "utf8")).toBe(readFileSync(path.join(root, "extensions", "caveman", name), "utf8"));
    for (const name of ["rule-ultra.md", "rule-megacave.md"]) {
      const body = readFileSync(path.join(caveman, name), "utf8");
      expect(ruleBodyProblem(body), `${name} must be a usable body`).toBeNull();
      expect(body, `${name} must keep its floor rules`).toMatch(/## Floor/);
    }
    expectTreeByteIdentical(path.join(dir, ".pi", "agent", "extensions"), treeFilesFor("pi"));
  } finally {
    rmTree(dir);
  }
}, 150000);

test("pi dry-run previews the local Ponytail package without writing", () => {
  const dir = home("tersio-pi-dry-");
  try {
    const before = readFileSync(path.join(dir, ".pi", "agent", "settings.json"), "utf8");
    const out = execFileSync(process.execPath, [installer, "install", "--host", "pi", "--dry-run", "--yes"], {
      cwd: root, encoding: "utf8", timeout: 60000, env: offline(dir),
    });
    expect(out).toMatch(/Ponytail — write the local pi package/);
    expect(readFileSync(path.join(dir, ".pi", "agent", "settings.json"), "utf8")).toBe(before);
  } finally {
    rmTree(dir);
  }
}, 90000);

test("pi uninstall removes the local Ponytail package and its settings entry", () => {
  const dir = home("tersio-pi-uninstall-");
  try {
    const agent = path.join(dir, ".pi", "agent");
    // Host detection needs a whole tree, so seed one before the uninstall runs.
    for (const rel of TREE_FILES) {
      const to = path.join(agent, "extensions", ...rel.split("/"));
      mkdirSync(path.dirname(to), { recursive: true });
      writeFileSync(to, "");
    }
    execFileSync(process.execPath, [installer, "uninstall", "--host", "pi", "--yes"], {
      cwd: root, encoding: "utf8", timeout: 120000, env: offline(dir),
    });

    const settings = JSON.parse(readFileSync(path.join(agent, "settings.json"), "utf8")) as { packages: string[] };
    expect(settings.packages).not.toContain(path.join(agent, "ponytail"));
    expect(existsSync(path.join(agent, "ponytail"))).toBe(false);
    expect(readFileSync(path.join(agent, "settings.json"), "utf8")).not.toMatch(SELF);
  } finally {
    rmTree(dir);
  }
}, 180000);

function opencodePluginHome(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-oc-plugin-"));
  const cfg = path.join(dir, ".config", "opencode");
  mkdirSync(cfg, { recursive: true });
  writeFileSync(path.join(cfg, "opencode.json"), JSON.stringify({
    plugins: ["/Users/me/.config/opencode/plugins/rtk.ts", "/Users/me/.config/opencode/plugins/herdr.js"],
  }, null, 2));
  // A seeded rtk is what the wire step binds. Without one every install fetches 18MB from GitHub, and a
  // rate-limited runner answers 403, which takes the run off the path these assertions cover.
  fakeRtkBin(path.join(dir, ".bun", "bin"));
  return dir;
}

function opencodePluginRun(dir: string, args: string[]): string {
  return execFileSync(process.execPath, [installer, ...args], {
    cwd: root, encoding: "utf8", timeout: 120000,
    env: cliEnv(dir, { PI_OFFLINE: "1" }),
  });
}

test("opencode install registers one plugin and drops the rtk entry", () => {
  const dir = opencodePluginHome();
  try {
    const out = opencodePluginRun(dir, ["install", "--host", "opencode", "--yes"]);
    const config = JSON.parse(readFileSync(path.join(dir, ".config", "opencode", "opencode.json"), "utf8")) as { plugins: string[] };
    // Registered entries carry the host's own separator, so `\` on Windows.
    expect(config.plugins).toEqual([
      expect.stringMatching(/[\\/]opencode[\\/]plugins[\\/]herdr\.js$/),
      expect.stringMatching(/[\\/]opencode[\\/]plugins[\\/]tersio$/),
    ]);
    expect(existsSync(path.join(dir, ".config", "opencode", "plugins", "rtk.ts"))).toBe(false);
    expect(out).toMatch(/no separate entry/);
    expectTreeByteIdentical(path.join(dir, ".config", "opencode", "plugins", "tersio"), treeFilesFor("opencode"));
  } finally {
    rmTree(dir);
  }
}, 150000);

test("doctor --fix also drops a leftover rtk plugin entry", () => {
  const dir = opencodePluginHome();
  try {
    const plugins = path.join(dir, ".config", "opencode", "plugins");
    mkdirSync(plugins, { recursive: true });
    writeFileSync(path.join(plugins, "rtk.ts"), "// stale rtk plugin\n", "utf8");
    const nested = path.join(plugins, "tersio", "opencode");
    mkdirSync(nested, { recursive: true });
    writeFileSync(path.join(nested, "server.ts"), "export default {}\n", "utf8");
    opencodePluginRun(dir, ["doctor", "--fix", "extensions", "--yes"]);
    expect(existsSync(path.join(plugins, "rtk.ts"))).toBe(false);
    const config = JSON.parse(readFileSync(path.join(dir, ".config", "opencode", "opencode.json"), "utf8")) as { plugins: string[] };
    expect(config.plugins.some((p) => p.endsWith("/plugins/rtk"))).toBe(false);
  } finally {
    rmTree(dir);
  }
}, 150000);
// Same `-session`/`-toggle` leftovers the omp tree grew; install retires them, a rule body in them still resolves.
test("opencode install retires the legacy `-session` and `-toggle` dirs", () => {
  const dir = opencodePluginHome();
  try {
    const plugin = path.join(dir, ".config", "opencode", "plugins", "tersio");
    for (const name of ["caveman-session", "rtk-session", "combo-toggle"]) {
      mkdirSync(path.join(plugin, name), { recursive: true });
      writeFileSync(path.join(plugin, name, "rule.md"), "STALE\n", "utf8");
    }
    opencodePluginRun(dir, ["install", "--host", "opencode", "--yes"]);

    for (const name of ["caveman-session", "rtk-session", "combo-toggle"]) {
      expect(existsSync(path.join(plugin, name)), name + " must be retired").toBe(false);
    }
    // The current copies are written, so the tree is still complete.
    expect(existsSync(path.join(plugin, "caveman", "rule.md"))).toBe(true);
  } finally {
    rmTree(dir);
  }
}, 150000);

// OpenCode v2 stores one row per message in sqlite and no longer writes the JSON tree.
const SCHEMA = `CREATE TABLE message (id text PRIMARY KEY, session_id text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL);
CREATE TABLE session_message (id text PRIMARY KEY, session_id text NOT NULL, type text NOT NULL, seq integer NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL);`;

function seed(dir: string, rows: Array<{ id: string; created: number; data: Record<string, unknown> }>): string {
  const db = path.join(dir, "opencode.db");
  const sql = [SCHEMA];
  for (const r of rows) {
    sql.push(
      `INSERT INTO message VALUES ('${r.id}','ses_a',${r.created},${r.created},'${JSON.stringify(r.data).replace(/'/g, "''")}');`,
    );
  }
  sqliteExec(db, sql.join(""));
  return db;
}

// Same rows, current on-disk shape: role in `type`, model under data.model.
function seedCurrent(dir: string, rows: Array<{ id: string; created: number; data: Record<string, unknown> }>): string {
  const db = path.join(dir, "opencode-v2.db");
  const sql = [SCHEMA.split("\n")[1]];
  for (const r of rows) {
    const type = typeof r.data.role === "string" ? r.data.role : "assistant";
    sql.push(
      `INSERT INTO session_message VALUES ('${r.id}','ses_a','${type}',1,${r.created},${r.created},'${JSON.stringify(r.data).replace(/'/g, "''")}');`,
    );
  }
  sqliteExec(db, sql.join(""));
  return db;
}

// Current on-disk shape: no `role` key, model under data.model.
function assistantCurrent(id: string, created: number, tokens: Record<string, number>): { id: string; created: number; data: Record<string, unknown> } {
  return {
    id,
    created,
    data: {
      id,
      model: { id: "muse-spark-1.3-contributor-free", providerID: "opencode" },
      tokens: { input: tokens.input, output: tokens.output, cache: { read: tokens.cacheRead, write: 0 } },
      time: { created, completed: created + 5000 },
    },
  };
}

// Current shape with tool calls, which live in the `content` parts rather than beside the tokens.
function assistantWithTools(id: string, created: number, tools: string[]): { id: string; created: number; data: Record<string, unknown> } {
  const content = [
    { type: "text", text: "working" },
    ...tools.map((name, i) => ({ type: "tool", id: `call_${i}`, name, state: { status: "completed" }, time: { created: created + i } })),
  ];
  return {
    id,
    created,
    data: {
      id,
      model: { id: "muse-spark-1.3-contributor-free", providerID: "opencode" },
      tokens: { input: 100, output: 10, cache: { read: 0, write: 0 } },
      time: { created, completed: created + 5000 },
      content,
    },
  };
}

function withEnv(dir: string, fn: () => void): void {
  const previous = {
    db: process.env.TERSIO_USAGE_DB,
    sessions: process.env.TERSIO_SESSIONS_DIR,
    oc: process.env.TERSIO_OPENCODE_DB,
    reset: process.env.TERSIO_RESET_FILE,
  };
  process.env.TERSIO_USAGE_DB = path.join(dir, "usage.db");
  process.env.TERSIO_SESSIONS_DIR = path.join(dir, "sessions");
  process.env.TERSIO_RESET_FILE = path.join(dir, "reset.json");
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// Chart keys fold the `-free` suffix away.
const MODEL_KEY = "opencode/opencode/muse-spark-1.3-contributor";

function assistant(id: string, created: number, tokens: Record<string, number>): { id: string; created: number; data: Record<string, unknown> } {
  return {
    id,
    created,
    data: {
      id,
      role: "assistant",
      providerID: "opencode",
      modelID: "muse-spark-1.3-contributor-free",
      tokens: { input: tokens.input, output: tokens.output, cache: { read: tokens.cacheRead, write: 0 } },
      time: { created, completed: created + 5000 },
    },
  };
}

test.runIf(hasSqlite())("sqlite message rows land in the ledger under the opencode host", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-oc-db-"));
  try {
    mkdirSync(path.join(dir, "sessions"), { recursive: true });
    const db = seed(dir, [
      { id: "msg_user", created: 1789800000000, data: { id: "msg_user", role: "user", time: { created: 1789800000000 } } },
      assistant("msg_a1", 1789800001000, { input: 100, output: 10, cacheRead: 500 }),
      assistant("msg_a2", 1789800002000, { input: 200, output: 20, cacheRead: 0 }),
    ]);
    withEnv(dir, () => {
      process.env.TERSIO_OPENCODE_DB = db;
      expect(syncUsageDb()).toBe(true);
      const tokens = readUsageDb()?.tokens;
      expect(tokens?.messages).toBe(2);
      expect(tokens?.byHost[MODEL_KEY]?.opencode?.input).toBe(300);
      // The msg id is the row primary key, so a request drawer can find the row.
      expect(tokens?.recent.map((r: { id?: string }) => r.id).sort()).toEqual(["msg_a1", "msg_a2"]);
      expect(tokens?.byModel[MODEL_KEY].input).toBe(300);
      // A second sync re-reads the overlap window only; the row count must not double.
      expect(syncUsageDb()).toBe(true);
      expect(readUsageDb()?.tokens.messages).toBe(2);
    });
  } finally {
    rmTree(dir);
  }
});

test.runIf(hasSqlite())("session_message rows (current shape) land under the opencode host", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-oc-db-v2-"));
  try {
    mkdirSync(path.join(dir, "sessions"), { recursive: true });
    const db = seedCurrent(dir, [
      { id: "msg_u", created: 1789800000000, data: { id: "msg_u", role: "user", time: { created: 1789800000000 } } },
      assistantCurrent("msg_n1", 1789800001000, { input: 300, output: 30, cacheRead: 700 }),
    ]);
    withEnv(dir, () => {
      process.env.TERSIO_OPENCODE_DB = db;
      expect(syncUsageDb()).toBe(true);
      const tokens = readUsageDb()?.tokens;
      // The user row is skipped; one assistant row, id kept for the request drawer.
      expect(tokens?.messages).toBe(1);
      expect(tokens?.byModel[MODEL_KEY].input).toBe(300);
      expect(tokens?.recent[0]?.id).toBe("msg_n1");
    });
  } finally {
    rmTree(dir);
  }
});

test.runIf(hasSqlite())("a zero-token message is skipped and a missing db is a no-op", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-oc-db-empty-"));
  try {
    mkdirSync(path.join(dir, "sessions"), { recursive: true });
    const db = seed(dir, [assistant("msg_zero", 1789800001000, { input: 0, output: 0, cacheRead: 0 })]);
    withEnv(dir, () => {
      process.env.TERSIO_OPENCODE_DB = db;
      expect(syncUsageDb()).toBe(true);
      expect(readUsageDb()?.tokens.messages).toBe(0);
      process.env.TERSIO_OPENCODE_DB = path.join(dir, "absent.db");
      expect(syncUsageDb()).toBe(true);
      expect(readUsageDb()?.tokens.messages).toBe(0);
    });
  } finally {
    rmTree(dir);
  }
});

// Output past 1MB was silently dropped.
test.runIf(hasSqlite())("a session_message table past 1MB still syncs and reads back", {
  // The store takes ~60s on a Windows runner and ~300s under load, so the budget is loose.
  timeout: isWindows() ? 420000 : 30000,
}, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-oc-db-big-"));
  try {
    mkdirSync(path.join(dir, "sessions"), { recursive: true });
    const db = path.join(dir, "opencode-big.db");
    sqliteExec(db, SCHEMA.split("\n")[1]);
    // Long model ids push each row past ~500 bytes, so 2500 rows clear 1MB.
    const bigModel = `bench-${"m".repeat(400)}`;
    const base = 1789800000000;
    const rows: string[] = [];
    for (let i = 0; i < 2500; i += 1) {
      const id = `msg_big${String(i).padStart(5, "0")}`;
      const created = base + i * 1000;
      const data = JSON.stringify({
        id,
        model: { id: bigModel, providerID: "opencode" },
        tokens: { input: 100 + i, output: 10, cache: { read: 0, write: 0 } },
        time: { created, completed: created + 1000 },
      }).replace(/'/g, "''");
      rows.push(
        `INSERT INTO session_message VALUES ('${id}','ses_a','assistant',${i + 1},${created},${created},'${data}');`,
      );
      if (rows.length >= 500) {
        // Via stdin: Linux caps one argv string at 128KB (E2BIG), input has no such cap.
        sqliteExec(db, rows.join(""));
        rows.length = 0;
      }
    }
    if (rows.length) sqliteExec(db, rows.join(""));
    withEnv(dir, () => {
      process.env.TERSIO_OPENCODE_DB = db;
      expect(syncUsageDb()).toBe(true);
      expect(readUsageDb()?.tokens.messages).toBe(2500);
    });
  } finally {
    rmTree(dir);
  }
});

// Tool names ride in `content` parts the token query skips; the marker re-reads the table so old rows gain them.
test.runIf(hasSqlite())("tool names are read from content parts and backfill a store that has none", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-oc-tools-"));
  try {
    mkdirSync(path.join(dir, "sessions"), { recursive: true });
    const db = seedCurrent(dir, [
      assistantCurrent("msg_plain", 1789800000000, { input: 100, output: 10, cacheRead: 0 }),
      assistantWithTools("msg_tools", 1789800005000, ["shell", "read"]),
    ]);
    withEnv(dir, () => {
      process.env.TERSIO_OPENCODE_DB = db;
      expect(syncUsageDb()).toBe(true);
      let tokens = readUsageDb()?.tokens;
      expect(tokens?.messages).toBe(2);
      // Names come from the parts, not from the row the tokens live on.
      expect(Object.keys(tokens?.byTool ?? {}).sort()).toEqual(["read", "shell"]);

      // Pre-tools store: every row at `[]` and the marker cleared; one sync must re-read and not double any row.
      const usageDb = process.env.TERSIO_USAGE_DB as string;
      sqliteExec(usageDb, `UPDATE messages SET tools='[]' WHERE h='opencode'; DELETE FROM meta WHERE k='opencode_tools';`);
      expect(syncUsageDb()).toBe(true);
      tokens = readUsageDb()?.tokens;
      expect(tokens?.messages).toBe(2);
      expect(Object.keys(tokens?.byTool ?? {}).sort()).toEqual(["read", "shell"]);
    });
  } finally {
    rmTree(dir);
  }
});

// Each extensions/<base> import needs packed .js (CLI) and .ts (OMP); v2.20.0 shipped .ts only and crashed.
function cliExtensionBases(): Set<string> {
  const bases = new Set<string>();
  for (const file of readdirSync(path.join(root, "cli"))) {
    if (!file.endsWith(".ts")) continue;
    for (const line of readFileSync(path.join(root, "cli", file), "utf8").split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("import type ")) continue;
      const match = trimmed.match(/from ["']\.\.\/extensions\/([^"']+)["']/);
      if (match) bases.add(match[1].replace(/\.ts$/, ""));
    }
  }
  return bases;
}

function packedFiles(): Set<string> {
  const which = spawnSync("bun", ["--version"], { encoding: "utf8" });
  expect(which.status, "bun is required to pack (run: bun install)").toBe(0);
  let out: string;
  try {
    out = execFileSync("bun", ["pm", "pack", "--dry-run"], { cwd: root, encoding: "utf8" });
  } catch (e) {
    expect.fail(`bun pm pack --dry-run failed (run bun run build first): ${(e as Error).message}`);
  }
  const files = new Set<string>();
  for (const line of out!.split("\n")) {
    const match = line.match(/^packed\s+\S+\s+(.+)$/);
    if (match) files.add(match[1].trim());
  }
  return files;
}

test("packed tarball carries both .js (CLI runtime) and .ts (OMP) for every CLI-used extension module", () => {
  const bases = cliExtensionBases();
  expect(bases.size > 0, "expected cli/*.ts to import extension modules").toBe(true);
  const packed = packedFiles();
  expect(packed).toContain("dashboard/dist/index.html");
  expect(packed).toContain("dashboard/dist/brand.webp");
  expect(packed).not.toContain("dashboard/app/src/App.tsx");
  expect(packed).not.toContain("dashboard/legacy/template.html");
  for (const base of [...bases].sort()) {
    expect(packed, `missing compiled runtime: dist/extensions/${base}.js`).toContain(`dist/extensions/${base}.js`);
    expect(packed, `missing OMP source: extensions/${base}.ts`).toContain(`extensions/${base}.ts`);
  }
});

test("packed tarball carries every Caveman rule body", () => {
  const packed = packedFiles();
  for (const name of ["rule.md", "rule-lite.md", "rule-megacave-lite.md", "rule-megacave-ultra.md", "rule-ultra.md", "rule-megacave.md"]) {
    expect(packed, `manifest-loaded Caveman must receive ${name}`).toContain(`extensions/caveman/${name}`);
  }
  // Bodies load at runtime; each level is its own body; contract in test/extensions/modes.test.ts.
  for (const name of ["rule.md", "rule-lite.md", "rule-megacave-lite.md", "rule-megacave-ultra.md", "rule-ultra.md", "rule-megacave.md"]) {
    expect(ruleBodyProblem(readFileSync(path.join(root, "extensions", "caveman", name), "utf8")),
      `${name} must pass the install-time body gate`).toBeNull();
  }
});

// A packed tree can list every file and still not boot, so run the packed CLI itself.
test.skipIf(process.platform === "win32")("the packed tarball boots and reports its version", () => {
  const version = (JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { version: string }).version;
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-pack-boot-"));
  try {
    execFileSync("bun", ["pm", "pack", "--destination", dir, "--quiet"], { cwd: root, encoding: "utf8" });
    const tarball = readdirSync(dir).find((name) => name.endsWith(".tgz"));
    if (!tarball) expect.unreachable("bun pm pack wrote a tarball");
    execFileSync("tar", ["-xzf", tarball, "-C", dir], { cwd: dir });
    // The repo's own node_modules stands in for an install, so no registry is needed.
    symlinkSync(path.join(root, "node_modules"), path.join(dir, "package", "node_modules"), "dir");
    const out = execFileSync(process.execPath, [path.join(dir, "package", "dist", "tersio.js"), "--version"], { encoding: "utf8" });
    expect(out.trim()).toBe(version);
  } finally {
    rmTree(dir);
  }
});

// An imported module missing from the manifest only fails at host load time.
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
  keywords: string[];
  omp: { extensions: string[]; skills: string[] };
  // Optional: pi loads the tree by convention; keywords make the package discoverable in the gallery.
  pi?: { extensions?: string[]; skills?: string[] };
};

const entries = [...pkg.omp.extensions, ...(pkg.pi?.extensions ?? [])];

function relativeImports(file: string): string[] {
  const body = readFileSync(path.join(root, file), "utf8");
  const specs: string[] = [];
  for (const re of [
    /(?:import|export)[^'"]*?from\s*['"](\.[^'"]+)['"]/g,
    /import\s*['"](\.[^'"]+)['"]/g,
    /import\(\s*['"](\.[^'"]+)['"]\s*\)/g,
  ]) {
    for (const m of body.matchAll(re)) specs.push(m[1]);
  }
  return specs;
}

// The transitive closure of relative imports under extensions/.
function importClosure(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry.replace(/^\.\//, "")];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file) || !file.startsWith("extensions/")) continue;
    seen.add(file);
    for (const spec of relativeImports(file)) {
      queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)).replace(/\.(ts|js)$/, ".ts"));
    }
  }
  return [...seen];
}

test("the extension entries in both manifests exist", () => {
  for (const entry of entries) {
    expect(() => readFileSync(path.join(root, entry), "utf8"), entry).not.toThrow();
  }
});

test("every module the extensions import is in the install manifest", () => {
  const installed = new Set(TREE_FILES);
  const missing: string[] = [];
  for (const entry of entries) {
    for (const file of importClosure(entry)) {
      const dest = file.replace(/^extensions\//, "");
      if (!installed.has(dest)) missing.push(`${entry} imports ${file} → ${dest}`);
    }
  }
  expect(missing, `the installed tree would fail to load:\n${missing.join("\n")}`).toEqual([]);
});

test("every manifest entry exists in the source tree", () => {
  for (const file of TREE_FILES) {
    expect(existsSync(sourcePath(file)), file).toBe(true);
  }
});

test("the package keeps the pi keywords, so the gallery can find it", () => {
  expect(pkg.keywords).toContain("pi");
  expect(pkg.keywords).toContain("pi-package");
});

test("no manifest points at a dependency path, which npm hoists out of the package", () => {
  // The bundled ponytail declares its own skills; a path through node_modules never exists in an installed package.
  for (const entry of [...pkg.omp.extensions, ...(pkg.pi?.extensions ?? [])]) {
    expect(entry, "manifest entries resolve inside the published package").not.toContain("node_modules/");
  }
});

test("the first-token timer is installed for pi", () => {
  // pi records no first-token latency; every host tree carries the file, and pi's loader is what runs it.
  expect(treeFilesFor("pi"), "pi loads the timer").toContain("timing/index.ts");
  expect(TREE_FILES, "the shared tree carries it, so pi's install can write it").toContain("timing/index.ts");
});

test("every host's tree declares the manifest entries it installs", () => {
  // A generated entry has no repo file, so the tree list, not TREE_FILES, is what each host must satisfy.
  for (const id of ["omp", "pi", "opencode"] as const) {
    const files = treeFilesFor(id);
    for (const file of files) {
      if (GENERATED_TREE_FILES[file] !== undefined) continue;
      expect(existsSync(sourcePath(file)), `${id} declares ${file}`).toBe(true);
    }
    // OpenCode alone loads server.ts; every other host must not receive it.
    if (id !== "opencode") expect(files, `${id} must not receive the OpenCode entry`).not.toContain("server.ts");
    if (id === "opencode") expect(files, "OpenCode needs its entry").toContain("server.ts");
  }
});

const PONYTAIL = "@dietrichgebert/ponytail";

function uninstallRun(home: string, ...args: string[]) {
  return spawnSync(process.execPath, [installer, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 15000,
    env: cliEnv(home),
  });
}

function uninstallSeed(home: string) {
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
  // Windows resolves and removes `rtk.exe`, so the seed carries the platform's own name.
  writeFileSync(path.join(home, ".bun", "bin", isWindows() ? "rtk.exe" : "rtk"), "fake", "utf8");
  writeFileSync(path.join(home, ".omp", "agent", "config.yml.bak"), "extensions: []\n", "utf8");
  const pluginCaveman = path.join(pluginsDir, "node_modules", SELF, "extensions", "caveman");
  mkdirSync(pluginCaveman, { recursive: true });
  writeFileSync(path.join(pluginCaveman, "rule.md"), "fetched rule", "utf8");
  writeFileSync(path.join(pluginCaveman, "rule.md.bak"), "previous rule", "utf8");
  writeFileSync(path.join(pluginCaveman, "rule-lite.md.bak"), "previous lite", "utf8");
  writeFileSync(path.join(pluginCaveman, "rule-megacave-lite.md.bak"), "previous megacave lite", "utf8");
  writeFileSync(path.join(pluginCaveman, "rule-megacave-ultra.md.bak"), "previous megacave ultra", "utf8");
  writeFileSync(path.join(pluginCaveman, "rule-ultra.md.bak"), "previous ultra", "utf8");
  writeFileSync(path.join(pluginCaveman, "rule-megacave.md.bak"), "previous wenyan", "utf8");
}

test("uninstall removes extension dirs, self registration, and combo config entries", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-uninstall-"));
  try {
    uninstallSeed(home);
    const result = uninstallRun(home, "uninstall", "--yes");

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
    expect(existsSync(path.join(home, ".bun", "bin", isWindows() ? "rtk.exe" : "rtk")), "rtk binary kept").toBeTruthy();
    // Wiring goes with the rest or OMP loads a hook for a gone package; the binary stays, shared on PATH.
    expect(existsSync(path.join(extDir, "rtk.ts")), "rtk wiring removed").toBeFalsy();
    expect(config).not.toMatch(/rtk\.ts/);
    expect(config).not.toMatch(/ponytail/);
    expect(!existsSync(path.join(home, ".omp", "agent", "config.yml.bak")), "config.yml backup removed").toBeTruthy();
  } finally {
    rmTree(home);
  }
});

test("uninstall removes the caveman rule backup from the plugin tree", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-uninstall-"));
  try {
    uninstallSeed(home);
    const result = uninstallRun(home, "uninstall", "--yes");

    expect(result.status, result.stderr).toBe(0);
    const cavemanDir = path.join(home, ".omp", "plugins", "node_modules", SELF, "extensions", "caveman");
    expect(!existsSync(cavemanDir), "plugin tree removed").toBeTruthy();
  } finally {
    rmTree(home);
  }
});

test("uninstall dry-run leaves backups in place", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-uninstall-"));
  try {
    uninstallSeed(home);
    const cavemanDir = path.join(home, ".omp", "plugins", "node_modules", SELF, "extensions", "caveman");
    const result = uninstallRun(home, "uninstall", "--yes", "--dry-run");

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(path.join(home, ".omp", "agent", "config.yml.bak")), "config.yml backup kept on dry run").toBeTruthy();
    for (const name of ["rule.md.bak", "rule-lite.md.bak", "rule-megacave-lite.md.bak", "rule-megacave-ultra.md.bak", "rule-ultra.md.bak", "rule-megacave.md.bak"]) {
      expect(existsSync(path.join(cavemanDir, name)), `${name} kept on dry run`).toBeTruthy();
    }
  } finally {
    rmTree(home);
  }
});

test("uninstall removes the bundled ponytail copy even with no legacy dep entry", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-uninstall-"));
  try {
    uninstallSeed(home);
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
    const result = uninstallRun(home, "uninstall", "--yes");

    expect(result.status, result.stderr).toBe(0);
    expect(!existsSync(path.join(pluginsDir, "node_modules", PONYTAIL)), "bundled ponytail removed").toBeTruthy();
    const config = readFileSync(path.join(home, ".omp", "agent", "config.yml"), "utf8");
    expect(config).not.toMatch(/ponytail/);
  } finally {
    rmTree(home);
  }
});

test("uninstall --keep-ponytail keeps the plugin, dep, lock entry, and config line", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-uninstall-"));
  try {
    uninstallSeed(home);
    const result = uninstallRun(home, "uninstall", "--yes", "--keep-ponytail");

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(path.join(home, ".omp", "plugins", "node_modules", PONYTAIL)), "ponytail package kept").toBeTruthy();
    const pkg = JSON.parse(readFileSync(path.join(home, ".omp", "plugins", "package.json"), "utf8"));
    expect(PONYTAIL in pkg.dependencies, "ponytail dep kept").toBeTruthy();
    const lock = JSON.parse(readFileSync(path.join(home, ".omp", "plugins", "omp-plugins.lock.json"), "utf8"));
    expect(PONYTAIL in lock.plugins, "ponytail lock entry kept").toBeTruthy();
    const config = readFileSync(path.join(home, ".omp", "agent", "config.yml"), "utf8");
    expect(config).toMatch(/ponytail/);
  } finally {
    rmTree(home);
  }
});

test("uninstall with removal flags drops ponytail, its lock entry, and the rtk binary", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-uninstall-"));
  try {
    uninstallSeed(home);
    const result = uninstallRun(home, "uninstall", "--yes", "--remove-ponytail", "--remove-rtk");

    expect(result.status, result.stderr).toBe(0);
    expect(!existsSync(path.join(home, ".omp", "plugins", "node_modules", PONYTAIL)), "ponytail package removed").toBeTruthy();
    const pkg = JSON.parse(readFileSync(path.join(home, ".omp", "plugins", "package.json"), "utf8"));
    expect(!(PONYTAIL in pkg.dependencies), "ponytail dep removed").toBeTruthy();
    const lock = JSON.parse(readFileSync(path.join(home, ".omp", "plugins", "omp-plugins.lock.json"), "utf8"));
    expect(!(PONYTAIL in lock.plugins), "ponytail lock entry removed").toBeTruthy();
    expect(!existsSync(path.join(home, ".bun", "bin", isWindows() ? "rtk.exe" : "rtk")), "rtk binary removed").toBeTruthy();
    expect(!existsSync(path.join(home, ".omp", "agent", "extensions", "rtk.ts")), "rtk OMP wiring removed with the binary").toBeTruthy();
    const config = readFileSync(path.join(home, ".omp", "agent", "config.yml"), "utf8");
    expect(config).not.toMatch(/ponytail/);
  } finally {
    rmTree(home);
  }
});

test("uninstall dry-run changes no files", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-uninstall-"));
  try {
    uninstallSeed(home);
    const pluginsPkg = path.join(home, ".omp", "plugins", "package.json");
    const configPath = path.join(home, ".omp", "agent", "config.yml");
    const beforePkg = readFileSync(pluginsPkg, "utf8");
    const beforeConfig = readFileSync(configPath, "utf8");
    const result = uninstallRun(home, "uninstall", "--yes", "--dry-run", "--remove-ponytail", "--remove-rtk");

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(pluginsPkg, "utf8")).toBe(beforePkg);
    expect(readFileSync(configPath, "utf8")).toBe(beforeConfig);
    expect(existsSync(path.join(home, ".omp", "agent", "extensions", "shared"))).toBeTruthy();
  } finally {
    rmTree(home);
  }
});

// Install manifest is the source of truth: a hand-written copy drifted and made a complete install look absent.
const PI_TREE = treeFilesFor("pi");

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
  return { result, extDir, intact: existsSync(path.join(extDir, "caveman", "index.ts")) };
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
    rmTree(home);
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
    rmTree(home);
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
    rmTree(home);
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
    rmTree(home);
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
    rmTree(home);
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
    rmTree(home);
  }
});

// An RTK binary runs with the user's privileges, so an unverifiable download must not be installed; a file URL keeps the runner's own argv away from cli/common.ts's flag parser.
const { verifyRtkArchive } = await import(new URL("file:///" + path.join(root, "cli/install.ts").replace(/\\/g, "/")).href);

const ASSET = "rtk-x86_64-apple-darwin.tar.gz";

function fixture(): { archive: string; dir: string; sha: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-verify-"));
  const archive = path.join(dir, ASSET);
  writeFileSync(archive, "archive bytes");
  const sha = createHash("sha256").update("archive bytes").digest("hex");
  return { archive, dir, sha };
}

test("a matching checksum installs", async () => {
  const { archive, dir, sha } = fixture();
  try {
    expect(await verifyRtkArchive(archive, ASSET, `${sha}  ${ASSET}\n`)).toBe(true);
  } finally {
    rmTree(dir);
  }
});

test("a checksum mismatch refuses to install", async () => {
  const { archive, dir } = fixture();
  const wrong = "0".repeat(64);
  try {
    expect(await verifyRtkArchive(archive, ASSET, `${wrong}  ${ASSET}\n`)).toBe(false);
  } finally {
    rmTree(dir);
  }
});

// The three cases below all previously installed anyway.
test("a missing checksums.txt refuses to install", async () => {
  const { archive, dir } = fixture();
  try {
    expect(await verifyRtkArchive(archive, ASSET, null)).toBe(false);
  } finally {
    rmTree(dir);
  }
});

test("checksums.txt without an entry for this asset refuses to install", async () => {
  const { archive, dir, sha } = fixture();
  try {
    expect(await verifyRtkArchive(archive, ASSET, `${sha}  some-other-asset.tar.gz\n`)).toBe(false);
  } finally {
    rmTree(dir);
  }
});

test("an empty checksums.txt refuses to install", async () => {
  const { archive, dir } = fixture();
  try {
    expect(await verifyRtkArchive(archive, ASSET, "")).toBe(false);
  } finally {
    rmTree(dir);
  }
});
