import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { wireRtkOmp } from "../cli/rtk-wiring.ts";

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
    assert.equal(ok, true);
    assert.equal(existsSync(log), false, "fake binary must not run in dry-run");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("success path runs init -g --agent omp once", async () => {
  const { dir, log } = tempHome();
  try {
    const ok = await wireRtkOmp(fakeRtk(dir), { });
    assert.equal(ok, true);
    const calls = readFileSync(log, "utf8").trim().split("\n");
    assert.deepEqual(calls, ["init -g --agent omp"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("failing binary returns false without throwing", async () => {
  const { dir, log } = tempHome();
  try {
    const ok = await wireRtkOmp(fakeRtk(dir, 3), { });
    assert.equal(ok, false);
    assert.match(readFileSync(log, "utf8"), /init/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
