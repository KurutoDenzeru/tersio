// Single list of install writes, shared by installer, doctor, and tests.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'extensions');

/** Every file in the tree, as paths relative to the extensions directory. */
export const TREE_FILES: readonly string[] = [
  'shared/host.ts',
  'shared/session-state.ts',
  'shared/types.ts',
  'shared/plugin-settings.ts',
  'shared/usage-ledger.ts',
  'shared/pricing.ts',
  'shared/carbon.ts',
  'lib/utils.ts',
  'caveman-session/index.ts',
  'caveman-session/rule.md',
  'rtk-session/index.ts',
  'combo-toggle/index.ts',
  'tersio-commands/index.ts',
  'ai-addons-updater/index.ts',
];

export function sourcePath(relative: string): string {
  return path.join(EXT_DIR, ...relative.split('/'));
}

/** The entries under one directory, as source paths and tree-relative targets. */
export function filesUnder(dir: string): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  for (const file of TREE_FILES) {
    if (file.startsWith(`${dir}/`)) found.push([sourcePath(file), file]);
  }
  return found;
}
