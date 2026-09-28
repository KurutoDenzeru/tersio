// The host registry: one entry per agent, carrying only what the CLI needs to find it, install it and undo it.

export interface AgentHost {
  id: string;
  label: string;
  // User-global config dir, `$HOME`-relative.
  configDir: string;
  // Env var that relocates configDir, when the host supports one.
  configDirEnv?: string;
  // Binaries to probe on PATH, in order. A bare `cmd` never is: it is the Windows shell.
  binaries: string[];
  // False for a host that is never auto-detected. Oh My Pi is the origin host and always in scope, so detecting it would...
  autoDetect?: boolean;
  // `$HOME`-relative paths an earlier version wrote and this one no longer does;
  retired?: Array<{ path: string; kind: 'ours' | 'merged' }>;
  // Docs URL that justifies the paths above.
  source: string;
  // How this host installs the package with its own tooling;
  nativeInstall?: { command?: string; note: string };
  // Caveats an installer must respect, shown by `tersio doctor`.
  caveats?: string;
}

// How the shell rewrite reaches the model. Every host routes it through rtk's own module (`rtk init -g --agent <id>`), so...
export const REWRITE_WIRING = 'rtk extension · auto-rewrite';

const HOSTS: AgentHost[] = [
  {
    id: 'omp',
    label: 'Oh My Pi (OMP)',
    autoDetect: false,
    configDir: '.omp',
    binaries: ['omp'],
    // Earlier versions wrote these. The tree injects the modes every turn, so a skill is a second copy and a rules file is...
    retired: [
      { path: '.omp/agent/AGENTS.md', kind: 'merged' },
      { path: '.omp/agent/skills/tersio-caveman', kind: 'ours' },
      { path: '.omp/agent/skills/tersio-ponytail', kind: 'ours' },
      { path: '.omp/agent/skills/tersio-rtk', kind: 'ours' },
    ],
    caveats: 'Reference host. The modes are injected by the extension tree in ~/.omp/agent/extensions, so no static copy is written and the rewrite is rtk\'s own module (rtk init -g --agent omp).',
    source: 'https://omp.sh/docs/context-files',
    nativeInstall: { command: 'omp install @krtclcdy/tersio', note: 'or let `tersio install` write the layer for you' },
  },
  {
    id: 'pi',
    label: 'Pi',
    configDir: '.pi/agent',
    configDirEnv: 'PI_CODING_AGENT_DIR',
    binaries: ['pi'],
    retired: [
      { path: '.pi/agent/AGENTS.md', kind: 'merged' },
      { path: '.pi/agent/skills/tersio-caveman', kind: 'ours' },
      { path: '.pi/agent/skills/tersio-ponytail', kind: 'ours' },
      { path: '.pi/agent/skills/tersio-rtk', kind: 'ours' },
    ],
    caveats: 'AGENTS.override.md replaces rather than merges. Never write SYSTEM.md — it replaces the default system prompt outright. The rewrite is rtk\'s own module, written by `rtk init -g --agent pi`; rtk owns that format, so no tersio release is needed when it changes.',
    source: 'https://pi.dev/docs/latest/extensions',
    nativeInstall: { command: 'pi install npm:@krtclcdy/tersio', note: 'declares the `pi` manifest in package.json' },
  },
];

function byId(id: string): AgentHost | undefined {
  return HOSTS.find((h) => h.id === id);
}

export { HOSTS, byId };
