// cli/layer.ts — the shared shape of an extension tree.
import path from 'node:path';

// One path in the plan, with the words that say what it is.
export interface LayerEntry {
  label: string;
  path: string;
}

// A `[dir, label]` table, as the host modules declare them.
export type LayerTable = ReadonlyArray<readonly [string, string]>;

// Turns a `[dir, label]` table into resolved paths under `extDir`.
export function layerEntries(extDir: string, table: LayerTable): LayerEntry[] {
  return table.map(([dir, label]) => ({ label, path: path.join(extDir, dir) }));
}

// Directory names only, for callers that key off the names alone.
export function layerDirs(table: LayerTable): string[] {
  return table.map(([dir]) => dir);
}

export interface LayerReport {
  // Entries found on disk.
  present: LayerEntry[];
  // Entries the host lists but that are absent.
  missing: LayerEntry[];
}

// What of the layer is on disk.
export function reportLayer(extDir: string, tables: LayerTable[], exists: (p: string) => boolean): LayerReport {
  const all = tables.flatMap((table) => layerEntries(extDir, table));
  return {
    present: all.filter((entry) => exists(entry.path)),
    missing: all.filter((entry) => !exists(entry.path)),
  };
}
