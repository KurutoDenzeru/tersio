import test from "node:test";
import assert from "node:assert/strict";
import { normalizeExtensionsKey } from "../cli/common.js";

// The normalizer lives in cli/common.ts (import-safe: no CLI side effects),
// so this exercises the shared behavior directly instead of the source text.
test("config writer normalizes `extensions: null` before appending list items", () => {
  for (const candidate of ["extensions: null", "extensions: ~", "extensions: []", "extensions:"]) {
    const lines = ["foo: 1", candidate, "bar: 2"];
    assert.equal(normalizeExtensionsKey(lines), true, candidate);
    assert.equal(lines[1], "extensions:", candidate);
  }
  const healthy = ["extensions: foo", "  - /x/y.js"];
  assert.equal(normalizeExtensionsKey(healthy), false);
  assert.deepEqual(healthy, ["extensions: foo", "  - /x/y.js"]);
});
