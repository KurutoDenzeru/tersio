import { expect, test } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { SpawnSyncReturns } from "node:child_process";
import path from "node:path";
import { hermeticPath, runTersio, seedFakeRtk, tempHome } from "../helpers/home.ts";


function agentsFile(home: string): string {
  return path.join(home, ".tersio", "agents.json");
}

function readAgents(home: string): string[] {
  const parsed = JSON.parse(readFileSync(agentsFile(home), "utf8")) as { agents?: string[] };
  return parsed.agents ?? [];
}

function seedHosts(home: string, hosts: string[]): void {
  for (const h of hosts) {
    mkdirSync(h === "omp" ? path.join(home, ".omp", "agent") : path.join(home, ".config", "opencode"), { recursive: true });
  }
}

function run(home: string, argv: string[], pathOverride?: string): SpawnSyncReturns<string> {
  return runTersio(home, argv, 60000, pathOverride);
}

// Host selection decides which files land where, so the observable contract is
// the filesystem: which host directories got written, and what got persisted.

test("--agent omp installs OMP wiring and skips the OpenCode plugin", () => {
  const home = tempHome();
  try {
    seedHosts(home, ["omp", "opencode"]);
    const result = run(home, ["install", "--yes", "--dry-run", "--agent", "omp"]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Hosts: Oh My Pi \(OMP\)/);
    expect(result.stdout).toMatch(/Caveman — fetch rule and install session mode/);
    expect(result.stdout).not.toMatch(/OpenCode — install rtk plugin/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("--agent opencode installs only the OpenCode plugin, not the OMP modes", () => {
  const home = tempHome();
  try {
    seedHosts(home, ["omp", "opencode"]);
    const result = run(home, ["install", "--yes", "--dry-run", "--agent", "opencode"]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Hosts: OpenCode/);
    expect(result.stdout).toMatch(/OpenCode — install rtk plugin/);
    // OMP-only steps must not run: no shared bridge, no Ponytail, no combo.
    expect(result.stdout).not.toMatch(/Combo — install preset switch/);
    expect(result.stdout).not.toMatch(/Ponytail — ensure bundled plugin/);
    expect(result.stdout).not.toMatch(/Shared files — sync session bridge/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("--agent pi writes a loadable Pi extension, not a JSON hook config", () => {
  // Regression: pi was listed with a rewriteConfig pointing at a .ts path, so
  // the generic emitter wrote a JSON object into ~/.pi/agent/extensions/rtk.ts.
  // Pi loads that directory with jiti, so the file failed to parse and bash
  // commands were never rewritten — while doctor still reported a hook.
  const home = tempHome();
  try {
    seedHosts(home, ["omp"]);
    // The extension comes from `rtk init`, so the test supplies the binary.
    // Depending on the developer's real rtk made this pass locally and fail in
    // CI, which has none in ~/.bun/bin.
    seedFakeRtk(home);
    const result = run(home, ["install", "--yes", "--agent", "pi"], hermeticPath());
    expect(result.status, result.stderr).toBe(0);

    const ext = path.join(home, ".pi", "agent", "extensions", "rtk.ts");
    expect(existsSync(ext), "Pi must get an rtk extension").toBe(true);
    const body = readFileSync(ext, "utf8");
    // Pi's contract: a TypeScript module with a default export factory.
    expect(body, "extension must export a default factory").toMatch(/export\s+default/);
    expect(body.trimStart().startsWith("{"), "must not be a bare JSON object").toBe(false);

    // And doctor must see a real module, not a marker string.
    const doctor = run(home, ["doctor"]);
    expect(doctor.stdout, doctor.stderr).toMatch(/Pi rtk extension: ok/);

    // Reinstall must not stall on rtk's "overwrite the non-stock extension?"
    // prompt. It used to: the second run found our own file and rtk asked
    // before replacing it, so a reinstall hung or silently did nothing.
    const again = run(home, ["install", "--yes", "--agent", "pi"], hermeticPath());
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout, "reinstall must not fail to wire").not.toMatch(/could not wire|refusing to overwrite/);
    expect(existsSync(ext), "the extension must survive a reinstall").toBe(true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("installing pi repairs the unparsable extension an older tersio left behind", () => {
  // The bug this fixes shipped to users: a 288-byte JSON object at the .ts
  // path. rtk refuses to overwrite a file it did not write, and in a
  // non-interactive shell it defaults to "no" and ignores stdin, so those
  // installs stayed broken no matter how many times the user reinstalled.
  const home = tempHome();
  try {
    seedHosts(home, ["omp"]);
    seedFakeRtk(home);
    const ext = path.join(home, ".pi", "agent", "extensions", "rtk.ts");
    mkdirSync(path.dirname(ext), { recursive: true });
    writeFileSync(ext, '{\n  "hooks": {\n    "tool_call": []\n  }\n}\n', "utf8");

    const result = run(home, ["install", "--yes", "--agent", "pi"], hermeticPath());
    expect(result.status, result.stderr).toBe(0);
    const body = readFileSync(ext, "utf8");
    expect(body, "the stale JSON must be gone").not.toMatch(/"hooks"/);
    expect(body, "repaired file must be a Pi module").toMatch(/export\s+default/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("an unknown --agent is rejected with the full valid list", () => {
  const home = tempHome();
  try {
    seedHosts(home, ["omp"]);
    const result = run(home, ["install", "--yes", "--agent", "not-an-agent"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Invalid --agent: not-an-agent/);
    // The valid list comes from the host registry, so it must name every host.
    expect(result.stderr).toMatch(/omp, opencode, claude-code, codex/);
    expect(result.stderr).toMatch(/grok-build, pi, openclaw, hermes/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a comma list selects several hosts and persists them", () => {
  const home = tempHome();
  try {
    seedHosts(home, ["omp", "opencode"]);
    const result = run(home, ["install", "--yes", "--dry-run", "--agent", "omp,opencode"]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Hosts: Oh My Pi \(OMP\) \+ OpenCode/);
    // --dry-run must not write the persisted choice.
    expect(existsSync(agentsFile(home))).toBe(false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// Regression: --agent was read through flagValue(), which returns only the
// first occurrence, so `--agent omp --agent cursor` silently installed omp
// alone instead of failing or unioning.
test("a repeated --agent flag unions the hosts instead of keeping the first", () => {
  const home = tempHome();
  try {
    seedHosts(home, ["omp", "cursor"]);
    const result = run(home, ["install", "--yes", "--dry-run", "--agent", "omp", "--agent", "cursor"]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Hosts: Oh My Pi \(OMP\) \+ Cursor$/m);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("repeated and inline --agent forms combine, and duplicates collapse", () => {
  const home = tempHome();
  try {
    seedHosts(home, ["omp"]);
    const result = run(home, [
      "install", "--yes", "--dry-run",
      "--agent", "omp,claude-code",
      "--agent=grok-build",
      "--agent", "omp",
    ]);

    expect(result.status, result.stderr).toBe(0);
    // omp appears three times across the flags but must be installed once.
    expect(result.stdout).toMatch(/Hosts: Oh My Pi \(OMP\) \+ Claude Code \+ Grok Build$/m);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("--agent with no value fails loudly instead of installing nothing", () => {
  const home = tempHome();
  try {
    seedHosts(home, ["omp"]);
    const result = run(home, ["install", "--yes", "--agent"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/--agent needs a value/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("non-interactive install auto-detects the hosts present and never prompts", () => {
  const home = tempHome();
  try {
    seedHosts(home, ["omp"]);
    const result = run(home, ["install", "--yes", "--dry-run"]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Hosts: Oh My Pi \(OMP\)$/m);
    expect(result.stdout).not.toMatch(/Install for which coding agents/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a stored choice wins over detection on later runs", () => {
  const home = tempHome();
  try {
    seedHosts(home, ["omp", "opencode"]);
    mkdirSync(path.dirname(agentsFile(home)), { recursive: true });
    writeFileSync(agentsFile(home), JSON.stringify({ agents: ["omp"] }), "utf8");

    const result = run(home, ["install", "--yes", "--dry-run"]);

    expect(result.status, result.stderr).toBe(0);
    // Both hosts are present, but the stored choice excludes OpenCode.
    expect(result.stdout).toMatch(/Hosts: Oh My Pi \(OMP\)$/m);
    expect(result.stdout).not.toMatch(/OpenCode — install rtk plugin/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a hand-edited agents file with unknown or duplicate hosts is tolerated", () => {
  const home = tempHome();
  try {
    seedHosts(home, ["omp", "opencode"]);
    mkdirSync(path.dirname(agentsFile(home)), { recursive: true });
    writeFileSync(agentsFile(home), JSON.stringify({ agents: ["omp", "omp", "cursor", 42] }), "utf8");

    const result = run(home, ["install", "--yes", "--dry-run"]);

    expect(result.status, result.stderr).toBe(0);
    // Dedupe keeps omp once, the bogus entries drop, and a now-valid host
    // (cursor) survives the filter.
    expect(result.stdout).toMatch(/Hosts: Oh My Pi \(OMP\) \+ Cursor$/m);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a corrupt agents file falls back to detection instead of crashing", () => {
  const home = tempHome();
  try {
    seedHosts(home, ["omp", "opencode"]);
    mkdirSync(path.dirname(agentsFile(home)), { recursive: true });
    writeFileSync(agentsFile(home), "{ not json", "utf8");

    const result = run(home, ["install", "--yes", "--dry-run"]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Hosts: Oh My Pi \(OMP\) \+ OpenCode/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("settings --agent persists the choice for later installs", () => {
  const home = tempHome();
  try {
    seedHosts(home, ["omp", "opencode"]);
    const set = run(home, ["settings", "--agent", "opencode"]);

    expect(set.status, set.stderr).toBe(0);
    expect(readAgents(home)).toEqual(["opencode"]);

    // The stored value must actually change what install does.
    const after = run(home, ["install", "--yes", "--dry-run"]);
    expect(after.stdout).toMatch(/Hosts: OpenCode/);
    expect(after.stdout).not.toMatch(/Combo — install preset switch/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("settings shows the current host selection in its table", () => {
  const home = tempHome();
  try {
    mkdirSync(path.dirname(agentsFile(home)), { recursive: true });
    writeFileSync(agentsFile(home), JSON.stringify({ agents: ["omp", "opencode"] }), "utf8");
    const result = run(home, ["settings", "--dry-run"]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/│ agents +│ omp, opencode +│/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor stays quiet about OpenCode once the user opted out", () => {
  const home = tempHome();
  try {
    seedHosts(home, ["omp", "opencode"]);
    mkdirSync(path.dirname(agentsFile(home)), { recursive: true });
    writeFileSync(agentsFile(home), JSON.stringify({ agents: ["omp"] }), "utf8");

    const result = run(home, ["doctor"]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toMatch(/OpenCode RTK plugin/);
    expect(result.stdout).not.toMatch(/OpenCode rtk guidance/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("doctor still reports OpenCode rows when the host is selected", () => {
  const home = tempHome();
  try {
    seedHosts(home, ["omp", "opencode"]);
    mkdirSync(path.dirname(agentsFile(home)), { recursive: true });
    writeFileSync(agentsFile(home), JSON.stringify({ agents: ["omp", "opencode"] }), "utf8");

    const result = run(home, ["doctor"]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/OpenCode RTK plugin/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("an OpenCode-only run does not claim OMP was installed", () => {
  const home = tempHome();
  try {
    seedHosts(home, ["omp", "opencode"]);
    const result = run(home, ["install", "--yes", "--dry-run", "--agent", "opencode"]);

    expect(result.status, result.stderr).toBe(0);
    // The completion hint must not tell an OpenCode-only user to restart OMP.
    expect(result.stdout).toMatch(/Done — restart OpenCode\./);
    expect(result.stdout).not.toMatch(/Done — restart OMP/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("an OpenCode-only run asks no OMP-only question", () => {
  const home = tempHome();
  try {
    seedHosts(home, ["omp", "opencode"]);
    const result = run(home, ["install", "--yes", "--dry-run", "--agent", "opencode"]);

    expect(result.status, result.stderr).toBe(0);
    // combo/caveman/ponytail defaults are meaningless without the OMP host, so
    // an OpenCode-only run must not report an OMP defaults line at all.
    expect(result.stdout).not.toMatch(/Defaults: combo=/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("an OMP run still reports its combo defaults and restart hint", () => {
  const home = tempHome();
  try {
    seedHosts(home, ["omp"]);
    const result = run(home, ["install", "--yes", "--dry-run", "--agent", "omp"]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Defaults: combo=/);
    expect(result.stdout).toMatch(/Done — restart OMP, then \/combo medium\./);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
