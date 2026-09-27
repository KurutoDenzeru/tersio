// cli/pi-layer.ts — the Pi extension layer as data.
//
// The mirror of omp-layer.ts: the same five extension directories plus
// shared/ and lib/. Install previews and uninstall removal both read this list,
// so a preview cannot promise a different set than the run deletes. The generic
// emitters in agents.ts do not see this tree, so it is owned here. `home` is
// passed in rather than read from the environment, and cli/common.ts is never
// imported, so a test can point this at a throwaway directory.
import path from 'node:path';

/** One path in the plan, with the words that say what it is. */
export interface LayerEntry {
  label: string;
  path: string;
}

export interface PiLayer {
  extDir: string;
  /** The rtk module `rtk init -g --agent pi` writes. Not ours to ship. */
  rtkExtension: string;
  /** The five extension entry points, in plan order. */
  installed: LayerEntry[];
  /** Module directories the extension entry points import from. */
  modules: LayerEntry[];
}

// Directory names only: the files inside each are the install steps' business,
// and a preview listing every file would be a changelog, not a plan.
const INSTALLED_EXTENSIONS = [
  ['caveman-session', 'caveman session mode'],
  ['rtk-session', 'rtk session mode'],
  ['ai-addons-updater', 'add-on updater'],
  ['combo-toggle', 'combo preset switch'],
  ['tersio-commands', '/tersio command'],
] as const;

/**
 * Module directories, imported by the extension directories but never loaded by
 * Pi itself: an `index.ts` registered as an extension registers nothing and
 * only makes the failure harder to read. Kept in the plan so removal takes
 * them too.
 */
const MODULE_DIRECTORIES = [
  ['shared', 'Pi types, session bridge, usage and pricing store'],
  ['lib', 'shared installer and updater helpers'],
] as const;

/** Extension directory names, for callers that key off the names alone. */
export const PI_EXTENSION_DIRS = INSTALLED_EXTENSIONS.map(([dir]) => dir);

/** Module directory names, for callers that key off the names alone. */
export const PI_MODULE_DIRS = MODULE_DIRECTORIES.map(([dir]) => dir);

/** Turns the `[dir, label]` tables above into resolved paths under `extDir`. */
function extensionEntries(extDir: string, table: ReadonlyArray<readonly [string, string]>): LayerEntry[] {
  return table.map(([dir, label]) => ({ label, path: path.join(extDir, dir) }));
}

/** Honors PI_CODING_AGENT_DIR, which is how Pi itself relocates the agent dir. */
export function piLayer(home: string): PiLayer {
  const relocated = process.env.PI_CODING_AGENT_DIR;
  const base = relocated && relocated.trim() !== '' ? relocated : path.join(home, '.pi', 'agent');
  const extDir = path.join(base, 'extensions');
  return {
    extDir,
    rtkExtension: path.join(extDir, 'rtk.ts'),
    installed: extensionEntries(extDir, INSTALLED_EXTENSIONS),
    modules: extensionEntries(extDir, MODULE_DIRECTORIES),
  };
}

/** Every directory the layer owns. Removal walks this list and nothing else. */
export function piExtensionTargets(layer: PiLayer): string[] {
  return [...layer.installed, ...layer.modules].map((entry) => entry.path);
}

export interface PiLayerReport {
  /** Extension directories found on disk. */
  extensions: LayerEntry[];
  /** Directories listed by the layer but absent from disk. */
  missing: LayerEntry[];
  /** False when nothing of the layer is present, so a row has nothing to say. */
  installed: boolean;
}

/** Reports the layer without needing a platform rtk binary name. */
export function reportPiLayer(home: string, exists: (p: string) => boolean): PiLayerReport {
  const all = [...extensionEntries(piLayer(home).extDir, INSTALLED_EXTENSIONS), ...extensionEntries(piLayer(home).extDir, MODULE_DIRECTORIES)];
  const extensions = all.filter((entry) => exists(entry.path));
  return {
    extensions,
    missing: all.filter((entry) => !exists(entry.path)),
    installed: extensions.length > 0,
  };
}
