import { expect, test } from "vitest";
import {
  deriveLevel,
  isComboPresetActive,
  resetSharedComboState,
  setSharedComboLevel,
} from "../../extensions/shared/session-state.ts";

test("deriveLevel maps every preset back to its level, including balanced", () => {
  expect(deriveLevel({ caveman: "off", rtk: "off", ponytail: "off" })).toBe("off");
  expect(deriveLevel({ caveman: "lite", rtk: "on", ponytail: "lite" })).toBe("medium");
  expect(deriveLevel({ caveman: "full", rtk: "on", ponytail: "full" })).toBe("balanced");
  expect(deriveLevel({ caveman: "ultra", rtk: "on", ponytail: "ultra" })).toBe("max");
});

test("deriveLevel returns custom for mixed modes", () => {
  expect(deriveLevel({ caveman: "full", rtk: "off", ponytail: "full" })).toBe("custom");
});

test("isComboPresetActive is true for presets, false for off", () => {
  try {
    for (const level of ["medium", "balanced", "max"]) {
      setSharedComboLevel(level);
      expect(isComboPresetActive()).toBe(true);
    }
    setSharedComboLevel("off");
    expect(isComboPresetActive()).toBe(false);
  } finally {
    resetSharedComboState();
  }
});
