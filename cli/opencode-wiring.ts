// cli/opencode-wiring.ts — install, refresh, and remove the OpenCode
// integration: an RTK rewrite plugin plus global AGENTS.md guidance.
//
// We ship our own plugin because `rtk init -g --opencode` writes one OpenCode
// rejects (rtk-ai/rtk#3463, #3898). The guidance block is a fallback for users
// who prefer model-driven routing and delete the plugin.
//
// No cli/common.ts imports (argv side effects) so tests can load it.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { applyMarkedBlock, packCommands, removeMarkedBlock, RTK } from './rules-pack.ts';
import { homeDir, readTextIfExists } from '../extensions/lib/utils.ts';

// Re-exported so callers can keep importing blocks from the wiring module.
export { applyMarkedBlock, removeMarkedBlock };

export interface OpenCodeWiringOptions {
  dryRun?: boolean;
  quiet?: boolean;
  verbose?: boolean;
}

const PLUGIN_FILE = 'tersio-rtk.ts';
const PLUGIN_ID = 'tersio-rtk';
const START = '<!-- tersio:rtk:start -->';
const END = '<!-- tersio:rtk:end -->';

// Same text as the shared rtk rule, plus the line that tells the model the
// plugin already rewrites commands. Derived so the two cannot drift.
const GUIDANCE = `${RTK}
The \`${PLUGIN_ID}\` plugin rewrites supported commands automatically, so explicit prefixes are only needed when the plugin is disabled.`;

const BLOCK = `${START}\n\n${GUIDANCE}\n\n${END}\n`;

/** OpenCode's global config dir. V2 reads `plugins` here and `AGENTS.md` here. */
export function openCodeConfigDir(): string {
  return path.join(homeDir(), '.config', 'opencode');
}

export function openCodePluginPath(): string {
  return path.join(openCodeConfigDir(), 'plugins', PLUGIN_FILE);
}

export function openCodeAgentsPath(): string {
  return path.join(openCodeConfigDir(), 'AGENTS.md');
}

/**
 * OpenCode's global custom-command directory. A markdown file per command; the
 * filename becomes the slash command (https://opencode.ai/docs/commands).
 */
export function openCodeCommandsDir(): string {
  return path.join(openCodeConfigDir(), 'commands');
}

/** The command files Tersio owns, so removal never touches a user's own. */
export function openCodeCommandFiles(): string[] {
  return ['caveman.md', 'rtk.md', 'combo.md', 'ponytail.md'].map((f) => path.join(openCodeCommandsDir(), f));
}

// An OpenCode command is a prompt template sent to the model, not a runtime
// hook: it cannot flip extension state the way OMP's /caveman does. So the
// prompt states the mode for the rest of the conversation instead of claiming a
// toggle the host cannot perform. The mode text is the same body every other
// host gets, so the two cannot drift.
// The `tersio:command` marker is what identifies a file as ours. Removal
// matches on it. Matching on prose in the description instead left three of
// the four commands behind, because only some descriptions mentioned Tersio.
const OWNED = '<!-- tersio:command -->';

function commandFile(description: string, body: string, usage: string): string {
  return [
    '---',
    `description: ${description}`,
    '---',
    '',
    OWNED,
    '',
    body.trim(),
    '',
    usage,
    '',
    'Requested level: $ARGUMENTS',
    '',
    'If the level above is empty, keep the mode you are already in. If it is',
    '`off`, stop applying the mode for the rest of this conversation. Valid',
    'levels are listed above. Apply the mode from this message onward; it stays',
    'in effect until the user changes it or starts a new session.',
    '',
  ].join('\n');
}

const COMBO_TABLE = [
  '| level | caveman | rtk | ponytail |',
  '|---|---|---|---|',
  '| `off` | off | off | off |',
  '| `medium` | lite | on | lite |',
  '| `balanced` | full | on | full |',
  '| `max` | ultra | on | ultra |',
].join('\n');

const COMBO_BODY = `Tersio Combo turns the three token-saving modes on together.

${COMBO_TABLE}`;

export function renderOpenCodeCommands(): Record<string, string> {
  const bodies = packCommands();
  return {
    'caveman.md': commandFile('Reply concisely: drop filler, keep technical substance', bodies.caveman,
      'Caveman levels: `off`, `lite`, `full`, `ultra`, `wenyan-lite`, `wenyan-full`, `wenyan-ultra`.'),
    'rtk.md': commandFile('Compress noisy shell output with rtk', bodies.rtk,
      'RTK levels: `off`, `on`.'),
    'ponytail.md': commandFile('Write the minimum correct code', bodies.ponytail,
      'Ponytail levels: `off`, `lite`, `full`, `ultra`.'),
    'combo.md': commandFile('Set all three Tersio modes at once', COMBO_BODY,
      'Combo levels: `off`, `medium`, `balanced`, `max`.'),
  };
}

/** Writes each command file; returns how many changed. */
export async function installOpenCodeCommands(options: OpenCodeWiringOptions = {}): Promise<number> {
  const rendered = renderOpenCodeCommands();
  let changed = 0;
  for (const [name, body] of Object.entries(rendered)) {
    if (await writeFile(path.join(openCodeCommandsDir(), name), body, options)) changed += 1;
  }
  return changed;
}

/** Removes only the command files Tersio wrote, plus the .bak copies it left. */
export async function removeOpenCodeCommands(options: OpenCodeWiringOptions = {}): Promise<boolean> {
  let removed = false;
  for (const file of openCodeCommandFiles()) {
    // A user's own command must survive, so ownership is decided by our marker
    // rather than by the filename. A user who wrote their own caveman.md keeps
    // it; ours is only replaced when we overwrote it, and the .bak holds theirs.
    const text = await readTextIfExists(file);
    if (text === null || !text.includes(OWNED)) {
      continue;
    }
    for (const target of [file, `${file}.bak`]) {
      if ((await readTextIfExists(target)) === null) continue;
      if (options.dryRun) {
        console.log(`  [dry-run] would remove ${target}`);
        removed = true;
        continue;
      }
      await fs.rm(target, { force: true });
      console.log(`  [rm] ${target}`);
      removed = true;
    }
  }
  return removed;
}


async function writeFile(dest: string, content: string, options: OpenCodeWiringOptions): Promise<boolean> {
  const existing = await readTextIfExists(dest);
  if (existing === content) {
    if (!options.quiet && options.verbose) console.log(`  [skip] ${dest} already up to date`);
    return false;
  }
  if (options.dryRun) {
    if (options.verbose && !options.quiet) console.log(`  [dry-run] would write ${dest}`);
    return true;
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  if (existing !== null) await fs.copyFile(dest, `${dest}.bak`).catch(() => { });
  await fs.writeFile(dest, content, 'utf8');
  if (!options.quiet) console.log(`  [write] ${dest}`);
  return true;
}

/** Writes the plugin, guidance block, and command files. */
export async function installOpenCodeRtk(
  pluginSource: string,
  options: OpenCodeWiringOptions = {},
): Promise<{ plugin: boolean; guidance: boolean; commands: number }> {
  const plugin = await writeFile(openCodePluginPath(), pluginSource, options);
  const agents = openCodeAgentsPath();
  const next = applyMarkedBlock(await readTextIfExists(agents), BLOCK, START, END);
  const guidance = await writeFile(agents, next, options);
  const commands = await installOpenCodeCommands(options);
  return { plugin, guidance, commands };
}

/** Removes both artifacts and the .bak copies the writer leaves behind. */
export async function removeOpenCodeRtk(options: OpenCodeWiringOptions = {}): Promise<boolean> {
  let removed = false;

  for (const file of [openCodePluginPath(), `${openCodePluginPath()}.bak`]) {
    try {
      if (options.dryRun) {
        console.log(`  [dry-run] would remove ${file}`);
        removed = true;
        continue;
      }
      await fs.rm(file);
      console.log(`  [rm] ${file}`);
      removed = true;
    } catch {
      // Absent is the desired end state; nothing to report.
    }
  }

  const agents = openCodeAgentsPath();
  const existing = await readTextIfExists(agents);
  if (existing !== null) {
    const stripped = removeMarkedBlock(existing, START, END);
    if (stripped === null) {
      if (options.dryRun) console.log(`  [dry-run] would remove ${agents} (only Tersio content)`);
      else {
        await fs.rm(agents);
        console.log(`  [rm] ${agents}`);
      }
      removed = true;
    } else if (stripped !== existing) {
      await writeFile(agents, stripped, options);
      removed = true;
    }
  }

  if (await removeOpenCodeCommands(options)) removed = true;

  return removed;
}
