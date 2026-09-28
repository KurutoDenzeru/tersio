// cli/agent-hosts.ts — the host registry. One entry per agent, carrying only
// what the CLI needs to find it, install it, and undo it.
//
// Both supported hosts are extension-tree hosts: the modes arrive from a live
// extension that injects them every turn, and the shell rewrite is rtk's own
// module, written by `rtk init`. So there are no static artifacts per host —
// no rules file, no skills directory, no hook config. The extension trees
// themselves are named in cli/omp-layer.ts and cli/pi-layer.ts, and the menus,
// the doctor rows, and the previews all read those.
//
// Deliberately free of cli/common.ts imports (argv side effects) so tests can
// load it directly.

export interface AgentHost {
  id: string;
  label: string;
  /** User-global config dir, `$HOME`-relative. */
  configDir: string;
  /** Env var that relocates configDir, when the host supports one. */
  configDirEnv?: string;
  /**
   * Binaries to probe on PATH, in order. A bare `cmd` is never probed on
   * win32, where it resolves to the system shell.
   */
  binaries: string[];
  /**
   * False for a host that is never auto-detected, whatever is on disk.
   *
   * Oh My Pi is the origin host and is always in scope: it is picked through
   * its own menu row and removed through the layer block, never as a saved
   * entry. Detecting it would quietly put it back into a selection that had
   * deliberately dropped it.
   */
  autoDetect?: boolean;
  /**
   * `$HOME`-relative paths an earlier version wrote for this host that the
   * current one does not.
   *
   * Removing a capability strands whatever it wrote: the path stays on disk, so
   * it would otherwise survive both install and uninstall. Both clear these, so
   * upgrading tidies and uninstalling is honest.
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
   * How this host installs the package with its own tooling. `tersio install`
   * writes the files directly, which is the path we support; a native command
   * is the alternative for someone who prefers their agent's own manager.
   */
  nativeInstall?: { command?: string; note: string };
  /** Caveats an installer must respect, shown by `tersio doctor`. */
  caveats?: string;
}

/**
 * How the shell rewrite reaches the model, in the words the menus and the
 * dashboard use. Every supported host routes it through rtk's own extension
 * module (`rtk init -g --agent <id>`), so there is no per-host variant to
 * branch on — a host that cannot do it is not in this registry.
 */
export const REWRITE_WIRING = 'rtk extension · auto-rewrite';

const HOSTS: AgentHost[] = [
  {
    id: 'omp',
    label: 'Oh My Pi (OMP)',
    autoDetect: false,
    configDir: '.omp',
    binaries: ['omp'],
    // Earlier versions wrote these. The extension tree injects the mode text
    // on every turn, so a skill is a second copy of it and a static rules file
    // is always on — it would outlive `/combo off` and leave caveman on with no
    // way to turn it off. Retired rather than deleted by hand, so install and
    // uninstall both clear what an earlier version left behind.
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
