import { expect, test } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { wireRtkOmp } from "../../cli/rtk-wiring.ts";

// Fake rtk binary: records its argv into a log beside it, exits with
// $RTK_WIRE_EXIT (default 0). Hermetic — never touches a real OMP dir.
function fakeRtk(dir: string, code = 0): string {
  const bin = path.join(dir, "rtk");
  writeFileSync(bin, [
    "#!/bin/sh",
    `echo "$@" >> "${path.join(dir, "invocations.log")}"`,
    `exit ${code}`,
  ].join("\n"), "utf8");
  chmodSync(bin, 0o755);
  return bin;
}

function tempHome(): { dir: string; log: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-rtk-wire-"));
  return { dir, log: path.join(dir, "invocations.log") };
}

test("dry-run prints the would-run line and never executes the binary", async () => {
  const { dir, log } = tempHome();
  try {
    const ok = await wireRtkOmp(fakeRtk(dir), { dryRun: true });
    expect(ok).toBe(true);
    expect(existsSync(log), "fake binary must not run in dry-run").toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("success path runs init -g --agent omp once", async () => {
  const { dir, log } = tempHome();
  try {
    const ok = await wireRtkOmp(fakeRtk(dir), {});
    expect(ok).toBe(true);
    const calls = readFileSync(log, "utf8").trim().split("\n");
    expect(calls).toEqual(["init -g --agent omp"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("failing binary returns false without throwing", async () => {
  const { dir, log } = tempHome();
  try {
    const ok = await wireRtkOmp(fakeRtk(dir, 3), {});
    expect(ok).toBe(false);
    expect(readFileSync(log, "utf8")).toMatch(/init/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("success path registers rtk.ts in a fake HOME config.yml", async () => {
  const { dir } = tempHome();
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-rtk-home-"));
  const prevHome = process.env.HOME;
  try {
    process.env.HOME = home;
    const cfgDir = path.join(home, ".omp", "agent");
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(path.join(cfgDir, "config.yml"), "extensions:\n  - /x/combo-toggle/index.js\n", "utf8");
    const ok = await wireRtkOmp(fakeRtk(dir), { quiet: true });
    expect(ok).toBe(true);
    const cfg = readFileSync(path.join(cfgDir, "config.yml"), "utf8");
    expect(cfg).toMatch(/extensions\/rtk\.ts/);
    expect(cfg).toMatch(/combo-toggle/);
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
