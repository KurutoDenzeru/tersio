import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { appendUsage, ledgerPath, readUsage } from "../extensions/shared/usage-ledger.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tersio-ledger-"));
process.env.TERSIO_USAGE_FILE = path.join(dir, "usage.jsonl");

test("ledger starts empty when the file is missing", () => {
  assert.equal(ledgerPath(), process.env.TERSIO_USAGE_FILE);
  assert.deepEqual(readUsage(), []);
});

test("appended rows round-trip in order", () => {
  appendUsage("command", "/tersio caveman full");
  appendUsage("toggle", "caveman=full");
  const rows = readUsage();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].kind, "command");
  assert.equal(rows[0].detail, "/tersio caveman full");
  assert.equal(typeof rows[0].ts, "number");
  assert.equal(rows[1].kind, "toggle");
});

test("corrupt lines are skipped, valid rows survive", () => {
  fs.appendFileSync(process.env.TERSIO_USAGE_FILE!, "not json\n{\"ts\":\"x\",\"kind\":1}\n", "utf8");
  const rows = readUsage();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].detail, "/tersio caveman full");
});
