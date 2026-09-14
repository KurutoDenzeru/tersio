// Plugin settings reader for the Tersio extensions.
// Reads omp's persisted plugin state (~/.omp/plugins/omp-plugins.lock.json),
// written by `omp plugin config set @krtclcdy/tersio <key> <value>` and by
// the installer profile step. Tolerant: any parse failure yields {} so every
// caller falls back to its own default.

import { existsSync, readFileSync } from 'node:fs';
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
const CAVEMAN_MODES = new Set(['off', 'lite', 'full', 'ultra', 'wenyan']);
const PONYTAIL_MODES = new Set(['off', 'lite', 'full', 'ultra', 'review']);

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
