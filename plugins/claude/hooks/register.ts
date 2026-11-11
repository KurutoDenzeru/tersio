// Tersio's combo strip inside Claude Code. It reads the same settings.json the CLI, the dashboard and
// every extension already share, so the strip and the terminal agree.
//
// A mod may import only its own files and "claude-code", and the loader reads this file statically:
// `$` has to appear as `$.namespace.method(...)` at the call site, never passed to a helper. So each
// hook does its own read and hands the text to a pure function below.

const SEP = ' | ';

/** The settings keys this strip reads; every one is optional in a fresh install. */
interface TersioSettings {
  comboDefault?: string;
  cavemanDefault?: string;
  rtkDefault?: string | boolean;
  headroomDefault?: string;
  ponytailDefault?: string;
  pstackDefault?: string;
  /** The per-host section the CLI writes; it wins over the flat keys. */
  hosts?: Record<string, TersioSettings | undefined>;
}

interface Cached {
  settings: TersioSettings;
  error: string | null;
}

/** The settings file the CLI, the dashboard, and every extension already share. */
function settingsPath(home: string): string {
  return home + '/.tersio/settings.json';
}

/** The filesystem surface this hook reads; the host injects the rest of `$`. */
interface SettingsReader {
  env: { get(name: string): Promise<unknown> };
  fs: { exists(path: string): Promise<boolean>; read(path: string): Promise<unknown> };
}

/** The mode bodies the installer writes beside the mod, keyed by level. */
interface ModeContext {
  caveman?: Record<string, string>;
  ponytail?: Record<string, string>;
  pstack?: string;
  headroom?: string;
}

let modeContextCache: ModeContext | null = null;
let lastPromptContext = '';

/**
 * The CLI writes per-host defaults under hosts.claude and keeps flat keys as the shared fallback, so
 * the host section has to win here too. Reading only the flat keys reported OFF for a configured
 * machine.
 */
function effectiveSettings(raw: TersioSettings): TersioSettings {
  const section = raw.hosts?.claude;
  return section && typeof section === 'object' ? { ...raw, ...section } : raw;
}

/** A boolean is the rtk shape; everything else is already a mode word. */
function modeWord(value: string | boolean | undefined): string {
  if (value === true) return 'ON';
  if (value === false) return 'OFF';
  return String(value || 'off').toUpperCase();
}

/** One line: the combo, then each mode. Empty when nothing is on, so the band costs no rows. */
function comboLine(settings: TersioSettings): string {
  const caveman = modeWord(settings.cavemanDefault);
  const rtk = modeWord(settings.rtkDefault);
  const headroom = modeWord(settings.headroomDefault);
  const ponytail = modeWord(settings.ponytailDefault);
  const pstack = modeWord(settings.pstackDefault);
  const allOff = caveman === 'OFF' && rtk === 'OFF' && headroom === 'OFF' && ponytail === 'OFF' && pstack === 'OFF';
  if (allOff) return '';
  const level = String(settings.comboDefault || 'off');
  return [
    '🧩 ' + level.toUpperCase(),
    '🪨 caveman:' + caveman,
    '🗜️ rtk:' + rtk,
    '🍃 headroom:' + headroom,
    '🧠 ponytail:' + ponytail,
    '🥔 pstack:' + pstack,
  ].join(SEP);
}

/** Parses the text a hook read, or reports why it could not. A half-written file must not end a session. */
function parseSettings(text: string): Cached {
  try {
    return { settings: JSON.parse(text) as TersioSettings, error: null };
  } catch (err) {
    return { settings: {}, error: String(err) };
  }
}

/** Read on every render, so a slash command lands in the strip without a restart. */
async function readSettings($: SettingsReader): Promise<Cached> {
  try {
    const home = await $.env.get('HOME');
    const path = settingsPath(String(home));
    // A machine that never ran the installer has no file; the strip stays off rather than erroring.
    return (await $.fs.exists(path)) ? parseSettings(String(await $.fs.read(path))) : { settings: {}, error: null };
  } catch (err) {
    return { settings: {}, error: String(err) };
  }
}

/** The rule bodies Tersio's installer wrote into the plugin, or none on a partial install. */
async function readModeContext($: SettingsReader): Promise<ModeContext> {
  if (modeContextCache) return modeContextCache;
  try {
    const home = String((await $.env.get('HOME')) ?? '');
    const root = String((await $.env.get('CLAUDE_PLUGIN_ROOT')) ?? '');
    const path = root
      ? root + '/hooks/mode-context.json'
      : home + '/.claude/tersio-marketplace/tersio/hooks/mode-context.json';
    if (!(await $.fs.exists(path))) return {};
    modeContextCache = JSON.parse(String(await $.fs.read(path))) as ModeContext;
    return modeContextCache;
  } catch {
    return {};
  }
}

/** True when Claude Code's endpoint points somewhere other than Anthropic, which is the routed state. */
async function claudeRouted($: SettingsReader): Promise<boolean> {
  try {
    const home = String((await $.env.get('HOME')) ?? '');
    const path = home + '/.claude/settings.json';
    if (!(await $.fs.exists(path))) return false;
    const parsed = JSON.parse(String(await $.fs.read(path))) as {
      env?: Record<string, unknown>;
    };
    return typeof parsed.env?.ANTHROPIC_BASE_URL === 'string' && parsed.env.ANTHROPIC_BASE_URL !== '';
  } catch {
    return false;
  }
}

/** The active mode blocks for one prompt; empty when every mode is off. */
function modeBlocks(settings: TersioSettings, context: ModeContext, routed: boolean): string[] {
  const blocks: string[] = [];
  const caveman = String(settings.cavemanDefault || 'off');
  if (caveman !== 'off' && context.caveman?.[caveman]) blocks.push(context.caveman[caveman]);
  const ponytail = String(settings.ponytailDefault || 'off');
  if (ponytail !== 'off' && context.ponytail?.[ponytail]) blocks.push(context.ponytail[ponytail]);
  if (String(settings.pstackDefault || 'off') === 'on' && context.pstack) blocks.push(context.pstack);
  // The headroom block tells the model how to recover elided text, so it is honest only while routed.
  if (String(settings.headroomDefault || 'off') !== 'off' && routed && context.headroom) blocks.push(context.headroom);
  return blocks;
}

/** Every hook Claude Code can call: `on(event, hook)` or `on(event, matcher, hook)`. */
type Hook = (...args: any[]) => unknown;
type On = (event: string, matcherOrHook: unknown, maybeHook?: Hook) => void;

export function register(on: On): void {
  on('session.start', async ($: any, e: any, next: (x: unknown) => unknown) => {
    // A resumed session has a fresh transcript, so the mode blocks must ride its first prompt again.
    lastPromptContext = '';
    // Both, and each does one job. $.command.register makes a plain /tersio answer; the
    // commands/tersio.md file is what puts the entry in the slash menu, which a registered name
    // never does. Registered last: a taken name throws and would skip the rest of this hook.
    try {
      await $.command.register({ name: 'tersio', description: "Show Tersio's active modes" });
    } catch {
      /* a built-in already owns the name */
    }
    return next(e);
  });

  // Two matchers for one command: the plugin is named tersio and the command is tersio, so the file
  // entry resolves as tersio:tersio while an unqualified /tersio also reaches it.
  on('command.run', { command: 'tersio' }, async ($: SettingsReader) => {
    const cached = await readSettings($);
    if (cached.error) return { text: 'Tersio: could not read settings — ' + cached.error };
    const line = comboLine(effectiveSettings(cached.settings));
    return { text: line || '🧩 OFF — no Tersio modes are on' };
  });

  on('command.run', { command: 'tersio:tersio' }, async ($: SettingsReader) => {
    const cached = await readSettings($);
    if (cached.error) return { text: 'Tersio: could not read settings — ' + cached.error };
    const line = comboLine(effectiveSettings(cached.settings));
    return { text: line || '🧩 OFF — no Tersio modes are on' };
  });

  on(
    'prompt.submit',
    async ($: SettingsReader, e: { context?: unknown[] } & Record<string, unknown>, next: (x: unknown) => unknown) => {
      const cached = await readSettings($);
      if (cached.error) return next(e);
      const context = await readModeContext($);
      const routed = await claudeRouted($);
      const text = modeBlocks(effectiveSettings(cached.settings), context, routed).join('\n\n');
      // The same block is already in the conversation; a second copy only costs tokens.
      if (!text || text === lastPromptContext) return next(e);
      lastPromptContext = text;
      const prior = Array.isArray(e.context) ? e.context : [];
      return next({ ...e, context: [...prior, text] });
    },
  );

  on('ui.render', { component: 'AbovePrompt' }, async ($: any, e: any, next: (x: unknown) => unknown) => {
    const cached = await readSettings($);
    const line = comboLine(effectiveSettings(cached.settings));
    // Nothing on, or not read yet: draw nothing and let the band stay empty.
    if (!line) return next(e);
    const { Text } = $.ui.resolve(e);
    return Text({ children: [line], dimColor: true });
  });
}
