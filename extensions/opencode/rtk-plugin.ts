// Tersio OpenCode V2 plugin — RTK shell-command rewrite.
//
// OpenCode 2.0 replaced the V1 plugin API. A V1 plugin exports a function that
// returns a string-keyed hook object; V2 default-exports a definition with an
// `id` and `setup(ctx)`, and registers hooks on the domain that owns them. V1
// implementations do not run on V2, and a stale V1 file can also stop loading
// silently after the 1.18.x auto-discovery change. This file is V2-native.
//
// Verified against opencode v2.0.16: `ctx.tool.hook("execute.before", …)`
// fires with `event.tool === "shell"` and a mutable `event.input`; assigning a
// new `command` on it changes the command that actually executes.
//
// Rewrite rules live in the rtk binary (`rtk rewrite`), not here, so an rtk
// upgrade takes effect with no plugin edit.
//
// rtk rewrite exit contract (rtk >= 0.50):
//   0 — rewritten, stdout is the new command
//   1 — no RTK equivalent, stdout empty
//   3 — rewritten, with a shell-metacharacter warning
// Branch on stdout, never on the exit code: upstream hooks use
// `REWRITTEN=$(rtk rewrite "$CMD") || exit 0`.
//
// Fail-open: a missing binary, a spawn error, or a timeout leaves the original
// command untouched.
//
// The types below mirror `@opencode/plugin` structurally instead of importing
// it. `Plugin.define` is the identity function, so the import buys nothing at
// runtime, and a self-contained file loads in a user config dir that has no
// `node_modules` — OpenCode only auto-installs packages it finds in a
// `plugins` array or a config-directory `package.json`.

import { spawn } from 'node:child_process';

const RTK_TIMEOUT_MS = 5000;
const REWRITE_TOOLS = new Set(['bash', 'shell']);
/** Commands already routed through rtk would double-prefix on a second pass. */
const ALREADY_RTK = /(^|[\s;&|(])rtk\s/;

interface ShellToolInput {
  command: string;
}

interface ToolExecuteBeforeEvent {
  tool: string;
  input: unknown;
}

interface ToolHookContext {
  hook(name: 'execute.before', callback: (event: ToolExecuteBeforeEvent) => Promise<void> | void): Promise<unknown>;
}

interface PluginContext {
  tool: ToolHookContext;
}

interface PluginDefinition {
  id: string;
  setup(context: PluginContext): Promise<void>;
}

// `event.input` is typed `unknown` by OpenCode, so narrowing to the shell
// tool's input shape is a runtime check, not an unchecked cast.
function readCommand(input: unknown): ShellToolInput | null {
  if (typeof input !== 'object' || input === null || !('command' in input)) return null;
  const command = input.command;
  if (typeof command !== 'string' || !command.trim()) return null;
  return input as ShellToolInput;
}

function rewrite(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    let stdout = '';
    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    let child;
    try {
      child = spawn('rtk', ['rewrite', command], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      finish(null);
      return;
    }

    const timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, RTK_TIMEOUT_MS);

    child.on('error', () => finish(null));
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.on('close', () => {
      const rewritten = stdout.trim();
      finish(rewritten && rewritten !== command ? rewritten : null);
    });
  });
}

const plugin: PluginDefinition = {
  id: 'tersio-rtk',
  async setup(ctx) {
    // Escape hatch for a host where rewriting gets in the way.
    if (process.env.TERSIO_RTK === 'off') return;

    await ctx.tool.hook('execute.before', async (event) => {
      if (!REWRITE_TOOLS.has(String(event.tool).toLowerCase())) return;
      const input = readCommand(event.input);
      if (!input || ALREADY_RTK.test(input.command)) return;

      const rewritten = await rewrite(input.command);
      if (rewritten) input.command = rewritten;
    });
  },
};

export default plugin;
