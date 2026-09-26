import { expect, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  installOpenCodeRtk,
  openCodeAgentsPath,
  openCodeConfigDir,
  openCodePluginInstalled,
  openCodePluginPath,
  removeOpenCodeRtk,
} from "../../cli/opencode-wiring.ts";
import { START, END } from "../../cli/rules-pack.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PLUGIN_SOURCE = path.join(root, "extensions", "opencode", "rtk-plugin.ts");

function tempHome(): { home: string; cleanup: () => void } {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-oc-"));
  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

// The plugin is written verbatim into the user's config dir, where there is no
// node_modules, so it must be self-contained and must load on its own.
test("the shipped plugin is self-contained and uses the v2 shape", () => {
  const src = readFileSync(PLUGIN_SOURCE, "utf8");
  // The v2 contract: default-export a definition with id + setup(ctx).
  expect(src).toContain("export default plugin");
  expect(src).toMatch(/id:\s*'tersio-rtk'/);
  expect(src).toMatch(/async setup\(ctx\)/);
  expect(src).toContain("ctx.tool.hook('execute.before'");
  // Nothing may be imported but node builtins, or it cannot load there.
  const imports = [...src.matchAll(/^import .* from ['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  for (const spec of imports) {
    expect(spec, `imports ${spec}, which will not resolve in a config dir`).toMatch(/^node:/);
  }
});

test("the plugin avoids the two pre-v2 shapes that current OpenCode rejects", () => {
  const src = readFileSync(PLUGIN_SOURCE, "utf8");
  // rtk's own plugin uses these; each one is a load failure on v2.
  expect(src, "old package name").not.toContain("@opencode-ai/plugin");
  expect(src, "old named-export shape").not.toMatch(/export const \w+: Plugin/);
  expect(src, "old string-keyed hook").not.toContain('"tool.execute.before"');
  // The removed bun `$` shell.
  expect(src, "uses the removed bun shell").not.toMatch(/\$\s*`/);
});

test("installing writes the plugin where OpenCode v2 looks for it", async () => {
  const { home, cleanup } = tempHome();
  try {
    const src = readFileSync(PLUGIN_SOURCE, "utf8");
    const changed = await installOpenCodeRtk(home, src, { quiet: true });
    expect(changed).toBe(true);
    expect(openCodePluginPath(home)).toBe(path.join(home, ".config", "opencode", "plugins", "tersio-rtk.ts"));
    expect(existsSync(openCodePluginPath(home))).toBe(true);
    expect(await openCodePluginInstalled(home)).toBe(true);
    expect(readFileSync(openCodePluginPath(home), "utf8")).toBe(src);
  } finally {
    cleanup();
  }
});

test("reinstalling the same plugin writes nothing and leaves no backup", async () => {
  const { home, cleanup } = tempHome();
  try {
    const src = readFileSync(PLUGIN_SOURCE, "utf8");
    await installOpenCodeRtk(home, src, { quiet: true });
    const second = await installOpenCodeRtk(home, src, { quiet: true });
    expect(second, "idempotent reinstall should report no change").toBe(false);
    expect(existsSync(`${openCodePluginPath(home)}.bak`)).toBe(false);
  } finally {
    cleanup();
  }
});

test("a dry run writes nothing at all", async () => {
  const { home, cleanup } = tempHome();
  try {
    const src = readFileSync(PLUGIN_SOURCE, "utf8");
    const changed = await installOpenCodeRtk(home, src, { dryRun: true, quiet: true });
    expect(changed).toBe(true);
    expect(existsSync(openCodePluginPath(home))).toBe(false);
    expect(existsSync(openCodeConfigDir(home))).toBe(false);
  } finally {
    cleanup();
  }
});

test("uninstall removes the plugin and its backup, and reports when there was nothing", async () => {
  const { home, cleanup } = tempHome();
  try {
    const src = readFileSync(PLUGIN_SOURCE, "utf8");
    expect(await removeOpenCodeRtk(home, { quiet: true }), "nothing installed yet").toBe(false);
    await installOpenCodeRtk(home, src, { quiet: true });
    // Simulate a rewrite that left a backup behind.
    writeFileSync(`${openCodePluginPath(home)}.bak`, src, "utf8");

    expect(await removeOpenCodeRtk(home, { quiet: true })).toBe(true);
    expect(existsSync(openCodePluginPath(home))).toBe(false);
    expect(existsSync(`${openCodePluginPath(home)}.bak`)).toBe(false);
    expect(await removeOpenCodeRtk(home, { quiet: true })).toBe(false);
  } finally {
    cleanup();
  }
});

test("uninstalling under a dry run leaves the plugin in place", async () => {
  const { home, cleanup } = tempHome();
  try {
    const src = readFileSync(PLUGIN_SOURCE, "utf8");
    await installOpenCodeRtk(home, src, { quiet: true });
    expect(await removeOpenCodeRtk(home, { dryRun: true, quiet: true })).toBe(true);
    expect(existsSync(openCodePluginPath(home))).toBe(true);
  } finally {
    cleanup();
  }
});

test("the rules pack merges into the user's own global AGENTS.md", async () => {
  const { home, cleanup } = tempHome();
  try {
    // The generic emitters own AGENTS.md, so the wiring must not touch it.
    await installOpenCodeRtk(home, readFileSync(PLUGIN_SOURCE, "utf8"), { quiet: true });
    const agents = openCodeAgentsPath(home);
    expect(existsSync(agents), "wiring must not write AGENTS.md").toBe(false);

    // When the generic emitter does write it, the markers are where the rules
    // pack expects them.
    const written = `# my opencode notes\n\n${START}\nrules\n${END}\n`;
    mkdirSync(path.dirname(agents), { recursive: true });
    writeFileSync(agents, written, "utf8");
    expect(readFileSync(agents, "utf8")).toContain("my opencode notes");
  } finally {
    cleanup();
  }
});
