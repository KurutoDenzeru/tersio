import { expect, test } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { apply, inject, name } from "../../extensions/dsh/index.ts";

// The DSH entry as the loader sees it: a module it imports, then applies against its context.
function tersioHome(): string {
  return process.env.TERSIO_HOME as string;
}

async function withStore(from: string, body: () => Promise<void>): Promise<void> {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-dsh-rtk-run-"));
  const previous = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, TERSIO_HOME: process.env.TERSIO_HOME };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.TERSIO_HOME = path.join(home, ".tersio");
  mkdirSync(tersioHome(), { recursive: true });
  writeFileSync(path.join(tersioHome(), "settings.json"), from, "utf8");
  try {
    await body();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(home, { recursive: true, force: true });
  }
}

type CapturedTool = {
  name: string;
  output: { schema: { type?: string } };
  execute: (args: { command: string }) => Promise<unknown>;
};

/** Registers the plugin against a stand-in context and hands back what it published. */
function captureCtx(): { tools: CapturedTool[]; sections: Array<{ name: string; text: () => string }> } {
  const tools: CapturedTool[] = [];
  const sections: Array<{ name: string; text: () => string }> = [];
  const ctx = {
    tools: { register: (tool: CapturedTool) => { tools.push(tool); return () => {}; } },
    systemPrompt: {
      section: (section: { name: string; text: string | (() => string) }) => {
        sections.push({ name: section.name, text: () => (typeof section.text === "function" ? section.text() : section.text) });
        return () => {};
      },
    },
    commands: { register: () => () => {} },
    on: () => () => {},
  };
  apply(ctx as unknown as Parameters<typeof apply>[0]);
  return { tools, sections };
}

// #93: DSH checks execute()\u2019s value against output.schema and threw "value" must be a string on every call.
test("rtk_run answers the string its own schema declares", async () => {
  await withStore(JSON.stringify({ rtkDefault: false }), async () => {
    const { tools } = captureCtx();
    const tool = tools.find((t) => t.name === "rtk_run");
    expect(tool, "the plugin must register rtk_run").toBeDefined();
    expect(tool?.output.schema.type).toBe("string");
    // rtk off runs the command plainly, which is one of the two return sites that broke.
    const value = await tool?.execute({ command: "echo hello" });
    expect(typeof value, "rtk_run returned " + JSON.stringify(value) + " and the schema says string").toBe("string");
    expect(value).toBe("hello");
  });
});

test("rtk_run keeps returning a string when the command fails", async () => {
  await withStore(JSON.stringify({ rtkDefault: false }), async () => {
    const { tools } = captureCtx();
    const value = await tools.find((t) => t.name === "rtk_run")?.execute({ command: "exit 3" });
    // The failing branch built { content } too, so it failed the same schema check.
    expect(typeof value).toBe("string");
    expect(value).not.toBe("");
  });
});

// #91: the published entry is dist/extensions/dsh/index.js, so the .md rules sit three levels up from it.
test("the mode rule bodies load from the published entry, not only from a checkout", async () => {
  const store = { cavemanDefault: "ultra", ponytailDefault: "ultra", pstackDefault: "on" };
  await withStore(JSON.stringify(store), async () => {
    const { sections } = captureCtx();
    const text = sections.find((s) => s.name === "tersio-modes")?.text() ?? "";
    expect(text.length).toBeGreaterThan(1000);
    // Each body has its own fallback sentence, and every one of them names the file it could not read.
    expect(text).not.toContain("is missing. Run: tersio doctor");
    expect(text).toContain("pstack mode active for this session");
  });
});

test("the dsh export targets the compiled entry, so Node never strips types under node_modules", () => {
  const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
    exports?: Record<string, string>;
    files?: string[];
  };
  // Node refuses type stripping for any file resolved under node_modules, so a .ts target cannot load from npm.
  for (const key of [".", "./dsh-plugin"]) {
    expect(pkg.exports?.[key], "exports[" + key + "] must target compiled JS").toBe("./dist/extensions/dsh/index.js");
  }
  // The compiled entry only exists after a build, so its TypeScript source has to ship for a fresh checkout.
  expect(pkg.files).toContain("extensions/**/*.ts");
  expect(name).toBe("tersio-dsh");
  expect(inject).toEqual(["tools", "systemPrompt", "commands"]);
});
