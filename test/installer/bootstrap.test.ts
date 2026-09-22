import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const script = path.join(root, "install.sh");

// POSIX sh script — skipped on Windows CI runners. Fake npm answers the
// commands install.sh uses (install -g, prefix -g) and a fake tersio records
// the follow-up installer invocation, whichever tty branch the script picks.
function fakeEnv(): { bin: string; prefix: string; tersioLog: string } {
  const bin = mkdtempSync(path.join(os.tmpdir(), "tersio-curl-bin-"));
  const prefix = mkdtempSync(path.join(os.tmpdir(), "tersio-curl-prefix-"));
  const tersioLog = path.join(bin, "tersio-args.log");
  mkdirSync(path.join(prefix, "bin"), { recursive: true });
  writeFileSync(path.join(bin, "npm"), '#!/bin/sh\nif [ "$1" = "prefix" ]; then echo "' + prefix + '"; else echo "fake-npm $*"; fi\n', "utf8");
  chmodSync(path.join(bin, "npm"), 0o755);
  writeFileSync(path.join(bin, "bun"), '#!/bin/sh\necho "fake-bun $*"\n', "utf8");
  chmodSync(path.join(bin, "bun"), 0o755);
  writeFileSync(path.join(prefix, "bin", "tersio"), '#!/bin/sh\necho "$*" >> "' + tersioLog + '"\n', "utf8");
  chmodSync(path.join(prefix, "bin", "tersio"), 0o755);
  return { bin, prefix, tersioLog };
}

function cleanup(...dirs: string[]): void {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}

const TARBALL_FALLBACK = 'env TERSIO_TARBALL_URL=file:///nonexistent/tersio-npm.tgz';

// npm-lane tests force --npm: bun outranks npm on default, so they must
// pin the lane to exercise the tarball/registry fallback.
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
    // The follow-up installer ran (forwarded flag included), whichever
    // interactivity branch the environment supports.
    const tersioArgs = readFileSync(tersioLog, "utf8");
    expect(tersioArgs).toMatch(/--dry-run/);
    expect(tersioArgs).toMatch(/(^| )install( |$)/);
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
    expect(readFileSync(tersioLog, "utf8")).toMatch(/(^| )install( |$)/);
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
      // Environment exposed a controlling terminal (/dev/tty); the installer
      // ran interactively — still a full `tersio install` follow-up.
      expect(tersioArgs).toMatch(/(^| )install( |$)/);
    }
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
      // Isolated PATH: no system dirs, so the real tersio on the dev
      // machine cannot shadow the fake prefix binary the bun lane resolves.
      env: { ...process.env, PATH: `${bin}${path.delimiter}${prefix}/bin${path.delimiter}/usr/bin${path.delimiter}/bin` },
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Installing @krtclcdy\/tersio via bun\.\.\./);
    expect(result.stdout).toMatch(/fake-bun install -g @krtclcdy\/tersio@latest/);
    expect(readFileSync(tersioLog, "utf8")).toMatch(/(^| )install( |$)/);
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
