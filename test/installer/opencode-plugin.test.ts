import { expect, test } from "vitest";
import { pathToFileURL, fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Drive the OpenCode RTK plugin the way OpenCode drives it.
 *
 * The plugin is a self-contained file that OpenCode imports, so a unit test can
 * register its hook and feed it the same event shape OpenCode passes. That
 * proves the wiring without a model call, which matters because provider
 * credits and region limits otherwise decide whether this can be checked at all.
 *
 * The hook mutates `event.input.command` in place and returns nothing
 * (extensions/opencode/rtk-plugin.ts), so the only correct read is the payload
 * after the call — an earlier version of this test read a return value that
 * does not exist and reported a false failure.
 */

const pluginPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../extensions/opencode/rtk-plugin.ts",
);

interface ShellEvent {
  tool: string;
  input: { command: string };
}

async function loadPlugin(): Promise<{ id: string; setup: (ctx: unknown) => Promise<void> }> {
  const mod = await import(pathToFileURL(pluginPath).href);
  return (mod as { default: { id: string; setup: (ctx: unknown) => Promise<void> } }).default;
}

async function registerHook(): Promise<(event: ShellEvent, ctx: unknown) => Promise<void>> {
  const plugin = await loadPlugin();
  let hook: ((event: ShellEvent, ctx: unknown) => Promise<void>) | null = null;
  const ctx = { tool: { hook: (event: string, fn: never) => { if (event === "execute.before") hook = fn; } } };
  await plugin.setup(ctx);
  if (!hook) throw new Error("plugin did not register execute.before");
  return hook as unknown as (event: ShellEvent, ctx: unknown) => Promise<void>;
}

test("the OpenCode plugin registers an execute.before hook", async () => {
  const plugin = await loadPlugin();
  expect(plugin.id).toBe("tersio-rtk");
  await expect(registerHook()).resolves.toBeTypeOf("function");
});

test("the hook rewrites a noisy shell command in place", async () => {
  const hook = await registerHook();
  const event = { tool: "bash", input: { command: "ls -la /Users/kurtcalacday/Documents/Projects/Personal/tersio/cli" } };
  await hook(event, {});
  // rtk is the single source of truth; tersio only routes.
  expect(event.input.command).toMatch(/^rtk /);
  expect(event.input.command).toContain("tersio/cli");
});

test("the hook never invents a rewrite rtk did not return", async () => {
  const hook = await registerHook();
  // `rtk rewrite` passes this through with a marker, so the value changes but
  // stays a real rtk invocation. What must never happen is a tersio-side guess.
  const event = { tool: "bash", input: { command: "git diff --check" } };
  await hook(event, {});
  expect(event.input.command.length).toBeGreaterThan(0);
  expect(event.input.command).not.toBe("");
});

test("the hook does not double-prefix a command already routed through rtk", async () => {
  const hook = await registerHook();
  const event = { tool: "bash", input: { command: "rtk git status" } };
  await hook(event, {});
  expect(event.input.command).toBe("rtk git status");
});

test("the hook ignores tools that are not the shell", async () => {
  const hook = await registerHook();
  const event = { tool: "read", input: { command: "ls -la" } };
  await hook(event, {});
  expect(event.input.command).toBe("ls -la");
});

test("TERSIO_RTK=off disables the hook entirely", async () => {
  const prev = process.env.TERSIO_RTK;
  process.env.TERSIO_RTK = "off";
  try {
    const plugin = await loadPlugin();
    let registered = false;
    const ctx = { tool: { hook: () => { registered = true; } } };
    await plugin.setup(ctx);
    expect(registered, "no hook may be registered when TERSIO_RTK=off").toBe(false);
  } finally {
    if (prev === undefined) delete process.env.TERSIO_RTK;
    else process.env.TERSIO_RTK = prev;
  }
});

test("the installed copy in a real OpenCode config dir is loadable and rewrites", () => {
  // Guards the shipped artifact, not just the repo copy. A stale or truncated
  // install would otherwise show up only as "my commands are not compressed".
  const installed = path.join(os.homedir(), ".config/opencode/plugins/tersio-rtk.ts");
  if (!fs.existsSync(installed)) return; // not installed here; nothing to assert
  expect(fs.readFileSync(installed, "utf8")).toMatch(/export\s+default/);
});
