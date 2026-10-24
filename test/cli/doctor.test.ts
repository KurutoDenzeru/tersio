import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cliEnv, fakeExecutable, isWindows } from "../helpers/env.ts";
import { fileContains } from "../../extensions/shared/utils.ts";
import { PI_PONYTAIL_FILES, TREE_FILES, sourcePath, treeFileText, treeFilesFor } from "../../cli/manifest.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const installer = path.join(root, "dist", "tersio.js");

// Empty home keeps probes MISSING; the seeded cache is ignored by doctor but used by install/update.
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

function extDir(home: string): string {
  return path.join(home, ".omp", "plugins", "node_modules", "@krtclcdy", "tersio", "extensions");
}

function resultFileMissing(home: string, rel: string): boolean {
  return !existsSync(path.join(extDir(home), rel));
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

// A dry run must reach the repairs: previewing the plan is the flag's point, and every write is guarded.
test("doctor --fix dry-run previews debris removal", () => {
  const home = missingHome();
  try {
    const dir = hostExtensionsDirForTest("pi", home);
    for (const rel of treeFilesFor("pi")) {
      mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      writeFileSync(path.join(dir, rel), "// current\n", "utf8");
    }
    seedPluginPackage(home);
    // A rename this build replaced: nothing loads it, and the repair removes it.
    mkdirSync(path.join(dir, "caveman-session"), { recursive: true });
    writeFileSync(path.join(dir, "caveman-session", "rule.md"), "OLD BODY\n", "utf8");
    const result = spawnSync(process.execPath, [installer, "doctor", "--fix", "extensions", "--dry-run"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: cliEnv(home),
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/would remove debris .*caveman-session[\\/]rule\.md/);
    expect(existsSync(path.join(dir, "caveman-session", "rule.md")), "a dry run must not write").toBe(true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor --fix repairs missing extension files in an empty home", () => {
  const home = missingHome();
  try {
    const missing = ["caveman/index.ts", "caveman/rule.md", "caveman/rule-lite.md", "caveman/rule-megacave-lite.md", "caveman/rule-megacave-ultra.md", "caveman/rule-ultra.md", "caveman/rule-megacave.md", "rtk/session.ts", "combo/index.ts", "commands/index.ts", "updater/index.ts"];
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
    for (const name of ["rule.md", "rule-lite.md", "rule-megacave-lite.md", "rule-megacave-ultra.md", "rule-ultra.md", "rule-megacave.md"]) {
      const installed = readFileSync(path.join(home, ".omp", "plugins", "node_modules", "@krtclcdy", "tersio", "extensions", "caveman", name), "utf8");
      expect(installed, name).toBe(readFileSync(path.join(root, "extensions", "caveman", name), "utf8"));
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 30000);

// An interrupted --fix leaves entry points present but imports absent.
test("doctor names a half-written tree that still has its entry points", () => {
  const home = missingHome();
  try {
    const ext = extDir(home);
    for (const rel of ["caveman/index.ts", "rtk/session.ts", "updater/index.ts"]) {
      mkdirSync(path.join(ext, path.dirname(rel)), { recursive: true });
      writeFileSync(path.join(ext, rel), "export default {}\n", "utf8");
    }
    const result = spawnSync(process.execPath, [installer, "doctor"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: cliEnv(home, { PATH: path.join(home, "empty-bin") }),
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/❌ Extension tree: MISSING/);
    expect(result.stdout).toContain("shared/status.ts");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor --fix fills the gap and confirms the whole tree", () => {
  const home = missingHome();
  try {
    const ext = extDir(home);
    mkdirSync(path.join(ext, "caveman"), { recursive: true });
    writeFileSync(path.join(ext, "caveman", "index.ts"), "export default {}\n", "utf8");

    const result = spawnSync(process.execPath, [installer, "doctor", "--fix", "extensions", "--yes"], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
      env: cliEnv(home),
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/\[ok\] extension tree: \d+ files/);
    expect(result.stdout).not.toContain("[fail] tree incomplete");
    for (const rel of ["shared/status.ts", "caveman/index.ts", "rtk/session.ts"]) {
      expect(resultFileMissing(home, rel), rel).toBe(false);
    }
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
    expect(config).not.toContain("combo/index.ts");
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
    writeFileSync(path.join(agentDir, "config.yml"), `extensions:\n  - ./extensions/combo/index.ts\n  - ${ponytailExt}\n`, "utf8");

    const repair = spawnSync(process.execPath, [installer, "doctor", "--fix", "registrations", "--yes"], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
      env: cliEnv(home, { PATH: path.join(home, "empty-bin") }),
    });
    expect(repair.status, repair.stderr).toBe(0);
    expect(readFileSync(path.join(agentDir, "config.yml"), "utf8")).not.toMatch(/combo\/index\.ts|pi-extension/);
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
    const rtkBin = fakeExecutable(binDir, isWindows() ? "rtk.exe" : "rtk", "echo rtk 0.49.0", "echo rtk 0.49.0");

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

test("doctor --fix leaves an existing fetched rule.md alone and writes no .bak", () => {
  const home = missingHome();
  try {
    // A repair must not overwrite the upstream fetch or leave a .bak.
    const rulePath = path.join(home, ".omp", "plugins", "node_modules", "@krtclcdy", "tersio", "extensions", "caveman", "rule.md");
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

// The manifest is what omp loads, so a repair writes this build's own block over the package's.
test("doctor --fix extensions writes this build's plugin manifest", () => {
  const home = missingHome();
  try {
    const pkg = seedPluginPackage(home);
    const pkgPath = path.join(pkg, "package.json");
    // The state a published package leaves behind: one entry of the day, and no pstack.
    writeFileSync(pkgPath, JSON.stringify({ name: "@krtclcdy/tersio", version: "0.0.0", omp: { extensions: ["./extensions/caveman/index.ts"] } }), "utf8");

    const result = spawnSync(process.execPath, [installer, "doctor", "--fix", "extensions", "--yes"], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
      env: cliEnv(home),
    });

    expect(result.status, result.stderr).toBe(0);
    const shipped = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { omp: unknown };
    const installed = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string; omp?: unknown };
    expect(installed.omp, "the manifest names what this build ships").toEqual(shipped.omp);
    expect(installed.name, "the package's own fields survive").toBe("@krtclcdy/tersio");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 30000);

// Without a separate row, an unusable rtk_run reads as a healthy install.
test("doctor warns that rtk_run needs an exec-capable host", () => {
  const home = missingHome();
  try {
    const binDir = path.join(home, "fake-bin");
    mkdirSync(binDir, { recursive: true });
    const rtkBin = fakeExecutable(binDir, isWindows() ? "rtk.exe" : "rtk", "echo rtk 0.49.0", "echo rtk 0.49.0");

    const result = spawnSync(process.execPath, [installer, "doctor"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: cliEnv(home, { PATH: binDir }),
    });

    expect(result.status, result.stderr).toBe(0);
    // The binary is present and runnable, yet no host can exec it.
    expect(result.stdout).toMatch(/✅ RTK binary: ok rtk 0\.49\.0/);
    expect(result.stdout).toMatch(/⚠️ RTK exec: warn no installed host exposes an exec API/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor --fix removes a foreign opencode tree from pi", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-doctor-foreign-"));
  try {
    const ext = path.join(home, ".pi", "agent", "extensions");
    mkdirSync(path.join(ext, "shared"), { recursive: true });
    writeFileSync(path.join(ext, "shared", "host.ts"), "// stale", "utf8");
    mkdirSync(path.join(ext, "opencode"), { recursive: true });
    writeFileSync(path.join(ext, "opencode", "server.ts"), "// stale", "utf8");
    const result = spawnSync(process.execPath, [installer, "doctor", "--fix", "extensions", "--yes"], {
      cwd: root,
      encoding: "utf8",
      timeout: 60000,
      env: cliEnv(home, { PATH: path.join(home, "empty-bin") }),
    });
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(path.join(ext, "opencode"))).toBe(false);
    expect(result.stdout).toMatch(/foreign/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor does not count the exec row when rtk is absent", () => {
  const home = missingHome();
  try {
    const result = spawnSync(process.execPath, [installer, "doctor"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: cliEnv(home, { PATH: path.join(home, "empty-bin") }),
    });

    expect(result.status, result.stderr).toBe(0);
    // The exec question is meaningless without a binary, a missing pstack tree is one warning, not five,
    // and a missing price cache is a warning, not a missing count: the fallback table still prices rows.
    expect(result.stdout).toMatch(/—  RTK exec: not installed/);
    expect(result.stdout).toMatch(/Summary: 9 checks — ✅ 3 ok, ⚠️ 2 warn, ❌ 4 missing/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor names the missing pstack tree, not just the rule", () => {
  const home = missingHome();
  try {
    const result = spawnSync(process.execPath, [installer, "doctor"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: cliEnv(home, { PATH: path.join(home, "empty-bin") }),
    });

    expect(result.status, result.stderr).toBe(0);
    // The index routes to files, so a rule with no leaves serves a mode that cannot apply one.
    expect(result.stdout).toMatch(/⚠️ pstack tree: warn missing \d+ files: playbooks\//);
    expect(result.stdout).toMatch(/pstack rule: MISSING/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor finds a marker that straddles a chunk boundary", async () => {
  const home = missingHome();
  try {
    const binDir = path.join(home, "big-bin");
    // fileContains reads 1 MiB at a time, so pad the marker across the boundary to catch a scan that drops the tail.
    const marker = "Worker agent: delegated tasks.";
    const pad = "x".repeat((1 << 20) - Math.floor(marker.length / 2));
    const bin = fakeExecutable(binDir, "omp", `${pad}${marker}`, `${pad}${marker}`);

    expect(await fileContains(bin, marker)).toBe(true);
    expect(await fileContains(bin, "a marker that is not present")).toBe(false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// Verbatim from omp's own prompt: a re-worded release stops Caveman reaching subagents.
function fakeOmp(dir: string, body: string): string {
  const bin = path.join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  const lines = body.split("\n").map((line) => `# ${line}`).join("\n");
  // The marker lives in the file text, and the explicit exit matters: `#` is not a batch comment, so cmd.exe would exit non-zero and the probe would throw.
  fakeExecutable(bin, "omp", `# Fake omp for the subagent-marker check.\n${lines}\nexit 0`, `${lines}\nexit /b 0`);
  return bin;
}

// A fake opencode on PATH: `service status` answers the case, and `pgrep` answers whether a serve process is alive.
function fakeOpencode(dir: string, status: string, pids: string[] = []): string {
  const bin = path.join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  fakeExecutable(
    bin,
    "opencode",
    `if [ "$1" = "service" ] && [ "$2" = "status" ]; then\n  printf '%s\\n' '${status}'\nfi\nexit 0`,
    `if "%1"=="service" if "%2"=="status" echo ${status}\r\nexit /b 0`,
  );
  const body = pids.length > 0 ? pids.join("\\n") : "";
  fakeExecutable(bin, "pgrep", `printf '%s\\n' '${body}'\nexit 0`, pids.length > 0 ? `echo ${pids.join("\r\necho ")}` : "exit /b 0");
  return bin;
}

function runDoctor(home: string, bin: string): { status: number; stdout: string } {
  return spawnSync(process.execPath, [installer, "doctor"], {
    cwd: root,
    encoding: "utf8",
    timeout: 30000,
    env: cliEnv(home, { PATH: bin }),
  });
}

test("doctor warns when omp no longer carries the subagent marker", () => {
  const home = missingHome();
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-doctor-drift-"));
  try {
    const bin = fakeOmp(dir, "Worker prompt with no marker sentence at all");
    const result = runDoctor(home, bin);
    expect(result.status, result.stderr).toBe(0);
    // The check is a warning, not a failure: a drifted marker costs subagent coverage, not the run.
    expect(result.stdout).toMatch(/⚠️\s+Caveman subagent marker/);
    expect(result.stdout).toMatch(/OMP_SUBAGENT_MARKER/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("doctor stays silent when omp still carries the subagent marker", () => {
  const home = missingHome();
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-doctor-nodrift-"));
  try {
    const bin = fakeOmp(dir, "Some preamble.\nWorker agent: delegated tasks.\nMore preamble.");
    const result = runDoctor(home, bin);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toMatch(/Caveman subagent marker/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Each host keeps its own copy of the rule bodies until its own install runs, so the plugin copy alone hides drift.
/** A host's own extension tree, mirroring `hostExtensionsDir` under a fake HOME. */
function hostExtensionsDirForTest(id: "omp" | "pi" | "opencode", home: string): string {
  if (id === "omp") return path.join(home, ".omp", "agent", "extensions");
  if (id === "opencode") return path.join(home, ".config", "opencode", "plugins", "tersio");
  return path.join(home, ".pi", "agent", "extensions");
}

function seededHostTree(home: string, id: "omp" | "pi" | "opencode"): string {
  const dir = hostExtensionsDirForTest(id, home);
  // A host only counts as installed when every tree file is present, so seed the whole set for that host.
  // Everything but the Caveman bodies ships current, so the stale set is exactly the bodies this test is about.
  for (const rel of treeFilesFor(id)) {
    const at = path.join(dir, rel);
    mkdirSync(path.dirname(at), { recursive: true });
    // A file this build declares but does not ship is debris; seed it as the stub it always was.
    let body = "// stub\n";
    if (rel.startsWith("caveman/")) body = "STALE BODY\n";
    else {
      const source = sourcePath(rel);
      if (existsSync(source)) body = readFileSync(source, "utf8");
    }
    writeFileSync(at, body, "utf8");
  }
  // The reference the tree is compared against, so the seeded stale body actually reads as stale.
  seedPluginPackage(home);
  return dir;
}

/** The plugin package seeded with what this CLI would install, so host-drift tests do not also trip over omp. */
function seedPluginPackage(home: string): string {
  const pkg = path.join(home, ".omp", "plugins", "node_modules", "@krtclcdy", "tersio");
  for (const rel of TREE_FILES) {
    const at = path.join(pkg, "extensions", rel);
    mkdirSync(path.dirname(at), { recursive: true });
    writeFileSync(at, readFileSync(sourcePath(rel), "utf8"), "utf8");
  }
  return pkg;
}

test("doctor warns when a host tree holds an older Caveman body", () => {
  const home = missingHome();
  try {
    seededHostTree(home, "pi");
    const result = runDoctor(home, path.join(home, "empty-bin"));
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Per-host add-on files/);
    // The line names only the first few stale files, so assert the class rather than one path: every Caveman body in the seeded tree is stale, and the fix command is named.
    const line = (result.stdout.match(/Per-host add-on files:.*$/m) ?? [""])[0];
    const named = [...line.matchAll(/(pi\/caveman\/[a-z-]+\.md)/g)].map((m) => m[1]);
    expect(named.length, `caveman bodies named: ${named.join(", ")}`).toBeGreaterThan(0);
    expect(result.stdout).toMatch(/tersio install --host/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// One hook cannot stand for the ruleset: 5.1 and 5.2 ship the same instructions file and differ in a skill.
test("doctor names a stale ponytail file, not just the host", () => {
  const home = missingHome();
  try {
    seededHostTree(home, "pi");
    const ref = path.join(seedPluginPackage(home), "extensions", "ponytail");
    const piDir = path.join(home, ".pi", "agent", "ponytail");
    seedPonytailBodies(ref, (rel) => `reference ${rel}\n`);
    // pi's copy agrees everywhere except one skill body, so the row must name that file and nothing else.
    seedPonytailBodies(piDir, (rel) => (rel === "skills/ponytail-debt/SKILL.md" ? "older body\n" : `reference ${rel}\n`));
    // pi loads the package its settings.json names; without it the doctor falls back to the npm route.
    writeFileSync(path.join(home, ".pi", "agent", "settings.json"), JSON.stringify({ packages: [piDir] }, null, 2), "utf8");

    const result = runDoctor(home, path.join(home, "empty-bin"));

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Ponytail per-host bodies:.*stale in 1 file: pi\/skills\/ponytail-debt\/SKILL\.md/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor stays silent when every host tree matches the plugin copy", () => {
  const home = missingHome();
  try {
    const result = runDoctor(home, path.join(home, "empty-bin"));
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toMatch(/Per-host add-on files/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});


// omp's tree and the installed package are the same directory, so the reference is this CLI's source instead.
test("doctor does not report a stale omp package tree", () => {
  const home = missingHome();
  try {
    const pkg = seedPluginPackage(home);
    const result0 = runDoctor(home, path.join(home, "empty-bin"));
    expect(result0.status, result0.stderr).toBe(0);
    expect(result0.stdout).not.toMatch(/Per-host add-on files/);
    // A dist copy that differs must stay silent: the manifest loads ./extensions/caveman/index.ts.
    const dist = path.join(pkg, "dist", "extensions", "caveman");
    mkdirSync(dist, { recursive: true });
    writeFileSync(path.join(dist, "rule.md"), "STALE DIST COPY\n", "utf8");
    const result = runDoctor(home, path.join(home, "empty-bin"));
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toMatch(/Per-host add-on files/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// Reading the installed package as its own reference can never catch an older npm copy, so the check names the file.
test("doctor reports an omp package older than the running CLI", () => {
  const home = missingHome();
  try {
    seedPluginPackage(home);
    const stale = path.join(home, ".omp", "plugins", "node_modules", "@krtclcdy", "tersio", "extensions", "rtk", "session.ts");
    mkdirSync(path.dirname(stale), { recursive: true });
    writeFileSync(stale, "// published copy, older than the running CLI\n", "utf8");
    const result = runDoctor(home, path.join(home, "empty-bin"));
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Per-host add-on files/);
    expect(result.stdout).toMatch(/omp\/rtk\/session\.ts/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// A package from another release.
test("doctor warns when the omp plugin package is not this build", () => {
  const home = missingHome();
  try {
    const pkg = seedPluginPackage(home);
    writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "@krtclcdy/tersio", version: "99.0.0" }), "utf8");
    const result = runDoctor(home, path.join(home, "empty-bin"));
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/OMP plugin package/);
    expect(result.stdout).toMatch(/99\.0\.0/);
    expect(result.stdout).toMatch(/tersio install --host omp/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// A tree that loses the OpenCode entry reports it missing, not orphan: omp's manifest names that file.
test("doctor reports the package tree missing the OpenCode entry", () => {
  const home = missingHome();
  try {
    const pkg = seedPluginPackage(home);
    rmSync(path.join(pkg, "extensions", "server.ts"));
    const result = runDoctor(home, path.join(home, "empty-bin"));
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/never installed/);
    expect(result.stdout).toMatch(/omp\/server\.ts/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// A stale extension whose import target was removed keeps loading on pi, which auto-discovers every index.ts.
function seedStalePiTree(home: string): string {
  seedPluginPackage(home);
  const tree = hostExtensionsDirForTest("pi", home);
  for (const rel of treeFilesFor("pi")) {
    if (rel === "server.ts") continue;
    mkdirSync(path.dirname(path.join(tree, rel)), { recursive: true });
    writeFileSync(path.join(tree, rel), treeFileText(rel) ?? "", "utf8");
  }
  const stale = path.join(tree, "tersio-commands");
  mkdirSync(stale, { recursive: true });
  writeFileSync(path.join(stale, "index.ts"), "export default {}\n", "utf8");
  return stale;
}

test("doctor reports a stale tersio-commands extension as debris", () => {
  const home = missingHome();
  try {
    const stale = seedStalePiTree(home);
    expect(existsSync(path.join(stale, "index.ts"))).toBe(true);
    const result = runDoctor(home, path.join(home, "empty-bin"));
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Per-host add-on files/);
    expect(result.stdout).toMatch(/pi\/tersio-commands\/index\.ts/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor --fix removes a stale tersio-commands extension", () => {
  const home = missingHome();
  try {
    const stale = seedStalePiTree(home);
    const result = spawnSync(process.execPath, [installer, "doctor", "--fix", "extensions", "--yes"], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
      env: cliEnv(home),
    });
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(path.join(stale, "index.ts")), "the stale extension must not load again").toBe(false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// A service that answers with its URL is running; the word is only one of the answers OpenCode gives.
test("serviceRunning reads a URL answer as running", async () => {
  const { serviceRunning } = await import("../../cli/doctor-fix.ts");
  expect(serviceRunning("http://127.0.0.1:49374")).toBe(true);
  expect(serviceRunning("https://127.0.0.1:443")).toBe(true);
  expect(serviceRunning("running")).toBe(true);
  expect(serviceRunning("stopped")).toBe(false);
  expect(serviceRunning("")).toBe(false);
});

// The probe reads stopped-and-dead on Windows, which ships no pgrep, so the warning is unreachable there. Skipped rather than weakened.
test.skipIf(isWindows())("doctor warns when a serve process outlives the service manager", () => {
  const home = missingHome();
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-oc-stale-"));
  try {
    const bin = fakeOpencode(dir, "stopped", ["4242"]);
    const result = runDoctor(home, bin);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/OpenCode service/);
    expect(result.stdout).toMatch(/a serve process is alive but the service reads stopped/);
    expect(result.stdout).toMatch(/tersio doctor --fix service/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A service that answers with its URL reads healthy, and a healthy service adds no row.
test("doctor stays silent when the opencode service answers with its URL", () => {
  const home = missingHome();
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-oc-ok-"));
  try {
    const bin = fakeOpencode(dir, "http://127.0.0.1:49374", ["4242"]);
    const result = runDoctor(home, bin);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toMatch(/OpenCode service/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The pstack body is a Tersio fork with no remote, so the row proves it is usable rather than current.
test("doctor checks the pstack rule body", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-pstack-body-"));
  try {
    const pkg = seedPluginPackage(home);
    const ok = runDoctor(home, path.join(home, "empty-bin"));
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout).toMatch(/pstack rule: ok/);

    // A truncated body is the failure the check exists for: it would read to the model as the real one.
    writeFileSync(path.join(pkg, "extensions", "pstack", "rule.md"), "# pstack\n\n", "utf8");
    const broken = runDoctor(home, path.join(home, "empty-bin"));
    expect(broken.stdout).toMatch(/pstack rule\.md: warn unusable body \(truncated/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// A manager that answers running with nothing behind it is its own failure, not the orphan one.
// Same Windows limit as the orphan probe above: `pgrep` decides "alive".
test.skipIf(isWindows())("doctor warns when the service reports running with no serve process", () => {
  const home = missingHome();
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-oc-dead-"));
  try {
    const bin = fakeOpencode(dir, "http://127.0.0.1:49374", []);
    const result = runDoctor(home, bin);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/reports running but no serve process is alive/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A machine with no opencode adds no row and fails nothing.
test("doctor adds no opencode service row without the binary", () => {
  const home = missingHome();
  try {
    const result = runDoctor(home, path.join(home, "empty-bin"));
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toMatch(/OpenCode service/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// A dry run names the pid the probe found and leaves nothing killed.
test.skipIf(isWindows())("doctor --fix service previews the orphaned pid without killing anything", () => {
  const home = missingHome();
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-oc-fix-"));
  try {
    const bin = fakeOpencode(dir, "stopped", ["4242"]);
    const result = spawnSync(process.execPath, [installer, "doctor", "--fix", "service", "--dry-run", "--yes"], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
      env: cliEnv(home, { PATH: bin }),
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/would stop the orphaned serve process \(pid 4242\)/);
    expect(result.stdout, "a dry run must not start the service").not.toMatch(/Starting the OpenCode service/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The walk catches a stale add-on file too: an older combo/index.ts behaves old, and only that file is named.
test("doctor warns about a stale add-on file in a host tree", () => {
  const home = missingHome();
  try {
    // The plugin package and pi's tree both hold what this CLI installs, so the edit below is the only difference.
    seedPluginPackage(home);
    const tree = hostExtensionsDirForTest("pi", home);
    for (const rel of treeFilesFor("pi")) {
      if (rel === "server.ts") continue;
      mkdirSync(path.dirname(path.join(tree, rel)), { recursive: true });
      writeFileSync(path.join(tree, rel), treeFileText(rel) ?? "", "utf8");
    }
    writeFileSync(path.join(tree, "combo", "index.ts"), "STALE COMBO\n", "utf8");
    const result = runDoctor(home, path.join(home, "empty-bin"));
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Per-host add-on files/);
    expect(result.stdout).toMatch(/pi\/combo\/index\.ts/);
    expect(result.stdout).not.toMatch(/pi\/caveman\/index\.ts/);
    expect(result.stdout).not.toMatch(/omp\//);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// npm resolves the *published* tersio: its range can differ from this tree, so a local bump never reached install.
/** The shipped ruleset under `dir`, with a body chosen per entry: the install copies this same list. */
function seedPonytailBodies(dir: string, body: (rel: string) => string): void {
  for (const rel of PI_PONYTAIL_FILES) {
    const at = path.join(dir, ...rel.split("/"));
    mkdirSync(path.dirname(at), { recursive: true });
    writeFileSync(at, body(rel), "utf8");
  }
}

// The vendored copy inside the package is what the extensions load, so it is the reference.
test("doctor measures ponytail bodies against this tree's vendored copy", () => {
  const home = missingHome();
  try {
    const pkg = seedPluginPackage(home);
    const vendored = path.join(pkg, "extensions", "ponytail");
    seedPonytailBodies(vendored, (rel) => `VENDORED ${rel}\n`);
    // A sibling package a host might still discover must not become the reference.
    const stray = path.join(home, ".omp", "plugins", "node_modules", "@dietrichgebert", "ponytail");
    seedPonytailBodies(stray, (rel) => `STRAY ${rel}\n`);
    // OpenCode keeps the vendored body, so it agrees with what omp loads.
    seededHostTree(home, "opencode");
    const agrees = path.join(hostExtensionsDirForTest("opencode", home), "ponytail-bundle");
    seedPonytailBodies(agrees, (rel) => `VENDORED ${rel}\n`);
    // pi loads from the package its settings.json names, so that copy is the one that drifted.
    seededHostTree(home, "pi");
    const agentDir = path.join(home, ".pi", "agent");
    const local = path.join(agentDir, "ponytail");
    seedPonytailBodies(local, (rel) => (rel === "hooks/ponytail-instructions.js" ? `STRAY ${rel}\n` : `VENDORED ${rel}\n`));
    writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ packages: [local] }, null, 2), "utf8");

    const result = runDoctor(home, path.join(home, "empty-bin"));
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Ponytail per-host bodies:.*stale in 1 file: pi\/hooks\/ponytail-instructions\.js/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// pi loads ponytail from the path its settings.json names; `extensions/ponytail` is not a pi path.
test("doctor checks pi ponytail at the path its settings declare", () => {
  const home = missingHome();
  try {
    const pkg = seedPluginPackage(home);
    const agentDir = path.join(home, ".pi", "agent");
    const local = path.join(agentDir, "ponytail");
    // A host only counts as installed when every tree file is present, so seed pi's tree first.
    seededHostTree(home, "pi");
    seedPonytailBodies(local, (rel) => (rel === "hooks/ponytail-instructions.js" ? "PI BODY\n" : `SHARED ${rel}\n`));
    writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ packages: ["npm:pi-subagents", local] }, null, 2), "utf8");
    // The copy the omp extensions load is the reference: the vendored tree inside the package.
    const ref = path.join(pkg, "extensions", "ponytail");
    seedPonytailBodies(ref, (rel) => `SHARED ${rel}\n`);

    const result = runDoctor(home, path.join(home, "empty-bin"));
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Ponytail per-host bodies:.*stale in 1 file: pi\/hooks\/ponytail-instructions\.js/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
