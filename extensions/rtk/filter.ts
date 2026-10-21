// pi's built-in grep and glob never reach the bash hook; `read` is absent because rtk has no filter for it.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveRtkBinary } from '../shared/utils.ts';
import { readRtkDefault } from '../shared/plugin-settings.ts';
import { getSharedComboState, lastCustomValue, sessionEntries } from '../shared/session-state.ts';
import { appendUsage } from '../shared/usage-ledger.ts';
import { isPiHost } from '../shared/host.ts';
import type { ExtensionApi, ExtensionCtx, SessionEntry, ToolResultEvent } from '../shared/types.ts';

/** Tool name to `rtk pipe --filter` name. Exported so the OpenCode host reuses one map. */
export const FILTER_BY_TOOL = new Map([
  ['grep', 'grep'],
  ['rg', 'rg'],
  ['glob', 'find'],
  ['find', 'find'],
  ['fd', 'fd'],
]);

/** Below this the rtk spawn costs more than the filter saves. */
export const MIN_FILTER_BYTES = 1200;
const FILTER_TIMEOUT_MS = 5000;

// A shell that understands `<`, resolved per platform; separate flags, because Node quotes each argv element and cmd.exe rejects `"/d /s /c"`.
/** The pipe's shell, and whether the whole command needs an extra quote pair: `cmd.exe /s` strips the outer one, so a quoted binary and redirect path must be wrapped. */
export function filterShell(): { shell: string; flags: string[]; wrap: boolean } {
  return process.platform === 'win32'
    ? { shell: process.env.ComSpec || 'cmd.exe', flags: ['/d', '/s', '/c'], wrap: true }
    : { shell: '/bin/sh', flags: ['-c'], wrap: false };
}

export type FilterExec = (
  cmd: string,
  args: string[],
  opts?: { signal?: AbortSignal; cwd?: string; timeout?: number },
) => Promise<{ stdout: string; code: number }>;

function modeOf(value: unknown): boolean | null {
  if (value === true) return true;
  if (value === false) return false;
  return null;
}

/** True when rtk is on for the session: a persisted entry wins, then a live switch, then the configured default. */
export function rtkActive(entries: SessionEntry[] | null | undefined): boolean {
  const persisted = lastCustomValue(entries, 'rtk-mode', (data) => modeOf(data?.enabled));
  if (persisted !== null) return persisted;
  return getSharedComboState().rtk === 'on' || readRtkDefault();
}

/** The text in a result's content parts, or null when the parts are not plain text. */
export function filterableText(parts: unknown): string | null {
  if (!Array.isArray(parts) || parts.length === 0) return null;
  if (parts.some((part) => (part as { type?: unknown } | null)?.type !== 'text')) return null;
  return parts.map((part) => (part as { text?: unknown } | null)?.text ?? '').join('\n');
}

/** Pipe text through one rtk filter; null on any failure, so the caller keeps its original. */
export async function filterThroughRtk(
  exec: FilterExec,
  request: { bin: string; filter: string; text: string; signal?: AbortSignal },
): Promise<string | null> {
  const { bin, filter, text, signal } = request;
  let dir: string | undefined;
  try {
    dir = mkdtempSync(join(tmpdir(), 'tersio-rtk-'));
    const file = join(dir, 'in.txt');
    writeFileSync(file, text, 'utf8');
    // `rtk pipe` reads stdin only and execFile has no stdin, so one redirect through the platform shell.
    const { shell, flags, wrap } = filterShell();
    const line = `"${bin}" pipe -f ${filter} < "${file}"`;
    const result = await exec(shell, [...flags, wrap ? `"${line}"` : line], { signal, timeout: FILTER_TIMEOUT_MS });
    if (result.code !== 0) return null;
    const out = result.stdout;
    if (!out.trim() || out.length >= text.length) return null;
    return out;
  } catch {
    return null;
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

/** A bash tool call, before it runs. pi and omp hand the extension the mutable input. */
interface BashCallEvent {
  toolName?: unknown;
  input?: { command?: unknown };
}

/** Ask rtk for the rewritten command; null on any failure, so the original runs. */
async function rewriteCommand(
  exec: FilterExec,
  bin: string,
  command: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const result = await exec(bin, ['rewrite', command], { timeout: FILTER_TIMEOUT_MS, signal });
    const out = result.stdout.trim();
    return out || null;
  } catch {
    return null;
  }
}

export default function rtkFilterExtension(pi: ExtensionApi): void {
  const bin = resolveRtkBinary();
  const exec = pi.exec;
  if (!bin || !exec) return;
  // omp records the post-hook command in its transcript, so only pi leaves an audit row here:
  // opencode rewrites in its own plugin hook, and an omp row would double-count the transcript.
  const auditHost = isPiHost(pi) ? 'pi' : null;
  // Registered synchronously, unlike the rtk-init hook, whose async version probe can miss the first call of a fast session.
  pi.on('tool_call', async (event, ctx: ExtensionCtx) => {
    const call = (event ?? {}) as BashCallEvent;
    const input = call.input;
    if (call.toolName !== 'bash' || !input) return;
    const command = input.command;
    if (typeof command !== 'string' || !command.trim() || command.startsWith('rtk ')) return;
    if (!rtkActive(sessionEntries(ctx))) return;
    const rewritten = await rewriteCommand(exec, bin, command, ctx?.signal);
    if (!rewritten || rewritten === command) return;
    input.command = rewritten;
    if (auditHost) appendUsage('rtk-audit', `${auditHost} ${command}`);
  });
  pi.on<ToolResultEvent>('tool_result', async (event, ctx: ExtensionCtx) => {
    const filter = FILTER_BY_TOOL.get(String(event?.toolName ?? '').toLowerCase());
    if (!filter || event?.isError) return;
    const text = filterableText(event?.content);
    if (text === null || text.length < MIN_FILTER_BYTES) return;
    if (!rtkActive(sessionEntries(ctx))) return;
    const filtered = await filterThroughRtk(exec, { bin, filter, text, signal: ctx?.signal });
    if (!filtered) return;
    // Built-in grep and glob declare no output schema, so no structuredContent is lost.
    return { content: [{ type: 'text', text: filtered }] };
  });
}
