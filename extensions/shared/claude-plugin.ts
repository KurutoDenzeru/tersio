// The Claude Code plugin Tersio writes into a local marketplace, and the files it must carry.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findPackageRoot } from './utils.ts';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLAUDE_MARKETPLACE_NAME,
  CLAUDE_PLUGIN_DIR,
  CLAUDE_PLUGIN_NAME,
  claudeLocalMarketplaceRoot,
} from './claude-state.ts';

const ROOT = findPackageRoot(dirname(fileURLToPath(import.meta.url)));

/** The plugin manifest and its hooks module, read from the packaged copy beside this build. */
function readPackaged(rel: string): string {
  return readFileSync(join(ROOT, 'plugins', CLAUDE_PLUGIN_DIR, ...rel.split('/')), 'utf8');
}

/**
 * The marketplace Claude Code registers. A relative source resolves from the marketplace root, so the
 * plugin directory sits beside the manifest instead of anywhere on disk.
 */
function marketplaceJson(): string {
  return `${JSON.stringify(
    {
      name: CLAUDE_MARKETPLACE_NAME,
      owner: { name: 'KurutoDenzeru' },
      plugins: [
        {
          name: CLAUDE_PLUGIN_NAME,
          source: `./${CLAUDE_PLUGIN_NAME}`,
          description: "Tersio's token-saving modes drawn inside Claude Code.",
        },
      ],
    },
    null,
    2,
  )}\n`;
}

/** Every file the local marketplace needs, keyed by its path under the marketplace root. */
export function claudeLocalPluginFiles(): Record<string, string> {
  return {
    '.claude-plugin/marketplace.json': marketplaceJson(),
    [`${CLAUDE_PLUGIN_NAME}/.claude-plugin/plugin.json`]: readPackaged('.claude-plugin/plugin.json'),
    [`${CLAUDE_PLUGIN_NAME}/hooks/hooks.json`]: readPackaged('hooks/hooks.json'),
    [`${CLAUDE_PLUGIN_NAME}/hooks/register.js`]: readPackaged('hooks/register.js'),
    [`${CLAUDE_PLUGIN_NAME}/commands/tersio.md`]: readPackaged('commands/tersio.md'),
    [`${CLAUDE_PLUGIN_NAME}/commands/combo.md`]: readPackaged('commands/combo.md'),
    [`${CLAUDE_PLUGIN_NAME}/commands/caveman.md`]: readPackaged('commands/caveman.md'),
    [`${CLAUDE_PLUGIN_NAME}/commands/rtk.md`]: readPackaged('commands/rtk.md'),
    [`${CLAUDE_PLUGIN_NAME}/commands/pstack.md`]: readPackaged('commands/pstack.md'),
    [`${CLAUDE_PLUGIN_NAME}/commands/ponytail.md`]: readPackaged('commands/ponytail.md'),
    [`${CLAUDE_PLUGIN_NAME}/commands/headroom.md`]: readPackaged('commands/headroom.md'),
  };
}

export { claudeLocalMarketplaceRoot };
