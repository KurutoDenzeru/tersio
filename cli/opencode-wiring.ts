// cli/opencode-wiring.ts — install and remove Tersio's OpenCode artifacts.
//
// Split from the generic emitters because OpenCode needs a real plugin rather
// than a static hook: its documented hook surface cannot rewrite a tool input,
// so the rewrite has to happen inside a plugin. See
// extensions/opencode/rtk-plugin.ts for why rtk's own plugin cannot be used.
//
// Deliberately free of cli/common.ts imports (argv side effects) so tests can
// load it directly. `home` is passed in rather than read from the environment.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readTextIfExists } from '../extensions/lib/utils.ts';

const PLUGIN_FILE = 'tersio-rtk.ts';

export interface OpenCodeWiringOptions {
  dryRun?: boolean;
  quiet?: boolean;
}

/**
 * OpenCode's global config dir. V2 reads `plugins` and `AGENTS.md` from here.
 * Overridable for tests, since `~/.config/opencode` is the documented location
 * and guessing a second one would be worse than not supporting it.
 */
export function openCodeConfigDir(home: string): string {
  return path.join(home, '.config', 'opencode');
}

export function openCodePluginPath(home: string): string {
  return path.join(openCodeConfigDir(home), 'plugins', PLUGIN_FILE);
}

export function openCodeAgentsPath(home: string): string {
  return path.join(openCodeConfigDir(home), 'AGENTS.md');
}

async function writeFile(
  target: string,
  content: string,
  options: OpenCodeWiringOptions,
): Promise<boolean> {
  const current = await readTextIfExists(target);
  if (current === content) return false;
  if (!options.quiet) {
    // The install dry-run preview must stay free of absolute paths, so the
    // target is shown relative to $HOME.
    const shown = process.env.HOME ? target.replace(`${process.env.HOME}/`, '~/') : path.basename(target);
    console.log(`  ${options.dryRun ? '[dry-run] would write' : '[write]'} ${shown}`);
  }
  if (options.dryRun) return true;
  await fs.mkdir(path.dirname(target), { recursive: true });
  if (current !== null) {
    await fs.copyFile(target, `${target}.bak`).catch(() => { });
  }
  await fs.writeFile(target, content, 'utf8');
  return true;
}

/**
 * Writes the plugin. The rules pack is *not* handled here: the generic
 * emitters already merge it into OpenCode's global AGENTS.md between markers,
 * and two writers on one file would fight over the same span.
 */
export async function installOpenCodeRtk(
  home: string,
  pluginSource: string,
  options: OpenCodeWiringOptions = {},
): Promise<boolean> {
  return writeFile(openCodePluginPath(home), pluginSource, options);
}

/**
 * Removes the plugin and the `.bak` copies the writer leaves behind. Returns
 * whether anything was there to remove.
 */
export async function removeOpenCodeRtk(
  home: string,
  options: OpenCodeWiringOptions = {},
): Promise<boolean> {
  let removed = false;
  const shown = (target: string): string => target.replace(`${home}/`, '~/');
  for (const file of [openCodePluginPath(home), `${openCodePluginPath(home)}.bak`]) {
    if ((await readTextIfExists(file)) === null) continue;
    if (!options.quiet) console.log(`  ${options.dryRun ? '[dry-run] would remove' : '[rm]'} ${shown(file)}`);
    if (!options.dryRun) await fs.rm(file, { force: true });
    removed = true;
  }
  return removed;
}

/** True when the plugin is present, which is what doctor checks. */
export async function openCodePluginInstalled(home: string): Promise<boolean> {
  return (await readTextIfExists(openCodePluginPath(home))) !== null;
}
