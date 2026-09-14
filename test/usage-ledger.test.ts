import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { appendUsage, ledgerPath, readUsage } from "../extensions/shared/usage-ledger.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tersio-ledger-"));
process.env.TERSIO_USAGE_FILE = path.join(dir, "usage.jsonl");
// Keep the host's real reset watermark (if any) out of these tests.
process.env.TERSIO_RESET_FILE = path.join(dir, "reset.json");
test("ledger starts empty when the file is missing", () => {
  assert.equal(ledgerPath(), process.env.TERSIO_USAGE_FILE);
  assert.deepEqual(readUsage(), []);
});

test("appended rows round-trip in order", () => {
  appendUsage("command", "/caveman full");
  appendUsage("toggle", "caveman=full");
  const rows = readUsage();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].kind, "command");
  assert.equal(rows[0].detail, "/caveman full");
  assert.equal(typeof rows[0].ts, "number");
  assert.equal(rows[1].kind, "toggle");
});

test("corrupt lines are skipped, valid rows survive", () => {
  fs.appendFileSync(process.env.TERSIO_USAGE_FILE!, "not json\n{\"ts\":\"x\",\"kind\":1}\n", "utf8");
  const rows = readUsage();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].detail, "/caveman full");
});

test("clearUsageLedger removes the file and returns rows cleared", async () => {
  const { clearUsageLedger } = await import("../extensions/shared/usage-ledger.js");
  appendUsage("command", "/tersio reset");
  const cleared = clearUsageLedger();
  assert.equal(cleared, 3);
  assert.deepEqual(readUsage(), []);
  assert.equal(fs.existsSync(process.env.TERSIO_USAGE_FILE!), false);
  assert.equal(clearUsageLedger(), 0);
});

test("reset watermark defaults to 0, writes and reads back", async () => {
  const { resetMarkerPath, readResetWatermark, markReset } = await import("../extensions/shared/usage-ledger.js");
  assert.equal(fs.existsSync(resetMarkerPath()), false);
  assert.equal(readResetWatermark(), 0);
  const ts = markReset();
  assert.equal(readResetWatermark(), ts);
  assert.match(fs.readFileSync(resetMarkerPath(), "utf8"), /"ts":\d+/);
});

test("session stats honor the reset watermark without touching transcripts", async () => {
  const mod = await import("../extensions/shared/usage-ledger.js");
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
    assert.equal(unfiltered.messages, 3);
    assert.equal(unfiltered.totals.input, 700);

    process.env.TERSIO_RESET_FILE = path.join(dir, "stats-reset.json");
    mod.markReset(now);
    const filtered = mod.importSessionTokens();
    assert.equal(filtered.messages, 1, "only post-watermark rows count");
    assert.equal(filtered.totals.input, 100);
    assert.equal(filtered.totals.output, 10);
    // The host-owned transcript file is untouched.
    assert.equal(fs.existsSync(path.join(sessions, "s.jsonl")), true);
  } finally {
    if (prevSessions === undefined) delete process.env.TERSIO_SESSIONS_DIR;
    else process.env.TERSIO_SESSIONS_DIR = prevSessions;
    if (prevReset === undefined) delete process.env.TERSIO_RESET_FILE;
    else process.env.TERSIO_RESET_FILE = prevReset;
  }
});
