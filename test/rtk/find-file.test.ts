import { expect, test } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { findFile } from "../../extensions/lib/utils.ts";

function fixture(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-find-"));
  mkdirSync(path.join(dir, "nested", "deep"), { recursive: true });
  writeFileSync(path.join(dir, "nested", "deep", "rtk"), "bin");
  writeFileSync(path.join(dir, "README.md"), "docs");
  return dir;
}

test("findFile locates a nested binary by exact name", async () => {
  const dir = fixture();
  try {
    expect(await findFile(dir, "rtk")).toBe(path.join(dir, "nested", "deep", "rtk"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("findFile returns null for a missing name or directory", async () => {
  const dir = fixture();
  try {
    expect(await findFile(dir, "missing")).toBe(null);
    expect(await findFile("/nonexistent-tersio-dir", "rtk")).toBe(null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("findFile skips release doc files when hunting the rtk binary", async () => {
  // The name promised this and the test never checked it. A release archive
  // ships README.md, LICENSE, and checksums next to the binary; a loose match
  // would hand `tar` a text file and fail the install for no reason.
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-find-docs-"));
  try {
    writeFileSync(path.join(dir, "README.md"), "docs");
    writeFileSync(path.join(dir, "rtk.sha256"), "abc");
    writeFileSync(path.join(dir, "rtk"), "bin");
    expect(await findFile(dir, "rtk")).toBe(path.join(dir, "rtk"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
