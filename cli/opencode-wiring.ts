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
import { applyMarkedBlock, removeMarkedBlock, RTK } from './rules-pack.ts';
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

/** Writes the plugin and guidance block; returns which artifacts changed. */
export async function installOpenCodeRtk(
  pluginSource: string,
  options: OpenCodeWiringOptions = {},
): Promise<{ plugin: boolean; guidance: boolean }> {
  const plugin = await writeFile(openCodePluginPath(), pluginSource, options);
  const agents = openCodeAgentsPath();
  const next = applyMarkedBlock(await readTextIfExists(agents), BLOCK, START, END);
  const guidance = await writeFile(agents, next, options);
  return { plugin, guidance };
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

  return removed;
}
