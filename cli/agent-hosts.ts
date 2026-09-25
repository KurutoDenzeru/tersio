// cli/agent-hosts.ts — the host registry. One entry per agent carrying only
// what differs between hosts; shared mode text lives in cli/rules-pack.ts.
//
// Paths and protocols come from each host's own docs, cited in `source`.
// Capability flags are load-bearing: `rewrite` means a documented
// pre-execution hook exists, so a host without it gets guidance only.

export interface HostRewrite {
  /** Absolute path of the hook config file, relative to $HOME where possible. */
  configFile: string;
  /** Format the config file must have. */
  configFormat: 'claude-json' | 'gemini-json' | 'copilot-json' | 'cursor-json' | 'grok-json' | 'hermes-yaml';
  /** Event name as the host spells it. */
  event: string;
  /** Regex or literal matcher for the shell tool. */
  matcher: string;
  /**
   * Where the shell command lives in the hook's stdin payload. An array when a
   * host accepts both spellings (Grok: `toolInput` and `tool_input`).
   */
  inputPath: string | string[];
  /** How the rewritten command is returned. */
  protocol: 'hookSpecificOutput-updatedInput'
  | 'hookSpecificOutput-toolInput'
  | 'modifiedArgs'
  | 'updatedInput'
  | 'hermes-modify';
  /** True when a non-zero exit or malformed output BLOCKS the tool call. */
  failClosed: boolean;
}

export interface AgentHost {
  id: string;
  label: string;
  /** User-global config dir, `$HOME`-relative or absolute. */
  configDir: string;
  /** Env var that relocates configDir, when the host supports one. */
  configDirEnv?: string;
  /** Binary to probe on PATH; empty string when the host has no CLI. */
  binary: string;
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
  /** Caveats an emitter must respect, shown by `tersio doctor`. */
  caveats?: string;
}

/**
 * `omp` and `opencode` ship live extensions via their own wiring modules, so
 * they are listed for selection and detection but carry no emitter fields.
 */
const HOSTS: AgentHost[] = [
  {
    id: 'omp',
    label: 'Oh My Pi (OMP)',
    configDir: '.omp',
    binary: 'omp',
    // Live extension, so generic emitters skip this host: a static file would
    // duplicate it. Flags stay truthful for the doctor matrix.
    rules: true,
    skills: true,
    rewrite: true,
    rulesFile: null,
    skillsDir: null,
    source: 'https://omp.sh/docs/context-files',
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    configDir: '.config/opencode',
    binary: 'opencode',
    // Same as omp: OpenCode gets a real plugin from cli/opencode-wiring.ts,
    // not a static rules pack.
    rules: true,
    skills: true,
    rewrite: true,
    rulesFile: null,
    skillsDir: null,
    source: 'https://opencode.ai/docs/rules',
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    configDir: '.claude',
    binary: 'claude',
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
    binary: 'codex',
    rules: true,
    skills: true,
    rewrite: true,
    rulesFile: '.codex/AGENTS.md',
    skillsDir: '.agents/skills',
    caveats: 'A stale AGENTS.override.md silently suppresses AGENTS.md. Combined instruction chain is capped at 32 KiB (project_doc_max_bytes).',
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
    id: 'gemini-cli',
    label: 'Gemini CLI',
    configDir: '.gemini',
    binary: 'gemini',
    rules: true,
    skills: true,
    rewrite: true,
    rulesFile: '.gemini/GEMINI.md',
    skillsDir: '.gemini/skills',
    caveats: 'Global GEMINI.md is concatenated with workspace files, never replaced. Hooks fail open on a non-zero exit, so a broken rewriter silently degrades to no rewriting.',
    rewriteConfig: {
      configFile: '.gemini/settings.json',
      configFormat: 'gemini-json',
      event: 'BeforeTool',
      matcher: 'run_shell_command',
      inputPath: 'tool_input.command',
      protocol: 'hookSpecificOutput-toolInput',
      failClosed: false,
    },
    source: 'https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/reference.md',
  },
  {
    id: 'copilot-cli',
    label: 'GitHub Copilot CLI',
    configDir: '.copilot',
    configDirEnv: 'COPILOT_HOME',
    binary: 'copilot',
    rules: true,
    skills: true,
    rewrite: true,
    rulesFile: '.copilot/copilot-instructions.md',
    skillsDir: '.copilot/skills',
    caveats: 'Instruction files combine rather than override, and need a session restart. preToolUse is fail-CLOSED on error but fail-open on timeout.',
    rewriteConfig: {
      configFile: '.copilot/hooks/tersio-rtk.json',
      configFormat: 'copilot-json',
      event: 'preToolUse',
      matcher: '^(bash|command|powershell)$',
      inputPath: 'toolArgs.command',
      protocol: 'modifiedArgs',
      failClosed: true,
    },
    source: 'https://docs.github.com/en/copilot/reference/hooks-reference',
  },
  {
    id: 'cursor',
    label: 'Cursor',
    configDir: '.cursor',
    configDirEnv: 'CURSOR_CONFIG_DIR',
    binary: 'agent',
    rules: true,
    skills: true,
    rewrite: true,
    // User rules need .mdc frontmatter; a plain .md is ignored by the engine.
    rulesFile: '.cursor/rules/tersio.mdc',
    skillsDir: '.cursor/skills',
    caveats: 'Rules need .mdc frontmatter or they are silently ignored. Use preToolUse with matcher "Shell" — beforeShellExecution rejects updated_input and BLOCKS the call.',
    rewriteConfig: {
      configFile: '.cursor/hooks.json',
      configFormat: 'cursor-json',
      event: 'preToolUse',
      matcher: 'Shell',
      inputPath: 'tool_input.command',
      protocol: 'updatedInput',
      failClosed: true,
    },
    source: 'https://cursor.com/docs/agent/hooks',
  },
  {
    id: 'grok-build',
    label: 'Grok Build',
    configDir: '.grok',
    configDirEnv: 'GROK_HOME',
    binary: 'grok',
    rules: true,
    skills: true,
    rewrite: true,
    rulesFile: '.grok/rules/tersio.md',
    skillsDir: '.grok/skills',
    caveats: 'Global hooks live in ~/.grok/hooks/*.json and are always trusted; project hooks need --trust. A non-zero exit drops the rewrite, so always exit 0.',
    rewriteConfig: {
      configFile: '.grok/hooks/tersio-rtk.json',
      configFormat: 'claude-json',
      event: 'PreToolUse',
      matcher: 'Bash',
      // Grok's own payload is camelCase; it also forwards Claude-style
      // snake_case unchanged, so accept either rather than guess.
      inputPath: ['toolInput.command', 'tool_input.command'],
      protocol: 'hookSpecificOutput-updatedInput',
      failClosed: false,
    },
    source: 'https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/10-hooks.md',
  },
  {
    id: 'pi',
    label: 'Pi',
    configDir: '.pi/agent',
    configDirEnv: 'PI_CODING_AGENT_DIR',
    binary: 'pi',
    rules: true,
    skills: true,
    // Pi has no JSON hook file: it loads ~/.pi/agent/extensions/*.ts through
    // jiti, so the rewrite is a TypeScript module written by `rtk init`.
    // Emitting a JSON config into a .ts path would not parse, which silently
    // disables rewriting. cli/rtk-wiring.ts owns this host.
    rewrite: true,
    rulesFile: '.pi/agent/AGENTS.md',
    skillsDir: '.pi/agent/skills',
    caveats: 'AGENTS.override.md replaces rather than merges. Never write SYSTEM.md — it replaces the default system prompt outright.',
    source: 'https://pi.dev/docs/latest/extensions',
  },
  {
    id: 'openclaw',
    label: 'OpenClaw',
    configDir: '.openclaw',
    configDirEnv: 'OPENCLAW_STATE_DIR',
    binary: 'openclaw',
    rules: true,
    skills: true,
    rewrite: false,
    rulesFile: '.openclaw/workspace/AGENTS.md',
    skillsDir: '.agents/skills',
    caveats: 'Shell rewrite needs a native TypeScript plugin registering before_tool_call; a static hook file cannot rewrite tool args. Guidance only until then.',
    source: 'https://docs.openclaw.ai/plugins/hooks',
  },

  {
    id: 'hermes',
    label: 'Hermes',
    configDir: '.hermes',
    configDirEnv: 'HERMES_HOME',
    binary: 'hermes',
    // Hermes has no user-global instruction file at all: SOUL.md is its only
    // global context file, and AGENTS.md is project-scope only. So the portable
    // mode text reaches Hermes through skills, not a rules pack.
    rules: false,
    skills: true,
    rewrite: true,
    rulesFile: null,
    skillsDir: '.hermes/skills',
    caveats: 'No user-global AGENTS.md: SOUL.md is the only global context file. A project context file is scanned for prompt-injection patterns and dropped whole on a hit, so the block must avoid phrases like "ignore previous instructions" or hidden HTML comments.',
    rewriteConfig: {
      configFile: '.hermes/config.yaml',
      configFormat: 'hermes-yaml',
      event: 'pre_tool_call',
      matcher: '*',
      inputPath: 'args.command',
      protocol: 'hermes-modify',
      failClosed: true,
    },
    source: 'https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks',
  },
];

/** Hosts owned by a dedicated wiring module rather than the generic emitters. */
const OWN_PATH_HOSTS = ['omp', 'opencode'];

function byId(id: string): AgentHost | undefined {
  return HOSTS.find((h) => h.id === id);
}

export { HOSTS, byId, OWN_PATH_HOSTS };
