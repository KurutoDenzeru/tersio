// cli/common.ts — shared foundation: CLI flags, paths, exec, file/config helpers.
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { readTextIfExists } from '../extensions/lib/utils.ts';

const IS_WINDOWS = process.platform === 'win32';
const RTK_BINARY_NAME = IS_WINDOWS ? 'rtk.exe' : 'rtk';
const HOME = process.env.HOME || process.env.USERPROFILE || '';
const OMP_AGENT_DIR = path.join(HOME, '.omp', 'agent');
const OMP_PLUGINS_DIR = path.join(HOME, '.omp', 'plugins');
const BUN_BIN_DIR = path.join(HOME, '.bun', 'bin');
const OMP_BIN = IS_WINDOWS ? 'omp.cmd' : 'omp';

const PACKAGE_NAME = '@krtclcdy/tersio';
const PACKAGE_BIN = 'tersio';
const { version: PACKAGE_VERSION } = createRequire(import.meta.url)('../package.json') as { version: string };

// --- Types ---

interface InstallOptions {
  dryRun: boolean;
  verbose: boolean;
  yes: boolean;
  scope: string;
  reinstall: boolean;
}

interface PluginsPackage {
  name?: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  [key: string]: unknown;
}

// Session-start mode defaults for fresh installs.
const CAVEMAN_DEFAULTS = new Set(['off', 'lite', 'full', 'ultra', 'wenyan']);
const PONYTAIL_DEFAULTS = new Set(['off', 'lite', 'full', 'ultra', 'review']);
const RTK_DEFAULTS = new Set(['on', 'off']);

// ponytail: Combo preset implies all three modes. Mirrors COMBO_LEVELS in
// extensions/shared/session-state.ts (rtk as boolean here). Single source.
const COMBO_PRESET_MODES: Record<string, { caveman: string; rtk: boolean; ponytail: string }> = {
  off: { caveman: 'off', rtk: false, ponytail: 'off' },
  medium: { caveman: 'lite', rtk: true, ponytail: 'lite' },
  balanced: { caveman: 'full', rtk: true, ponytail: 'full' },
  max: { caveman: 'ultra', rtk: true, ponytail: 'ultra' },
};
const COMBO_DEFAULTS = new Set(Object.keys(COMBO_PRESET_MODES));

function parseEnum(value: string | undefined, valid: Set<string>, flag: string): string | undefined {
  if (value === undefined) return undefined;
  const v = value.trim().toLowerCase();
  if (!valid.has(v)) {
    console.error(`[fail] Invalid ${flag}: ${value}. Valid: ${[...valid].join(', ')}`);
    process.exit(1);
  }
  return v;
}

function flagValue(name: string): string | undefined {
  const i = args.indexOf(name);
  if (i !== -1) return args[i + 1];
  const prefix = `${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

// --- CLI flags ---

const COMMANDS = new Set(['install', 'update', 'reinstall', 'doctor', 'uninstall', 'usage', 'dashboard', 'version', 'help']);
const args = process.argv.slice(2);
const commandArg = args.find((arg, index) => !arg.startsWith('-') && args[index - 1] !== '--scope');
const command = commandArg?.toLowerCase() || null;
const unknownCommand = command !== null && !COMMANDS.has(command);
const install = command === 'install';
const update = command === 'update';
const reinstall = command === 'reinstall';
const showVersion = command === 'version' || args.includes('--version') || args.includes('-v');
const showHelp = command === 'help' || args.includes('--help') || args.includes('-h');
const applyUpdate = args.includes('--apply-update');
const dryRun = args.includes('--dry-run');
const yes = args.includes('--yes') || args.includes('-y') || install || update || reinstall || applyUpdate;
const verbose = args.includes('--verbose');
const doctor = command === 'doctor' || args.includes('--doctor');
const usage = command === 'usage' || args.includes('--usage');
const dashboard = command === 'dashboard' || args.includes('--dashboard');
const dashboardPort = Number.parseInt(flagValue('--port') ?? '', 10) || 0;
const dashboardOpen = args.includes('--open');
const dashboardExport = flagValue('--export') ?? null;
const uninstall = command === 'uninstall' || args.includes('--uninstall');
const removePonytail = args.includes('--remove-ponytail');
const keepPonytail = args.includes('--keep-ponytail');
const removeRtk = args.includes('--remove-rtk');

const scopeFlag = flagValue('--scope')?.toLowerCase() ?? null;

// --- Profile selection (session-start mode defaults) ---

const comboDefaultFlag = parseEnum(flagValue('--combo-default'), COMBO_DEFAULTS, '--combo-default');
const cavemanDefaultFlag = parseEnum(flagValue('--caveman-default'), CAVEMAN_DEFAULTS, '--caveman-default');
const ponytailDefaultFlag = parseEnum(flagValue('--ponytail-default'), PONYTAIL_DEFAULTS, '--ponytail-default');
const rtkDefaultFlag = parseEnum(flagValue('--rtk-default'), RTK_DEFAULTS, '--rtk-default');

const profileFlagsGiven = [comboDefaultFlag, cavemanDefaultFlag, rtkDefaultFlag, ponytailDefaultFlag]
  .some((flag) => flag !== undefined);

function debug(...a: unknown[]): void {
  if (verbose) console.log('  [debug]', ...a);
}

const execFileP = promisify(execFile);

interface ExecOptions {
  timeout?: number;
  cwd?: string;
  encoding?: BufferEncoding;
  maxBuffer?: number;
  windowsHide?: boolean;
  shell?: boolean | string;
  env?: NodeJS.ProcessEnv;
}

async function execP(cmd: string, args: string[], opts: ExecOptions = {}): Promise<{ stdout: string; stderr: string }> {
  return execFileP(cmd, args, {
    timeout: opts.timeout || 120000,
    encoding: 'utf8',
    ...opts,
  }) as Promise<{ stdout: string; stderr: string }>;
}

interface WriteOptions {
  dryRun?: boolean;
}

async function writeIfChanged(dest: string, content: string, options: WriteOptions = {}): Promise<boolean> {
  const existing = await readTextIfExists(dest);
  if (existing === content) {
    debug(`${dest} already up to date`);
    return false;
  }
  if (options.dryRun) {
    console.log(`  [dry-run] would write ${dest}`);
    return true;
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  if (existing !== null) {
    await fs.copyFile(dest, `${dest}.bak`);
    debug(`${path.basename(dest)} → ${path.basename(dest)}.bak`);
  }
  await fs.writeFile(dest, content, 'utf8');
  console.log(`  [write] ${dest}`);
  return true;
}

// omp ships 'extensions: null'; appending list items under a null scalar breaks
// YAML parsing. Normalize null/~/[]/empty to a mapping key first.
const EXTENSIONS_KEY_RE = /^\s*extensions\s*:/i;
const EXTENSIONS_NULL_RE = /^\s*extensions\s*:\s*(?:\[\s*\]|null|~)?\s*$/i;

function normalizeExtensionsKey(lines: string[]): boolean {
  const idx = lines.findIndex((l) => EXTENSIONS_NULL_RE.test(l));
  if (idx === -1) return false;
  lines[idx] = 'extensions:';
  return true;
}

async function writeConfigLines(configPath: string, lines: string[], logMsg: string): Promise<void> {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.copyFile(configPath, `${configPath}.bak`).catch(() => { });
  await fs.writeFile(configPath, lines.join('\n'), 'utf8');
  console.log(logMsg);
}

async function ensureExtensionInConfig(configPath: string, extensionPath: string, label: string, options: WriteOptions = {}): Promise<boolean> {
  const normalizedPath = extensionPath.replace(/\\/g, '/');
  const line = `  - ${normalizedPath}`;

  const raw = await readTextIfExists(configPath);
  let lines = (raw || '').split('\n');

  if (lines.some((l) => l.includes(normalizedPath))) {
    debug(`${label} already in config.yml`);
    return false;
  }

  const extLineIdx = lines.findIndex((l) => EXTENSIONS_KEY_RE.test(l));

  if (options.dryRun) {
    console.log(`  [dry-run] would add ${label} to config.yml: ${normalizedPath}`);
    return true;
  }

  if (normalizeExtensionsKey(lines)) {
    lines.splice(extLineIdx + 1, 0, line, '');
  } else if (extLineIdx === -1) {
    lines.push('extensions:');
    lines.push(line);
    lines.push('');
  } else {
    lines.splice(extLineIdx + 1, 0, line);
  }

  await writeConfigLines(configPath, lines, `  [write] Added ${label} to config.yml`);
  return true;
}

async function ensureExtensionAfterConfigEntry(configPath: string, extensionPath: string, afterPath: string, label: string, options: WriteOptions = {}): Promise<boolean> {
  const normalizedPath = extensionPath.replace(/\\/g, '/');
  const normalizedAfterPath = afterPath.replace(/\\/g, '/');
  const line = `  - ${normalizedPath}`;
  const raw = await readTextIfExists(configPath);
  const lines = (raw || '').split('\n');
  const existingIndex = lines.findIndex((entry) => entry.includes(normalizedPath));
  const afterIndex = lines.findIndex((entry) => entry.includes(normalizedAfterPath));

  if (existingIndex !== -1 && afterIndex !== -1 && existingIndex === afterIndex + 1) return false;
  if (options.dryRun) {
    console.log(`  [dry-run] would place ${label} after Ponytail in config.yml: ${normalizedPath}`);
    return true;
  }

  if (existingIndex !== -1) lines.splice(existingIndex, 1);
  const refreshedAfterIndex = lines.findIndex((entry) => entry.includes(normalizedAfterPath));
  if (refreshedAfterIndex !== -1) {
    lines.splice(refreshedAfterIndex + 1, 0, line);
  } else {
    const extensionsIndex = lines.findIndex((entry) => EXTENSIONS_KEY_RE.test(entry));
    if (extensionsIndex === -1) {
      lines.push('extensions:', line, '');
    } else {
      normalizeExtensionsKey(lines);
      lines.splice(extensionsIndex + 1, 0, line);
    }
  }

  await writeConfigLines(configPath, lines, `  [write] Placed ${label} after Ponytail in config.yml`);
  return true;
}

function readPonytailConfig(): { dir: string; path: string } {
  const dir = process.env.XDG_CONFIG_HOME
    ? path.join(process.env.XDG_CONFIG_HOME, 'ponytail')
    : path.join(HOME, '.config', 'ponytail');
  return { dir, path: path.join(dir, 'config.json') };
}

interface PonytailConfig {
  defaultMode?: string;
  hideStatus?: boolean;
  [key: string]: unknown;
}

function parseJsonObject<T extends Record<string, unknown>>(text: string | null): T | null {
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text.replace(/^\uFEFF/, ''));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as T;
  } catch {
    return null;
  }
}

function parsePonytailConfig(existing: string | null): PonytailConfig {
  return parseJsonObject<PonytailConfig>(existing) ?? {};
}

async function patchPonytailConfig(
  apply: (cfg: PonytailConfig) => boolean,
  dryRunNote: string,
  writeNote: string,
  options: WriteOptions = {},
): Promise<void> {
  const config = readPonytailConfig();
  if (options.dryRun) {
    console.log(`  [dry-run] ${dryRunNote} in ${config.path}`);
    return;
  }
  const cfg = parsePonytailConfig(await readTextIfExists(config.path));
  if (!apply(cfg)) {
    debug('Ponytail config already up to date');
    return;
  }
  await fs.mkdir(config.dir, { recursive: true });
  await fs.writeFile(config.path, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  console.log(`  [write] ${writeNote} in ${config.path}`);
}

async function ensurePonytailConfigValue<K extends keyof PonytailConfig>(
  key: K, value: PonytailConfig[K], options: WriteOptions = {},
): Promise<void> {
  await patchPonytailConfig((cfg) => {
    if (cfg[key] === value) return false;
    cfg[key] = value;
    return true;
  }, `would set Ponytail ${key}=${value}`, `Set Ponytail ${key}=${value}`, options);
}



// Read plugins/package.json tolerantly; corrupt or missing files start fresh
// with installer-managed defaults.
async function readPluginsPackage(pkgPath: string): Promise<PluginsPackage & { dependencies: Record<string, string> }> {
  const pkg = parseJsonObject<PluginsPackage>(await readTextIfExists(pkgPath)) ?? {};
  return { ...pkg, name: pkg.name || 'omp-plugins', private: true, dependencies: pkg.dependencies || {} };
}

const SCOPE_MAP: Record<string, string> = { user: '1', project: '2', both: '3' };

function relTime(ageMs: number): string {
  const mins = Math.floor(ageMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days} day${days === 1 ? '' : 's'} ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
}
export {
  IS_WINDOWS, RTK_BINARY_NAME, HOME, OMP_AGENT_DIR, OMP_PLUGINS_DIR, BUN_BIN_DIR, OMP_BIN,
  PACKAGE_NAME, PACKAGE_BIN, PACKAGE_VERSION,
  CAVEMAN_DEFAULTS, PONYTAIL_DEFAULTS, RTK_DEFAULTS, COMBO_PRESET_MODES, COMBO_DEFAULTS,
  parseEnum, flagValue, COMMANDS, commandArg, command, unknownCommand,
  install, update, reinstall, showVersion, showHelp, applyUpdate,
  dryRun, yes, verbose, doctor, uninstall, usage, dashboard,
  dashboardPort, dashboardOpen, dashboardExport,
  removePonytail, keepPonytail, removeRtk, scopeFlag,
  comboDefaultFlag, cavemanDefaultFlag, ponytailDefaultFlag, rtkDefaultFlag, profileFlagsGiven,
  debug, execFileP, execP, writeIfChanged, normalizeExtensionsKey, EXTENSIONS_KEY_RE,
  writeConfigLines, ensureExtensionInConfig, ensureExtensionAfterConfigEntry,
  readPonytailConfig, parseJsonObject, parsePonytailConfig, patchPonytailConfig,
  ensurePonytailConfigValue, readPluginsPackage, SCOPE_MAP, relTime,
  InstallOptions, PluginsPackage, PonytailConfig, ExecOptions, WriteOptions,
};
