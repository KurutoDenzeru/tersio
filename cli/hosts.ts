// cli/hosts.ts — the agent hosts Tersio installs into, and what is on disk. One detector, shared by the doctor and both menus, so they cannot disagree.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { HOME, OMP_PLUGINS_DIR, PACKAGE_NAME, PACKAGE_VERSION } from './common.ts';
import { TREE_FILES } from './manifest.ts';
import { piAgentDir } from '../extensions/lib/utils.ts';

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

function piPackageDir(agentDir = piAgentDir()): string {
  return path.join(agentDir, 'npm', 'node_modules', ...PACKAGE_NAME.split('/'));
}

function piSettingsFile(agentDir = piAgentDir()): string {
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

// The tersio package pi declared in its own settings.json, or null. pi identifies a source by name, so an npm spec, git URL, or path all count.
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

// The hosts we install into, and the commands that add and remove each.
const HOSTS: Array<Omit<HostEntry, 'installed' | 'via' | 'declared' | 'version' | 'dir'>> = [
  { id: 'omp', label: 'Oh My Pi', bin: 'omp', installCmd: `omp plugin install ${PACKAGE_NAME}`, removeCmd: `omp plugin remove ${PACKAGE_NAME}` },
  { id: 'pi', label: 'Pi', bin: 'pi', installCmd: `pi install npm:${PACKAGE_NAME}`, removeCmd: `pi remove npm:${PACKAGE_NAME}` },
];

function detect(agentDir = piAgentDir()): HostEntry[] {
  return HOSTS.map((host) => {
    const pkgDir = host.id === 'omp' ? ompPackageDir() : piPackageDir(agentDir);
    const tree = hostExtensionsDir(host.id, agentDir);
    // A tree wins: it is what the installer writes, and it carries no package.json, so its version is ours.
    const via = missingTreeFiles(host.id, agentDir).length === 0
      ? 'tree'
      : existsSync(pkgDir) ? 'package' : null;
    return {
      ...host,
      installed: via !== null,
      via,
      declared: host.id === 'omp'
        ? (existsSync(pkgDir) ? `plugin ${PACKAGE_NAME}` : null)
        : piTersioSource(agentDir),
      version: via === 'tree' ? PACKAGE_VERSION : via === 'package' ? packageVersion(pkgDir) : null,
      dir: via === 'tree' ? tree : via === 'package' ? pkgDir : null,
    };
  });
}

/** Menu label with current state in brackets, so a rerun shows what it replaces. */
export function hostLabel(host: HostEntry): string {
  if (host.installed && host.version) return `${host.label} (installed ${host.version})`;
  if (host.installed) return `${host.label} (installed)`;
  if (host.declared) return `${host.label} (package declared, not on disk)`;
  return `${host.label} (not installed)`;
}

// Hints render inline, so menus name the install and doctor keeps the path.
export function hostHint(host: HostEntry): string {
  if (host.installed && host.via) return host.via === 'tree' ? 'extension tree' : 'plugin package';
  return host.installCmd;
}

// `--host omp|pi` from raw argv; undefined when absent. Throws on an unknown value so the caller can exit(1) with the message.
export function parseHostArg(argv: string[]): HostId | undefined {
  const i = argv.indexOf('--host');
  const raw = (i === -1 ? undefined : argv[i + 1]) ?? argv.find((a) => a.startsWith('--host='))?.slice('--host='.length);
  if (raw === undefined) return undefined;
  const value = raw.trim().toLowerCase();
  if (value !== 'omp' && value !== 'pi') throw new Error(`Invalid --host: ${raw}. Valid: omp, pi`);
  return value;
}

export { HOME, detect as detectHosts };
