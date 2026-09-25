import { expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureExtensionInConfig, normalizeExtensionsKey, removeExtensionFromConfig } from "../../cli/common.ts";

// The normalizer lives in cli/common.ts (import-safe: no CLI side effects),
// so this exercises the shared behavior directly instead of the source text.
test("config writer normalizes `extensions: null` before appending list items", () => {
  for (const candidate of ["extensions: null", "extensions: ~", "extensions: []", "extensions:"]) {
    const lines = ["foo: 1", candidate, "bar: 2"];
    expect(normalizeExtensionsKey(lines), candidate).toBe(true);
    expect(lines[1], candidate).toBe("extensions:");
  }
  const healthy = ["extensions: foo", "  - /x/y.js"];
  expect(normalizeExtensionsKey(healthy)).toBe(false);
  expect(healthy).toEqual(["extensions: foo", "  - /x/y.js"]);
});

function withConfig(body: string): { dir: string; file: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-config-"));
  const file = path.join(dir, "config.yml");
  writeFileSync(file, body, "utf8");
  return { dir, file };
}

test("ensure drops the legacy compiled twin instead of duplicating it", async () => {
  const { dir, file } = withConfig("extensions:\n  - /home/u/.omp/agent/extensions/combo-toggle/index.js\n");
  try {
    await ensureExtensionInConfig(file, "/home/u/.omp/agent/extensions/combo-toggle/index.ts", "combo", {});
    const body = readFileSync(file, "utf8");
    expect(body).toMatch(/combo-toggle\/index\.ts/);
    expect(body).not.toMatch(/combo-toggle\/index\.js/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


test("ensure leaves .js entries alone when the new path is also .js", async () => {
  const { dir, file } = withConfig("extensions:\n  - /x/ponytail/pi-extension/index.js\n");
  try {
    await ensureExtensionInConfig(file, "/x/ponytail/pi-extension/index.js", "ponytail", {});
    expect(readFileSync(file, "utf8")).toMatch(/pi-extension\/index\.js/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("retired extension cleanup removes absolute and relative matching registrations", async () => {
  const { dir, file } = withConfig("extensions:\n  - /x/agent/extensions/shared/mode-reinforcement.ts\n  - ./extensions/shared/mode-reinforcement.ts\n  - /x/read.ts\n");
  try {
    expect(await removeExtensionFromConfig(file, "/x/agent/extensions/shared/mode-reinforcement.ts", "retired mode reinforcement", {})).toBe(true);
    expect(readFileSync(file, "utf8")).toBe("extensions:\n  - /x/read.ts\n");
    expect(await removeExtensionFromConfig(file, "/x/agent/extensions/shared/mode-reinforcement.ts", "retired mode reinforcement", {})).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
