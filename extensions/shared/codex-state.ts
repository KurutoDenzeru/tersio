// Codex plugin paths and installed state, without the mode bodies or any extension runtime imports.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPackageRoot, homeDir } from './utils.ts';

export const CODEX_PLUGIN_NAME = 'tersio';
export const CODEX_MARKETPLACE_NAME = 'tersio';
export const CODEX_PLUGIN_ID = `${CODEX_PLUGIN_NAME}@${CODEX_MARKETPLACE_NAME}`;

export const CODEX_PLUGIN_FILES = [
  'plugin.json',
  'mcp.json',
  'hooks/hooks.json',
  'skills/combo/SKILL.md',
  'skills/caveman/SKILL.md',
  'skills/ponytail/SKILL.md',
  'skills/pstack/SKILL.md',
  'skills/rtk/SKILL.md',
  'skills/headroom/SKILL.md',
  'skills/tersio/SKILL.md',
  'skills/tersio-modes/SKILL.md',
] as const;

const ROOT = findPackageRoot(dirname(fileURLToPath(import.meta.url)));

/** Codex keeps its user state here; `CODEX_HOME` is the supported relocation override. */
export function codexHome(): string {
  const override = (process.env.CODEX_HOME ?? '').trim();
  return override || join(homeDir(), '.codex');
}

export function codexConfigFile(): string {
  return join(codexHome(), 'config.toml');
}

/** The repository marketplace the plugin ships beside. */
export function codexMarketplaceFile(root = ROOT): string {
  return join(root, '.agents', 'plugins', 'marketplace.json');
}

/** The portable plugin directory inside this package. */
export function codexPackagedPluginDir(root = ROOT): string {
  return join(root, 'plugins', CODEX_PLUGIN_NAME);
}

function pluginCacheRoot(): string {
  return join(codexHome(), 'plugins', 'cache', CODEX_MARKETPLACE_NAME, CODEX_PLUGIN_NAME);
}

function versionDirs(): string[] {
  try {
    return readdirSync(pluginCacheRoot(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(pluginCacheRoot(), entry.name))
      .toSorted((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  } catch {
    return [];
  }
}

export function codexPluginVersion(dir: string): string | null {
  try {
    const manifest = JSON.parse(readFileSync(join(dir, 'plugin.json'), 'utf8')) as { version?: unknown };
    return typeof manifest.version === 'string' ? manifest.version : null;
  } catch {
    return null;
  }
}

/** Whether Codex has enabled this plugin in its config, not merely downloaded its cache. */
export function codexPluginEnabled(pluginId = CODEX_PLUGIN_ID): boolean {
  let text: string;
  try {
    text = readFileSync(codexConfigFile(), 'utf8');
  } catch {
    return false;
  }
  const header = `[plugins."${pluginId}"]`;
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim() === header);
  if (start < 0) return false;
  const end = lines.findIndex((line, i) => i > start && /^\s*\[/.test(line));
  return lines.slice(start + 1, end === -1 ? undefined : end).some((line) => /^\s*enabled\s*=\s*true\s*$/.test(line));
}

export interface CodexPluginState {
  dir: string | null;
  version: string | null;
  complete: boolean;
  enabled: boolean;
  missing: string[];
}

export function codexPluginState(dir: string | null = versionDirs()[0] ?? null): CodexPluginState {
  if (dir === null)
    return { dir: null, version: null, complete: false, enabled: false, missing: [...CODEX_PLUGIN_FILES] };
  const missing = CODEX_PLUGIN_FILES.filter((file) => !existsSync(join(dir, ...file.split('/'))));
  return {
    dir,
    version: codexPluginVersion(dir),
    complete: missing.length === 0,
    enabled: codexPluginEnabled(),
    missing,
  };
}

/** The newest cached copy, with enough detail for the installer, doctor, and uninstall to agree. */
export function installedCodexPlugin(): CodexPluginState {
  return (
    versionDirs()
      .map((dir) => codexPluginState(dir))
      .find((state) => state.complete) ?? codexPluginState()
  );
}

/** A complete and enabled plugin is the only state Codex actually loads. */
export function codexPluginInstalled(): boolean {
  const state = installedCodexPlugin();
  return state.complete && state.enabled;
}

/** The absolute directory a local marketplace registration should name. */
export function codexMarketplaceRoot(): string {
  return resolve(ROOT);
}
