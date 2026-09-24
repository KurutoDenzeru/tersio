import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const installer = path.join(root, "tersio.js");
const { version } = createRequire(import.meta.url)("../../package.json");

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

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(`${version}\n`);
    expect(result.stderr).toBe("");
  });
}

for (const alias of [["help"], ["--help"], ["-h"]]) {
  test(`${alias[0]} prints help`, () => {
    const result = run(...alias);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/^Usage:/);
    for (const command of ["install", "update", "reinstall", "doctor", "uninstall", "usage", "gain", "reset", "settings", "version", "help"]) {
      expect(result.stdout).toMatch(new RegExp(`^  ${command}\\s`, "m"));
    }
    expect(result.stderr).toBe("");
  });
}

test("an unknown command fails with usage and no installer output", () => {
  const result = run("definitely-not-a-command");

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
      env: { ...process.env, HOME: missingHome, USERPROFILE: missingHome },
    }
  );

  expect(result.status, result.stderr).toBe(0);
  const shared = result.stdout.indexOf("Shared files — sync session bridge");
  const rtk = result.stdout.indexOf("RTK session — install session mode");
  const caveman = result.stdout.indexOf("Caveman — fetch rule and install session mode");
  expect(shared >= 0, result.stdout).toBeTruthy();
  expect(rtk > shared, result.stdout).toBeTruthy();
  expect(caveman > shared, result.stdout).toBeTruthy();
  expect(result.stdout).toMatch(/Ponytail — ensure bundled plugin/);
  expect(result.stdout).toMatch(/Tersio — register plugin/);
  expect(result.stdout).not.toMatch(/\/tmp|\/Users|\.omp\/agent\/extensions\/shared\/session-state\.js/);
  expect(existsSync(path.join(root, "extensions", "shared-session-state.js"))).toBe(false);
});

test("user dry-run installs mode reinforcement after Ponytail", () => {
  const missingHome = path.join(root, "test", "definitely-missing-home");
  const result = spawnSync(
    process.execPath,
    [installer, "install", "--dry-run"],
    {
      encoding: "utf8",
      cwd: root,
      env: { ...process.env, HOME: missingHome, USERPROFILE: missingHome },
    }
  );

  expect(result.status, result.stderr).toBe(0);
  const ponytail = result.stdout.indexOf("Ponytail — ensure bundled plugin");
  const reinforcement = result.stdout.indexOf("Session helpers — sync shared files");
  expect(ponytail >= 0, result.stdout).toBeTruthy();
  expect(reinforcement > ponytail, result.stdout).toBeTruthy();
  expect(result.stdout).toMatch(/Combo — install preset switch/);
  expect(result.stdout).toMatch(/Tersio — register plugin/);
});
test("user dry-run installs the tersio root-command extension", () => {
  const missingHome = path.join(root, "test", "definitely-missing-home");
  const result = spawnSync(
    process.execPath,
    [installer, "install", "--dry-run"],
    {
      encoding: "utf8",
      cwd: root,
      env: { ...process.env, HOME: missingHome, USERPROFILE: missingHome },
    }
  );

  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(/Tersio commands — install \/tersio root command/);
  expect(result.stdout).not.toMatch(/tersio-commands[\\/]index\.ts/);
});
test("verbose dry-run reveals file paths hidden by default", () => {
  const missingHome = path.join(root, "test", "definitely-missing-home");
  const result = spawnSync(
    process.execPath,
    [installer, "install", "--dry-run", "--verbose"],
    {
      encoding: "utf8",
      cwd: root,
      env: { ...process.env, HOME: missingHome, USERPROFILE: missingHome },
    }
  );

  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(/\[dry-run\] would write .*shared[\\/]session-state\.ts/);
  expect(result.stdout).toMatch(/\[dry-run\] would write .*tersio-commands[\\/]index\.ts/);
});
test("reinstall --dry-run previews uninstall then install without writing", () => {
  const missingHome = path.join(root, "test", "definitely-missing-home");
  const result = spawnSync(
    process.execPath,
    [installer, "reinstall", "--dry-run", "--yes"],
    {
      encoding: "utf8",
      timeout: 60000,
      cwd: root,
      env: { ...process.env, HOME: missingHome, USERPROFILE: missingHome },
    }
  );

  expect(result.status, result.stderr).toBe(0);
  const uninstall = result.stdout.indexOf("=== Tersio Uninstall ===");
  const install = result.stdout.indexOf("Ponytail — ensure bundled plugin");
  expect(uninstall >= 0, result.stdout).toBeTruthy();
  expect(install > uninstall, "uninstall runs before the fresh install").toBeTruthy();
  expect(result.stdout).toMatch(/\[dry-run\] would remove /);
  expect(result.stdout).toMatch(/Done — restart OMP/);
});

test("bare dry-run never prompts for the pending update and exits 0", () => {
  const missingHome = path.join(root, "test", "definitely-missing-home");
  const result = spawnSync(
    process.execPath,
    [installer, "--dry-run"],
    {
      encoding: "utf8",
      cwd: root,
      env: { ...process.env, HOME: missingHome, USERPROFILE: missingHome },
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
      env: { ...process.env, HOME: missingHome, USERPROFILE: missingHome },
    }
  );

  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(/\[dry-run\] would remove .*extensions[\\/]shared(?:\r?\n|$)/);
  expect(result.stdout).toMatch(/\[dry-run\] would remove .*extensions[\\/]aaa-combo-boot(?:\r?\n|$)/);
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
      env: { ...process.env, HOME: missingHome, USERPROFILE: missingHome },
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
      env: { ...process.env, HOME: missingHome, USERPROFILE: missingHome },
    }
  );

  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).not.toMatch(/Proceed\?/);
  expect(result.stdout).toMatch(/\[dry-run\] would remove .*extensions[\\/]shared(?:\r?\n|$)/);
});

test("usage with an empty ledger and no sessions prints the empty state and exits 0", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-usage-empty-"));
  const missing = path.join(root, "test", "definitely-missing-home", "no-ledger.jsonl");
  const noSessions = path.join(root, "test", "definitely-missing-home", "no-sessions");
  const result = spawnSync(process.execPath, [installer, "usage"], {
    encoding: "utf8",
    cwd: root,
    env: { ...process.env, TERSIO_USAGE_FILE: missing, TERSIO_SESSIONS_DIR: noSessions, TERSIO_RESET_FILE: path.join(root, "test", "definitely-missing-home", "no-reset.json"), TERSIO_USAGE_DB: path.join(dir, "usage.db") },
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(/No ledger rows or session tokens yet/);
  expect(result.stdout).toMatch(/· stored ===/);
  rmSync(dir, { recursive: true, force: true });
});

test("gain --export writes a self-contained html file", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-dash-"));
  const out = path.join(dir, "dash.html");
  const ledger = path.join(dir, "usage.jsonl");
  writeFileSync(ledger, "{\"ts\":1757570000000,\"kind\":\"command\",\"detail\":\"/tersio usage\"}\n", "utf8");
  appendFileSync(ledger, "{\"ts\":1757570000001,\"kind\":\"command\",\"detail\":\"/tersio $'quoted$' $& $\"}\n", "utf8");
  const result = spawnSync(process.execPath, [installer, "gain", "--export", out], {
    encoding: "utf8",
    cwd: root,
    env: { ...process.env, TERSIO_USAGE_FILE: ledger, TERSIO_RESET_FILE: path.join(dir, "reset.json") },
  });
  expect(result.status, result.stderr).toBe(0);
  const html = existsSync(out) ? "present" : "missing";
  expect(html).toBe("present");
  const body = readFileSync(out, "utf8");
  expect(body).toMatch(/Tersio Dashboard/);
  expect(body).toMatch(/Oh My Pi/);
  expect(body).toMatch(/ompPath/);
  expect(body).toMatch(/\/tersio usage/);
  // `$'`/`$&` in data must survive String.replace untouched (single document).
  expect(body).toMatch(/\$'quoted\$'/);
  expect(body.split("</body>").length - 1).toBe(1);
  expect(body.split("</html>").length - 1).toBe(1);
  rmSync(dir, { recursive: true, force: true });
});

test("reset --dry-run keeps the seeded ledger", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-reset-"));
  const ledger = path.join(dir, "usage.jsonl");
  writeFileSync(ledger, '{"ts":1,"kind":"command","detail":"x"}\n{"ts":2,"kind":"toggle","detail":"y"}\n', "utf8");
  const result = spawnSync(process.execPath, [installer, "reset", "--dry-run"], {
    encoding: "utf8",
    cwd: root,
    input: "n\n",
    env: {
      ...process.env,
      TERSIO_USAGE_FILE: ledger,
      TERSIO_RESET_FILE: path.join(dir, "reset.json"),
      TERSIO_SESSIONS_DIR: path.join(dir, "no-sessions"),
      TERSIO_RTK_DB: path.join(dir, "no-rtk.db"),
      TERSIO_USAGE_DB: path.join(dir, "no-usage.db"),
    },
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(/Will clear: 2 usage ledger rows/);
  expect(result.stdout).toMatch(/\[dry-run\] nothing written/);
  expect(existsSync(ledger)).toBe(true);
});

test("reset --yes clears the seeded ledger and writes the watermark", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-reset-"));
  const ledger = path.join(dir, "usage.jsonl");
  const marker = path.join(dir, "reset.json");
  writeFileSync(ledger, '{"ts":1,"kind":"command","detail":"x"}\n', "utf8");
  const result = spawnSync(process.execPath, [installer, "reset", "--yes"], {
    encoding: "utf8",
    cwd: root,
    env: {
      ...process.env,
      TERSIO_USAGE_FILE: ledger,
      TERSIO_RESET_FILE: marker,
      TERSIO_SESSIONS_DIR: path.join(dir, "no-sessions"),
      TERSIO_RTK_DB: path.join(dir, "no-rtk.db"),
      TERSIO_USAGE_DB: path.join(dir, "no-usage.db"),
    },
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(/\[ok\] reset — removed 1 usage rows; statistics view starts at /);
  expect(existsSync(ledger)).toBe(false);
  expect(existsSync(marker)).toBe(true);
});

test("reset asks Y/N and aborts without writing on N", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-reset-"));
  const ledger = path.join(dir, "usage.jsonl");
  const marker = path.join(dir, "reset.json");
  writeFileSync(ledger, '{"ts":1,"kind":"command","detail":"x"}\n', "utf8");
  const result = spawnSync(process.execPath, [installer, "reset"], {
    encoding: "utf8",
    cwd: root,
    input: "n\n",
    env: {
      ...process.env,
      TERSIO_USAGE_FILE: ledger,
      TERSIO_RESET_FILE: marker,
      TERSIO_SESSIONS_DIR: path.join(dir, "no-sessions"),
      TERSIO_RTK_DB: path.join(dir, "no-rtk.db"),
      TERSIO_USAGE_DB: path.join(dir, "no-usage.db"),
    },
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(/Proceed\? \[y\/N\]/);
  expect(result.stdout).toMatch(/Aborted\./);
  expect(existsSync(ledger), "ledger kept on abort").toBe(true);
  expect(existsSync(marker), "no watermark written on abort").toBe(false);
});

test("reset accepts lowercase y and writes the watermark", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-reset-"));
  const ledger = path.join(dir, "usage.jsonl");
  const marker = path.join(dir, "reset.json");
  writeFileSync(ledger, '{"ts":1,"kind":"command","detail":"x"}\n', "utf8");
  const result = spawnSync(process.execPath, [installer, "reset"], {
    encoding: "utf8",
    cwd: root,
    input: "y\n",
    env: {
      ...process.env,
      TERSIO_USAGE_FILE: ledger,
      TERSIO_RESET_FILE: marker,
      TERSIO_SESSIONS_DIR: path.join(dir, "no-sessions"),
      TERSIO_RTK_DB: path.join(dir, "no-rtk.db"),
      TERSIO_USAGE_DB: path.join(dir, "no-usage.db"),
    },
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(/\[ok\] reset — removed 1 usage rows/);
  expect(existsSync(ledger)).toBe(false);
  expect(existsSync(marker)).toBe(true);
});

test("reset --yes on empty stores prints nothing-to-reset without prompting", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-reset-"));
  const ledger = path.join(dir, "usage.jsonl");
  const result = spawnSync(process.execPath, [installer, "reset", "--yes"], {
    encoding: "utf8",
    cwd: root,
    env: {
      ...process.env,
      TERSIO_USAGE_FILE: ledger,
      TERSIO_RESET_FILE: path.join(dir, "reset.json"),
      TERSIO_SESSIONS_DIR: path.join(dir, "no-sessions"),
      TERSIO_RTK_DB: path.join(dir, "no-rtk.db"),
      TERSIO_USAGE_DB: path.join(dir, "no-usage.db"),
    },
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(/Nothing to reset — no statistics recorded/);
  expect(existsSync(ledger)).toBe(false);
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

test("gain --export includes the reset control and empty states", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-dash-"));
  const out = path.join(dir, "dash.html");
  const result = spawnSync(process.execPath, [installer, "gain", "--export", out], {
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
  expect(body).toMatch(/Reset statistics/);
  expect(body).toMatch(/Danger zone/);
  expect(body).toMatch(/No activity yet/);
  expect(body).toMatch(/No models yet/);
  expect(body).toMatch(/No requests yet/);
  expect(body).toMatch(/No tool data yet/);
  expect(body).toMatch(/Share your usage/);
  expect(body).toMatch(/Diagnosis/);
  expect(body).toMatch(/ranked by tokens \/ top 10/);
  expect(body).toMatch(/byModelBucketUsd/);
  rmSync(dir, { recursive: true, force: true });
});
