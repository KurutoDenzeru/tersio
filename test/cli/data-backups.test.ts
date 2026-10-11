// Data snapshots hold user files, so each test runs against a fake home and fails loudly.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";

import {
  BACKUP_KEEP,
  backupDir,
  createDataBackup,
  dataSources,
  deleteDataBackup,
  listDataBackups,
  restoreDataBackup,
} from "../../cli/backups.ts";

let dir = "";
let previous: Record<string, string | undefined> = {};

/** Point every data source at the sandbox, so no test can touch the developer's own files. */
function sandboxSources(): void {
  const sources = dataSources();
  previous = {};
  const overrides: Record<string, string> = {
    "Usage ledger": "usage.db",
    "Reset watermark": "reset.json",
    Settings: "settings.json",
    "Price cache": "prices.json",
    "Model price cache": "prices-modelsdev.json",
    "Agent stats": "stats.db",
    "Agent quota windows": "agent.db",
    "Command history": "rtk.db",
  };
  const byEnv: Record<string, string> = {
    "Usage ledger": "TERSIO_USAGE_DB",
    "Reset watermark": "TERSIO_RESET_FILE",
    "Agent stats": "TERSIO_AGENT_STATS_DB",
    "Agent quota windows": "TERSIO_AGENT_SESSIONS_DB",
    "Command history": "TERSIO_RTK_DB",
  };
  for (const source of sources) {
    const name = overrides[source.label];
    if (!name) continue;
    previous[name] = process.env[name];
    const envName = byEnv[source.label];
    if (envName) process.env[envName] = path.join(dir, name);
    const target = envName ? path.join(dir, name) : path.join(dir, ".tersio", name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, `${source.label} body`);
  }
  process.env.TERSIO_HOME = path.join(dir, ".tersio");
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "tersio-data-"));
  sandboxSources();
});

afterEach(() => {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});

test("a snapshot copies every file the machine has and names them in a manifest", async () => {
  const made = await createDataBackup();
  expect(existsSync(path.join(made.path, "usage.db")), "ledger copied").toBe(true);
  expect(existsSync(path.join(made.path, "stats.db")), "agent stats copied").toBe(true);
  expect(existsSync(path.join(made.path, "reset.json")), "watermark copied").toBe(true);
  const manifest = JSON.parse(readFileSync(path.join(made.path, "manifest.json"), "utf8")) as Array<{ label: string; source: string }>;
  expect(manifest.map((entry) => entry.label)).toEqual(made.files.map((entry) => entry.label));
  expect(manifest.every((entry) => entry.source.startsWith(dir))).toBe(true);
});

test("only the newest snapshots are kept", async () => {
  for (let i = 0; i < BACKUP_KEEP + 2; i += 1) await createDataBackup();
  const kept = listDataBackups();
  expect(kept.length).toBe(BACKUP_KEEP);
  const stamps = kept.map((entry) => entry.name.replace("data-", ""));
  expect(stamps).toEqual([...stamps].toSorted((a, b) => b.localeCompare(a)));
});

test("a restore puts the snapshot's files back and leaves the rest alone", async () => {
  await createDataBackup();
  const ledger = path.join(dir, "usage.db");
  writeFileSync(ledger, "changed after the snapshot");
  const untouched = path.join(dir, "loose.txt");
  writeFileSync(untouched, "keep me");
  const target = listDataBackups()[0];

  expect(await restoreDataBackup(target.name)).toBe(true);
  expect(readFileSync(ledger, "utf8")).toBe("Usage ledger body");
  // A file the snapshot does not carry survives the restore.
  expect(readFileSync(untouched, "utf8")).toBe("keep me");
});

test("a restore refuses a name outside the backup directory", async () => {
  await createDataBackup();
  expect(await restoreDataBackup("../usage.db")).toBe(false);
  expect(await restoreDataBackup("/etc/passwd")).toBe(false);
  expect(await restoreDataBackup("missing")).toBe(false);
});

test("a delete removes exactly one snapshot", async () => {
  await createDataBackup();
  await createDataBackup();
  const all = listDataBackups();
  expect(await deleteDataBackup(all[0].name)).toBe(true);
  const left = listDataBackups();
  expect(left.map((entry) => entry.name)).toEqual([all[1].name]);
  // The live data is untouched by a delete of its snapshot.
  expect(existsSync(path.join(dir, "usage.db"))).toBe(true);
});

test("an older single-file snapshot still lists and restores the ledger", async () => {
  const legacyName = "usage-20260101000000.db";
  mkdirSync(backupDir(), { recursive: true });
  writeFileSync(path.join(backupDir(), legacyName), "the old mirror");
  const found = listDataBackups();
  expect(found.map((entry) => entry.name)).toContain(legacyName);
  expect(found.find((entry) => entry.name === legacyName)?.files.map((file) => file.label)).toEqual(["Usage ledger"]);

  const ledger = path.join(dir, "usage.db");
  writeFileSync(ledger, "changed");
  expect(await restoreDataBackup(legacyName)).toBe(true);
  expect(readFileSync(ledger, "utf8")).toBe("the old mirror");
  expect(await deleteDataBackup(legacyName)).toBe(true);
  expect(listDataBackups().some((entry) => entry.name === legacyName)).toBe(false);
});
