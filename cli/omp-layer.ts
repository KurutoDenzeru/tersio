// cli/omp-layer.ts — the Oh My Pi layer as data.
//
// The extension directories, the RTK wiring, and the Ponytail package, named
// in one place because the install preview and the uninstall removal must
// agree on them. `home` is passed in rather than read from the environment, and
// cli/common.ts is never imported, so a test can point this at a throwaway
// directory.
import path from 'node:path';

/** One path in the plan, with the words that say what it is. */
export interface LayerEntry {
  label: string;
  path: string;
}

export interface OmpLayer {
  extDir: string;
  configFile: string;
  pluginsDir: string;
  /** The bundled Ponytail package directory. */
  ponytailPackage: string;
  /** The rtk binary plus the OMP extension rtk's own init writes. */
  rtkBinary: string;
  rtkExtension: string;
  /** Extension directories a current install writes. */
  installed: LayerEntry[];
  /** Directories an older install left behind, removed but never installed. */
  retired: LayerEntry[];
}

// Directory names only: the files inside each are the install steps' business,
// and a preview listing every file would be a changelog, not a plan.
const INSTALLED_EXTENSIONS = [
  ['caveman-session', 'caveman session mode'],
  ['rtk-session', 'rtk session mode'],
  ['ai-addons-updater', 'add-on updater'],
  ['combo-toggle', 'combo preset switch'],
  ['tersio-commands', '/tersio command'],
  ['shared', 'session bridge, usage and pricing store'],
  // Read by the add-on updater; the updater itself is removed above.
  ['lib', 'shared installer and updater helpers'],
] as const;

const RETIRED_EXTENSIONS = [
  // Legacy always-on combo helper; imports shared/session-state.js, so it
  // breaks with a module-not-found warning once the shared dir is removed.
  ['aaa-combo-boot', 'retired combo boot helper'],
] as const;


/** Turns the `[dir, label]` tables above into resolved paths under `extDir`. */
function extensionEntries(extDir: string, table: ReadonlyArray<readonly [string, string]>): LayerEntry[] {
  return table.map(([dir, label]) => ({ label, path: path.join(extDir, dir) }));
}
/** `rtkBinaryName` is passed in because it is platform-dependent and already resolved by the caller. */
export function ompLayer(home: string, rtkBinaryName: string): OmpLayer {
  const agentDir = path.join(home, '.omp', 'agent');
  const extDir = path.join(agentDir, 'extensions');
  const pluginsDir = path.join(home, '.omp', 'plugins');
  return {
    extDir,
    configFile: path.join(agentDir, 'config.yml'),
    pluginsDir,
    ponytailPackage: path.join(pluginsDir, 'node_modules', '@dietrichgebert', 'ponytail'),
    rtkBinary: path.join(home, '.bun', 'bin', rtkBinaryName),
    rtkExtension: path.join(extDir, 'rtk.ts'),
    installed: extensionEntries(extDir, INSTALLED_EXTENSIONS),
    retired: extensionEntries(extDir, RETIRED_EXTENSIONS),
  };
}

/** Every extension directory the layer owns, installed and retired together. */
export function ompExtensionTargets(layer: OmpLayer): string[] {
  return [...layer.installed, ...layer.retired].map((entry) => entry.path);
}

/**
 * How much of the layer is on disk. OMP is a host in the agent menu like any
 * other, but its artifacts are extension directories, which no registry host
 * produces, so the count is computed here from the list above.
 */
export interface OmpLayerReport {
  /** The installed tersio plugin directory, or null when it is not installed. */
  pluginPath: string | null;
  /** Extension directories found on disk. */
  extensions: LayerEntry[];
  /** Directories listed by the layer but absent from disk. */
  missing: LayerEntry[];
  /** False when the plugin itself is absent, so the row has nothing to say. */
  installed: boolean;
}

/** The tersio plugin package directory inside the OMP plugins tree. */
export function tersioPluginDir(home: string): string {
  return path.join(home, '.omp', 'plugins', 'node_modules', '@krtclcdy', 'tersio');
}

/** Reports the layer without needing a platform rtk binary name. */
export function reportOmpLayer(home: string, exists: (p: string) => boolean): OmpLayerReport {
  const extDir = path.join(home, '.omp', 'agent', 'extensions');
  const pluginPath = tersioPluginDir(home);
  return {
    pluginPath: exists(pluginPath) ? pluginPath : null,
    extensions: extensionEntries(extDir, INSTALLED_EXTENSIONS).filter((entry) => exists(entry.path)),
    missing: extensionEntries(extDir, INSTALLED_EXTENSIONS).filter((entry) => !exists(entry.path)),
    installed: exists(pluginPath),
  };
}

