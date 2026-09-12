import test from "node:test";
import assert from "node:assert/strict";
import { bannerLines, bannerTier } from "../cli/banner.ts";

const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

test("bannerLines renders 5 rows at most 16 wide in every tier", () => {
  for (const tier of ["true", "256", "plain"] as const) {
    const rows = bannerLines(tier);
    assert.equal(rows.length, 5);
    for (const row of rows) assert.ok(strip(row).length <= 16, `${tier}: ${JSON.stringify(row)}`);
  }
});

test("bannerLines plain tier carries no escapes and shows the scissor", () => {
  const rows = bannerLines("plain");
  assert.ok(rows.every((r) => !r.includes("\x1b")));
  assert.ok(rows.join("\n").includes("█"));
});

test("bannerTier honors NO_COLOR and COLORTERM", () => {
  const prev = { ...process.env };
  try {
    process.env.NO_COLOR = "";
    delete process.env.COLORTERM;
    assert.equal(bannerTier(), "plain");
    delete process.env.NO_COLOR;
    process.env.COLORTERM = "truecolor";
    assert.equal(bannerTier(), "true");
    process.env.COLORTERM = "";
    process.env.TERM = "xterm-256color";
    assert.equal(bannerTier(), "256");
  } finally {
    for (const k of ["NO_COLOR", "COLORTERM", "TERM"]) delete process.env[k];
    Object.assign(process.env, prev);
  }
});
