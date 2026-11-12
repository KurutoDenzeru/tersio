// Claude Code plugin paths and installed state, without the mode bodies or any extension runtime imports.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPackageRoot, homeDir, isRecord } from './utils.ts';

export const CLAUDE_PLUGIN_NAME = 'tersio';
/** The directory under plugins/. The plugin's own name is tersio, which the Codex plugin already uses. */
export const CLAUDE_PLUGIN_DIR = 'claude';
export const CLAUDE_MARKETPLACE_NAME = 'tersio';
export const CLAUDE_PLUGIN_ID = `${CLAUDE_PLUGIN_NAME}@${CLAUDE_MARKETPLACE_NAME}`;

/** Every file the packaged plugin must carry; a plugin with a manifest and no hooks module draws nothing. */
export const CLAUDE_PLUGIN_FILES = [
  '.claude-plugin/plugin.json',
  '.mcp.json',
  'hooks/hooks.json',
  'hooks/register.ts',
  'hooks/mode-context.json',
  'skills/pstack/SKILL.md',
  // A registered command never reaches the slash menu; a commands/*.md file is what lists.
  'commands/tersio.md',
  'commands/combo.md',
  'commands/caveman.md',
  'commands/rtk.md',
  'commands/pstack.md',
  'commands/ponytail.md',
  'commands/headroom.md',
  'commands/help.md',
  'commands/update.md',
] as const;

const ROOT = findPackageRoot(dirname(fileURLToPath(import.meta.url)));

/** Claude Code keeps its user state here; CLAUDE_CONFIG_DIR is the documented override. */
export function claudeHome(): string {
  const override = (process.env.CLAUDE_CONFIG_DIR ?? '').trim();
  return override || join(homeDir(), '.claude');
}

/** The portable plugin directory inside this package. */
export function claudePackagedPluginDir(root = ROOT): string {
  return join(root, 'plugins', CLAUDE_PLUGIN_DIR);
}

/** The local marketplace Tersio writes, so the plugin installs without a network fetch. */
export function claudeLocalMarketplaceRoot(): string {
  return join(claudeHome(), 'tersio-marketplace');
}

/** The file Claude Code reads to know which plugins are installed. */
function installedPluginsFile(): string {
  return join(claudeHome(), 'plugins', 'installed_plugins.json');
}

export interface InstalledClaudePlugin {
  /** True when the plugin is recorded and its files are on disk. */
  complete: boolean;
  /** True when the user has not disabled it. */
  enabled: boolean;
  dir: string | null;
  version: string | null;
  /** The files the record names but the disk does not have. */
  missing: string[];
}

/**
 * Reads Claude Code's own record instead of guessing from a directory. A plugin can be recorded and
 * still be missing files, and a filesystem check alone cannot tell a disabled plugin from an absent one.
 */
export function installedClaudePlugin(): InstalledClaudePlugin {
  const empty: InstalledClaudePlugin = { complete: false, enabled: false, dir: null, version: null, missing: [] };
  let record: unknown;
  try {
    record = JSON.parse(readFileSync(installedPluginsFile(), 'utf8'));
  } catch {
    return empty;
  }
  const plugins = (record as { plugins?: Record<string, unknown> }).plugins;
  if (!plugins || typeof plugins !== 'object') return empty;
  const entries = (plugins as Record<string, unknown>)[CLAUDE_PLUGIN_ID];
  if (!Array.isArray(entries) || entries.length === 0) return empty;
  const first = entries[0] as { installPath?: unknown; version?: unknown };
  const dir = typeof first.installPath === 'string' ? first.installPath : null;
  const version = typeof first.version === 'string' ? first.version : null;
  if (!dir) return { ...empty, version };
  const missing = CLAUDE_PLUGIN_FILES.filter((file) => !existsSync(join(dir, ...file.split('/'))));
  return { complete: missing.length === 0, enabled: claudePluginEnabled(), dir, version, missing };
}

/** A plugin recorded but listed as disabled in settings runs nothing, so the install is not usable. */
export function claudePluginEnabled(): boolean {
  try {
    const settings = JSON.parse(readFileSync(join(claudeHome(), 'settings.json'), 'utf8')) as {
      enabledPlugins?: Record<string, unknown>;
    };
    return settings.enabledPlugins?.[CLAUDE_PLUGIN_ID] !== false;
  } catch {
    // No settings file means Claude Code has not written a preference, so the plugin is on by default.
    return true;
  }
}

/** The plugin is usable when it is recorded, complete on disk, and not disabled. */
export function claudePluginInstalled(): boolean {
  const state = installedClaudePlugin();
  return state.complete && state.enabled;
}

/** The plugin's bundled `.mcp.json` is what makes the Tersio MCP tools reachable. */
export function claudeMcpConfigured(): boolean {
  const dir = installedClaudePlugin().dir;
  if (!dir) return false;
  try {
    const data = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8')) as {
      mcpServers?: Record<string, unknown>;
    };
    return Boolean(data.mcpServers?.tersio);
  } catch {
    return false;
  }
}

/** An RTK Claude hook entry, matched by the command it runs. */
function isRtk(value: unknown): boolean {
  return isRecord(value) && /\brtk\s+hook\s+claude\b/.test(String(value.command ?? ''));
}

/** The entries under one `matcher` group; a group with no `hooks` array carries none. */
function hookList(group: Record<string, unknown>): unknown[] {
  return Array.isArray(group.hooks) ? group.hooks : [];
}

/**
 * RTK's Claude hook lives in `~/.claude/settings.json`. Tersio's rtk mode has to add or remove
 * that exact entry, or the stored preference is only a label.
 */
export function setClaudeRtkHook(enabled: boolean): boolean {
  const file = join(claudeHome(), 'settings.json');
  let data: Record<string, unknown> = {};
  if (existsSync(file)) {
    try {
      data = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    } catch {
      return false;
    }
  }
  const hooks = isRecord(data.hooks) ? data.hooks : {};
  const groups = hooks.PreToolUse;
  if (groups !== undefined && !Array.isArray(groups)) return false;
  let changed = false;
  const next: Array<Record<string, unknown>> = [];
  for (const raw of Array.isArray(groups) ? groups : []) {
    if (!isRecord(raw)) continue;
    const entries = hookList(raw);
    const kept = entries.filter((entry) => !isRtk(entry));
    if (kept.length !== entries.length) {
      changed = true;
      if (kept.length === 0) continue;
    }
    next.push(kept.length === entries.length ? raw : { ...raw, hooks: kept });
  }
  const hasRtk = next.some((group) => hookList(group).some(isRtk));
  if (enabled && !hasRtk) {
    const bash = next.find((group) => group.matcher === 'Bash' && Array.isArray(group.hooks));
    if (bash) {
      const entries = hookList(bash);
      entries.push({ type: 'command', command: 'rtk hook claude' });
      bash.hooks = entries;
    } else {
      next.push({ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook claude' }] });
    }
    changed = true;
  }
  if (!changed) return true;
  if (next.length > 0) hooks.PreToolUse = next;
  else delete hooks.PreToolUse;
  if (Object.keys(hooks).length > 0) data.hooks = hooks;
  else delete data.hooks;
  try {
    mkdirSync(claudeHome(), { recursive: true });
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}
