import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { agentChoices, hostHint } from "../../cli/agents.ts";
import { HOSTS, byId, OWN_PATH_HOSTS } from "../../cli/agent-hosts.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const installer = path.join(root, "tersio.js");

function tempHome(): string {
  return mkdtempSync(path.join(os.tmpdir(), "tersio-prompt-"));
}

function run(home: string, argv: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [installer, ...argv], {
    cwd: root,
    encoding: "utf8",
    timeout: 60000,
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
}

// The reported failure: `~/.tersio/agents.json` already held a choice, so the
// install flow returned it without ever showing the agent multiselect. A user
// who installed before the prompt existed could not see or change their host
// selection from the install flow at all.

test("a stored choice does not suppress the agent prompt at a terminal", () => {
  const home = tempHome();
  try {
    mkdirSync(path.join(home, ".omp", "agent"), { recursive: true });
    mkdirSync(path.join(home, ".tersio"), { recursive: true });
    writeFileSync(
      path.join(home, ".tersio", "agents.json"),
      JSON.stringify({ agents: ["omp"] }),
      "utf8",
    );

    // Non-TTY, so the prompt cannot render — but the stored choice must still
    // be honoured, which is the non-interactive contract.
    const result = run(home, ["install", "--yes", "--dry-run"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Hosts: Oh My Pi \(OMP\)$/m);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("--agent still wins over a stored choice without prompting", () => {
  const home = tempHome();
  try {
    mkdirSync(path.join(home, ".omp", "agent"), { recursive: true });
    mkdirSync(path.join(home, ".tersio"), { recursive: true });
    writeFileSync(
      path.join(home, ".tersio", "agents.json"),
      JSON.stringify({ agents: ["omp"] }),
      "utf8",
    );

    const result = run(home, ["install", "--yes", "--dry-run", "--agent", "cursor"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Hosts: Cursor$/m);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("the agent menu offers every supported host with a short hint", () => {
  const choices = agentChoices();
  expect(choices).toHaveLength(HOSTS.length);
  expect(choices.map((c) => c.value)).toEqual(HOSTS.map((h) => h.id));
  for (const c of choices) {
    expect(c.label, c.value).toBeTruthy();
    expect(c.hint, c.value).toBeTruthy();
  }
});

test("every host's hint fits one terminal line", () => {
  // Clack draws each option in an 80-column terminal. A hint that wraps turns
  // one row into three and pushes the remaining hosts into pagination, which is
  // what made the original list unreadable.
  for (const host of HOSTS) {
    const hint = hostHint(host);
    const width = host.label.length + hint.length;
    expect(width, `${host.id}: ${host.label} — ${hint}`).toBeLessThan(60);
  }
});

test("hints state the host's real capabilities", () => {
  // OMP and OpenCode ship live extensions, not a static rules pack, so calling
  // them "rules pack" was inaccurate.
  for (const id of OWN_PATH_HOSTS) {
    const host = byId(id);
    expect(host, id).toBeDefined();
    expect(hostHint(host!), `${id}`).toContain('live');
    expect(hostHint(host!), `${id}`).not.toContain('rules');
  }

  // OpenClaw cannot rewrite tool args from a static hook file.
  const openclaw = byId('openclaw');
  expect(openclaw).toBeDefined();
  expect(hostHint(openclaw!)).toContain('rtk guidance');

  // Hermes has no user-global instruction file, so it gets no rules pack.
  const hermes = byId('hermes');
  expect(hermes).toBeDefined();
  expect(hostHint(hermes!)).not.toContain('rules');
  expect(hostHint(hermes!)).toContain('skills');
});

test("--agent is documented in help", () => {
  const home = tempHome();
  try {
    mkdirSync(path.join(home, ".omp", "agent"), { recursive: true });
    const result = run(home, ["help"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/--agent/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

/** Menu entry values of the bare `tersio` command picker. */
function bareMenuEntries(): string[] {
  const source = readFileSync(path.join(root, "cli", "install.ts"), "utf8");
  const body = source.slice(source.indexOf("async function runCommandMenu"));
  const menu = body.match(/askInteractiveChoice\('Tersio — what next\?', \[([\s\S]*?)\], 'install'\)/);
  expect(menu, "the bare tersio menu must still exist").not.toBeNull();
  return [...(menu?.[1] ?? "").matchAll(/value: '([a-z-]+)'/g)].map((m) => m[1]);
}

test("install and reinstall are separate menu entries", () => {
  // Not redundant. `doctor --fix` restores what is missing but never deletes
  // stale files, so a machine carrying a retired extension keeps it until a
  // reinstall. Verified: after `doctor --fix`, a legacy aaa-combo-boot dir, a
  // retired mode-reinforcement.ts and an unknown shared/*.ts all survive; only
  // reinstall removes them.
  const entries = bareMenuEntries();
  expect(entries, "both must be offered").toEqual(expect.arrayContaining(["install", "reinstall"]));
  // Agent selection happens inside the install flow, not as its own menu entry.
  expect(entries).not.toContain("agents");
});

test("every bare-menu entry has a switch case and vice versa", () => {
  // A case with no menu entry is unreachable: the update offer is asked before
  // the menu renders, so a declined update could never reach an `update` case.
  const source = readFileSync(path.join(root, "cli", "install.ts"), "utf8");
  const body = source.slice(source.indexOf("async function runCommandMenu"));
  const switchBody = body.slice(body.indexOf("switch (choice.value)"));
  const cases = [...switchBody.matchAll(/case '([a-z-]+)'\s*:/g)].map((m) => m[1]);
  const entries = bareMenuEntries();

  expect(cases.filter((c) => !entries.includes(c)), "unreachable cases").toEqual([]);
  expect(entries.filter((e) => !cases.includes(e)), "menu entries with no case").toEqual([]);
});

test("doctor --fix keeps stale files that reinstall removes", () => {
  // The reason install and reinstall are separate menu rows. Checked against a
  // home seeded with a retired extension, a retired shared file, and an
  // unknown file in the shared dir — what a long-lived install accumulates.
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-stale-"));
  try {
    const extDir = path.join(home, ".omp", "agent", "extensions");
    mkdirSync(path.join(extDir, "aaa-combo-boot"), { recursive: true });
    mkdirSync(path.join(extDir, "shared"), { recursive: true });
    writeFileSync(path.join(extDir, "aaa-combo-boot", "index.js"), "// legacy\n", "utf8");
    writeFileSync(path.join(extDir, "shared", "mode-reinforcement.ts"), "// retired\n", "utf8");
    const unknown = path.join(extDir, "shared", "old-thing.ts");
    writeFileSync(unknown, "// orphan\n", "utf8");

    // `--fix extensions` rather than bare `--fix`: the default scope includes
    // `cli`, which runs the npm smoke check and needs a registry. CI has none.
    const fix = spawnSync(process.execPath, [installer, "doctor", "--fix", "extensions", "--yes"], {
      cwd: root, encoding: "utf8", timeout: 120000,
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });
    expect(fix.status, fix.stderr).toBe(0);
    // --fix restores what is missing. It never deletes, so all three survive.
    expect(existsSync(path.join(extDir, "aaa-combo-boot"))).toBe(true);
    expect(existsSync(path.join(extDir, "shared", "mode-reinforcement.ts"))).toBe(true);
    expect(existsSync(unknown)).toBe(true);

    // Seed the update cache so the install flow's advisory version check does
    // not reach the registry; this test is about which files survive, not
    // about the update path.
    const cacheDir = path.join(home, ".omp", "plugins");
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(
      path.join(cacheDir, "tersio-update-check.json"),
      JSON.stringify({ latest: "0.0.1", lastCheck: Date.now() }),
      "utf8",
    );
    const reinstall = spawnSync(process.execPath, [installer, "reinstall", "--yes"], {
      cwd: root, encoding: "utf8", timeout: 120000,
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });
    // Reinstall re-downloads, so tolerate a registry failure — the point is
    // which files survive, and the clean uninstall runs before any download.
    expect([0, 1], `reinstall failed: ${reinstall.stderr || reinstall.stdout}`).toContain(reinstall.status);
    // Only a clean uninstall clears them.
    expect(existsSync(path.join(extDir, "aaa-combo-boot"))).toBe(false);
    expect(existsSync(path.join(extDir, "shared", "mode-reinforcement.ts"))).toBe(false);
    expect(existsSync(unknown)).toBe(false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 300000);
