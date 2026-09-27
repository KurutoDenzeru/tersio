// cli/profile.ts — session-start defaults profile (combo/caveman/rtk/ponytail)
// plus the display-currency default for usage/dashboard reports.
// Stored in ~/.tersio/settings.json, the same file the extensions read, so
// OMP and Pi start from one choice. Extracted from cli/install.ts so both
// install and settings share it.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  CAVEMAN_DEFAULTS, COMBO_PRESET_MODES, PONYTAIL_DEFAULTS, verbose,
} from './common.ts';
import type { WriteOptions } from './common.ts';
import { DEFAULT_CURRENCY, isCurrencyCode } from './currency.ts';
import type { CurrencyCode } from './currency.ts';
import { readTextIfExists } from '../extensions/lib/utils.ts';
import { tersioSettingsPath } from '../extensions/shared/plugin-settings.ts';

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

// Stored profile from the live defaults file: update/reinstall runs without
// flags or prompts must preserve the user's choice, never reset it to off.
async function storedProfile(): Promise<Profile> {
  const base = defaultProfile();
  const raw = await readTextIfExists(tersioSettingsPath());
  if (!raw) return base;
  let stored: StoredSettings;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return base;
    stored = parsed as StoredSettings;
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

// Persist the profile to the file the extensions read at session start.
async function writePluginSettings(profile: Profile, options: WriteOptions): Promise<void> {
  const file = tersioSettingsPath();
  let current: Record<string, unknown> = {};
  const existing = await readTextIfExists(file);
  if (existing) {
    try {
      const parsed: unknown = JSON.parse(existing);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) current = parsed as Record<string, unknown>;
    } catch { current = {}; }
  }
  const config: Record<string, unknown> = {
    ...current,
    comboDefault: profile.comboDefault,
    comboSetupComplete: true,
    cavemanDefault: profile.cavemanDefault,
    rtkDefault: profile.rtkDefault,
    ponytailDefault: profile.ponytailDefault,
    currency: profile.currency,
  };

  if (options.dryRun) {
    if (verbose && !options.quiet) console.log(`  [dry-run] would write session defaults to ${file}`);
    return;
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(config, null, 2) + '\n', 'utf8');
  console.log(`  [write] Session defaults in ${file}`);
}


function formatProfile(profile: Profile): string {
  return `combo=${profile.comboDefault} (caveman=${profile.cavemanDefault} · rtk=${profile.rtkDefault ? 'on' : 'off'} · ponytail=${profile.ponytailDefault}) · currency=${profile.currency}`;
}

export { defaultProfile, formatProfile, storedProfile, writePluginSettings, Profile };
