import { readPluginSettings } from './plugin-settings.ts';
import type { ComboLevel, ComboState, ExtensionCtx, SessionEntry } from './types.ts';

const BRIDGE_KEY = Symbol.for('tersio/combo-session-state');

// A verbatim sentence from omp's subagent prompt, so it can drift; read from the installed omp binary on 2026-10-01.
export const OMP_SUBAGENT_MARKER = 'Worker agent: delegated tasks.';

/** The three modes a preset owns. pstack is opt-in, so a preset never turns it on or off. */
type PresetModes = Readonly<Pick<ComboState, 'caveman' | 'rtk' | 'ponytail'>>;

export const COMBO_LEVELS: Record<string, PresetModes> = Object.freeze({
  off: Object.freeze({ caveman: 'off', rtk: 'off', ponytail: 'off' }),
  lite: Object.freeze({ caveman: 'lite', rtk: 'on', ponytail: 'lite' }),
  balanced: Object.freeze({ caveman: 'full', rtk: 'on', ponytail: 'full' }),
  max: Object.freeze({ caveman: 'ultra', rtk: 'on', ponytail: 'ultra' }),
});

const MODE_VALUES: Record<string, Set<string>> = {
  caveman: new Set(['off', 'lite', 'full', 'ultra', 'megacave', 'megacave-lite', 'megacave-full', 'megacave-ultra', 'wenyan', 'wenyan-lite', 'wenyan-full', 'wenyan-ultra']),
  rtk: new Set(['off', 'on']),
  ponytail: new Set(['off', 'lite', 'full', 'ultra']),
  pstack: new Set(['off', 'on']),
};

const ON_OFF_ALIASES: Readonly<Record<string, 'on' | 'off'>> = {
  on: 'on',
  enable: 'on',
  enabled: 'on',
  true: 'on',
  off: 'off',
  disable: 'off',
  disabled: 'off',
  false: 'off',
};

// Upstream renamed wenyan to megacave and kept the old spelling as an alias.
const CAVEMAN_LEGACY_PREFIX = /^wenyan/;

/** `wenyan` was the old name for megacave; both spellings reach the same level. */
export function canonicalCavemanMode(value: unknown): string | null {
  return normalizeMode('caveman', value);
}

export type ModeName = 'caveman' | 'rtk' | 'ponytail' | 'pstack';
type Modes = Record<ModeName, string>;

const MODE_ENTRY_TYPES: Record<string, ModeName> = {
  'caveman-mode': 'caveman',
  'rtk-mode': 'rtk',
  'ponytail-mode': 'ponytail',
  'pstack-mode': 'pstack',
};

/** True when the branch carries Tersio's own mode state; a subagent starts without it. */
export function hasModeState(entries: SessionEntry[] | null | undefined): boolean {
  return Array.isArray(entries) && entries.some((entry) => entry?.type === 'custom'
    && (entry.customType === 'combo-level' || MODE_ENTRY_TYPES[entry.customType ?? '']));
}

interface Bridge {
  state: Readonly<ComboState>;
  listeners: Map<string, (state: Readonly<ComboState>) => void>;
}

export function normalizeMode(name: ModeName, value: unknown): string | null {
  if (name === 'rtk' && typeof value === 'boolean') return value ? 'on' : 'off';
  const mode = String(value ?? '').trim().toLowerCase();
  // The README and the old hosts accept the boolean spellings for the two switches.
  if ((name === 'rtk' || name === 'pstack') && ON_OFF_ALIASES[mode]) return ON_OFF_ALIASES[mode];
  if (!MODE_VALUES[name]?.has(mode)) return null;
  if (name !== 'caveman') return mode;
  const canonical = mode.replace(CAVEMAN_LEGACY_PREFIX, 'megacave');
  return canonical === 'megacave' ? 'megacave-full' : canonical;
}

export function deriveLevel(modes: Modes | null | undefined): ComboLevel {
  // pstack is not part of a preset, so a level reads the three modes a preset owns and leaves pstack alone.
  for (const level of Object.keys(COMBO_LEVELS) as ComboLevel[]) {
    const preset = COMBO_LEVELS[level];
    if (preset.caveman === modes?.caveman && preset.rtk === modes?.rtk && preset.ponytail === modes?.ponytail) return level;
  }
  return 'custom';
}

function isPresetLevel(value: string): value is ComboLevel {
  return Object.prototype.hasOwnProperty.call(COMBO_LEVELS, value);
}

function isKnownLevel(value: string): boolean {
  return value === 'custom' || isPresetLevel(value);
}

function normalizedState(modes: Partial<Modes> | null | undefined, level: ComboLevel = deriveLevel(modes as Modes)): Readonly<ComboState> {
  const state: Modes = {
    caveman: normalizeMode('caveman', modes?.caveman) || 'off',
    rtk: normalizeMode('rtk', modes?.rtk) || 'off',
    ponytail: normalizeMode('ponytail', modes?.ponytail) || 'off',
    pstack: normalizeMode('pstack', modes?.pstack) || 'off',
  };
  return Object.freeze({ level: isKnownLevel(level) ? level : deriveLevel(state), ...state });
}

function bridge(): Bridge {
  const existing = (globalThis as Record<symbol, unknown>)[BRIDGE_KEY] as Bridge | undefined;
  if (existing?.state) return existing;
  const initial = normalizedState({ ...COMBO_LEVELS.off, pstack: 'off' });
  return ((globalThis as Record<symbol, unknown>)[BRIDGE_KEY] = { state: initial, listeners: new Map() });
}

function publish(state: Readonly<ComboState>): Readonly<ComboState> {
  const shared = bridge();
  shared.state = state;
  for (const listener of shared.listeners.values()) listener(state);
  return state;
}

export function normalizeInputCommand(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/[.!?\s]+$/, '');
}

export function asPromptArray(systemPrompt: string | string[]): string[] {
  const parts = Array.isArray(systemPrompt) ? systemPrompt : [systemPrompt];
  // OMP can hand back a hole in the array; a non-string breaks every marker check.
  return parts.filter((part): part is string => typeof part === 'string');
}

export function systemPromptIncludes(systemPrompt: string | string[], marker: string): boolean {
  return asPromptArray(systemPrompt).some((prompt) => typeof prompt === 'string' && prompt.includes(marker));
}

export function isOmpSubagentPrompt(systemPrompt: string | string[]): boolean {
  const raw = readPluginSettings().subagentMarkers;
  const configured = Array.isArray(raw) ? raw.filter((m): m is string => typeof m === 'string' && m.trim() !== '') : [];
  // A malformed setting falls back rather than matching every turn.
  const markers = configured.length ? configured : [OMP_SUBAGENT_MARKER];
  return markers.some((marker) => systemPromptIncludes(systemPrompt, marker));
}

// ultra maps to max and full to balanced, rather than erroring. `medium` is the retired name for
// `lite`, kept here so a settings file written before the rename still resolves.
const COMBO_ALIASES: Record<string, ComboLevel> = { ultra: 'max', full: 'balanced', medium: 'lite' };

export function normalizeComboLevel(value: unknown): ComboLevel | null {
  const level = String(value || '').trim().toLowerCase();
  if (isPresetLevel(level)) return level;
  return COMBO_ALIASES[level] ?? null;
}


// Last-wins scan for a custom session entry; skips unparseable values so a corrupt write never shadows a valid one.
export function lastCustomValue<T>(entries: SessionEntry[] | null | undefined, customType: string, pick: (data: SessionEntry['data']) => T | null | undefined): T | null {
  if (!Array.isArray(entries)) return null;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry?.type !== 'custom' || entry?.customType !== customType) continue;
    const value = pick(entry?.data);
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

export function sessionEntries(ctx: ExtensionCtx | undefined): SessionEntry[] {
  return ctx?.sessionManager?.getBranch?.() || ctx?.sessionManager?.getEntries?.() || [];
}

export function getSharedComboState(): Readonly<ComboState> {
  return bridge().state;
}

export function isComboPresetActive(): boolean {
  const level = getSharedComboState().level;
  return level !== 'off' && isPresetLevel(level);
}

export function setSharedComboLevel(value: unknown): Readonly<ComboState> {
  const level = normalizeComboLevel(value) || 'off';
  // A preset writes the three modes it owns and leaves pstack where the session already had it.
  return publish(normalizedState({ ...COMBO_LEVELS[level], pstack: getSharedComboState().pstack }, level));
}

export function setSharedComboMode(name: ModeName, value: unknown): Readonly<ComboState> {
  const mode = normalizeMode(name, value);
  if (!mode) return getSharedComboState();
  const modes = { ...getSharedComboState(), [name]: mode } as Modes;
  // Derive the level from the final quartet, so a redundant same-value write cannot strand a preset at 'custom'.
  return publish(normalizedState(modes));
}

export function setSharedComboModes(modes: { caveman?: unknown; rtk?: unknown; ponytail?: unknown; pstack?: unknown }): Readonly<ComboState> {
  return publish(normalizedState({
    caveman: normalizeMode('caveman', modes.caveman) || 'off',
    rtk: normalizeMode('rtk', modes.rtk) || 'off',
    ponytail: normalizeMode('ponytail', modes.ponytail) || 'off',
    pstack: normalizeMode('pstack', modes.pstack) || 'off',
  }));
}

export function reconcileSharedComboEntries(entries: SessionEntry[] | null | undefined): Readonly<ComboState> {
  let modes: Modes = { ...COMBO_LEVELS.off, pstack: 'off' };
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      if (entry?.type !== 'custom') continue;
      if (entry.customType === 'combo-level') {
        const preset = normalizeComboLevel(entry?.data?.level);
        // A preset entry never names pstack, so it keeps the pstack the entries around it set.
        if (preset) modes = { ...modes, ...COMBO_LEVELS[preset] };
        continue;
      }
      const name = MODE_ENTRY_TYPES[entry.customType ?? ''] ?? null;
      if (!name) continue;
      const value = name === 'rtk' ? entry?.data?.enabled : entry?.data?.mode;
      const mode = normalizeMode(name, value);
      if (mode) modes[name] = mode;
    }
  }
  // The level reflects the final three modes, not write order, so a preset followed by the same values reconciles back.
  return publish(normalizedState(modes));
}

// One-line session-wide mode summary for change confirmations.
export function activeModesSummary(state: { caveman: string; rtk: string; ponytail: string; pstack: string }): string {
  return `caveman=${state.caveman.toUpperCase()}, rtk=${state.rtk.toUpperCase()}, ponytail=${state.ponytail.toUpperCase()}, pstack=${state.pstack.toUpperCase()}`;
}

// Keyed registration drops stale closures; hosts offer no teardown hook.
export function setSharedComboListener(key: string, listener: (state: Readonly<ComboState>) => void): void {
  bridge().listeners.set(key, listener);
}

export function resetSharedComboState(): Readonly<ComboState> {
  // A preset keeps pstack, but a reset clears the bridge, so it writes all four modes off.
  return publish(normalizedState({ ...COMBO_LEVELS.off, pstack: 'off' }, 'off'));
}
