import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const installer = path.join(root, "tersio.js");

// Seed the update-check cache so doctor never hits the npm registry in tests.
// Empty home (only the cache) keeps every other probe MISSING.
function missingHome(): string {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-doctor-"));
  const cacheDir = path.join(home, ".omp", "plugins");
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(
    path.join(cacheDir, "tersio-update-check.json"),
    JSON.stringify({ latest: "2.1.0", lastCheck: Date.now() }),
    "utf8",
  );
  return home;
}

test("doctor reports MISSING components against an empty home", () => {
  const home = missingHome();
  try {
    const result = spawnSync(process.execPath, [installer, "doctor"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });

    assert.equal(result.status, 0, result.stderr);
    for (const line of ["OMP extensions dir: MISSING", "Shared session bridge: MISSING", "Caveman extension: MISSING", "RTK extension: MISSING", "Combo extension: MISSING", "RTK binary: MISSING"]) {
      assert.match(result.stdout, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    // Categorized output: section headers plus a closing tally.
    for (const section of ["Environment", "Installation", "Extensions", "Plugins", "Add-ons"]) {
      assert.match(result.stdout, new RegExp(`\\n${section}\\n`));
    }
    assert.match(result.stdout, /Summary: \d+ checks — \d+ ok, \d+ warn, \d+ missing/);
    // Seeded cache (latest 2.1.0) is never newer than the running version, so
    // the row prints the plain version — whatever the release currently is.
    assert.match(result.stdout, /Tersio CLI: ok \d+\.\d+\.\d+/);
    assert.doesNotMatch(result.stdout, /available — run tersio update/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
