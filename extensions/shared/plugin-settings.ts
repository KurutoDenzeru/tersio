// One settings file for every host; parse failure yields {} with per-caller defaults.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tersioHome } from '../lib/utils.ts';

export const PLUGIN_NAME = '@krtclcdy/tersio';

// The one store both hosts read; this module owns its path.
export function tersioSettingsFile(): string {
  return path.join(tersioHome(), 'settings.json');
}

// Older installs kept these as OMP plugin settings; still read so switching
// the store does not reset a user's defaults.
function legacyOmpSettings(): Record<string, unknown> | null {
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  for (const p of [
    path.join(os.homedir(), '.omp', 'plugins', 'omp-plugins.lock.json'),
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

// The stored settings; empty when the file is missing, corrupt, or empty.
export function readPluginSettings(): Record<string, unknown> {
  return readSettingsFile() ?? legacyOmpSettings() ?? {};
}

const COMBO_LEVELS = new Set(['off', 'medium', 'balanced', 'max']);
const CAVEMAN_MODES = new Set(['off', 'lite', 'full', 'ultra', 'wenyan', 'wenyan-lite', 'wenyan-full', 'wenyan-ultra']);
const PONYTAIL_MODES = new Set(['off', 'lite', 'full', 'ultra']);

function readStringDefault(key: string, valid: Set<string>): string {
  const raw = readPluginSettings()[key];
  return typeof raw === 'string' && valid.has(raw) ? raw : 'off';
}

export function readComboDefault(): string {
  return readStringDefault('comboDefault', COMBO_LEVELS);
}

export function readCavemanDefault(): string {
  return readStringDefault('cavemanDefault', CAVEMAN_MODES);
}

export function readRtkDefault(): boolean {
  const raw = readPluginSettings().rtkDefault;
  return typeof raw === 'boolean' ? raw : false;
}

export function readPonytailDefault(): string {
  return readStringDefault('ponytailDefault', PONYTAIL_MODES);
}

export function isComboSetupComplete(): boolean {
  return readPluginSettings().comboSetupComplete === true;
}

const COMBO_MODE_DEFAULTS = {
  off: { cavemanDefault: 'off', rtkDefault: false, ponytailDefault: 'off' },
  medium: { cavemanDefault: 'lite', rtkDefault: true, ponytailDefault: 'lite' },
  balanced: { cavemanDefault: 'full', rtkDefault: true, ponytailDefault: 'full' },
  max: { cavemanDefault: 'ultra', rtkDefault: true, ponytailDefault: 'ultra' },
} as const;

export function saveComboSetup(level: string): boolean {
  if (!(level in COMBO_MODE_DEFAULTS)) return false;
  const file = tersioSettingsFile();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({
    ...readPluginSettings(),
    comboDefault: level,
    ...COMBO_MODE_DEFAULTS[level as keyof typeof COMBO_MODE_DEFAULTS],
    comboSetupComplete: true,
  }, null, 2)}\n`, 'utf8');
  return true;
}
