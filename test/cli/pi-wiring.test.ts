// The Pi extension layer, as the CLI writes it: the layout Pi loads, every module resolving from where it lands, and a...
import { expect, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  installPiTersio,
  piExtensionDir,
  piTersioInstalled,
  removePiTersio,
  type PiTree,
} from "../../cli/pi-wiring.ts";
import {
  PI_EXTENSION_DIRS,
  PI_MODULE_DIRS,
  piExtensionTargets,
  piLayer,
  reportPiLayer,
} from "../../cli/pi-layer.ts";
import { rewritePortImports } from "../../cli/layer.ts";

const EXT = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..", "extensions");
const PI = path.join(EXT, "pi");

// The list cli/install.ts builds, rebuilt from the same layer constants.
function sources(): Array<[string, string]> {
  const pairs: Array<[string, string]> = [
    [path.join(PI, "shared", "pi-types.ts"), "shared/pi-types.ts"],
    [path.join(PI, "shared", "pi-session-state.ts"), "shared/pi-session-state.ts"],
    [path.join(EXT, "shared", "session-state.ts"), "shared/session-state.ts"],
    [path.join(EXT, "shared", "types.ts"), "shared/types.ts"],
    [path.join(EXT, "shared", "plugin-settings.ts"), "shared/plugin-settings.ts"],
    [path.join(EXT, "shared", "usage-ledger.ts"), "shared/usage-ledger.ts"],
    [path.join(EXT, "shared", "pricing.ts"), "shared/pricing.ts"],
    [path.join(EXT, "shared", "carbon.ts"), "shared/carbon.ts"],
    [path.join(EXT, "lib", "utils.ts"), "lib/utils.ts"],
  ];
  for (const dir of PI_EXTENSION_DIRS) pairs.push([path.join(PI, dir, "index.ts"), `${dir}/index.ts`]);
  return pairs;
}

function tree(): PiTree {
  return { sources: sources(), rules: [["caveman-session", "full rule text\n"]] };
}

function tempHome(): { home: string; cleanup: () => void } {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-pi-"));
  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

test("the layer puts an entry point in every extension dir and in no module dir", () => {
  const { home, cleanup } = tempHome();
  const previous = process.env.PI_CODING_AGENT_DIR;
  delete process.env.PI_CODING_AGENT_DIR;
  try {
    const layer = piLayer(home);
    // An index.ts in shared/ or lib/ would make Pi load a helper module as an extension.
    for (const dir of PI_MODULE_DIRS) {
      expect(layer.installed.some((e) => e.path === path.join(layer.extDir, dir))).toBe(false);
    }
    expect(layer.installed.map((e) => path.basename(e.path))).toEqual([...PI_EXTENSION_DIRS]);
    expect(piExtensionTargets(layer)).toHaveLength(PI_EXTENSION_DIRS.length + PI_MODULE_DIRS.length);
  } finally {
    if (previous !== undefined) process.env.PI_CODING_AGENT_DIR = previous;
    cleanup();
  }
});

test("the agent dir follows PI_CODING_AGENT_DIR, the way Pi resolves it", () => {
  const { home, cleanup } = tempHome();
  const previous = process.env.PI_CODING_AGENT_DIR;
  try {
    delete process.env.PI_CODING_AGENT_DIR;
    expect(piExtensionDir(home)).toBe(path.join(home, ".pi", "agent", "extensions"));
    process.env.PI_CODING_AGENT_DIR = "/tmp/pi-elsewhere";
    expect(piExtensionDir(home)).toBe("/tmp/pi-elsewhere/extensions");
    process.env.PI_CODING_AGENT_DIR = "   ";
    expect(piExtensionDir(home)).toBe(path.join(home, ".pi", "agent", "extensions"));
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    cleanup();
  }
});

test("installing writes the whole tree, beside the rule, and a second run writes nothing", async () => {
  const { home, cleanup } = tempHome();
  const previous = process.env.PI_CODING_AGENT_DIR;
  delete process.env.PI_CODING_AGENT_DIR;
  try {
    const written = await installPiTersio(home, tree(), { quiet: true });
    expect(written).toHaveLength(sources().length + 1);
    for (const dir of PI_EXTENSION_DIRS) {
      expect(existsSync(path.join(piExtensionDir(home), dir, "index.ts"))).toBe(true);
    }
    expect(readFileSync(path.join(piExtensionDir(home), "caveman-session", "rule.md"), "utf8")).toBe("full rule text\n");
    expect(await piTersioInstalled(home)).toBe(true);

    expect(await installPiTersio(home, tree(), { quiet: true })).toHaveLength(0);
    expect(existsSync(path.join(piExtensionDir(home), "caveman-session", "index.ts.bak"))).toBe(false);
  } finally {
    if (previous !== undefined) process.env.PI_CODING_AGENT_DIR = previous;
    cleanup();
  }
});

test("every installed module loads from where it lands, not from the repo", async () => {
  const { home, cleanup } = tempHome();
  const previous = process.env.PI_CODING_AGENT_DIR;
  delete process.env.PI_CODING_AGENT_DIR;
  try {
    await installPiTersio(home, tree(), { quiet: true });
    const extDir = piExtensionDir(home);
    for (const dir of PI_EXTENSION_DIRS) {
      // Dynamic: the specifier is a runtime path into the installed tree, which no static import could name.
      const mod = await import(path.join(extDir, dir, "index.ts"));
      expect(typeof mod.default, `${dir} must default-export a factory`).toBe("function");
    }
  } finally {
    if (previous !== undefined) process.env.PI_CODING_AGENT_DIR = previous;
    cleanup();
  }
});

test("a dry run writes nothing and says what it would write", async () => {
  const { home, cleanup } = tempHome();
  const previous = process.env.PI_CODING_AGENT_DIR;
  delete process.env.PI_CODING_AGENT_DIR;
  const lines: string[] = [];
  const realLog = console.log;
  console.log = (line: string) => lines.push(line);
  try {
    const written = await installPiTersio(home, tree(), { dryRun: true, quiet: true });
    expect(written.length).toBeGreaterThan(0);
    for (const dir of PI_EXTENSION_DIRS) {
      expect(existsSync(path.join(piExtensionDir(home), dir))).toBe(false);
    }
    expect(await piTersioInstalled(home)).toBe(false);
  } finally {
    console.log = realLog;
    if (previous !== undefined) process.env.PI_CODING_AGENT_DIR = previous;
    cleanup();
  }
});

test("a missing source is named by its path in the tree, never by the build machine's path", async () => {
  const { home, cleanup } = tempHome();
  const previous = process.env.PI_CODING_AGENT_DIR;
  delete process.env.PI_CODING_AGENT_DIR;
  const lines: string[] = [];
  const realLog = console.log;
  console.log = (line: string) => lines.push(line);
  try {
    await installPiTersio(home, {
      sources: [[path.join(home, "nowhere", "caveman-session", "index.ts"), "caveman-session/index.ts"]],
      rules: [],
    }, { quiet: false });
    expect(lines.join("\n")).toContain("caveman-session/index.ts");
    expect(lines.join("\n")).not.toContain(EXT);
  } finally {
    console.log = realLog;
    if (previous !== undefined) process.env.PI_CODING_AGENT_DIR = previous;
    cleanup();
  }
});

test("removal takes every layer directory, the legacy flat module, and rtk's own wiring", async () => {
  const { home, cleanup } = tempHome();
  const previous = process.env.PI_CODING_AGENT_DIR;
  delete process.env.PI_CODING_AGENT_DIR;
  try {
    await installPiTersio(home, tree(), { quiet: true });
    const extDir = piExtensionDir(home);
    writeFileSync(path.join(extDir, "tersio.ts"), "// old\n", "utf8");
    writeFileSync(path.join(extDir, "rtk.ts"), "// rtk's\n", "utf8");

    expect(await removePiTersio(home, { quiet: true })).toBe(true);
    for (const dir of piExtensionTargets(piLayer(home))) expect(existsSync(dir)).toBe(false);
    expect(existsSync(path.join(extDir, "tersio.ts"))).toBe(false);
    expect(existsSync(path.join(extDir, "rtk.ts")), "rtk's wiring is not ours to delete").toBe(true);
    expect(await piTersioInstalled(home)).toBe(false);
    expect(await removePiTersio(home, { quiet: true })).toBe(false);
  } finally {
    if (previous !== undefined) process.env.PI_CODING_AGENT_DIR = previous;
    cleanup();
  }
});

test("a dry-run removal reports the tree without deleting it", async () => {
  const { home, cleanup } = tempHome();
  const previous = process.env.PI_CODING_AGENT_DIR;
  delete process.env.PI_CODING_AGENT_DIR;
  try {
    await installPiTersio(home, tree(), { quiet: true });
    expect(await removePiTersio(home, { dryRun: true, quiet: true })).toBe(true);
    for (const dir of piExtensionTargets(piLayer(home))) expect(existsSync(dir)).toBe(true);
  } finally {
    if (previous !== undefined) process.env.PI_CODING_AGENT_DIR = previous;
    cleanup();
  }
});

test("the report distinguishes what is on disk from what the layer lists", () => {
  const { home, cleanup } = tempHome();
  const previous = process.env.PI_CODING_AGENT_DIR;
  delete process.env.PI_CODING_AGENT_DIR;
  try {
    const empty = reportPiLayer(home, () => false);
    expect(empty.installed).toBe(false);
    expect(empty.extensions).toHaveLength(0);
    expect(empty.missing.length).toBeGreaterThan(0);

    const extDir = piExtensionDir(home);
    mkdirSync(path.join(extDir, "caveman-session"), { recursive: true });
    const partial = reportPiLayer(home, (p) => existsSync(p));
    expect(partial.installed).toBe(true);
    expect(partial.extensions.map((e) => path.basename(e.path))).toEqual(["caveman-session"]);
  } finally {
    if (previous !== undefined) process.env.PI_CODING_AGENT_DIR = previous;
    cleanup();
  }
});

test("a port import is rewritten for the installed depth, and nothing else is", () => {
  expect(rewritePortImports(`import { a } from '../../shared/session-state.ts';`))
    .toBe(`import { a } from '../shared/session-state.ts';`);
  expect(rewritePortImports(`import { b } from '../../lib/utils.ts';`))
    .toBe(`import { b } from '../lib/utils.ts';`);
  // A Pi-owned module in the port's own shared/ is already at installed depth.
  expect(rewritePortImports(`import type { C } from '../shared/pi-types.ts';`))
    .toBe(`import type { C } from '../shared/pi-types.ts';`);
  // A bare specifier and a relative path inside a string are not imports.
  expect(rewritePortImports(`const x = "../../lib/";`)).toBe(`const x = "../../lib/";`);
});
