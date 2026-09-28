// cli/opencode-wiring.ts — install and remove Tersio's OpenCode artifacts.
//
// Split from the generic emitters because OpenCode needs a real plugin rather
// than a static hook: its documented hook surface cannot rewrite a tool input,
// so the rewrite has to happen inside a plugin. See
// extensions/opencode/rtk-plugin.ts for why rtk's own plugin cannot be used.
//
// Deliberately free of cli/common.ts imports (argv side effects) so tests can
// load it directly. `home` is passed in rather than read from the environment.
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { readTextIfExists } from '../extensions/lib/utils.ts';

// Named for the package, not for one mode: the plugin carries the RTK shell
// rewrite and the /caveman, /rtk, /ponytail and /combo commands, so a file
// called tersio-rtk.ts described a quarter of it. OpenCode identifies a plugin by
// its `id` and loads every .ts file in this directory, which is why the old name
// has to be removed rather than left behind — two files would both register the
// same four commands.
const PLUGIN_FILE = 'tersio.ts';
/** Written by earlier releases, when the plugin carried only the rewrite. */
const PREVIOUS_PLUGIN_FILE = 'tersio-rtk.ts';

export interface OpenCodeWiringOptions {
  dryRun?: boolean;
  quiet?: boolean;
}

/** OpenCode's global config dir, where V2 reads `plugins` and `AGENTS.md`. */
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
    // The dry-run preview must stay free of absolute paths.
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
 * Reads the plugin source file and writes its content where OpenCode v2
 * looks for it. The source argument is a path, not the content itself:
 * writing the path verbatim produced a plugin file holding one path string,
 * which OpenCode fails to load ("failed, local" on its plugin screen).
 *
 * The rules pack is *not* handled here: the generic
 * emitters already merge it into OpenCode's global AGENTS.md between markers,
 * and two writers on one file would fight over the same span.
 */
export async function installOpenCodeRtk(
  home: string,
  pluginSource: string,
  options: OpenCodeWiringOptions = {},
): Promise<boolean> {
  const content = await readTextIfExists(pluginSource);
  if (content === null) {
    if (!options.quiet) {
      console.log(`  [fail] OpenCode plugin source not found: ${pluginSource}`);
      console.log('  [hint] Reinstall tersio — extensions/opencode/rtk-plugin.ts ships with the CLI');
    }
    return false;
  }
  const wrote = await writeFile(openCodePluginPath(home), content, options);
  // OpenCode discovers every .ts file in the plugins dir, so a leftover from the
  // old filename would load next to the new one and register the same commands
  // twice. Clearing it is part of installing, not a migration the user runs.
  if (!options.dryRun) {
    const stale = path.join(openCodeConfigDir(home), 'plugins', PREVIOUS_PLUGIN_FILE);
    if (existsSync(stale) && stale !== openCodePluginPath(home)) {
      await fs.rm(stale, { force: true });
      if (!options.quiet) console.log(`  [rm] ${stale} (superseded by ${PLUGIN_FILE})`);
    }
  }
  return wrote;
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
