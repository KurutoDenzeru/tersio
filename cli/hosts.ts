// cli/hosts.ts — the agent hosts Tersio installs into, and what is on disk.
// One detector, shared by the doctor rows, the install menu, and the uninstall
// menu, so the three can never disagree about what is installed.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { HOME, OMP_PLUGINS_DIR, PACKAGE_NAME, PACKAGE_VERSION } from './common.ts';
import { TREE_FILES } from './manifest.ts';
import { piAgentDir } from '../extensions/lib/utils.ts';

export { TREE_FILES };

export type HostId = 'omp' | 'pi';

export interface HostEntry {
  id: HostId;
  label: string;
  bin: string;
  installCmd: string;
  removeCmd: string;
  installed: boolean;
  /** How it is installed: a written tree, or the npm package. */
  via: 'tree' | 'package' | null;
  /** The pi source pi has declared, when the host keeps one. */
  declared: string | null;
  version: string | null;
  /** The extension tree, or the package dir, depending on `via`. */
  dir: string | null;
}



export function hostExtensionsDir(id: HostId, agentDir = piAgentDir()): string {
  return id === 'omp'
    ? path.join(HOME, '.omp', 'agent', 'extensions')
    : path.join(agentDir, 'extensions');
}

export function missingTreeFiles(id: HostId, agentDir = piAgentDir()): string[] {
  const dir = hostExtensionsDir(id, agentDir);
  return TREE_FILES.filter((file) => !existsSync(path.join(dir, file)));
}

export function ompPackageDir(): string {
  return path.join(OMP_PLUGINS_DIR, 'node_modules', ...PACKAGE_NAME.split('/'));
}

export function piPackageDir(agentDir = piAgentDir()): string {
  return path.join(agentDir, 'npm', 'node_modules', ...PACKAGE_NAME.split('/'));
}

export function piSettingsFile(agentDir = piAgentDir()): string {
  return path.join(agentDir, 'settings.json');
}

function packageVersion(dir: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

// The tersio package pi has declared in its own settings.json, or null. pi
// writes the declaration on install and identifies a source by name, so an npm
// spec, a git URL, and a local path all count when they name this package.
export function piTersioSource(agentDir = piAgentDir()): string | null {
  let settings: { packages?: unknown };
  try {
    const parsed: unknown = JSON.parse(readFileSync(piSettingsFile(agentDir), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    settings = parsed as { packages?: unknown };
  } catch {
    return null;
  }
  if (!Array.isArray(settings.packages)) return null;
  for (const entry of settings.packages) {
    const source = typeof entry === 'string' ? entry : (entry as { source?: unknown } | null)?.source;
    if (typeof source !== 'string') continue;
    const trimmed = source.trim().replace(/[/\\]+$/, '');
    if (trimmed.includes(PACKAGE_NAME) || /(^|[/\\])tersio(\.git)?$/i.test(trimmed)) return source.trim();
  }
  return null;
}

function detect(agentDir = piAgentDir()): HostEntry[] {
  const ompPkg = ompPackageDir();
  const piPkg = piPackageDir(agentDir);
  const entry = (
    id: HostId,
    label: string,
    bin: string,
    installCmd: string,
    removeCmd: string,
    pkgDir: string,
    declared: string | null,
    agentDirFor: string,
  ): HostEntry => {
    const asPackage = existsSync(pkgDir);
    const tree = hostExtensionsDir(id, agentDirFor);
    const missing = missingTreeFiles(id, agentDirFor);
    const asTree = missing.length === 0;
    const installed = asPackage || asTree;
    return {
      id,
      label,
      bin,
      installCmd,
      removeCmd,
      installed,
      via: installed ? (asTree ? 'tree' : 'package') : null,
      declared,
      // A written tree carries no package.json: it came from this CLI, so its
      // version is ours.
      version: installed ? (asTree ? PACKAGE_VERSION : packageVersion(pkgDir)) : null,
      dir: installed ? (asTree ? tree : pkgDir) : null,
    };
  };
  return [
    entry('omp', 'Oh My Pi', 'omp', `omp plugin install ${PACKAGE_NAME}`, `omp plugin remove ${PACKAGE_NAME}`,
      ompPkg, existsSync(ompPkg) ? `plugin ${PACKAGE_NAME}` : null, agentDir),
    entry('pi', 'Pi', 'pi', `pi install npm:${PACKAGE_NAME}`, `pi remove npm:${PACKAGE_NAME}`,
      piPkg, piTersioSource(agentDir), agentDir),
  ];
}

/**
 * The menu label, with the current state in brackets: the version when the
 * package is already there, so a rerun shows what it would replace.
 */
export function hostLabel(host: HostEntry): string {
  if (host.installed && host.version) return `${host.label} (installed ${host.version})`;
  if (host.installed) return `${host.label} (installed)`;
  if (host.declared) return `${host.label} (package declared, not on disk)`;
  return `${host.label} (not installed)`;
}

export function hostHint(host: HostEntry): string {
  if (host.installed && host.dir) return host.dir;
  return host.installCmd;
}

// `--host omp|pi` from raw argv; undefined when absent. Throws on an unknown
// value so the caller can exit(1) with the message.
export function parseHostArg(argv: string[]): HostId | undefined {
  const i = argv.indexOf('--host');
  const raw = (i === -1 ? undefined : argv[i + 1]) ?? argv.find((a) => a.startsWith('--host='))?.slice('--host='.length);
  if (raw === undefined) return undefined;
  const value = raw.trim().toLowerCase();
  if (value !== 'omp' && value !== 'pi') throw new Error(`Invalid --host: ${raw}. Valid: omp, pi`);
  return value;
}

export { HOME, detect as detectHosts };
