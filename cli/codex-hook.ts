// Codex prompt hook: apply mode commands, then return the active mode blocks as developer context.
import {
  applyCodexModePatch, codexBlockOutput, codexHookOutput, codexModeContext, codexSlashCommand, codexStopPatch,
} from '../extensions/shared/codex-plugin.ts';

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
    const prompt = promptOf(raw);
    const command = codexSlashCommand(prompt);
    if (command) {
      if (Object.keys(command.patch).length > 0) applyCodexModePatch(command.patch);
      process.stdout.write(`${JSON.stringify(codexBlockOutput(command.message))}\n`);
      return;
    }
    const patch = codexStopPatch(prompt);
    if (patch) applyCodexModePatch(patch);
  }
  process.stdout.write(`${JSON.stringify(codexHookOutput(codexModeContext()))}\n`);
}
