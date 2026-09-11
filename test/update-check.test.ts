import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const updateJs = path.join(root, "cli", "update.js").replace(/\\/g, "/");

const PROBE = "import('" + updateJs + "').then(async (m) => {"
  + " const out = { cached: await m.checkForUpdate(), forced: await m.checkForUpdate(true) };"
  + " console.log('TERSIO-PROBE:' + JSON.stringify(out));"
  + "}).catch((e) => { console.error('PROBE-FAIL:' + e.message); process.exit(1); });";

type Env = Record<string, string | undefined>;

function setup(fakeNpmBody: string, cache: unknown): { dir: string; env: Env } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-update-check-"));
  const bin = path.join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  const npm = path.join(bin, "npm");
  writeFileSync(npm, fakeNpmBody, "utf8");
  chmodSync(npm, 0o755);
  const home = path.join(dir, "home");
  mkdirSync(path.join(home, ".omp", "plugins"), { recursive: true });
  if (cache !== null) {
    writeFileSync(path.join(home, ".omp", "plugins", "tersio-update-check.json"), JSON.stringify(cache), "utf8");
  }
  const env: Env = { ...process.env, HOME: home, PATH: bin + path.delimiter + process.env.PATH };
  return { dir, env };
}

function probe(env: Env): Record<string, unknown> {
  const result = spawnSync(process.execPath, ["-e", PROBE], { encoding: "utf8", env });
  assert.equal(result.status, 0, result.stderr);
  const line = result.stdout.split("\n").find((l) => l.startsWith("TERSIO-PROBE:"));
  assert.ok(line, result.stdout + result.stderr);
  return JSON.parse((line as string).slice("TERSIO-PROBE:".length));
}

test("explicit check bypasses a fresh stale cache", () => {
  const { dir, env } = setup("#!/bin/sh\necho 9.9.9\n", { latest: "2.8.0", lastCheck: Date.now() });
  try {
    const out = probe(env);
    assert.equal(out.cached, null);
    assert.equal(out.forced, "9.9.9");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unreachable registry reports unknown, never latest", () => {
  const { dir, env } = setup("#!/bin/sh\nexit 1\n", null);
  try {
    const out = probe(env);
    assert.equal(out.cached, "unknown");
    assert.equal(out.forced, "unknown");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
