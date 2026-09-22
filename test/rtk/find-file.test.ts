import { expect, test } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { findFile } from "../../extensions/lib/utils.js";

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

test("findFile skips doc files when matching rtk-like names", async () => {
  const dir = fixture();
  try {
    expect(await findFile(dir, "README.md")).toBe(path.join(dir, "README.md"));
    expect(await findFile(dir, "missing")).toBe(null);
    expect(await findFile("/nonexistent-tersio-dir", "rtk")).toBe(null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
