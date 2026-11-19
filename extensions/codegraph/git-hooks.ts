// Git hooks helper for CodeGraph background sync.
// Installs post-commit, post-merge, and post-checkout hooks into .git/hooks if available.

import fs from 'node:fs';
import path from 'node:path';

const HOOK_MARKER = 'Tersio CodeGraph';

const HOOK_BODY = `# ${HOOK_MARKER} automatic background sync hook
if command -v tersio >/dev/null 2>&1; then
  tersio codegraph sync >/dev/null 2>&1 &
fi
`;

const HOOK_SCRIPT = `#!/bin/sh\n${HOOK_BODY}`;

/** A shebang a POSIX shell block can live under; a hook with no shebang is run by git through sh. */
function isShellHook(firstLine: string): boolean {
  if (!firstLine.startsWith('#!')) return true;
  return /^#!\s*(?:\/usr\/bin\/env\s+(?:-\S+\s+)?)?(?:\S*\/)?(?:ba|da|z|k)?sh(?:\s|$)/.test(firstLine);
}

/**
 * Put the sync block right after the shebang, so an `exit` or `exec` further down in the user's
 * own hook cannot stop it from running.
 */
function withBlock(existing: string): string {
  const newline = existing.indexOf('\n');
  if (existing.startsWith('#!')) {
    if (newline === -1) return `${existing}\n${HOOK_BODY}`;
    return `${existing.slice(0, newline + 1)}${HOOK_BODY}${existing.slice(newline + 1)}`;
  }
  return `${HOOK_BODY}${existing}`;
}

export function installGitHooks(projectRoot = process.cwd()): {
  success: boolean;
  installed: string[];
  skipped: string[];
  incompatible: string[];
} {
  const hooksDir = path.join(projectRoot, '.git', 'hooks');
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
      const existing = fs.readFileSync(hookPath, 'utf8');
      if (existing.includes(HOOK_MARKER)) {
        skipped.push(hook);
        continue;
      }
      // Never splice shell into a hook written in another language.
      if (!isShellHook(existing.split('\n', 1)[0] ?? '')) {
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
