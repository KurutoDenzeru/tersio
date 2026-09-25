// Plugin settings reader for the Tersio extensions.
// Reads omp's persisted plugin state (~/.omp/plugins/omp-plugins.lock.json),
// written by `omp plugin config set @krtclcdy/tersio <key> <value>` and by
// the installer profile step. Tolerant: any parse failure yields {} so every
// caller falls back to its own default.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export const PLUGIN_NAME = '@krtclcdy/tersio';

function lockPaths(): string[] {
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return [
    path.join(os.homedir(), '.omp', 'plugins', 'omp-plugins.lock.json'),
    path.join(configHome, 'omp', 'plugins', 'omp-plugins.lock.json'),
  ];
}

// `settings[PLUGIN_NAME]` in the lock file; empty object when missing.
export function readPluginSettings(): Record<string, unknown> {
  for (const p of lockPaths()) {
    if (!existsSync(p)) continue;
    try {
      const config = JSON.parse(readFileSync(p, 'utf8')) as { settings?: Record<string, Record<string, unknown>> };
      const values = config.settings?.[PLUGIN_NAME];
      if (values && typeof values === 'object' && !Array.isArray(values)) return values;
    } catch { /* tolerate corrupt file */ }
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
  const lockPath = lockPaths()[0];
  let lock: { plugins?: Record<string, unknown>; settings?: Record<string, Record<string, unknown>> } = {};
  if (existsSync(lockPath)) {
    try { lock = JSON.parse(readFileSync(lockPath, 'utf8')) as typeof lock; } catch { lock = {}; }
  }
  lock.plugins ||= {};
  lock.settings ||= {};
  lock.settings[PLUGIN_NAME] = {
    ...lock.settings[PLUGIN_NAME],
    comboDefault: level,
    ...COMBO_MODE_DEFAULTS[level as keyof typeof COMBO_MODE_DEFAULTS],
    comboSetupComplete: true,
  };
  mkdirSync(path.dirname(lockPath), { recursive: true });
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n', 'utf8');
  return true;
}
