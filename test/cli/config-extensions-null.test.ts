import { expect, test } from "vitest";
import { normalizeExtensionsKey } from "../../cli/common.js";

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
