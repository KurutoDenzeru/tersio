// cli/pi-layer.ts — the Pi extension layer as data: the five extension
// directories plus shared/ and lib/. The install preview and the uninstall
// removal both read this list, so a preview cannot promise a different set than
// the run deletes. `home` is passed in and cli/common.ts is never imported, so
// a test can point this at a throwaway directory.
import path from 'node:path';
import { layerDirs, layerEntries, reportLayer, type LayerEntry } from './layer.ts';

export type { LayerEntry };

export interface PiLayer {
  extDir: string;
  /** The rtk module `rtk init -g --agent pi` writes. Not ours to ship. */
  rtkExtension: string;
  installed: LayerEntry[];
  /** Module directories the extension directories import from. */
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

export const PI_EXTENSION_DIRS = layerDirs(INSTALLED_EXTENSIONS);
export const PI_MODULE_DIRS = layerDirs(MODULE_DIRECTORIES);

export function piLayer(home: string): PiLayer {
  const relocated = process.env.PI_CODING_AGENT_DIR;
  const base = relocated && relocated.trim() !== '' ? relocated : path.join(home, '.pi', 'agent');
  const extDir = path.join(base, 'extensions');
  return {
    extDir,
    rtkExtension: path.join(extDir, 'rtk.ts'),
    installed: layerEntries(extDir, INSTALLED_EXTENSIONS),
    modules: layerEntries(extDir, MODULE_DIRECTORIES),
  };
}

/** Every directory the layer owns. Removal walks this list and nothing else. */
export function piExtensionTargets(layer: PiLayer): string[] {
  return [...layer.installed, ...layer.modules].map((entry) => entry.path);
}

export interface PiLayerReport {
  extensions: LayerEntry[];
  missing: LayerEntry[];
  /** False when nothing of the layer is present, so a row has nothing to say. */
  installed: boolean;
}

/** Reports the layer without needing a platform rtk binary name. */
export function reportPiLayer(home: string, exists: (p: string) => boolean): PiLayerReport {
  const { present, missing } = reportLayer(piLayer(home).extDir, [INSTALLED_EXTENSIONS, MODULE_DIRECTORIES], exists);
  return { extensions: present, missing, installed: present.length > 0 };
}
