import { expect, test } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { patchPonytailInjection, ponytailUsesPersistedChannel } from "../../cli/install.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const UPSTREAM = path.join(root, "node_modules", "@dietrichgebert", "ponytail");

const upstream = (): string => readFileSync(path.join(UPSTREAM, "pi-extension", "index.js"), "utf8");

test("the anchor matches the shipped Ponytail, so the patch always applies", () => {
  expect(patchPonytailInjection(upstream())).not.toBeNull();
});

test("the patch is idempotent, so a re-install cannot double-apply", () => {
  const once = patchPonytailInjection(upstream());
  expect(once).not.toBeNull();
  expect(patchPonytailInjection(once!)).toBe(once);
});

test("an unrecognised upstream handler is refused instead of half-patched", () => {
  expect(patchPonytailInjection("export default function () {}\n")).toBeNull();
});

test("the patch drops the forceSystemPrompt return that hides Ponytail from the transcript", () => {
  const patched = patchPonytailInjection(upstream());
  expect(patched).not.toBeNull();
  expect(patched).not.toMatch(/return \{ systemPrompt: `\$\{base\}\$\{instruction\}` \};\n  \}\);\n\}/);
  expect(patched).toMatch(/options\.appendSystemPrompt = /);
  expect(ponytailUsesPersistedChannel(patched!)).toBe(true);
  expect(ponytailUsesPersistedChannel(upstream())).toBe(false);
});

// The regression that motivated the patch: pi writes appendSystemPrompt into
// sections.addendum, but a returned systemPrompt becomes forceSystemPrompt and is
// never recorded. Load the real patched extension and prove it mutates the
// persisted channel instead of returning one.
test("the patched extension writes appendSystemPrompt and returns nothing", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-ponytail-channel-"));
  const previousHome = process.env.HOME;
  try {
    process.env.HOME = dir;
    process.env.USERPROFILE = dir;

    const pkg = path.join(dir, "ponytail");
    mkdirSync(pkg, { recursive: true });
    for (const rel of ["hooks", "skills"]) cpSync(path.join(UPSTREAM, rel), path.join(pkg, rel), { recursive: true });
    // No "type" field, so hooks/*.js load as CommonJS to match the shipped package.
    writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "ponytail", version: "0.0.0", private: true }));
    // pi transpiles extensions itself; .mjs is the standalone equivalent for a direct import.
    const ext = path.join(pkg, "pi-extension", "index.mjs");
    mkdirSync(path.dirname(ext), { recursive: true });
    writeFileSync(ext, patchPonytailInjection(upstream())!);

    const mod = await import(pathToFileURL(ext).href);
    const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
    mod.default({
      on(event: string, handler: (e: unknown, c: unknown) => unknown) { handlers.set(event, handler); },
      appendEntry() {},
      registerCommand() {},
      setStatus() {},
    } as never);

    await handlers.get("session_start")!({ sessionManager: { getEntries: () => [{ type: "custom", customType: "ponytail-mode", data: { mode: "full" } }] } }, { hasUI: false });

    const options = { appendSystemPrompt: "existing addendum" };
    const returned = await handlers.get("before_agent_start")!({ systemPromptOptions: options }, { hasUI: false });

    expect(returned).toBeUndefined();
    expect(options.appendSystemPrompt).toMatch(/^existing addendum\n\nPONYTAIL MODE ACTIVE — level: full/);

    // A second turn starts from the loader value, so the guard must not append twice.
    const second = { appendSystemPrompt: options.appendSystemPrompt };
    await handlers.get("before_agent_start")!({ systemPromptOptions: second }, { hasUI: false });
    expect(second.appendSystemPrompt).toBe(options.appendSystemPrompt);
  } finally {
    process.env.HOME = previousHome;
    if (previousHome === undefined) delete process.env.HOME; else process.env.USERPROFILE = previousHome;
    rmSync(dir, { recursive: true, force: true });
  }
});

// OMP has no appendSystemPrompt channel, and both the upstream extension and the
// /combo extension can inject. Handler order decides who runs first, so the second
// one has to recognise the block and stand down.
test("without the persisted channel the patch still refuses a duplicate injection", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tersio-ponytail-omp-"));
  const previousHome = process.env.HOME;
  try {
    process.env.HOME = dir;
    process.env.USERPROFILE = dir;

    const pkg = path.join(dir, "ponytail");
    mkdirSync(pkg, { recursive: true });
    for (const rel of ["hooks", "skills"]) cpSync(path.join(UPSTREAM, rel), path.join(pkg, rel), { recursive: true });
    writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "ponytail", version: "0.0.0", private: true }));
    const ext = path.join(pkg, "pi-extension", "index.mjs");
    mkdirSync(path.dirname(ext), { recursive: true });
    writeFileSync(ext, patchPonytailInjection(upstream())!);

    const mod = await import(pathToFileURL(ext).href);
    const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
    mod.default({
      on(event: string, handler: (e: unknown, c: unknown) => unknown) { handlers.set(event, handler); },
      appendEntry() {},
      registerCommand() {},
      setStatus() {},
    } as never);

    await handlers.get("session_start")!({ sessionManager: { getEntries: () => [{ type: "custom", customType: "ponytail-mode", data: { mode: "lite" } }] } }, { hasUI: false });
    const inject = handlers.get("before_agent_start")!;

    const first = await inject({ systemPrompt: "Base." }, { hasUI: false }) as { systemPrompt: string };
    expect(first.systemPrompt).toMatch(/^Base\.\n\nPONYTAIL MODE ACTIVE — level: \w+/);

    // combo-toggle ran first and already put the block in the prompt.
    expect(await inject({ systemPrompt: first.systemPrompt }, { hasUI: false })).toBeUndefined();
  } finally {
    process.env.HOME = previousHome;
    if (previousHome === undefined) delete process.env.HOME; else process.env.USERPROFILE = previousHome;
    rmSync(dir, { recursive: true, force: true });
  }
});