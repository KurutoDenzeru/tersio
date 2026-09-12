import type { ComboLevel, ComboState, ExtensionCtx, SessionEntry, UiApi } from './types.ts';

const BRIDGE_KEY = Symbol.for('tersio/combo-session-state');

export const OMP_SUBAGENT_MARKER = 'You are operating on a piece of work assigned to you by the main agent.';

export const COMBO_LEVELS: Record<string, Readonly<ComboState>> = Object.freeze({
  off: Object.freeze({ level: 'off', caveman: 'off', rtk: 'off', ponytail: 'off' }),
  medium: Object.freeze({ level: 'medium', caveman: 'lite', rtk: 'on', ponytail: 'lite' }),
  balanced: Object.freeze({ level: 'balanced', caveman: 'full', rtk: 'on', ponytail: 'full' }),
  max: Object.freeze({ level: 'max', caveman: 'ultra', rtk: 'on', ponytail: 'ultra' }),
});

const MODE_VALUES: Record<string, Set<string>> = {
  caveman: new Set(['off', 'lite', 'full', 'ultra', 'wenyan']),
  rtk: new Set(['off', 'on']),
  ponytail: new Set(['off', 'lite', 'full', 'ultra', 'review']),
};

type ModeName = 'caveman' | 'rtk' | 'ponytail';
type Modes = Record<ModeName, string>;

const MODE_ENTRY_TYPES: Record<string, ModeName> = {
  'caveman-mode': 'caveman',
  'rtk-mode': 'rtk',
  'ponytail-mode': 'ponytail',
};

interface Bridge {
  state: Readonly<ComboState>;
  listeners: Set<(state: Readonly<ComboState>) => void>;
}

export function normalizeMode(name: ModeName, value: unknown): string | null {
  if (name === 'rtk' && typeof value === 'boolean') return value ? 'on' : 'off';
  const mode = String(value ?? '').trim().toLowerCase();
  return MODE_VALUES[name]?.has(mode) ? mode : null;
}

export function deriveLevel(modes: Modes | null | undefined): ComboLevel {
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
  };
  return Object.freeze({ level: isKnownLevel(level) ? level : deriveLevel(state), ...state });
}

function bridge(): Bridge {
  const existing = (globalThis as Record<symbol, unknown>)[BRIDGE_KEY] as Bridge | undefined;
  if (existing?.state) return existing;
  const initial = normalizedState((existing || COMBO_LEVELS.off) as Partial<Modes>);
  return ((globalThis as Record<symbol, unknown>)[BRIDGE_KEY] = { state: initial, listeners: new Set<(state: Readonly<ComboState>) => void>() });
}

function publish(state: Readonly<ComboState>): Readonly<ComboState> {
  const shared = bridge();
  shared.state = state;
  for (const listener of shared.listeners) listener(state);
  return state;
}

export function normalizeInputCommand(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/[.!?\s]+$/, '');
}

export function asPromptArray(systemPrompt: string | string[]): string[] {
  return Array.isArray(systemPrompt) ? systemPrompt : [systemPrompt];
}

export function systemPromptIncludes(systemPrompt: string | string[], marker: string): boolean {
  return asPromptArray(systemPrompt).some((prompt) => typeof prompt === 'string' && prompt.includes(marker));
}

export function isOmpSubagentPrompt(systemPrompt: string | string[]): boolean {
  return systemPromptIncludes(systemPrompt, OMP_SUBAGENT_MARKER);
}

export function normalizeComboLevel(value: unknown): ComboLevel | null {
  const level = String(value || '').trim().toLowerCase();
  return isPresetLevel(level) ? level : null;
}

export function paintStatusBar(ui: UiApi | undefined, key: string, emoji: string, label: string, isActive: boolean): void {
  const theme = ui?.theme;
  const indicator = isActive && theme?.fg ? theme.fg('accent', emoji) : emoji;
  ui?.setStatus?.(key, theme?.fg ? `${indicator} ${theme.fg('muted', label)}` : `${indicator} ${label}`);
}

// Last-wins scan for a custom session entry; skips entries whose value fails
// to parse so a corrupt write never shadows an older valid one.
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
  return publish(normalizedState(COMBO_LEVELS[level] as Partial<Modes>, level));
}

export function setSharedComboMode(name: ModeName, value: unknown): Readonly<ComboState> {
  const mode = normalizeMode(name, value);
  if (!mode) return getSharedComboState();
  const modes = { ...getSharedComboState(), [name]: mode } as Modes;
  // Derive the level from the final triplet so a redundant same-value write
  // (entry replay on resume, upstream ponytail re-affirming its mode) cannot
  // strand a matching preset at 'custom' and drop the combo bar.
  return publish(normalizedState(modes));
}

export function reconcileSharedComboEntries(entries: SessionEntry[] | null | undefined): Readonly<ComboState> {
  let modes: Modes = { ...COMBO_LEVELS.off };
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      if (entry?.type !== 'custom') continue;
      if (entry.customType === 'combo-level') {
        const preset = normalizeComboLevel(entry?.data?.level);
        if (preset) modes = { ...COMBO_LEVELS[preset] };
        continue;
      }
      const name = MODE_ENTRY_TYPES[entry.customType ?? ''] ?? null;
      if (!name) continue;
      const value = name === 'rtk' ? entry?.data?.enabled : entry?.data?.mode;
      const mode = normalizeMode(name, value);
      if (mode) modes[name] = mode;
    }
  }
  // The level always reflects the final mode triplet, never the write order:
  // a preset entry followed by the same values reconciles back to the preset.
  return publish(normalizedState(modes));
}

// One-line session-wide mode summary for change confirmations, e.g.
// `caveman=ULTRA, rtk=ON, ponytail=ULTRA`.
export function activeModesSummary(state: { caveman: string; rtk: string; ponytail: string }): string {
  return `caveman=${state.caveman.toUpperCase()}, rtk=${state.rtk.toUpperCase()}, ponytail=${state.ponytail.toUpperCase()}`;
}

export function setSharedComboListener(listener: ((state: Readonly<ComboState>) => void) | null): void {
  // Additive: every sibling extension syncs its local mirror on publish, so
  // a /tersio or /combo switch takes effect next turn with no session reload.
  // A null listener clears all (no current callers; reserved for teardown).
  if (typeof listener === 'function') bridge().listeners.add(listener);
  else bridge().listeners.clear();
}

export function resetSharedComboState(): Readonly<ComboState> {
  return setSharedComboLevel('off');
}
