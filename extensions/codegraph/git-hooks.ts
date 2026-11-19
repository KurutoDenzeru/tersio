// Git hooks helper for CodeGraph background sync.
// Installs post-commit, post-merge, and post-checkout hooks into the repository's effective hooks directory.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const HOOK_MARKER = 'Tersio CodeGraph';

const HOOK_BODY = `# ${HOOK_MARKER} automatic background sync hook
if command -v tersio >/dev/null 2>&1; then
  tersio codegraph sync >/dev/null 2>&1 &
fi
`;

const HOOK_SCRIPT = `#!/bin/sh\n${HOOK_BODY}`;

/** The block as an earlier version wrote it, so a changed script replaces it instead of being skipped. */
const BLOCK_PATTERN = new RegExp(`# ${HOOK_MARKER}[^\\n]*\\n(?:[^\\n]*\\n)*?fi\\n`);

const ENV_VALUE_OPTIONS = new Set(['-u', '--unset', '-C', '--chdir', '-P']);

const SHELLS = new Set(['sh', 'bash', 'dash', 'zsh', 'ksh']);

/** The interpreter a shebang names, looking through `env` and its options (including `-S` and `NAME=value`). */
function shebangInterpreter(line: string): string | null {
  const tokens = line.slice(2).trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  let index = 0;
  if (path.posix.basename(tokens[0] ?? '') === 'env') {
    index = 1;
    while (index < tokens.length) {
      const token = tokens[index] ?? '';
      if (!token.startsWith('-') && !token.includes('=')) break;
      // These options take their value as the next word.
      index += ENV_VALUE_OPTIONS.has(token) ? 2 : 1;
    }
  }
  const interpreter = tokens[index];
  return interpreter ? path.posix.basename(interpreter) : null;
}

/** Whether a POSIX shell block can live in this hook: a shell shebang, or a text file git runs through sh. */
function isShellHook(content: Buffer): boolean {
  if (content.includes(0)) return false;
  const text = content.toString('utf8');
  const firstLine = text.split('\n', 1)[0]?.replace(/\r$/, '') ?? '';
  if (!firstLine.startsWith('#!')) return true;
  const interpreter = shebangInterpreter(firstLine);
  return interpreter !== null && SHELLS.has(interpreter);
}

/**
 * Put the sync block right after the shebang, so an `exit` or `exec` further down in the user's
 * own hook cannot stop it from running. Bytes outside the block are copied untouched.
 */
function withBlock(existing: Buffer): Buffer {
  const block = Buffer.from(HOOK_BODY);
  if (existing.subarray(0, 2).toString() === '#!') {
    const newline = existing.indexOf(0x0a);
    if (newline === -1) return Buffer.concat([existing, Buffer.from('\n'), block]);
    return Buffer.concat([existing.subarray(0, newline + 1), block, existing.subarray(newline + 1)]);
  }
  return Buffer.concat([block, existing]);
}

/** Git's effective hooks directory: honours `core.hooksPath` and linked worktrees; `.git/hooks` when git cannot say. */
function hooksDirectory(projectRoot: string): string {
  try {
    const out = execFileSync('git', ['-C', projectRoot, 'rev-parse', '--git-path', 'hooks'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5_000,
      windowsHide: true,
    }).trim();
    if (out) return path.resolve(projectRoot, out);
  } catch {
    /* not a git checkout, or no git binary: fall back to the conventional location */
  }
  return path.join(projectRoot, '.git', 'hooks');
}

export function installGitHooks(projectRoot = process.cwd()): {
  success: boolean;
  installed: string[];
  skipped: string[];
  incompatible: string[];
} {
  const hooksDir = hooksDirectory(projectRoot);
  if (!fs.existsSync(hooksDir)) {
    return { success: false, installed: [], skipped: ['no .git/hooks directory found'], incompatible: [] };
  }

  const hooks = ['post-commit', 'post-merge', 'post-checkout'];
  const installed: string[] = [];
  const skipped: string[] = [];
  const incompatible: string[] = [];

  for (const hook of hooks) {
    const hookPath = path.join(hooksDir, hook);
    if (fs.existsSync(hookPath)) {
      const existing = fs.readFileSync(hookPath);
      const text = existing.toString('utf8');
      if (text.includes(HOOK_MARKER)) {
        if (text.includes(HOOK_BODY)) {
          skipped.push(hook);
          continue;
        }
        // An older block: bring it up to date in place.
        fs.writeFileSync(hookPath, text.replace(BLOCK_PATTERN, HOOK_BODY));
        fs.chmodSync(hookPath, 0o755);
        installed.push(hook);
        continue;
      }
      // Never splice shell into a hook written in another language, or into a compiled one.
      if (!isShellHook(existing)) {
        incompatible.push(hook);
        continue;
      }
      fs.writeFileSync(hookPath, withBlock(existing));
      fs.chmodSync(hookPath, 0o755);
      installed.push(hook);
    } else {
      fs.writeFileSync(hookPath, HOOK_SCRIPT, { mode: 0o755 });
      installed.push(hook);
    }
  }

  return { success: true, installed, skipped, incompatible };
}
