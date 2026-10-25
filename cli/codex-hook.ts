// Codex lifecycle hooks: the prompt hook prints mode context, the PreToolUse hook applies the rtk rewrite.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readRtkDefault, tersioSettingsFile } from '../extensions/shared/plugin-settings.ts';
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

/** The whole prompt, ignoring case and trailing punctuation, so a mention inside a task never turns a mode off. */
function normalizedPrompt(text: unknown): string {
  return String(text ?? '').trim().toLowerCase().replace(/[.!?\s]+$/, '');
}

/**
 * Codex re-adds the mode block on every prompt, so a stop phrase must clear the stored default.
 * OMP does the same on its own input event; without this, caveman and ponytail stay on.
 */
function applyStopPhrase(prompt: unknown): void {
  const text = normalizedPrompt(prompt);
  if (text !== 'stop caveman' && text !== 'stop ponytail' && text !== 'normal mode') return;
  const file = tersioSettingsFile();
  let stored: Record<string, unknown> = {};
  mkdirSync(path.dirname(file), { recursive: true });
  try { stored = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>; } catch { /* no file yet */ }
  // `normal mode` clears every style mode; a single stop clears only its own.
  if (text !== 'stop ponytail') stored.cavemanDefault = 'off';
  if (text !== 'stop caveman') stored.ponytailDefault = 'off';
  if (text === 'normal mode') stored.pstackDefault = 'off';
  writeFileSync(file, `${JSON.stringify({ ...stored }, null, 2)}\n`, 'utf8');
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
  if (event === 'user-prompt-submit') {
    let text = '';
    if (!process.stdin.isTTY) {
      try { text = readFileSync(0, 'utf8'); } catch { text = ''; }
    }
    let prompt: unknown;
    try { prompt = (JSON.parse(text) as { prompt?: unknown }).prompt; } catch { prompt = undefined; }
    applyStopPhrase(prompt);
  }
  const context = codexModeContext();
  if (context) process.stdout.write(`${context}\n`);
}
