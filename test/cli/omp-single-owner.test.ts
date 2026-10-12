// The OMP agent tree holds rtk's wiring only. An install drops the extension copies an
// older build wrote, because omp merges the plugin manifest with the dir it discovers.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

import { cliEnv } from "../helpers/env.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const installer = path.join(root, "dist", "tersio.js");
const PACKAGE_VERSION = (JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { version: string }).version;
const extDir = (home: string): string => path.join(home, ".omp", "agent", "extensions");
const pluginExt = (home: string): string => path.join(home, ".omp", "plugins", "node_modules", "@krtclcdy", "tersio", "extensions");

// What an install before the single-owner fix left behind.
const RETIRED = ["ai-addons-updater", "combo-toggle", "lib", "rtk-filter", "rtk-session", "shared", "tersio-commands"];

function run(home: string, extraEnv: Record<string, string>, ...args: string[]) {
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

/** The registered plugin at this version: the state a successful install leaves behind. */
function pluginPresent(home: string): void {
  const pkg = path.join(home, ".omp", "plugins", "node_modules", "@krtclcdy", "tersio");
  mkdirSync(path.join(pkg, "extensions"), { recursive: true });
  writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "@krtclcdy/tersio", version: PACKAGE_VERSION }), "utf8");
}

/** Both package managers fail, so no plugin is registered and the agent tree is the fallback. */
function noPackageManagers(): Record<string, string> {
  const stub = mkdtempSync(path.join(os.tmpdir(), "tersio-omp-nopm-"));
  writeFileSync(path.join(stub, "npm"), "#!/bin/sh\nexit 1\n", "utf8");
  writeFileSync(path.join(stub, "bun"), "#!/bin/sh\nexit 1\n", "utf8");
  spawnSync("chmod", ["+x", path.join(stub, "npm"), path.join(stub, "bun")]);
  return { PATH: `${stub}:${process.env.PATH}` };
}

test("dry run reports the retired copies and removes nothing", () => {
  const home = tempHome();
  try {
    pluginPresent(home);
    const before = readdirSync(extDir(home)).toSorted();
    const result = run(home, {}, "--dry-run", "--yes");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Add-ons load from: the OMP plugin manifest/);
    expect(result.stdout).toMatch(/Retired agent copies — remove/);
    expect(readdirSync(extDir(home)).toSorted()).toEqual(before);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a registered plugin writes the plugin tree and drops the agent copies", () => {
  const home = tempHome();
  try {
    pluginPresent(home);
    const result = run(home, {}, "--yes");
    expect(result.status, result.stderr).toBe(0);
    // The mode extensions land in the tree the manifest declares.
    expect(existsSync(path.join(pluginExt(home), "combo", "index.ts")), "combo lands in the plugin tree").toBe(true);
    expect(existsSync(path.join(pluginExt(home), "caveman", "index.ts")), "caveman lands in the plugin tree").toBe(true);
    for (const dir of RETIRED) {
      expect(existsSync(path.join(extDir(home), dir)), `${dir} removed`).toBe(false);
    }
    // rtk's wiring and anything foreign survive, and the config keeps its entries.
    expect(existsSync(path.join(extDir(home), "rtk.ts")), "rtk wiring kept").toBe(true);
    expect(existsSync(path.join(extDir(home), "herdr")), "foreign dir kept").toBe(true);
    expect(readFileSync(path.join(home, ".omp", "agent", "config.yml"), "utf8")).toMatch(/rtk\.ts/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("without the plugin the agent tree is the fallback and keeps its copies", () => {
  const home = tempHome();
  try {
    const result = run(home, noPackageManagers(), "--yes");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Add-ons load from: the agent tree/);
    for (const dir of RETIRED) {
      expect(existsSync(path.join(extDir(home), dir)), `${dir} kept as the fallback`).toBe(true);
    }
    expect(existsSync(path.join(extDir(home), "rtk.ts")), "rtk wiring kept").toBe(true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
