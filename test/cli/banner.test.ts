import { expect, test } from "vitest";
import { bannerLines, bannerTier } from "../../cli/banner.ts";

const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

test("bannerLines renders 6 rows at most 16 wide in every tier", () => {
  for (const tier of ["true", "256", "plain"] as const) {
    const rows = bannerLines(tier);
    expect(rows.length).toBe(6);
    for (const row of rows) expect(strip(row).length <= 16, `${tier}: ${JSON.stringify(row)}`).toBeTruthy();
  }
});

test("bannerLines plain tier carries no escapes and shows the scissor", () => {
  const rows = bannerLines("plain");
  expect(rows.every((r) => !r.includes("\x1b"))).toBeTruthy();
  expect(rows.join("\n").includes("█")).toBeTruthy();
});

test("bannerTier honors NO_COLOR and COLORTERM", () => {
  const prev = { ...process.env };
  try {
    process.env.NO_COLOR = "";
    delete process.env.COLORTERM;
    expect(bannerTier()).toBe("plain");
    delete process.env.NO_COLOR;
    process.env.COLORTERM = "truecolor";
    expect(bannerTier()).toBe("true");
    process.env.COLORTERM = "";
    process.env.TERM = "xterm-256color";
    expect(bannerTier()).toBe("256");
  } finally {
    for (const k of ["NO_COLOR", "COLORTERM", "TERM"]) delete process.env[k];
    Object.assign(process.env, prev);
  }
});
