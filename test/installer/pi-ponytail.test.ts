import { expect, test } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { cliEnv } from "../helpers/env.ts";
import { TREE_FILES } from "../../cli/manifest.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const installer = path.join(root, "tersio.js");
const SELF = "@krtclcdy/tersio";

function home(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  const agent = path.join(dir, ".pi", "agent");
  mkdirSync(agent, { recursive: true });
  writeFileSync(path.join(agent, "settings.json"), JSON.stringify({ packages: ["npm:pi-subagents", "npm:@dietrichgebert/ponytail"] }, null, 2));
  return dir;
}

const offline = (dir: string): NodeJS.ProcessEnv => cliEnv(dir, { PI_OFFLINE: "1" });

test("pi install writes a local Ponytail package and drops the npm spec", () => {
  const dir = home("tersio-pi-ponytail-");
  try {
    execFileSync(process.execPath, [installer, "install", "--host", "pi", "--yes"], {
      cwd: root, encoding: "utf8", timeout: 120000, env: offline(dir),
    });

    const agent = path.join(dir, ".pi", "agent");
    const pkg = JSON.parse(readFileSync(path.join(agent, "ponytail", "package.json"), "utf8")) as { pi?: { extensions: string[] } };
    expect(pkg.pi?.extensions).toEqual(["./pi-extension/index.js"]);
    expect(readFileSync(path.join(agent, "ponytail", "pi-extension", "index.js"), "utf8")).toMatch(/getPonytailInstructions/);
    expect(readFileSync(path.join(agent, "ponytail", "skills", "ponytail", "SKILL.md"), "utf8")).toMatch(/lazy senior developer/i);

    // A local path is what stops pi version-checking the package.
    const settings = JSON.parse(readFileSync(path.join(agent, "settings.json"), "utf8")) as { packages: string[] };
    expect(settings.packages).not.toContain("npm:@dietrichgebert/ponytail");
    expect(settings.packages).toContain(path.join(agent, "ponytail"));
    expect(settings.packages).toContain("npm:pi-subagents");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 150000);

test("pi install writes every Caveman rule body", () => {
  const dir = home("tersio-pi-rules-");
  try {
    execFileSync(process.execPath, [installer, "install", "--host", "pi", "--yes"], {
      cwd: root, encoding: "utf8", timeout: 120000, env: offline(dir),
    });
    const caveman = path.join(dir, ".pi", "agent", "extensions", "caveman-session");
    for (const name of ["rule.md", "rule-ultra.md", "rule-megacave.md"]) {
      expect(readFileSync(path.join(caveman, name), "utf8"), name).toBe(readFileSync(path.join(root, "extensions", "caveman-session", name), "utf8"));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 150000);

test("pi dry-run previews the local Ponytail package without writing", () => {
  const dir = home("tersio-pi-dry-");
  try {
    const before = readFileSync(path.join(dir, ".pi", "agent", "settings.json"), "utf8");
    const out = execFileSync(process.execPath, [installer, "install", "--host", "pi", "--dry-run", "--yes"], {
      cwd: root, encoding: "utf8", timeout: 60000, env: offline(dir),
    });
    expect(out).toMatch(/Ponytail — write the local pi package/);
    expect(readFileSync(path.join(dir, ".pi", "agent", "settings.json"), "utf8")).toBe(before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 90000);

test("pi uninstall removes the local Ponytail package and its settings entry", () => {
  const dir = home("tersio-pi-uninstall-");
  try {
    const agent = path.join(dir, ".pi", "agent");
    // Host detection needs a whole tree, so seed one before the uninstall runs.
    for (const rel of TREE_FILES) {
      const to = path.join(agent, "extensions", ...rel.split("/"));
      mkdirSync(path.dirname(to), { recursive: true });
      writeFileSync(to, "");
    }
    execFileSync(process.execPath, [installer, "uninstall", "--host", "pi", "--yes"], {
      cwd: root, encoding: "utf8", timeout: 120000, env: offline(dir),
    });

    const settings = JSON.parse(readFileSync(path.join(agent, "settings.json"), "utf8")) as { packages: string[] };
    expect(settings.packages).not.toContain(path.join(agent, "ponytail"));
    expect(existsSync(path.join(agent, "ponytail"))).toBe(false);
    expect(readFileSync(path.join(agent, "settings.json"), "utf8")).not.toMatch(SELF);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 180000);
