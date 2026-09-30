import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cliEnv } from "../helpers/env.ts";

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
      env: cliEnv(home, { PATH: path.join(home, "empty-bin") }),
    });

    expect(result.status, result.stderr).toBe(0);
    for (const line of ["—  Oh My Pi: not installed", "—  Pi: not installed", "❌ RTK binary: MISSING"]) {
      expect(result.stdout).toMatch(new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    // Categorized output: merged section headers plus a closing tally.
    for (const sectionName of ["Hosts", "Extensions & plugins", "Usage & records", "Add-ons"]) {
      expect(result.stdout).toMatch(new RegExp(`\\n${sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n`));
    }
    expect(result.stdout).toMatch(/Summary: \d+ checks — ✅ \d+ ok, ⚠️ \d+ warn, ❌ \d+ missing/);
    expect(result.stdout, "no host installed, so no per-host extension rows").not.toMatch(/Caveman extension/);
    expect(result.stdout).not.toMatch(/Tersio CLI/);
    expect(result.stdout).not.toMatch(/available — run tersio update/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor names both hosts with the command that installs each", () => {
  const home = missingHome();
  try {
    const result = spawnSync(process.execPath, [installer, "doctor"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: cliEnv(home, { PATH: path.join(home, "empty-bin") }),
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/— {2}Oh My Pi: not installed · omp plugin install @krtclcdy\/tersio/);
    expect(result.stdout).toMatch(/— {2}Pi: not installed · pi install npm:@krtclcdy\/tersio/);
    // The retired rows and the Node banner are gone.
    for (const gone of ["Environment", "Installation", "Shared session bridge", "RTK OMP wiring", "Node:"]) {
      expect(result.stdout, gone).not.toContain(gone);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor reports each host that has tersio installed", () => {
  const home = missingHome();
  try {
    const ompPkg = path.join(home, ".omp", "plugins", "node_modules", "@krtclcdy", "tersio");
    const piDir = path.join(home, ".pi", "agent");
    const piPkg = path.join(piDir, "npm", "node_modules", "@krtclcdy", "tersio");
    mkdirSync(ompPkg, { recursive: true });
    mkdirSync(piPkg, { recursive: true });
    writeFileSync(path.join(ompPkg, "package.json"), JSON.stringify({ name: "@krtclcdy/tersio", version: "2.23.0" }), "utf8");
    writeFileSync(path.join(piPkg, "package.json"), JSON.stringify({ name: "@krtclcdy/tersio", version: "2.23.0" }), "utf8");
    writeFileSync(path.join(piDir, "settings.json"), JSON.stringify({ packages: ["npm:@krtclcdy/tersio@2.23.0"] }), "utf8");

    const result = spawnSync(process.execPath, [installer, "doctor"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: cliEnv(home, { PATH: path.join(home, "empty-bin") }),
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/✅ Oh My Pi: ok package @krtclcdy\/tersio 2\.23\.0/);
    expect(result.stdout).toMatch(/✅ Pi: ok package @krtclcdy\/tersio 2\.23\.0/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor counts a pi declaration without a package directory as missing", () => {
  const home = missingHome();
  try {
    const piDir = path.join(home, ".pi", "agent");
    mkdirSync(piDir, { recursive: true });
    writeFileSync(path.join(piDir, "settings.json"), JSON.stringify({ packages: [{ source: "npm:@krtclcdy/tersio" }] }), "utf8");

    const result = spawnSync(process.execPath, [installer, "doctor"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: cliEnv(home, { PATH: path.join(home, "empty-bin") }),
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/❌ Pi: MISSING declared \(npm:@krtclcdy\/tersio\) but not installed/);
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
      env: cliEnv(home),
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
      env: cliEnv(home),
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
      env: cliEnv(home),
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
      env: cliEnv(home, { PATH: path.join(home, "empty-bin") }),
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
      env: cliEnv(home),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Invalid --fix scope: bogus/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor reports the rtk binary version", () => {
  const home = missingHome();
  try {
    const extDir = path.join(home, ".omp", "agent", "extensions");
    mkdirSync(extDir, { recursive: true });
    const binDir = path.join(home, "fake-bin");
    mkdirSync(binDir, { recursive: true });
    const rtkBin = path.join(binDir, "rtk");
    writeFileSync(rtkBin, "#!/bin/sh\necho rtk 0.49.0\n", "utf8");
    chmodSync(rtkBin, 0o755);

    const result = spawnSync(process.execPath, [installer, "doctor"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: cliEnv(home, { PATH: binDir }),
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/✅ RTK binary: ok rtk 0\.49\.0/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor reports retired reinforcement registration and fix removes it", () => {
  const home = missingHome();
  try {
    const agentDir = path.join(home, ".omp", "agent");
    const extDir = path.join(agentDir, "extensions");
    // The registration rows only run for a host that has tersio installed.
    const ompPkg = path.join(home, ".omp", "plugins", "node_modules", "@krtclcdy", "tersio");
    mkdirSync(ompPkg, { recursive: true });
    writeFileSync(path.join(ompPkg, "package.json"), JSON.stringify({ name: "@krtclcdy/tersio", version: "2.23.0" }), "utf8");
    mkdirSync(path.join(extDir, "shared"), { recursive: true });
    const stale = path.join(extDir, "shared", "mode-reinforcement.ts");
    writeFileSync(stale, "// retired", "utf8");
    writeFileSync(path.join(agentDir, "config.yml"), `extensions:\n  - ${stale}\n  - ${stale}\n`, "utf8");

    const before = spawnSync(process.execPath, [installer, "doctor"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: cliEnv(home, { PATH: path.join(home, "empty-bin") }),
    });
    expect(before.stdout).toMatch(/⚠️ Retired reinforcement registration:/);

    const repair = spawnSync(process.execPath, [installer, "doctor", "--fix", "registrations", "--yes"], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
      env: cliEnv(home, { PATH: path.join(home, "empty-bin") }),
    });
    expect(repair.status, repair.stderr).toBe(0);
    expect(readFileSync(path.join(agentDir, "config.yml"), "utf8")).not.toContain("mode-reinforcement.ts");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor --fix leaves an existing fetched rule.md alone and writes no .bak", () => {
  const home = missingHome();
  try {
    // A repair must not overwrite the upstream fetch or leave a .bak.
    const rulePath = path.join(home, ".omp", "plugins", "node_modules", "@krtclcdy", "tersio", "extensions", "caveman-session", "rule.md");
    mkdirSync(path.dirname(rulePath), { recursive: true });
    const fetched = "# fetched from upstream\n";
    writeFileSync(rulePath, fetched, "utf8");

    const result = spawnSync(process.execPath, [installer, "doctor", "--fix", "extensions", "--yes"], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
      env: cliEnv(home),
    });

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(rulePath, "utf8")).toBe(fetched);
    expect(!existsSync(`${rulePath}.bak`), "no rule.md.bak from a repair").toBeTruthy();
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
      env: cliEnv(home),
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
      env: cliEnv(home, { PATH: path.join(home, "empty-bin") }),
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
      env: cliEnv(home),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Invalid --fix scope: bogus/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor reports the rtk binary version", () => {
  const home = missingHome();
  try {
    const extDir = path.join(home, ".omp", "agent", "extensions");
    mkdirSync(extDir, { recursive: true });
    const binDir = path.join(home, "fake-bin");
    mkdirSync(binDir, { recursive: true });
    const rtkBin = path.join(binDir, "rtk");
    writeFileSync(rtkBin, "#!/bin/sh\necho rtk 0.49.0\n", "utf8");
    chmodSync(rtkBin, 0o755);

    const result = spawnSync(process.execPath, [installer, "doctor"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: cliEnv(home, { PATH: binDir }),
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/✅ RTK binary: ok rtk 0\.49\.0/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor --fix registrations still clears a retired entry the doctor no longer reports", () => {
  const home = missingHome();
  try {
    const agentDir = path.join(home, ".omp", "agent");
    const extDir = path.join(agentDir, "extensions");
    // The registration rows only run for a host that has tersio installed.
    const ompPkg = path.join(home, ".omp", "plugins", "node_modules", "@krtclcdy", "tersio");
    mkdirSync(ompPkg, { recursive: true });
    writeFileSync(path.join(ompPkg, "package.json"), JSON.stringify({ name: "@krtclcdy/tersio", version: "2.23.0" }), "utf8");
    mkdirSync(path.join(extDir, "shared"), { recursive: true });
    const stale = path.join(extDir, "shared", "mode-reinforcement.ts");
    writeFileSync(stale, "// retired", "utf8");
    writeFileSync(path.join(agentDir, "config.yml"), `extensions:\n  - ${stale}\n  - ${stale}\n`, "utf8");

    const before = spawnSync(process.execPath, [installer, "doctor"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: cliEnv(home, { PATH: path.join(home, "empty-bin") }),
    });
    // The retired-registration check was removed; the repair it pointed at stays.
    expect(before.stdout).not.toMatch(/[Rr]etired reinforcement/);

    const repair = spawnSync(process.execPath, [installer, "doctor", "--fix", "registrations", "--yes"], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
      env: cliEnv(home, { PATH: path.join(home, "empty-bin") }),
    });
    expect(repair.status, repair.stderr).toBe(0);
    expect(readFileSync(path.join(agentDir, "config.yml"), "utf8")).not.toContain("mode-reinforcement.ts");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
