import { expect, test } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cliEnv } from "../helpers/env.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const installer = path.join(root, "tersio.js");

function writeLock(home: string, settings: Record<string, unknown>): void {
  const dir = path.join(home, ".tersio");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "settings.json"), JSON.stringify(settings), "utf8");
}

function readLock(home: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(home, ".tersio", "settings.json"), "utf8")) as Record<string, unknown>;
}

test("settings --dry-run previews without writing", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-settings-"));
  try {
    writeLock(home, {
      comboDefault: "off",
      cavemanDefault: "off",
      rtkDefault: false,
      ponytailDefault: "off",
    });
    const result = spawnSync(process.execPath, [installer, "settings", "--dry-run", "--combo-default", "balanced"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: cliEnv(home),
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/│ Setting +│ Current +│ Valid values +│/);
    expect(result.stdout).toMatch(/│ combo +│ off +│/);
    expect(result.stdout).toMatch(/Stored: @krtclcdy\/tersio in .*omp-plugins\.lock\.json/);
    expect(result.stdout).toMatch(/\[dry-run\] would set defaults: combo=balanced \(caveman=full · rtk=on · ponytail=full\)/);
    expect(readLock(home).comboDefault, "dry-run must not write").toBe("off");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("settings --currency writes the display default without touching modes", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-settings-"));
  try {
    writeLock(home, {
      comboDefault: "balanced",
      cavemanDefault: "full",
      rtkDefault: true,
      ponytailDefault: "full",
      currency: "USD",
    });
    const result = spawnSync(process.execPath, [installer, "settings", "--currency", "php"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: cliEnv(home),
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/currency=PHP/);
    const saved = readLock(home);
    expect(saved.currency).toBe("PHP");
    expect(saved.comboDefault, "mode defaults preserved").toBe("balanced");
    expect(saved.ponytailDefault, "mode defaults preserved").toBe("full");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("settings table hides the currency default (dashboard owns it)", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-settings-"));
  try {
    writeLock(home, { currency: "JPY" });
    const result = spawnSync(process.execPath, [installer, "settings", "--dry-run", "--combo-default", "off"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: cliEnv(home),
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toMatch(/│ currency /);
    expect(result.stdout).toMatch(/would set defaults: combo=off.*currency=JPY/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("settings with flags writes combo preset + overrides", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-settings-"));
  try {
    writeLock(home, { comboDefault: "max" });
    const result = spawnSync(
      process.execPath,
      [installer, "settings", "--combo-default", "medium", "--caveman-default", "ultra"],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 15000,
        env: cliEnv(home),
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Defaults: combo=medium \(caveman=ultra · rtk=on · ponytail=lite\)/);
    const saved = readLock(home);
    expect(saved.comboDefault).toBe("medium");
    expect(saved.cavemanDefault).toBe("ultra");
    expect(saved.rtkDefault).toBe(true);
    expect(saved.ponytailDefault).toBe("lite");
    expect(saved.currency, "the display default is written here too").toBe("USD");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("settings rejects an unknown setting name", () => {
  const result = spawnSync(process.execPath, [installer, "settings", "bogus"], {
    encoding: "utf8",
    cwd: root,
    env: cliEnv(mkdtempSync(path.join(os.tmpdir(), "tersio-settings-"))),
    timeout: 15000,
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/Invalid setting: bogus/);
});

test("settings without flags and no TTY prints usage", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-settings-"));
  try {
    const result = spawnSync(process.execPath, [installer, "settings"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: cliEnv(home),
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/│ Setting +│ Current +│ Valid values +│/);
    expect(result.stdout).toMatch(/Usage: tersio settings/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("settings --subagent-marker writes the marker list", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-settings-"));
  try {
    writeLock(home, { comboDefault: "off", cavemanDefault: "off", rtkDefault: false, ponytailDefault: "off" });
    const result = spawnSync(process.execPath, [installer, "settings", "--subagent-marker", "You are a delegated worker."], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: cliEnv(home),
    });
    expect(result.status, result.stderr).toBe(0);
    expect(readLock(home).subagentMarkers).toEqual(["You are a delegated worker."]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("settings --subagent-marker accepts repeats and keeps the mode defaults", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-settings-"));
  try {
    writeLock(home, { comboDefault: "balanced", cavemanDefault: "full", rtkDefault: true, ponytailDefault: "full" });
    const result = spawnSync(process.execPath, [
      installer, "settings", "--subagent-marker", "first marker", "--subagent-marker", "second marker",
    ], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: cliEnv(home),
    });
    expect(result.status, result.stderr).toBe(0);
    const saved = readLock(home);
    expect(saved.subagentMarkers).toEqual(["first marker", "second marker"]);
    expect(saved.comboDefault, "mode defaults preserved").toBe("balanced");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("settings drops blank markers so one cannot match every turn", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-settings-"));
  try {
    writeLock(home, {
      comboDefault: "off",
      subagentMarkers: ["real marker", "", "   "],
    });
    const result = spawnSync(process.execPath, [installer, "settings", "--currency", "EUR"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: cliEnv(home),
    });
    expect(result.status, result.stderr).toBe(0);
    expect(readLock(home).subagentMarkers).toEqual(["real marker"]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("the settings table reports the default marker when none is set", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-settings-"));
  try {
    writeLock(home, { comboDefault: "off", cavemanDefault: "off", rtkDefault: false, ponytailDefault: "off" });
    const result = spawnSync(process.execPath, [installer, "settings"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: cliEnv(home),
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/│ markers +│ default +│ host subagent prompt text +│/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("settings markers accepts a jump to the single setting", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-settings-"));
  try {
    writeLock(home, { comboDefault: "off", cavemanDefault: "off", rtkDefault: false, ponytailDefault: "off" });
    // No TTY: the jump must reject rather than prompt and hang.
    const result = spawnSync(process.execPath, [installer, "settings", "markers"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: cliEnv(home),
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Single-setting jump needs a terminal/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
