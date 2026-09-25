// Tersio OpenCode plugin — RTK shell-command rewrite.
//
// Plugin API broke between 1.x and 2.x: this shape default-exports a definition
// with `id` + `setup(ctx)`, and hooks register on the owning domain. Old-shape
// plugins do not load, and after 1.18.x they fail silently. Verified on 2.0.16.
//
// Rewrite rules live in the rtk binary, so upgrades need no plugin edit.
// `rtk rewrite` exit: 0 rewritten, 1 no equivalent, 3 rewritten with a warning —
// branch on stdout, never the code. Fail-open on any failure. Types are
// structural so the file loads with no node_modules in the config dir.

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
