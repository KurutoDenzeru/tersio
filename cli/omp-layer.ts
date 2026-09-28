// The Oh My Pi layer as data: the extension directories, the RTK wiring and the Ponytail package, named in one place...
import path from 'node:path';
import { layerEntries, reportLayer, type LayerEntry } from './layer.ts';

export type { LayerEntry };

export interface OmpLayer {
  extDir: string;
  configFile: string;
  pluginsDir: string;
  // The bundled Ponytail package directory.
  ponytailPackage: string;
  // The rtk binary plus the OMP extension rtk's own init writes.
  rtkBinary: string;
  rtkExtension: string;
  installed: LayerEntry[];
  retired: LayerEntry[];
}

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
  // Legacy always-on combo helper; imports shared/session-state.js, so it breaks with a module-not-found warning once the...
  ['aaa-combo-boot', 'retired combo boot helper'],
] as const;

// `rtkBinaryName` is passed in because it is platform-dependent and already resolved by the caller.
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
    installed: layerEntries(extDir, INSTALLED_EXTENSIONS),
    retired: layerEntries(extDir, RETIRED_EXTENSIONS),
  };
}

// Every extension directory the layer owns, installed and retired together.
export function ompExtensionTargets(layer: OmpLayer): string[] {
  return [...layer.installed, ...layer.retired].map((entry) => entry.path);
}

// How much of the layer is on disk, counted from the list above.
export interface OmpLayerReport {
  // The installed tersio plugin directory, or null when it is not installed.
  pluginPath: string | null;
  // Extension directories found on disk.
  extensions: LayerEntry[];
  // Directories listed by the layer but absent from disk.
  missing: LayerEntry[];
  // False when the plugin itself is absent, so the row has nothing to say.
  installed: boolean;
}

export function tersioPluginDir(home: string): string {
  return path.join(home, '.omp', 'plugins', 'node_modules', '@krtclcdy', 'tersio');
}

export function reportOmpLayer(home: string, exists: (p: string) => boolean): OmpLayerReport {
  const extDir = path.join(home, '.omp', 'agent', 'extensions');
  const pluginPath = tersioPluginDir(home);
  const { present, missing } = reportLayer(extDir, [INSTALLED_EXTENSIONS], exists);
  return {
    pluginPath: exists(pluginPath) ? pluginPath : null,
    extensions: present,
    missing,
    installed: exists(pluginPath),
  };
}

