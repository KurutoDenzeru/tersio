import { expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionApi } from "../../extensions/shared/types.ts";

/**
 * Every extension the OMP plugin manifest lists must load and register its
 * command. A load-time throw takes the whole extension down silently — OMP
 * lists the plugin as present, and the user only discovers it when a slash
 * command does nothing.
 *
 * This caught `RtkRelease` imported as a value rather than a type in the
 * /ai-addons updater: the interface is erased at build but kept in the emitted
 * ESM, so Node threw "does not provide an export named 'RtkRelease'".
 */

const root = new URL("../../", import.meta.url).pathname;

type Chain = Record<string, unknown>;
const chain = (): Chain => {
  const self: Chain = {};
  self.min = () => self;
  self.describe = () => self;
  self.array = () => self;
  self.object = () => self;
  self.string = () => self;
  return self;
};

/** Minimal OMP ExtensionAPI. zod is real: rtk-session destructures pi.zod. */
function stubPi() {
  const commands: string[] = [];
  const tools: string[] = [];
  const events: string[] = [];
  const z = { object: chain, array: chain, string: chain };
  const api = {
    on: (e: string) => { events.push(e); return () => {}; },
    registerCommand: (n: string) => { commands.push(n); },
    registerTool: (t: { name: string }) => { tools.push(t.name); },
    registerShortcut: () => {},
    registerFlag: () => {},
    setActiveTools: () => {},
    appendEntry: () => {},
    sendMessage: () => {},
    sendUserMessage: () => {},
    setLabel: () => {},
    onSystemPromptEvent: () => {},
    events: { on: () => () => {} },
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    cwd: root,
    setStatus: () => {},
    zod: { z },
  };
  return { api: api as unknown as ExtensionApi, commands, tools, events };
}

const EXPECTED = [
  { dir: "caveman-session", command: "caveman" },
  { dir: "rtk-session", command: "rtk" },
  { dir: "combo-toggle", command: "combo" },
  { dir: "tersio-commands", command: "tersio" },
  { dir: "ai-addons-updater", command: "ai-addons" },
];

/**
 * Loads each entry point the way OMP does: raw Node against the `.ts` file.
 *
 * A vitest import would prove nothing here. Vitest's transform erases
 * type-only imports, so a value import of an interface still loads under the
 * test runner and only fails in OMP, which uses jiti. Spawning `node` is the
 * only way to see the failure this guards against.
 */
function loadViaNode(dir: string): { ok: boolean; detail: string } {
  const res = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", `import(${JSON.stringify(pathToFileURL(path.join(root, "extensions", dir, "index.ts")).href)}).then(m=>{if(typeof m.default!=="function"){console.log("NO_DEFAULT");process.exit(2)}console.log("LOADED")}).catch(e=>{console.log("FAIL:"+String(e.message).split("\\n")[0]);process.exit(3)})`],
    { encoding: "utf8", cwd: root, timeout: 60000 },
  );
  const out = (res.stdout || "").trim();
  if (out === "LOADED") return { ok: true, detail: "" };
  return { ok: false, detail: out || res.stderr || `exit ${res.status}` };
}

for (const { dir } of EXPECTED) {
  test(`${dir} loads as raw TypeScript and exports a factory`, () => {
    const { ok, detail } = loadViaNode(dir);
    expect(ok, `${dir} failed to load: ${detail}`).toBe(true);
  });
}

for (const { dir, command } of EXPECTED) {
  test(`${dir} registers /${command}`, async () => {
    const mod = await import(`../../extensions/${dir}/index.ts`);
    const pi = stubPi();
    await (mod.default as (pi: ExtensionApi) => void | Promise<void>)(pi.api);
    expect(pi.commands, `${dir} must register /${command}`).toContain(command);
  });
}

test("rtk-session registers the rtk_run tool", async () => {
  const mod = await import("../../extensions/rtk-session/index.ts");
  const pi = stubPi();
  await (mod.default as (pi: ExtensionApi) => void | Promise<void>)(pi.api);
  expect(pi.tools, "rtk-session must register rtk_run").toContain("rtk_run");
});

interface OmpManifest {
  omp: { extensions: string[]; features: Record<string, { extensions?: string[] }> };
}

test("the OMP manifest lists every extension that has a slash command", () => {
  // Read with fs rather than `import("../../package.json")`: the repo-integrity
  // guard requires every relative import in a tracked source to resolve to a
  // .ts file, and a JSON manifest never can. That guard is right — a broken
  // import must not reach a fresh clone — so this file stays clear of it.
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as unknown as OmpManifest;
  const declared: string[] = [...pkg.omp.extensions, ...(pkg.omp.features.updater.extensions ?? [])];
  // Every command above needs its file listed, or OMP never loads it.
  for (const { dir } of EXPECTED) {
    expect(declared.some((e) => e.includes(`/${dir}/`)), `${dir} is missing from the omp manifest`).toBe(true);
  }
});
