// Git hooks helper for CodeGraph background sync.
// Installs post-commit, post-merge, and post-checkout hooks into .git/hooks if available.

import fs from 'node:fs';
import path from 'node:path';

const HOOK_SCRIPT = `#!/bin/sh
# Tersio CodeGraph automatic background sync hook
if command -v tersio >/dev/null 2>&1; then
  tersio codegraph sync >/dev/null 2>&1 &
fi
`;

const HOOK_MARKER = 'Tersio CodeGraph';

export function installGitHooks(projectRoot = process.cwd()): { success: boolean; installed: string[]; skipped: string[] } {
  const hooksDir = path.join(projectRoot, '.git', 'hooks');
  if (!fs.existsSync(hooksDir)) {
    return { success: false, installed: [], skipped: ['no .git/hooks directory found'] };
  }

  const hooks = ['post-commit', 'post-merge', 'post-checkout'];
  const installed: string[] = [];
  const skipped: string[] = [];

  for (const hook of hooks) {
    const hookPath = path.join(hooksDir, hook);
    if (fs.existsSync(hookPath)) {
      const existing = fs.readFileSync(hookPath, 'utf8');
      if (existing.includes(HOOK_MARKER)) {
        skipped.push(hook);
        continue;
      }
      fs.appendFileSync(hookPath, `\n${HOOK_SCRIPT}`);
      fs.chmodSync(hookPath, 0o755);
      installed.push(hook);
    } else {
      fs.writeFileSync(hookPath, HOOK_SCRIPT, { mode: 0o755 });
      installed.push(hook);
    }
  }

  return { success: true, installed, skipped };
}
