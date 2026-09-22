import { expect, test } from "vitest";
import { rtkPlatformSpec } from "../../extensions/lib/utils.ts";

test("rtkPlatformSpec resolves known platform/arch pairs", () => {
  expect(rtkPlatformSpec("darwin", "arm64")).toEqual({
    triple: "aarch64-apple-darwin",
    ext: ".tar.gz",
    binary: "rtk",
  });
  expect(rtkPlatformSpec("win32", "x64")).toEqual({
    triple: "x86_64-pc-windows-msvc",
    ext: ".zip",
    binary: "rtk.exe",
  });
});

test("rtkPlatformSpec returns null for unknown platforms", () => {
  expect(rtkPlatformSpec("plan9", "x64")).toBe(null);
});

test("rtkPlatformSpec defaults to the current runtime", () => {
  const spec = rtkPlatformSpec();
  expect(spec && typeof spec.triple === "string" && typeof spec.binary === "string").toBeTruthy();
});
