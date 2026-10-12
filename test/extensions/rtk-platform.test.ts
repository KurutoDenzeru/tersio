import { expect, test } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveRtkBinary, rtkPlatformSpec } from "../../extensions/shared/utils.ts";

test("resolveRtkBinary returns null when PATH has no executable", () => {
  const previous = process.env.PATH;
  process.env.PATH = path.resolve("definitely-missing-bin");
  try {
    expect(resolveRtkBinary(path.resolve("definitely-missing-bin"))).toBeNull();
  } finally {
    if (previous === undefined) delete process.env.PATH;
    else process.env.PATH = previous;
  }
});

test("resolveRtkBinary falls back to the managed installer directory", () => {
  const previousPath = process.env.PATH;
  const managed = mkdtempSync(path.join(os.tmpdir(), "tersio-rtk-managed-"));
  const binary = path.join(managed, process.platform === "win32" ? "rtk.exe" : "rtk");
  writeFileSync(binary, "#!/bin/sh\necho rtk 0.50.0\n", "utf8");
  if (process.platform !== "win32") chmodSync(binary, 0o755);
  process.env.PATH = path.join(managed, "missing");
  try {
    expect(resolveRtkBinary(managed)).toBe(binary);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    rmSync(managed, { recursive: true, force: true });
  }
});
test("rtkPlatformSpec returns null for unknown platforms", () => {
  expect(rtkPlatformSpec("plan9", "x64")).toBe(null);
});
