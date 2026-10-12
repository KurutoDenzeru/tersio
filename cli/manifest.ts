// Single list of install writes, shared by installer, doctor, and tests.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPackageRoot, readTextIfExists } from '../extensions/shared/utils.ts';
import { writeIfChanged } from './common.ts';

export const EXT_DIR = path.join(findPackageRoot(path.dirname(fileURLToPath(import.meta.url))), 'extensions');

/** Every file in the tree, as paths relative to the extensions directory. */
export const TREE_FILES: readonly string[] = [
  'shared/host.ts',
  'shared/session-state.ts',
  'shared/status.ts',
  'shared/types.ts',
  'shared/plugin-settings.ts',
  'shared/usage-ledger.ts',
  'shared/pricing.ts',
  'shared/carbon.ts',
  'shared/utils.ts',
  'caveman/index.ts',
  'caveman/rule.md',
  'caveman/rule-ultra.md',
  'caveman/rule-megacave.md',
  'rtk/session.ts',
  'rtk/filter.ts',
  'combo/index.ts',
  'commands/index.ts',
  'updater/index.ts',
  'server.ts',
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

/** The entries at the extensions root, which `filesUnder` cannot name because it takes a directory. */
export function rootFiles(): Array<[string, string]> {
  return TREE_FILES.filter((file) => !file.includes('/')).map((file) => [sourcePath(file), file]);
}

/** The OpenCode plugin entry. It imports `@opencode/plugin`, which the omp and pi loaders lack, so it ships in the OpenCode tree alone. */
export const OPENCODE_ENTRY = 'server.ts';

/** The files one host's extension tree holds. The package tree holds all of them. */
export function treeFilesFor(id: 'omp' | 'pi' | 'opencode'): readonly string[] {
  return id === 'opencode' ? TREE_FILES : TREE_FILES.filter((file) => file !== OPENCODE_ENTRY);
}

/**
 * Copy every bundled file into `dest`, creating the directories it needs. A file the bundle does not
 * carry is reported and skipped rather than aborting, so one missing source cannot stop the rest.
 *
 * `skip` answers "leave this file alone", which is how the rule bodies survive a repair: an upstream
 * fetch can be newer than the bundled copy, and a re-fetch never overwrites it.
 */
export async function syncTreeFiles(
  dest: string,
  files: readonly string[],
  options: { dryRun?: boolean; verbose?: boolean },
  skip?: (file: string) => boolean,
): Promise<string[]> {
  const missing: string[] = [];
  for (const file of files) {
    if (skip?.(file)) continue;
    const from = sourcePath(file);
    const text = await readTextIfExists(from);
    if (text === null) {
      missing.push(from);
      continue;
    }
    await writeIfChanged(path.join(dest, ...file.split('/')), text, options);
  }
  return missing;
}
