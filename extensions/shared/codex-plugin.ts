// The Codex plugin tree and the mode context its hooks add to every turn.
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, type Dirent } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCavemanDefault, readComboDefault, readPluginSettings, readPonytailDefault, readPstackDefault } from './plugin-settings.ts';
import { COMBO_LEVELS, normalizeMode } from './session-state.ts';
import { findPackageRoot, homeDir } from './utils.ts';
import type { ComboState } from './types.ts';

/** The marketplace name a plugin install from this checkout registers under. */
export const CODEX_MARKETPLACE_NAME = 'tersio';
/** The marketplace name installs before the rename used; kept so their cache dirs and ids stay visible. */
export const CODEX_PERSONAL_MARKETPLACE_LEGACY = 'tersio-personal';
export const CODEX_PLUGIN_NAME = 'tersio';
export const CODEX_PLUGIN_ID = `${CODEX_PLUGIN_NAME}@${CODEX_MARKETPLACE_NAME}`;
export const CODEX_MARKETPLACE_SOURCE = 'KurutoDenzeru/tersio';
export const CODEX_MARKETPLACE_SPARSE = ['.agents/plugins', `plugins/${CODEX_PLUGIN_NAME}`] as const;
/** Codex discovers this marketplace without a registration command. */
export function codexPersonalMarketplaceFile(): string {
  return path.join(homeDir(), '.agents', 'plugins', 'marketplace.json');
}
export function codexPersonalPluginDir(): string {
  return path.join(homeDir(), '.tersio', 'codex-plugin');
}
const ROOT = findPackageRoot(path.dirname(fileURLToPath(import.meta.url)));
const EXTENSIONS = path.join(ROOT, 'extensions');
const PONYTAIL = path.join(EXTENSIONS, 'ponytail');

/** The pstack leaves the bundled plugin carries beside its rule: the shipped tree is the same set. */
const PSTACK_LEAF_FILES: readonly string[] = ((): readonly string[] => {
  const base = path.join(EXTENSIONS, 'pstack');
  const walk = (dir: string): string[] => {
    let entries: Dirent[] = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return []; }
    return entries.flatMap((entry) => {
      const rel = `extensions/pstack/${path.relative(base, path.join(dir, entry.name)).split(path.sep).join('/')}`;
      if (entry.isDirectory()) return walk(path.join(dir, entry.name));
      return entry.name.endsWith('.md') && entry.name !== 'rule.md' ? [rel] : [];
    });
  };
  return walk(base).toSorted();
})();

/** The files a marketplace plugin carries. Its commands use the Tersio CLI on PATH. */
export const CODEX_MARKETPLACE_PLUGIN_FILES: readonly string[] = [
  '.codex-plugin/plugin.json',
  '.mcp.json',
  'hooks/hooks.json',
  'package.json',
];
/** The complete local fallback: the marketplace files plus a self-contained CLI runtime. */
export const CODEX_BUNDLED_PLUGIN_FILES: readonly string[] = [
  ...CODEX_MARKETPLACE_PLUGIN_FILES,
  'tersio',
  'dist/tersio.js',
  'extensions/caveman/rule.md',
  'extensions/caveman/rule-lite.md',
  'extensions/caveman/rule-ultra.md',
  'extensions/caveman/rule-megacave-lite.md',
  'extensions/caveman/rule-megacave.md',
  'extensions/caveman/rule-megacave-ultra.md',
  'extensions/ponytail/hooks/ponytail-instructions.js',
  'extensions/pstack/rule.md',
  ...PSTACK_LEAF_FILES,
];
export type CodexPluginLayout = 'marketplace' | 'bundled';
/** The full runtime closure: copying only @clack leaves its hoisted dependencies behind. */
export const CODEX_RUNTIME_PACKAGES = [
  '@clack/core',
  '@clack/prompts',
  'fast-string-truncated-width',
  'fast-string-width',
  'fast-wrap-ansi',
  'sisteransi',
] as const;

function read(root: string, file: string): string {
  return readFileSync(path.join(root, ...file.split('/')), 'utf8');
}

export function codexPluginManifest(): string {
  const pkg = JSON.parse(read(ROOT, 'package.json')) as { version?: unknown };
  const version = typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  return `${JSON.stringify({
    name: CODEX_PLUGIN_NAME,
    version,
    description: '✂️ Token saver and usage tracker for coding agents.',
    author: { name: 'KurutoDenzeru' },
    homepage: 'https://github.com/KurutoDenzeru/tersio',
    repository: 'https://github.com/KurutoDenzeru/tersio',
    license: 'MIT',
    mcpServers: './.mcp.json',
    hooks: './hooks/hooks.json',
    interface: {
      displayName: 'Tersio',
      shortDescription: '✂️ Token saver and usage tracker for coding agents',
      longDescription: 'Terse Caveman replies, compact RTK shell output, lean Ponytail code, pstack rigor, and a gain dashboard — one command at a time.',
      developerName: 'KurutoDenzeru',
      category: 'Developer Tools',
      capabilities: ['Read', 'Write', 'Lifecycle hooks'],
      websiteURL: 'https://github.com/KurutoDenzeru/tersio',
      defaultPrompt: [
        'Show my Tersio mode status',
        'Show my local agent usage',
        'Set combo lite',
      ],
      composerIcon: './assets/icon.png',
      logo: './assets/icon.png',
      brandColor: '#D97706',
    },
  }, null, 2)}\n`;
}

/** The slash commands Tersio writes. Codex names each command after its file: `rtk.md` is `/rtk`. */
export const CODEX_PROMPT_MODES = ['combo', 'caveman', 'rtk', 'ponytail', 'pstack'] as const;
export type CodexPromptMode = (typeof CODEX_PROMPT_MODES)[number];
export const CODEX_PROMPTS = [...CODEX_PROMPT_MODES, 'tersio'] as const;
export type CodexPromptName = (typeof CODEX_PROMPTS)[number];
/** Older Tersio builds wrote a `tersio-` prefix; Codex then showed `/prompts:tersio-*`, so they are removed. */
export const CODEX_LEGACY_PROMPTS: readonly string[] = [...CODEX_PROMPT_MODES, 'status'].map((name) => `tersio-${name}`);

/** Codex reads custom prompts from `~/.codex/prompts/*.md`; a plugin cannot carry them. */
export function codexPromptsDir(): string {
  return path.join(homeDir(), '.codex', 'prompts');
}

export function codexPromptFile(name: string): string {
  return path.join(codexPromptsDir(), `${name}.md`);
}

/** Every command file this build writes, missing ones first. */
export function missingCodexPrompts(): string[] {
  return CODEX_PROMPTS
    .map((name) => codexPromptFile(name))
    .filter((file) => !existsSync(file));
}

/** True when Codex's config pre-approves Tersio's own MCP server. */
export function codexMcpPolicyInstalled(pluginId = CODEX_PLUGIN_ID): boolean {
  let text = '';
  try { text = readFileSync(codexConfigFile(), 'utf8'); } catch { return false; }
  const header = `[plugins."${pluginId}".mcp_servers.${CODEX_PLUGIN_NAME}]`;
  const start = text.split('\n').findIndex((line) => line.trim() === header);
  if (start === -1) return false;
  const lines = text.split('\n');
  const end = lines.findIndex((line, i) => i > start && /^\s*\[/.test(line));
  return lines.slice(start + 1, end === -1 ? undefined : end)
    .some((line) => /^\s*default_tools_approval_mode\s*=\s*"approve"/.test(line));
}

/** `rtk init -g --codex` writes a global hook that cannot read Tersio's RTK mode. */
export function codexStandaloneRtkHook(): boolean {
  try {
    const hooks = readFileSync(path.join(homeDir(), '.codex', 'hooks.json'), 'utf8');
    return /\brtk(?:\.exe)?\s+hook\s+codex\b/i.test(hooks);
  } catch {
    return false;
  }
}

/** The values each command takes. `status` reads the current value and changes nothing. */
const PROMPT_LEVELS: Readonly<Record<CodexPromptMode, readonly string[]>> = {
  combo: ['off', 'lite', 'balanced', 'max', 'status', 'help'],
  caveman: ['off', 'lite', 'full', 'ultra', 'megacave-lite', 'megacave-full', 'megacave-ultra', 'wenyan', 'wenyan-lite', 'wenyan-full', 'wenyan-ultra', 'status'],
  rtk: ['on', 'enable', 'enabled', 'true', 'off', 'disable', 'disabled', 'false', 'status'],
  ponytail: ['off', 'lite', 'full', 'ultra', 'status'],
  pstack: ['on', 'off', 'status'],
};

/**
 * A custom prompt body. `$1` is the level the user typed after the command, so
 * `/caveman full` reads as a mode change without a second question. The body stays
 * short because Codex pastes it into the composer as the message: one command line,
 * and the CLI owns the alias mapping.
 */
export function codexPromptText(name: CodexPromptName, cli = 'tersio'): string {
  if (name === 'tersio') {
    return [
      '---',
      'description: Tersio status, help, update, upstream, or dashboard',
      'argument-hint: <status|help|update <ponytail|rtk|caveman|all> [--dry-run]|upstream [--offline]|dashboard>',
      '---',
      '',
      'Run the Tersio command named by `$1` with the shell tool, and report its output verbatim.',
      `The command is \`${cli} $1\`; \`update\` and \`upstream\` append \`--host codex\` plus their own flags.`,
      "For `status`, also call the `tersio_stats` MCP tool for usage and state each figure's range.",
      `Empty \`$1\` runs \`${cli} help\`.`,
      '',
    ].join('\n');
  }
  const mode = name;
  const levels = PROMPT_LEVELS[mode];
  const comboHelp = mode === 'combo' ? '`help` prints the preset table and changes nothing.\n' : '';
  const body = [
    `Run \`${cli} modes ${mode} $1\` with the shell tool and report its output verbatim.`,
    `Empty \`$1\` or \`status\` runs \`${cli} modes ${mode}\` and changes nothing.`,
    comboHelp +
    'The CLI accepts every alias, so pass `$1` through unchanged. This writes the session-start defaults, so the next prompt picks it up.',
  ].join('\n');
  return `---\ndescription: Set the Tersio ${mode} mode (${levels.join(', ')})\nargument-hint: <${levels.join('|')}>\n---\n\n${body}\n`;
}

/**
 * The plugin files. A bundled plugin runs its own CLI with the absolute Node path that installed it.
 * A marketplace plugin uses the Tersio CLI on PATH, because its source carries no build output.
 */
export function codexPluginFiles(
  bundled = true,
  nodePath = process.execPath,
  bundledLauncher = '${PLUGIN_ROOT}/tersio',
): Record<string, string> {
  const command = bundled ? `"${nodePath}" "\${PLUGIN_ROOT}/tersio"` : 'tersio';
  const files: Record<string, string> = {
    '.codex-plugin/plugin.json': codexPluginManifest(),
    '.mcp.json': `${JSON.stringify({
      mcpServers: {
        tersio: {
          command: bundled ? nodePath : 'tersio',
          args: bundled ? [bundledLauncher, 'mcp'] : ['mcp'],
          env: { TERSIO_MCP_RUNTIME: 'node' },
        },
      },
    }, null, 2)}\n`,
    'hooks/hooks.json': `${JSON.stringify({
      description: 'Tersio lifecycle hooks for Codex.',
      hooks: {
        // UserPromptSubmit runs before every prompt, including startup and resume.
        // It owns the context so one turn never receives the same mode block twice.
        UserPromptSubmit: [{
          hooks: [{
            type: 'command',
            command: `${command} codex-hook user-prompt-submit`,
            statusMessage: 'Refreshing Tersio modes',
          }],
        }],
        // Rewrites eligible shell commands through rtk when the RTK default is on.
        // Exit 0 with no rewrite leaves the call alone; the hook never denies.
        PreToolUse: [{
          matcher: '^Bash$',
          hooks: [{
            type: 'command',
            command: `${command} codex-hook pre-tool-use`,
            timeout: 5,
            statusMessage: 'Checking RTK rewrite',
          }],
        }],
      },
    }, null, 2)}\n`,
    'package.json': read(ROOT, 'package.json'),
  };
  if (bundled) files.tersio = `#!/usr/bin/env node\nimport ${JSON.stringify('./dist/tersio.js')};\n`;
  return files;
}
/** Add the Tersio entry to the personal marketplace, and keep every other entry. */
export function addCodexPersonalMarketplace(existing: string | null): string {
  let parsed: Record<string, unknown> = {};
  if (existing !== null) {
    try {
      const value: unknown = JSON.parse(existing);
      if (value && typeof value === 'object' && !Array.isArray(value)) parsed = value as Record<string, unknown>;
    } catch { /* replace an unreadable marketplace only when the user asked for this install */ }
  }
  const plugins = Array.isArray(parsed.plugins) ? [...parsed.plugins] : [];
  const entry = {
    name: CODEX_PLUGIN_NAME,
    source: {
      source: 'local',
      path: `./${path.relative(homeDir(), codexPersonalPluginDir()).split(path.sep).join('/')}`,
    },
    policy: {
      installation: 'AVAILABLE',
      authentication: 'ON_INSTALL',
    },
    category: 'Developer Tools',
  };
  const index = plugins.findIndex((plugin) => (
    plugin !== null
    && typeof plugin === 'object'
    && (plugin as { name?: unknown }).name === CODEX_PLUGIN_NAME
  ));
  if (index === -1) plugins.push(entry);
  else plugins[index] = entry;
  // A marketplace that still carries the pre-rename default reads as that name; migrate it.
  const existingName = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name : null;
  return `${JSON.stringify({
    ...parsed,
    name: existingName === CODEX_PERSONAL_MARKETPLACE_LEGACY ? CODEX_MARKETPLACE_NAME : existingName ?? CODEX_MARKETPLACE_NAME,
    interface: parsed.interface ?? { displayName: 'Tersio' },
    plugins,
  }, null, 2)}\n`;
}

/** The name Codex will use for the personal marketplace, including a user's existing name. */
export function codexPersonalMarketplaceName(existing: string | null): string {
  if (existing === null) return CODEX_MARKETPLACE_NAME;
  try {
    const value: unknown = JSON.parse(existing);
    if (value && typeof value === 'object' && !Array.isArray(value) && 'name' in value) {
      const name: unknown = value.name;
      // The pre-rename default migrates; a name the user chose stays.
      if (typeof name === 'string' && name.trim() && name !== CODEX_PERSONAL_MARKETPLACE_LEGACY) return name;
    }
  } catch { /* an unreadable file is replaced by the install */ }
  return CODEX_MARKETPLACE_NAME;
}

/** The plugin ID for the personal marketplace that is on disk. */
export function codexPersonalPluginId(existing: string | null): string {
  return `${CODEX_PLUGIN_NAME}@${codexPersonalMarketplaceName(existing)}`;
}

/** Remove only the Tersio entry. Keep a user's other personal plugins. */
export function removeCodexPersonalMarketplace(existing: string): string | null {
  let parsed: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(existing);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    parsed = value as Record<string, unknown>;
  } catch {
    return null;
  }
  const plugins = Array.isArray(parsed.plugins)
    ? parsed.plugins.filter((plugin) => (
      plugin === null
      || typeof plugin !== 'object'
      || (plugin as { name?: unknown }).name !== CODEX_PLUGIN_NAME
    ))
    : [];
  if (plugins.length === 0) return null;
  return `${JSON.stringify({ ...parsed, plugins }, null, 2)}\n`;
}

/** The plugin files the public marketplace package carries. */
export function codexMarketplacePluginFiles(): Record<string, string> {
  return codexPluginFiles(false);
}

/** The old direct writer is not a Codex registration, so keep its path only for cleanup. */
export function codexLegacyPluginDir(): string {
  return path.join(homeDir(), '.codex', 'plugins', CODEX_PLUGIN_NAME);
}

/** A missing mode body fails loud, so a requested mode never reads as active with no rule. */
function rule(name: string, file: string): string {
  try {
    return read(EXTENSIONS, `${name}/${file}`);
  } catch {
    return `Tersio ${name} mode requested, but ${file} is missing. Run: tersio install --host codex`;
  }
}

function cavemanRule(mode: string): string {
  const files: Record<string, string> = {
    lite: 'rule-lite.md',
    full: 'rule.md',
    ultra: 'rule-ultra.md',
    'megacave-lite': 'rule-megacave-lite.md',
    'megacave-full': 'rule-megacave.md',
    'megacave-ultra': 'rule-megacave-ultra.md',
  };
  return `Caveman ${mode} active for this session.\n${rule('caveman', files[mode] ?? 'rule.md')}`;
}

function ponytailRule(mode: string): string {
  try {
    const require = createRequire(import.meta.url);
    const loaded = require(path.join(PONYTAIL, 'hooks', 'ponytail-instructions.js')) as {
      getPonytailInstructions?: (level: string) => string;
      default?: { getPonytailInstructions?: (level: string) => string };
    };
    const build = loaded.getPonytailInstructions ?? loaded.default?.getPonytailInstructions;
    if (build) return build(mode);
  } catch { /* fall through to the bundled text */ }
  return `PONYTAIL MODE ACTIVE - level: ${mode}\nUse the minimum correct solution. Delete or reuse before adding.`;
}

function storedModes(): Pick<ComboState, 'caveman' | 'rtk' | 'ponytail' | 'pstack'> {
  const settings = readPluginSettings();
  const hasModeDefaults = ['cavemanDefault', 'rtkDefault', 'ponytailDefault', 'pstackDefault'].some((key) => key in settings);
  if (hasModeDefaults) {
    return {
      caveman: readCavemanDefault(),
      rtk: settings.rtkDefault === true ? 'on' : 'off',
      ponytail: readPonytailDefault(),
      pstack: readPstackDefault(),
    };
  }
  return { ...COMBO_LEVELS[readComboDefault()] ?? COMBO_LEVELS.off, pstack: 'off' };
}

/**
 * The RTK block the prompt hook adds. The PreToolUse hook rewrites eligible commands itself,
 * so this text explains the condensed results rather than asking the model to type `rtk`.
 */
const CODEX_RTK_CONTEXT = `RTK mode active for this session. Eligible shell commands (searches, listings, reads, package and test runs, version control, containers, linters, and data tools) are rewritten through the local rtk binary before they run, so their results arrive condensed: every signal kept, costly noise dropped. Treat a condensed result as complete. Re-run something unfiltered only when its result is empty, garbled, or contradicts its exit code. Call rtk directly for what the rewrite cannot express: rtk read <file>, rtk smart <file>, rtk err <cmd>, rtk gain, and rtk test <cmd>.`;

/** The mode blocks a Codex hook adds as developer context. Off modes add no text. */
export function codexModeContext(): string {
  const modes = storedModes();
  const blocks: string[] = [];
  const caveman = normalizeMode('caveman', modes.caveman);
  const ponytail = normalizeMode('ponytail', modes.ponytail);
  const pstack = normalizeMode('pstack', modes.pstack);
  if (caveman && caveman !== 'off') blocks.push(cavemanRule(caveman));
  if (ponytail && ponytail !== 'off') blocks.push(ponytailRule(ponytail));
  if (pstack === 'on') {
    const home = `Leaves, playbooks, and skills live at: ${EXTENSIONS}/pstack.`;
    blocks.push(`pstack mode active for this session.\n${rule('pstack', 'rule.md')}\n${home}`);
  }
  if (modes.rtk === 'on') blocks.push(CODEX_RTK_CONTEXT);
  return blocks.join('\n\n');
}

export function codexPluginDir(): string {
  return codexPersonalPluginDir();
}

function personalMarketplaceNames(): string[] {
  let name = CODEX_PERSONAL_MARKETPLACE_LEGACY;
  try {
    name = codexPersonalMarketplaceName(readFileSync(codexPersonalMarketplaceFile(), 'utf8'));
  } catch { /* no personal marketplace */ }
  return [...new Set([CODEX_MARKETPLACE_NAME, CODEX_PERSONAL_MARKETPLACE_LEGACY, name])];
}

/** The expected file set for a path. The local fallback is bundled; a marketplace cache is not. */
export function codexPluginLayoutForDir(dir: string): CodexPluginLayout {
  const normalized = path.resolve(dir);
  if (normalized === path.resolve(codexPersonalPluginDir())) return 'bundled';
  // The bundled copy carries the extension tree and the marketplace package does not, so the
  // content decides: after the rename, both marketplaces can own a cache path named `tersio`.
  if (existsSync(path.join(normalized, 'extensions', 'caveman', 'rule.md'))) return 'bundled';
  return 'marketplace';
}

export function codexPluginFilesForLayout(layout: CodexPluginLayout): readonly string[] {
  return layout === 'bundled' ? CODEX_BUNDLED_PLUGIN_FILES : CODEX_MARKETPLACE_PLUGIN_FILES;
}

export function codexPluginInstalled(dir = codexPluginDir(), layout = codexPluginLayoutForDir(dir)): boolean {
  return codexPluginFilesForLayout(layout).every((file) => existsSync(path.join(dir, ...file.split('/'))));
}

export interface CodexPluginState {
  dir: string;
  pluginId: string | null;
  layout: CodexPluginLayout;
  version: string | null;
  complete: boolean;
  enabled: boolean;
  missing: string[];
}

function pluginVersion(dir: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(path.join(dir, '.codex-plugin', 'plugin.json'), 'utf8')) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

/**
 * The install on disk. A partial cache is not a valid install, but its marketplace and ID still
 * let a repair run `plugin add` again.
 */
export function codexPluginState(dir: string): CodexPluginState {
  const layout = codexPluginLayoutForDir(dir);
  const files = codexPluginFilesForLayout(layout);
  const missing = files.filter((file) => !existsSync(path.join(dir, ...file.split('/'))));
  const pluginId = codexPluginIdForDir(dir);
  return {
    dir,
    pluginId,
    layout,
    version: pluginVersion(dir),
    complete: missing.length === 0,
    enabled: pluginId !== null && codexPluginEnabled(pluginId),
    missing,
  };
}

/** A directory Codex registered, even when the cache is short of files. */
export function codexRegisteredPluginState(): CodexPluginState | null {
  return codexExistingPluginDirs().map(codexPluginState).find((state) => state.enabled) ?? null;
}

/** A marketplace install lives under the cache; a direct install lives at the local plugin path. */
export function codexPluginInstallDirs(): string[] {
  const cacheRoot = path.join(homeDir(), '.codex', 'plugins', 'cache');
  const names = [...new Set([CODEX_MARKETPLACE_NAME, ...personalMarketplaceNames()])];
  const dirs: string[] = [];
  for (const name of names) {
    const root = path.join(cacheRoot, name, CODEX_PLUGIN_NAME);
    let versions: string[] = [];
    try {
      versions = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .toSorted((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    } catch { /* no cache for this marketplace */ }
    dirs.push(...versions.map((version) => path.join(root, version)));
  }
  return [...dirs, codexPluginDir()];
}

/**
 * Every Tersio plugin directory that exists, including a partial download with no manifest.
 * Doctor and install can then repair the directory instead of treating it as absent.
 */
export function codexExistingPluginDirs(): string[] {
  const cacheRoot = path.join(homeDir(), '.codex', 'plugins', 'cache');
  const names = [...new Set([CODEX_MARKETPLACE_NAME, ...personalMarketplaceNames()])];
  const dirs: string[] = [];
  for (const name of names) {
    const root = path.join(cacheRoot, name, CODEX_PLUGIN_NAME);
    let versions: string[] = [];
    try {
      versions = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .toSorted((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    } catch { /* no cache for this marketplace */ }
    dirs.push(...versions.map((version) => path.join(root, version)));
  }
  if (existsSync(codexPersonalPluginDir())) dirs.push(codexPersonalPluginDir());
  return dirs;
}

/** The plugin ID Codex reads for a cache path, or the personal ID for the local fallback. */
export function codexPluginIdForDir(dir: string): string | null {
  const normalized = path.resolve(dir);
  if (normalized === path.resolve(codexPersonalPluginDir())) {
    let existing: string | null = null;
    try { existing = readFileSync(codexPersonalMarketplaceFile(), 'utf8'); } catch { /* no file */ }
    return codexPersonalPluginId(existing);
  }
  const cacheRoot = path.resolve(homeDir(), '.codex', 'plugins', 'cache');
  const relative = path.relative(cacheRoot, normalized);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  const [marketplace, plugin] = relative.split(path.sep);
  if (!marketplace || plugin !== CODEX_PLUGIN_NAME) return null;
  return `${plugin}@${marketplace}`;
}

/** Whether Codex enables this plugin. A complete directory alone does not load. */
export function codexPluginEnabled(pluginId = CODEX_PLUGIN_ID): boolean {
  const config = path.join(homeDir(), '.codex', 'config.toml');
  let text = '';
  try {
    text = readFileSync(config, 'utf8');
  } catch {
    return false;
  }
  const escaped = pluginId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\[plugins\\."${escaped}"\\]\\s*\\n(?:[^\\n]*\\n)*?enabled\\s*=\\s*true`, 'm').test(text);
}

/** The file Codex reads for plugin enablement and plugin-scoped MCP policy. */
export function codexConfigFile(): string {
  return path.join(homeDir(), '.codex', 'config.toml');
}

const TERTSIO_MCP_POLICY = 'default_tools_approval_mode = "approve"';

/**
 * Codex asks before an MCP tool call, so a session with approvals off cannot set a mode. A plugin
 * may declare its own server policy, so Tersio marks its server as pre-approved. Every other
 * section stays byte for byte, and an existing Tersio table is rewritten in place.
 */
export function addCodexMcpPolicy(existing: string | null, pluginId: string): string {
  const header = `[plugins."${pluginId}".mcp_servers.${CODEX_PLUGIN_NAME}]`;
  const lines = (existing ?? '').split('\n');
  const start = lines.findIndex((line) => line.trim() === header);
  if (start !== -1) {
    let end = lines.findIndex((line, i) => i > start && /^\s*\[/.test(line));
    if (end === -1) end = lines.length;
    const body = lines.slice(start + 1, end);
    const kept = body.filter((line) => !/^\s*default_tools_approval_mode\s*=/.test(line));
    while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop();
    const tail = lines.slice(end);
    const next = [...lines.slice(0, start), header, ...kept, TERTSIO_MCP_POLICY, ...(tail.length > 0 ? ['', ...tail] : [])];
    return `${next.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
  }
  const base = (existing ?? '').trimEnd();
  return `${base}${base ? '\n\n' : ''}${header}\n${TERTSIO_MCP_POLICY}\n`;
}

/** Remove only Tersio's server table, so the user's other plugin policy stays byte for byte. */
export function removeCodexMcpPolicy(existing: string | null, pluginId: string): string | null {
  if (existing === null) return null;
  const lines = existing.split('\n');
  const header = `[plugins."${pluginId}".mcp_servers.${CODEX_PLUGIN_NAME}]`;
  const start = lines.findIndex((line) => line.trim() === header);
  if (start === -1) return existing;
  const end = lines.findIndex((line, i) => i > start && /^\s*\[/.test(line));
  const kept = [...lines.slice(0, start), ...lines.slice(end === -1 ? lines.length : end)];
  return `${kept.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

/** The first complete install, and its manifest version when the manifest is readable. */
export function codexInstalledPlugin(): { dir: string; version: string | null; layout: CodexPluginLayout } | null {
  for (const dir of codexPluginInstallDirs()) {
    const layout = codexPluginLayoutForDir(dir);
    if (!codexPluginInstalled(dir, layout)) continue;
    return { dir, version: pluginVersion(dir), layout };
  }
  return null;
}
