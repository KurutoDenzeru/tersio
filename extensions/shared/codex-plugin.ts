// Codex loads Tersio as a plugin; this module owns its paths, installed state, and mode context.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPonytailInstructions } from '../ponytail/hooks/ponytail-instructions.ts';
import { normalizeInputCommand, normalizeMode } from './session-state.ts';
import { readPluginSettings, tersioSettingsFile } from './plugin-settings.ts';
import { codexHome, codexPackagedPluginDir } from './codex-state.ts';
import { ruleDir, tersioHome } from './utils.ts';
export {
  CODEX_MARKETPLACE_NAME, CODEX_PLUGIN_FILES, CODEX_PLUGIN_ID, CODEX_PLUGIN_NAME,
  codexConfigFile, codexHome, codexMarketplaceFile, codexMarketplaceRoot, codexPackagedPluginDir,
  codexPluginEnabled, codexPluginInstalled, codexPluginState, codexPluginVersion, installedCodexPlugin,
} from './codex-state.ts';
export type { CodexPluginState } from './codex-state.ts';

const CAVEMAN_DIR = ruleDir('caveman', dirname(fileURLToPath(import.meta.url)));
const PSTACK_DIR = ruleDir('pstack', dirname(fileURLToPath(import.meta.url)));

/** The marketplace Tersio materializes for a GUI-launched Codex, where PATH is not the shell's. */
export function codexLocalMarketplaceRoot(): string {
  return join(tersioHome(), 'codex-marketplace');
}

export const CODEX_PROMPT_NAMES = ['combo', 'caveman', 'rtk', 'ponytail', 'pstack', 'tersio'] as const;
export type CodexPromptName = (typeof CODEX_PROMPT_NAMES)[number];
export const CODEX_PROMPT_MARKER = '<!-- tersio-managed prompt -->';

/** Codex custom prompts are deprecated but remain the only local slash-command surface. */
export function codexPromptsDir(): string {
  return join(codexHome(), 'prompts');
}

export function codexPromptFiles(): Record<CodexPromptName, string> {
  return Object.fromEntries(
    CODEX_PROMPT_NAMES.map((name) => [name, readSourcePlugin(`prompts/${name}.md`)]),
  ) as Record<CodexPromptName, string>;
}

function readSourcePlugin(rel: string): string {
  return readFileSync(join(codexPackagedPluginDir(), ...rel.split('/')), 'utf8');
}

/**
 * The local marketplace with absolute launch commands. The repo marketplace stays the distributable
 * copy; this one makes the plugin work when Codex is launched without a shell PATH.
 */
export function codexLocalPluginFiles(runtime = process.execPath, cli = process.argv[1] ?? ''): Record<string, string> {
  if (!isAbsolute(cli)) throw new Error('Codex plugin needs an absolute CLI path');
  const cliPath = cli;
  const hookCommand = `"${runtime}" "${cliPath}" codex-hook user-prompt-submit`;
  const mcp = JSON.parse(readSourcePlugin('mcp.json')) as {
    $schema?: string;
    mcpServers?: Record<string, Record<string, unknown>>;
  };
  mcp.mcpServers ??= {};
  mcp.mcpServers.tersio = { ...mcp.mcpServers.tersio, type: 'stdio', command: runtime, args: [cliPath, 'mcp'] };

  const hooks = JSON.parse(readSourcePlugin('hooks/hooks.json')) as {
    description?: string;
    hooks?: Record<string, Array<{ hooks?: Array<Record<string, unknown>> }>>;
  };
  const handler = hooks.hooks?.UserPromptSubmit?.[0]?.hooks?.[0];
  if (handler) handler.command = hookCommand;

  return {
    '.agents/plugins/marketplace.json': `${JSON.stringify({
      name: 'tersio',
      interface: { displayName: 'Tersio' },
      plugins: [{
        name: 'tersio',
        source: { source: 'local', path: './plugins/tersio' },
        policy: { installation: 'AVAILABLE', authentication: 'ON_USE', products: ['CODEX'] },
        category: 'Developer Tools',
      }],
    }, null, 2)}\n`,
    'plugins/tersio/plugin.json': readSourcePlugin('plugin.json'),
    'plugins/tersio/mcp.json': `${JSON.stringify(mcp, null, 2)}\n`,
    'plugins/tersio/hooks/hooks.json': `${JSON.stringify(hooks, null, 2)}\n`,
    'plugins/tersio/skills/tersio-modes/SKILL.md': readSourcePlugin('skills/tersio-modes/SKILL.md'),
  };
}

function cavemanInstruction(mode: string): string {
  const files: Record<string, string> = {
    lite: 'rule-lite.md',
    full: 'rule.md',
    ultra: 'rule-ultra.md',
    'megacave-lite': 'rule-megacave-lite.md',
    'megacave-full': 'rule-megacave.md',
    'megacave-ultra': 'rule-megacave-ultra.md',
  };
  const file = files[mode] ?? 'rule.md';
  try {
    return `Caveman ${mode} active for this session.\n${readFileSync(join(CAVEMAN_DIR, file), 'utf8')}`;
  } catch {
    return `Caveman ${mode} requested, but ${file} is missing. Run: tersio install --host codex`;
  }
}

function pstackInstruction(): string {
  try {
    const body = readFileSync(join(PSTACK_DIR, 'rule.md'), 'utf8');
    return `pstack mode active for this session.\n${body}\nLeaves, playbooks, and skills live at: ${PSTACK_DIR}.`;
  } catch {
    return 'pstack mode requested, but rule.md is missing. Run: tersio install --host codex';
  }
}

/**
 * The developer context Codex receives before each prompt. Codex's own mode switches live
 * in the `hosts.codex` section, so a dashboard scope and the hook read the same value.
 */
export function codexModeContext(): string {
  const caveman = normalizeMode('caveman', readMode('cavemanDefault'));
  const ponytail = normalizeMode('ponytail', readMode('ponytailDefault'));
  const pstack = normalizeMode('pstack', readMode('pstackDefault'));
  const blocks: string[] = [];
  if (caveman && caveman !== 'off') blocks.push(cavemanInstruction(caveman));
  if (ponytail && ponytail !== 'off') blocks.push(getPonytailInstructions(ponytail));
  if (pstack === 'on') blocks.push(pstackInstruction());
  return blocks.join('\n\n');
}

function readMode(key: 'cavemanDefault' | 'ponytailDefault' | 'pstackDefault'): unknown {
  const scoped = (readPluginSettings().hosts as Record<string, Record<string, unknown>> | undefined)?.codex?.[key];
  return scoped ?? readPluginSettings()[key];
}

/** A stop phrase is the whole message, so "add normal mode to the design" changes nothing. */
export function codexStopPatch(prompt: unknown): Record<string, string> | null {
  const text = normalizeInputCommand(prompt);
  if (text === 'normal mode') return { cavemanDefault: 'off', ponytailDefault: 'off', pstackDefault: 'off' };
  if (text === 'stop caveman' || text === 'caveman off') return { cavemanDefault: 'off' };
  if (text === 'stop ponytail' || text === 'ponytail off') return { ponytailDefault: 'off' };
  if (text === 'pstack off') return { pstackDefault: 'off' };
  return null;
}

/** Persist a stop phrase as a Codex-only override, so a later shared default cannot turn it back on. */
export function applyCodexStopPatch(patch: Record<string, string>): void {
  const file = tersioSettingsFile();
  const stored = readPluginSettings();
  const hosts = { ...(stored.hosts as Record<string, Record<string, unknown>> | undefined) };
  hosts.codex = { ...hosts.codex, ...patch };
  writeFileSync(file, `${JSON.stringify({ ...stored, hosts }, null, 2)}\n`, 'utf8');
}

/** The JSON output Codex expects from a prompt hook. An empty context is a successful no-op. */
export function codexHookOutput(context: string): Record<string, unknown> {
  if (context.trim() === '') return { continue: true };
  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: context,
    },
  };
}
