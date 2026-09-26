import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const installer = path.join(root, "tersio.js");

// Command-level coverage for the multi-host wiring: argv -> selection ->
// files on disk -> doctor row. The unit suite in agents.test.ts proves the
// filesystem behaviour directly; this proves the three commands reach it.

function tempHome(): { home: string; cleanup: () => void } {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-cli-hosts-"));
  // An empty bin keeps the real rtk (and any host binary) off the probe path,
  // so detection cannot pick up the developer's own machine.
  mkdirSync(path.join(home, "empty-bin"), { recursive: true });
  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

function run(home: string, ...args: string[]) {
  return spawnSync(process.execPath, [installer, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 20000,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      PATH: path.join(home, "empty-bin"),
    },
  });
}

function writeSelection(home: string, hosts: string[]): void {
  mkdirSync(path.join(home, ".tersio"), { recursive: true });
  writeFileSync(path.join(home, ".tersio", "agents.json"), JSON.stringify({ hosts, updatedAt: 1 }), "utf8");
}

test("--agent is listed in help with every known host id", () => {
  const { home, cleanup } = tempHome();
  try {
    const result = run(home, "help");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/--agent <ids>/);
    for (const id of [
      "omp", "opencode", "claude-code", "codex", "copilot-cli", "cursor",
      "grok-build", "pi", "openclaw", "hermes", "command-code", "agy",
    ]) {
      expect(result.stdout, `help does not list ${id}`).toContain(id);
    }
  } finally {
    cleanup();
  }
});

test("doctor stays silent about agent hosts when none is selected", () => {
  const { home, cleanup } = tempHome();
  try {
    const result = run(home, "doctor");
    expect(result.status, result.stderr).toBe(0);
    // An OMP-only install must see exactly the output it had before this
    // feature existed.
    expect(result.stdout).not.toContain("Agent hosts");
  } finally {
    cleanup();
  }
});

test("doctor reports one row per saved host and points at the install command", () => {
  const { home, cleanup } = tempHome();
  try {
    writeSelection(home, ["claude-code", "agy"]);
    const result = run(home, "doctor");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/\nAgent hosts\n/);
    expect(result.stdout).toContain("Claude Code");
    expect(result.stdout).toContain("Antigravity CLI");
    // Both are uninstalled here, so both must be actionable rather than silent.
    expect(result.stdout).toMatch(/Claude Code: warn/);
    expect(result.stdout).toMatch(/tersio install --agent claude-code/);
    expect(result.stdout).toMatch(/tersio install --agent agy/);
  } finally {
    cleanup();
  }
});

test("an --agent flag on doctor overrides the saved selection", () => {
  const { home, cleanup } = tempHome();
  try {
    writeSelection(home, ["claude-code"]);
    const result = run(home, "doctor", "--agent", "cursor");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Cursor");
    expect(result.stdout).not.toContain("Claude Code");
  } finally {
    cleanup();
  }
});

test("--agent accepts both comma-separated and repeated forms", () => {
  const { home, cleanup } = tempHome();
  try {
    writeSelection(home, ["claude-code"]);
    const commas = run(home, "doctor", "--agent=cursor,agy");
    const repeated = run(home, "doctor", "--agent", "cursor", "--agent", "agy");
    for (const result of [commas, repeated]) {
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("Cursor");
      expect(result.stdout).toContain("Antigravity CLI");
      expect(result.stdout).not.toContain("Claude Code");
    }
  } finally {
    cleanup();
  }
});

test("a doctor row goes healthy once the host's files are on disk", () => {
  const { home, cleanup } = tempHome();
  try {
    writeSelection(home, ["agy"]);
    // agy is guidance-only: rules plus all three skills, and no hook to fake.
    mkdirSync(path.join(home, ".gemini"), { recursive: true });
    writeFileSync(path.join(home, ".gemini", "GEMINI.md"), "<!-- tersio:start -->\nrules\n<!-- tersio:end -->\n", "utf8");
    for (const mode of ["caveman", "ponytail", "rtk"]) {
      const dir = path.join(home, ".gemini", "antigravity-cli", "skills", `tersio-${mode}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "SKILL.md"), `---\nname: tersio-${mode}\ndescription: d\n---\nbody\n`, "utf8");
    }

    const result = run(home, "doctor");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Antigravity CLI: ok/);
    // The row must say guidance, not claim a rewrite hook was installed.
    expect(result.stdout).toMatch(/guidance only/);
  } finally {
    cleanup();
  }
});

test("a doctor row stays a warning while any of the host's files is missing", () => {
  const { home, cleanup } = tempHome();
  try {
    writeSelection(home, ["agy"]);
    mkdirSync(path.join(home, ".gemini"), { recursive: true });
    writeFileSync(path.join(home, ".gemini", "GEMINI.md"), "<!-- tersio:start -->\nr\n<!-- tersio:end -->\n", "utf8");
    // All three skills deliberately absent, so the row must stay a warning.
    const result = run(home, "doctor");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Antigravity CLI: warn/);
    expect(result.stdout).toMatch(/3 file\(s\) missing/);
  } finally {
    cleanup();
  }
});

test("a wired live-extension host says who owns its rewrite instead of claiming a hook", () => {
  const { home, cleanup } = tempHome();
  try {
    // pi is wired by rtk's own init, so it gets rules + skills and no static
    // hook from tersio.
    writeSelection(home, ["pi"]);
    mkdirSync(path.join(home, ".pi", "agent"), { recursive: true });
    writeFileSync(path.join(home, ".pi", "agent", "AGENTS.md"), "<!-- tersio:start -->\nr\n<!-- tersio:end -->\n", "utf8");
    for (const mode of ["caveman", "ponytail", "rtk"]) {
      const dir = path.join(home, ".pi", "agent", "skills", `tersio-${mode}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "SKILL.md"), `---\nname: tersio-${mode}\ndescription: d\n---\n`, "utf8");
    }
    const result = run(home, "doctor");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Pi: ok/);
    expect(result.stdout).toMatch(/rewrite owned by wiring/);
  } finally {
    cleanup();
  }
});

test("a host whose rewrite is pending is reported as guidance, never as wired", () => {
  const { home, cleanup } = tempHome();
  try {
    // command-code supports a mod, but tersio ships none yet, so the row must
    // not imply a working auto-rewrite.
    writeSelection(home, ["command-code"]);
    mkdirSync(path.join(home, ".commandcode"), { recursive: true });
    writeFileSync(path.join(home, ".commandcode", "AGENTS.md"), "<!-- tersio:start -->\nr\n<!-- tersio:end -->\n", "utf8");
    for (const mode of ["caveman", "ponytail", "rtk"]) {
      const dir = path.join(home, ".commandcode", "skills", `tersio-${mode}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "SKILL.md"), `---\nname: tersio-${mode}\ndescription: d\n---\n`, "utf8");
    }
    const result = run(home, "doctor");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Command Code: ok/);
    expect(result.stdout).toMatch(/guidance only/);
    expect(result.stdout, "must not claim a rewrite it does not ship")
      .not.toMatch(/rewrite owned by mod/);
  } finally {
    cleanup();
  }
});

/** Reads the check count out of doctor's closing summary line. */
function checkCount(out: string): number {
  const m = out.match(/Summary: (\d+) checks/);
  return m ? Number(m[1]) : -1;
}

test("a host row counts toward the doctor summary tally", () => {
  const { home, cleanup } = tempHome();
  try {
    const before = run(home, "doctor");
    writeSelection(home, ["claude-code", "agy", "cursor"]);
    const after = run(home, "doctor");
    expect(checkCount(before.stdout)).toBeGreaterThan(0);
    expect(checkCount(after.stdout), "three host rows should join the tally").toBe(checkCount(before.stdout) + 3);
  } finally {
    cleanup();
  }
});

test("a selection file full of junk does not break doctor", () => {
  const { home, cleanup } = tempHome();
  try {
    mkdirSync(path.join(home, ".tersio"), { recursive: true });
    writeFileSync(path.join(home, ".tersio", "agents.json"), "{ not json at all", "utf8");
    const result = run(home, "doctor");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Summary: \d+ checks/);
    expect(result.stdout).not.toContain("Agent hosts");
  } finally {
    cleanup();
  }
});

test("uninstall --dry-run reports the agent hosts it would strip without touching disk", () => {
  const { home, cleanup } = tempHome();
  try {
    writeSelection(home, ["claude-code"]);
    const rules = path.join(home, ".claude", "CLAUDE.md");
    mkdirSync(path.dirname(rules), { recursive: true });
    writeFileSync(rules, "# mine\n\n<!-- tersio:start -->\nr\n<!-- tersio:end -->\n", "utf8");

    const result = run(home, "uninstall", "--agent", "claude-code", "--dry-run", "--yes");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/=== Agent hosts ===/);
    expect(result.stdout).toMatch(/\[dry-run\] Claude Code: would remove/);
    // The file must survive a dry run untouched.
    expect(existsSync(rules)).toBe(true);
    expect(readFileSync(rules, "utf8")).toContain("# mine");
  } finally {
    cleanup();
  }
});

test("uninstall strips our block and keeps the user's own text", () => {
  const { home, cleanup } = tempHome();
  try {
    writeSelection(home, ["claude-code"]);
    const rules = path.join(home, ".claude", "CLAUDE.md");
    mkdirSync(path.dirname(rules), { recursive: true });
    writeFileSync(rules, "# mine\n\n<!-- tersio:start -->\nr\n<!-- tersio:end -->\n", "utf8");

    const result = run(home, "uninstall", "--agent", "claude-code", "--yes");
    expect(result.status, result.stderr).toBe(0);
    const after = readFileSync(rules, "utf8");
    expect(after).not.toContain("tersio:start");
    expect(after).toContain("# mine");
  } finally {
    cleanup();
  }
});
