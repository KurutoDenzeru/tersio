// cli/host-writers.ts — renders a host's files from the registry and the rules
// pack. A host's differences live in cli/agent-hosts.ts; the mode text lives
// once in cli/rules-pack.ts. Adding a provider is a registry entry, not a new
// code path.
//
// Three rules this module exists to enforce:
//   1. Never write a hook file for a host with no `rewriteConfig`. A host that
//      ignores the file would look wired while doing nothing.
//   2. Merge into user files, never clobber. Only the marked span is ours.
//   3. Fail open everywhere. A broken rewriter must leave the original command
//      running, never block the tool call.
//
// Deliberately free of cli/common.ts imports (argv side effects) so tests can
// load it directly.
import path from 'node:path';
import {
  HOSTS,
  hasStaticHook,
  isGuidanceOnly,
  isLiveExtension,
  hostPath,
  SHARED_SKILL_DIRS,
  type AgentHost,
  type HostRewrite,
  type RewriteProtocol,
} from './agent-hosts.ts';
import { applyMarkedBlock, guidanceRulesBody, rulesBody, START, END } from './rules-pack.ts';

export type ArtifactKind = 'rules' | 'skill' | 'hook-config' | 'hook-script';

export interface HostArtifact {
  kind: ArtifactKind;
  /** Absolute path this artifact is written to. */
  absPath: string;
  content: string;
  /**
   * `block` merges between markers, `json` merges by key, `whole` owns the
   * file outright. `whole` is only correct for files tersio creates itself.
   */
  merge: 'block' | 'json' | 'whole';
}

/** One entry inside a host's hook config. Shape varies per host, hence the index. */
type HookEntry = Record<string, unknown>;

const HOOK_SCRIPT_NAME = 'tersio-rtk-rewrite.mjs';
/** Identifies our entries inside a host's hook config, for merge and removal. */
const HOOK_MARKER = 'tersio-rtk';

// --- rules -----------------------------------------------------------------

/**
 * Cursor ignores a rule file without frontmatter, so it is the one host whose
 * rules artifact is not a plain marked block.
 */
function renderCursorRule(body: string): string {
  return [
    '---',
    'description: Tersio modes (caveman, ponytail, rtk).',
    'alwaysApply: true',
    '---',
    '',
    body,
    '',
  ].join('\n');
}

/** The rules text for a host, whether or not it can auto-rewrite. */
function bodyFor(host: AgentHost): string {
  return isGuidanceOnly(host) ? guidanceRulesBody() : rulesBody();
}

/**
 * Skills written to a root shared by convention (`.agents/skills`) are a single
 * file that two hosts both claim, so their content cannot depend on which host
 * is asking — Codex would otherwise ship the auto-rewrite wording to the same
 * path OpenClaw writes the manual wording to, and whichever installed last
 * would win. The manual text is the safe superset: where a hook really does
 * rewrite, the instruction is merely redundant, never wrong.
 */
function skillBodyFor(host: AgentHost): string {
  if (host.skillsDir !== null && SHARED_SKILL_DIRS.has(host.skillsDir)) return guidanceRulesBody();
  return bodyFor(host);
}

/** The marked block, including the markers, for a merge into a user file. */
export function renderRulesBlock(host: AgentHost, existing: string | null): string {
  const block = `${START}\n<!-- Managed by tersio. Edits inside this block are overwritten. -->\n\n${bodyFor(host)}\n\n${END}`;
  return host.id === 'cursor' ? renderCursorRule(block) : applyMarkedBlock(existing, block, START, END);
}

// --- skills ----------------------------------------------------------------

/** Skill directory name. The `tersio-` prefix avoids collisions with built-ins. */
export function skillDirName(mode: string): string {
  return `tersio-${mode}`;
}

/**
 * Agent Skills frontmatter. `name` must equal the directory name and
 * `description` is required, so both are derived rather than trusted.
 */
export function renderSkill(mode: string, description: string, body: string): string {
  return [
    '---',
    `name: ${skillDirName(mode)}`,
    `description: ${description}`,
    '---',
    '',
    body,
    '',
  ].join('\n');
}

/** Claude Code reserves this folder name for its own sync feature. */
const RESERVED_SKILL_DIRS = new Set(['synced']);

// --- RTK rewriter ----------------------------------------------------------

/**
 * Renders the rewriter: reads a hook payload on stdin, writes back the host's
 * rewrite object when rtk has an equivalent. Never blocks — every failure path
 * leaves the original command running.
 */
export function renderRewriteScript(cfg: HostRewrite): string {
  // Dotted read of the host's own stdin shape, e.g. tool_input.command. A host
  // that forwards more than one spelling gets a first-wins chain.
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

  const outputs: Record<RewriteProtocol, string> = {
    // Claude Code / Codex / Grok: updatedInput replaces the whole input object.
    'hookSpecificOutput-updatedInput': `process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: '${cfg.event}',
    permissionDecision: 'allow',
    updatedInput: { command: rewritten },
  },
}));`,
    // Copilot: flat modifiedArgs, substituting the tool arguments.
    modifiedArgs: `process.stdout.write(JSON.stringify({ modifiedArgs: { command: rewritten } }));`,
    // Cursor: flat updated_input.
    updated_input: `process.stdout.write(JSON.stringify({ permission: 'allow', updated_input: { command: rewritten } }));`,
    // Hermes: shell-hook protocol, {"action":"modify","args":{...}}.
    'hermes-modify': `process.stdout.write(JSON.stringify({ action: 'modify', args: { command: rewritten } }));`,
  };

  return `${guard}
${outputs[cfg.protocol]}
process.exit(0);
`;
}

function quoteForShell(v: string): string {
  return /[\s"'$`\\]/.test(v) ? `'${v.replace(/'/g, `'\\''`)}'` : v;
}

/** The command the host will run, pointing at the script beside its own config. */
export function hookScriptCommand(scriptAbs: string): string {
  return `node ${quoteForShell(scriptAbs)}`;
}

function newHookEntry(command: string): HookEntry {
  return { name: HOOK_MARKER, type: 'command', command, timeout: 10 };
}

/**
 * Renders the hook config this host needs, carrying only our own entry.
 * Splicing into an existing file is `mergeHookConfig`'s job.
 */
export function renderHookConfig(host: AgentHost, scriptAbs: string): string | null {
  const cfg = host.rewriteConfig;
  if (!cfg) return null;
  const command = hookScriptCommand(scriptAbs);

  switch (cfg.configFormat) {
    case 'copilot-json':
      return `${JSON.stringify({
        version: 1,
        hooks: { [cfg.event]: [{ name: HOOK_MARKER, type: 'command', bash: command, command, timeoutSec: 10 }] },
      }, null, 2)}\n`;
    case 'cursor-json':
      return `${JSON.stringify({
        version: 1,
        hooks: { [cfg.event]: [{ matcher: cfg.matcher, hooks: [newHookEntry(command)] }] },
      }, null, 2)}\n`;
    case 'hermes-yaml':
      return [
        'hooks:',
        `  ${cfg.event}:`,
        `    - matcher: "${cfg.matcher}"`,
        `      command: ${command}`,
        '      timeout: 10',
        '      fail_closed: true',
        '',
      ].join('\n');
    case 'claude-json':
    default:
      return `${JSON.stringify({
        hooks: { [cfg.event]: [{ matcher: cfg.matcher, hooks: [newHookEntry(command)] }] },
      }, null, 2)}\n`;
  }
}

// --- hook config merging ---------------------------------------------------

function safeParseJson(text: string | null): Record<string, unknown> | null {
  if (!text || !text.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/** True when an entry is ours, whether marked by name or by script path. */
export function isMarkedEntry(entry: unknown): boolean {
  if (entry === null || typeof entry !== 'object') return false;
  const record = entry as Record<string, unknown>;
  if (record.name === HOOK_MARKER) return true;
  if (typeof record.command === 'string' && record.command.includes(HOOK_SCRIPT_NAME)) return true;
  if (Array.isArray(record.hooks)) return record.hooks.some(isMarkedEntry);
  return false;
}

/** The single entry carrying our marker in a parsed config, if present. */
function findMarkedEntry(config: Record<string, unknown>, event: string): HookEntry | null {
  const hooks = (config.hooks ?? {}) as Record<string, unknown>;
  const entries = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
  const found = entries.find(isMarkedEntry);
  return found !== undefined ? found as HookEntry : null;
}

/**
 * Splices our entry into an existing JSON hook config without touching anyone
 * else's, so a user's own hooks survive install and reinstall. Our entry is
 * identified by HOOK_MARKER, which also makes removal exact.
 *
 * Returns just our config when there is nothing parseable to merge into — a
 * corrupt or unrecognised file is the user's to fix, and refusing to clobber
 * it is the safe failure.
 */
export function mergeHookConfig(existing: string | null, ours: string, event: string): string {
  const base = safeParseJson(existing);
  const oursParsed = safeParseJson(ours);
  if (base === null || oursParsed === null) return ours;

  const oursEntry = findMarkedEntry(oursParsed, event);
  if (oursEntry === null) return ours;

  const baseHooks = (base.hooks ?? {}) as Record<string, unknown>;
  const existingEntries = Array.isArray(baseHooks[event]) ? (baseHooks[event] as unknown[]) : [];
  // Drop any previous tersio entry so reinstall is idempotent, then append ours.
  const kept = existingEntries.filter((entry) => !isMarkedEntry(entry));
  kept.push(oursEntry);

  return `${JSON.stringify({ ...base, hooks: { ...baseHooks, [event]: kept } }, null, 2)}\n`;
}

/**
 * Removes only our entry from a host's hook config, preserving every other
 * hook. Returns the config unchanged when none of ours was present, so a
 * caller can tell "nothing to do" from "removed".
 */
export function removeFromHookConfig(existing: string, event: string): string {
  const base = safeParseJson(existing);
  if (base === null) return existing;
  const baseHooks = (base.hooks ?? {}) as Record<string, unknown>;
  const entries = Array.isArray(baseHooks[event]) ? (baseHooks[event] as unknown[]) : [];
  const kept = entries.filter((entry) => !isMarkedEntry(entry));
  if (kept.length === entries.length) return existing;

  if (kept.length > 0) {
    return `${JSON.stringify({ ...base, hooks: { ...baseHooks, [event]: kept } }, null, 2)}\n`;
  }

  // Ours was the only entry for this event: drop the event key, then drop an
  // emptied `hooks` object so uninstall never leaves `{"hooks":{}}` behind.
  const { [event]: _removedEvent, ...restHooks } = baseHooks;
  const next: Record<string, unknown> = { ...base };
  delete next.hooks;
  if (Object.keys(restHooks).length > 0) next.hooks = restHooks;
  return `${JSON.stringify(next, null, 2)}\n`;
}

// --- planning --------------------------------------------------------------

export interface HostPlan {
  host: AgentHost;
  artifacts: HostArtifact[];
  /** True when this host got a real static rewrite hook. */
  rewriteInstalled: boolean;
  /** True when the host gets guidance text because it cannot rewrite. */
  guidanceOnly: boolean;
  /** True when a wiring module, not these emitters, owns the rewrite. */
  liveExtension: boolean;
}

const SKILL_DESCRIPTIONS: Record<string, string> = {
  caveman: 'Tersio caveman mode — terse replies with complete technical substance. Use when the user asks for tersio, caveman, or brevity.',
  ponytail: 'Tersio ponytail mode — minimum correct code, root causes, no speculative abstractions. Use when the user asks for tersio, ponytail, or minimal code.',
  rtk: 'Tersio rtk mode — filter noisy shell output through the rtk binary. Use when the user asks for tersio, rtk, or token-killed output.',
};

export interface ExistingHostFiles {
  rulesFile?: string | null;
  hookConfig?: string | null;
}

/**
 * Produces every artifact for one host, as data. Nothing is written here, so
 * the whole matrix is testable without touching a filesystem.
 */
export function planHost(host: AgentHost, home: string, existing: ExistingHostFiles = {}): HostPlan {
  const artifacts: HostArtifact[] = [];

  if (host.rules && host.rulesFile) {
    artifacts.push({
      kind: 'rules',
      absPath: hostPath(host, host.rulesFile, home),
      content: renderRulesBlock(host, existing.rulesFile ?? null),
      // Cursor owns a dedicated rule file, so it is written whole; everything
      // else merges into a file the user also writes to.
      merge: host.id === 'cursor' ? 'whole' : 'block',
    });
  }

  if (host.skills && host.skillsDir) {
    const skillsRoot = hostPath(host, host.skillsDir, home);
    for (const [mode, description] of Object.entries(SKILL_DESCRIPTIONS)) {
      const dirName = skillDirName(mode);
      if (RESERVED_SKILL_DIRS.has(dirName)) continue;
      artifacts.push({
        kind: 'skill',
        absPath: path.join(skillsRoot, dirName, 'SKILL.md'),
        content: renderSkill(mode, description, skillBodyFor(host)),
        // Terse owns the skill directory outright, and Hermes scans skill files
        // for injection patterns, so these carry no markers.
        merge: 'whole',
      });
    }
  }

  let rewriteInstalled = false;
  const cfg = host.rewriteConfig;
  if (hasStaticHook(host) && cfg) {
    const configAbs = hostPath(host, cfg.configFile, home);
    const scriptAbs = path.join(path.dirname(configAbs), HOOK_SCRIPT_NAME);
    const rendered = renderHookConfig(host, scriptAbs);
    if (rendered) {
      artifacts.push({ kind: 'hook-script', absPath: scriptAbs, content: renderRewriteScript(cfg), merge: 'whole' });
      artifacts.push({
        kind: 'hook-config',
        absPath: configAbs,
        content: cfg.configFormat === 'hermes-yaml'
          ? rendered
          : mergeHookConfig(existing.hookConfig ?? null, rendered, cfg.event),
        merge: cfg.configFormat === 'hermes-yaml' ? 'block' : 'json',
      });
      rewriteInstalled = true;
    }
  }

  return {
    host,
    artifacts,
    rewriteInstalled,
    guidanceOnly: isGuidanceOnly(host),
    liveExtension: isLiveExtension(host),
  };
}

/** Every host planned, in registry order. */
export function planAll(home: string, existing: Record<string, ExistingHostFiles> = {}): HostPlan[] {
  return HOSTS.map((host) => planHost(host, home, existing[host.id] ?? {}));
}

export { HOOK_SCRIPT_NAME, HOOK_MARKER };
