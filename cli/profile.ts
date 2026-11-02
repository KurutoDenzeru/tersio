// cli/profile.ts — session-start defaults and the display-currency default,
import { existsSync, promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ACCENT_DEFAULTS, CAVEMAN_DEFAULTS, COMBO_PRESET_MODES, HEADROOM_DEFAULTS, PACKAGE_NAME, PONYTAIL_DEFAULTS, PSTACK_DEFAULTS,
  verbose,
} from './common.ts';
import type { WriteOptions } from './common.ts';
import os from 'node:os';
import { DEFAULT_CURRENCY, isCurrencyCode } from './currency.ts';
import { recordActivity } from './activity.ts';
import type { CurrencyCode } from './currency.ts';
import type { HostId } from '../extensions/shared/host-caps.ts';
import { readTextIfExists } from '../extensions/shared/utils.ts';
import { tersioSettingsFile } from '../extensions/shared/plugin-settings.ts';

function readTextIfExistsSync(file: string): string | null {
  try {
    return existsSync(file) ? readFileSync(file, 'utf8') : null;
  } catch {
    return null;
  }
}

interface Profile {
  comboDefault: string;
  cavemanDefault: string;
  rtkDefault: boolean;
  ponytailDefault: string;
  pstackDefault: string;
  headroomDefault: string;
  currency: CurrencyCode;
  backupSchedule: BackupSchedule;
  /** How long usage rows are kept, in days. `0` keeps everything. */
  retentionDays: number;
  // The dashboard's Developer tools switch and accent. Both live here, not in browser storage, so they survive a new port and a new browser: the dashboard binds a fresh origin each run.
  devTools: boolean;
  accent: string;
  /** The rail's expanded width in px, from the dashboard's drag handle. */
  sidebarWidth: number;
  sidebarOpen: boolean;
  // Empty means the built-in default.
  subagentMarkers: string[];
}

export type BackupSchedule = 'manual' | 'daily' | 'weekly' | 'monthly';
export const BACKUP_SCHEDULES: ReadonlySet<string> = new Set(['manual', 'daily', 'weekly', 'monthly']);

/** The retention windows a reader picks from; `0` is forever. */
export const RETENTION_DAYS: ReadonlySet<number> = new Set([0, 7, 14, 30, 90, 180, 365]);

function defaultProfile(): Profile {
  return {
    comboDefault: 'off',
    cavemanDefault: 'off',
    rtkDefault: false,
    ponytailDefault: 'off',
    pstackDefault: 'off',
    headroomDefault: 'off',
    currency: DEFAULT_CURRENCY,
    backupSchedule: 'monthly',
    retentionDays: 0,
    devTools: false,
    accent: 'emerald',
    sidebarWidth: 216,
    sidebarOpen: true,
    subagentMarkers: [],
  };
}

/** The rail keeps enough room for a label and never eats the page. */
function clampSidebarWidth(px: number): number {
  return Math.min(420, Math.max(180, Math.round(px)));
}

interface StoredSettings {
  comboDefault?: unknown;
  cavemanDefault?: unknown;
  rtkDefault?: unknown;
  ponytailDefault?: unknown;
  pstackDefault?: unknown;
  headroomDefault?: unknown;
  hosts?: unknown;
  currency?: unknown;
  backupSchedule?: unknown;
  retentionDays?: unknown;
  devTools?: unknown;
  accent?: unknown;
  sidebarWidth?: unknown;
  sidebarOpen?: unknown;
  subagentMarkers?: unknown;
}

/** Seed from OMP settings so pre-~/.tersio installs keep values. Sync: awaiting let piped stdin beat `ask()`. A host section, when named, wins over the flat keys. */
function storedProfileSync(host?: HostId | null): Profile {
  const base = defaultProfile();
  const stored = parseStored(readTextIfExistsSync(tersioSettingsFile()) ?? readTextIfExistsSync(legacyOmpLockPath()));
  if (!stored) return base;
  applyStored(base, stored);
  if (host) {
    const section = (stored.hosts as Record<string, Record<string, unknown>> | undefined)?.[host];
    if (section) applyStored(base, section as StoredSettings);
  }
  return base;
}

function applyStored(base: Profile, stored: StoredSettings): void {
  if (typeof stored.comboDefault === 'string' && stored.comboDefault in COMBO_PRESET_MODES) base.comboDefault = stored.comboDefault;
  if (typeof stored.cavemanDefault === 'string' && CAVEMAN_DEFAULTS.has(stored.cavemanDefault)) base.cavemanDefault = stored.cavemanDefault;
  if (typeof stored.rtkDefault === 'boolean') base.rtkDefault = stored.rtkDefault;
  if (typeof stored.ponytailDefault === 'string' && PONYTAIL_DEFAULTS.has(stored.ponytailDefault)) base.ponytailDefault = stored.ponytailDefault;
  if (typeof stored.pstackDefault === 'string' && PSTACK_DEFAULTS.has(stored.pstackDefault)) base.pstackDefault = stored.pstackDefault;
  if (typeof stored.headroomDefault === 'string' && HEADROOM_DEFAULTS.has(stored.headroomDefault)) base.headroomDefault = stored.headroomDefault;
  if (typeof stored.currency === 'string' && isCurrencyCode(stored.currency.trim().toUpperCase())) {
    base.currency = stored.currency.trim().toUpperCase() as CurrencyCode;
  }
  if (typeof stored.backupSchedule === 'string' && BACKUP_SCHEDULES.has(stored.backupSchedule)) {
    base.backupSchedule = stored.backupSchedule as BackupSchedule;
  }
  if (typeof stored.retentionDays === 'number' && RETENTION_DAYS.has(stored.retentionDays)) {
    base.retentionDays = stored.retentionDays;
  }
  if (typeof stored.devTools === 'boolean') base.devTools = stored.devTools;
  if (typeof stored.accent === 'string' && ACCENT_DEFAULTS.has(stored.accent)) base.accent = stored.accent;
  if (typeof stored.sidebarWidth === 'number') base.sidebarWidth = clampSidebarWidth(stored.sidebarWidth);
  if (typeof stored.sidebarOpen === 'boolean') base.sidebarOpen = stored.sidebarOpen;
  if (Array.isArray(stored.subagentMarkers)) {
    // An empty marker would match every turn.
    base.subagentMarkers = stored.subagentMarkers.filter((m): m is string => typeof m === 'string' && m.trim() !== '');
  }
}

async function storedProfile(host?: HostId | null): Promise<Profile> {
  return storedProfileSync(host);
}

function legacyOmpLockPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  const configHome = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  return [
    path.join(home, '.omp', 'plugins', 'omp-plugins.lock.json'),
    path.join(configHome, 'omp', 'plugins', 'omp-plugins.lock.json'),
  ].find((p) => existsSync(p)) ?? path.join(home, '.omp', 'plugins', 'omp-plugins.lock.json');
}

function parseStored(raw: string | null): StoredSettings | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const direct = parsed as Record<string, unknown>;
    const nested = (direct.settings as Record<string, StoredSettings> | undefined)?.[PACKAGE_NAME];
    return (nested ?? direct) as StoredSettings;
  } catch {
    return null;
  }
}

// Upstream Ponytail's pi extension reads its own config for the session default, so the saved default is mirrored there. Without it a headless pi session starts at upstream's default and never injects.
function ponytailConfigFile(): string {
  const base = (process.env.XDG_CONFIG_HOME || '').trim() || path.join(os.homedir(), '.config');
  return path.join(base, 'ponytail', 'config.json');
}

async function mirrorPonytailDefault(mode: string, options: WriteOptions): Promise<void> {
  const file = ponytailConfigFile();
  if (options.dryRun) {
    if (verbose && !options.quiet) console.log(`  [dry-run] would write the Ponytail default to ${file}`);
    return;
  }
  try {
    const existing = JSON.parse(readTextIfExistsSync(file) ?? '{}') as Record<string, unknown>;
    if (existing.defaultMode === mode) return;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${JSON.stringify({ ...existing, defaultMode: mode }, null, 2)}\n`, 'utf8');
    // A mirror of the session default, not a save of its own; the settings write above is the report.
    if (verbose) console.log(`  [write] Ponytail default in ${file}`);
  } catch { /* upstream's config is best-effort; its own default stands */ }
}

// A host section may hold `inherit`; the shared store never does, so a stored value stands and 'inherit' writes nothing.
function modeSection(key: HostDefaultField, value: unknown): Record<string, unknown> {
  return String(value) === 'inherit' ? {} : { [key]: value };
}

// Persist profile where every host reads it. `omp plugin config get` no longer reports it; `tersio settings` does.
async function writePluginSettings(profile: Profile, options: WriteOptions, opts: { keepSharedModes?: boolean } = {}): Promise<void> {
  const file = tersioSettingsFile();
  const before = parseStored(await readTextIfExists(file));
  const stored = before ?? {};
  // A host-scoped run keeps the shared mode values: its choices belong in the host section only.
  const modes: Record<string, unknown> = opts.keepSharedModes
    ? {}
    : {
        ...modeSection('comboDefault', profile.comboDefault),
        ...modeSection('cavemanDefault', profile.cavemanDefault),
        ...modeSection('rtkDefault', profile.rtkDefault),
        ...modeSection('ponytailDefault', profile.ponytailDefault),
        ...modeSection('pstackDefault', profile.pstackDefault),
        ...modeSection('headroomDefault', profile.headroomDefault),
      };
  const values = {
    ...stored,
    ...modes,
    comboSetupComplete: true,
    currency: profile.currency,
    backupSchedule: profile.backupSchedule,
    retentionDays: profile.retentionDays,
    devTools: profile.devTools,
    accent: profile.accent,
    sidebarWidth: profile.sidebarWidth,
    sidebarOpen: profile.sidebarOpen,
    ...(profile.subagentMarkers.length > 0 ? { subagentMarkers: profile.subagentMarkers } : {}),
  };
  if (options.dryRun) {
    if (verbose && !options.quiet) console.log(`  [dry-run] would write session defaults to ${file}`);
    return;
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(values, null, 2)}\n`, 'utf8');
  // Only a mode write is a session default; an accent or currency save is not, and would mislabel one.
  const modesChanged = !before || ['comboDefault', 'cavemanDefault', 'rtkDefault', 'ponytailDefault', 'pstackDefault', 'headroomDefault']
    .some((key) => before[key as keyof StoredSettings] !== values[key as keyof typeof values]);
  if (modesChanged) recordActivity('mode', 'Session defaults saved', formatProfile(profile));
  console.log(`  [write] Session defaults in ${file}`);
  await mirrorPonytailDefault(profile.ponytailDefault, options);
}

/** The mode fields a host section can carry. */
export type HostDefaultField = 'comboDefault' | 'cavemanDefault' | 'rtkDefault' | 'ponytailDefault' | 'pstackDefault' | 'headroomDefault';

/** A host's own section wins over the shared defaults, and only the fields the request chose land in it, so a later shared change still reaches the agent. */
export async function saveHostDefaults(host: HostId, fields: ReadonlyArray<HostDefaultField>, profile: Profile, options: WriteOptions): Promise<void> {
  const file = tersioSettingsFile();
  const before = parseStored(await readTextIfExists(file)) ?? {};
  const flat = before as Record<string, unknown>;
  const section: Record<string, string | boolean> = {};
  for (const field of new Set(fields)) {
    const value = profile[field];
    // Equality with the flat key is inheritance, not an override, so the section never freezes the shared value.
    if (flat[field] === undefined || flat[field] !== value) section[field] = value as string | boolean;
  }
  const hosts = { ...(before.hosts as Record<string, Record<string, unknown>> | undefined) };
  const merged: Record<string, string | boolean> = { ...(hosts[host] as Record<string, string | boolean> | undefined), ...section };
  for (const field of new Set(fields)) {
    // `inherit` is a removal, not a value this section stores.
    if (profile[field] === 'inherit') delete merged[field];
  }
  for (const key of Object.keys(merged)) {
    if (merged[key] === flat[key]) delete merged[key];
  }
  if (Object.keys(merged).length > 0) hosts[host] = merged;
  else delete hosts[host];
  const next = { ...before, hosts };
  if (options.dryRun) {
    if (verbose && !options.quiet) console.log(`  [dry-run] would write session defaults for ${host} to ${file}`);
    return;
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  recordActivity('mode', `Session defaults for ${host} saved`, formatProfile(profile));
  console.log(`  [write] Session defaults for ${host} in ${file}`);
}

function formatProfile(profile: Profile): string {
  return `combo=${profile.comboDefault} (caveman=${profile.cavemanDefault} · rtk=${profile.rtkDefault ? 'on' : 'off'} · ponytail=${profile.ponytailDefault} · pstack=${profile.pstackDefault} · headroom=${profile.headroomDefault}) · currency=${profile.currency}`;
}

/** The mode keys a harness exposes, in the order the status line prints them. */
export const CONFIG_KEYS = ['comboDefault', 'cavemanDefault', 'rtkDefault', 'ponytailDefault', 'pstackDefault', 'headroomDefault'] as const;
type ConfigKey = (typeof CONFIG_KEYS)[number];
const CONFIG_SETS: Partial<Record<ConfigKey, Set<string>>> = {
  comboDefault: new Set(Object.keys(COMBO_PRESET_MODES)),
  cavemanDefault: CAVEMAN_DEFAULTS,
  ponytailDefault: PONYTAIL_DEFAULTS,
  pstackDefault: PSTACK_DEFAULTS,
  headroomDefault: HEADROOM_DEFAULTS,
};

/** Each mode's effective value and its source: this agent's section, the shared store, the default, or an invalid raw value. */
export function configEntries(host: HostId | null): Array<{ key: ConfigKey; value: string | boolean; source: 'override' | 'inherited' | 'default' | 'invalid' }> {
  const stored = parseStored(readTextIfExistsSync(tersioSettingsFile())) ?? {};
  const flat = stored as Record<string, unknown>;
  const own = (host ? (stored.hosts as Record<string, Record<string, unknown>> | undefined)?.[host] : undefined) ?? {};
  // SAFETY: the stored section may hold the literal 'inherit' or invalid values, which the Profile type omits; the reader validates each below.
  const effective = storedProfileSync(host) as unknown as Record<string, string | boolean>;
  return CONFIG_KEYS.map((key) => {
    const overridden = own[key] !== undefined && own[key] !== 'inherit';
    const inherited = flat[key] !== undefined && flat[key] !== 'inherit';
    const raw = overridden ? own[key] : inherited ? flat[key] : undefined;
    const valid = raw === undefined || (CONFIG_SETS[key] ? CONFIG_SETS[key]!.has(String(raw)) : typeof raw === 'boolean');
    return { key, value: effective[key], source: raw === undefined ? 'default' : !valid ? 'invalid' : overridden ? 'override' : 'inherited' };
  });
}

export { clampSidebarWidth, defaultProfile, formatProfile, storedProfile, storedProfileSync, writePluginSettings };
export type { Profile };

/** A combo level writes the three modes it owns, so the level names the preset that produced them. */
export function applyComboPreset(profile: Profile, level: string): Profile {
  const preset = COMBO_PRESET_MODES[level] ?? COMBO_PRESET_MODES.off;
  return {
    ...profile,
    comboDefault: level,
    cavemanDefault: preset.caveman,
    rtkDefault: preset.rtk,
    ponytailDefault: preset.ponytail,
  };
}

/** The level a status line may claim: a preset only while the three modes it owns still match it. */
export function comboLevelOf(profile: Profile): string {
  const { comboDefault, cavemanDefault, rtkDefault, ponytailDefault } = profile;
  const preset = COMBO_PRESET_MODES[comboDefault];
  const matches = preset !== undefined
    && preset.caveman === cavemanDefault
    && preset.rtk === rtkDefault
    && preset.ponytail === ponytailDefault;
  return matches ? comboDefault : 'custom';
}

/** The status line the extensions print, read from the persisted profile. Lockstep with formatStatus in extensions/shared/status.ts. */
export function formatCliStatus(profile: Profile): string {
  const level = comboLevelOf(profile);
  const rtk = profile.rtkDefault ? 'on' : 'off';
  if (level === 'off' && profile.cavemanDefault === 'off' && rtk === 'off' && profile.ponytailDefault === 'off' && profile.pstackDefault === 'off' && profile.headroomDefault === 'off') return '🧩 COMBO OFF';
  const label = level === 'off' || level === 'custom' ? 'CUSTOM' : level.toUpperCase();
  return `🧩 COMBO ${label}: 🪨 caveman=${profile.cavemanDefault.toUpperCase()} | 🗜️ rtk=${rtk.toUpperCase()} | 🍃 headroom=${profile.headroomDefault.toUpperCase()} | 🧠 ponytail=${profile.ponytailDefault.toUpperCase()} | 🥔 pstack=${profile.pstackDefault.toUpperCase()}`;
}