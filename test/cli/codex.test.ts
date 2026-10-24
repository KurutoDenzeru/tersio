import { expect, test, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CODEX_BUNDLED_PLUGIN_FILES, CODEX_MARKETPLACE_PLUGIN_FILES, addCodexPersonalMarketplace, codexInstalledPlugin,
  codexMarketplacePluginFiles, codexModeContext, codexPersonalPluginId, codexPluginFiles, codexPluginInstalled,
  codexPluginState, removeCodexPersonalMarketplace,
} from "../../extensions/shared/codex-plugin.ts";
import { cliEnv } from "../helpers/env.ts";

async function withHome<T>(fn: (home: string) => T | Promise<T>, options: { codexDir?: boolean } = {}): Promise<T> {
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-codex-"));
  const previous = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, TERSIO_HOME: process.env.TERSIO_HOME };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.TERSIO_HOME = path.join(home, ".tersio");
  if (options.codexDir) mkdirSync(path.join(home, ".codex"), { recursive: true });
  try {
    return await fn(home);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(home, { recursive: true, force: true });
  }
}

async function homeModules(): Promise<{
  detectHosts: typeof import("../../cli/hosts.ts").detectHosts;
  hostOfSessionFile: typeof import("../../extensions/shared/usage-ledger.ts").hostOfSessionFile;
  newSessionAccum: typeof import("../../extensions/shared/usage-ledger.ts").newSessionAccum;
  processSessionText: typeof import("../../extensions/shared/usage-ledger.ts").processSessionText;
  sessionsDirs: typeof import("../../extensions/shared/usage-ledger.ts").sessionsDirs;
}> {
  vi.resetModules();
  const hosts = await import("../../cli/hosts.ts");
  const ledger = await import("../../extensions/shared/usage-ledger.ts");
  return { ...hosts, ...ledger };
}

test("the Codex plugin carries a tested hook manifest and a bundled launcher", () => {
  const files = codexPluginFiles();
  const manifest = JSON.parse(files[".codex-plugin/plugin.json"]) as { hooks?: string; mcpServers?: string; skills?: string };
  expect(manifest.hooks).toBe("./hooks/hooks.json");
  expect(manifest.mcpServers).toBe("./.mcp.json");
  expect(manifest.skills).toBe("./skills/");
  const hooks = JSON.parse(files["hooks/hooks.json"]) as { hooks?: Record<string, unknown> };
  // One prompt hook owns the mode block; one PreToolUse hook owns the rtk rewrite.
  expect(Object.keys(hooks.hooks ?? {})).toEqual(["UserPromptSubmit", "PreToolUse"]);
  const mcp = JSON.parse(files[".mcp.json"]) as { mcpServers?: { tersio?: { env?: Record<string, string> } } };
  expect(mcp.mcpServers?.tersio?.env?.TERSIO_MCP_RUNTIME).toBe("node");
  expect(files.tersio).toMatch(/dist\/tersio\.js/);
  expect(JSON.parse(files["hooks/hooks.json"])).toMatchObject({
    hooks: { UserPromptSubmit: [{ hooks: [{ command: `"${process.execPath}" "\${PLUGIN_ROOT}/tersio" codex-hook user-prompt-submit` }] }] },
  });
  expect(JSON.parse(files["hooks/hooks.json"])).toMatchObject({
    hooks: { PreToolUse: [{ matcher: "^Bash$", hooks: [{ command: `"${process.execPath}" "\${PLUGIN_ROOT}/tersio" codex-hook pre-tool-use` }] }] },
  });
  const bundledMcp = JSON.parse(files[".mcp.json"]) as {
    mcpServers?: { tersio?: { command?: string; args?: string[] } };
  };
  expect(bundledMcp.mcpServers?.tersio).toEqual({
    command: process.execPath,
    args: ["${PLUGIN_ROOT}/tersio", "mcp"],
    env: { TERSIO_MCP_RUNTIME: "node" },
  });
  const installedMcp = JSON.parse(codexPluginFiles(true, process.execPath, "/cache/tersio")[".mcp.json"]) as {
    mcpServers?: { tersio?: { args?: string[] } };
  };
  expect(installedMcp.mcpServers?.tersio?.args).toEqual(["/cache/tersio", "mcp"]);
});

test("the marketplace plugin uses the current Tersio CLI on PATH", () => {
  const files = codexMarketplacePluginFiles();
  const mcp = JSON.parse(files[".mcp.json"]) as {
    mcpServers?: { tersio?: { command?: string; args?: string[] } };
  };
  const hooks = JSON.parse(files["hooks/hooks.json"]) as {
    hooks?: { UserPromptSubmit?: Array<{ hooks?: Array<{ command?: string }> }> };
  };
  expect(mcp.mcpServers?.tersio).toEqual({
    command: "tersio",
    args: ["mcp"],
    env: { TERSIO_MCP_RUNTIME: "node" },
  });
  expect(hooks.hooks?.UserPromptSubmit?.[0]?.hooks?.[0]?.command).toBe("tersio codex-hook user-prompt-submit");
  expect(files.tersio).toBeUndefined();
  expect(files["dist/tersio.js"]).toBeUndefined();
});

test("the personal marketplace keeps unrelated plugins and removes only Tersio", () => {
  const existing = JSON.stringify({
    name: "personal",
    interface: { displayName: "My plugins" },
    plugins: [{ name: "other", source: { source: "local", path: "./other" } }],
  });
  const added = JSON.parse(addCodexPersonalMarketplace(existing)) as {
    name?: string;
    plugins?: Array<{ name?: string; source?: { path?: string } }>;
  };
  expect(added.name).toBe("personal");
  expect(added.plugins?.map((plugin) => plugin.name)).toEqual(["other", "tersio"]);
  expect(added.plugins?.[1]?.source?.path).toBe("./.tersio/codex-plugin");
  const removed = JSON.parse(removeCodexPersonalMarketplace(JSON.stringify(added)) ?? "null") as {
    plugins?: Array<{ name?: string }>;
  };
  expect(removed.plugins?.map((plugin) => plugin.name)).toEqual(["other"]);
  expect(removeCodexPersonalMarketplace(JSON.stringify({ name: "personal", plugins: [added.plugins?.[1]] }))).toBeNull();
});

test("an empty personal marketplace uses its own name", () => {
  const added = JSON.parse(addCodexPersonalMarketplace(null)) as { name?: string };
  expect(added.name).toBe("tersio-personal");
});

test("Codex mode context follows the stored defaults and leaves off modes out", async () => {
  await withHome((home) => {
    mkdirSync(path.join(home, ".tersio"), { recursive: true });
    writeFileSync(path.join(home, ".tersio", "settings.json"), JSON.stringify({
      cavemanDefault: "lite",
      ponytailDefault: "off",
      pstackDefault: "off",
      rtkDefault: false,
    }), "utf8");
    const context = codexModeContext();
    expect(context).toMatch(/Caveman lite active/);
    expect(context).not.toMatch(/PONYTAIL MODE ACTIVE/);
    expect(context).not.toMatch(/pstack mode active/);
  });
});

test("Codex sessions are scanned and labelled as the codex host", async () => {
  await withHome(async (home) => {
    const { hostOfSessionFile, sessionsDirs } = await homeModules();
    const dir = path.join(home, ".codex", "sessions", "2026", "10", "24");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "rollout-test.jsonl"), "", "utf8");
    expect(sessionsDirs()).toContain(path.join(home, ".codex", "sessions"));
    expect(hostOfSessionFile(path.join(dir, "rollout-test.jsonl"))).toBe("codex");
  });
});

test("the Codex hook command prints the active mode block", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const home = mkdtempSync(path.join(os.tmpdir(), "tersio-codex-hook-"));
  try {
    mkdirSync(path.join(home, ".tersio"), { recursive: true });
    writeFileSync(path.join(home, ".tersio", "settings.json"), JSON.stringify({
      cavemanDefault: "lite",
      ponytailDefault: "off",
      pstackDefault: "off",
      rtkDefault: false,
    }), "utf8");
    const result = spawnSync(process.execPath, [path.join(root, "dist", "tersio.js"), "codex-hook", "user-prompt-submit"], {
      encoding: "utf8",
      env: cliEnv(home),
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Caveman lite active/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("Codex detection needs a complete plugin, not only a Codex home", async () => {
  await withHome(async (home) => {
    const { detectHosts } = await homeModules();
    mkdirSync(path.join(home, ".codex"), { recursive: true });
    const empty = detectHosts().find((host) => host.id === "codex");
    expect(empty?.installed).toBe(false);
    expect(empty?.declared).toBeNull();
    expect(empty?.hostPresent).toBe(true);

    const dir = path.join(home, ".codex", "plugins", "tersio");
    mkdirSync(path.join(dir, ".codex-plugin"), { recursive: true });
    writeFileSync(path.join(dir, ".codex-plugin", "plugin.json"), codexPluginFiles()[".codex-plugin/plugin.json"], "utf8");
    expect(codexPluginInstalled(dir)).toBe(false);
  }, { codexDir: true });
});

test("Codex detection reads the marketplace cache version", async () => {
  await withHome(async (home) => {
    const { detectHosts } = await homeModules();
    const dir = path.join(home, ".codex", "plugins", "cache", "tersio", "tersio", "9.8.7");
    for (const [file, text] of Object.entries(codexPluginFiles())) {
      const target = path.join(dir, ...file.split("/"));
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, text, "utf8");
    }
    for (const file of CODEX_BUNDLED_PLUGIN_FILES) {
      const target = path.join(dir, ...file.split("/"));
      if (existsSync(target)) continue;
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, "fixture", "utf8");
    }
    const manifestPath = path.join(dir, ".codex-plugin", "plugin.json");
    writeFileSync(manifestPath, JSON.stringify({ name: "tersio", version: "9.8.7" }), "utf8");
    expect(codexInstalledPlugin()).toEqual({ dir, version: "9.8.7", layout: "marketplace" });
    mkdirSync(path.join(home, ".codex"), { recursive: true });
    writeFileSync(path.join(home, ".codex", "config.toml"), '[plugins."tersio@tersio"]\nenabled = true\n', "utf8");
    const codex = detectHosts().find((host) => host.id === "codex");
    expect(codex?.installed).toBe(true);
    expect(codex?.version).toBe("9.8.7");
    expect(codex?.dir).toBe(dir);
  }, { codexDir: true });
});

test("a marketplace cache is complete with its five manifest files", async () => {
  await withHome((home) => {
    const dir = path.join(home, ".codex", "plugins", "cache", "tersio", "tersio", "9.8.7");
    for (const file of CODEX_MARKETPLACE_PLUGIN_FILES) {
      const target = path.join(dir, ...file.split("/"));
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, file === ".codex-plugin/plugin.json"
        ? JSON.stringify({ name: "tersio", version: "9.8.7" })
        : "fixture", "utf8");
    }
    expect(codexPluginInstalled(dir)).toBe(true);
    expect(codexInstalledPlugin()).toEqual({ dir, version: "9.8.7", layout: "marketplace" });
  }, { codexDir: true });
});

test("the local fallback marketplace ID follows an existing marketplace name", () => {
  const existing = JSON.stringify({ name: "my-market", plugins: [] });
  expect(codexPersonalPluginId(existing)).toBe("tersio@my-market");
  expect(codexPersonalPluginId(null)).toBe("tersio@tersio-personal");
});

test("Codex token rows become codex host rows with model and cache usage", async () => {
  const { newSessionAccum, processSessionText } = await import("../../extensions/shared/usage-ledger.ts");
  const accum = newSessionAccum();
  const state = { codexProvider: null as string | null, codexModel: null as string | null };
  const rows = [
    { timestamp: "2026-10-24T01:00:00.000Z", type: "session_meta", payload: { model_provider: "openai" } },
    { timestamp: "2026-10-24T01:00:01.000Z", type: "turn_context", payload: { model: "gpt-6-luna" } },
    {
      timestamp: "2026-10-24T01:00:02.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          last_token_usage: {
            input_tokens: 100,
            cached_input_tokens: 40,
            output_tokens: 10,
            cache_write_input_tokens: 5,
          },
        },
      },
    },
  ];
  processSessionText(accum, state, rows.map((row) => JSON.stringify(row)).join("\n"), "codex");
  expect(accum.messages).toBe(1);
  expect(accum.totals.input).toBe(100);
  expect(accum.totals.cacheRead).toBe(40);
  expect(accum.totals.output).toBe(10);
  expect(accum.byHost["codex/openai/gpt-6-luna"]?.codex.input).toBe(100);
  expect(Object.keys(accum.byModel)).toEqual(["codex/openai/gpt-6-luna"]);
});

test("Codex transcripts gain tool calls, shell facts, and turn timing", async () => {
  const { newSessionAccum, processSessionText } = await import("../../extensions/shared/usage-ledger.ts");
  const accum = newSessionAccum();
  const state = { codexProvider: null as string | null, codexModel: null as string | null };
  const turn = "turn-1";
  const rows = [
    { timestamp: "2026-10-24T01:00:00.000Z", type: "session_meta", payload: { model_provider: "openai" } },
    { timestamp: "2026-10-24T01:00:01.000Z", type: "turn_context", payload: { model: "gpt-6-luna", turn_id: turn } },
    {
      timestamp: "2026-10-24T01:00:02.000Z",
      type: "response_item",
      payload: { type: "custom_tool_call", call_id: "call_1", name: "exec", input: "printf hello" },
    },
    {
      timestamp: "2026-10-24T01:00:03.000Z",
      type: "event_msg",
      payload: { type: "item_completed", turn_id: turn, item: { type: "CommandExecution", command: ["/bin/zsh", "-lc", "printf hello"], exit_code: 0, duration_secs: 0.1 } },
    },
    {
      timestamp: "2026-10-24T01:00:04.000Z",
      type: "response_item",
      payload: { type: "custom_tool_call_output", call_id: "call_1", output: [{ type: "input_text", text: "hello" }] },
    },
    {
      timestamp: "2026-10-24T01:00:05.000Z",
      type: "event_msg",
      payload: { type: "token_count", info: { last_token_usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 10, cache_write_input_tokens: 5 } } },
    },
    {
      timestamp: "2026-10-24T01:00:06.000Z",
      type: "event_msg",
      payload: { type: "task_complete", turn_id: turn, duration_ms: 5470, time_to_first_token_ms: 3846 },
    },
  ];
  processSessionText(accum, state, rows.map((row) => JSON.stringify(row)).join("\n"), "codex");
  expect(accum.messages).toBe(1);
  const recent = accum.recent[0];
  expect(recent.d).toBe(5470);
  expect(recent.tf).toBe(3846);
  // The shell fact names the script's lead binary; the tool call reads as the exec surface.
  expect(accum.toolFacts.map((f) => f.n)).toEqual(["bash:printf", "bash"]);
  expect(accum.toolFacts[0]).toMatchObject({ a: "printf hello".length, e: 0 });
  expect(accum.toolFacts[1]).toMatchObject({ a: "printf hello".length, r: "hello".length, e: 0 });
});

test("the repository marketplace package matches the generated plugin contract", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const marketplace = JSON.parse(readFileSync(path.join(root, ".agents", "plugins", "marketplace.json"), "utf8")) as {
    name?: string;
    plugins?: Array<{ name?: string; source?: { path?: string } }>;
  };
  expect(marketplace.name).toBe("tersio");
  expect(marketplace.plugins?.[0]?.name).toBe("tersio");
  expect(marketplace.plugins?.[0]?.source?.path).toBe("./plugins/tersio");
  const manifest = JSON.parse(readFileSync(path.join(root, "plugins", "tersio", ".codex-plugin", "plugin.json"), "utf8")) as {
    version?: string;
    hooks?: string;
    [key: string]: unknown;
  };
  const generated = JSON.parse(codexPluginFiles()[".codex-plugin/plugin.json"]) as {
    version?: string;
    hooks?: string;
    [key: string]: unknown;
  };
  expect(manifest.version).toBe(generated.version);
  expect(manifest.hooks).toBe("./hooks/hooks.json");
  expect(manifest).toEqual(generated);
  expect(existsSync(path.join(root, "plugins", "tersio", "skills", "status", "SKILL.md"))).toBe(true);
  const packageJson = JSON.parse(readFileSync(path.join(root, "plugins", "tersio", "package.json"), "utf8")) as {
    name?: string;
    version?: string;
  };
  expect(packageJson.name).toBe("@krtclcdy/tersio-codex-plugin");
  expect(packageJson.version).toBe(generated.version);
});

test("a partial marketplace cache is reported as an enabled plugin with missing files", async () => {
  await withHome((home) => {
    const dir = path.join(home, ".codex", "plugins", "cache", "tersio", "tersio", "9.8.7");
    const files = codexMarketplacePluginFiles();
    for (const [file, text] of Object.entries(files)) {
      if (file === "hooks/hooks.json") continue;
      const target = path.join(dir, ...file.split("/"));
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, text, "utf8");
    }
    writeFileSync(path.join(home, ".codex", "config.toml"), '[plugins."tersio@tersio"]\nenabled = true\n', "utf8");
    const state = codexPluginState(dir);
    expect(state.complete).toBe(false);
    expect(state.enabled).toBe(true);
    expect(state.pluginId).toBe("tersio@tersio");
    expect(state.missing).toEqual(["hooks/hooks.json"]);
  }, { codexDir: true });
});

test("the repository marketplace plugin runs the installed Tersio CLI", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const mcp = JSON.parse(readFileSync(path.join(root, "plugins", "tersio", ".mcp.json"), "utf8")) as {
    mcpServers?: { tersio?: { command?: string; args?: string[] } };
  };
  const hooks = JSON.parse(readFileSync(path.join(root, "plugins", "tersio", "hooks", "hooks.json"), "utf8")) as {
    hooks?: { UserPromptSubmit?: Array<{ hooks?: Array<{ command?: string }> }> };
  };
  expect(mcp.mcpServers?.tersio?.command).toBe("tersio");
  expect(mcp.mcpServers?.tersio?.args).toEqual(["mcp"]);
  expect(hooks.hooks?.UserPromptSubmit?.[0]?.hooks?.[0]?.command).toBe("tersio codex-hook user-prompt-submit");
});
