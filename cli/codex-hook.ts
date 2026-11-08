// Codex prompt hook: clear a stop phrase, then return the active mode blocks as developer context.
import { applyCodexStopPatch, codexHookOutput, codexModeContext, codexStopPatch } from '../extensions/shared/codex-plugin.ts';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function promptOf(raw: string): unknown {
  if (raw.trim() === '') return '';
  try {
    const parsed = JSON.parse(raw) as { prompt?: unknown };
    return parsed.prompt ?? '';
  } catch {
    return '';
  }
}

export async function runCodexHook(event: string | undefined): Promise<void> {
  const raw = await readStdin();
  if (event === 'user-prompt-submit') {
    const patch = codexStopPatch(promptOf(raw));
    if (patch) applyCodexStopPatch(patch);
  }
  process.stdout.write(`${JSON.stringify(codexHookOutput(codexModeContext()))}\n`);
}
