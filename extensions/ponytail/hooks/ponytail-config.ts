// ponytail — shared configuration resolver. Default mode: PONYTAIL_DEFAULT_MODE env, then the config file's defaultMode, then 'full'.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_MODE = 'full';
export const VALID_MODES: readonly string[] = ['off', 'lite', 'full', 'ultra', 'review'];
export const RUNTIME_MODES: readonly string[] = ['off', 'lite', 'full', 'ultra'];

export function normalizeMode(mode: unknown): string | null {
  if (typeof mode !== 'string') return null;
  const normalized = mode.trim().toLowerCase();
  return RUNTIME_MODES.includes(normalized) ? normalized : null;
}

export function normalizeConfigMode(mode: unknown): string | null {
  if (typeof mode !== 'string') return null;
  const normalized = mode.trim().toLowerCase();
  return VALID_MODES.includes(normalized) ? normalized : null;
}

export function normalizePersistedMode(mode: unknown): string | null {
  return normalizeMode(mode) || normalizeConfigMode(mode);
}

// "stop ponytail" / "normal mode" turn ponytail off only as a standalone command: the whole message must be the command, so "add a normal mode toggle" never deactivates.
export function isDeactivationCommand(text: unknown): boolean {
  const t = String(text || '').trim().toLowerCase().replace(/[.!?\s]+$/, '');
  return t === 'stop ponytail' || t === 'normal mode';
}

// ponytail: only embed the plugin install path in a statusline shell command when it's made of ordinary path characters.
export function isShellSafe(p: unknown): boolean {
  return typeof p === 'string' && /^[A-Za-z0-9 _.\-:/\\~]+$/.test(p);
}

export function getConfigDir(): string {
  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, 'ponytail');
  }
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'ponytail'
    );
  }
  return path.join(os.homedir(), '.config', 'ponytail');
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json');
}

export function getClaudeDir(): string {
  // ponytail: CLAUDE_CONFIG_DIR overrides ~/.claude, matching Claude Code.
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

export function getQoderDir(): string {
  return process.env.QODER_CONFIG_DIR || path.join(os.homedir(), '.qoder');
}

export function getDefaultMode(): string {
  // 1. Environment variable (highest priority). A default must be a runtime level (off/lite/full/ultra); review is session-only (#377).
  const envMode = normalizeMode(process.env.PONYTAIL_DEFAULT_MODE);
  if (envMode) {
    return envMode;
  }

  // 2. Config file
  try {
    const configPath = getConfigPath();
    // Strip UTF-8 BOM (common on Windows-saved files) so JSON.parse doesn't choke
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')) as { defaultMode?: unknown };
    const configMode = normalizeMode(config.defaultMode);
    if (configMode) {
      return configMode;
    }
  } catch {
    // Config file doesn't exist or is invalid — fall through
  }

  // 3. Default
  return DEFAULT_MODE;
}

// Silence the pi "Ponytail loaded" startup toast while keeping ponytail active. PONYTAIL_QUIET_STARTUP=1 (or any truthy value; 0/false/empty mean "show it") takes precedence, else config.quietStartup === true.
export function getQuietStartup(): boolean {
  const env = process.env.PONYTAIL_QUIET_STARTUP;
  if (env !== undefined) {
    const v = env.trim().toLowerCase();
    return v !== '' && v !== '0' && v !== 'false' && v !== 'no';
  }
  try {
    const config = JSON.parse(fs.readFileSync(getConfigPath(), 'utf8').replace(/^\uFEFF/, '')) as { quietStartup?: unknown };
    return config.quietStartup === true;
  } catch {
    return false;
  }
}

// Hide the status-bar indicator while keeping ponytail active (#324). PONYTAIL_HIDE_STATUS=1 (or any truthy value; 0/false/empty mean "don't hide") takes precedence, else config.hideStatus === true.
export function getHideStatus(): boolean {
  const env = process.env.PONYTAIL_HIDE_STATUS;
  if (env !== undefined) {
    const v = env.trim().toLowerCase();
    return v !== '' && v !== '0' && v !== 'false' && v !== 'no';
  }
  try {
    const config = JSON.parse(fs.readFileSync(getConfigPath(), 'utf8').replace(/^\uFEFF/, '')) as { hideStatus?: unknown };
    return config.hideStatus === true;
  } catch {
    return false;
  }
}

export function writeDefaultMode(mode: unknown): string | null {
  // ponytail: only a runtime level can be a default; review is session-only (#377).
  const normalized = normalizeMode(mode);
  if (!normalized) return null;

  const configPath = getConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')) as Record<string, unknown>;
    if (!config || typeof config !== 'object' || Array.isArray(config)) config = {};
  } catch {}
  config.defaultMode = normalized;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  return normalized;
}
