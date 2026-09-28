import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const installer = path.join(root, "tersio.js");

// Empty home keeps every probe MISSING. The seeded update-check cache is ignored by doctor (no registry probe);
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
    for (const line of ["Caveman extension: MISSING", "RTK extension: MISSING", "❌ RTK binary: MISSING"]) {
      expect(result.stdout).toMatch(new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    // Categorized output: merged section headers plus a closing tally.
    for (const sectionName of ["Extensions & plugins", "Usage & records", "Add-ons"]) {
      expect(result.stdout).toMatch(new RegExp(`\\n${sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n`));
    }
    expect(result.stdout).not.toMatch(/\nEnvironment\n/);
    expect(result.stdout).not.toMatch(/\nInstallation\n/);
    expect(result.stdout).not.toMatch(/RTK OMP wiring/);
    expect(result.stdout).not.toMatch(/Shared session bridge/);
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
    const missing = ["omp/caveman-session/index.ts", "omp/caveman-session/rule.md", "omp/rtk-session/index.ts", "omp/combo-toggle/index.ts", "omp/tersio-commands/index.ts", "omp/ai-addons-updater/index.ts"];
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
    const installedRule = readFileSync(path.join(home, ".omp", "plugins", "node_modules", "@krtclcdy", "tersio", "extensions", "omp", "caveman-session", "rule.md"), "utf8");
    expect(installedRule).toBe(readFileSync(path.join(root, "extensions", "omp", "caveman-session", "rule.md"), "utf8"));
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

test("doctor reports Oh My Pi in the host list when the tersio plugin is installed", () => {
  const home = missingHome();
  const run = () => spawnSync(process.execPath, [installer, "doctor"], {
    cwd: root,
    encoding: "utf8",
    timeout: 15000,
    env: { ...process.env, HOME: home, USERPROFILE: home, PATH: path.join(home, "empty-bin") },
  });
  try {
    const extDir = path.join(home, ".omp", "agent", "extensions");
    const pluginDir = path.join(home, ".omp", "plugins", "node_modules", "@krtclcdy", "tersio");
    mkdirSync(pluginDir, { recursive: true });
    // Every extension directory the layer owns, so the row is not warning.
    for (const dir of [
      "caveman-session", "rtk-session", "ai-addons-updater",
      "combo-toggle", "tersio-commands", "shared", "lib",
    ]) {
      mkdirSync(path.join(extDir, dir), { recursive: true });
    }

    const complete = run();
    expect(complete.status, complete.stderr).toBe(0);
    // The row lives inside Agent hosts, not in a section of its own, and it counts extension directories because those are...
    expect(complete.stdout).toMatch(/Agent hosts\n[\s\S]*?✅ Oh My Pi \(OMP\): ok .*7 extension\/module director/);

    // A partially installed layer warns and names the repair, rather than reporting a healthy host.
    rmSync(path.join(extDir, "lib"), { recursive: true, force: true });
    const partial = run();
    expect(partial.stdout).toMatch(/⚠️ Oh My Pi \(OMP\): warn .*1 of 7 extension\/module director/);
    expect(partial.stdout).toMatch(/run: tersio install --agent omp/);

    // Not installed at all: the row stays silent rather than reporting a host the machine never had.
    rmSync(pluginDir, { recursive: true, force: true });
    expect(run().stdout).not.toMatch(/Oh My Pi \(OMP\)/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor reports the rtk binary version when the binary is on PATH", () => {
  const home = missingHome();
  try {
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
    // The rtk.ts wiring row is no longer printed; the Oh My Pi host row covers the layer it belonged to.
    expect(result.stdout).not.toMatch(/RTK OMP wiring/);
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
