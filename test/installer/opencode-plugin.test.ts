import { expect, test } from "vitest";
import { pathToFileURL, fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hermeticPath, seedFakeRtk, tempHome } from "../helpers/home.ts";

/**
 * Drive the OpenCode RTK plugin the way OpenCode drives it.
 *
 * The plugin is a self-contained file OpenCode imports, so a test can register
 * its hook and feed it the event shape OpenCode passes. That proves the wiring
 * without a model call, which matters because every model available on the
 * development machine is credit-limited, region-blocked, or missing a key, so
 * a live session could not serve as evidence.
 *
 * Two things this pins, both learned the hard way:
 *
 * - The hook spawns `rtk`, so the test seeds a stub and hides the developer's
 *   binary. Without it the hook fails open, leaves the command alone, and the
 *   test passes locally while failing in CI, which has no rtk at all.
 * - The hook mutates `event.input.command` in place and returns nothing, so the
 *   only correct read is the payload after the call. Reading a return value, as
 *   a first attempt did, reports a false failure against correct code.
 */

const pluginPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../extensions/opencode/rtk-plugin.ts",
);

interface ShellEvent {
  tool: string;
  input: { command: string };
}

type Hook = (event: ShellEvent, ctx: unknown) => Promise<void>;

async function registerHook(): Promise<Hook> {
  const mod = (await import(pathToFileURL(pluginPath).href)) as {
    default: { id: string; setup: (ctx: unknown) => Promise<void> };
  };
  let hook: Hook | null = null;
  const ctx = {
    tool: {
      hook: (event: string, fn: Hook) => {
        if (event === "execute.before") hook = fn;
      },
    },
  };
  await mod.default.setup(ctx);
  if (!hook) throw new Error("plugin did not register execute.before");
  return hook;
}

/** Runs `work` with a stub rtk on PATH and the developer's rtk out of reach. */
async function withStubbedRtk<T>(work: (hook: Hook) => Promise<T>): Promise<T> {
  const home = tempHome();
  seedFakeRtk(home);
  const prevPath = process.env.PATH;
  process.env.PATH = `${path.join(home, ".bun", "bin")}${path.delimiter}${hermeticPath()}`;
  try {
    return await work(await registerHook());
  } finally {
    if (prevPath === undefined) delete process.env.PATH;
    else process.env.PATH = prevPath;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

const throughHook = async (hook: Hook, command: string): Promise<string> => {
  const event: ShellEvent = { tool: "bash", input: { command } };
  await hook(event, {});
  return event.input.command;
};

test("the plugin exposes the id OpenCode requires", async () => {
  const mod = (await import(pathToFileURL(pluginPath).href)) as { default: { id: string } };
  expect(mod.default.id).toBe("tersio-rtk");
});

test("the plugin registers an execute.before hook", async () => {
  await withStubbedRtk(async (hook) => {
    expect(hook).toBeTypeOf("function");
  });
});

test("the hook rewrites a noisy shell command in place", async () => {
  await withStubbedRtk(async (hook) => {
    const out = await throughHook(hook, "ls -la /Users/kurtcalacday/Documents/Projects/Personal/tersio/cli");
    expect(out).toMatch(/^rtk /);
    expect(out).toContain("tersio/cli");
  });
});

test("the hook does not double-prefix a command already routed through rtk", async () => {
  await withStubbedRtk(async (hook) => {
    expect(await throughHook(hook, "rtk git status")).toBe("rtk git status");
  });
});

test("the hook ignores tools that are not the shell", async () => {
  await withStubbedRtk(async (hook) => {
    const event: ShellEvent = { tool: "read", input: { command: "ls -la" } };
    await hook(event, {});
    expect(event.input.command).toBe("ls -la");
  });
});

test("the hook is inert when no rtk binary exists, failing open", async () => {
  // A machine with no rtk must still run the user's command unchanged. That is
  // the fail-open contract, and it is why a missing binary is not an error.
  const home = tempHome();
  const prevPath = process.env.PATH;
  process.env.PATH = hermeticPath();
  try {
    const hook = await registerHook();
    expect(await throughHook(hook, "ls -la /tmp")).toBe("ls -la /tmp");
  } finally {
    if (prevPath === undefined) delete process.env.PATH;
    else process.env.PATH = prevPath;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("TERSIO_RTK=off registers no hook at all", async () => {
  const prev = process.env.TERSIO_RTK;
  process.env.TERSIO_RTK = "off";
  try {
    const mod = (await import(pathToFileURL(pluginPath).href)) as {
      default: { setup: (ctx: unknown) => Promise<void> };
    };
    let registered = false;
    await mod.default.setup({ tool: { hook: () => { registered = true; } } });
    expect(registered, "no hook may be registered when TERSIO_RTK=off").toBe(false);
  } finally {
    if (prev === undefined) delete process.env.TERSIO_RTK;
    else process.env.TERSIO_RTK = prev;
  }
});

test("the copy installed in a real OpenCode config dir is loadable", () => {
  // Guards the shipped artifact, not just the repo copy. A stale or truncated
  // install would otherwise surface only as "my commands are not compressed".
  const installed = path.join(os.homedir(), ".config/opencode/plugins/tersio-rtk.ts");
  if (!fs.existsSync(installed)) return; // not installed here; nothing to assert
  expect(fs.readFileSync(installed, "utf8")).toMatch(/export\s+default/);
});
