import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  readCavemanDefault,
  readComboDefault,
  readPluginSettings,
  readRtkDefault,
} from "../extensions/shared/plugin-settings.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installer = path.join(root, "tersio.js");

// Each scenario runs under its own HOME so the lock-file fixtures never
// collide with the real user state.
function withHome<T>(fn: (home: string) => T): T {
  const home = mkdtempSync(path.join(os.tmpdir(), "omp-settings-test-"));
  const previous = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    return fn(home);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(home, { recursive: true, force: true });
  }
}

function writeLock(home: string, settings: Record<string, unknown>): void {
  const dir = path.join(home, ".omp", "plugins");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "omp-plugins.lock.json"), JSON.stringify({ plugins: {}, settings }), "utf8");
}

test("readPluginSettings returns defaults when no lock file exists", () => {
  withHome(() => {
    assert.equal(readComboDefault(), "off");
    assert.equal(readCavemanDefault(), "off");
    assert.equal(readRtkDefault(), false);
    assert.deepEqual(readPluginSettings(), {});
  });
});

test("readPluginSettings picks up values from the omp lock file", () => {
  withHome((home) => {
    writeLock(home, { "@krtclcdy/tersio": { comboDefault: "max", cavemanDefault: "wenyan", rtkDefault: true } });
    assert.equal(readComboDefault(), "max");
    assert.equal(readCavemanDefault(), "wenyan");
    assert.equal(readRtkDefault(), true);
  });
});

test("readPluginSettings ignores invalid values and other plugins", () => {
  withHome((home) => {
    writeLock(home, {
      "other-plugin": { comboDefault: "max" },
      "@krtclcdy/tersio": { comboDefault: "yolo", cavemanDefault: 42, rtkDefault: "yes" },
    });
    assert.equal(readComboDefault(), "off");
    assert.equal(readCavemanDefault(), "off");
    assert.equal(readRtkDefault(), false);
  });
});

test("readPluginSettings tolerates a corrupt lock file", () => {
  withHome((home) => {
    const dir = path.join(home, ".omp", "plugins");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "omp-plugins.lock.json"), "{ not json", "utf8");
    assert.equal(readComboDefault(), "off");
    assert.deepEqual(readPluginSettings(), {});
  });
});

// --- Installer profile flags ---

type RunResult = { status: number | null; stdout: string; stderr: string };

function run(...args: string[]): RunResult {
  // Missing home: user-scope dests never exist, so dry-run previews every write.
  const missingHome = path.join(root, "test", "definitely-missing-home");
  const result = spawnSync(process.execPath, [installer, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 15000,
    env: { ...process.env, HOME: missingHome, USERPROFILE: missingHome },
  });
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

test("installer accepts session-default flags and reports them", () => {
  const result = run("install", "--dry-run", "--yes", "--combo-default", "medium");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /combo default=medium/);
  assert.match(result.stdout, /rtk-session/);
  assert.match(result.stdout, /ai-addons-updater/);
});

test("installer rejects invalid default values", () => {
  const badCombo = run("install", "--dry-run", "--yes", "--combo-default", "ultra");
  assert.equal(badCombo.status, 1);
  assert.match(badCombo.stderr, /Invalid --combo-default/);

  const badRtk = run("install", "--dry-run", "--yes", "--rtk-default", "maybe");
  assert.equal(badRtk.status, 1);
  assert.match(badRtk.stderr, /Invalid --rtk-default/);

  const badCaveman = run("install", "--dry-run", "--yes", "--caveman-default", "max");
  assert.equal(badCaveman.status, 1);
  assert.match(badCaveman.stderr, /Invalid --caveman-default/);
});

test("installer rejects removed project/both scopes", () => {
  for (const scope of ["project", "both", "bogus"]) {
    const bad = run("install", "--dry-run", "--yes", "--scope", scope);
    assert.equal(bad.status, 1, scope);
    assert.match(bad.stderr, /Project scope was removed/);
  }
  const legacy = run("install", "--dry-run", "--yes", "--scope", "user");
  assert.equal(legacy.status, 0, legacy.stderr);
});

test("installer dry-run installs every user-scope extension", () => {
  const result = run("install", "--dry-run", "--yes");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /rtk-session/);
  assert.match(result.stdout, /caveman-session\/index/);
  assert.match(result.stdout, /ai-addons-updater/);
});

// --- Manifest feature/setting shape ---

test("package manifest declares features and settings matching the omp schema", () => {
  const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
    omp?: { features?: Record<string, unknown>; settings?: Record<string, unknown> };
  };
  const features = manifest.omp?.features ?? {};
  const settings = manifest.omp?.settings ?? {};

  for (const name of ["caveman", "rtk", "ponytail", "updater"]) {
    assert.ok(name in features, `feature ${name} declared`);
    const feature = features[name] as { default?: boolean; extensions?: string[] };
    assert.equal(feature.default, true, `feature ${name} defaults on`);
    for (const ext of feature.extensions ?? []) {
      const compiled = path.join(root, ext);
      assert.ok(existsSync(compiled), `feature ${name} entry exists: ${ext}`);
    }
  }

  const combo = settings.comboDefault as { type?: string; values?: string[]; default?: string };
  assert.equal(combo.type, "enum");
  assert.deepEqual(combo.values, ["off", "medium", "balanced", "max"]);
  assert.equal(combo.default, "off");

  const rtk = settings.rtkDefault as { type?: string; default?: boolean };
  assert.equal(rtk.type, "boolean");
  assert.equal(rtk.default, false);
});

test("installer accepts --ponytail-default override and reports it", () => {
  const result = run("install", "--dry-run", "--yes", "--ponytail-default", "review");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ponytail=review/);
});

test("installer rejects invalid --ponytail-default values", () => {
  const bad = run("install", "--dry-run", "--yes", "--ponytail-default", "max");
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Invalid --ponytail-default/);
});

test("apply-update without flags preserves stored combo defaults", () => {
  // The clobber regression: `tersio update` delegates to --apply-update with
  // no flags and no prompt, and resolveProfile rebuilt from all-off —
  // wiping the user's configured default on every update.
  const home = mkdtempSync(path.join(os.tmpdir(), "omp-preserve-test-"));
  try {
    writeLock(home, {
      "@krtclcdy/tersio": {
        comboDefault: "balanced",
        cavemanDefault: "full",
        rtkDefault: true,
        ponytailDefault: "full",
      },
    });
    const result = spawnSync(process.execPath, [installer, "--apply-update", "--dry-run", "--yes"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /combo default=balanced \(caveman=full · rtk=on · ponytail=full\)/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
