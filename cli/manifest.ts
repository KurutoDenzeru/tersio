// Single list of install writes, shared by installer, doctor, and tests.
import path from 'node:path';
import fs from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { findPackageRoot, readTextIfExists } from '../extensions/shared/utils.ts';
import { writeIfChanged } from './common.ts';
import type { WriteOptions } from './common.ts';

export const EXT_DIR = path.join(findPackageRoot(path.dirname(fileURLToPath(import.meta.url))), 'extensions');

/** Every pstack leaf, playbook, and skill the index routes to. */
function pstackTreeFiles(): string[] {
  const root = path.join(EXT_DIR, "pstack");
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = path.join(dir, entry.name);
      const relChild = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(child, relChild);
      else if (entry.name.endsWith(".md")) out.push(`pstack/${relChild}`);
    }
  };
  walk(root, "");
  return out.toSorted();
}
export const TREE_PSTACK_FILES: readonly string[] = pstackTreeFiles();

/** Every file in the tree, as paths relative to the extensions directory. */
export const TREE_FILES: readonly string[] = [
  'shared/host.ts',
  'shared/session-state.ts',
  'shared/status.ts',
  'shared/types.ts',
  'shared/plugin-settings.ts',
  'shared/usage-ledger.ts',
  'shared/state.ts',
  'shared/sqlite.ts',
  'shared/pricing.ts',
  'shared/carbon.ts',
  'shared/utils.ts',
  'shared/rtk-eligible.ts',
  'shared/updater.ts',
  'shared/headroom-proxy.ts',
  'shared/mode-notice.ts',
  'shared/cache-store.ts',
  'caveman/index.ts',
  'caveman/caveman.ts',
  'caveman/rule.md',
  'caveman/rule-lite.md',
  'caveman/rule-megacave-lite.md',
  'caveman/rule-megacave-ultra.md',
  'caveman/rule-ultra.md',
  'caveman/rule-megacave.md',
  'pstack/index.ts',
  'pstack/pstack.ts',
  'pstack/rule.md',
  ...TREE_PSTACK_FILES,
  'headroom/index.ts',
  'headroom/headroom.ts',
  'rtk/session.ts',
  'rtk/filter.ts',
  'timing/index.ts',
  'timing/timing.ts',
  'combo/index.ts',
  'combo/combo.ts',
  'commands/index.ts',
  'commands/commands.ts',
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

/** The OpenCode plugin entry: imports `@opencode/plugin`, absent from omp and pi loaders, so it ships there alone. */
export const OPENCODE_ENTRY = 'server.ts';

/** pi's rtk entry manifest, generated rather than copied: no other host loads rtk that way. */
export const PI_RTK_MANIFEST = 'rtk/package.json';

/** pi's rtk entry manifest, generated rather than copied: no other host loads rtk that way. */
export const PI_RTK_MANIFEST_BODY = `${JSON.stringify({ pi: { extensions: ['./session.ts', './filter.ts'] } }, null, 2)}\n`;

/** Files the install generates, keyed by tree path, so one repair path handles copied and generated alike. */
export const GENERATED_TREE_FILES: Readonly<Record<string, string>> = {
  [PI_RTK_MANIFEST]: PI_RTK_MANIFEST_BODY,
};

/** The files the DeepSeek Harness bundle mounts, relative to the package's extensions dir: the plugin module and the patch layer it carries. */
export const DSH_BUNDLE_FILES: readonly string[] = ['dsh/index.ts', 'dsh/cordis.patch.yml'];

/** The files one host's extension tree holds. The package tree holds all of them. DeepSeek Harness mounts the tersio package as a bundle, so its tree is the plugin's own two files. */
export function treeFilesFor(id: 'omp' | 'pi' | 'opencode' | 'pig' | 'dsh'): readonly string[] {
  if (id === 'dsh') return DSH_BUNDLE_FILES;
  if (id === 'opencode') return TREE_FILES;
  const files = TREE_FILES.filter((file) => file !== OPENCODE_ENTRY);
  return id === 'pi' || id === 'pig' ? [...files, PI_RTK_MANIFEST] : files;
}

/** Obsolete install debris; explicit, not a sweep, because these trees are shared with tersio's other steps. */
const OBSOLETE_DIRS = ['updater', 'caveman-session', 'rtk-filter', 'rtk-session', 'combo-toggle', 'tersio-commands', 'ai-addons-updater', 'lib', 'opencode'] as const;

/** Retired Ponytail `.js` modules; the fork ships `.ts` and every loader reads those. */
const OBSOLETE_FILES = ['ponytail-bundle/hooks/ponytail-config.js', 'ponytail-bundle/hooks/ponytail-instructions.js'] as const;

/** Debris test for a tree-relative path; one definition shared by detection and repair. */
export function isObsoleteTreeFile(rel: string, id: 'omp' | 'pi' | 'opencode' | 'pig' | 'dsh'): boolean {
  if (rel.endsWith('.bak') || rel === '.DS_Store') return true;
  if (OBSOLETE_DIRS.includes(rel.split('/')[0] as (typeof OBSOLETE_DIRS)[number])) return true;
  if ((OBSOLETE_FILES as readonly string[]).includes(rel)) return true;
  return rel === 'server.ts' && id !== 'opencode';
}

/** Drops the debris directories a written tree must never keep, and reports their names. */
export async function reapObsoleteTreeDirs(dest: string, options: { dryRun?: boolean; verbose?: boolean }): Promise<string[]> {
  let entries;
  try { entries = await fs.readdir(dest, { withFileTypes: true }); } catch { return []; }
  const gone: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!OBSOLETE_DIRS.includes(entry.name as (typeof OBSOLETE_DIRS)[number])) continue;
    if (!options.dryRun) await fs.rm(path.join(dest, entry.name), { recursive: true, force: true });
    gone.push(entry.name);
  }
  if (gone.length > 0 && options.verbose) console.log(`  Retired debris — remove ${gone.join(', ')}`);
  return gone;
}

/** A tree file's text: copied files come from the repo, generated ones from their own definition. */
export function treeFileText(file: string): string | null {
  const generated = GENERATED_TREE_FILES[file];
  if (generated !== undefined) return generated;
  try { return readFileSync(sourcePath(file), 'utf8'); } catch { return null; }
}

/** The vendored Ponytail copy. Tersio ships it, so a host lists one plugin instead of two. */
export const PONYTAIL_DIR = path.join(EXT_DIR, 'ponytail');

/** The vendored copy's package name; the migration drops this entry from an older install. */
export const PONYTAIL_PKG = '@dietrichgebert/ponytail';

/** The vendored copy's own manifest holds the version, so the scorecard and the copy never drift. */
export const PONYTAIL_VERSION: string = ((): string => {
  try {
    return (JSON.parse(readFileSync(path.join(PONYTAIL_DIR, 'package.json'), 'utf8')) as { version?: string }).version ?? '';
  } catch {
    return '';
  }
})();

/** The ponytail ruleset this build ships, copied to every host that cannot install the package. */
export const PONYTAIL_SKILL_NAMES = ['ponytail', 'ponytail-audit', 'ponytail-debt', 'ponytail-gain', 'ponytail-help', 'ponytail-review'] as const;

/** The OpenCode bundle: no node_modules there, so the ruleset rides along as files. */
export const PONYTAIL_BUNDLE_FILES = [
  'hooks/ponytail-instructions.ts',
  'hooks/ponytail-config.ts',
  ...PONYTAIL_SKILL_NAMES.map((skill) => `skills/${skill}/SKILL.md`),
] as const;

/** pi's local package: the same ruleset, plus the extension that injects it. */
export const PI_PONYTAIL_FILES = ['pi-extension/index.ts', ...PONYTAIL_BUNDLE_FILES] as const;

/** The shipped package manifest, one level above the extension tree. */
const MANIFEST_PATH = path.join(path.dirname(EXT_DIR), 'package.json');

/** The `omp` block a host reads for what to load: extensions, features, and the settings schema. */
export function shippedOmpManifest(): Record<string, unknown> | null {
  try {
    const pkg = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as { omp?: unknown };
    return typeof pkg.omp === 'object' && pkg.omp !== null ? pkg.omp as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

// Write the shipped `omp` block over an installed plugin's manifest: an entry added here reaches the host only when its manifest names it.
export async function syncPluginManifest(pluginDir: string, options: WriteOptions = {}): Promise<void> {
  const omp = shippedOmpManifest();
  if (omp === null) return;
  const pkgPath = path.join(pluginDir, 'package.json');
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return;
  }
  if (JSON.stringify(pkg.omp) === JSON.stringify(omp)) return;
  pkg.omp = omp;
  await writeIfChanged(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, options);
}

/** Copy bundled files into `dest`; misses are reported and skipped, `skip` keeps newer fetched rule bodies. */
export async function syncTreeFiles(
  dest: string,
  files: readonly string[],
  options: { dryRun?: boolean; verbose?: boolean },
  skip?: (file: string) => boolean,
): Promise<string[]> {
  const missing: string[] = [];
  for (const file of files) {
    if (skip?.(file)) continue;
    const generated = GENERATED_TREE_FILES[file];
    if (generated !== undefined) {
      await writeIfChanged(path.join(dest, ...file.split('/')), generated, options);
      continue;
    }
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
