import { expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { appendUsage, ledgerPath, readUsage } from "../../extensions/shared/usage-ledger.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tersio-ledger-"));
process.env.TERSIO_USAGE_FILE = path.join(dir, "usage.jsonl");
// Keep the host's real reset watermark (if any) out of these tests.
process.env.TERSIO_RESET_FILE = path.join(dir, "reset.json");
test("ledger starts empty when the file is missing", () => {
  expect(ledgerPath()).toBe(process.env.TERSIO_USAGE_FILE);
  expect(readUsage()).toEqual([]);
});

test("appended rows round-trip in order", () => {
  appendUsage("command", "/caveman full");
  appendUsage("toggle", "caveman=full");
  const rows = readUsage();
  expect(rows.length).toBe(2);
  expect(rows[0].kind).toBe("command");
  expect(rows[0].detail).toBe("/caveman full");
  expect(typeof rows[0].ts).toBe("number");
  expect(rows[1].kind).toBe("toggle");
});

test("corrupt lines are skipped, valid rows survive", () => {
  fs.appendFileSync(process.env.TERSIO_USAGE_FILE!, "not json\n{\"ts\":\"x\",\"kind\":1}\n", "utf8");
  const rows = readUsage();
  expect(rows.length).toBe(2);
  expect(rows[0].detail).toBe("/caveman full");
});

test("clearUsageLedger removes the file and returns rows cleared", async () => {
  const { clearUsageLedger } = await import("../../extensions/shared/usage-ledger.js");
  appendUsage("command", "/tersio reset");
  const cleared = clearUsageLedger();
  expect(cleared).toBe(3);
  expect(readUsage()).toEqual([]);
  expect(fs.existsSync(process.env.TERSIO_USAGE_FILE!)).toBe(false);
  expect(clearUsageLedger()).toBe(0);
});

test("reset watermark defaults to 0, writes and reads back", async () => {
  const { resetMarkerPath, readResetWatermark, markReset } = await import("../../extensions/shared/usage-ledger.js");
  expect(fs.existsSync(resetMarkerPath())).toBe(false);
  expect(readResetWatermark()).toBe(0);
  const ts = markReset();
  expect(readResetWatermark()).toBe(ts);
  expect(fs.readFileSync(resetMarkerPath(), "utf8")).toMatch(/"ts":\d+/);
});

test("session stats honor the reset watermark without touching transcripts", async () => {
  const mod = await import("../../extensions/shared/usage-ledger.js");
  const sessions = path.join(dir, "sessions");
  fs.mkdirSync(sessions, { recursive: true });
  const now = Date.now();
  const row = (iso: string) => JSON.stringify({ timestamp: iso, message: { role: "assistant", model: "m-test", usage: { input: 100, output: 10 }, content: [] } }) + "\n";
  fs.writeFileSync(path.join(sessions, "s.jsonl"), [
    row(new Date(now - 60_000).toISOString()), // before watermark
    row(new Date(now + 60_000).toISOString()), // after watermark
    JSON.stringify({ message: { role: "assistant", model: "m-test", usage: { input: 500, output: 5 } } }), // no timestamp
  ].join("\n"), "utf8");
  const prevSessions = process.env.TERSIO_SESSIONS_DIR;
  const prevReset = process.env.TERSIO_RESET_FILE;
  process.env.TERSIO_SESSIONS_DIR = sessions;
  try {
    process.env.TERSIO_RESET_FILE = path.join(dir, "no-marker.json");
    const unfiltered = mod.importSessionTokens();
    expect(unfiltered.messages).toBe(3);
    expect(unfiltered.totals.input).toBe(700);

    process.env.TERSIO_RESET_FILE = path.join(dir, "stats-reset.json");
    mod.markReset(now);
    const filtered = mod.importSessionTokens();
    expect(filtered.messages, "only post-watermark rows count").toBe(1);
    expect(filtered.totals.input).toBe(100);
    expect(filtered.totals.output).toBe(10);
    // The host-owned transcript file is untouched.
    expect(fs.existsSync(path.join(sessions, "s.jsonl"))).toBe(true);
  } finally {
    if (prevSessions === undefined) delete process.env.TERSIO_SESSIONS_DIR;
    else process.env.TERSIO_SESSIONS_DIR = prevSessions;
    if (prevReset === undefined) delete process.env.TERSIO_RESET_FILE;
    else process.env.TERSIO_RESET_FILE = prevReset;
  }
});
