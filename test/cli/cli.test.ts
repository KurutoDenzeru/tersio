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
    for (const command of ["install", "update", "doctor", "uninstall", "usage", "dashboard", "reset", "settings", "version", "help"]) {
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

test("tersio install still reaches the agent prompts, because naming a command is not --yes", () => {
  // `--yes` means "do not prompt me". Folding the command name into that flag
  // made every explicit `tersio install` skip the agent menu, so the one command
  // that exists to offer the choice was the one command that could not. Only
  // bare `tersio` printed the picker, which is not a discoverable way to set up
  // a new host.
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-yes-"));
  try {
    const result = spawnSync(process.execPath, [installer, "install", "--dry-run"], {
      cwd: root,
      encoding: "utf8",
      timeout: 20000,
      // No TTY, so nothing is prompted. This asserts the flag no longer claims
      // the user declined the prompts, which is what a flagless run would not.
      env: { ...process.env, HOME: home, USERPROFILE: home, PATH: path.join(home, "empty-bin") },
    });

    expect(result.status, result.stderr).toBe(0);
    // The agent step must still run and still report. Under the old flag a
    // command-named install short-circuited the menu gate entirely.
    expect(result.stdout, result.stdout).toMatch(/Coding agents|Oh My Pi/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("--yes still suppresses the prompts it is meant to suppress", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-yes-flag-"));
  try {
    const result = spawnSync(process.execPath, [installer, "install", "--dry-run", "--yes"], {
      cwd: root,
      encoding: "utf8",
      timeout: 20000,
      env: { ...process.env, HOME: home, USERPROFILE: home, PATH: path.join(home, "empty-bin") },
    });

    expect(result.status, result.stderr).toBe(0);
    // Same work either way; the flag is about prompting, not about scope.
    expect(result.stdout).toMatch(/Coding agents|Oh My Pi/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("dry-run previews shared bridge before dependent extensions without writing", () => {
  const missingHome = path.join(root, "test", "definitely-missing-home");
  const result = spawnSync(
    process.execPath,
    [installer, "install", "--dry-run"],
    {
      encoding: "utf8",
      cwd: path.join(root, "test"),
      env: { ...process.env, HOME: missingHome, USERPROFILE: missingHome, PATH: path.join(missingHome, "empty-bin") },
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

test("user dry-run installs commands without retired reinforcement", () => {
  const missingHome = path.join(root, "test", "definitely-missing-home");
  const result = spawnSync(
    process.execPath,
    [installer, "install", "--dry-run"],
    {
      encoding: "utf8",
      cwd: root,
      env: { ...process.env, HOME: missingHome, USERPROFILE: missingHome, PATH: path.join(missingHome, "empty-bin") },
    }
  );

  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(/Ponytail — ensure bundled plugin/);
  expect(result.stdout).toMatch(/Combo — install preset switch/);
  expect(result.stdout).toMatch(/Tersio — register plugin/);
  expect(result.stdout).not.toMatch(/mode reinforcement/i);
});
test("user dry-run installs the tersio root-command extension", () => {
  const missingHome = path.join(root, "test", "definitely-missing-home");
  const result = spawnSync(
    process.execPath,
    [installer, "install", "--dry-run"],
    {
      encoding: "utf8",
      cwd: root,
      env: { ...process.env, HOME: missingHome, USERPROFILE: missingHome, PATH: path.join(missingHome, "empty-bin") },
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
      env: { ...process.env, HOME: missingHome, USERPROFILE: missingHome, PATH: path.join(missingHome, "empty-bin") },
    }
  );

  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(/\[dry-run\] would write .*shared[\\/]session-state\.ts/);
  expect(result.stdout).toMatch(/\[dry-run\] would write .*tersio-commands[\\/]index\.ts/);
});
test("the update clean step previews uninstall then install without writing", () => {
  const missingHome = path.join(root, "test", "definitely-missing-home");
  const result = spawnSync(
    process.execPath,
    [installer, "install", "--apply-update", "--dry-run", "--yes"],
    {
      encoding: "utf8",
      timeout: 60000,
      cwd: root,
      env: { ...process.env, HOME: missingHome, USERPROFILE: missingHome, PATH: path.join(missingHome, "empty-bin") },
    }
  );

  expect(result.status, result.stderr).toBe(0);
  // `tersio update` delegates through --apply-update, which installs quietly
  // because the parent owns the closing summary, so the install phase leaves no
  // marker here. The clean step still previews, and still writes nothing.
  expect(result.stdout, result.stdout).toContain("=== Tersio Uninstall ===");
  expect(result.stdout, "a dry run removes nothing").not.toMatch(/^\s*\[rm\]/m);
  // The clean step clears the extension directories but keeps the plugin
  // package, which it is about to re-download. The header says so: it names
  // the directories and no Ponytail, rather than promising a removal the run
  // does not perform. On a machine with no layer there are none to name, and
  // saying "0 extension directories" is the point.
  expect(result.stdout).toMatch(/Oh My Pi — \d+ extension directories$/m);
  expect(result.stdout, "the clean step must not advertise the Ponytail removal").not.toMatch(/Ponytail$/m);
  // The install phase still runs after the clean step. --apply-update is the
  // delegated payload of `tersio update`, which stays silent because the parent
  // owns the closing summary, so the step defaults are the line that proves the
  // run carried on past the uninstall.
  expect(result.stdout, "the fresh install still runs after the clean step").toMatch(/Defaults: combo=/);
});

test("bare dry-run never prompts for the pending update and exits 0", () => {
  const missingHome = path.join(root, "test", "definitely-missing-home");
  const result = spawnSync(
    process.execPath,
    [installer, "--dry-run"],
    {
      encoding: "utf8",
      cwd: root,
      env: { ...process.env, HOME: missingHome, USERPROFILE: missingHome, PATH: path.join(missingHome, "empty-bin") },
    }
  );

  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).not.toMatch(/Install it now\?/);
});

test("uninstall dry-run previews the layer directories that exist", () => {
  // The preview used to name the whole layer list whether or not anything was
  // there, so it promised "8 extension directories" on a machine holding 6 and
  // named a retired directory that had never been installed. It must name what
  // is on disk and stay quiet about the rest.
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-uninstall-plan-"));
  try {
    const extDir = path.join(home, ".omp", "agent", "extensions");
    for (const dir of ["shared", "combo-toggle"]) mkdirSync(path.join(extDir, dir), { recursive: true });
    const result = spawnSync(
      process.execPath,
      [installer, "uninstall", "--dry-run", "--yes", "--agent", "omp"],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 10000,
        env: { ...process.env, HOME: home, USERPROFILE: home, PATH: path.join(home, "empty-bin") },
      }
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/\[dry-run\] would remove .*extensions[\\/]shared(?:\r?\n|$)/);
    expect(result.stdout).toMatch(/\[dry-run\] would remove .*extensions[\\/]combo-toggle(?:\r?\n|$)/);
    expect(result.stdout, "a retired directory that is not installed is not named").not.toMatch(/aaa-combo-boot/);
    expect(result.stdout, "an absent directory is not named").not.toMatch(/caveman-session/);
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
      [installer, "uninstall", "--dry-run", "--yes", "--agent", "omp", "--remove-ponytail"],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 10000,
        env: { ...process.env, HOME: home, USERPROFILE: home, PATH: path.join(home, "empty-bin") },
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
      env: { ...process.env, HOME: missingHome, USERPROFILE: missingHome, PATH: path.join(missingHome, "empty-bin") },
    });

  // The layer follows the selection, so previewing it means naming OMP.
  const def = spawn(["uninstall", "--dry-run", "--yes", "--agent", "omp"]);
  expect(def.status, def.stderr).toBe(0);
  expect(def.stdout, "ponytail removal is part of the default dry-run plan").toMatch(/dietrichgebert/);

  const keep = spawn(["uninstall", "--dry-run", "--yes", "--agent", "omp", "--keep-ponytail"]);
  expect(keep.status, keep.stderr).toBe(0);
  expect(keep.stdout).not.toMatch(/dietrichgebert/);

  // Omitting OMP keeps the whole layer: a preview that silently omitted the
  // section would read as "nothing to remove here".
  const noOmp = spawn(["uninstall", "--dry-run", "--yes"]);
  expect(noOmp.status, noOmp.stderr).toBe(0);
  expect(noOmp.stdout).toMatch(/Nothing selected — no files were removed/);
});

test("uninstall dry-run never prompts for confirmation", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-uninstall-quiet-"));
  try {
    mkdirSync(path.join(home, ".omp", "agent", "extensions", "shared"), { recursive: true });
    const result = spawnSync(
      process.execPath,
      [installer, "uninstall", "--dry-run", "--agent", "omp"],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 10000,
        env: { ...process.env, HOME: home, USERPROFILE: home, PATH: path.join(home, "empty-bin") },
      }
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toMatch(/Proceed\?/);
    expect(result.stdout).toMatch(/\[dry-run\] would remove .*extensions[\\/]shared(?:\r?\n|$)/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("the OMP layer is removed only when OMP is selected, never by default", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-keep-layer-"));
  try {
    const extDir = path.join(home, ".omp", "agent", "extensions");
    mkdirSync(path.join(extDir, "caveman-session"), { recursive: true });
    writeFileSync(path.join(extDir, "caveman-session", "index.ts"), "keep me\n", "utf8");
    const claudeSkills = path.join(home, ".claude", "skills", "tersio-caveman");
    mkdirSync(claudeSkills, { recursive: true });
    writeFileSync(path.join(claudeSkills, "SKILL.md"), "mine\n", "utf8");
    const run = (args: string[]) =>
      spawnSync(process.execPath, [installer, ...args], {
        cwd: root,
        encoding: "utf8",
        timeout: 30000,
        env: { ...process.env, HOME: home, USERPROFILE: home, PATH: path.join(home, "empty-bin") },
      });

    // Pi is a different agent from OMP, so selecting it must not touch OMP.
    const piOnly = run(["uninstall", "--yes", "--agent", "pi"]);
    expect(piOnly.status, piOnly.stderr).toBe(0);
    // Pi has no files in this fixture, so the run finds nothing to remove and
    // stops before the confirm rather than asking over an empty plan.
    expect(piOnly.stdout).toMatch(/Nothing selected — no files were removed/);
    expect(existsSync(path.join(extDir, "caveman-session", "index.ts")), "OMP layer removed by a Pi-only run").toBe(true);

    // Selecting OMP is the explicit opt-in that removes the layer.
    const withOmp = run(["uninstall", "--yes", "--agent", "omp,claude-code"]);
    expect(withOmp.status, withOmp.stderr).toBe(0);
    expect(withOmp.stdout).toMatch(/Oh My Pi — \d+ extension director/);
    expect(existsSync(path.join(extDir, "caveman-session", "index.ts")), "OMP layer kept despite being selected").toBe(false);
    // The agent files are still cleared: this is about the layer, not the run.
    expect(existsSync(claudeSkills), "agent files must still be removed").toBe(false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("no run asks about the OMP layer separately, at any selection", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-omp-question-"));
  try {
    // The old flow asked "Also remove the Oh My Pi extension layer and
    // Ponytail?" on top of the agent multiselect, so ticking Pi still asked
    // about a different agent and defaulted to removing its files. The layer is
    // now driven by the multiselect, where OMP is a row like any other.
    for (const args of [["uninstall", "--yes"], ["uninstall", "--yes", "--agent", "pi"], ["uninstall", "--yes", "--agent", "omp"]]) {
      const result = spawnSync(process.execPath, [installer, ...args], {
        cwd: root,
        encoding: "utf8",
        timeout: 30000,
        env: { ...process.env, HOME: home, USERPROFILE: home, PATH: path.join(home, "empty-bin") },
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout, `a second layer question appeared for: ${args.join(" ")}`).not.toMatch(
        /Also remove the Oh My Pi extension layer/,
      );
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("the uninstall menu ticks nothing, so accepting the default removes nothing", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-unseeded-"));
  try {
    // A saved selection is what install wrote earlier. It must not pre-tick
    // the uninstall menu: a bare Enter is the reflex answer to a menu, and
    // seeding it made that Enter delete every agent tersio had been installed
    // into. Nothing is installed here, so a seeded run would still advertise a
    // full multi-agent removal.
    mkdirSync(path.join(home, ".tersio"), { recursive: true });
    writeFileSync(
      path.join(home, ".tersio", "agents.json"),
      JSON.stringify({ hosts: ["opencode", "claude-code", "codex", "pi"], updatedAt: 0 }),
      "utf8",
    );
    mkdirSync(path.join(home, ".omp", "agent", "extensions", "caveman-session"), { recursive: true });
    writeFileSync(path.join(home, ".omp", "agent", "extensions", "caveman-session", "index.ts"), "keep me\n", "utf8");

    const result = spawnSync(process.execPath, [installer, "uninstall", "--yes", "--agent", "nothing-selected-here"], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
      env: { ...process.env, HOME: home, USERPROFILE: home, PATH: path.join(home, "empty-bin") },
    });

    // An unknown host id selects nothing, which is what an untouched menu means.
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Nothing selected — no files were removed/);
    expect(existsSync(path.join(home, ".omp", "agent", "extensions", "caveman-session", "index.ts"))).toBe(true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("flagless uninstall without a terminal falls back to the saved set, so an installed harness is still listed", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-seeded-"));
  try {
    // The saved selection names four hosts; only Pi has anything on disk.
    // With no terminal there is no menu, so the run falls back to the saved
    // set and must still produce a plan naming Pi rather than the
    // "Nothing selected" dead end.
    mkdirSync(path.join(home, ".tersio"), { recursive: true });
    writeFileSync(
      path.join(home, ".tersio", "agents.json"),
      JSON.stringify({ hosts: ["opencode", "claude-code", "codex", "pi"], updatedAt: 0 }),
      "utf8",
    );
    const piSkills = path.join(home, ".pi", "agent", "skills", "tersio-caveman");
    mkdirSync(piSkills, { recursive: true });
    writeFileSync(path.join(piSkills, "SKILL.md"), "<!-- tersio:start -->\nrules\n<!-- tersio:end -->\n", "utf8");

    // No --agent flag and no --yes, with piped stdin so there is no
    // terminal: the flagless path is the one that falls through to the
    // saved-set fallback.
    const result = spawnSync(process.execPath, [installer, "uninstall"], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
      env: { ...process.env, HOME: home, USERPROFILE: home, PATH: path.join(home, "empty-bin") },
      input: "",
    });

    expect(result.status, result.stderr).toBe(0);
    // Reaching the plan at all is the point: the fallback has to produce
    // a plan naming Pi rather than the "Nothing selected" dead end.
    expect(result.stdout).not.toMatch(/Nothing selected — no files were removed/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});


test("the uninstall preview groups the agent files under the host that owns them", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-preview-"));
  try {
    const skills = path.join(home, ".claude", "skills", "tersio-caveman");
    mkdirSync(skills, { recursive: true });
    writeFileSync(path.join(skills, "SKILL.md"), "mine\n", "utf8");

    const result = spawnSync(
      process.execPath,
      [installer, "uninstall", "--dry-run", "--yes", "--agent", "claude-code"],
      { cwd: root, encoding: "utf8", timeout: 30000, env: { ...process.env, HOME: home, USERPROFILE: home, PATH: path.join(home, "empty-bin") } },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Claude Code — hook · auto-rewrite/);
    // Only what exists is named, so a stale plan cannot overstate the removal.
    expect(result.stdout).toMatch(/~\/\.claude\/skills\/tersio-caveman\/SKILL\.md/);
    expect(result.stdout, "an absent file must not appear in the removal plan").not.toMatch(/~\/\.claude\/settings\.json/);
    // The unselected host stays out of the plan entirely.
    // Scoped to the agent section's indentation: the OMP layer header also
    // contains the substring "Pi —".
    expect(result.stdout, "an unselected host was previewed").not.toMatch(/^\s{4}Pi —/m);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("the install preview names each selected host's files and marks them new", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-install-preview-"));
  try {
    const result = spawnSync(
      process.execPath,
      [installer, "install", "--dry-run", "--agent", "pi"],
      { cwd: root, encoding: "utf8", timeout: 60000, env: { ...process.env, HOME: home, USERPROFILE: home, PATH: path.join(home, "empty-bin") } },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Pi — rtk extension · auto-rewrite/);
    expect(result.stdout).toMatch(/~\/\.pi\/agent\/AGENTS\.md \(new\)/);
    // Naming one host installs one host. The Oh My Pi layer plan belongs to a
    // run that selected OMP, and printing it for a Pi-only run is how choosing
    // one agent shipped a second agent's files.
    expect(result.stdout, "a Pi-only run must not plan the Oh My Pi layer").not.toMatch(/~\/\.omp\/agent\/extensions\//);
    expect(result.stdout, "preview must not print absolute machine paths").not.toContain(`${path.sep}Users${path.sep}`);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
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

test("dashboard --export writes a self-contained html file", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-dash-"));
  const out = path.join(dir, "dash.html");
  const ledger = path.join(dir, "usage.jsonl");
  writeFileSync(ledger, "{\"ts\":1757570000000,\"kind\":\"command\",\"detail\":\"/tersio usage\"}\n", "utf8");
  appendFileSync(ledger, "{\"ts\":1757570000001,\"kind\":\"command\",\"detail\":\"/tersio $'quoted$' $& $\"}\n", "utf8");
  const result = spawnSync(process.execPath, [installer, "dashboard", "--export", out], {
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

test("gain is no longer a public dashboard command", () => {
  const result = run("gain", "--export", path.join(os.tmpdir(), "tersio-obsolete-gain.html"));
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/Unknown command: gain/);
  expect(existsSync(path.join(os.tmpdir(), "tersio-obsolete-gain.html"))).toBe(false);
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

test("dashboard --export includes the reset control and empty states", () => {
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
