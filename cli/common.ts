// cli/common.ts — shared foundation: CLI flags, paths, exec, file/config helpers.
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { readTextIfExists } from '../extensions/lib/utils.ts';
import { HOSTS } from './agent-hosts.ts';
import { parseCurrencyFlag, readStoredCurrency } from './currency.ts';
import type { CurrencyCode } from './currency.ts';

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
  reinstall: boolean;
  quiet?: boolean;
}

interface PluginsPackage {
  name?: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  [key: string]: unknown;
}

const CAVEMAN_DEFAULTS = new Set(['off', 'lite', 'full', 'ultra', 'wenyan-lite', 'wenyan-full', 'wenyan-ultra']);
const PONYTAIL_DEFAULTS = new Set(['off', 'lite', 'full', 'ultra']);
const RTK_DEFAULTS = new Set(['on', 'off']);
const DIAG_SCHEDULES = new Set(['manual', 'daily', 'weekly', 'monthly']);

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

const COMMANDS: Record<string, true> = { install: true, update: true, reinstall: true, doctor: true, uninstall: true, usage: true, dashboard: true, reset: true, settings: true, version: true, help: true };
const args = process.argv.slice(2);
const commandArg = args.find((arg) => !arg.startsWith('-'));
const command = commandArg?.toLowerCase() || null;
// Positional after the command: `tersio settings diagnosis` jumps straight
// to one prompt instead of walking the whole chain. Index-based so flag
// values (e.g. `--combo-default balanced`) never count as positionals.
const settingArg = ((): string | null => {
  const at = args.indexOf(commandArg ?? '');
  const next = at >= 0 ? args[at + 1] : undefined;
  if (!next || next.startsWith('-')) return null;
  return next.toLowerCase();
})();
const unknownCommand = command !== null && !COMMANDS[command];
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
const fix = args.includes('--fix') || args.some((a) => a.startsWith('--fix='));
const usage = command === 'usage' || args.includes('--usage');
const dashboard = command === 'dashboard';
const reset = command === 'reset';
const settings = command === 'settings';
const dashboardPort = Number.parseInt(flagValue('--port') ?? '', 10) || 0;
const dashboardOpen = args.includes('--open');
const dashboardExport = flagValue('--export') ?? null;
// Display currency for usage/dashboard: --currency flag wins, then the stored
// plugin default (tersio settings), then USD.
const currency: CurrencyCode = parseCurrencyFlag(flagValue('--currency')) ?? readStoredCurrency();
const currencyGiven = flagValue('--currency') !== undefined;
const uninstall = command === 'uninstall' || args.includes('--uninstall');
const removePonytail = args.includes('--remove-ponytail');
const keepPonytail = args.includes('--keep-ponytail');
const removeRtk = args.includes('--remove-rtk');

// Project scope was removed: tersio installs user-level (all OMP sessions)
// only. A bare `--scope user` still parses (old scripts); anything else fails.
const legacyScope = flagValue('--scope')?.toLowerCase() ?? null;
if (legacyScope !== null && legacyScope !== 'user') {
  console.error(`[fail] Invalid --scope: ${legacyScope}. Project scope was removed; tersio installs user-level only.`);
  process.exit(1);
}
// --- Profile selection (session-start mode defaults) ---

const comboDefaultFlag = parseEnum(flagValue('--combo-default'), COMBO_DEFAULTS, '--combo-default');
const cavemanDefaultFlag = parseEnum(flagValue('--caveman-default'), CAVEMAN_DEFAULTS, '--caveman-default');
const ponytailDefaultFlag = parseEnum(flagValue('--ponytail-default'), PONYTAIL_DEFAULTS, '--ponytail-default');
const rtkDefaultFlag = parseEnum(flagValue('--rtk-default'), RTK_DEFAULTS, '--rtk-default');
const diagScheduleFlag = parseEnum(flagValue('--diag-schedule'), DIAG_SCHEDULES, '--diag-schedule');
// Valid host ids come from the registry, so adding a host there is enough to
// make `--agent <id>` accept it. No second list to keep in sync.
const AGENT_IDS = new Set(HOSTS.map((h) => h.id));
// --agent accepts a list (`--agent omp,opencode`) or repeats of a single value
// (`--agent omp --agent cursor`). Scan argv directly rather than via
// flagValue(), which returns only the first occurrence and so silently
// collapsed repeats to one host.
// An empty result is meaningful: it means "no hosts", distinct from unset.
const agentFlag: string[] | undefined = (() => {
  const collected: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--agent') {
      const next = args[i + 1];
      if (next === undefined || next.startsWith('-')) {
        console.error('[fail] --agent needs a value. Valid: ' + [...AGENT_IDS].join(', '));
        process.exit(1);
      }
      collected.push(next);
      i += 1;
    } else if (arg.startsWith('--agent=')) {
      collected.push(arg.slice('--agent='.length));
    }
  }
  if (collected.length === 0) return undefined;
  const names = collected.flatMap((v) => v.split(',')).map((v) => v.trim().toLowerCase()).filter(Boolean);
  for (const n of names) {
    if (!AGENT_IDS.has(n)) {
      console.error(`[fail] Invalid --agent: ${n}. Valid: ${[...AGENT_IDS].join(', ')}`);
      process.exit(1);
    }
  }
  return [...new Set(names)];
})();

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
  quiet?: boolean;
  verbose?: boolean;
}

async function writeIfChanged(dest: string, content: string, options: WriteOptions = {}): Promise<boolean> {
  const existing = await readTextIfExists(dest);
  if (existing === content) {
    debug(`${dest} already up to date`);
    return false;
  }
  if (options.dryRun) {
    if (verbose) console.log(`  [dry-run] would write ${dest}`);
    return true;
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  if (existing !== null) {
    await fs.copyFile(dest, `${dest}.bak`);
    debug(`${path.basename(dest)} → ${path.basename(dest)}.bak`);
  }
  await fs.writeFile(dest, content, 'utf8');
  if (verbose && !options.quiet) console.log(`  [write] ${dest}`);
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

async function writeConfigLines(configPath: string, lines: string[], logMsg: string, options: WriteOptions = {}): Promise<void> {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.copyFile(configPath, `${configPath}.bak`).catch(() => { });
  await fs.writeFile(configPath, lines.join('\n'), 'utf8');
  if (verbose && !options.quiet) console.log(logMsg);
}

async function ensureExtensionInConfig(configPath: string, extensionPath: string, label: string, options: WriteOptions = {}): Promise<boolean> {
  const normalizedPath = extensionPath.replace(/\\/g, '/');
  const line = `  - ${normalizedPath}`;

  const raw = await readTextIfExists(configPath);
  let lines = (raw || '').split('\n');

  // Drop legacy compiled twins (same dir/name, .js): previous installs
  // registered them, and OMP must never load both copies. Match on the
  // trailing path so absolute and relative entries are both caught.
  if (normalizedPath.endsWith('.ts')) {
    const legacyTail = `${normalizedPath.slice(0, -3)}.js`.split('/').slice(-2).join('/');
    lines = lines.filter((l) => !l.trim().replace(/^\.\//, '').endsWith(legacyTail));
  }

  const matchingEntries = lines.filter((entry) => entry.trim().replace(/^-\s*/, '').replace(/^['"]|['"]$/g, '') === normalizedPath);
  if (matchingEntries.length > 1) {
    if (options.dryRun) {
      if (verbose && !options.quiet) console.log(`  [dry-run] would remove ${matchingEntries.length - 1} duplicate ${label} registration${matchingEntries.length === 2 ? '' : 's'}`);
      return true;
    }
    let kept = false;
    lines = lines.filter((entry) => {
      if (entry.trim().replace(/^-\s*/, '').replace(/^['"]|['"]$/g, '') !== normalizedPath) return true;
      if (kept) return false;
      kept = true;
      return true;
    });
    await writeConfigLines(configPath, lines, `  [write] Removed duplicate ${label} registration`, options);
    return true;
  }
  if (matchingEntries.length === 1) {
    debug(`${label} already in config.yml`);
    return false;
  }

  const extLineIdx = lines.findIndex((l) => EXTENSIONS_KEY_RE.test(l));

  if (options.dryRun) {
    if (verbose && !options.quiet) console.log(`  [dry-run] would add ${label} to config.yml`);
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

  await writeConfigLines(configPath, lines, `  [write] Added ${label} to config.yml`, options);
  return true;
}


async function removeExtensionFromConfig(configPath: string, extensionPath: string, label: string, options: WriteOptions = {}): Promise<boolean> {
  const normalizedPath = extensionPath.replace(/\\/g, '/').replace(/^\.\//, '');
  const extensionSuffix = normalizedPath.includes('/extensions/')
    ? normalizedPath.slice(normalizedPath.indexOf('/extensions/') + 1)
    : normalizedPath;
  const raw = await readTextIfExists(configPath);
  if (raw === null) return false;
  const lines = raw.split('\n');
  const matches = (entry: string): boolean => {
    const value = entry.trim().replace(/^-\s*/, '').replace(/^['"]|['"]$/g, '').replace(/\\/g, '/').replace(/^\.\//, '');
    return value === extensionSuffix || value.endsWith(`/${extensionSuffix}`);
  };
  const kept = lines.filter((entry) => !matches(entry));
  const removed = lines.length - kept.length;
  if (removed === 0) return false;
  if (options.dryRun) {
    if (verbose && !options.quiet) console.log(`  [dry-run] would remove ${label} registration${removed === 1 ? '' : 's'}`);
    return true;
  }
  await writeConfigLines(configPath, kept, `  [write] Removed duplicate ${label} registration`, options);
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
    if (verbose && !options.quiet) console.log(`  [dry-run] ${dryRunNote}`);
    return;
  }
  const cfg = parsePonytailConfig(await readTextIfExists(config.path));
  if (!apply(cfg)) {
    debug('Ponytail config already up to date');
    return;
  }
  await fs.mkdir(config.dir, { recursive: true });
  await fs.writeFile(config.path, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  if (verbose && !options.quiet) console.log(`  [write] ${writeNote}`);
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

/** Absolute mtime stamp shared by doctor rows and the dashboard detail. */
function absDate(ms: number): string {
  const d = new Date(ms);
  const q = (n: number): string => String(n).padStart(2, '0');
  const h24 = d.getHours();
  return `${q(d.getMonth() + 1)}-${q(d.getDate())}-${d.getFullYear()}, ${q(h24 % 12 || 12)}:${q(d.getMinutes())} ${h24 >= 12 ? 'PM' : 'AM'}`;
}
export {
  IS_WINDOWS, RTK_BINARY_NAME, HOME, OMP_AGENT_DIR, OMP_PLUGINS_DIR, BUN_BIN_DIR, OMP_BIN,
  PACKAGE_NAME, PACKAGE_BIN, PACKAGE_VERSION,
  CAVEMAN_DEFAULTS, PONYTAIL_DEFAULTS, RTK_DEFAULTS, DIAG_SCHEDULES, COMBO_PRESET_MODES, COMBO_DEFAULTS,
  parseEnum, flagValue, COMMANDS, commandArg, command, settingArg, unknownCommand,
  install, update, reinstall, showVersion, showHelp, applyUpdate, args,
  dryRun, yes, verbose, doctor, fix, uninstall, usage, dashboard, reset, settings,
  dashboardPort, dashboardOpen, dashboardExport, currency, currencyGiven,
  removePonytail, keepPonytail, removeRtk,
  comboDefaultFlag, cavemanDefaultFlag, ponytailDefaultFlag, rtkDefaultFlag, diagScheduleFlag, profileFlagsGiven,
  agentFlag, AGENT_IDS,
  debug, execFileP, execP, writeIfChanged, normalizeExtensionsKey, EXTENSIONS_KEY_RE,
  writeConfigLines, ensureExtensionInConfig, removeExtensionFromConfig,
  readPonytailConfig, parseJsonObject, parsePonytailConfig, patchPonytailConfig,
  ensurePonytailConfigValue, readPluginsPackage, relTime, absDate,
  InstallOptions, PluginsPackage, PonytailConfig, ExecOptions, WriteOptions,
};
