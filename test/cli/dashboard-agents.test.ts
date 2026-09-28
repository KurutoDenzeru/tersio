import { expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { agentsJson } from "../../cli/dashboard.ts";
import { HOSTS } from "../../cli/agent-hosts.ts";
import { PI_EXTENSION_DIRS, PI_MODULE_DIRS } from "../../cli/pi-layer.ts";
import { writeSelection } from "../../cli/agents.ts";

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
  binPath: string | null;
  version: string | null;
}

async function rows(home: string, env: NodeJS.ProcessEnv = { PATH: "" }): Promise<Row[]> {
  return (await agentsJson(home, env)) as unknown as Row[];
}

// Writes a complete pi install: the extension tree, which is all pi owns.
function installPiFully(home: string): void {
  // The whole layer, not just the five extensions: a real install writes the shared modules beside them, and a partial tree...
  for (const dir of [...PI_EXTENSION_DIRS, ...PI_MODULE_DIRS]) {
    const target = path.join(home, ".pi/agent/extensions", dir);
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, "index.ts"), "export default {};\n", "utf8");
  }
}

test("the Connection pane lists every supported agent, not just one", async () => {
  const { home, cleanup } = tempHome();
  try {
    expect((await rows(home)).map((r) => r.id)).toEqual(HOSTS.map((h) => h.id));
  } finally {
    cleanup();
  }
});

test("with nothing selected, every agent except OMP reads as not selected", async () => {
  const { home, cleanup } = tempHome();
  try {
    for (const r of await rows(home)) {
      if (r.id === "omp") continue;
      expect(r.selected, r.id).toBe(false);
      expect(r.configured, r.id).toBe(false);
    }
  } finally {
    cleanup();
  }
});

test("the OMP row reflects the OMP install, not agents.json", async () => {
  // OMP is installed by its own plugin path and never lands in agents.json, so it used to read "Not selected" right next to...
  const { home, cleanup } = tempHome();
  try {
    const bare = (await rows(home)).find((r) => r.id === "omp")!;
    expect(bare.selected, "OMP is always in scope").toBe(true);
    expect(bare.configured, "nothing installed yet").toBe(false);

    mkdirSync(path.join(home, ".omp", "agent", "extensions"), { recursive: true });
    writeFileSync(path.join(home, ".omp", "agent", "extensions", "rtk.ts"), "export default {}\n", "utf8");

    const wired = (await rows(home)).find((r) => r.id === "omp")!;
    expect(wired.configured, "the rtk extension is on disk").toBe(true);
    expect(wired.present).toBe(1);
  } finally {
    cleanup();
  }
});

test("every row carries the binary path, so an installed host is verifiable", async () => {
  const { home, cleanup } = tempHome();
  try {
    for (const r of await rows(home)) {
      // Nothing is on PATH in the sandbox, so every row must report a path rather than a stale one or an omitted field.
      expect(r, `${r.id} has no binPath field`).toHaveProperty("binPath");
      expect(r.binPath, `${r.id} resolved a binary in an empty PATH`).toBeNull();
      expect(r, `${r.id} has no version field`).toHaveProperty("version");
      expect(r.version, `${r.id} reported a version with no binary`).toBeNull();
    }
  } finally {
    cleanup();
  }
});

test("a selected agent is not called configured until its tree is on disk", async () => {
  const { home, cleanup } = tempHome();
  try {
    writeSelection(home, ["pi"]);
    const row = (await rows(home)).find((r) => r.id === "pi")!;
    expect(row.selected).toBe(true);
    expect(row.configured, "selected but nothing installed yet").toBe(false);
    expect(row.missing).toBeGreaterThan(0);
  } finally {
    cleanup();
  }
});

test("a fully installed agent reports configured with nothing missing", async () => {
  const { home, cleanup } = tempHome();
  try {
    writeSelection(home, ["pi"]);
    installPiFully(home);

    const row = (await rows(home)).find((r) => r.id === "pi")!;
    expect(row.selected).toBe(true);
    // The tree is the only thing pi installs, so the badge is judged on it: a half-written tree is not a configured host.
    expect(row.missing).toBe(0);
    expect(row.present).toBe(PI_EXTENSION_DIRS.length + PI_MODULE_DIRS.length);
    expect(row.configured, "a full layer is a configured host").toBe(true);
  } finally {
    cleanup();
  }
});

test("a partially installed agent counts what is present, so the gap is visible", async () => {
  const { home, cleanup } = tempHome();
  try {
    writeSelection(home, ["pi"]);
    // One extension of the tree and none of the shared modules, so the gap is visible in the layer rather than in a file list.
    const partial = path.join(home, ".pi/agent/extensions", PI_EXTENSION_DIRS[0]);
    mkdirSync(partial, { recursive: true });
    writeFileSync(path.join(partial, "index.ts"), "export default {};\n", "utf8");

    const row = (await rows(home)).find((r) => r.id === "pi")!;
    expect(row.configured, "a partial layer is not a configured host").toBe(false);
  } finally {
    cleanup();
  }
});

test("each row names the wiring the installer would give that host", async () => {
  const { home, cleanup } = tempHome();
  try {
    const byId = new Map((await rows(home)).map((r) => [r.id, r.wiring]));
    for (const id of HOSTS.map((h) => h.id)) {
      expect(byId.get(id), `${id} names no wiring`).toMatch(/rtk extension · auto-rewrite/);
    }
    // No supported host is guidance-only, so the hint must never say so.
    for (const hint of byId.values()) {
      expect(hint).not.toBe("guidance only · no auto-rewrite");
    }
  } finally {
    cleanup();
  }
});

test("a corrupt selection file degrades to nothing rather than throwing", async () => {
  const { home, cleanup } = tempHome();
  try {
    mkdirSync(path.join(home, ".tersio"), { recursive: true });
    writeFileSync(path.join(home, ".tersio", "agents.json"), "{ not json", "utf8");
    const list = await rows(home);
    expect(list).toHaveLength(HOSTS.length);
    expect(list.filter((r) => r.id !== "omp").every((r) => !r.selected)).toBe(true);
  } finally {
    cleanup();
  }
});
