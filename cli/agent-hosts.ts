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
 *
 * Every supported host either has a static hook or a named owner, so a
 * `rewrite: true` host with neither is a half-filled entry. That invariant is
 * asserted in the registry tests, because a host that silently claims a working
 * auto-rewrite is the exact failure this registry exists to prevent.
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
  /** User-global instruction file, `$HOME`-relative. Null when there is none. */
  rulesFile: string | null;
  /** User-global skills dir, `$HOME`-relative. Null when unsupported. */
  skillsDir: string | null;
  rewriteConfig?: HostRewrite;
  /** Docs URL that justifies the paths above. */
  source: string;
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
    configDir: '.omp',
    binaries: ['omp'],
    // Live extension, so the generic emitters skip this host: a static file
    // would duplicate it. Flags stay truthful for the doctor matrix.
    rules: true,
    skills: true,
    rewrite: true,
    rulesFile: null,
    skillsDir: null,
    caveats: 'Reference host. A live extension owns the rewrite, so cli/rtk-wiring.ts registers rtk\'s own module instead of a static hook.',
    rewriteOwner: 'wiring',
    source: 'https://omp.sh/docs/context-files',
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    configDir: '.config/opencode',
    binaries: ['opencode'],
    // Same as omp: OpenCode gets a real plugin from cli/opencode-wiring.ts,
    // because its documented hook surface cannot rewrite a tool input.
    rules: true,
    skills: true,
    rewrite: true,
    // V2 reads a global AGENTS.md from the config dir. No global skills
    // location is documented -- `.opencode/skills/` is project-scoped -- so the
    // skills flag stays true while the path stays null.
    rulesFile: '.config/opencode/AGENTS.md',
    skillsDir: null,
    caveats: 'Current OpenCode discovers only AGENTS.md; the CLAUDE.md and ~/.claude/skills fallbacks are gone. rtk init still emits a pre-v2 plugin that current OpenCode refuses to load (rtk-ai/rtk#3463), so tersio ships its own plugin via cli/opencode-wiring.ts. Set TERSIO_RTK=off to disable the rewrite.',
    rewriteOwner: 'plugin',
    source: 'https://opencode.ai/docs/rules',
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    configDir: '.claude',
    binaries: ['claude'],
    rules: true,
    skills: true,
    rewrite: true,
    rulesFile: '.claude/CLAUDE.md',
    skillsDir: '.claude/skills',
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
    rules: true,
    skills: true,
    rewrite: true,
    rulesFile: '.codex/AGENTS.md',
    skillsDir: '.agents/skills',
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
    rules: true,
    skills: true,
    // Pi has no JSON hook file: it loads ~/.pi/agent/extensions/*.ts through
    // jiti, so the rewrite is a TypeScript module. Emitting a JSON config into
    // a .ts path would not parse, which silently disables rewriting.
    rewrite: true,
    rulesFile: '.pi/agent/AGENTS.md',
    skillsDir: '.pi/agent/skills',
    caveats: 'AGENTS.override.md replaces rather than merges. Never write SYSTEM.md — it replaces the default system prompt outright. The TS extension is rtk\'s own, written by `rtk init -g --agent pi`; rtk owns that format, so no tersio release is needed when it changes.',
    rewriteOwner: 'wiring',
    source: 'https://pi.dev/docs/latest/extensions',
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
 * Hosts the generic emitters skip entirely, because a wiring module owns both
 * their instruction file and their skills. A null `rulesFile`/`skillsDir` is
 * only legitimate on one of these — anywhere else it is a half-filled entry.
 */
export function isOwnPath(host: AgentHost): boolean {
  return host.rulesFile === null && host.skillsDir === null;
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
