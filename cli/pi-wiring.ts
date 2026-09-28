// Install and remove Tersio's Pi extension tree: Pi loads ~/.pi/agent/extensions/<dir>/index.ts through jiti, no build...
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readTextIfExists } from '../extensions/lib/utils.ts';
import { piExtensionTargets, piLayer } from './pi-layer.ts';

// `$HOME`-relative form of a path, for output that must stay readable.
function rel(target: string, home: string): string {
  if (!home) return target;
  const prefix = home.endsWith(path.sep) ? home : `${home}${path.sep}`;
  return target.startsWith(prefix) ? `~/${target.slice(prefix.length).split(path.sep).join('/')}` : target;
}

export interface PiWiringOptions {
  dryRun?: boolean;
  quiet?: boolean;
}

// The tree's sources as `[repo path, path under extDir]`.
export interface PiTree {
  // Static sources, copied verbatim on every install.
  sources: Array<[string, string]>;
  // `extension dir name` to `rule text`, written only when the text is given.
  rules: Array<[string, string | null]>;
}

export function piExtensionDir(home: string): string {
  return piLayer(home).extDir;
}

// Writes only when the content differs, leaving a `.bak` of what it replaced.
async function writeIfChanged(target: string, content: string, options: PiWiringOptions): Promise<boolean> {
  const current = await readTextIfExists(target);
  if (current === content) return false;
  if (options.dryRun) return true;
  await fs.mkdir(path.dirname(target), { recursive: true });
  if (current !== null) await fs.copyFile(target, `${target}.bak`).catch(() => { });
  await fs.writeFile(target, content, 'utf8');
  return true;
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

// Returns the paths it changed, so a no-op re-run is not counted as work.
export async function installPiTersio(
  home: string,
  tree: PiTree,
  options: PiWiringOptions = {},
): Promise<string[]> {
  const extDir = piExtensionDir(home);
  const written: string[] = [];
  for (const [from, to] of tree.sources) {
    const content = await readTextIfExists(from);
    if (content === null) {
      // Named by its path under the extension dir, never by the repo source.
      if (!options.quiet) {
        console.log(`  [fail] Pi extension source missing: ${to}`);
        console.log('  [hint] Reinstall tersio — extensions/pi ships with the CLI');
      }
      continue;
    }
    if (await writeIfChanged(path.join(extDir, to), content, options)) written.push(to);
  }
  for (const [dir, rule] of tree.rules) {
    if (rule === null) continue;
    const target = path.join(dir, 'rule.md');
    if (await writeIfChanged(path.join(extDir, target), rule, options)) written.push(target);
  }
  if (written.length > 0 && !options.quiet) {
    console.log(`  ${options.dryRun ? '[dry-run] would write' : '[write]'} Pi — ${written.length} file(s) under ${rel(extDir, home)}`);
  }
  return written;
}

// Removes the Pi tree: every directory the layer owns, the `.bak` copies, and the flat module a pre-tree install wrote at...

export async function removePiTersio(home: string, options: PiWiringOptions = {}): Promise<boolean> {
  let removed = false;
  for (const target of [...piExtensionTargets(piLayer(home)), path.join(piExtensionDir(home), 'tersio.ts')]) {
    if (!(await exists(target))) continue;
    if (!options.quiet) {
      console.log(`  ${options.dryRun ? '[dry-run] would remove' : '[rm]'} ${rel(target, home)}`);
    }
    if (!options.dryRun) {
      await fs.rm(target, { recursive: true, force: true });
      await fs.rm(`${target}.bak`, { force: true, recursive: true });
    }
    removed = true;
  }
  return removed;
}

// True when any module of the Pi tree is present.
export async function piTersioInstalled(home: string): Promise<boolean> {
  for (const entry of piLayer(home).installed) {
    if (await exists(path.join(entry.path, 'index.ts'))) return true;
  }
  return false;
}
