import { expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { agentsJson } from "../../cli/dashboard.ts";
import { HOSTS } from "../../cli/agent-hosts.ts";
import { writeSelection } from "../../cli/agents.ts";
import { START, END } from "../../cli/rules-pack.ts";

function tempHome(): { home: string; cleanup: () => void } {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-dash-agents-"));
  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

interface Row {
  id: string;
  label: string;
  selected: boolean;
  configured: boolean;
  missing: number;
  present: number;
  wiring: string;
}

function rows(home: string): Row[] {
  return agentsJson(home) as unknown as Row[];
}

test("the Connection pane lists every supported agent, not just one", () => {
  const { home, cleanup } = tempHome();
  try {
    expect(rows(home).map((r) => r.id)).toEqual(HOSTS.map((h) => h.id));
  } finally {
    cleanup();
  }
});

test("with nothing selected, every agent except OMP reads as not selected", () => {
  const { home, cleanup } = tempHome();
  try {
    for (const r of rows(home)) {
      if (r.id === "omp") continue;
      expect(r.selected, r.id).toBe(false);
      expect(r.configured, r.id).toBe(false);
    }
  } finally {
    cleanup();
  }
});

test("the OMP row reflects the OMP install, not agents.json", () => {
  // OMP is installed by its own plugin path and never lands in agents.json, so
  // it used to read "Not selected" right next to a detected omp binary. It is
  // always part of an install, and configured only once something is on disk.
  const { home, cleanup } = tempHome();
  try {
    const bare = rows(home).find((r) => r.id === "omp")!;
    expect(bare.selected, "OMP is always in scope").toBe(true);
    expect(bare.configured, "nothing installed yet").toBe(false);

    mkdirSync(path.join(home, ".omp", "agent", "extensions"), { recursive: true });
    writeFileSync(path.join(home, ".omp", "agent", "extensions", "rtk.ts"), "export default {}\n", "utf8");

    const wired = rows(home).find((r) => r.id === "omp")!;
    expect(wired.configured, "the rtk extension is on disk").toBe(true);
    expect(wired.present).toBe(1);
  } finally {
    cleanup();
  }
});

test("a selected agent is not called configured until its files are on disk", () => {
  const { home, cleanup } = tempHome();
  try {
    writeSelection(home, ["claude-code"]);
    const row = rows(home).find((r) => r.id === "claude-code")!;
    expect(row.selected).toBe(true);
    expect(row.configured, "selected but nothing installed yet").toBe(false);
    expect(row.missing).toBeGreaterThan(0);
  } finally {
    cleanup();
  }
});

test("a fully installed agent reports configured with nothing missing", () => {
  const { home, cleanup } = tempHome();
  try {
    writeSelection(home, ["agy"]);
    // agy needs a global GEMINI.md plus three skills, and has no hook file.
    mkdirSync(path.join(home, ".gemini"), { recursive: true });
    writeFileSync(
      path.join(home, ".gemini", "GEMINI.md"),
      `# mine\n\n${START}\nrules\n${END}\n`,
      "utf8",
    );
    for (const mode of ["caveman", "ponytail", "rtk"]) {
      const dir = path.join(home, ".gemini", "antigravity-cli", "skills", `tersio-${mode}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "SKILL.md"), `---\nname: tersio-${mode}\ndescription: d\n---\n`, "utf8");
    }

    const row = rows(home).find((r) => r.id === "agy")!;
    expect(row.selected).toBe(true);
    expect(row.missing).toBe(0);
    expect(row.present).toBe(4);
    expect(row.configured).toBe(true);
  } finally {
    cleanup();
  }
});

test("a partially installed agent counts what is present, so the gap is visible", () => {
  const { home, cleanup } = tempHome();
  try {
    writeSelection(home, ["agy"]);
    mkdirSync(path.join(home, ".gemini"), { recursive: true });
    writeFileSync(path.join(home, ".gemini", "GEMINI.md"), `${START}\nr\n${END}\n`, "utf8");

    const row = rows(home).find((r) => r.id === "agy")!;
    expect(row.present).toBe(1);
    expect(row.missing).toBe(3);
    expect(row.configured).toBe(false);
  } finally {
    cleanup();
  }
});

test("each row names the wiring the installer would give that host", () => {
  const { home, cleanup } = tempHome();
  try {
    const byId = new Map(rows(home).map((r) => [r.id, r.wiring]));
    expect(byId.get("claude-code")).toMatch(/hook · auto-rewrite/);
    expect(byId.get("opencode")).toMatch(/plugin · auto-rewrite/);
    expect(byId.get("pi")).toMatch(/rtk extension · auto-rewrite/);
    expect(byId.get("agy")).toBe("guidance only · no auto-rewrite");
  } finally {
    cleanup();
  }
});

test("a corrupt selection file degrades to nothing rather than throwing", () => {
  const { home, cleanup } = tempHome();
  try {
    mkdirSync(path.join(home, ".tersio"), { recursive: true });
    writeFileSync(path.join(home, ".tersio", "agents.json"), "{ not json", "utf8");
    const list = rows(home);
    expect(list).toHaveLength(HOSTS.length);
    expect(list.filter((r) => r.id !== "omp").every((r) => !r.selected)).toBe(true);
  } finally {
    cleanup();
  }
});
