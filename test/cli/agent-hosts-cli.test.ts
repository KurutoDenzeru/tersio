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
      "omp", "opencode", "claude-code", "codex", "cursor", "pi",
    ]) {
      expect(result.stdout, `help does not list ${id}`).toContain(id);
    }
  } finally {
    cleanup();
  }
});

test("doctor always shows the agent-hosts category, even with none configured", () => {
  const { home, cleanup } = tempHome();
  try {
    const result = run(home, "doctor");
    expect(result.status, result.stderr).toBe(0);
    // A category that only appears once you have used it is not a category, so
    // the section is permanent and tells the user how to add one.
    expect(result.stdout).toMatch(/\nAgent hosts\n/);
    expect(result.stdout).toContain("none configured");
    expect(result.stdout).toContain("tersio install --agent <id>");
    // Every known id is listed, so the hint is actionable without --help.
    for (const id of ["claude-code", "codex", "cursor", "pi"]) {
      expect(result.stdout, `id list omits ${id}`).toContain(id);
    }
  } finally {
    cleanup();
  }
});

test("doctor reports one row per saved host and points at the install command", () => {
  const { home, cleanup } = tempHome();
  try {
    writeSelection(home, ["claude-code", "pi"]);
    const result = run(home, "doctor");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/\nAgent hosts\n/);
    expect(result.stdout).toContain("Claude Code");
    expect(result.stdout).toContain("Pi");
    // Both are uninstalled here, so both must be actionable rather than silent.
    expect(result.stdout).toMatch(/Claude Code: warn/);
    expect(result.stdout).toMatch(/tersio install --agent claude-code/);
    expect(result.stdout).toMatch(/tersio install --agent pi/);
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
    const commas = run(home, "doctor", "--agent=cursor,codex");
    const repeated = run(home, "doctor", "--agent", "cursor", "--agent", "codex");
    for (const result of [commas, repeated]) {
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("Cursor");
      expect(result.stdout).toContain("OpenAI Codex");
      expect(result.stdout).not.toContain("Claude Code");
    }
  } finally {
    cleanup();
  }
});

test("a doctor row goes healthy once the host's files are on disk", () => {
  const { home, cleanup } = tempHome();
  try {
    writeSelection(home, ["pi"]);
    // pi is a live-extension host: rules plus all three skills, and no hook.
    mkdirSync(path.join(home, ".pi/agent"), { recursive: true });
    writeFileSync(path.join(home, ".pi/agent", "AGENTS.md"), "<!-- tersio:start -->\nrules\n<!-- tersio:end -->\n", "utf8");
    for (const mode of ["caveman", "ponytail", "rtk"]) {
      const dir = path.join(home, ".pi/agent", "skills", `tersio-${mode}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "SKILL.md"), `---\nname: tersio-${mode}\ndescription: d\n---\nbody\n`, "utf8");
    }

    const result = run(home, "doctor");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Pi: ok/);
    // The row must name the owner, not claim a hook file tersio did not write.
    expect(result.stdout).toMatch(/rewrite owned by wiring/);
    expect(result.stdout).not.toMatch(/rewrite hook installed/);
  } finally {
    cleanup();
  }
});

test("a doctor row stays a warning while any of the host's files is missing", () => {
  const { home, cleanup } = tempHome();
  try {
    writeSelection(home, ["pi"]);
    mkdirSync(path.join(home, ".pi/agent"), { recursive: true });
    writeFileSync(path.join(home, ".pi/agent", "AGENTS.md"), "<!-- tersio:start -->\nr\n<!-- tersio:end -->\n", "utf8");
    // All three skills deliberately absent, so the row must stay a warning.
    const result = run(home, "doctor");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Pi: warn/);
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

test("every host reports a working rewrite class, because none is guidance-only", () => {
  const { home, cleanup } = tempHome();
  try {
    // With Pi gone, every supported host either has a static hook or
    // a named owner. So no row may ever claim "guidance only" again.
    for (const id of ["claude-code", "codex", "cursor", "pi", "opencode"]) {
      const result = run(home, "doctor", "--agent", id);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout, `${id} reported guidance only`).not.toMatch(/guidance only/);
    }
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
    writeSelection(home, ["claude-code", "pi", "cursor"]);
    const after = run(home, "doctor");
    // The empty-category hint is not a check, so only the three real rows join
    // the tally.
    expect(checkCount(before.stdout)).toBeGreaterThan(0);
    expect(checkCount(after.stdout), "three host rows should join the tally").toBe(checkCount(before.stdout) + 3);
  } finally {
    cleanup();
  }
});

test("a selection file full of junk leaves the category empty rather than broken", () => {
  const { home, cleanup } = tempHome();
  try {
    mkdirSync(path.join(home, ".tersio"), { recursive: true });
    writeFileSync(path.join(home, ".tersio", "agents.json"), "{ not json at all", "utf8");
    const result = run(home, "doctor");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Summary: \d+ checks/);
    expect(result.stdout).toContain("none configured");
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
