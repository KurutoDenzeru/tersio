// Session-start defaults for the Tersio extensions, read from the first file that carries them.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export const PLUGIN_NAME = '@krtclcdy/tersio';

function tersioSettingsFile(): string {
  return path.join(os.homedir(), '.tersio', 'settings.json');
}

function ompLockPaths(): string[] {
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return [
    path.join(os.homedir(), '.omp', 'plugins', 'omp-plugins.lock.json'),
    path.join(configHome, 'omp', 'plugins', 'omp-plugins.lock.json'),
  ];
}

function readJsonObject(file: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch { return {}; }
}

// The tersio-owned store, falling back to OMP's `settings[PLUGIN_NAME]`.
export function readPluginSettings(): Record<string, unknown> {
  const own = readJsonObject(tersioSettingsFile());
  if (Object.keys(own).length > 0) return own;
  for (const p of ompLockPaths()) {
    if (!existsSync(p)) continue;
    const values = readJsonObject(p).settings;
    if (!values || typeof values !== 'object' || Array.isArray(values)) continue;
    const entry = (values as Record<string, unknown>)[PLUGIN_NAME];
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) return entry as Record<string, unknown>;
  }
  return {};
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
  const current = readJsonObject(file);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({
    ...current,
    comboDefault: level,
    ...COMBO_MODE_DEFAULTS[level as keyof typeof COMBO_MODE_DEFAULTS],
    comboSetupComplete: true,
  }, null, 2) + '\n', 'utf8');
  return true;
}

// Absolute path of the tersio-owned defaults store, for the CLI's plan lines.
export function tersioSettingsPath(): string {
  return tersioSettingsFile();
}
