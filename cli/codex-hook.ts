// Codex lifecycle hooks: the prompt hook prints mode context, the PreToolUse hook applies the rtk rewrite.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readRtkDefault } from '../extensions/shared/plugin-settings.ts';
import { codexModeContext } from '../extensions/shared/codex-plugin.ts';
import { resolveRtkBinary, shimCommand } from '../extensions/shared/utils.ts';

const REWRITE_TIMEOUT_MS = 4000;

/**
 * Exit 0 means rtk rewrote and its allow rules cover every command, so the rewrite is safe to forward.
 * Exit 3 is also a rewrite, but its allow rules do not cover the command, so the rewrite would bypass
 * Codex's own approval. Both the no-op rewrite (rewrite == command) and exit 1 pass through unchanged.
 */
function rtkRewrite(bin: string, command: string): string | null {
  const shim = shimCommand(bin, ['rewrite', command]);
  const run = spawnSync(shim.cmd, shim.args, {
    encoding: 'utf8',
    timeout: REWRITE_TIMEOUT_MS,
    windowsHide: true,
    input: '',
  });
  if (run.status !== 0) return null;
  const rewritten = run.stdout.trim();
  return rewritten && rewritten !== command ? rewritten : null;
}

function runPreToolUse(): void {
  // Codex sends the event JSON on stdin; a TTY run (manual test) sees nothing and exits.
  let text = '';
  if (!process.stdin.isTTY) {
    try { text = readFileSync(0, 'utf8'); } catch { text = ''; }
  }
  let event: { tool_name?: unknown; tool_input?: { command?: unknown } } = {};
  try { event = JSON.parse(text) as typeof event; } catch { /* no payload: leave the call alone */ }
  const command = event.tool_input?.command;
  if (event.tool_name !== 'Bash' || typeof command !== 'string' || command.trim() === '' || command.startsWith('rtk ')) return;
  if (process.env.RTK_DISABLED === '1') return;
  if (!readRtkDefault()) return;
  const bin = resolveRtkBinary();
  if (bin === null) return;
  // Exit 1 (no rewrite), 2 (deny), and 3 (needs approval) all pass through untouched:
  // a rewrite the allow rules do not cover must not ride a hook allow.
  const rewritten = rtkRewrite(bin, command);
  if (rewritten === null) return;
  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: 'RTK auto-rewrite',
      updatedInput: { command: rewritten },
    },
  })}\n`);
}

export function runCodexHook(event: string): void {
  if (event === 'pre-tool-use') {
    runPreToolUse();
    return;
  }
  if (event !== 'session-start' && event !== 'user-prompt-submit') {
    console.error(`[fail] Unknown Codex hook event: ${event}`);
    process.exitCode = 1;
    return;
  }
  const context = codexModeContext();
  if (context) process.stdout.write(`${context}\n`);
}
