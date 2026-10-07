// pi's built-in grep and glob never reach the bash hook; `read` is absent because rtk has no filter for it.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveRtkBinary } from '../lib/utils.ts';
import { readRtkDefault } from '../shared/plugin-settings.ts';
import { getSharedComboState, lastCustomValue, sessionEntries } from '../shared/session-state.ts';
import type { ExtensionApi, ExtensionCtx, SessionEntry, ToolResultEvent } from '../shared/types.ts';

/** Tool name to `rtk pipe --filter` name. Exported so the OpenCode host reuses one map. */
export const FILTER_BY_TOOL = new Map([
  ['grep', 'grep'],
  ['glob', 'find'],
  ['find', 'find'],
]);

/** Below this the rtk spawn costs more than the filter saves. */
export const MIN_FILTER_BYTES = 1200;
const FILTER_TIMEOUT_MS = 5000;

/** Absolute, so a minimal PATH in the host cannot break the spawn. */
const SHELL = '/bin/sh';

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
  // An image or a mixed result is not text to filter.
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
    // `rtk pipe` reads stdin only and execFile has no stdin, so one redirect.
    const result = await exec(SHELL, ['-c', `"${bin}" pipe -f ${filter} < "${file}"`], { signal, timeout: FILTER_TIMEOUT_MS });
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

export default function rtkFilterExtension(pi: ExtensionApi): void {
  const bin = resolveRtkBinary();
  const exec = pi.exec;
  if (!bin || !exec) return;
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
