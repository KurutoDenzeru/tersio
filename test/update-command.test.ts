import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installer = path.join(root, "tersio.js");

test("update refreshes the globally installed CLI before delegating", () => {
  const fakeBin = mkdtempSync(path.join(os.tmpdir(), "omp-update-global-"));
  const npm = path.join(fakeBin, process.platform === "win32" ? "npm.cmd" : "npm");

  try {
    if (process.platform === "win32") {
      writeFileSync(npm, "@echo off\r\necho fake-npm %*\r\n", "utf8");
    } else {
      writeFileSync(npm, "#!/bin/sh\nprintf 'fake-npm %s\\n' \"$*\"\n", "utf8");
      chmodSync(npm, 0o755);
    }

    const result = spawnSync(
      process.execPath,
      [installer, "update"],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
        },
        timeout: 10000,
      }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /fake-npm install -g @krtclcdy\/tersio@latest --no-audit --no-fund/);
    assert.match(result.stdout, /\[ok\] CLI updated to @krtclcdy\/tersio@latest/);
    assert.match(result.stdout, /fake-npm exec --yes --prefer-online --package=@krtclcdy\/tersio@latest/);
    assert.match(result.stdout, /=== Update complete ===/);
  } finally {
    rmSync(fakeBin, { recursive: true, force: true });
  }
});

test("update dry-run previews the global CLI refresh without running npm -g", () => {
  const fakeBin = mkdtempSync(path.join(os.tmpdir(), "omp-update-dryrun-"));
  const npm = path.join(fakeBin, process.platform === "win32" ? "npm.cmd" : "npm");

  try {
    if (process.platform === "win32") {
      writeFileSync(npm, "@echo off\r\necho fake-npm %*\r\n", "utf8");
    } else {
      writeFileSync(npm, "#!/bin/sh\nprintf 'fake-npm %s\\n' \"$*\"\n", "utf8");
      chmodSync(npm, 0o755);
    }

    const result = spawnSync(
      process.execPath,
      [installer, "update", "--dry-run"],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
        },
        timeout: 10000,
      }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\[dry-run\] would run: npm install -g @krtclcdy\/tersio@latest/);
    assert.doesNotMatch(result.stdout, /fake-npm install -g/);
    assert.match(result.stdout, /fake-npm exec --yes --prefer-online --package=@krtclcdy\/tersio@latest/);
  } finally {
    rmSync(fakeBin, { recursive: true, force: true });
  }
});

test("update delegates to the latest package non-interactively", () => {
  const fakeBin = mkdtempSync(path.join(os.tmpdir(), "omp-update-test-"));
  const npm = path.join(fakeBin, process.platform === "win32" ? "npm.cmd" : "npm");

  try {
    if (process.platform === "win32") {
      writeFileSync(npm, "@echo off\r\necho fake-npm %*\r\n", "utf8");
    } else {
      writeFileSync(npm, "#!/bin/sh\nprintf 'fake-npm %s\\n' \"$*\"\n", "utf8");
      chmodSync(npm, 0o755);
    }

    const result = spawnSync(
      process.execPath,
      [installer, "update", "--dry-run", "--scope", "project"],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
        },
        timeout: 10000,
      }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /fake-npm exec --yes --prefer-online --package=@krtclcdy\/tersio@latest -- tersio --apply-update --yes --scope project --dry-run/
    );
    assert.match(result.stdout, /=== Update complete ===/);
  } finally {
    rmSync(fakeBin, { recursive: true, force: true });
  }
});

test("update pins the resolved version instead of trusting @latest", () => {
  const fakeBin = mkdtempSync(path.join(os.tmpdir(), "omp-update-pin-"));
  const npm = path.join(fakeBin, process.platform === "win32" ? "npm.cmd" : "npm");
  const home = mkdtempSync(path.join(os.tmpdir(), "omp-update-pin-home-"));

  try {
    if (process.platform === "win32") {
      writeFileSync(npm, '@echo off\r\nif "%1"=="view" (echo 9.9.9) else (echo fake-npm %*)\r\n', "utf8");
    } else {
      writeFileSync(npm, '#!/bin/sh\nif [ "$1" = "view" ]; then echo "9.9.9"; else printf \'fake-npm %s\\n\' "$*"; fi\n', "utf8");
      chmodSync(npm, 0o755);
    }

    const result = spawnSync(
      process.execPath,
      [installer, "update", "--dry-run"],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
          HOME: home,
        },
        timeout: 15000,
      }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Tersio: .* → 9\.9\.9/);
    assert.match(result.stdout, /\[dry-run\] would run: npm install -g @krtclcdy\/tersio@9\.9\.9/);
    assert.match(result.stdout, /--package=@krtclcdy\/tersio@9\.9\.9/);
    assert.doesNotMatch(result.stdout, /@latest/);
  } finally {
    rmSync(fakeBin, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
