// The Claude Code plugin Tersio writes into a local marketplace, and the files it must carry.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { findPackageRoot } from './utils.ts';
import { tersioMcpLaunch } from './mcp-config.ts';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLAUDE_MARKETPLACE_NAME,
  CLAUDE_PLUGIN_DIR,
  CLAUDE_PLUGIN_NAME,
  claudeLocalMarketplaceRoot,
} from './claude-state.ts';
import { getPonytailInstructions } from '../ponytail/hooks/ponytail-instructions.ts';

const ROOT = findPackageRoot(dirname(fileURLToPath(import.meta.url)));

const CAVEMAN_RULES: Record<string, string> = {
  lite: 'rule-lite.md',
  full: 'rule.md',
  ultra: 'rule-ultra.md',
  'megacave-lite': 'rule-megacave-lite.md',
  'megacave-full': 'rule-megacave.md',
  'megacave-ultra': 'rule-megacave-ultra.md',
};

/** The caveman body per level, ready for the plugin to hand to Claude as prompt context. */
function cavemanContext(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [mode, file] of Object.entries(CAVEMAN_RULES)) {
    try {
      out[mode] =
        `Caveman ${mode} active for this session.\n${readFileSync(join(ROOT, 'extensions', 'caveman', file), 'utf8')}`;
    } catch {
      out[mode] = `Caveman ${mode} requested, but ${file} is missing. Run: tersio doctor --fix extensions`;
    }
  }
  return out;
}

/** The heading and recovery rule a compressed result carries; the plugin injects it only when routed. */
const HEADROOM_CONTEXT =
  '🍃 HEADROOM MODE ACTIVE — level: on\nTool outputs, file reads, and history may be compressed before reaching you. A compressed result can elide details; treat its elision markers as real. Recover the original by hash with the tersio_headroom MCP tool ({action:"retrieve", hash:"<HASH>"}). If that tool is not available, re-run the source command or re-read the file.';

/**
 * The mode bodies the Claude plugin injects on every prompt. It ships as JSON beside the mod, so the
 * plugin needs no filesystem import and Tersio can refresh the text at install time.
 */
export function claudeModeContext(): Record<string, unknown> {
  const pstack = (() => {
    try {
      const rule = readFileSync(join(ROOT, 'extensions', 'pstack', 'rule.md'), 'utf8');
      const base = join(claudeLocalMarketplaceRoot(), CLAUDE_PLUGIN_NAME, 'skills', 'pstack');
      // The rule points at sibling files by bare name; the absolute base is what the model can open.
      return `${rule}\n\nThe pstack files are under \`${base}\`. Read them from there.`;
    } catch {
      return 'pstack mode requested, but rule.md is missing. Run: tersio doctor --fix extensions';
    }
  })();
  return {
    caveman: cavemanContext(),
    ponytail: {
      lite: getPonytailInstructions('lite'),
      full: getPonytailInstructions('full'),
      ultra: getPonytailInstructions('ultra'),
    },
    pstack,
    headroom: HEADROOM_CONTEXT,
  };
}

/** The plugin manifest and its hooks module, read from the packaged copy beside this build. */
function readPackaged(rel: string): string {
  return readFileSync(join(ROOT, 'plugins', CLAUDE_PLUGIN_DIR, ...rel.split('/')), 'utf8');
}

/** The MCP entry Claude reads from the plugin's `.mcp.json`. */
function mcpJson(): string {
  const { command, args } = tersioMcpLaunch();
  return `${JSON.stringify({ mcpServers: { tersio: { command, args } } }, null, 2)}\n`;
}

/** Pstack's rule and its playbooks, skills, principles, and references, keyed under the skill dir. */
function pstackPluginFiles(): Record<string, string> {
  const root = join(ROOT, 'extensions', 'pstack');
  const keep: Record<string, true> = { principles: true, playbooks: true, skills: true, references: true };
  const out: Record<string, string> = {};
  const walk = (rel: string): void => {
    for (const entry of readdirSync(rel ? join(root, rel) : root, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!rel && !keep[entry.name]) continue;
        walk(child);
      } else if (entry.isFile() && entry.name.endsWith('.md') && (rel !== '' || entry.name === 'rule.md')) {
        out[child] = readFileSync(join(root, child), 'utf8');
      }
    }
  };
  walk('');
  return out;
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
  const files: Record<string, string> = {
    '.claude-plugin/marketplace.json': marketplaceJson(),
    [`${CLAUDE_PLUGIN_NAME}/.claude-plugin/plugin.json`]: readPackaged('.claude-plugin/plugin.json'),
    [`${CLAUDE_PLUGIN_NAME}/.mcp.json`]: mcpJson(),
    [`${CLAUDE_PLUGIN_NAME}/hooks/hooks.json`]: readPackaged('hooks/hooks.json'),
    [`${CLAUDE_PLUGIN_NAME}/hooks/register.ts`]: readPackaged('hooks/register.ts'),
    [`${CLAUDE_PLUGIN_NAME}/hooks/mode-context.json`]: `${JSON.stringify(claudeModeContext(), null, 2)}\n`,
    [`${CLAUDE_PLUGIN_NAME}/commands/tersio.md`]: readPackaged('commands/tersio.md'),
    [`${CLAUDE_PLUGIN_NAME}/commands/combo.md`]: readPackaged('commands/combo.md'),
    [`${CLAUDE_PLUGIN_NAME}/commands/caveman.md`]: readPackaged('commands/caveman.md'),
    [`${CLAUDE_PLUGIN_NAME}/commands/rtk.md`]: readPackaged('commands/rtk.md'),
    [`${CLAUDE_PLUGIN_NAME}/commands/pstack.md`]: readPackaged('commands/pstack.md'),
    [`${CLAUDE_PLUGIN_NAME}/commands/ponytail.md`]: readPackaged('commands/ponytail.md'),
    [`${CLAUDE_PLUGIN_NAME}/commands/headroom.md`]: readPackaged('commands/headroom.md'),
    [`${CLAUDE_PLUGIN_NAME}/commands/help.md`]: readPackaged('commands/help.md'),
    [`${CLAUDE_PLUGIN_NAME}/commands/update.md`]: readPackaged('commands/update.md'),
  };
  for (const [rel, text] of Object.entries(pstackPluginFiles())) {
    files[`${CLAUDE_PLUGIN_NAME}/skills/pstack/${rel === 'rule.md' ? 'SKILL.md' : rel}`] = text;
  }
  return files;
}

export { claudeLocalMarketplaceRoot };
