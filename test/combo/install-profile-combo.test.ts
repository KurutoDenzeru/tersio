import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const installer = path.join(root, "tersio.js");

function run(...args: string[]) {
  const missingHome = path.join(root, "test", "definitely-missing-home");
  const result = spawnSync(process.execPath, [installer, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 15000,
    env: { ...process.env, HOME: missingHome, USERPROFILE: missingHome },
  });
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

test("combo preset implies caveman, rtk, and ponytail defaults", () => {
  const result = run("install", "--dry-run", "--yes", "--combo-default", "balanced");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Defaults: combo=balanced \(caveman=full · rtk=on · ponytail=full\)/);
});

test("caveman and rtk flags override the combo preset", () => {
  const result = run(
    "install", "--dry-run", "--yes",
    "--combo-default", "max", "--caveman-default", "lite", "--rtk-default", "off",
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Defaults: combo=max \(caveman=lite · rtk=off · ponytail=ultra\)/);
});
