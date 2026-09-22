// cli/profile.ts — session-start defaults profile (combo/caveman/rtk/ponytail)
// plus the display-currency default for usage/gain reports.
// Single source for reading/writing the omp plugin settings lock entry.
// Extracted from cli/install.ts so both install and settings share it.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  CAVEMAN_DEFAULTS, COMBO_PRESET_MODES, OMP_PLUGINS_DIR, PACKAGE_NAME, PONYTAIL_DEFAULTS,
  verbose,
} from './common.ts';
import type { WriteOptions } from './common.ts';
import { DEFAULT_CURRENCY, isCurrencyCode } from './currency.ts';
import type { CurrencyCode } from './currency.ts';
import { readTextIfExists } from '../extensions/lib/utils.ts';

interface Profile {
  comboDefault: string;
  cavemanDefault: string;
  rtkDefault: boolean;
  ponytailDefault: string;
  currency: CurrencyCode;
}

function defaultProfile(): Profile {
  return {
    comboDefault: 'off',
    cavemanDefault: 'off',
    rtkDefault: false,
    ponytailDefault: 'off',
    currency: DEFAULT_CURRENCY,
  };
}

interface StoredSettings {
  comboDefault?: unknown;
  cavemanDefault?: unknown;
  rtkDefault?: unknown;
  ponytailDefault?: unknown;
  currency?: unknown;
}

// Stored profile from the live lock file: update/reinstall runs without flags
// or prompts must preserve the user's choice, never reset it to off.
async function storedProfile(): Promise<Profile> {
  const base = defaultProfile();
  const raw = await readTextIfExists(path.join(OMP_PLUGINS_DIR, 'omp-plugins.lock.json'));
  if (!raw) return base;
  let stored: StoredSettings;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !('settings' in parsed)) return base;
    const settings = (parsed as { settings: unknown }).settings;
    if (!settings || typeof settings !== 'object' || !(PACKAGE_NAME in settings)) return base;
    const entry = (settings as Record<string, unknown>)[PACKAGE_NAME];
    if (!entry || typeof entry !== 'object') return base;
    stored = entry as StoredSettings;
  } catch { return base; }
  if (typeof stored.comboDefault === 'string' && stored.comboDefault in COMBO_PRESET_MODES) base.comboDefault = stored.comboDefault;
  if (typeof stored.cavemanDefault === 'string' && CAVEMAN_DEFAULTS.has(stored.cavemanDefault)) base.cavemanDefault = stored.cavemanDefault;
  if (typeof stored.rtkDefault === 'boolean') base.rtkDefault = stored.rtkDefault;
  if (typeof stored.ponytailDefault === 'string' && PONYTAIL_DEFAULTS.has(stored.ponytailDefault)) base.ponytailDefault = stored.ponytailDefault;
  if (typeof stored.currency === 'string' && isCurrencyCode(stored.currency.trim().toUpperCase())) {
    base.currency = stored.currency.trim().toUpperCase() as CurrencyCode;
  }
  return base;
}

// Persist the profile as omp plugin settings so `omp plugin config get`
// reflects the choice and the extensions pick it up on session start.
async function writePluginSettings(profile: Profile, options: WriteOptions): Promise<void> {
  const pluginsDir = OMP_PLUGINS_DIR;
  const lockPath = path.join(pluginsDir, 'omp-plugins.lock.json');
  let config: { plugins?: Record<string, unknown>; settings?: Record<string, Record<string, unknown>> } = {};
  const existing = await readTextIfExists(lockPath);
  if (existing) {
    try { config = JSON.parse(existing); } catch { config = {}; }
  }
  config.plugins = config.plugins || {};
  config.settings = config.settings || {};
  config.settings[PACKAGE_NAME] = {
    ...(config.settings[PACKAGE_NAME] || {}),
    comboDefault: profile.comboDefault,
    cavemanDefault: profile.cavemanDefault,
    rtkDefault: profile.rtkDefault,
    ponytailDefault: profile.ponytailDefault,
    currency: profile.currency,
  };

  if (options.dryRun) {
    if (verbose && !options.quiet) console.log(`  [dry-run] would write plugin settings (${PACKAGE_NAME}) to ${lockPath}`);
    return;
  }
  await fs.mkdir(pluginsDir, { recursive: true });
  await fs.writeFile(lockPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  console.log(`  [write] Plugin settings in ${lockPath}`);
}

function formatProfile(profile: Profile): string {
  return `combo=${profile.comboDefault} (caveman=${profile.cavemanDefault} · rtk=${profile.rtkDefault ? 'on' : 'off'} · ponytail=${profile.ponytailDefault}) · currency=${profile.currency}`;
}

export { defaultProfile, formatProfile, storedProfile, writePluginSettings, Profile };
