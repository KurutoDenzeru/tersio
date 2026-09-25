// cli/host-writers.ts — writes one host's files: rules pack, skills, and the RTK
// shell-rewrite hook. Each writer is gated on what the host supports.
//
// The rewrite script is generated per host because the protocols disagree on
// how a new command is returned. Rewrite rules stay in the rtk binary; the
// script only marshals stdin/stdout and always exits 0, so failure degrades to
// no filtering rather than a blocked command.

import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AgentHost, HostRewrite } from './agent-hosts.ts';
import { applyMarkedBlock, END, removeMarkedBlock, START, packCommands, rulesBody } from './rules-pack.ts';
import { homeDir, readTextIfExists } from '../extensions/lib/utils.ts';

export interface WriteOptions {
  dryRun?: boolean;
  quiet?: boolean;
  verbose?: boolean;
}

export interface HostArtifacts {
  /** Files written or skipped, as repo-relative-to-$HOME strings for display. */
  files: string[];
  skipped: string[];
}

function abs(homeRelative: string): string {
  return path.join(homeDir(), homeRelative);
}

/**
 * Replace a marked block, append one when absent, leave unmarked files alone.
 * A user's instruction file is theirs; we manage only the span between markers.
 */
export const applyBlock = (existing: string | null, block: string): string =>
  applyMarkedBlock(existing, block, START, END);

export const stripBlock = (existing: string): string | null =>
  removeMarkedBlock(existing, START, END);

async function writeIfChanged(dest: string, content: string, options: WriteOptions): Promise<boolean> {
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

// --- rules pack -----------------------------------------------------------

/**
 * Cursor ignores a plain .md in .cursor/rules, so the .mdc needs frontmatter —
 * and that frontmatter is the only marker available. Safe because the file
 * name is ours: no other rule shares tersio.mdc. User content is preserved.
 */
function mdcFrontmatter(): string {
  return ['---', 'alwaysApply: true', 'description: Tersio token-saving modes', '---', ''].join('\n');
}

/**
 * Remove a leading .mdc frontmatter block. Only strips when the block is the
 * file's own leading `---` fence, so user YAML further down is never touched.
 */
export function stripMdcFrontmatter(existing: string): string {
  const lines = existing.split('\n');
  if (lines[0]?.trim() !== '---') return existing;
  const close = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (close === -1) return existing;
  return lines.slice(close + 1).join('\n');
}

export function renderRulesFile(host: AgentHost): string {
  const body = applyBlock(null, `${START}\n\n${rulesBody()}\n\n${END}\n`);
  return host.rulesFile?.endsWith('.mdc') ? mdcFrontmatter() + body : body;
}

// --- skills ---------------------------------------------------------------

// The Agent Skills spec requires `name` to match the containing directory,
// and several hosts (Cursor, Hermes, Pi) treat a mismatch as a malformed
// skill. The directory is `tersio-<mode>`, so the name must be that too.
const SKILL_NAME = (mode: string): string => `tersio-${mode}`;

function renderSkill(mode: string, body: string): string {
  const front = [
    '---',
    `name: ${SKILL_NAME(mode)}`,
    `description: Tersio ${mode} mode. Activate to apply these rules for the session.`,
    '---',
    '',
  ].join('\n');
  return `${front}\n${body.trim()}\n`;
}

// --- RTK shell-rewrite hook ----------------------------------------------

/**
 * Renders the rewriter: reads a hook payload on stdin, writes back the host's
 * rewrite object when rtk has an equivalent. Never blocks — every failure path
 * lets the original command run.
 */
export function renderRewriteScript(cfg: HostRewrite): string {
  // Dotted read of the host's own stdin shape, e.g. tool_input.command. A host
  // that accepts more than one spelling gets a first-string-wins chain.
  const paths = Array.isArray(cfg.inputPath) ? cfg.inputPath : [cfg.inputPath];
  const readExpr = paths
    .map((p) => p
      .split('.')
      .reduce<string>((acc, key) => `(${acc} && typeof ${acc} === 'object' ? ${acc}[${JSON.stringify(key)}] : undefined)`, 'input'))
    .join(' ?? ');

  // .mjs output, so `require` is absent and the import must stay ESM. A bare
  // require here made every host silently fail open instead of rewriting.
  const guard = `// Tersio RTK rewriter. Fail-open: any error leaves the command untouched.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

let input;
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

const command = ${readExpr};
if (typeof command !== 'string' || !command.trim()) process.exit(0);

let rewritten = null;
try {
  // rtk rewrite exits 3 on a successful rewrite, so branch on stdout only.
  const out = spawnSync('rtk', ['rewrite', command], { encoding: 'utf8', timeout: 5000 });
  const candidate = (out.stdout || '').trim();
  if (out.error === undefined && candidate && candidate !== command) rewritten = candidate;
} catch {}
if (!rewritten) process.exit(0);
`;

  const outputs: Record<HostRewrite['protocol'], string> = {
    // Claude Code / Codex / Grok: updatedInput replaces the whole input object.
    'hookSpecificOutput-updatedInput': `process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: '${cfg.event}',
    permissionDecision: 'allow',
    updatedInput: { command: rewritten },
  },
}));`,
    // Gemini: hookSpecificOutput.tool_input merges over the model arguments.
    'hookSpecificOutput-toolInput': `process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: '${cfg.event}',
    tool_input: { command: rewritten },
  },
}));`,
    // Copilot: flat modifiedArgs, substituting the tool arguments.
    modifiedArgs: `process.stdout.write(JSON.stringify({ modifiedArgs: { command: rewritten } }));`,
    // Cursor: flat updated_input.
    updatedInput: `process.stdout.write(JSON.stringify({ permission: 'allow', updated_input: { command: rewritten } }));`,
    // Hermes: shell-hook protocol, {"action":"modify","args":{...}}.
    'hermes-modify': `process.stdout.write(JSON.stringify({ action: 'modify', args: { command: rewritten } }));`,
  };

  return `${guard}
${outputs[cfg.protocol]}
process.exit(0);
`;
}

const HOOK_SCRIPT_NAME = 'tersio-rtk-rewrite.mjs';

// Resolve the script the host will actually run, next to its own config.
function hookScriptCommand(cfg: HostRewrite): string {
  const scriptAbs = path.join(path.dirname(abs(cfg.configFile)), HOOK_SCRIPT_NAME);
  return `node ${quoteForShell(scriptAbs)}`;
}

function quoteForShell(v: string): string {
  return /[\s"'$`\\]/.test(v) ? `'${v.replace(/'/g, `'\\''`)}'` : v;
}

function hookEntry(cfg: HostRewrite, command: string): Record<string, unknown> {
  // Claude-style nested shape, used by Claude Code, Codex, and Grok.
  return { type: 'command', command, timeout: 10 };
}

export function renderHookConfig(host: AgentHost): string | null {
  const cfg = host.rewriteConfig;
  if (!cfg) return null;
  const command = hookScriptCommand(cfg);

  switch (cfg.configFormat) {
    case 'gemini-json':
      return `${JSON.stringify({
        hooks: {
          [cfg.event]: [
            { matcher: cfg.matcher, hooks: [{ name: 'tersio-rtk', type: 'command', command, timeout: 5000 }] },
          ],
        },
      }, null, 2)}\n`;
    case 'copilot-json':
      return `${JSON.stringify({
        version: 1,
        hooks: {
          [cfg.event]: [
            { type: 'command', bash: command, command, timeoutSec: 10 },
          ],
        },
      }, null, 2)}\n`;
    case 'cursor-json':
      return `${JSON.stringify({
        version: 1,
        hooks: {
          [cfg.event]: [{ matcher: cfg.matcher, hooks: [hookEntry(cfg, command)] }],
        },
      }, null, 2)}\n`;
    case 'hermes-yaml':
      return `hooks:
  pre_tool_call:
    - matcher: "${cfg.matcher}"
      command: ${command}
      timeout: 10
      fail_closed: true
`;
    case 'claude-json':
    default:
      return `${JSON.stringify({
        hooks: {
          [cfg.event]: [{ matcher: cfg.matcher, hooks: [hookEntry(cfg, command)] }],
        },
      }, null, 2)}\n`;
  }
}

// --- public API -----------------------------------------------------------

export interface HostInstallResult extends HostArtifacts {
  /** True when the host got at least one real rewrite hook. */
  rewriteInstalled: boolean;
}

/** Installs everything the host supports; returns what was written. */
export async function installHost(host: AgentHost, options: WriteOptions = {}): Promise<HostInstallResult> {
  const files: string[] = [];
  const skipped: string[] = [];

  if (host.rules && host.rulesFile) {
    const dest = abs(host.rulesFile);
    const next = applyBlock(await readTextIfExists(dest), `${START}\n\n${rulesBody()}\n\n${END}\n`);
    const finalNext = host.rulesFile.endsWith('.mdc')
      ? mdcFrontmatter() + next
      : next;
    if (await writeIfChanged(dest, finalNext, options)) files.push(host.rulesFile);
    else skipped.push(host.rulesFile);
  }

  if (host.skills && host.skillsDir) {
    for (const [name, body] of Object.entries(packCommands())) {
      const rel = `${host.skillsDir}/tersio-${name}/SKILL.md`;
      if (await writeIfChanged(abs(rel), renderSkill(name, body), options)) files.push(rel);
      else skipped.push(rel);
    }
  }

  let rewriteInstalled = false;
  if (host.rewrite && host.rewriteConfig) {
    const cfg = host.rewriteConfig;
    const scriptRel = path.join(path.dirname(cfg.configFile), HOOK_SCRIPT_NAME);
    if (await writeIfChanged(abs(scriptRel), renderRewriteScript(cfg), options)) files.push(scriptRel);
    else skipped.push(scriptRel);

    const cfgText = renderHookConfig(host);
    if (cfgText !== null) {
      const cfgRel = cfg.configFile;
      const existing = await readTextIfExists(abs(cfgRel));
      // Merge, never clobber: these config files hold the user's other hooks
      // and settings, so a tersio re-run may only add or replace our own entry.
      const merged = existing === null ? cfgText : mergeHookEntry(existing, cfgText);
      if (await writeIfChanged(abs(cfgRel), merged, options)) files.push(cfgRel);
      else skipped.push(cfgRel);
    }
    rewriteInstalled = true;
  }

  return { files, skipped, rewriteInstalled };
}

/**
 * Removes one host's files. Only files Tersio created: the rules block is
 * stripped, not the file deleted, and a hook config keeps other hooks.
 */
export async function removeHost(host: AgentHost, options: WriteOptions = {}): Promise<string[]> {
  const removed: string[] = [];
  const quiet = options.quiet ?? true;

  if (host.rulesFile) {
    const dest = abs(host.rulesFile);
    const existing = await readTextIfExists(dest);
    if (existing !== null) {
      // A .mdc rule carries no tersio markers of its own, so ownership is
      // decided by the file being ours plus its frontmatter naming us. Any
      // other content the user added to that file is kept.
      const isOurs = host.rulesFile.endsWith('.mdc')
        ? existing.includes('description: Tersio token-saving modes')
        : true;
      // The .mdc frontmatter is ours too, and leaving it behind would leave a
      // rule the host loads with an empty body.
      const withoutFront = isOurs && host.rulesFile.endsWith('.mdc')
        ? stripMdcFrontmatter(existing)
        : existing;
      const stripped = stripBlock(withoutFront);
      if (!isOurs || stripped === existing) {
        // Not ours to touch — leave the user's file completely alone.
      } else if (options.dryRun) {
        console.log(`  [dry-run] would strip the tersio block from ${dest}`);
        removed.push(host.rulesFile);
      } else if (stripped === null) {
        await fs.rm(dest, { force: true });
        if (!quiet) console.log(`  [rm] ${dest}`);
        removed.push(host.rulesFile);
      } else {
        await fs.writeFile(dest, stripped, 'utf8');
        if (!quiet) console.log(`  [write] ${dest}`);
        removed.push(host.rulesFile);
      }
    }
  }

  if (host.skillsDir) {
    for (const name of Object.keys(packCommands())) {
      const rel = path.join(host.skillsDir, `tersio-${name}`);
      const dir = abs(rel);
      if (!existsSync(dir)) continue;
      if (options.dryRun) {
        console.log(`  [dry-run] would remove ${dir}`);
        removed.push(rel);
        continue;
      }
      await fs.rm(dir, { recursive: true, force: true });
      if (!quiet) console.log(`  [rm] ${dir}`);
      removed.push(rel);
    }
  }

  if (host.rewriteConfig) {
    const cfg = host.rewriteConfig;
    const scriptAbs = abs(path.join(path.dirname(cfg.configFile), HOOK_SCRIPT_NAME));
    if (existsSync(scriptAbs)) {
      if (options.dryRun) console.log(`  [dry-run] would remove ${scriptAbs}`);
      else {
        await fs.rm(scriptAbs, { force: true });
        if (!quiet) console.log(`  [rm] ${scriptAbs}`);
      }
      removed.push(scriptAbs);
    }
    const cfgAbs = abs(cfg.configFile);
    const existing = await readTextIfExists(cfgAbs);
    if (existing !== null && existing.includes(HOOK_SCRIPT_NAME)) {
      const pruned = pruneHookEntry(existing);
      if (pruned === null) {
        if (options.dryRun) console.log(`  [dry-run] would remove ${cfgAbs} (only tersio content)`);
        else {
          await fs.rm(cfgAbs, { force: true });
          if (!quiet) console.log(`  [rm] ${cfgAbs}`);
        }
      } else if (options.dryRun) {
        console.log(`  [dry-run] would remove the tersio hook from ${cfgAbs}`);
      } else if (pruned !== existing) {
        await fs.writeFile(cfgAbs, pruned, 'utf8');
        if (!quiet) console.log(`  [write] ${cfgAbs}`);
      }
      removed.push(cfg.configFile);
    }
  }

  return removed;
}

/**
 * Merges a rendered hook config into the host's file, replacing only our entry.
 * Unrelated hooks survive; a malformed file is left alone and reported.
 */
export function mergeHookEntry(existing: string, rendered: string): string {
  let current: unknown;
  let next: unknown;
  try {
    current = JSON.parse(existing);
    next = JSON.parse(rendered);
  } catch {
    return existing;
  }
  if (!isObject(current) || !isObject(next)) return existing;

  // The fresh config nests its event lists under `hooks`; the existing config
  // may already hold the user's own events. Merge per event so a tersio
  // install never drops a hook the user registered.
  const nextHooks = isObject(next.hooks) ? (next.hooks as Record<string, unknown>) : null;
  if (!nextHooks) return existing;
  const mergedHooks: Record<string, unknown> = isObject(current.hooks) ? { ...(current.hooks as Record<string, unknown>) } : {};
  for (const [event, entries] of Object.entries(nextHooks)) {
    if (!Array.isArray(entries)) continue;
    const currentEvents = mergedHooks[event];
    mergedHooks[event] = Array.isArray(currentEvents)
      ? replaceTersioEntries(currentEvents, entries)
      : entries;
  }
  return `${JSON.stringify({ ...current, hooks: mergedHooks }, null, 2)}\n`;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/** Drop prior tersio entries (identified by our script name), then append fresh ones. */
function replaceTersioEntries(current: unknown[], fresh: unknown[]): unknown[] {
  const isTersio = (entry: unknown): boolean => JSON.stringify(entry ?? {}).includes(HOOK_SCRIPT_NAME);
  return [...current.filter((e) => !isTersio(e)), ...fresh];
}

/**
 * Removes our hook entries, keeping everything else. Null when nothing but ours
 * remains, so the caller can delete the file. YAML is edited by line, which is
 * safe because we only remove a contiguous block we wrote.
 */
export function pruneHookEntry(existing: string): string | null {
  if (existing.includes(HOOK_SCRIPT_NAME) && !existing.trimStart().startsWith('{')) {
    return pruneYamlBlock(existing);
  }
  let data: unknown;
  try {
    data = JSON.parse(existing);
  } catch {
    return existing;
  }
  if (!isObject(data)) return existing;
  const hooks = isObject(data.hooks) ? { ...(data.hooks as Record<string, unknown>) } : null;
  if (!hooks) return existing;
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) continue;
    const kept = entries.filter((e) => !isTersioEntry(e));
    if (kept.length === 0) delete hooks[event];
    else hooks[event] = kept;
  }
  if (Object.keys(hooks).length === 0) {
    const { hooks: _drop, ...rest } = data;
    return Object.keys(rest).length === 0 ? null : `${JSON.stringify(rest, null, 2)}\n`;
  }
  return `${JSON.stringify({ ...data, hooks }, null, 2)}\n`;
}

function isTersioEntry(entry: unknown): boolean {
  return JSON.stringify(entry ?? {}).includes(HOOK_SCRIPT_NAME);
}

/**
 * Drops the whole list item holding our script, not just the command line:
 * sibling keys would dangle under a list with no entry, which is invalid YAML.
 * A list item is the `- ` line plus every line indented deeper.
 */
function pruneYamlBlock(existing: string): string | null {
  const lines = existing.split('\n');
  const drop = new Set<number>();

  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].includes(HOOK_SCRIPT_NAME)) continue;
    // The script sits on a continuation line, not the list opener, so walk
    // backwards to the `- ` that starts this item.
    let start = i;
    while (start >= 0 && !/^\s*-\s/.test(lines[start])) start -= 1;
    if (start < 0) continue;
    const openerIndent = lines[start].length - lines[start].trimStart().length;
    // Drop the whole item: the opener plus every deeper-indented sibling, or
    // up to the next line at the same-or-shallower indent.
    let end = i;
    while (end + 1 < lines.length) {
      const next = lines[end + 1];
      const indent = next.length - next.trimStart().length;
      if (next.trim() !== '' && indent <= openerIndent) break;
      end += 1;
    }
    for (let j = start; j <= end; j += 1) drop.add(j);
    i = end;
  }

  const kept = lines.filter((_, idx) => !drop.has(idx));
  const merged = kept.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
  return merged.trim() ? `${dropEmptiedYamlKeys(merged)}\n` : null;
}

/**
 * Drops a mapping key left empty by the removal. A bare `hooks:` parses as null,
 * which some hosts reject, so the scaffolding goes with the entry that filled it.
 */
function dropEmptiedYamlKeys(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(\s*)([A-Za-z_][\w-]*):\s*$/.exec(lines[i]);
    if (!m) { out.push(lines[i]); continue; }
    const [, indent] = m;
    const hasChild = lines.slice(i + 1).some((l) => {
      if (l.trim() === '') return false;
      const ind = l.length - l.trimStart().length;
      return ind > indent.length;
    });
    if (!hasChild) continue;
    out.push(lines[i]);
  }
  return out.join('\n');
}

export { HOOK_SCRIPT_NAME };
