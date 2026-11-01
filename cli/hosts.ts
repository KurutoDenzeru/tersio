// cli/hosts.ts — agent hosts Tersio installs into, and what is on disk. One detector shared by doctor and menus.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { HOME, OMP_PLUGINS_DIR, PACKAGE_NAME, PACKAGE_VERSION } from './common.ts';
import { treeFilesFor } from './manifest.ts';
import { piAgentDir, pigAgentDir, resolveHostBinary } from '../extensions/shared/utils.ts';

export type HostId = 'omp' | 'pi' | 'opencode' | 'pig' | 'dsh';

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

/** One detected host, as `detectHosts` returns it. */
export type DetectedHost = HostEntry;



export function hostExtensionsDir(id: HostId, agentDir = id === 'pig' ? pigAgentDir() : piAgentDir()): string {
  if (id === 'omp') return path.join(HOME, '.omp', 'agent', 'extensions');
  if (id === 'opencode') return path.join(HOME, '.config', 'opencode', 'plugins', 'tersio');
  // DeepSeek Harness mounts the whole tersio package as a bundle, so its tree base is the mounted package's extensions dir.
  if (id === 'dsh') return path.join(dshPackageDir(), 'extensions');
  return path.join(agentDir, 'extensions');
}

function missingTreeFiles(id: HostId, agentDir = id === 'pig' ? pigAgentDir() : piAgentDir()): string[] {
  const dir = hostExtensionsDir(id, agentDir);
  return treeFilesFor(id).filter((file) => !existsSync(path.join(dir, file)));
}

export function ompPackageDir(): string {
  return path.join(OMP_PLUGINS_DIR, 'node_modules', ...PACKAGE_NAME.split('/'));
}

function piPackageDir(agentDir = piAgentDir()): string {
  return path.join(agentDir, 'npm', 'node_modules', ...PACKAGE_NAME.split('/'));
}

export function pigPackageDir(agentDir = pigAgentDir()): string {
  return path.join(agentDir, 'npm', 'node_modules', ...PACKAGE_NAME.split('/'));
}

function piSettingsFile(agentDir = piAgentDir()): string {
  return path.join(agentDir, 'settings.json');
}

/** DeepSeek Harness home: `$DSH_HOME`, else `~/.dsh` — the marker DeepSeek's own tooling writes. */
export function dshHome(): string {
  const override = process.env.DSH_HOME;
  return override && override.trim() !== '' ? override : path.join(HOME, '.dsh');
}

/** The web profile's tersio package dir, when the dsh bundle is mounted. */
export function dshPackageDir(): string {
  return path.join(dshHome(), 'profiles', 'web', 'node_modules', ...PACKAGE_NAME.split('/'));
}

/** The desktop app's bundled CLI, present on macOS installs. Windows stays on the npx fallback until its layout is verified. */
const DSH_APP_CLI = '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh';

/** The profile the Electron desktop app owns; `dsh plugin` refuses to write it, so installs go through its Plugins pane. */
const DSH_APP_PROFILE = 'desktop';

/** The runner for the dsh CLI: PATH, then the desktop app's bundled CLI, else the zero-install npx form. */
export function dshRunner(): string[] {
  if (resolveHostBinary('dsh') !== null) return ['dsh'];
  if (process.platform === 'darwin' && existsSync(DSH_APP_CLI)) return [DSH_APP_CLI];
  return ['npx', '-y', '@deepseek-ai/dsh'];
}

/** Whether DeepSeek Harness exists on this machine in any of its install forms. */
export function dshPresent(): boolean {
  if (resolveHostBinary('dsh') !== null) return true;
  if (process.platform === 'darwin' && existsSync(DSH_APP_CLI)) return true;
  if (existsSync(dshHome())) return true;
  if (process.platform === 'darwin') {
    return existsSync(path.join(HOME, 'Library', 'Application Support', '@deepseek-ai', 'dsh-desktop'));
  }
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
    return existsSync(path.join(local, 'Programs', 'dsh-desktop'));
  }
  return false;
}

/** The web profile's mounted bundle list, from its own package manifest. */
export function dshProfileBundles(profile: string): string[] {
  try {
    const parsed = JSON.parse(readFileSync(path.join(dshHome(), 'profiles', profile, 'package.json'), 'utf8')) as { dsh?: { profile?: { bundles?: string[] } } };
    return parsed.dsh?.profile?.bundles ?? [];
  } catch {
    return [];
  }
}

/** Every profile under the dsh home: the web and desktop profiles, plus any the user added. */
export function dshProfiles(): string[] {
  const dir = path.join(dshHome(), 'profiles');
  try {
    return readdirSync(dir).filter((name) => existsSync(path.join(dir, name, 'package.json')));
  } catch {
    return [];
  }
}

/** The profiles the CLI may mount into. The `desktop` profile belongs to the Electron app and refuses CLI writes. */
export function dshCliProfiles(): string[] {
  return dshProfiles().filter((profile) => profile !== DSH_APP_PROFILE);
}

/** The `desktop` profile exists only on machines with the desktop app, where installs go through its Plugins pane. */
export function dshDesktopProfilePresent(): boolean {
  return dshProfiles().includes(DSH_APP_PROFILE);
}

export function pigSettingsFile(agentDir = pigAgentDir()): string {
  return path.join(agentDir, 'settings.json');
}

// pi installs Ponytail as a local path package, so settings.json names the loaded directory; the npm spec is older.
export function piPonytailPackageDir(agentDir = piAgentDir()): string {
  let packages: unknown[] = [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(piSettingsFile(agentDir), 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray((parsed as { packages?: unknown }).packages)) {
      packages = (parsed as { packages: unknown[] }).packages;
    }
  } catch { /* no settings file, or unreadable */ }
  for (const entry of packages) {
    const source = typeof entry === 'string' ? entry : (entry as { source?: unknown } | null)?.source;
    if (typeof source !== 'string') continue;
    const trimmed = source.trim().replace(/[/\\]+$/, '');
    if (path.isAbsolute(trimmed) && path.basename(trimmed) === 'ponytail') return trimmed;
  }
  return path.join(agentDir, 'npm', 'node_modules', '@dietrichgebert', 'ponytail');
}

/** pi and PiG read the same settings shape, so the one lookup serves both. */
export function pigPonytailPackageDir(agentDir = pigAgentDir()): string {
  return piPonytailPackageDir(agentDir);
}

function packageVersion(dir: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

// The tersio package pi declared in settings.json, or null; pi names sources, so npm spec, git URL or path count.
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

export function pigTersioSource(agentDir = pigAgentDir()): string | null {
  let settings: { packages?: unknown };
  try {
    const parsed: unknown = JSON.parse(readFileSync(pigSettingsFile(agentDir), 'utf8'));
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

const HOSTS: Array<Omit<HostEntry, 'installed' | 'via' | 'declared' | 'version' | 'dir'>> = [
  { id: 'omp', label: 'Oh My Pi', bin: 'omp', installCmd: `omp plugin install ${PACKAGE_NAME}`, removeCmd: `omp plugin remove ${PACKAGE_NAME}` },
  { id: 'pi', label: 'Pi', bin: 'pi', installCmd: `pi install npm:${PACKAGE_NAME}`, removeCmd: `pi remove npm:${PACKAGE_NAME}` },
  { id: 'opencode', label: 'OpenCode', bin: 'opencode', installCmd: `tersio install --host opencode`, removeCmd: `tersio uninstall --host opencode` },
  { id: 'pig', label: 'Pi-in-go', bin: 'pig', installCmd: `pig install npm:${PACKAGE_NAME}`, removeCmd: `pig remove npm:${PACKAGE_NAME}` },
  { id: 'dsh', label: 'DeepSeek Harness', bin: 'dsh', installCmd: `dsh plugin --profile web add npm:${PACKAGE_NAME}`, removeCmd: `dsh plugin --profile web remove @krtclcdy/tersio` },
];

function detect(agentDir = piAgentDir(), pigDir = pigAgentDir()): HostEntry[] {
  return HOSTS.map((host) => {
    const pkgDir = host.id === 'omp'
      ? ompPackageDir()
      : host.id === 'pi'
        ? piPackageDir(agentDir)
        : host.id === 'pig'
          ? pigPackageDir(pigDir)
          : host.id === 'dsh'
            ? dshPackageDir()
            : null;
    const currentAgentDir = host.id === 'pig' ? pigDir : agentDir;
    const tree = hostExtensionsDir(host.id, currentAgentDir);
    // A tree wins: the installer writes it and it carries no package.json, so its version is ours. OpenCode keeps no package to fall back to, so a present tree is the install and drift gets the per-host warning. DeepSeek Harness has no tree: the tersio package is mounted as a dsh bundle, and the mounted package dir is the install.
    const via = host.id === 'dsh'
      ? pkgDir && existsSync(pkgDir) ? 'package' : null
      : missingTreeFiles(host.id, currentAgentDir).length === 0 || (host.id === 'opencode' && existsSync(tree))
        ? 'tree'
        : pkgDir && existsSync(pkgDir) ? 'package' : null;
    return {
      ...host,
      installed: via !== null,
      via,
      declared: host.id === 'omp'
        ? (pkgDir && existsSync(pkgDir) ? `plugin ${PACKAGE_NAME}` : null)
        : host.id === 'pi'
          ? piTersioSource(agentDir)
          : host.id === 'pig'
            ? pigTersioSource(pigDir)
            : host.id === 'dsh'
              ? (pkgDir && existsSync(pkgDir) ? 'dsh bundle' : null)
              : existsSync(tree) ? 'plugin tree' : null,
      version: via === 'tree' ? PACKAGE_VERSION : via === 'package' && pkgDir ? packageVersion(pkgDir) : null,
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

/** The rows a host menu draws: the agent, its state, and what a run would touch. */
export function hostOptions(hosts: HostEntry[]): Array<{ value: string; label: string; hint?: string }> {
  return hosts.map((host) => ({ value: host.id, label: hostLabel(host), hint: hostHint(host) }));
}

// `--host omp|pi|opencode|pig|dsh` from raw argv, undefined when absent; throws on an unknown value so the caller exits(1).
export function parseHostArg(argv: string[]): HostId | undefined {
  const i = argv.indexOf('--host');
  const raw = (i === -1 ? undefined : argv[i + 1]) ?? argv.find((a) => a.startsWith('--host='))?.slice('--host='.length);
  if (raw === undefined) return undefined;
  const value = raw.trim().toLowerCase();
  if (value !== 'omp' && value !== 'pi' && value !== 'opencode' && value !== 'pig' && value !== 'dsh') throw new Error(`Invalid --host: ${raw}. Valid: omp, pi, opencode, pig, dsh`);
  return value;
}

export { HOME, detect as detectHosts };
