// pi's built-in grep and glob never reach the bash hook; `read` is absent because rtk has no filter for it.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveRtkBinary } from '../shared/utils.ts';
import { readRtkDefault } from '../shared/plugin-settings.ts';
import { getSharedComboState, lastCustomValue, sessionEntries } from '../shared/session-state.ts';
import { appendUsage } from '../shared/usage-ledger.ts';
import { hasToolLifecycle, isPiHost, isPigHost } from '../shared/host.ts';
import { rewriteThroughRtk } from '../shared/rtk-rewrite.ts';
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

/** One directory for the life of the process: a per-call mkdtemp and rmdir cost more than the pipe saves. */
let pipeDir: string | null = null;

/** The text parked where the redirect can read it; a stale file from an aborted call is simply overwritten. */
function pipeFile(text: string): string | null {
  try {
    if (pipeDir === null) {
      pipeDir = mkdtempSync(join(tmpdir(), 'tersio-rtk-'));
      process.once('exit', () => { try { rmSync(pipeDir as string, { recursive: true, force: true }); } catch { /* already gone */ } });
    }
    const file = join(pipeDir, 'in.txt');
    writeFileSync(file, text, 'utf8');
    return file;
  } catch {
    return null;
  }
}

/** The directory outlives the call, so this only drops the file. */
function dropPipeFile(file: string): void {
  try {
    rmSync(file, { force: true });
  } catch { /* best effort */ }
}

/** Pipe text through one rtk filter; null on any failure, so the caller keeps its original. */
export async function filterThroughRtk(
  exec: FilterExec,
  request: { bin: string; filter: string; text: string; signal?: AbortSignal },
): Promise<string | null> {
  const { bin, filter, text, signal } = request;
  let file: string | null = null;
  try {
    file = pipeFile(text);
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
    if (file) dropPipeFile(file);
  }
}

/** A bash tool call, before it runs. pi and omp hand the extension the mutable input. */
interface BashCallEvent {
  toolName?: unknown;
  input?: { command?: unknown };
}


export default function rtkFilterExtension(pi: ExtensionApi): void {
  const bin = resolveRtkBinary();
  const exec = pi.exec;
  // A host that drives its own tool hooks never fires these events, so a handler here would be dead weight.
  if (!bin || !exec || !hasToolLifecycle(pi)) return;
  // omp records the post-hook command in its transcript, so only pi leaves an audit row here: an omp row would double-count, and OpenCode never reaches this hook at all.
  const auditHost = isPiHost(pi) || isPigHost(pi) ? 'pi' : null;
  // Registered synchronously, unlike the rtk-init hook, whose async version probe can miss the first call of a fast session.
  pi.on('tool_call', async (event, ctx: ExtensionCtx) => {
    const call = (event ?? {}) as BashCallEvent;
    const input = call.input;
    if (call.toolName !== 'bash' || !input) return;
    const command = input.command;
    if (typeof command !== 'string' || !command.trim() || command.startsWith('rtk ')) return;
    if (!rtkActive(sessionEntries(ctx))) return;
    // The shared rewrite owns rtk's exit-code contract; this host only supplies its runner and the signal.
    const rewritten = await rewriteThroughRtk(command, {
      bin,
      exec: (file, args, opts) => {
        // This host's runner takes an abort signal, not a timeout, so the deadline rides the signal.
        const deadline = AbortSignal.timeout(opts.timeout);
        return exec(file, args, { signal: opts.signal ? AbortSignal.any([opts.signal, deadline]) : deadline });
      },
    });
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