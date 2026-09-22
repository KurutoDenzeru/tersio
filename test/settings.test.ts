import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installer = path.join(root, "tersio.js");

function writeLock(home: string, settings: Record<string, unknown>): void {
  const dir = path.join(home, ".omp", "plugins");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "omp-plugins.lock.json"), JSON.stringify({ plugins: {}, settings }), "utf8");
}

function readLock(home: string): Record<string, unknown> {
  const raw = readFileSync(path.join(home, ".omp", "plugins", "omp-plugins.lock.json"), "utf8");
  const parsed = JSON.parse(raw) as { settings?: Record<string, unknown> };
  return (parsed.settings?.["@krtclcdy/tersio"] ?? {}) as Record<string, unknown>;
}

test("settings --dry-run previews without writing", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-settings-"));
  try {
    writeLock(home, {
      "@krtclcdy/tersio": {
        comboDefault: "off",
        cavemanDefault: "off",
        rtkDefault: false,
        ponytailDefault: "off",
      },
    });
    const result = spawnSync(process.execPath, [installer, "settings", "--dry-run", "--combo-default", "balanced"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /│ Setting +│ Current +│ Valid values +│/);
    assert.match(result.stdout, /│ combo +│ off +│/);
    assert.match(result.stdout, /Stored: @krtclcdy\/tersio in .*omp-plugins\.lock\.json/);
    assert.match(result.stdout, /\[dry-run\] would set defaults: combo=balanced \(caveman=full · rtk=on · ponytail=full\)/);
    assert.equal(readLock(home).comboDefault, "off", "dry-run must not write");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("settings --currency writes the display default without touching modes", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-settings-"));
  try {
    writeLock(home, {
      "@krtclcdy/tersio": {
        comboDefault: "balanced",
        cavemanDefault: "full",
        rtkDefault: true,
        ponytailDefault: "full",
        currency: "USD",
      },
    });
    const result = spawnSync(process.execPath, [installer, "settings", "--currency", "php"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /currency=PHP/);
    const saved = readLock(home);
    assert.equal(saved.currency, "PHP");
    assert.equal(saved.comboDefault, "balanced", "mode defaults preserved");
    assert.equal(saved.ponytailDefault, "full", "mode defaults preserved");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("settings table hides the currency default (dashboard owns it)", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-settings-"));
  try {
    writeLock(home, { "@krtclcdy/tersio": { currency: "JPY" } });
    const result = spawnSync(process.execPath, [installer, "settings", "--dry-run", "--combo-default", "off"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /│ currency /);
    assert.match(result.stdout, /would set defaults: combo=off.*currency=JPY/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("settings with flags writes combo preset + overrides", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-settings-"));
  try {
    writeLock(home, { "other-plugin": { comboDefault: "max" } });
    const result = spawnSync(
      process.execPath,
      [installer, "settings", "--combo-default", "medium", "--caveman-default", "ultra"],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 15000,
        env: { ...process.env, HOME: home, USERPROFILE: home },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Defaults: combo=medium \(caveman=ultra · rtk=on · ponytail=lite\)/);
    const saved = readLock(home);
    assert.equal(saved.comboDefault, "medium");
    assert.equal(saved.cavemanDefault, "ultra");
    assert.equal(saved.rtkDefault, true);
    assert.equal(saved.ponytailDefault, "lite");
    const raw = JSON.parse(readFileSync(path.join(home, ".omp", "plugins", "omp-plugins.lock.json"), "utf8")) as {
      settings?: Record<string, unknown>;
    };
    assert.deepEqual(raw.settings?.["other-plugin"], { comboDefault: "max" }, "other plugins preserved");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("settings without flags and no TTY prints usage", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-settings-"));
  try {
    const result = spawnSync(process.execPath, [installer, "settings"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /│ Setting +│ Current +│ Valid values +│/);
    assert.match(result.stdout, /Usage: tersio settings/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
