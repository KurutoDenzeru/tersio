import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const script = path.join(root, "install.sh");

// POSIX sh script — skipped on Windows CI runners.
(process.platform === "win32" ? test.skip : test)("curl bootstrap installs the CLI via npm", () => {
  const fakeBin = mkdtempSync(path.join(os.tmpdir(), "tersio-curl-"));
  const npm = path.join(fakeBin, "npm");
  writeFileSync(npm, "#!/bin/sh\nprintf 'fake-npm %s\\n' \"$*\"\n", "utf8");
  chmodSync(npm, 0o755);

  try {
    const result = spawnSync("sh", [script], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}` },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /fake-npm install -g @krtclcdy\/tersio@latest --no-audit --no-fund/);
    assert.match(result.stdout, /tersio install/);
  } finally {
    rmSync(fakeBin, { recursive: true, force: true });
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
    rmSync(emptyBin, { recursive: true, force: true });
  }
});
