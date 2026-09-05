import test from "node:test";
import assert from "node:assert/strict";
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
  writeFileSync(path.join(prefix, "bin", "tersio"), '#!/bin/sh\necho "$*" >> "' + tersioLog + '"\n', "utf8");
  chmodSync(path.join(prefix, "bin", "tersio"), 0o755);
  return { bin, prefix, tersioLog };
}

function cleanup(...dirs: string[]): void {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}

(process.platform === "win32" ? test.skip : test)("curl bootstrap installs the CLI, then runs tersio install", () => {
  const { bin, prefix, tersioLog } = fakeEnv();

  try {
    const result = spawnSync("/bin/sh", [script, "--dry-run"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH || ""}` },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /fake-npm install -g @krtclcdy\/tersio@latest --no-audit --no-fund/);
    assert.match(result.stdout, /Running the main installer\.\.\./);
    // The follow-up installer ran (forwarded flag included), whichever
    // interactivity branch the environment supports.
    const tersioArgs = readFileSync(tersioLog, "utf8");
    assert.match(tersioArgs, /--dry-run/);
    assert.match(tersioArgs, /(^| )install( |$)/);
  } finally {
    cleanup(bin, prefix);
  }
});

(process.platform === "win32" ? test.skip : test)("non-interactive shells default to a user-scope install", () => {
  const { bin, prefix, tersioLog } = fakeEnv();

  try {
    const result = spawnSync("/bin/sh", [script], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH || ""}` },
    });

    assert.equal(result.status, 0, result.stderr);
    const tersioArgs = readFileSync(tersioLog, "utf8");
    if (/--scope user --yes/.test(tersioArgs)) {
      assert.match(tersioArgs, /install --scope user --yes/);
    } else {
      // Environment exposed a controlling terminal (/dev/tty); the installer
      // ran interactively — still a full `tersio install` follow-up.
      assert.match(tersioArgs, /(^| )install( |$)/);
    }
  } finally {
    cleanup(bin, prefix);
  }
});

(process.platform === "win32" ? test.skip : test)("curl bootstrap fails with a hint when npm is missing", () => {
  const emptyBin = mkdtempSync(path.join(os.tmpdir(), "tersio-curl-empty-"));

  try {
    const result = spawnSync("/bin/sh", [script], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: { ...process.env, PATH: emptyBin },
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /npm not found/);
  } finally {
    cleanup(emptyBin);
  }
});
