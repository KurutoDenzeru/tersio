// Agent-neutral RTK routing: any harness that can see a tool call and replace its arguments can use this.
// Nothing here names a host; the caller passes its own id for rtk's rule set and its own tool names.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolveRtkBinary} from './utils.ts';

const execFileP = promisify(execFile);

export const RTK_REWRITE_TIMEOUT_MS = 5000;

/** The exec seam, so a host can supply its own runner (signal, sandbox, logging). */
export type RewriteExec = (
  bin: string,
  args: string[],
  opts: { timeout: number; signal?: AbortSignal; env?: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; code?: number }>;

/** A command already in rtk form must not be wrapped again. */
export function isRtkCommand(command: string): boolean {
  return /^rtk(?:\s|$)/.test(command.trim());
}

function rewriteResponse(stdout: string, code: number): string | null {
  const output = stdout.trim();
  switch (code) {
    case 0:
    case 3:
      if (!output) throw new Error(`rtk rewrite exited ${code} without a rewrite`);
      return output;
    case 1:
      if (output) throw new Error('rtk rewrite returned output with exit code 1');
      return null;
    case 2:
      throw new Error(output || 'rtk denied the command');
    default:
      throw new Error(`rtk rewrite failed with exit code ${code}`);
  }
}

function rewriteExit(error: unknown): { stdout: string; code: number } | null {
  if (!error || typeof error !== 'object' || !('code' in error) || typeof error.code !== 'number') return null;
  return {
    stdout: 'stdout' in error && typeof error.stdout === 'string' ? error.stdout : '',
    code: error.code,
  };
}

/**
 * Ask `rtk rewrite` for the routed form of one command.
 * Null means RTK explicitly found no equivalent; failures throw so callers can block.
 */
export async function rewriteThroughRtk(
  command: string,
  options: { host?: string; bin?: string | null; signal?: AbortSignal; exec?: RewriteExec } = {},
): Promise<string | null> {
  if (typeof command !== 'string' || command.trim() === '' || isRtkCommand(command)) return null;
  const bin = options.bin === undefined ? resolveRtkBinary() : options.bin;
  if (!bin) throw new Error('rtk is not installed');
  const run: RewriteExec = options.exec ?? (async (file, args, opts) => execFileP(file, args, { ...opts }));
  try {
    const result = await run(bin, ['rewrite', command], {
      timeout: RTK_REWRITE_TIMEOUT_MS,
      ...(options.signal ? { signal: options.signal } : {}),
      env: { ...process.env, ...(options.host ? { RTK_REWRITE_HOST: options.host } : {}) },
    });
    return rewriteResponse(result.stdout, result.code ?? 0);
  } catch (error) {
    const exit = rewriteExit(error);
    if (exit) return rewriteResponse(exit.stdout, exit.code);
    throw error;
  }
}

/**
 * The pure adapter every host shares: given one tool call, the routed arguments or null.
 * `rewrite` is injected so a host can test command routing without a binary.
 */
export async function rewriteToolArguments(
  toolNames: readonly string[],
  name: unknown,
  args: unknown,
  enabled: boolean,
  rewrite: (command: string) => Promise<string | null>,
): Promise<Record<string, unknown> | null> {
  if (!enabled || typeof name !== 'string' || !toolNames.includes(name)) return null;
  if (!args || typeof args !== 'object') return null;
  const command = (args as { command?: unknown }).command;
  if (typeof command !== 'string' || command.trim() === '') return null;
  if (isRtkCommand(command)) return null;
  const rewritten = await rewrite(command);
  if (!rewritten || rewritten === command) return null;
  return { ...(args as Record<string, unknown>), command: rewritten };
}

