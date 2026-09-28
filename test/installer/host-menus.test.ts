// The host menus: `tersio install` / `tersio uninstall` target one agent, and
// the option label carries the current state in brackets.
import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { detectHosts, hostLabel } from "../../cli/hosts.ts";
import type { HostEntry } from "../../cli/hosts.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cli = path.join(root, "tersio.js");

function tempHome(): string {
  return mkdtempSync(path.join(os.tmpdir(), "tersio-hosts-"));
}

function seedPiPackage(home: string, version = "2.23.0"): void {
  const agent = path.join(home, ".pi", "agent");
  const pkg = path.join(agent, "npm", "node_modules", "@krtclcdy", "tersio");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "@krtclcdy/tersio", version }), "utf8");
  writeFileSync(path.join(agent, "settings.json"), JSON.stringify({ packages: [`npm:@krtclcdy/tersio@${version}`] }), "utf8");
}

function run(home: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 30000,
    env: { ...process.env, HOME: home, USERPROFILE: home, PATH: path.join(home, "empty-bin") },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("the label shows the installed version, or that nothing is there", () => {
  const base: HostEntry = { id: "omp", label: "Oh My Pi", bin: "omp", installCmd: "omp plugin install @krtclcdy/tersio", removeCmd: "x", installed: false, via: null, declared: null, version: null, dir: null };
  expect(hostLabel({ ...base, installed: true, version: "2.23.0" })).toBe("Oh My Pi (installed 2.23.0)");
  expect(hostLabel({ ...base, installed: true, version: null })).toBe("Oh My Pi (installed)");
  expect(hostLabel(base)).toBe("Oh My Pi (not installed)");
  expect(hostLabel({ ...base, declared: "npm:@krtclcdy/tersio" })).toBe("Oh My Pi (package declared, not on disk)");
});

test("detectHosts reports the pi install under its own agent dir", () => {
  const home = tempHome();
  try {
    seedPiPackage(home, "9.9.9");
    // Pass the agent dir rather than setting PI_CODING_AGENT_DIR: that override
    // only applies alongside PI_CODING_AGENT, which CI does not set.
    const agentDir = path.join(home, ".pi", "agent");
    const pi = detectHosts(agentDir).find((h) => h.id === "pi") as HostEntry;
    expect(pi.installed).toBe(true);
    expect(pi.version).toBe("9.9.9");
    expect(pi.installCmd).toBe("pi install npm:@krtclcdy/tersio");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("install --host pi writes the pi tree and no OMP files", () => {
  const home = tempHome();
  try {
    const result = run(home, ["install", "--host", "pi", "--dry-run", "--verbose"]);
    expect(result.status, result.stderr).toBe(0);
    // pi auto-discovers <agent-dir>/extensions, so the tree is the install.
    expect(result.stdout).toMatch(/\[dry-run\] would write .*\.pi\/agent\/extensions\/caveman-session\/index\.ts/);
    expect(result.stdout).toMatch(/\[dry-run\] would write .*\.pi\/agent\/extensions\/rtk-session\/index\.ts/);
    expect(result.stdout).toMatch(/\[dry-run\] would write .*\.pi\/agent\/extensions\/shared\/session-state\.ts/);
    expect(result.stdout).toMatch(/\[dry-run\] would write session defaults to .*\.tersio\/settings\.json/);
    expect(result.stdout, "OMP extension tree must stay untouched").not.toMatch(/\.omp\/agent\/extensions/);
    expect(result.stdout).toMatch(/Done — restart pi/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("install --host omp keeps the OMP tree and never touches pi", () => {
  const home = tempHome();
  try {
    const result = run(home, ["install", "--host", "omp", "--dry-run", "--verbose"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/extensions\/combo-toggle\/index\.ts/);
    expect(result.stdout).not.toMatch(/pi install npm:/);
    expect(result.stdout).toMatch(/Done — restart OMP/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("install rejects an unknown host", () => {
  const home = tempHome();
  try {
    const result = run(home, ["install", "--host", "codex"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Invalid --host: codex/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("uninstall --host pi clears the pi tree, the package, and the shared defaults", () => {
  const home = tempHome();
  try {
    seedPiPackage(home);
    mkdirSync(path.join(home, ".tersio"), { recursive: true });
    writeFileSync(path.join(home, ".tersio", "settings.json"), JSON.stringify({ comboDefault: "balanced" }), "utf8");
    const result = run(home, ["uninstall", "--host", "pi", "--dry-run"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/\[dry-run\] would run: pi remove npm:@krtclcdy\/tersio/);
    expect(result.stdout).toMatch(/\[dry-run\] would remove .*\.pi\/agent\/extensions\/caveman-session/);
    expect(result.stdout).toMatch(/\[dry-run\] would remove .*\.tersio\/settings\.json/);
    expect(result.stdout, "OMP targets stay out of a pi uninstall").not.toMatch(/\.omp\/agent\/extensions/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("uninstall on a machine with no install says so instead of listing files", () => {
  const home = tempHome();
  try {
    const result = run(home, ["uninstall"]);
    expect(result.status, result.stderr).toBe(0);
    // Without a TTY the host prompt is skipped, so the OMP path runs and reports
    // nothing installed rather than claiming a removal.
    expect(result.stdout).toMatch(/has no tersio install/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor --fix restores a partly written pi tree", () => {
  const home = tempHome();
  try {
    // A half-written tree is what --fix exists for, and it is what reinstall
    // used to be the answer to before the command was retired.
    const ext = path.join(home, ".pi", "agent", "extensions");
    mkdirSync(path.join(ext, "shared"), { recursive: true });
    mkdirSync(path.join(ext, "caveman-session"), { recursive: true });
    writeFileSync(path.join(ext, "shared", "host.ts"), "// stale", "utf8");
    writeFileSync(path.join(ext, "caveman-session", "index.ts"), "// stale", "utf8");

    const result = run(home, ["doctor", "--fix", "extensions", "--yes"]);
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(path.join(ext, "shared", "host.ts"), "utf8")).not.toBe("// stale");
    expect(readFileSync(path.join(ext, "caveman-session", "index.ts"), "utf8")).toMatch(/export default function/);
    expect(result.stdout, "OMP's tree is not the target here").not.toMatch(/\.omp\/agent\/extensions/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("an existing rtk binary is bound, not re-downloaded", () => {
  const home = tempHome();
  try {
    // The binary is machine-wide: resolveRtkBinary falls back to ~/.bun/bin,
    // so a seeded binary stands in for one an earlier install put there.
    const binDir = path.join(home, ".bun", "bin");
    mkdirSync(binDir, { recursive: true });
    const rtk = path.join(binDir, "rtk");
    writeFileSync(rtk, "#!/bin/sh\necho 'rtk 0.50.0'\n", "utf8");
    chmodSync(rtk, 0o755);

    const result = run(home, ["install", "--host", "pi", "--yes"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/RTK — already installed.*nothing to bind on pi/);
    expect(result.stdout, "no registry probe, no download").not.toMatch(/Downloading RTK binary|Finding latest RTK release/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("the OMP route binds the existing binary instead of downloading", () => {
  const home = tempHome();
  try {
    const binDir = path.join(home, ".bun", "bin");
    mkdirSync(binDir, { recursive: true });
    const rtk = path.join(binDir, "rtk");
    writeFileSync(rtk, "#!/bin/sh\necho 'rtk 0.50.0'\n", "utf8");
    chmodSync(rtk, 0o755);

    // Dry run: the wiring itself is a plan line, so only the decision to skip
    // the download is asserted here.
    const result = run(home, ["install", "--host", "omp", "--dry-run", "--verbose"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/RTK — already installed.*binding into OMP/);
    expect(result.stdout).not.toMatch(/would download rtk binary/);
    expect(result.stdout).not.toMatch(/Finding latest RTK release/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
