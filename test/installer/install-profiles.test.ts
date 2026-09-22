import { expect, test } from "vitest";
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
} from "../../extensions/shared/plugin-settings.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
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
    expect(readComboDefault()).toBe("off");
    expect(readCavemanDefault()).toBe("off");
    expect(readRtkDefault()).toBe(false);
    expect(readPluginSettings()).toEqual({});
  });
});

test("readPluginSettings picks up values from the omp lock file", () => {
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
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(/Defaults: combo=medium/);
  expect(result.stdout).toMatch(/RTK session — install session mode/);
  expect(result.stdout).toMatch(/Session helpers — sync shared files/);
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
  expect(result.stdout).toMatch(/Caveman — fetch rule and install session mode/);
  expect(result.stdout).toMatch(/Session helpers — sync shared files/);
});

// --- Manifest feature/setting shape ---

test("package manifest declares features and settings matching the omp schema", () => {
  const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
    omp?: { features?: Record<string, unknown>; settings?: Record<string, unknown> };
  };
  const features = manifest.omp?.features ?? {};
  const settings = manifest.omp?.settings ?? {};

  for (const name of ["caveman", "rtk", "ponytail", "updater"]) {
    expect(name in features, `feature ${name} declared`).toBeTruthy();
    const feature = features[name] as { default?: boolean; extensions?: string[] };
    expect(feature.default, `feature ${name} defaults on`).toBe(true);
    for (const ext of feature.extensions ?? []) {
      const compiled = path.join(root, ext);
      expect(existsSync(compiled), `feature ${name} entry exists: ${ext}`).toBeTruthy();
    }
  }

  const combo = settings.comboDefault as { type?: string; values?: string[]; default?: string };
  expect(combo.type).toBe("enum");
  expect(combo.values).toEqual(["off", "medium", "balanced", "max"]);
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
  const result = run("install", "--dry-run", "--yes", "--ponytail-default", "review");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(/ponytail=review/);
});

test("installer rejects invalid --ponytail-default values", () => {
  const bad = run("install", "--dry-run", "--yes", "--ponytail-default", "max");
  expect(bad.status).toBe(1);
  expect(bad.stderr).toMatch(/Invalid --ponytail-default/);
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
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Defaults: combo=balanced \(caveman=full · rtk=on · ponytail=full\)/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
