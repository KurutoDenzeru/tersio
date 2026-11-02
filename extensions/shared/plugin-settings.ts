// One settings file for every host; parse failure yields {} with per-caller defaults.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { homeDir, tersioHome } from './utils.ts';

export const PLUGIN_NAME = '@krtclcdy/tersio';

// The one store both hosts read; this module owns its path.
export function tersioSettingsFile(): string {
  return path.join(tersioHome(), 'settings.json');
}

// Older installs kept these as OMP plugin settings; still read so switching stores does not reset a user's defaults.
function legacyOmpSettings(): Record<string, unknown> | null {
  const configHome = process.env.XDG_CONFIG_HOME || path.join(homeDir(), '.config');
  for (const p of [
    path.join(homeDir(), '.omp', 'plugins', 'omp-plugins.lock.json'),
    path.join(configHome, 'omp', 'plugins', 'omp-plugins.lock.json'),
  ]) {
    if (!existsSync(p)) continue;
    try {
      const config = JSON.parse(readFileSync(p, 'utf8')) as { settings?: Record<string, Record<string, unknown>> };
      const values = config.settings?.[PLUGIN_NAME];
      if (values && typeof values === 'object' && !Array.isArray(values)) return values;
    } catch { /* tolerate corrupt file */ }
  }
  return null;
}

function readSettingsFile(): Record<string, unknown> | null {
  const p = tersioSettingsFile();
  if (!existsSync(p)) return null;
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// The stored settings; {} when the file is missing or corrupt.
export function readPluginSettings(): Record<string, unknown> {
  return readSettingsFile() ?? legacyOmpSettings() ?? {};
}

/** Retention windows the settings store accepts; `0` keeps everything. */
export const RETENTION_DAYS: ReadonlySet<number> = new Set([0, 7, 14, 30, 90, 180, 365]);

/** The retention window from settings. `0`, the default, means no pruning anywhere. */
export function readRetentionDays(): number {
  try {
    const raw = JSON.parse(readFileSync(tersioSettingsFile(), 'utf8')) as { retentionDays?: unknown };
    const days = Number(raw?.retentionDays);
    return RETENTION_DAYS.has(days) ? days : 0;
  } catch {
    return 0;
  }
}

/** Which agent a session runs on; the settings readers scope the per-host layer with it. */
export type HostScope = 'omp' | 'pi' | 'pig' | 'opencode';

/** The `hosts.<id>` section of the store, or nothing: the flat keys stay the shared fallback. */
function hostDefaults(host?: HostScope | null): Record<string, unknown> {
  if (!host) return {};
  const hosts = readPluginSettings().hosts;
  const section = (hosts as Record<string, unknown> | undefined)?.[host];
  return section && typeof section === 'object' && !Array.isArray(section) ? section as Record<string, unknown> : {};
}

const COMBO_LEVELS = new Set(['off', 'lite', 'balanced', 'max']);
// A settings file written before the rename still names the preset `medium`.
const RETIRED_COMBO_LEVELS = new Set(['medium']);
const CAVEMAN_MODES = new Set(['off', 'lite', 'full', 'ultra', 'megacave', 'megacave-lite', 'megacave-full', 'megacave-ultra', 'wenyan', 'wenyan-lite', 'wenyan-full', 'wenyan-ultra']);
const PONYTAIL_MODES = new Set(['off', 'lite', 'full', 'ultra']);
// Opt-in only: no combo preset writes this, so it never reaches a user who did not ask for it.
const PSTACK_MODES = new Set(['off', 'on']);
// Same opt-in contract as pstack: the binary is the user's own install, the mode only tracks it.
const HEADROOM_MODES = new Set(['off', 'on']);

function readStringDefault(key: string, valid: Set<string>, host?: HostScope | null): string {
  // A host's own section wins, so one agent can run lite while another runs balanced.
  const scoped = hostDefaults(host)[key];
  if (typeof scoped === 'string' && valid.has(scoped)) return scoped;
  const raw = readPluginSettings()[key];
  return typeof raw === 'string' && valid.has(raw) ? raw : 'off';
}

export function readComboDefault(host?: HostScope | null): string {
  const raw = readStringDefault('comboDefault', COMBO_LEVELS, host);
  if (raw !== 'off') return raw;
  const stored = hostDefaults(host).comboDefault ?? readPluginSettings().comboDefault;
  return typeof stored === 'string' && RETIRED_COMBO_LEVELS.has(stored) ? 'lite' : raw;
}

export function readCavemanDefault(host?: HostScope | null): string {
  return readStringDefault('cavemanDefault', CAVEMAN_MODES, host);
}

export function readRtkDefault(host?: HostScope | null): boolean {
  const scoped = hostDefaults(host).rtkDefault;
  if (typeof scoped === 'boolean') return scoped;
  const raw = readPluginSettings().rtkDefault;
  return typeof raw === 'boolean' ? raw : false;
}

export function readPonytailDefault(host?: HostScope | null): string {
  return readStringDefault('ponytailDefault', PONYTAIL_MODES, host);
}

export function readPstackDefault(host?: HostScope | null): string {
  return readStringDefault('pstackDefault', PSTACK_MODES, host);
}

export function readHeadroomDefault(host?: HostScope | null): string {
  return readStringDefault('headroomDefault', HEADROOM_MODES, host);
}

export function isComboSetupComplete(): boolean {
  return readPluginSettings().comboSetupComplete === true;
}

const COMBO_MODE_DEFAULTS = {
  off: { cavemanDefault: 'off', rtkDefault: false, ponytailDefault: 'off' },
  lite: { cavemanDefault: 'lite', rtkDefault: true, ponytailDefault: 'lite' },
  balanced: { cavemanDefault: 'full', rtkDefault: true, ponytailDefault: 'full' },
  max: { cavemanDefault: 'ultra', rtkDefault: true, ponytailDefault: 'ultra' },
} as const;

export function saveComboSetup(level: string, host?: HostScope | null): boolean {
  if (!(level in COMBO_MODE_DEFAULTS)) return false;
  const file = tersioSettingsFile();
  mkdirSync(path.dirname(file), { recursive: true });
  const patch = { comboDefault: level, ...COMBO_MODE_DEFAULTS[level as keyof typeof COMBO_MODE_DEFAULTS] };
  const stored = readPluginSettings();
  // A host scope writes its own section, so this agent's preset never becomes every agent's.
  const next = host
    ? { ...stored, hosts: { ...(stored.hosts as Record<string, unknown> | undefined), [host]: { ...hostDefaults(host), ...patch } } }
    : { ...stored, ...patch };
  writeFileSync(file, `${JSON.stringify({ ...next, comboSetupComplete: true }, null, 2)}\n`, 'utf8');
  return true;
}
