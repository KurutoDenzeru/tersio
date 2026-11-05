// Agent-neutral RTK routing: any harness that can see a tool call and replace its arguments can use this.
// Nothing here names a host; the caller passes its own id for rtk's rule set and its own tool names.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveRtkBinary } from './utils.ts';

const execFileP = promisify(execFile);

export const RTK_REWRITE_TIMEOUT_MS = 5000;

/** The exec seam, so a host can supply its own runner (signal, sandbox, logging). */
export type RewriteExec = (
  bin: string,
  args: string[],
  opts: { timeout: number; signal?: AbortSignal; env?: NodeJS.ProcessEnv },
) => Promise<{ stdout: string }>;

/** A command already in rtk form must not be wrapped again. */
export function isRtkCommand(command: string): boolean {
  return /^rtk(?:\s|$)/.test(command.trim());
}

/**
 * Ask `rtk rewrite` for the routed form of one command.
 * Null means "leave it alone": no binary, no rewrite, a deny rule, or any failure.
 */
export async function rewriteThroughRtk(
  command: string,
  options: { host?: string; bin?: string | null; signal?: AbortSignal; exec?: RewriteExec } = {},
): Promise<string | null> {
  if (typeof command !== 'string' || command.trim() === '' || isRtkCommand(command)) return null;
  const bin = options.bin === undefined ? resolveRtkBinary() : options.bin;
  if (!bin) return null;
  const run: RewriteExec = options.exec ?? (async (file, args, opts) => execFileP(file, args, { ...opts }));
  try {
    const result = await run(bin, ['rewrite', command], {
      timeout: RTK_REWRITE_TIMEOUT_MS,
      ...(options.signal ? { signal: options.signal } : {}),
      env: { ...process.env, ...(options.host ? { RTK_REWRITE_HOST: options.host } : {}) },
    });
    return result.stdout.trim() || null;
  } catch (error) {
    // rtk exits 3 when it rewrote the command but an ask rule matched; 1 and 2 mean passthrough or deny.
    const failed = error as { code?: number; stdout?: string };
    return failed.code === 3 && failed.stdout?.trim() ? failed.stdout.trim() : null;
  }
}

/**
 * The pure adapter every host shares: given one tool call, the routed arguments or null.
 * `rewrite` is injected so the decision is testable without a binary.
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
  const rewritten = await rewrite(command).catch(() => null);
  if (!rewritten || rewritten === command) return null;
  return { ...(args as Record<string, unknown>), command: rewritten };
}
