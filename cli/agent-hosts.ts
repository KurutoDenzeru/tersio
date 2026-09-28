// cli/agent-hosts.ts — the host registry. One entry per agent carrying only
// what differs between hosts; shared mode text lives in cli/rules-pack.ts.
//
// Every path, event name, and wire protocol below is cited in `source` to that
// host's own documentation. Capability flags are load-bearing, not comments:
// `rewrite` means a documented pre-execution surface can replace the shell
// command string, so a host without one gets RTK guidance and no hook file —
// a hook the host ignores is worse than none.
//
// Deliberately free of cli/common.ts imports (argv side effects) so tests can
// load it directly.
import path from 'node:path';

/** How a host's `PreToolUse`-style hook is configured on disk. */
export type HookConfigFormat = 'claude-json';

/** The shape a host expects a rewrite to come back in. */
export type RewriteProtocol = 'hookSpecificOutput-updatedInput';

export interface HostRewrite {
  /** Config file the host reads, `$HOME`-relative. */
  configFile: string;
  configFormat: HookConfigFormat;
  /** Event name as the host spells it. */
  event: string;
  /** Regex or literal matcher for the shell tool. */
  matcher: string;
  /**
   * Where the shell command lives in the hook's stdin payload. An array when a
   * host forwards more than one spelling (Grok accepts both cases).
   */
  inputPath: string | string[];

  /** How the rewritten command is returned. */
  protocol: RewriteProtocol;
  /** True when a non-zero exit or malformed output BLOCKS the tool call. */
  failClosed: boolean;
}

/**
 * Which module owns this host's rewrite when there is no static hook file.
 * Every supported host has one or the other — asserted in the registry tests,
 * because a host silently claiming a working auto-rewrite is the exact failure
 * this registry exists to prevent.
 */
export type RewriteOwner = 'wiring' | 'plugin';

export interface AgentHost {
  id: string;
  label: string;
  /** User-global config dir, `$HOME`-relative or absolute. */
  configDir: string;
  /** Env var that relocates configDir, when the host supports one. */
  configDirEnv?: string;
  /**
   * Binaries to probe on PATH, in order. A bare `cmd` is never probed on
   * win32, where it resolves to the system shell.
   */
  binaries: string[];
  rules: boolean;
  skills: boolean;
  rewrite: boolean;
  /**
   * False for a host that is never auto-detected, whatever is on disk.
   *
   * Oh My Pi is the origin host and is always in scope: it is picked through
   * its own menu row and removed through the layer block, never as a saved
   * entry. Detecting it would quietly put it back into a selection that had
   * deliberately dropped it. This used to fall out of omp having no static
   * paths, which stopped being true when it gained a static tier.
   */
  autoDetect?: boolean;
  /** User-global instruction file, `$HOME`-relative. Null when there is none. */
  rulesFile: string | null;
  /** User-global skills dir, `$HOME`-relative. Null when unsupported. */
  skillsDir: string | null;
  rewriteConfig?: HostRewrite;
  /**
   * `$HOME`-relative paths an earlier version wrote for this host that the
   * current one does not.
   *
   * Removing a capability strands whatever it wrote: the file stays on disk, and
   * because the current planner no longer emits it, uninstall cannot see it
   * either. Both install and uninstall clear these, so upgrading tidies and
   * uninstalling is honest.
   *
   * `ours` is a directory or file we created outright, so it goes with
   * `rm -rf`. `merged` is a file the user also owns — an AGENTS.md of their
   * own is exactly the case that bit us once already — so only our marked block
   * is removed, and the file survives unless nothing of theirs is left in it.
   */
  retired?: Array<{ path: string; kind: 'ours' | 'merged' }>;
  /** Docs URL that justifies the paths above. */
  source: string;
  /**
   * How this host installs the plugin with its own tooling, when it has any.
   *
   * `tersio install` writes the files directly, which is the path we support for
   * every host. A native command is the alternative for someone who prefers
   * their agent's own package manager. Hosts with no entry have no native
   * install: OpenCode has no command because it needs none, and Claude Code and
   * Codex are deliberately on hold until their plugin ports are adopted.
   */
  nativeInstall?: { command?: string; note: string };
  /**
   * Which module owns this host's rewrite when there is no static hook file.
   * Structural rather than prose: `tersio doctor` reports it, and the registry
   * test asserts a rewrite-capable host either has a hook config or names its
   * owner, so silence cannot slip through.
   */
  rewriteOwner?: RewriteOwner;
  /** Caveats an emitter must respect, shown by `tersio doctor`. */
  caveats?: string;
}

const HOSTS: AgentHost[] = [
  {
    id: 'omp',
    label: 'Oh My Pi (OMP)',
    autoDetect: false,
    rules: false,
    configDir: '.omp',
    binaries: ['omp'],
        skills: false,
    // The extension tree injects the mode text on every turn, so a skill is a
    // second copy of it. Retired rather than deleted by hand, so install and
    // uninstall both clear what earlier versions wrote.
    retired: [
      { path: '.omp/agent/AGENTS.md', kind: 'merged' },
      { path: '.omp/agent/skills/tersio-caveman', kind: 'ours' },
      { path: '.omp/agent/skills/tersio-ponytail', kind: 'ours' },
      { path: '.omp/agent/skills/tersio-rtk', kind: 'ours' },
    ],
    rewrite: true,
    // No rules file, and that is the point. The extension layer below injects
    // the same three sections on every turn, so a static copy would duplicate
    // them and — being always-on — would outlive `/combo off`, leaving caveman
    // permanently on with no way to turn it off. It would also be merged into
    // whatever global instructions the user keeps at ~/.omp/agent/AGENTS.md,
    // which is theirs, not ours. Skills are kept: they are advertised by
    // description and loaded on demand, so they neither duplicate the injection
    // nor fight the off switch.
    //   omp.sh/docs/skills -> user skills at ~/.omp/agent/skills/<name>/
    rulesFile: null,
    skillsDir: null,
    caveats: 'Reference host. A live extension owns the rewrite, so cli/rtk-wiring.ts registers rtk\'s own module instead of a static hook.',
    rewriteOwner: 'wiring',
    source: 'https://omp.sh/docs/context-files',
    nativeInstall: { command: 'omp install @krtclcdy/tersio', note: 'or let `tersio install` write the layer for you' },
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    configDir: '.config/opencode',
    binaries: ['opencode'],
    // Same as omp: OpenCode gets a real plugin from cli/opencode-wiring.ts,
    // because its documented hook surface cannot rewrite a tool input.
    // No rules file: the plugin injects the modes itself, by appending a marked
    // block to each agent's `system` and switching the mode's skill to
    // `autoinvoke`. A static AGENTS.md would say the same thing forever, so it
    // would outlive `/combo off` — the exact problem a live tier has to avoid.
    rules: false,
    skills: true,
    rewrite: true,
    // V2 reads a global AGENTS.md from the config dir, and its skills docs
    // list `~/.config/opencode/skills` as a Global discovery source, alongside
    // the project-scoped `.opencode/skills/`. It also reads `~/.claude/skills`
    // and `~/.agents/skills` as global compatibility sources, so OpenCode has
    // been picking up the shared skills we write for Codex and Pi without us
    // pointing it anywhere. Writing our own global dir makes that a decision
    // rather than an accident.
    rulesFile: null,
    skillsDir: '.config/opencode/skills',
    caveats: 'Current OpenCode discovers only AGENTS.md for instructions. rtk init still emits a pre-v2 plugin that current OpenCode refuses to load (rtk-ai/rtk#3463), so tersio ships its own plugin via cli/opencode-wiring.ts. Set TERSIO_RTK=off to disable the rewrite.',
    rewriteOwner: 'plugin',
    source: 'https://opencode.ai/docs/rules',
    // The skills stay, unlike omp and pi: the plugin has no per-turn prompt hook
    // (`agent.system` is global, not per turn), so `autoinvoke` on those skills
    // is how the per-mode prose actually reaches the model. On omp and pi the
    // extension tree injects it directly, so their skills were a second copy.
    retired: [
      { path: '.config/opencode/AGENTS.md', kind: 'merged' },
    ],
    nativeInstall: { note: 'no command needed — OpenCode loads ~/.config/opencode/plugins/ at startup' },
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    configDir: '.claude',
    binaries: ['claude'],
    rules: false,
    skills: true,
    rewrite: true,
    // No rules file: it is merged into a file the user owns, and a global
    // CLAUDE.md is theirs to keep. The modes reach these hosts through the skills
    // until their plugin port carries them in a hook instead.
    rulesFile: null,
    skillsDir: '.claude/skills',
    retired: [
      { path: '.claude/CLAUDE.md', kind: 'merged' },
    ],
    caveats: 'Skill folder named `synced` is reserved and skipped. Never overwrite CLAUDE.md or settings.json — merge instead.',
    rewriteConfig: {
      configFile: '.claude/settings.json',
      configFormat: 'claude-json',
      event: 'PreToolUse',
      matcher: 'Bash',
      inputPath: 'tool_input.command',
      protocol: 'hookSpecificOutput-updatedInput',
      failClosed: false,
    },
    source: 'https://docs.claude.com/en/docs/claude-code/hooks',
  },
  {
    id: 'codex',
    label: 'OpenAI Codex',
    configDir: '.codex',
    configDirEnv: 'CODEX_HOME',
    binaries: ['codex'],
    rules: false,
    skills: true,
    rewrite: true,
    // No rules file: it is merged into a file the user owns, and a global
    // AGENTS.md is theirs to keep. The modes reach these hosts through the skills
    // until their plugin port carries them in a hook instead.
    rulesFile: null,
    skillsDir: '.agents/skills',
    retired: [
      { path: '.codex/AGENTS.md', kind: 'merged' },
    ],
    caveats: 'A stale AGENTS.override.md silently suppresses AGENTS.md. The combined instruction chain is capped at 32 KiB (project_doc_max_bytes).',
    rewriteConfig: {
      configFile: '.codex/hooks.json',
      configFormat: 'claude-json',
      event: 'PreToolUse',
      matcher: '^Bash$',
      inputPath: 'tool_input.command',
      protocol: 'hookSpecificOutput-updatedInput',
      failClosed: false,
    },
    source: 'https://learn.chatgpt.com/docs/hooks',
  },
  {
    id: 'pi',
    label: 'Pi',
    configDir: '.pi/agent',
    configDirEnv: 'PI_CODING_AGENT_DIR',
    binaries: ['pi'],
    rules: false,
        skills: false,
    // The extension tree injects the mode text on every turn, so a skill is a
    // second copy of it. Retired rather than deleted by hand, so install and
    // uninstall both clear what earlier versions wrote.
    retired: [
      { path: '.pi/agent/AGENTS.md', kind: 'merged' },
      { path: '.pi/agent/skills/tersio-caveman', kind: 'ours' },
      { path: '.pi/agent/skills/tersio-ponytail', kind: 'ours' },
      { path: '.pi/agent/skills/tersio-rtk', kind: 'ours' },
    ],
    // Pi has no JSON hook file: it loads ~/.pi/agent/extensions/*.ts through
    // jiti, so the rewrite is a TypeScript module. Emitting a JSON config into
    // a .ts path would not parse, which silently disables rewriting.
    rewrite: true,
    // No rules file for the same reason as omp: the extension tree injects the
    // three sections every turn, and an always-on static copy would outlive
    // `/combo off`. The skills below are the on-demand half.
    rulesFile: null,
    skillsDir: null,
    caveats: 'AGENTS.override.md replaces rather than merges. Never write SYSTEM.md — it replaces the default system prompt outright. The TS extension is rtk\'s own, written by `rtk init -g --agent pi`; rtk owns that format, so no tersio release is needed when it changes.',
    rewriteOwner: 'wiring',
    source: 'https://pi.dev/docs/latest/extensions',
    nativeInstall: { command: 'pi install npm:@krtclcdy/tersio', note: 'declares the `pi` manifest in package.json' },
  },
];

function byId(id: string): AgentHost | undefined {
  return HOSTS.find((h) => h.id === id);
}

/** True when tersio can write a static hook file for this host. */
export function hasStaticHook(host: AgentHost): boolean {
  return host.rewrite && host.rewriteConfig !== undefined;
}

/**
 * Hosts whose rewrite runs as live host code rather than a static hook, and
 * which we actually wire. A `pending` owner is excluded: we do not ship that
 * rewrite yet, so the host behaves as guidance-only.
 */
export function isLiveExtension(host: AgentHost): boolean {
  return host.rewrite && host.rewriteConfig === undefined;
}

/**
 * Hosts the user gets RTK guidance for rather than a working auto-rewrite,
 * because the host has no documented pre-execution surface we can drive.
 */
export function isGuidanceOnly(host: AgentHost): boolean {
  return !host.rewrite;
}

/**
 * Skill roots shared by convention across hosts (the Agent Skills `.agents`
 * directory). Two hosts may legitimately write the same skill here, and when
 * they do the content must be byte-identical.
 */
export const SHARED_SKILL_DIRS = new Set(['.agents/skills']);

/**
 * Resolves a `$HOME`-relative registry path to an absolute one.
 *
 * Registry paths are always `$HOME`-relative (`.claude/settings.json`), but a
 * host with a relocation env var moves its whole config dir — `CODEX_HOME`
 * turns `.codex/hooks.json` into `$CODEX_HOME/hooks.json`. Only paths *inside*
 * the config dir move with it; a shared-convention path like `.agents/skills`
 * belongs to the home directory and must not.
 */
export function hostPath(host: AgentHost, homeRelative: string, home: string): string {
  const rel = host.configDir;
  const relocated = host.configDirEnv ? process.env[host.configDirEnv] : undefined;
  const base = relocated && relocated.trim() !== '' ? relocated : null;

  if (base) {
    if (homeRelative === rel) return base;
    const prefix = `${rel}/`;
    if (homeRelative.startsWith(prefix)) return path.join(base, homeRelative.slice(prefix.length));
  }
  return path.join(home, homeRelative);
}

export { HOSTS, byId };
