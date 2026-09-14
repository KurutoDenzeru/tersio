import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
    for (const line of ["OMP extensions dir: MISSING", "Shared session bridge: MISSING", "Caveman extension: MISSING", "RTK extension: MISSING", "Combo extension: MISSING", "❌ RTK binary: MISSING", "RTK OMP wiring (rtk.ts): MISSING run: rtk init -g --agent omp", "Usage ledger: ok empty — no records yet"]) {
      assert.match(result.stdout, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    // Categorized output: merged section headers plus a closing tally.
    for (const sectionName of ["Environment", "Installation", "Extensions & plugins", "Usage & records", "Add-ons"]) {
      assert.match(result.stdout, new RegExp(`\\n${sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n`));
    }
    assert.match(result.stdout, /Summary: \d+ checks — ✅ \d+ ok, ⚠️ \d+ warn, ❌ \d+ missing/);
    // Seeded cache (latest 2.1.0) is never newer than the running version, so
    // the row prints the plain version — whatever the release currently is.
    assert.match(result.stdout, /Tersio CLI: ok \d+\.\d+\.\d+/);
    assert.doesNotMatch(result.stdout, /available — run tersio update/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor reports the rtk OMP wiring when the binary and rtk.ts exist", () => {
  const home = missingHome();
  try {
    const extDir = path.join(home, ".omp", "agent", "extensions");
    mkdirSync(extDir, { recursive: true });
    writeFileSync(path.join(extDir, "rtk.ts"), "// rtk omp wiring", "utf8");
    const binDir = path.join(home, ".bun", "bin");
    mkdirSync(binDir, { recursive: true });
    const rtkBin = path.join(binDir, "rtk");
    writeFileSync(rtkBin, "#!/bin/sh\necho rtk 0.49.0\n", "utf8");
    chmodSync(rtkBin, 0o755);

    const result = spawnSync(process.execPath, [installer, "doctor"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /✅ RTK binary: ok rtk 0\.49\.0/);
    assert.match(result.stdout, /✅ RTK OMP wiring \(rtk\.ts\): ok/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
