// Codex prompt hook: apply mode commands, then return the active mode blocks as developer context.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyCodexModePatch,
  codexBlockOutput,
  codexHookOutput,
  codexManagedPrompt,
  codexModeContext,
  codexSlashCommand,
  codexStatusLine,
  codexStopPatch,
} from '../extensions/shared/codex-plugin.ts';
import { readCodegraphDefault } from '../extensions/shared/plugin-settings.ts';
import { shimCommand } from '../extensions/shared/utils.ts';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function payloadOf(raw: string): Record<string, unknown> {
  if (raw.trim() === '') return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Codex runs no CodeGraph session hook, so each prompt submit keeps an existing map fresh instead:
 * the index is built by an extension host, the CLI, or the dashboard, and this only follows edits.
 * A project without a map never gets one from here — starting a 300MB-backed build on a prompt
 * is the engine's opt-in, not Codex's side effect.
 */
function maybeSyncCodegraph(payload: Record<string, unknown>): void {
  try {
    if (readCodegraphDefault('codex') !== 'on') return;
    const cwd = typeof payload.cwd === 'string' && payload.cwd.trim() !== '' ? payload.cwd : process.cwd();
    if (!existsSync(join(cwd, '.codegraph', 'codegraph.db'))) return;
    const shim = shimCommand('tersio', ['codegraph', 'sync']);
    spawn(shim.cmd, shim.args, { cwd, detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch {
    // A failed sync is a stale map, never a broken prompt.
  }
}

export async function runCodexHook(event: string | undefined): Promise<void> {
  const raw = await readStdin();
  if (event === 'user-prompt-submit') {
    const payload = payloadOf(raw);
    const prompt = payload.prompt ?? '';
    const sessionId = payload.session_id;
    // A picked /prompts:* entry arrives as its whole body, so it answers here instead of at the model.
    const managed = codexManagedPrompt(prompt);
    const command =
      managed && managed.command !== 'tersio'
        ? codexSlashCommand(`/${managed.command} ${managed.value}`, sessionId)
        : codexSlashCommand(prompt, sessionId);
    if (command) {
      if (Object.keys(command.patch).length > 0) applyCodexModePatch(sessionId, command.patch);
      // Codex Desktop has no plugin status bar, so the status line rides the hook result.
      process.stdout.write(`${JSON.stringify(codexBlockOutput(command.message, codexStatusLine(sessionId)))}\n`);
      return;
    }
    const patch = codexStopPatch(prompt);
    if (patch) applyCodexModePatch(sessionId, patch);
    maybeSyncCodegraph(payload);
    process.stdout.write(
      `${JSON.stringify(codexHookOutput(codexModeContext(sessionId), codexStatusLine(sessionId)))}\n`,
    );
    return;
  }
  process.stdout.write(`${JSON.stringify(codexHookOutput(codexModeContext(), codexStatusLine()))}\n`);
}
