// cli/opencode-wiring.ts — install, refresh, and remove the OpenCode
// integration: an RTK rewrite plugin plus global AGENTS.md guidance.
//
// We ship our own plugin because `rtk init -g --opencode` writes one OpenCode
// rejects (rtk-ai/rtk#3463, #3898). The guidance block is a fallback for users
// who prefer model-driven routing and delete the plugin.
//
// No cli/common.ts imports (argv side effects) so tests can load it.
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface OpenCodeWiringOptions {
  dryRun?: boolean;
  quiet?: boolean;
  verbose?: boolean;
}

const PLUGIN_FILE = 'tersio-rtk.ts';
const PLUGIN_ID = 'tersio-rtk';
const START = '<!-- tersio:rtk:start -->';
const END = '<!-- tersio:rtk:end -->';

const GUIDANCE = `## Rust Token Killer (rtk)

Use \`rtk\` for noisy shell commands. It filters output before the model reads it.
Call the explicit commands: \`rtk git status\`, \`rtk git diff\`, \`rtk grep <pattern> <path>\`, \`rtk find <path>\`, \`rtk read <file>\`, \`rtk ls <path>\`, \`rtk test <cmd>\`, \`rtk deps\`.
Do not use rtk for exact bytes: patches, checksums, state changes, and diffs you must read verbatim.
The \`${PLUGIN_ID}\` plugin rewrites supported commands automatically, so explicit prefixes are only needed when the plugin is disabled.`;

const BLOCK = `${START}\n\n${GUIDANCE}\n\n${END}\n`;

function home(): string {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

/** OpenCode's global config dir. V2 reads `plugins` here and `AGENTS.md` here. */
export function openCodeConfigDir(): string {
  return path.join(home(), '.config', 'opencode');
}

export function openCodePluginPath(): string {
  return path.join(openCodeConfigDir(), 'plugins', PLUGIN_FILE);
}

export function openCodeAgentsPath(): string {
  return path.join(openCodeConfigDir(), 'AGENTS.md');
}

// Replace an existing marked block, append one when absent, and leave a file
// without markers untouched — a user's own AGENTS.md is theirs to own.
export function applyMarkedBlock(existing: string | null, block: string, start: string, end: string): string {
  const base = existing === null ? '' : existing;
  if (!base.trim()) return block;
  const from = base.indexOf(start);
  const to = base.indexOf(end);
  if (from !== -1 && to !== -1 && to > from) {
    const before = base.slice(0, from);
    const after = base.slice(to + end.length).replace(/^\n/, '');
    return `${before}${block.trimEnd()}${after ? `\n${after}` : '\n'}`;
  }
  const prefix = base.endsWith('\n') ? '' : '\n';
  return `${base}${prefix}\n${block}`;
}

// Removes the block and the blank line it introduced. Returns null when the
// file ends up empty so callers can delete it instead of leaving a stub.
export function removeMarkedBlock(existing: string, start: string, end: string): string | null {
  const from = existing.indexOf(start);
  const to = existing.indexOf(end);
  if (from === -1 || to === -1 || to <= from) return existing;
  const before = existing.slice(0, from).replace(/\n+$/, '\n');
  const after = existing.slice(to + end.length).replace(/^\n+/, '');
  const merged = `${before}${after}`;
  return merged.trim() ? merged : null;
}

async function writeFile(dest: string, content: string, options: OpenCodeWiringOptions): Promise<boolean> {
  let existing: string | null = null;
  try {
    existing = await fs.readFile(dest, 'utf8');
  } catch {
    existing = null;
  }
  if (existing === content) {
    if (!options.quiet) console.log(`  [skip] ${dest} already up to date`);
    return false;
  }
  if (options.dryRun) {
    if (options.verbose) console.log(`  [dry-run] would write ${dest}`);
    return true;
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  if (existing !== null) await fs.copyFile(dest, `${dest}.bak`).catch(() => { });
  await fs.writeFile(dest, content, 'utf8');
  if (!options.quiet) console.log(`  [write] ${dest}`);
  return true;
}

async function readTextIfExists(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, 'utf8');
  } catch {
    return null;
  }
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
