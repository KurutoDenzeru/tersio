// extensions/opencode/rtk-plugin.ts — Tersio's OpenCode plugin: the RTK shell
// rewrite, and the three mode commands.
//
// Why Tersio ships its own rather than using `rtk init --opencode`: rtk 0.50.0
// emits a pre-v2 plugin that current OpenCode refuses to load. The break was
// not backward compatible, and after 1.18.x an old-shape plugin fails silently
// rather than loudly. Upstream is tracked at rtk-ai/rtk#3463; the old-format
// report is rtk-ai/rtk#3898.
//
// The v2 shape: default-export a definition with `id` + `setup(ctx)`, and
// register hooks on the owning domain. Verified against OpenCode 2.0.16.
//
// Rewrite rules live in the rtk binary, so upgrading rtk needs no plugin edit.
// `rtk rewrite` exit codes: 0 rewritten, 1 no equivalent, 3 rewritten with a
// warning -- so branch on stdout and never on the code. Fail-open throughout:
// any failure leaves the original command running.
//
// Types are structural on purpose. The file is loaded from the user's config
// dir, where there is no node_modules, so it must not import anything. The mode
// text is NOT inlined here: OpenCode loads the skills we already install, and
// `autoinvoke` makes a skill load itself, so duplicating the prose here would
// only create a second copy to drift.
import { spawn } from 'node:child_process';

const RTK_TIMEOUT_MS = 5000;
const REWRITE_TOOLS = new Set(['bash', 'shell']);
/** A command already routed through rtk would double-prefix on a second pass. */
const ALREADY_RTK = /(^|[\s;&|(])rtk\s/;

/** The three modes `/caveman`, `/rtk` and `/ponytail` switch, in OMP's order. */
const MODES = ['caveman', 'rtk', 'ponytail'] as const;
type Mode = (typeof MODES)[number];

/** Levels each mode accepts. `off` turns it back off. */
const LEVELS: Record<Mode, readonly string[]> = {
  caveman: ['off', 'lite', 'full', 'ultra', 'wenyan-lite', 'wenyan-full', 'wenyan-ultra'],
  rtk: ['off', 'on'],
  ponytail: ['off', 'lite', 'full', 'ultra'],
};

/** One skill per mode, and the id OpenCode registers it under. */
const SKILL_ID: Record<Mode, string> = {
  caveman: 'tersio-caveman',
  rtk: 'tersio-rtk',
  ponytail: 'tersio-ponytail',
};

/**
 * The four presets `/combo` exposes, with the same levels OMP and Pi use
 * (COMBO_LEVELS in extensions/shared/session-state.ts). Kept as literals rather
 * than imported: this file is loaded from a config dir with no node_modules.
 */
const COMBO_PRESETS: Record<string, ModeState> = {
  off: { caveman: 'off', rtk: 'off', ponytail: 'off' },
  medium: { caveman: 'lite', rtk: 'on', ponytail: 'lite' },
  balanced: { caveman: 'full', rtk: 'on', ponytail: 'full' },
  max: { caveman: 'ultra', rtk: 'on', ponytail: 'ultra' },
};

/**
 * Marks the block this plugin appends to an agent's system prompt.
 *
 * An agent's `system` field replaces the provider's base prompt, so the mode
 * notice is appended to whatever is there and never on its own. The marker is
 * stripped before re-applying, because a transform replays on every reload and
 * an unmarked notice would stack a fresh copy each time.
 */
const NOTICE_START = '<!-- tersio:start -->';
const NOTICE_END = '<!-- tersio:end -->';

interface ShellToolInput {
  command: string;
}

interface ToolExecuteBeforeEvent {
  tool: string;
  input: unknown;
}

interface ToolHookContext {
  hook(
    name: 'execute.before',
    callback: (event: ToolExecuteBeforeEvent) => Promise<void> | void,
  ): Promise<unknown>;
}

interface AgentInfo {
  id?: string;
  mode?: string;
  system?: string;
}

interface AgentEditor {
  list(): readonly AgentInfo[];
  update(id: string, update: (agent: AgentInfo) => void): void;
}

interface SkillInfo {
  id?: string;
  name?: string;
  autoinvoke?: boolean;
}

interface SkillEditor {
  list(): readonly SkillInfo[];
  update(id: string, update: (skill: SkillInfo) => void): void;
}

interface CommandInvocation {
  sessionID: string;
  prompt: { text: string; [key: string]: unknown };
  delivery: 'steer' | 'queue';
}

interface CommandEditor {
  add(definition: {
    name: string;
    description?: string;
    execute: (input: CommandInvocation) => Promise<void>;
  }): void;
}

interface StorageContext {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

interface PluginContext {
  tool: ToolHookContext;
  agent: { transform(callback: (editor: AgentEditor) => void): Promise<unknown> };
  skill: { transform(callback: (editor: SkillEditor) => void): Promise<unknown> };
  command: { transform(callback: (editor: CommandEditor) => void): Promise<unknown> };
  session: {
    prompt(input: { sessionID: string; text: string; delivery?: 'steer' | 'queue' }): Promise<unknown>;
  };
  storage: StorageContext;
}

interface PluginDefinition {
  id: string;
  setup(context: PluginContext): Promise<void>;
}

/**
 * `event.input` is typed `unknown` by OpenCode, so narrowing to the shell
 * tool's input shape is a runtime check rather than an unchecked cast.
 */
function readCommand(input: unknown): ShellToolInput | null {
  if (typeof input !== 'object' || input === null || !('command' in input)) return null;
  const command = (input as Record<string, unknown>).command;
  if (typeof command !== 'string' || !command.trim()) return null;
  return input as ShellToolInput;
}

function rewrite(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    let stdout = '';
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(value);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('rtk', ['rewrite', command], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      finish(null);
      return;
    }

    timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, RTK_TIMEOUT_MS);

    child.on('error', () => finish(null));
    // `stdio` above asks for a pipe, but the overload leaves stdout nullable, so
    // a null there means we cannot read the rewrite. Fail open rather than
    // guess: the original command runs.
    const out = child.stdout;
    if (!out) {
      finish(null);
      return;
    }
    out.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.on('close', () => {
      const rewritten = stdout.trim();
      finish(rewritten && rewritten !== command ? rewritten : null);
    });
  });
}

type ModeState = Record<Mode, string>;

/**
 * rtk defaults to on because the rewrite hook above is always registered; the
 * other two start off, so nothing changes for a user who never runs a command.
 */
const DEFAULT_STATE: ModeState = { caveman: 'off', rtk: 'on', ponytail: 'off' };

/** A stored level is only trusted if that mode actually offers it. */
function coerceState(raw: unknown): ModeState {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_STATE };
  const record = raw as Record<string, unknown>;
  const next: ModeState = { ...DEFAULT_STATE };
  for (const mode of MODES) {
    const value = record[mode];
    if (typeof value === 'string' && LEVELS[mode].includes(value)) next[mode] = value;
  }
  return next;
}

async function readState(ctx: PluginContext, sessionID: string): Promise<ModeState> {
  return coerceState(await ctx.storage.get(`modes:${sessionID}`));
}

/** The instruction block appended to an agent's system prompt, or null if none. */
function notice(state: ModeState): string | null {
  const active = MODES.filter((mode) => state[mode] !== 'off');
  if (active.length === 0) return null;
  const lines = active.map((mode) => `- ${mode} (${state[mode]})`);
  return [
    NOTICE_START,
    'Tersio modes are active. Follow the matching skill for the rest of this session:',
    ...lines,
    `Load and apply the \`${SKILL_ID[modeOf(active)]}\` skill, and the others named above, before doing any work.`,
    NOTICE_END,
  ].join('\n');
}

function modeOf(active: readonly Mode[]): Mode {
  return active[0];
}

/** Removes a previously appended notice, so a re-apply replaces rather than stacks. */
function stripNotice(system: string): string {
  const start = system.indexOf(NOTICE_START);
  if (start === -1) return system;
  const end = system.indexOf(NOTICE_END, start);
  if (end === -1) return system.slice(0, start);
  return `${system.slice(0, start)}${system.slice(end + NOTICE_END.length)}`.replace(/\s+$/, '');
}

/**
 * Puts the active modes in front of the model on every turn.
 *
 * An agent's `system` field is what the host reads each turn, and OpenCode still
 * adds project instructions and skills on top of it, so appending here is
 * additive rather than a replacement. There is no per-turn prompt hook in the
 * documented plugin surface, and this is the equivalent: the transform is
 * replayed whenever the agent registry rebuilds, so the block survives reloads.
 */
async function applyModes(ctx: PluginContext, state: ModeState): Promise<void> {
  const block = notice(state);
  await ctx.agent.transform((editor) => {
    for (const agent of editor.list()) {
      const id = agent.id;
      if (typeof id !== 'string' || !id) continue;
      editor.update(id, (draft) => {
        const base = stripNotice(draft.system ?? '');
        if (!block) {
          // Nothing active: leave the agent exactly as we found it. An empty
          // string is OpenCode's "no override", which is how a built-in starts.
          draft.system = base;
          return;
        }
        draft.system = base ? `${base}\n\n${block}\n` : `${block}\n`;
      });
    }
  });
  // Autoinvoke is the documented way to make a skill load itself, so the mode
  // text the user already has on disk is what the model actually reads. This is
  // why the prose is not duplicated into this file.
  const wanted = new Set(MODES.filter((mode) => state[mode] !== 'off').map((mode) => SKILL_ID[mode]));
  await ctx.skill.transform((editor) => {
    for (const skill of editor.list()) {
      const id = skill.id;
      if (typeof id !== 'string' || !id.startsWith('tersio-')) continue;
      const on = wanted.has(id);
      if ((skill.autoinvoke === true) !== on) editor.update(id, (draft) => { draft.autoinvoke = on; });
    }
  });
}

const plugin: PluginDefinition = {
  // One plugin, not one per mode: this file carries the rewrite and four
  // commands, and the id is how OpenCode names it in /plugin.
  id: 'tersio',
  async setup(ctx) {
    await registerModeCommands(ctx);

    // Escape hatch for a host where rewriting gets in the way. Scoped to the
    // rewrite on purpose: this is named for rtk, so it must not also silence
    // the mode commands.
    if (process.env.TERSIO_RTK === 'off') return;

    await ctx.tool.hook('execute.before', async (event) => {
      if (!REWRITE_TOOLS.has(String(event.tool).toLowerCase())) return;
      const input = readCommand(event.input);
      if (!input || ALREADY_RTK.test(input.command)) return;

      const rewritten = await rewrite(input.command);
      if (rewritten) input.command = rewritten;
    });
  },
};

/** Registers `/caveman`, `/rtk`, `/ponytail` and `/combo`. */
async function registerModeCommands(ctx: PluginContext): Promise<void> {
  await ctx.command.transform((editor) => {
    for (const mode of MODES) {
      editor.add({
        name: mode,
        description: `Tersio ${mode} mode — ${LEVELS[mode].filter((l) => l !== 'off').join(' | ')}. \`off\` turns it back off.`,
        execute: async (invocation) => {
          const state = await readState(ctx, invocation.sessionID);
          const level = pickLevel(mode, invocation.prompt.text);
          if (level !== null) state[mode] = level;
          await ctx.storage.set(`modes:${invocation.sessionID}`, state);
          await applyModes(ctx, state);
          await ctx.session.prompt({
            ...invocation.prompt,
            sessionID: invocation.sessionID,
            delivery: invocation.delivery,
            text: notice(state) ?? `Tersio ${mode} mode is off.`,
          });
        },
      });
    }
    editor.add({
      name: 'combo',
      description: `Set all three modes at once: ${Object.keys(COMBO_PRESETS).join(' | ')}.`,
      execute: async (invocation) => {
        const state = await readState(ctx, invocation.sessionID);
        const [word] = invocation.prompt.text.trim().split(/\s+/).filter(Boolean);
        const preset = word === undefined ? undefined : COMBO_PRESETS[word.toLowerCase()];
        // An unknown word leaves the modes alone rather than guessing: /combo is
        // the same preset command OMP and Pi expose, not a per-mode setter.
        if (preset) Object.assign(state, preset);
        await ctx.storage.set(`modes:${invocation.sessionID}`, state);
        await applyModes(ctx, state);
        await ctx.session.prompt({
          ...invocation.prompt,
          sessionID: invocation.sessionID,
          delivery: invocation.delivery,
          text: notice(state) ?? 'Tersio modes are all off.',
        });
      },
    });
  });
}

/** The level named in a command's text, or null to leave the mode alone. */
function pickLevel(mode: Mode, text: string): string | null {
  const [word] = text.trim().split(/\s+/).filter(Boolean);
  if (word === undefined) return null;
  const value = word.toLowerCase();
  return LEVELS[mode].includes(value) ? value : null;
}

export default plugin;
