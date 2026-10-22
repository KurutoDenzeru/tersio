import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { bannerLines, bannerTier } from "../../cli/banner.ts";
import { detectHosts, hostLabel } from "../../cli/hosts.ts";
import type { HostEntry } from "../../cli/hosts.ts";
import { cliEnv, fakeRtkBin } from "../helpers/env.ts";
import { registryUrl, releasesUrl } from "../helpers/registry.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const installer = path.join(root, "dist", "tersio.js");
const { version } = createRequire(import.meta.url)("../../package.json");

// bootstrap

const script = path.join(root, "install.sh");

// POSIX sh script, skipped on Windows; fake npm/bun answer install.sh's calls and a fake tersio logs the follow-up.
function fakeEnv(): { bin: string; prefix: string; tersioLog: string } {
  const bin = mkdtempSync(path.join(os.tmpdir(), "tersio-curl-bin-"));
  const prefix = mkdtempSync(path.join(os.tmpdir(), "tersio-curl-prefix-"));
  const tersioLog = path.join(bin, "tersio-args.log");
  mkdirSync(path.join(prefix, "bin"), { recursive: true });
  writeFileSync(path.join(bin, "npm"), '#!/bin/sh\nif [ "$1" = "prefix" ]; then echo "' + prefix + '"; else echo "fake-npm $*"; fi\n', "utf8");
  chmodSync(path.join(bin, "npm"), 0o755);
  writeFileSync(path.join(bin, "bun"), '#!/bin/sh\necho "fake-bun $*"\n', "utf8");
  chmodSync(path.join(bin, "bun"), 0o755);
  writeFileSync(path.join(prefix, "bin", "tersio"), '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "fake-tersio 0.0.0"; else echo "$*" >> "' + tersioLog + '"; fi\n', "utf8");
  chmodSync(path.join(prefix, "bin", "tersio"), 0o755);
  return { bin, prefix, tersioLog };
}

function cleanup(...dirs: string[]): void {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}

const TARBALL_FALLBACK = 'env TERSIO_TARBALL_URL=file:///nonexistent/tersio-npm.tgz';

// npm-lane tests force --npm, since bun outranks npm by default.
(process.platform === "win32" ? test.skip : test)("curl bootstrap installs the CLI, then runs tersio install", () => {
  const { bin, prefix, tersioLog } = fakeEnv();

  try {
    const result = spawnSync("/bin/sh", ["-c", `${TARBALL_FALLBACK} PATH="${bin}:/usr/bin:/bin" sh "${script}" --npm --dry-run`], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: { ...process.env, PATH: `${bin}${path.delimiter}/usr/bin${path.delimiter}/bin` },
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Installing @krtclcdy\/tersio via npm\.\.\./);
    expect(result.stdout).toMatch(/fake-npm install -g @krtclcdy\/tersio@latest --no-audit --no-fund/);
    expect(result.stdout).toMatch(/Running the main installer\.\.\./);
    // The follow-up installer ran, whichever interactivity branch ran.
    const tersioArgs = readFileSync(tersioLog, "utf8");
    expect(tersioArgs).toMatch(/--dry-run/);
    expect(tersioArgs).toMatch(/(^| )install( |$)/m);
  } finally {
    cleanup(bin, prefix);
  }
});

(process.platform === "win32" ? test.skip : test)("release tarball is preferred over the npm registry when reachable", () => {
  const { bin, prefix, tersioLog } = fakeEnv();
  const tgz = mkdtempSync(path.join(os.tmpdir(), "tersio-tgz-"));
  const tarballPath = path.join(tgz, "tersio-npm.tgz");
  writeFileSync(tarballPath, "fake tarball bytes", "utf8");

  try {
    const result = spawnSync("/bin/sh", ["-c", `env TERSIO_TARBALL_URL="file://${tarballPath}" sh "${script}" --npm`], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH || ""}` },
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Installing tersio from the GitHub release tarball\.\.\./);
    expect(result.stdout).toMatch(/fake-npm install -g .*tersio-npm\.tgz --no-audit --no-fund/);
    expect(readFileSync(tersioLog, "utf8")).toMatch(/(^| )install( |$)/m);
  } finally {
    cleanup(bin, prefix, tgz);
  }
});

(process.platform === "win32" ? test.skip : test)("non-interactive shells run a user-level install", () => {
  const { bin, prefix, tersioLog } = fakeEnv();

  try {
    const result = spawnSync("/bin/sh", ["-c", `${TARBALL_FALLBACK} sh "${script}" --npm`], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH || ""}` },
    });

    expect(result.status, result.stderr).toBe(0);
    const tersioArgs = readFileSync(tersioLog, "utf8");
    if (/install --yes/.test(tersioArgs)) {
      expect(tersioArgs).toMatch(/install --yes/);
      expect(tersioArgs).not.toMatch(/--scope/);
    } else {
      // /dev/tty existed, so the installer ran interactively.
      expect(tersioArgs).toMatch(/(^| )install( |$)/m);
    }
  } finally {
    cleanup(bin, prefix);
  }
});

(process.platform === "win32" ? test.skip : test)("curl bootstrap aborts with a hint when the installed tersio fails its smoke check", () => {
  const bin = mkdtempSync(path.join(os.tmpdir(), "tersio-curl-bin-"));
  const prefix = mkdtempSync(path.join(os.tmpdir(), "tersio-curl-prefix-"));
  mkdirSync(path.join(prefix, "bin"), { recursive: true });
  writeFileSync(path.join(bin, "npm"), '#!/bin/sh\nif [ "$1" = "prefix" ]; then echo "' + prefix + '"; else echo "fake-npm $*"; fi\n', "utf8");
  chmodSync(path.join(bin, "npm"), 0o755);
  writeFileSync(path.join(prefix, "bin", "tersio"), '#!/bin/sh\necho "Error [ERR_MODULE_NOT_FOUND]" >&2\nexit 1\n', "utf8");
  chmodSync(path.join(prefix, "bin", "tersio"), 0o755);

  try {
    const result = spawnSync("/bin/sh", ["-c", `${TARBALL_FALLBACK} PATH="${bin}:/usr/bin:/bin" sh "${script}" --npm --dry-run`], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: { ...process.env, PATH: `${bin}${path.delimiter}/usr/bin${path.delimiter}/bin` },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/failed its smoke check/);
  } finally {
    cleanup(bin, prefix);
  }
});

(process.platform === "win32" ? test.skip : test)("curl bootstrap fails with a hint when npm is missing", () => {
  const emptyBin = mkdtempSync(path.join(os.tmpdir(), "tersio-curl-empty-"));

  try {
    const result = spawnSync("/bin/sh", [script, "--npm"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: { ...process.env, PATH: emptyBin },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/npm not found/);
  } finally {
    cleanup(emptyBin);
  }
});

(process.platform === "win32" ? test.skip : test)("curl bootstrap prefers bun over npm by default", () => {
  const { bin, prefix, tersioLog } = fakeEnv();

  try {
    const result = spawnSync("/bin/sh", ["-c", `sh "${script}" --dry-run`], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      // Isolated PATH: no system dirs, so a real tersio cannot shadow the fake prefix binary the bun lane resolves.
      env: { ...process.env, PATH: `${bin}${path.delimiter}${prefix}/bin${path.delimiter}/usr/bin${path.delimiter}/bin` },
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Installing @krtclcdy\/tersio via bun\.\.\./);
    expect(result.stdout).toMatch(/fake-bun install -g @krtclcdy\/tersio@latest/);
    expect(readFileSync(tersioLog, "utf8")).toMatch(/(^| )install( |$)/m);
  } finally {
    cleanup(bin, prefix);
  }
});

(process.platform === "win32" ? test.skip : test)("curl bootstrap --npm skips bun even when bun exists", () => {
  const { bin, prefix, tersioLog } = fakeEnv();

  try {
    const result = spawnSync("/bin/sh", ["-c", `${TARBALL_FALLBACK} sh "${script}" --npm --dry-run`], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH || ""}` },
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Installing @krtclcdy\/tersio via npm\.\.\./);
    expect(result.stdout).not.toMatch(/fake-bun/);
    expect(readFileSync(tersioLog, "utf8")).toMatch(/--dry-run/);
  } finally {
    cleanup(bin, prefix);
  }
});

(process.platform === "win32" ? test.skip : test)("curl bootstrap --bun fails with a hint when bun is missing", () => {
  const { bin, prefix } = fakeEnv();

  try {
    const result = spawnSync("/bin/sh", ["-c", `rm "${bin}/bun" && sh "${script}" --bun`], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: { ...process.env, PATH: `${bin}${path.delimiter}/usr/bin${path.delimiter}/bin` },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/bun not found/);
  } finally {
    cleanup(bin, prefix);
  }
});

// host-menus: they target one agent; the option label carries the current state.
const cli = path.join(root, "dist", "tersio.js");

function tempHome(): string {
  return mkdtempSync(path.join(os.tmpdir(), "tersio-hosts-"));
}

function seedPiPackage(home: string, version = "2.23.0"): void {
  const agent = path.join(home, ".pi", "agent");
  const pkg = path.join(agent, "npm", "node_modules", "@krtclcdy", "tersio");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "@krtclcdy/tersio", version }), "utf8");
  writeFileSync(path.join(agent, "settings.json"), JSON.stringify({ packages: [`npm:@krtclcdy/tersio@${version}`] }), "utf8");
}

function run(home: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 30000,
    env: cliEnv(home, { PATH: path.join(home, "empty-bin") }),
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("the label shows the installed version, or that nothing is there", () => {
  const base: HostEntry = { id: "omp", label: "Oh My Pi", bin: "omp", installCmd: "omp plugin install @krtclcdy/tersio", removeCmd: "x", installed: false, via: null, declared: null, version: null, dir: null };
  expect(hostLabel({ ...base, installed: true, version: "2.23.0" })).toBe("Oh My Pi (installed 2.23.0)");
  expect(hostLabel({ ...base, installed: true, version: null })).toBe("Oh My Pi (installed)");
  expect(hostLabel(base)).toBe("Oh My Pi (not installed)");
  expect(hostLabel({ ...base, declared: "npm:@krtclcdy/tersio" })).toBe("Oh My Pi (package declared, not on disk)");
});

test("detectHosts reports the pi install under its own agent dir", () => {
  const home = tempHome();
  try {
    seedPiPackage(home, "9.9.9");
    // Pass the agent dir, not PI_CODING_AGENT_DIR: that override needs PI_CODING_AGENT, which CI does not set.
    const agentDir = path.join(home, ".pi", "agent");
    const pi = detectHosts(agentDir).find((h) => h.id === "pi") as HostEntry;
    expect(pi.installed).toBe(true);
    expect(pi.version).toBe("9.9.9");
    expect(pi.installCmd).toBe("pi install npm:@krtclcdy/tersio");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("install --host pi writes the pi tree and no OMP files", () => {
  const home = tempHome();
  try {
    const result = run(home, ["install", "--host", "pi", "--dry-run", "--verbose"]);
    expect(result.status, result.stderr).toBe(0);
    // pi auto-discovers <agent-dir>/extensions, so the tree is the install.
    expect(result.stdout).toMatch(/\[dry-run\] would write .*\.pi[\\/]agent[\\/]extensions[\\/]caveman[\\/]index\.ts/);
    expect(result.stdout).toMatch(/\[dry-run\] would write .*\.pi[\\/]agent[\\/]extensions[\\/]pstack[\\/]rule\.md/);
    expect(result.stdout).toMatch(/\[dry-run\] would write .*\.pi[\\/]agent[\\/]extensions[\\/]rtk[\\/]session\.ts/);
    // pi reaches rtk/ only through this manifest: without it both files stay dead on disk.
    expect(result.stdout).toMatch(/\[dry-run\] would write .*\.pi[\\/]agent[\\/]extensions[\\/]rtk[\\/]package\.json/);
    expect(result.stdout).toMatch(/\[dry-run\] would write .*\.pi[\\/]agent[\\/]extensions[\\/]shared[\\/]session-state\.ts/);
    expect(result.stdout).toMatch(/\[dry-run\] would write session defaults to .*\.tersio[\\/]settings\.json/);
    expect(result.stdout, "OMP extension tree must stay untouched").not.toMatch(/\.omp[\\/]agent[\\/]extensions/);
    expect(result.stdout).toMatch(/Done — restart pi/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("install --host omp keeps the OMP tree and never touches pi", () => {
  const home = tempHome();
  try {
    const result = run(home, ["install", "--host", "omp", "--dry-run", "--verbose"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/extensions[\\/]combo[\\/]index\.ts/);
    expect(result.stdout).not.toMatch(/pi install npm:/);
    expect(result.stdout).toMatch(/Done — restart OMP/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// `pi remove` shells out to npm even with nothing declared; npm's stderr then reads as a failed step.
test("install --host pi skips the npm ponytail removal when pi does not declare it", () => {
  const home = tempHome();
  try {
    seedRtk(home);
    seedPiPackage(home, "2.25.3");
    const agentDir = path.join(home, ".pi", "agent");
    // The state a repeat install sees.
    writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ packages: [path.join(agentDir, "ponytail")] }), "utf8");

    const result = run(home, ["install", "--host", "pi", "--yes"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout, "nothing to remove, so npm must not run").not.toMatch(/pi remove ponytail/);
    expect(result.stdout).toMatch(/Done — restart pi/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("install --host pi still removes the npm ponytail copy when pi declares it", () => {
  const home = tempHome();
  try {
    seedRtk(home);
    seedPiPackage(home, "2.25.3");
    const agentDir = path.join(home, ".pi", "agent");
    writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ packages: ["npm:@dietrichgebert/ponytail@4.9.0"] }), "utf8");

    const result = run(home, ["install", "--host", "pi", "--yes"]);
    // `pi` is absent on the stubbed PATH, so an attempted removal shows up as ENOENT.
    expect(result.stdout, "a declared npm spec still triggers the removal").toMatch(/\[warn\] pi remove ponytail/);
    expect(readFileSync(path.join(agentDir, "settings.json"), "utf8"), "the spec is dropped either way").not.toMatch(/npm:@dietrichgebert\/ponytail/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("install --host opencode writes the plugin tree and registers it", () => {
  const home = tempHome();
  try {
    const result = run(home, ["install", "--host", "opencode", "--dry-run", "--verbose"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/\[dry-run\] would write .*\.config[\\/]opencode[\\/]plugins[\\/]tersio[\\/]server\.ts/);
    expect(result.stdout).toMatch(/\[dry-run\] would write .*\.config[\\/]opencode[\\/]plugins[\\/]tersio[\\/]rtk[\\/]session\.ts/);
    expect(result.stdout).toMatch(/\[dry-run\] would write .*\.config[\\/]opencode[\\/]plugins[\\/]tersio[\\/]combo[\\/]index\.ts/);
    expect(result.stdout).toMatch(/\[dry-run\] would write .*\.config[\\/]opencode[\\/]plugins[\\/]tersio[\\/]pstack[\\/]rule\.md/);
    expect(result.stdout, "OMP extension tree must stay untouched").not.toMatch(/\.omp[\\/]agent[\\/]extensions/);
    expect(result.stdout, "pi tree must stay untouched").not.toMatch(/\.pi[\\/]agent[\\/]extensions/);
    expect(result.stdout).toMatch(/Done — restart OpenCode/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("install --host opencode bundles the ponytail ruleset beside the tree", () => {
  const home = tempHome();
  try {
    seedRtk(home);
    const result = run(home, ["install", "--host", "opencode", "--yes"]);
    expect(result.status, result.stderr).toBe(0);
    const base = path.join(home, ".config", "opencode", "plugins", "tersio", "ponytail-bundle");
    // The tree ships no node_modules, so every skill the /ponytail-* commands read must ride along.
    const bundled = [
      "hooks/ponytail-instructions.js",
      "hooks/ponytail-config.js",
      ...["ponytail", "ponytail-audit", "ponytail-debt", "ponytail-gain", "ponytail-help", "ponytail-review"]
        .map((skill) => `skills/${skill}/SKILL.md`),
    ];
    for (const file of bundled) {
      const full = path.join(base, ...file.split("/"));
      expect(existsSync(full), `${file} bundled`).toBe(true);
    }
    expect(readFileSync(path.join(base, "hooks", "ponytail-instructions.js"), "utf8")).toMatch(/getPonytailInstructions/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("install rejects an unknown host", () => {
  const home = tempHome();
  try {
    const result = run(home, ["install", "--host", "codex"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Invalid --host: codex/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("uninstall --host pi clears the pi tree, the package, and the shared defaults", () => {
  const home = tempHome();
  try {
    seedPiPackage(home);
    mkdirSync(path.join(home, ".tersio"), { recursive: true });
    writeFileSync(path.join(home, ".tersio", "settings.json"), JSON.stringify({ comboDefault: "balanced" }), "utf8");
    const result = run(home, ["uninstall", "--host", "pi", "--dry-run"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/\[dry-run\] would run: pi remove npm:@krtclcdy\/tersio/);
    expect(result.stdout).toMatch(/\[dry-run\] would remove .*\.pi[\\/]agent[\\/]extensions[\\/]caveman\b/);
    expect(result.stdout).toMatch(/\[dry-run\] would remove .*\.pi[\\/]agent[\\/]extensions[\\/]pstack\b/);
    expect(result.stdout).toMatch(/\[dry-run\] would remove .*\.tersio[\\/]settings\.json/);
    expect(result.stdout, "OMP targets stay out of a pi uninstall").not.toMatch(/\.omp[\\/]agent[\\/]extensions/);
    // Ponytail now lives in a local package dir we wrote, not in pi's skills dir.
    expect(result.stdout).toMatch(/\[dry-run\] would run: pi remove npm:@dietrichgebert\/ponytail/);
    expect(result.stdout).toMatch(/\.pi[\\/]agent[\\/]ponytail \(local Ponytail package\)/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("uninstall --host opencode clears the plugin tree", () => {
  const home = tempHome();
  try {
    const dir = path.join(home, ".config", "opencode", "plugins", "tersio", "opencode");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "server.ts"), "// stale", "utf8");
    writeFileSync(path.join(home, ".config", "opencode", "opencode.json"), JSON.stringify({ plugins: [path.join(home, ".config", "opencode", "plugins", "tersio")] }), "utf8");
    const result = run(home, ["uninstall", "--host", "opencode", "--dry-run"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/\[dry-run\] would remove .*\.config[\\/]opencode[\\/]plugins[\\/]tersio/);
    expect(result.stdout).toMatch(/\[dry-run\] would remove .*\.config[\\/]opencode[\\/]plugins[\\/]rtk\.ts/);
    expect(result.stdout, "OMP targets stay out of an opencode uninstall").not.toMatch(/\.omp[\\/]agent[\\/]extensions/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("uninstall on a machine with no install says so instead of listing files", () => {
  const home = tempHome();
  try {
    const result = run(home, ["uninstall"]);
    expect(result.status, result.stderr).toBe(0);
    // Without a TTY the host prompt is skipped, so the OMP path reports nothing installed.
    expect(result.stdout).toMatch(/has no tersio install/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor --fix restores a partly written pi tree", () => {
  const home = tempHome();
  try {
    // A half-written tree is what --fix exists for.
    const ext = path.join(home, ".pi", "agent", "extensions");
    mkdirSync(path.join(ext, "shared"), { recursive: true });
    mkdirSync(path.join(ext, "caveman"), { recursive: true });
    writeFileSync(path.join(ext, "shared", "host.ts"), "// stale", "utf8");
    writeFileSync(path.join(ext, "caveman", "index.ts"), "// stale", "utf8");

    const result = run(home, ["doctor", "--fix", "extensions", "--yes"]);
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(path.join(ext, "shared", "host.ts"), "utf8")).not.toBe("// stale");
    expect(readFileSync(path.join(ext, "caveman", "index.ts"), "utf8")).toMatch(/export default function/);
    expect(result.stdout, "OMP's tree is not the target here").not.toMatch(/\.omp[\\/]agent[\\/]extensions/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// A found binary only rebinds; a seeded binary stands in for an earlier install.
function seedRtk(home: string): void {
  const binDir = path.join(home, ".bun", "bin");
  mkdirSync(binDir, { recursive: true });
  fakeRtkBin(binDir, ["echo 'rtk 0.50.0'"], "echo rtk 0.50.0");
}

test("an existing rtk binary is bound on both hosts, never downloaded", () => {
  const home = tempHome();
  try {
    seedRtk(home);
    const pi = run(home, ["install", "--host", "pi", "--yes"]);
    expect(pi.status, pi.stderr).toBe(0);
    expect(pi.stdout).toMatch(/RTK — already installed.*binding into pi/);

    const omp = run(home, ["install", "--host", "omp", "--dry-run", "--verbose"]);
    expect(omp.status, omp.stderr).toBe(0);
    expect(omp.stdout).toMatch(/RTK — already installed.*binding into OMP/);
    expect(omp.stdout).not.toMatch(/would download rtk binary/);
    const oc = run(home, ["install", "--host", "opencode", "--dry-run"]);
    expect(oc.status, oc.stderr).toBe(0);
    expect(oc.stdout).toMatch(/RTK — already installed.*binding into OpenCode/);
    for (const out of [pi.stdout, omp.stdout, oc.stdout]) {
      expect(out, "no registry probe, no download").not.toMatch(/Downloading RTK binary|Finding latest RTK release/);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// menu-layout: Clack anchors to the cursor, so an over-tall welcome scrolls; proving it needs `pyte`, and skips without it.

const PY = [
  "import os, pty, select, fcntl, termios, struct, time, sys, json",
  "rows = int(sys.argv[1])",
  "argv = sys.argv[2:]",
  "pid, fd = pty.fork()",
  "if pid == 0:",
  '    os.environ["TERM"] = "xterm-256color"',
  "    os.execvp(argv[0], argv)",
  "fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, 100, 0, 0))",
  "buf = b''",
  "end = time.time() + 4",
  "while time.time() < end:",
  "    r, _, _ = select.select([fd], [], [], 0.2)",
  "    if not r:",
  "        continue",
  "    try:",
  "        d = os.read(fd, 65536)",
  "    except OSError:",
  "        break",
  "    if not d:",
  "        break",
  "    buf += d",
  "try:",
  "    os.write(fd, b'\\x03')",
  "except OSError:",
  "    pass",
  "time.sleep(0.3)",
  "for close in (lambda: os.close(fd), lambda: os.kill(pid, 9)):",
  "    try:",
  "        close()",
  "    except OSError:",
  "        pass",
  "import pyte",
  "screen = pyte.Screen(100, rows)",
  "pyte.Stream(screen).feed(buf.decode('utf8', 'replace'))",
  "out = ['' for _ in range(rows)]",
  "for y in range(rows):",
  "    line = ''",
  "    for x in range(100):",
  "        line += screen.buffer[y][x].data or ' '",
  "    out[y] = line.rstrip()",
  "sys.stdout.write(json.dumps(out))",
].join("\n");

const havePyte = spawnSync("python3", ["-c", "import pyte"], { encoding: "utf8" }).status === 0;

/** The visible screen, one string per terminal row. One capture per row count, shared by every test. */
const screenCache = new Map<number, string[]>();
function screenAt(rows: number): string[] {
  const cached = screenCache.get(rows);
  if (cached) return cached;
  const result = spawnSync("python3", ["-c", PY, String(rows), process.execPath, installer], {
    cwd: root,
    encoding: "utf8",
    timeout: 30000,
    env: { ...process.env, TERM: "xterm-256color", TERSIO_HOME: mkdtempSync(path.join(os.tmpdir(), "tersio-screen-")) },
  });
  expect(result.status, result.stderr).toBe(0);
  const lines = JSON.parse(result.stdout) as string[];
  screenCache.set(rows, lines);
  return lines;
}

const LABELS = ["Install plugin", "Update", "Doctor", "Dashboard", "Uninstall plugin"];

// Slow the registry past a spinner frame: Clack's CI spinner residue once pushed tips off a 20-row screen.
function screenAtCi(rows: number): string[] {
  const bin = mkdtempSync(path.join(os.tmpdir(), "tersio-slow-npm-"));
  try {
    writeFileSync(`${bin}/npm`, "#!/bin/sh\nsleep 1\necho 2.25.1\n", { mode: 0o755 });
    const result = spawnSync("python3", ["-c", PY, String(rows), process.execPath, installer], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
      env: { ...process.env, TERM: "xterm-256color", CI: "true", TERSIO_HOME: mkdtempSync(path.join(os.tmpdir(), "tersio-screen-")), PATH: `${bin}${process.env.PATH ? `:${process.env.PATH}` : ""}` },
    });
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout) as string[];
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
}

/** A registry that answers with a newer version, so the welcome carries its update prompt too. */
function screenAtUpdate(rows: number): string[] {
  // No CI here: the layout is read from a real terminal under pyte.
  const result = spawnSync("python3", ["-c", PY, String(rows), process.execPath, installer], {
    cwd: root,
    encoding: "utf8",
    timeout: 30000,
    env: { ...process.env, TERM: "xterm-256color", TERSIO_HOME: mkdtempSync(path.join(os.tmpdir(), "tersio-screen-")), TERSIO_UPDATE_URL: registryUrl("99.0.0"), TERSIO_RELEASES_URL: releasesUrl("99.0.0") },
  });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as string[];
}

describe.skipIf(!havePyte)("menu layout", () => {
  for (const rows of [40, 30, 24, 20]) {
    test(`the whole welcome fits without scrolling at ${rows} rows`, () => {
      const lines = screenAt(rows);

      for (const label of LABELS) {
        expect(lines.some((l) => l.includes(label)), `${label} present at ${rows} rows`).toBe(true);
      }
      // The intro and every option must survive; scrolling them away showed a blank gap and sliced art.
      expect(lines.some((l) => l.includes("set up add-ons")), `tips visible at ${rows} rows`).toBe(true);
      expect(lines.some((l) => l.includes("Uninstall plugin")), `last option visible at ${rows} rows`).toBe(true);
    }, 20000);
  }

  test("a slow update check leaves no spinner residue under CI at 20 rows", () => {
    const lines = screenAtCi(20);
    expect(lines.some((l) => l.includes("set up add-ons")), "tips visible").toBe(true);
    expect(lines.some((l) => l.includes("Install plugin")), "menu visible").toBe(true);
    expect(lines.some((l) => l.includes("Checking npm registry")), "no spinner residue").toBe(false);
  }, 20000);

  // The welcome prints before the update prompt and the spinner sits above it: on a 20-row screen the tips used to scroll off. The menu waits behind the prompt, so the tips are what must fit.
  test("an available update does not scroll the tips off a 20-row screen", () => {
    const lines = screenAtUpdate(20);
    expect(lines.some((l) => l.includes("set up add-ons")), `tips visible; screen:\n${lines.join("\n")}`).toBe(true);
    expect(lines.some((l) => l.includes("is available")), "update prompt on screen").toBe(true);
  }, 30000);

  test("the scissor art renders whole on a full-height terminal", () => {
    const lines = screenAt(30);
    const artAt = lines.findIndex((l) => l.includes("██"));

    expect(artAt, "art present").toBeGreaterThan(-1);
    // Six rows, so the last art row must sit at artAt + 5 with nothing missing.
    for (let i = 0; i < 6; i++) {
      expect(lines[artAt + i], `art row ${i} present`).toBeDefined();
      expect(lines[artAt + i], `art row ${i} is not blank`).not.toBe("");
    }
  }, 20000);

  test("the combo is a header line, not a menu option", () => {
    const lines = screenAt(30);
    const titleAt = lines.findIndex((l) => l.includes("what next?"));
    const comboAt = lines.findIndex((l) => l.includes("COMBO "));
    const firstOptionAt = lines.findIndex((l) => l.includes("Install plugin"));

    expect(titleAt, "title present").toBeGreaterThan(-1);
    expect(comboAt, "combo present").toBeGreaterThan(titleAt);
    expect(firstOptionAt, "first option present").toBeGreaterThan(comboAt);
    // Under the title, not the option list, so no radio marker marks it selectable.
    expect(lines[comboAt], "combo is not a selectable option").not.toMatch(/[●○]/);
  }, 20000);

  test("the menu follows the intro with no gap", () => {
    const lines = screenAt(30);
    const introAt = lines.findIndex((l) => l.includes("tersio v"));
    const artAt = lines.findIndex((l) => l.includes("██"));
    const menuAt = lines.findIndex((l) => l.includes("what next?"));

    expect(introAt, "intro present").toBeGreaterThan(-1);
    expect(artAt, "art present").toBeGreaterThan(introAt);
    expect(menuAt, "menu present").toBeGreaterThan(artAt);
    // Intro + art + menu is 24 rows; more than that means the frame scrolled.
    expect(menuAt - introAt, "no blank gap above the menu").toBeLessThanOrEqual(16);
  }, 20000);
});

// banner
const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

test("bannerLines renders 6 rows at most 16 wide in every tier", () => {
  for (const tier of ["true", "256", "plain"] as const) {
    const rows = bannerLines(tier);
    expect(rows.length).toBe(6);
    for (const row of rows) expect(strip(row).length <= 16, `${tier}: ${JSON.stringify(row)}`).toBeTruthy();
  }
});

test("bannerLines plain tier carries no escapes and shows the scissor", () => {
  const rows = bannerLines("plain");
  expect(rows.every((r) => !r.includes("\x1b"))).toBeTruthy();
  expect(rows.join("\n").includes("█")).toBeTruthy();
});

test("bannerTier honors NO_COLOR and COLORTERM", () => {
  const prev = { ...process.env };
  try {
    process.env.NO_COLOR = "";
    delete process.env.COLORTERM;
    expect(bannerTier()).toBe("plain");
    delete process.env.NO_COLOR;
    process.env.COLORTERM = "truecolor";
    expect(bannerTier()).toBe("true");
    process.env.COLORTERM = "";
    process.env.TERM = "xterm-256color";
    expect(bannerTier()).toBe("256");
  } finally {
    for (const k of ["NO_COLOR", "COLORTERM", "TERM"]) delete process.env[k];
    Object.assign(process.env, prev);
  }
});

// cli
function cliRun(...args: string[]) {
  return spawnSync(process.execPath, [installer, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 10000,
    env: { ...process.env, TERSIO_HOME: mkdtempSync(path.join(os.tmpdir(), "tersio-cli-")) },
  });
}

for (const alias of [["version"], ["--version"], ["-v"]]) {
  test(`${alias[0]} prints only the package version`, () => {
    const result = cliRun(...alias);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(`${version}\n`);
    expect(result.stderr).toBe("");
  });
}

for (const alias of [["help"], ["--help"], ["-h"]]) {
  test(`${alias[0]} prints help`, () => {
    const result = cliRun(...alias);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/^Usage:/);
    for (const command of ["install", "update", "doctor", "uninstall", "dashboard", "version", "help"]) {
      expect(result.stdout).toMatch(new RegExp(`^  ${command}\\s`, "m"));
    }
    expect(result.stderr).toBe("");
  });
}

test("an unknown command fails with usage and no installer output", () => {
  const result = cliRun("definitely-not-a-command");

  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/Unknown command: definitely-not-a-command/);
  expect(result.stdout).toMatch(/^Usage:/);
  expect(result.stdout).not.toMatch(/Prerequisites:|Installing|Will remove:/);
});

test("dry-run previews shared bridge before dependent extensions without writing", () => {
  const missingHome = path.join(root, "test", "definitely-missing-home");
  const result = spawnSync(
    process.execPath,
    [installer, "install", "--dry-run"],
    {
      encoding: "utf8",
      cwd: path.join(root, "test"),
      env: cliEnv(missingHome),
    }
  );

  expect(result.status, result.stderr).toBe(0);
  const shared = result.stdout.indexOf("Shared files — sync session bridge");
  const rtk = result.stdout.indexOf("RTK session — install session mode");
  const caveman = result.stdout.indexOf("Caveman — install session mode and rule bodies");
  expect(shared >= 0, result.stdout).toBeTruthy();
  expect(rtk > shared, result.stdout).toBeTruthy();
  expect(caveman > shared, result.stdout).toBeTruthy();
  expect(result.stdout).toMatch(/Ponytail — bundled in this plugin/);
  expect(result.stdout).toMatch(/Tersio — register plugin/);
  expect(result.stdout).not.toMatch(/\/tmp|\/Users|\.omp[\\/]agent[\\/]extensions\/shared\/session-state\.js/);
  expect(existsSync(path.join(root, "extensions", "shared-session-state.js"))).toBe(false);
});

test("user dry-run installs commands without retired reinforcement", () => {
  const missingHome = path.join(root, "test", "definitely-missing-home");
  const result = spawnSync(
    process.execPath,
    [installer, "install", "--dry-run"],
    {
      encoding: "utf8",
      cwd: root,
      env: cliEnv(missingHome),
    }
  );

  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(/Ponytail — bundled in this plugin/);
  expect(result.stdout).toMatch(/Combo — install preset switch/);
  expect(result.stdout).toMatch(/Tersio — register plugin/);
  expect(result.stdout).not.toMatch(/mode reinforcement/i);
});
test("verbose dry-run reveals file paths hidden by default", () => {
  const missingHome = path.join(root, "test", "definitely-missing-home");
  const result = spawnSync(
    process.execPath,
    [installer, "install", "--dry-run", "--verbose"],
    {
      encoding: "utf8",
      cwd: root,
      env: cliEnv(missingHome),
    }
  );

  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(/\[dry-run\] would write .*shared[\\/]session-state\.ts/);
  expect(result.stdout).toMatch(/\[dry-run\] would write .*commands[\\/]index\.ts/);
});

test("bare dry-run never prompts for the pending update and exits 0", () => {
  const missingHome = path.join(root, "test", "definitely-missing-home");
  const result = spawnSync(
    process.execPath,
    [installer, "--dry-run"],
    {
      encoding: "utf8",
      cwd: root,
      env: cliEnv(missingHome),
    }
  );

  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).not.toMatch(/Install it now\?/);
});

test("uninstall dry-run previews shared bridge removal", () => {
  const missingHome = path.join(root, "test", "definitely-missing-home");
  const result = spawnSync(
    process.execPath,
    [installer, "uninstall", "--dry-run", "--yes"],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 10000,
      env: cliEnv(missingHome),
    }
  );

  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(/\[dry-run\] would remove .*extensions[\\/]shared(?:\r?\n|$)/);
  expect(result.stdout).toMatch(/\[dry-run\] would remove .*extensions[\\/]aaa-combo-boot(?:\r?\n|$)/);
});

// npm nests an old copy when the published range excludes the pin, so the override makes the pinned version load.
test("the ponytail repair drops an older install's dependency and sibling copy", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-ponytail-override-"));
  try {
    const pluginsDir = path.join(home, ".omp", "plugins");
    const sibling = path.join(pluginsDir, "node_modules", "@dietrichgebert", "ponytail");
    mkdirSync(sibling, { recursive: true });
    const pkgPath = path.join(pluginsDir, "package.json");
    writeFileSync(
      pkgPath,
      JSON.stringify({ name: "omp-plugins", private: true, dependencies: { "@dietrichgebert/ponytail": "^4.12.0" }, overrides: { "@dietrichgebert/ponytail": "^4.12.0" } }, null, 2),
      "utf8",
    );
    const result = spawnSync(process.execPath, [installer, "doctor", "--fix", "ponytail", "--yes", "--dry-run"], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
      env: cliEnv(home),
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/\[dry-run\] would drop @dietrichgebert\/ponytail/);
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { dependencies: Record<string, string>; overrides?: Record<string, string> };
    expect(pkg.dependencies["@dietrichgebert/ponytail"], "a dry run must not write").toBe("^4.12.0");
    expect(pkg.overrides?.["@dietrichgebert/ponytail"], "a dry run must not write").toBe("^4.12.0");
    expect(existsSync(sibling), "a dry run must not delete").toBe(true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("uninstall dry-run with --remove-ponytail previews full ponytail removal", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-uninstall-"));
  try {
    const pluginsDir = path.join(home, ".omp", "plugins");
    mkdirSync(path.join(pluginsDir, "node_modules", "@dietrichgebert"), { recursive: true });
    writeFileSync(
      path.join(pluginsDir, "package.json"),
      JSON.stringify({ name: "omp-plugins", private: true, dependencies: { "@dietrichgebert/ponytail": "github:DietrichGebert/ponytail" } }),
      "utf8",
    );
    writeFileSync(
      path.join(pluginsDir, "omp-plugins.lock.json"),
      JSON.stringify({ plugins: { "@dietrichgebert/ponytail": { version: "4.9.0" } }, settings: {} }),
      "utf8",
    );
    const result = spawnSync(
      process.execPath,
      [installer, "uninstall", "--dry-run", "--yes", "--remove-ponytail"],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 10000,
        env: cliEnv(home),
      }
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/\[dry-run\] would remove @dietrichgebert\/ponytail from .*package\.json/);
    expect(result.stdout).toMatch(/\[dry-run\] would remove .*@dietrichgebert[\\/]ponytail(?:\r?\n|$)/);
    expect(result.stdout).toMatch(/\[dry-run\] would remove @dietrichgebert\/ponytail from .*omp-plugins\.lock\.json/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("uninstall dry-run includes ponytail by default; --keep-ponytail omits it", () => {
  const missingHome = path.join(root, "test", "definitely-missing-home");
  const spawn = (args: string[]) =>
    spawnSync(process.execPath, [installer, ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 10000,
      env: cliEnv(missingHome),
    });

  const def = spawn(["uninstall", "--dry-run", "--yes"]);
  expect(def.status, def.stderr).toBe(0);
  expect(def.stdout, "ponytail removal is part of the default dry-run plan").toMatch(/dietrichgebert/);

  const keep = spawn(["uninstall", "--dry-run", "--yes", "--keep-ponytail"]);
  expect(keep.status, keep.stderr).toBe(0);
  expect(keep.stdout).not.toMatch(/dietrichgebert/);
});

test("uninstall dry-run never prompts for confirmation", () => {
  const missingHome = path.join(root, "test", "definitely-missing-home");
  const result = spawnSync(
    process.execPath,
    [installer, "uninstall", "--dry-run"],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 10000,
      env: cliEnv(missingHome),
    }
  );

  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).not.toMatch(/Proceed\?/);
  expect(result.stdout).toMatch(/\[dry-run\] would remove .*extensions[\\/]shared(?:\r?\n|$)/);
});

test("dashboard --export writes a self-contained html file", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-dash-"));
  const out = path.join(dir, "dash.html");
  const result = spawnSync(process.execPath, [installer, "dashboard", "--export", out], {
    encoding: "utf8",
    cwd: root,
    env: {
      ...process.env,
      TERSIO_SESSIONS_DIR: path.join(dir, "no-sessions"),
      TERSIO_RTK_DB: path.join(dir, "no-rtk.db"),
      TERSIO_USAGE_DB: path.join(dir, "no-usage.db"),
      TERSIO_RESET_FILE: path.join(dir, "reset.json"),
    },
  });
  expect(result.status, result.stderr).toBe(0);
  const html = existsSync(out) ? "present" : "missing";
  expect(html).toBe("present");
  const body = readFileSync(out, "utf8");
  expect(body).toMatch(/Tersio Dashboard/);
  expect(body).toMatch(/Oh My Pi/);
  expect(body).toMatch(/ompPath/);
  expect(body).toMatch(/"agent":/);
  expect(body).toMatch(/"currency":"USD"/);
  expect(body.split("</body>").length - 1).toBe(1);
  expect(body.split("</html>").length - 1).toBe(1);
  rmSync(dir, { recursive: true, force: true });
}, 30000); // Full CLI export exceeds the 5s default on slow disks.

test("gain is no longer a public dashboard command", () => {
  const result = cliRun("gain", "--export", path.join(os.tmpdir(), "tersio-obsolete-gain.html"));
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/Unknown command: gain/);
  expect(existsSync(path.join(os.tmpdir(), "tersio-obsolete-gain.html"))).toBe(false);
});

test("doctor prints record store paths", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-doctor-"));
  const ledger = path.join(dir, "usage.jsonl");
  writeFileSync(ledger, '{"ts":1,"kind":"command","detail":"x"}\n', "utf8");
  const result = spawnSync(process.execPath, [installer, "doctor"], {
    encoding: "utf8",
    cwd: root,
    env: {
      ...process.env,
      TERSIO_USAGE_FILE: ledger,
      TERSIO_SESSIONS_DIR: path.join(dir, "no-sessions"),
      TERSIO_RTK_DB: path.join(dir, "no-rtk.db"),
      TERSIO_USAGE_DB: path.join(dir, "no-usage.db"),
      TERSIO_RESET_FILE: path.join(dir, "reset.json"),
    },
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(/^Usage & records$/m);
  expect(result.stdout).toMatch(/Usage DB \(tersio-owned/);
  expect(result.stdout).not.toMatch(/Usage ledger/);
  expect(result.stdout).not.toMatch(/Session transcripts/);
  expect(result.stdout).not.toMatch(/RTK history/);
  rmSync(dir, { recursive: true, force: true });
});

test("dashboard --export bakes the agent empty states", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-dash-"));
  const out = path.join(dir, "dash.html");
  const result = spawnSync(process.execPath, [installer, "dashboard", "--export", out], {
    encoding: "utf8",
    cwd: root,
    env: {
      ...process.env,
      TERSIO_USAGE_FILE: path.join(dir, "usage.jsonl"),
      TERSIO_SESSIONS_DIR: path.join(dir, "no-sessions"),
      TERSIO_RTK_DB: path.join(dir, "no-rtk.db"),
      TERSIO_USAGE_DB: path.join(dir, "no-usage.db"),
      TERSIO_RESET_FILE: path.join(dir, "reset.json"),
    },
  });
  expect(result.status, result.stderr).toBe(0);
  const body = readFileSync(out, "utf8");
  // The agent pages' empty states, baked with the payload, plus the picker label an exported file cannot control.
  expect(body).toMatch(/No usage in this range/);
  expect(body).toMatch(/No provider activity in this range/);
  expect(body).toMatch(/No requests in this range/);
  expect(body).toMatch(/Try a longer range/);
  expect(body).toMatch(/Diagnosis/);
  expect(body).toMatch(/"agent"/);
  rmSync(dir, { recursive: true, force: true });
});
