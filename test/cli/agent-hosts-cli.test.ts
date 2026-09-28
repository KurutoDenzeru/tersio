import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const installer = path.join(root, "tersio.js");

// Command-level coverage for the host wiring: argv -> selection -> files on
// disk -> doctor row. The unit suite in agents.test.ts proves the filesystem
// behaviour directly; this proves the commands reach it.

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

/** Creates every directory Pi's extension tree is made of. */
function seedPiTree(home: string): void {
  for (const dir of [
    "caveman-session", "rtk-session", "ai-addons-updater", "combo-toggle", "tersio-commands", "shared", "lib",
  ]) {
    mkdirSync(path.join(home, ".pi", "agent", "extensions", dir), { recursive: true });
  }
}

test("--agent is listed in help with every known host id", () => {
  const { home, cleanup } = tempHome();
  try {
    const result = run(home, "help");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/--agent <ids>/);
    for (const id of ["omp", "pi"]) {
      expect(result.stdout, `help does not list ${id}`).toContain(id);
    }
    for (const id of ["opencode", "claude-code", "codex"]) {
      expect(result.stdout, `help still advertises ${id}`).not.toContain(id);
    }
  } finally {
    cleanup();
  }
});

test("doctor always shows the agent-hosts category, even with none installed", () => {
  const { home, cleanup } = tempHome();
  try {
    const result = run(home, "doctor");
    expect(result.status, result.stderr).toBe(0);
    // A category that only appears once you have used it is not a category, so
    // the section is permanent and tells the user how to add one.
    expect(result.stdout).toMatch(/\nAgent hosts\n/);
    expect(result.stdout).toContain("none installed");
    expect(result.stdout).toContain("tersio install --agent <id>");
  } finally {
    cleanup();
  }
});

test("doctor reports one row per saved host and points at the install command", () => {
  const { home, cleanup } = tempHome();
  try {
    writeSelection(home, ["pi"]);
    const result = run(home, "doctor");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/\nAgent hosts\n/);
    expect(result.stdout).toMatch(/Pi: warn/);
    expect(result.stdout).toMatch(/tersio install --agent pi/);
    // The row is a warning here because the tree is not on disk, and the count
    // is directories: neither host ships static files any more.
    expect(result.stdout).toMatch(/7 of 7 extension\/module/);
  } finally {
    cleanup();
  }
});

test("an --agent flag on doctor overrides the saved selection", () => {
  const { home, cleanup } = tempHome();
  try {
    writeSelection(home, ["pi"]);
    const result = run(home, "doctor", "--agent", "omp");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Oh My Pi (OMP)");
    expect(result.stdout).not.toMatch(/\n\s*Pi: /);
  } finally {
    cleanup();
  }
});

test("--agent accepts both comma-separated and repeated forms", () => {
  const { home, cleanup } = tempHome();
  try {
    const commas = run(home, "doctor", "--agent=omp,pi");
    const repeated = run(home, "doctor", "--agent", "omp", "--agent", "pi");
    for (const result of [commas, repeated]) {
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("Oh My Pi (OMP)");
      expect(result.stdout).toMatch(/\bPi: /);
    }
  } finally {
    cleanup();
  }
});

test("a doctor row goes healthy once the host's extension tree is on disk", () => {
  const { home, cleanup } = tempHome();
  try {
    writeSelection(home, ["pi"]);
    seedPiTree(home);

    const result = run(home, "doctor");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Pi: ok/);
    // The row names the rewrite's real owner instead of a hook file tersio
    // does not write.
    expect(result.stdout).toMatch(/rewrite via rtk extension/);
  } finally {
    cleanup();
  }
});

test("a doctor row stays a warning while the tree is only half written", () => {
  const { home, cleanup } = tempHome();
  try {
    writeSelection(home, ["pi"]);
    mkdirSync(path.join(home, ".pi", "agent", "extensions", "caveman-session"), { recursive: true });

    const result = run(home, "doctor");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Pi: warn/);
    expect(result.stdout).toMatch(/6 of 7 extension\/module/);
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
    writeSelection(home, ["omp", "pi"]);
    const after = run(home, "doctor");
    // The empty-category hint is not a check, so only the two real rows join
    // the tally.
    expect(checkCount(before.stdout)).toBeGreaterThan(0);
    expect(checkCount(after.stdout), "two host rows should join the tally").toBe(checkCount(before.stdout) + 2);
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
    expect(result.stdout).toContain("none installed");
  } finally {
    cleanup();
  }
});

test("uninstall --dry-run names the earlier-release paths without touching disk", () => {
  const { home, cleanup } = tempHome();
  try {
    writeSelection(home, ["pi"]);
    const rules = path.join(home, ".pi", "agent", "AGENTS.md");
    mkdirSync(path.dirname(rules), { recursive: true });
    writeFileSync(rules, "# mine\n\n<!-- tersio:start -->\nr\n<!-- tersio:end -->\n", "utf8");

    const result = run(home, "uninstall", "--agent", "pi", "--dry-run", "--yes", "--verbose");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/\.pi\/agent\/AGENTS\.md \(earlier release\)/);
    expect(result.stdout).toMatch(/\[dry-run\] would remove/);
    // The file must survive a dry run untouched.
    expect(readFileSync(rules, "utf8")).toContain("# mine");
  } finally {
    cleanup();
  }
});

test("uninstall strips our block and keeps the user's own text", () => {
  const { home, cleanup } = tempHome();
  try {
    writeSelection(home, ["pi"]);
    const rules = path.join(home, ".pi", "agent", "AGENTS.md");
    mkdirSync(path.dirname(rules), { recursive: true });
    writeFileSync(rules, "# mine\n\n<!-- tersio:start -->\nr\n<!-- tersio:end -->\n", "utf8");
    seedPiTree(home);

    const result = run(home, "uninstall", "--agent", "pi", "--yes");
    expect(result.status, result.stderr).toBe(0);
    const after = readFileSync(rules, "utf8");
    expect(after).not.toContain("tersio:start");
    expect(after).toContain("# mine");
    expect(existsSync(path.join(home, ".pi", "agent", "extensions", "caveman-session"))).toBe(false);
  } finally {
    cleanup();
  }
});
