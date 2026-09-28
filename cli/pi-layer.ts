// The Pi extension layer as data: the five extension directories plus shared/
// and lib/. The install preview and the uninstall removal both read this list,
// so a preview cannot promise a different set than the run deletes. `home` is
// passed in and cli/common.ts is never imported, so a test can point this at a
// throwaway directory.
import path from 'node:path';

/** One path in the plan, with the words that say what it is. */
export interface LayerEntry {
  label: string;
  path: string;
}

export interface PiLayer {
  extDir: string;
  rtkExtension: string;
  installed: LayerEntry[];
  modules: LayerEntry[];
}

const INSTALLED_EXTENSIONS = [
  ['caveman-session', 'caveman session mode'],
  ['rtk-session', 'rtk session mode'],
  ['ai-addons-updater', 'add-on updater'],
  ['combo-toggle', 'combo preset switch'],
  ['tersio-commands', '/tersio command'],
] as const;

// Imported by the extension directories but never loaded by Pi itself, so they
// stay out of the install list and only removal takes them.
const MODULE_DIRECTORIES = [
  ['shared', 'Pi types, session bridge, usage and pricing store'],
  ['lib', 'shared installer and updater helpers'],
] as const;

/** Extension directory names, for callers that key off the names alone. */
export const PI_EXTENSION_DIRS = INSTALLED_EXTENSIONS.map(([dir]) => dir);

/** Module directory names, for callers that key off the names alone. */
export const PI_MODULE_DIRS = MODULE_DIRECTORIES.map(([dir]) => dir);

function extensionEntries(extDir: string, table: ReadonlyArray<readonly [string, string]>): LayerEntry[] {
  return table.map(([dir, label]) => ({ label, path: path.join(extDir, dir) }));
}

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
