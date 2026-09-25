import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const installer = path.join(root, "tersio.js");

// Empty home keeps every probe MISSING. The seeded update-check cache is
// ignored by doctor (no registry probe); install/update flows still use it.
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

function resultFileMissing(home: string, rel: string): boolean {
  return !existsSync(path.join(home, ".omp", "plugins", "node_modules", "@krtclcdy", "tersio", "extensions", rel));
}

test("doctor reports MISSING components against an empty home", () => {
  const home = missingHome();
  try {
    const result = spawnSync(process.execPath, [installer, "doctor"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: { ...process.env, HOME: home, USERPROFILE: home, PATH: path.join(home, "empty-bin") },
    });

    expect(result.status, result.stderr).toBe(0);
    for (const line of ["OMP extensions dir: MISSING", "Shared session bridge: MISSING", "Caveman extension: MISSING", "RTK extension: MISSING", "❌ RTK binary: MISSING", "RTK OMP wiring (rtk.ts): MISSING run: rtk init -g --agent omp"]) {
      expect(result.stdout).toMatch(new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    // Categorized output: merged section headers plus a closing tally.
    for (const sectionName of ["Environment", "Installation", "Extensions & plugins", "Usage & records", "Add-ons"]) {
      expect(result.stdout).toMatch(new RegExp(`\\n${sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n`));
    }
    expect(result.stdout).toMatch(/Summary: \d+ checks — ✅ \d+ ok, ⚠️ \d+ warn, ❌ \d+ missing/);
    expect(result.stdout).not.toMatch(/Tersio CLI/);
    expect(result.stdout).not.toMatch(/available — run tersio update/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor --fix dry-run previews repairs without writing", () => {
  const home = missingHome();
  try {
    const result = spawnSync(process.execPath, [installer, "doctor", "--fix", "--dry-run"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Summary: \d+ checks/);
    expect(result.stdout).toMatch(/\[dry-run\] would repair \d+ missing/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor --fix repairs missing extension files in an empty home", () => {
  const home = missingHome();
  try {
    const missing = ["caveman-session/index.ts", "caveman-session/rule.md", "rtk-session/index.ts", "combo-toggle/index.ts", "tersio-commands/index.ts", "ai-addons-updater/index.ts"];
    for (const rel of missing) {
      expect(resultFileMissing(home, rel)).toBe(true);
    }
    const result = spawnSync(process.execPath, [installer, "doctor", "--fix", "extensions", "--yes"], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/\[ok\] extensions/);
    for (const rel of missing) {
      expect(resultFileMissing(home, rel), rel).toBe(false);
    }
    const installedRule = readFileSync(path.join(home, ".omp", "plugins", "node_modules", "@krtclcdy", "tersio", "extensions", "caveman-session", "rule.md"), "utf8");
    expect(installedRule).toBe(readFileSync(path.join(root, "extensions", "caveman-session", "rule.md"), "utf8"));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 30000);

test("doctor --fix repairs config.yml registrations in an empty home", () => {
  const home = missingHome();
  try {
    const result = spawnSync(process.execPath, [installer, "doctor", "--fix", "registrations", "--yes"], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/\[ok\] registrations/);
    const config = readFileSync(path.join(home, ".omp", "agent", "config.yml"), "utf8");
    expect(config).not.toContain("combo-toggle");
    expect(config).not.toContain("pi-extension/index.js");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor --fix removes manifest-loaded combo and Ponytail registrations", () => {
  const home = missingHome();
  try {
    const agentDir = path.join(home, ".omp", "agent");
    const extDir = path.join(agentDir, "extensions");
    const ponytailExt = path.join(home, ".omp", "plugins", "node_modules", "@dietrichgebert", "ponytail", "pi-extension", "index.js");
    mkdirSync(extDir, { recursive: true });
    writeFileSync(path.join(agentDir, "config.yml"), `extensions:\n  - ./extensions/combo-toggle/index.ts\n  - ${ponytailExt}\n`, "utf8");

    const repair = spawnSync(process.execPath, [installer, "doctor", "--fix", "registrations", "--yes"], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
      env: { ...process.env, HOME: home, USERPROFILE: home, PATH: path.join(home, "empty-bin") },
    });
    expect(repair.status, repair.stderr).toBe(0);
    expect(readFileSync(path.join(agentDir, "config.yml"), "utf8")).not.toMatch(/combo-toggle|pi-extension/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor --fix rejects an invalid scope", () => {
  const home = missingHome();
  try {
    const result = spawnSync(process.execPath, [installer, "doctor", "--fix", "bogus"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Invalid --fix scope: bogus/);
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
    const binDir = path.join(home, "fake-bin");
    mkdirSync(binDir, { recursive: true });
    const rtkBin = path.join(binDir, "rtk");
    writeFileSync(rtkBin, "#!/bin/sh\necho rtk 0.49.0\n", "utf8");
    chmodSync(rtkBin, 0o755);

    const result = spawnSync(process.execPath, [installer, "doctor"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: { ...process.env, HOME: home, USERPROFILE: home, PATH: binDir },
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/✅ RTK binary: ok rtk 0\.49\.0/);
    expect(result.stdout).toMatch(/✅ RTK OMP wiring \(rtk\.ts\): ok/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor reports retired reinforcement registration and fix removes it", () => {
  const home = missingHome();
  try {
    const agentDir = path.join(home, ".omp", "agent");
    const extDir = path.join(agentDir, "extensions");
    mkdirSync(path.join(extDir, "shared"), { recursive: true });
    const stale = path.join(extDir, "shared", "mode-reinforcement.ts");
    writeFileSync(stale, "// retired", "utf8");
    writeFileSync(path.join(agentDir, "config.yml"), `extensions:\n  - ${stale}\n  - ${stale}\n`, "utf8");

    const before = spawnSync(process.execPath, [installer, "doctor"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: { ...process.env, HOME: home, USERPROFILE: home, PATH: path.join(home, "empty-bin") },
    });
    expect(before.stdout).toMatch(/⚠️ Retired reinforcement registration:/);

    const repair = spawnSync(process.execPath, [installer, "doctor", "--fix", "registrations", "--yes"], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
      env: { ...process.env, HOME: home, USERPROFILE: home, PATH: path.join(home, "empty-bin") },
    });
    expect(repair.status, repair.stderr).toBe(0);
    expect(readFileSync(path.join(agentDir, "config.yml"), "utf8")).not.toContain("mode-reinforcement.ts");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
