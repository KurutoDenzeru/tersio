// Codex loads Tersio as a plugin; this module owns its paths, installed state, and mode context.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPonytailInstructions } from '../ponytail/hooks/ponytail-instructions.ts';
import { deriveLevel, normalizeInputCommand, normalizeMode } from './session-state.ts';
import { formatStatus } from './status.ts';
import { readPluginSettings } from './plugin-settings.ts';
import { CODEX_PLUGIN_FILES, codexHome, codexPackagedPluginDir } from './codex-state.ts';
import { ruleDir, tersioHome } from './utils.ts';
export {
  CODEX_MARKETPLACE_NAME,
  CODEX_PLUGIN_FILES,
  CODEX_PLUGIN_ID,
  CODEX_PLUGIN_NAME,
  codexConfigFile,
  codexHome,
  codexMarketplaceFile,
  codexMarketplaceRoot,
  codexPackagedPluginDir,
  codexPluginEnabled,
  codexPluginInstalled,
  codexPluginState,
  codexPluginVersion,
  installedCodexPlugin,
} from './codex-state.ts';
export type { CodexPluginState } from './codex-state.ts';

const CAVEMAN_DIR = ruleDir('caveman', dirname(fileURLToPath(import.meta.url)));
const PSTACK_DIR = ruleDir('pstack', dirname(fileURLToPath(import.meta.url)));
const CODEX_SESSION_MODES_FILE = 'codex-session-modes.json';
const CODEX_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CODEX_SESSION_LIMIT = 100;

type CodexModePatch = Record<string, string | boolean>;
type CodexSessionModes = Record<string, string | boolean | number>;
/** One stored mode value, as the settings file and the session map both hold it. */
type SessionModeValue = string | boolean | number;

/** The marketplace Tersio materializes for a GUI-launched Codex, where PATH is not the shell's. */
export function codexLocalMarketplaceRoot(): string {
  return join(tersioHome(), 'codex-marketplace');
}

export const CODEX_PROMPT_NAMES = ['combo', 'caveman', 'rtk', 'ponytail', 'pstack', 'headroom', 'tersio'] as const;
export type CodexPromptName = (typeof CODEX_PROMPT_NAMES)[number];
/** Prefix of the marker every managed prompt and uninstall check matches, with or without a command name. */
export const CODEX_PROMPT_MARKER = '<!-- tersio-managed prompt';
/** Ends a prompt body; Codex appends the typed argument (or the raw `argument-hint`) after it. */
export const CODEX_ARGS_MARKER = '<!-- tersio-args -->';
const CODEX_COMBO_PRESETS: Record<string, { caveman: string; rtk: boolean; ponytail: string }> = {
  off: { caveman: 'off', rtk: false, ponytail: 'off' },
  lite: { caveman: 'lite', rtk: true, ponytail: 'lite' },
  balanced: { caveman: 'full', rtk: true, ponytail: 'full' },
  max: { caveman: 'ultra', rtk: true, ponytail: 'ultra' },
};

/** Codex custom prompts are deprecated but remain the only local slash-command surface. */
export function codexPromptsDir(): string {
  return join(codexHome(), 'prompts');
}

export function codexPromptFiles(): Record<CodexPromptName, string> {
  return Object.fromEntries(CODEX_PROMPT_NAMES.map((name) => [name, readSourcePlugin(`prompts/${name}.md`)])) as Record<
    CodexPromptName,
    string
  >;
}

/**
 * A plugin JSON file this package ships. A broken one stops the install with a named file instead of
 * a bare SyntaxError, so a half-written plugin is never registered.
 */
function readSourceJson<T>(rel: string): T {
  const text = readSourcePlugin(rel);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Codex plugin file ${rel} is not valid JSON`);
  }
}

function readSourcePlugin(rel: string): string {
  return readFileSync(join(codexPackagedPluginDir(), ...rel.split('/')), 'utf8');
}

/**
 * The local marketplace with absolute launch commands. The repo marketplace stays the distributable
 * copy; this one makes the plugin work when Codex is launched without a shell PATH.
 */
/** The one command both hook surfaces run, so the plugin copy and the user-level copy cannot drift. */
export function codexHookCommand(runtime = process.execPath, cli = process.argv[1] ?? ''): string {
  if (!isAbsolute(cli)) throw new Error('Codex plugin needs an absolute CLI path');
  return `"${runtime}" "${cli}" codex-hook user-prompt-submit`;
}

export function codexLocalPluginFiles(runtime = process.execPath, cli = process.argv[1] ?? ''): Record<string, string> {
  const cliPath = cli;
  const hookCommand = codexHookCommand(runtime, cli);
  const mcp = readSourceJson<{
    $schema?: string;
    mcpServers?: Record<string, Record<string, unknown>>;
  }>('mcp.json');
  mcp.mcpServers ??= {};
  mcp.mcpServers.tersio = { ...mcp.mcpServers.tersio, type: 'stdio', command: runtime, args: [cliPath, 'mcp'] };

  const hooks = readSourceJson<{
    description?: string;
    hooks?: Record<string, Array<{ hooks?: Array<Record<string, unknown>> }>>;
  }>('hooks/hooks.json');
  const handler = hooks.hooks?.UserPromptSubmit?.[0]?.hooks?.[0];
  if (handler) handler.command = hookCommand;

  const files: Record<string, string> = {
    '.agents/plugins/marketplace.json': `${JSON.stringify(
      {
        name: 'tersio',
        interface: { displayName: 'Tersio' },
        plugins: [
          {
            name: 'tersio',
            source: { source: 'local', path: './plugins/tersio' },
            policy: { installation: 'AVAILABLE', authentication: 'ON_USE', products: ['CODEX'] },
            category: 'Developer Tools',
          },
        ],
      },
      null,
      2,
    )}\n`,
    'plugins/tersio/plugin.json': readSourcePlugin('plugin.json'),
    'plugins/tersio/mcp.json': `${JSON.stringify(mcp, null, 2)}\n`,
    'plugins/tersio/hooks/hooks.json': `${JSON.stringify(hooks, null, 2)}\n`,
  };
  for (const rel of CODEX_PLUGIN_FILES) {
    if (rel.startsWith('skills/')) files[`plugins/tersio/${rel}`] = readSourcePlugin(rel);
  }
  return files;
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

/** Every mode a slash command can override for one session. */
const SESSION_MODE_KEYS = [
  'comboDefault',
  'cavemanDefault',
  'rtkDefault',
  'ponytailDefault',
  'pstackDefault',
  'headroomDefault',
] as const;
type SessionModeKey = (typeof SESSION_MODE_KEYS)[number];

function sessionKey(value: unknown): string | null {
  const key = String(value ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .slice(0, 160);
  return key || null;
}

function codexSessionFile(): string {
  return join(tersioHome(), CODEX_SESSION_MODES_FILE);
}

function readCodexSessions(): Record<string, CodexSessionModes> {
  try {
    const parsed = JSON.parse(readFileSync(codexSessionFile(), 'utf8')) as Record<string, unknown>;
    const out: Record<string, CodexSessionModes> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const row = value as Record<string, unknown>;
      const entry: CodexSessionModes = { updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : 0 };
      for (const mode of SESSION_MODE_KEYS) {
        if (typeof row[mode] === 'string' || typeof row[mode] === 'boolean')
          entry[mode] = row[mode] as string | boolean;
      }
      out[key] = entry;
    }
    return out;
  } catch {
    return {};
  }
}

function readSessionMode(sessionId: unknown, key: string): SessionModeValue | undefined {
  const id = sessionKey(sessionId);
  if (!id) return undefined;
  return readCodexSessions()[id]?.[key];
}

/** Keep the session map bounded: old Codex sessions cannot apply a mode anymore. */
function pruneCodexSessions(sessions: Record<string, CodexSessionModes>, now: number): void {
  for (const [key, value] of Object.entries(sessions)) {
    if (now - Number(value.updatedAt) > CODEX_SESSION_TTL_MS) delete sessions[key];
  }
  const keep = new Set(
    Object.entries(sessions)
      .toSorted(([, a], [, b]) => Number(b.updatedAt) - Number(a.updatedAt))
      .slice(0, CODEX_SESSION_LIMIT)
      .map(([key]) => key),
  );
  for (const key of Object.keys(sessions)) if (!keep.has(key)) delete sessions[key];
}

/**
 * The developer context Codex receives before each prompt. Codex's own mode switches live
 * in the `hosts.codex` section; a slash command overlays that per `session_id`.
 */
export function codexModeContext(sessionId?: unknown): string {
  const caveman = normalizeMode('caveman', readMode('cavemanDefault', sessionId));
  const ponytail = normalizeMode('ponytail', readMode('ponytailDefault', sessionId));
  const pstack = normalizeMode('pstack', readMode('pstackDefault', sessionId));
  const blocks: string[] = [];
  if (caveman && caveman !== 'off') blocks.push(cavemanInstruction(caveman));
  if (ponytail && ponytail !== 'off') blocks.push(getPonytailInstructions(ponytail));
  if (pstack === 'on') blocks.push(pstackInstruction());
  return blocks.join('\n\n');
}

/**
 * The one combo line every Tersio surface renders, sent to Codex as its own `systemMessage`.
 * Codex Desktop gives a plugin no status bar, so this hook line is the closest parity with DSH.
 */
export function codexStatusLine(sessionId?: unknown): string {
  const modes = {
    caveman: normalizeMode('caveman', readMode('cavemanDefault', sessionId)) ?? 'off',
    rtk: normalizeMode('rtk', readMode('rtkDefault', sessionId)) ?? 'off',
    ponytail: normalizeMode('ponytail', readMode('ponytailDefault', sessionId)) ?? 'off',
    pstack: normalizeMode('pstack', readMode('pstackDefault', sessionId)) ?? 'off',
    headroom: normalizeMode('headroom', readMode('headroomDefault', sessionId)) ?? 'off',
  };
  return formatStatus({ level: deriveLevel(modes), ...modes });
}

function readMode(key: SessionModeKey, sessionId?: unknown): SessionModeValue | undefined {
  const session = readSessionMode(sessionId, key);
  if (session !== undefined) return session;
  const scoped = (readPluginSettings().hosts as Record<string, Record<string, unknown>> | undefined)?.codex?.[key];
  const stored = scoped ?? readPluginSettings()[key];
  return typeof stored === 'string' || typeof stored === 'boolean' || typeof stored === 'number' ? stored : undefined;
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

/** Persist a mode change for one Codex session, leaving the host and shared defaults untouched. */
export function applyCodexModePatch(sessionId: unknown, patch: CodexModePatch): boolean {
  const id = sessionKey(sessionId);
  if (!id) return false;
  const now = Date.now();
  const sessions = readCodexSessions();
  sessions[id] = { ...(sessions[id] ?? { updatedAt: now }), ...patch, updatedAt: now };
  pruneCodexSessions(sessions, now);
  try {
    mkdirSync(tersioHome(), { recursive: true });
    writeFileSync(codexSessionFile(), `${JSON.stringify(sessions, null, 2)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Codex expands a custom prompt by sending its whole body, then the typed argument or the raw
 * `argument-hint` text. Recognising that body here answers the command without a model turn.
 */
export function codexManagedPrompt(prompt: unknown): { command: string; value: string } | null {
  const text = String(prompt ?? '').replace(/\r\n/g, '\n');
  const marker = text.match(/<!-- tersio-managed prompt: ([a-z]+) -->/);
  if (!marker || !text.includes(CODEX_ARGS_MARKER)) return null;
  const raw = text.slice(text.lastIndexOf(CODEX_ARGS_MARKER) + CODEX_ARGS_MARKER.length).trim();
  // An empty submission arrives as the literal placeholder, which is not a value.
  return { command: marker[1]!, value: raw.startsWith('<') && raw.endsWith('>') ? '' : raw.toLowerCase() };
}

/** Commands typed literally when Codex does not own a native slash alias for them. */
export function codexSlashCommand(
  prompt: unknown,
  sessionId?: unknown,
): { patch: CodexModePatch; message: string } | null {
  const text = normalizeInputCommand(prompt);
  const match = text.match(/^\/(combo|caveman|ponytail|pstack|rtk|headroom|tersio)(?:\s+(.+))?$/);
  if (!match) return null;
  const command = match[1]!;
  const value = (match[2] ?? '').trim().toLowerCase();
  if (command === 'combo') {
    if (value === 'help')
      return {
        patch: {},
        message:
          'Tersio Combo presets: off, lite, balanced, max. Use /combo <level>, or /combo status to read the current one.',
      };
    if (!value || value === 'status') {
      const current = String(readMode('comboDefault', sessionId) ?? 'custom');
      const caveman = String(readMode('cavemanDefault', sessionId) ?? 'off');
      const rtk = readMode('rtkDefault', sessionId) === true ? 'on' : 'off';
      const ponytail = String(readMode('ponytailDefault', sessionId) ?? 'off');
      return {
        patch: {},
        message: `Tersio Combo is ${current} (caveman=${caveman}, rtk=${rtk}, ponytail=${ponytail}). Use /combo off, lite, balanced, or max.`,
      };
    }
    const preset = CODEX_COMBO_PRESETS[value];
    if (!preset)
      return { patch: {}, message: `Tersio Combo: unknown level "${value}". Use off, lite, balanced, or max.` };
    return {
      patch: {
        comboDefault: value,
        cavemanDefault: preset.caveman,
        rtkDefault: preset.rtk,
        ponytailDefault: preset.ponytail,
      },
      message: `Tersio Combo set to ${value} for Codex. It applies to the rest of this session.`,
    };
  }
  if (command === 'caveman' || command === 'ponytail') {
    if (!value || value === 'status') {
      const key = command === 'caveman' ? 'cavemanDefault' : 'ponytailDefault';
      const current = normalizeMode(command, readMode(key, sessionId)) ?? 'off';
      return { patch: {}, message: `Tersio ${command} is ${current}. Use /${command} <level>.` };
    }
    const level = normalizeMode(command, value);
    if (!level) return { patch: {}, message: `Tersio ${command}: unknown level "${value}".` };
    return {
      patch: { [`${command}Default`]: level },
      message: `Tersio ${command} set to ${level} for Codex. It applies to the rest of this session.`,
    };
  }
  if (command === 'rtk')
    return { patch: {}, message: 'RTK is explanatory on Codex v1: Codex does not rewrite shell calls through Tersio.' };
  if (command === 'pstack')
    return {
      patch: {},
      message: 'pstack is available through $pstack or /prompts:pstack; the literal slash hook is explanatory only.',
    };
  if (command === 'headroom') {
    const key = 'headroomDefault';
    if (!value || value === 'status') {
      const current = normalizeMode('headroom', readMode(key, sessionId)) ?? 'off';
      return { patch: {}, message: `Tersio headroom is ${current}. Use /headroom on or /headroom off.` };
    }
    const level = normalizeMode('headroom', value);
    if (!level) return { patch: {}, message: `Tersio headroom: unknown value "${value}". Use on or off.` };
    return {
      patch: { [key]: level },
      message: `Tersio headroom set to ${level} for Codex. The endpoint route applies at install or from the dashboard switch.`,
    };
  }
  return { patch: {}, message: 'Tersio: use /combo, /caveman, /ponytail, /pstack, /rtk, or /headroom.' };
}

/**
 * A blocked command answers with the status line, so a mode change paints the same bar DSH has.
 * Codex renders `reason` for a blocked message and drops `systemMessage`, so the bar rides the
 * reason: a second line is the only way it reaches the transcript.
 */
export function codexBlockOutput(message: string, status?: string): Record<string, unknown> {
  return { decision: 'block', reason: status ? `${message}\n\n${status}` : message };
}

/** The JSON Codex expects from a prompt hook. Empty context and no status is a successful no-op. */
export function codexHookOutput(context: string, status?: string): Record<string, unknown> {
  const output: Record<string, unknown> = { continue: true };
  if (context.trim() !== '') {
    output.hookSpecificOutput = { hookEventName: 'UserPromptSubmit', additionalContext: context };
  }
  if (status) output.systemMessage = status;
  return output;
}

/** Codex reads user-level hooks from this file; a plugin-declared hook no longer runs in current builds. */
export function codexUserHooksFile(): string {
  return join(codexHome(), 'hooks.json');
}

/** The one string that identifies Tersio's own hook, whatever runtime path it was written with. */
export const CODEX_HOOK_MARKER = 'codex-hook user-prompt-submit';

export interface CodexUserHookResult {
  /** True when the file now carries the Tersio entry. */
  ok: boolean;
  /** True when this call changed the file. */
  changed: boolean;
  detail: string;
}

function hookGroups(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((group): group is Record<string, unknown> => Boolean(group) && typeof group === 'object');
}

/** True when this group's commands already carry Tersio's hook. */
function isTersioGroup(group: Record<string, unknown>): boolean {
  const hooks = Array.isArray(group.hooks) ? group.hooks : [];
  return hooks.some((entry) => {
    const command = (entry as Record<string, unknown> | null)?.command;
    return typeof command === 'string' && command.includes(CODEX_HOOK_MARKER);
  });
}

/**
 * Add Tersio's prompt hook to `~/.codex/hooks.json`, beside rtk and headroom. Current Codex removed
 * plugin hooks, so the copy inside the plugin never runs; this file is the surface that still does.
 */
export function ensureCodexUserHook(command: string, file = codexUserHooksFile(), dryRun = false): CodexUserHookResult {
  let parsed: Record<string, unknown> = {};
  try {
    const text = readFileSync(file, 'utf8');
    const value = JSON.parse(text) as unknown;
    parsed = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    // A missing file is the normal first install; a corrupt one is replaced, because Codex cannot read it either.
    parsed = {};
  }
  const hooks =
    parsed.hooks && typeof parsed.hooks === 'object' && !Array.isArray(parsed.hooks)
      ? (parsed.hooks as Record<string, unknown>)
      : {};
  const groups = hookGroups(hooks.UserPromptSubmit).filter((group) => !isTersioGroup(group));
  groups.push({ hooks: [{ type: 'command', command, statusMessage: 'Refreshing Tersio modes' }] });
  const next = { ...parsed, hooks: { ...hooks, UserPromptSubmit: groups } };
  const text = `${JSON.stringify(next, null, 2)}\n`;
  const existing = (() => {
    try {
      return readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  })();
  if (existing === text) return { ok: true, changed: false, detail: file };
  if (dryRun) return { ok: true, changed: false, detail: file };
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text, 'utf8');
    return { ok: true, changed: true, detail: file };
  } catch (error) {
    return { ok: false, changed: false, detail: (error as Error).message };
  }
}

/** Drop only Tersio's own entry, leaving every other tool's hook in place. */
export function removeCodexUserHook(file = codexUserHooksFile(), dryRun = false): CodexUserHookResult {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return { ok: true, changed: false, detail: file };
  }
  const hooks =
    parsed.hooks && typeof parsed.hooks === 'object' && !Array.isArray(parsed.hooks)
      ? (parsed.hooks as Record<string, unknown>)
      : null;
  if (!hooks) return { ok: true, changed: false, detail: file };
  const groups = hookGroups(hooks.UserPromptSubmit);
  const kept = groups.filter((group) => !isTersioGroup(group));
  if (kept.length === groups.length) return { ok: true, changed: false, detail: file };
  const nextHooks: Record<string, unknown> = { ...hooks };
  if (kept.length > 0) nextHooks.UserPromptSubmit = kept;
  else delete nextHooks.UserPromptSubmit;
  const next = { ...parsed, hooks: nextHooks };
  if (dryRun) return { ok: true, changed: false, detail: file };
  try {
    writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    return { ok: true, changed: true, detail: file };
  } catch (error) {
    return { ok: false, changed: false, detail: (error as Error).message };
  }
}
