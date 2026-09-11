import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installer = path.join(root, "tersio.js");
const { version } = createRequire(import.meta.url)("../package.json");

function run(...args: string[]) {
  return spawnSync(process.execPath, [installer, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 10000,
  });
}

for (const alias of [["version"], ["--version"], ["-v"]]) {
  test(`${alias[0]} prints only the package version`, () => {
    const result = run(...alias);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `${version}\n`);
    assert.equal(result.stderr, "");
  });
}

for (const alias of [["help"], ["--help"], ["-h"]]) {
  test(`${alias[0]} prints help`, () => {
    const result = run(...alias);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^Usage:/);
    for (const command of ["install", "update", "reinstall", "doctor", "uninstall", "usage", "dashboard", "version", "help"]) {
      assert.match(result.stdout, new RegExp(`^  ${command}\\s`, "m"));
    }
    assert.equal(result.stderr, "");
  });
}

test("an unknown command fails with usage and no installer output", () => {
  const result = run("definitely-not-a-command");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown command: definitely-not-a-command/);
  assert.match(result.stdout, /^Usage:/);
  assert.doesNotMatch(result.stdout, /Prerequisites:|Installing|Will remove:/);
});

test("project dry-run previews shared bridge before dependent extensions without writing", () => {
  const missingHome = path.join(root, "test", "definitely-missing-home");
  const result = spawnSync(
    process.execPath,
    [installer, "install", "--dry-run", "--scope", "project"],
    {
      encoding: "utf8",
      cwd: path.join(root, "test"),
      env: { ...process.env, HOME: missingHome, USERPROFILE: missingHome },
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const shared = result.stdout.indexOf(path.join("shared", "session-state.js"));
  const rtk = result.stdout.indexOf("rtk-session");
  const caveman = result.stdout.indexOf("caveman-session");
  assert.ok(shared >= 0, result.stdout);
  assert.ok(rtk > shared, result.stdout);
  assert.ok(caveman > shared, result.stdout);
  assert.match(result.stdout, /\[dry-run\] would write .*shared[\\/]session-state\.js/);
  assert.equal(existsSync(path.join(root, "extensions", "shared-session-state.js")), false);
});

test("user dry-run installs mode reinforcement after Ponytail", () => {
  const missingHome = path.join(root, "test", "definitely-missing-home");
  const result = spawnSync(
    process.execPath,
    [installer, "install", "--dry-run", "--scope", "user"],
    {
      encoding: "utf8",
      cwd: root,
      env: { ...process.env, HOME: missingHome, USERPROFILE: missingHome },
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const ponytail = result.stdout.indexOf("Installing Ponytail plugin");
  const reinforcement = result.stdout.indexOf("Installing mode reinforcement extension");
  assert.ok(ponytail >= 0, result.stdout);
  assert.ok(reinforcement > ponytail, result.stdout);
  assert.match(result.stdout, /would place mode reinforcement after Ponytail/);
  assert.match(result.stdout, /\[dry-run\] would add @krtclcdy\/tersio/);
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
      env: { ...process.env, HOME: missingHome, USERPROFILE: missingHome },
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[dry-run\] would remove .*extensions[\\/]shared(?:\r?\n|$)/);
  assert.match(result.stdout, /\[dry-run\] would remove .*extensions[\\/]aaa-combo-boot(?:\r?\n|$)/);
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
        env: { ...process.env, HOME: home, USERPROFILE: home },
      }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\[dry-run\] would remove @dietrichgebert\/ponytail from .*package\.json/);
    assert.match(result.stdout, /\[dry-run\] would remove .*@dietrichgebert[\\/]ponytail(?:\r?\n|$)/);
    assert.match(result.stdout, /\[dry-run\] would remove @dietrichgebert\/ponytail from .*omp-plugins\.lock\.json/);
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
      env: { ...process.env, HOME: missingHome, USERPROFILE: missingHome },
    });

  const def = spawn(["uninstall", "--dry-run", "--yes"]);
  assert.equal(def.status, 0, def.stderr);
  assert.match(def.stdout, /dietrichgebert/, "ponytail removal is part of the default dry-run plan");

  const keep = spawn(["uninstall", "--dry-run", "--yes", "--keep-ponytail"]);
  assert.equal(keep.status, 0, keep.stderr);
  assert.doesNotMatch(keep.stdout, /dietrichgebert/);
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
      env: { ...process.env, HOME: missingHome, USERPROFILE: missingHome },
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /Proceed\?/);
  assert.match(result.stdout, /\[dry-run\] would remove .*extensions[\\/]shared(?:\r?\n|$)/);
});

test("usage with an empty ledger and no sessions prints the empty state and exits 0", () => {
  const missing = path.join(root, "test", "definitely-missing-home", "no-ledger.jsonl");
  const noSessions = path.join(root, "test", "definitely-missing-home", "no-sessions");
  const result = spawnSync(process.execPath, [installer, "usage"], {
    encoding: "utf8",
    cwd: root,
    env: { ...process.env, TERSIO_USAGE_FILE: missing, TERSIO_SESSIONS_DIR: noSessions },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No ledger rows or session tokens yet/);
});

test("dashboard --export writes a self-contained html file", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-dash-"));
  const out = path.join(dir, "dash.html");
  const ledger = path.join(dir, "usage.jsonl");
  writeFileSync(ledger, '{"ts":1757570000000,"kind":"command","detail":"/tersio usage"}\n', "utf8");
  const result = spawnSync(process.execPath, [installer, "dashboard", "--export", out], {
    encoding: "utf8",
    cwd: root,
    env: { ...process.env, TERSIO_USAGE_FILE: ledger },
  });
  assert.equal(result.status, 0, result.stderr);
  const html = existsSync(out) ? "present" : "missing";
  assert.equal(html, "present");
  const body = readFileSync(out, "utf8");
  assert.match(body, /Tersio Gain Dashboard/);
  assert.match(body, /\/tersio usage/);
  assert.doesNotMatch(body.replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/@tailwindcss\/browser@4|https:\/\/unpkg\.com\/lucide@latest|https:\/\/github\.com\/KurutoDenzeru|https:\/\/linkedin\.com\/in\/kurtcalacday\/|https:\/\/instagram\.com\/krtclcdy\//g, ""), /https?:\/\//);
  rmSync(dir, { recursive: true, force: true });
});
