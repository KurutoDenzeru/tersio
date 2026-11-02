// One host-tree comparison shared by the CLI doctor and the dashboard diagnosis.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { DetectedHost } from './hosts.ts';
import { hostExtensionsDir } from './hosts.ts';
import { GENERATED_TREE_FILES, isObsoleteTreeFile, treeFileText, treeFilesFor } from './manifest.ts';

export interface HostTreeIssues {
  stale: string[];
  missing: string[];
  orphan: string[];
  unwritten: string[];
}

/** Add-on files under a host's tree, repo-relative, empty when absent: `node_modules` is skipped as a hoisted dep. */
function hostTreeFiles(base: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.DS_Store') continue;
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), child);
      else out.push(child);
    }
  };
  walk(base, '');
  return out;
}

function textAt(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** Compare every installed host with this build's declared tree. */
export function checkHostTrees(hosts: DetectedHost[], pluginExtDir: string): HostTreeIssues {
  const stale: string[] = [];
  const missing: string[] = [];
  const orphan: string[] = [];
  const unwritten: string[] = [];
  for (const host of hosts.filter((entry) => entry.installed)) {
    const treeId = host.id === 'omp' ? 'opencode' : host.id;
    const base = host.id === 'omp' ? pluginExtDir : hostExtensionsDir(host.id);
    let onDisk = new Set(hostTreeFiles(base).filter((rel) => path.extname(rel) !== '.js'));
    // The dsh bundle mounts the whole package: only its own subpath is Tersio's to judge.
    if (treeId === 'dsh') onDisk = new Set([...onDisk].filter((rel) => rel.startsWith('dsh/')));
    const expected = new Set(treeFilesFor(treeId));
    const every = new Set([...onDisk, ...expected]);
    for (const rel of every) {
      if (isObsoleteTreeFile(rel, treeId)) {
        orphan.push(`${host.id}/${rel}`);
        continue;
      }
      if (!expected.has(rel)) continue;
      if (!onDisk.has(rel)) {
        missing.push(`${host.id}/${rel}`);
        continue;
      }
      const reference = treeFileText(rel);
      if (reference === null) continue;
      const theirs = textAt(path.join(base, ...rel.split('/')));
      if (theirs === null) missing.push(`${host.id}/${rel}`);
      else if (theirs !== reference) stale.push(`${host.id}/${rel}`);
    }
    // A file absent from disk and from the declaration cannot show in the pair loop.
    for (const rel of expected) {
      if (existsSync(path.join(base, ...rel.split('/')))) continue;
      if (host.id === 'omp' && GENERATED_TREE_FILES[rel] !== undefined) continue;
      unwritten.push(`${host.id}/${rel}`);
    }
  }
  return { stale, missing, orphan, unwritten };
}
