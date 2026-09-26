// extensions/opencode/rtk-plugin.ts — Tersio's OpenCode plugin: RTK shell rewrite.
//
// Why Tersio ships its own rather than using `rtk init --opencode`: rtk 0.50.0
// emits a pre-v2 plugin that current OpenCode refuses to load. The break was
// not backward compatible, and after 1.18.x an old-shape plugin fails silently
// rather than loudly. Upstream is tracked at rtk-ai/rtk#3463; the old-format
// report is rtk-ai/rtk#3898.
//
// The v2 shape: default-export a definition with `id` + `setup(ctx)`, and
// register hooks on the owning domain. Verified against OpenCode 2.0.16.
//
// Rewrite rules live in the rtk binary, so upgrading rtk needs no plugin edit.
// `rtk rewrite` exit codes: 0 rewritten, 1 no equivalent, 3 rewritten with a
// warning -- so branch on stdout and never on the code. Fail-open throughout:
// any failure leaves the original command running.
//
// Types are structural on purpose. The file is loaded from the user's config
// dir, where there is no node_modules, so it must not import anything.
import { spawn } from 'node:child_process';

const RTK_TIMEOUT_MS = 5000;
const REWRITE_TOOLS = new Set(['bash', 'shell']);
/** A command already routed through rtk would double-prefix on a second pass. */
const ALREADY_RTK = /(^|[\s;&|(])rtk\s/;

interface ShellToolInput {
  command: string;
}

interface ToolExecuteBeforeEvent {
  tool: string;
  input: unknown;
}

interface ToolHookContext {
  hook(
    name: 'execute.before',
    callback: (event: ToolExecuteBeforeEvent) => Promise<void> | void,
  ): Promise<unknown>;
}

interface PluginContext {
  tool: ToolHookContext;
}

interface PluginDefinition {
  id: string;
  setup(context: PluginContext): Promise<void>;
}

/**
 * `event.input` is typed `unknown` by OpenCode, so narrowing to the shell
 * tool's input shape is a runtime check rather than an unchecked cast.
 */
function readCommand(input: unknown): ShellToolInput | null {
  if (typeof input !== 'object' || input === null || !('command' in input)) return null;
  const command = (input as Record<string, unknown>).command;
  if (typeof command !== 'string' || !command.trim()) return null;
  return input as ShellToolInput;
}

function rewrite(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    let stdout = '';
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(value);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('rtk', ['rewrite', command], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      finish(null);
      return;
    }

    timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, RTK_TIMEOUT_MS);

    child.on('error', () => finish(null));
    // `stdio` above asks for a pipe, but the overload leaves stdout nullable, so
    // a null there means we cannot read the rewrite. Fail open rather than
    // guess: the original command runs.
    const out = child.stdout;
    if (!out) {
      finish(null);
      return;
    }
    out.on('data', (chunk: Buffer) => {
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
