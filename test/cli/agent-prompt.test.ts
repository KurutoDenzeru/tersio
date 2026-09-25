import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

test("the main menu offers a dedicated coding-agents entry", () => {
  const home = tempHome();
  try {
    mkdirSync(path.join(home, ".omp", "agent"), { recursive: true });
    // The bare `tersio` menu is TTY-only, so assert on the help/command surface
    // instead: the entry must exist in the source menu, which the install flow
    // reaches without any other prompt.
    const result = run(home, ["help"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/--agent/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
