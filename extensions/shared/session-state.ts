import { readPluginSettings } from './plugin-settings.ts';
import type { ComboLevel, ComboState, ExtensionCtx, SessionEntry, UiApi } from './types.ts';

const BRIDGE_KEY = Symbol.for('tersio/combo-session-state');

/**
 * The default subagent marker. This is a verbatim sentence from OMP's own
 * subagent prompt, used only to tell a subagent turn from a main one, so it
 * can drift if OMP rewords it. Nothing here depends on the wording being
 * right, and `subagentMarkers()` lets a fork correct it in settings.json.
 */
export const OMP_SUBAGENT_MARKER = 'You are operating on a piece of work assigned to you by the main agent.';

export const COMBO_LEVELS: Record<string, Readonly<ComboState>> = Object.freeze({
  off: Object.freeze({ level: 'off', caveman: 'off', rtk: 'off', ponytail: 'off' }),
  medium: Object.freeze({ level: 'medium', caveman: 'lite', rtk: 'on', ponytail: 'lite' }),
  balanced: Object.freeze({ level: 'balanced', caveman: 'full', rtk: 'on', ponytail: 'full' }),
  max: Object.freeze({ level: 'max', caveman: 'ultra', rtk: 'on', ponytail: 'ultra' }),
});

const MODE_VALUES: Record<string, Set<string>> = {
  caveman: new Set(['off', 'lite', 'full', 'ultra', 'wenyan', 'wenyan-lite', 'wenyan-full', 'wenyan-ultra']),
  rtk: new Set(['off', 'on']),
  ponytail: new Set(['off', 'lite', 'full', 'ultra']),
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
  if (!MODE_VALUES[name]?.has(mode)) return null;
  return name === 'caveman' && mode === 'wenyan' ? 'wenyan-full' : mode;
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

// Resolved once per process: this is read on every agent start, and hitting
// the settings file per turn would be wasteful for a value that cannot change
// mid-session anyway. Clear it with resetSubagentMarkers() in tests.
let cachedMarkers: string[] | null = null;

/**
 * The strings that identify a subagent turn. Override with a `subagentMarkers`
 * array of strings in settings.json when the default no longer matches.
 */
export function subagentMarkers(): string[] {
  if (cachedMarkers) return cachedMarkers;
  const raw = readPluginSettings().subagentMarkers;
  const list = Array.isArray(raw) ? raw.filter((m): m is string => typeof m === 'string' && m.trim() !== '') : [];
  cachedMarkers = list.length ? list : [OMP_SUBAGENT_MARKER];
  return cachedMarkers;
}

export function resetSubagentMarkers(): void {
  cachedMarkers = null;
}

export function isOmpSubagentPrompt(systemPrompt: string | string[]): boolean {
  return subagentMarkers().some((marker) => systemPromptIncludes(systemPrompt, marker));
}

// `ultra` is the level caveman and ponytail both expose, so typing it is the
// obvious thing to try. It maps to the max preset rather than bouncing back
// with a wall of text; `lite`/`full` map to their nearest preset too.
const COMBO_ALIASES: Record<string, ComboLevel> = { ultra: 'max', lite: 'medium', full: 'balanced' };

export function normalizeComboLevel(value: unknown): ComboLevel | null {
  const level = String(value || '').trim().toLowerCase();
  if (isPresetLevel(level)) return level;
  return COMBO_ALIASES[level] ?? null;
}

// OMP themes status text through ctx.ui.theme.fg; pi has no ctx.ui.theme, so
// the same string renders plain there.
export function themeStatus(ui: UiApi | undefined, indicator: string, label: string, highlight = false): string {
  const theme = ui?.theme;
  if (!theme?.fg) return `${indicator} ${label}`;
  return `${highlight ? theme.fg('accent', indicator) : indicator} ${theme.fg('muted', label)}`;
}

export function paintStatusBar(ui: UiApi | undefined, key: string, emoji: string, label: string, isActive: boolean): void {
  ui?.setStatus?.(key, themeStatus(ui, emoji, label, isActive));
}

// A ctx from before a session replacement is stale and throws on any property
// access, so touching it must never abort a mode restore. Returns undefined for
// a stale ctx, and a narrowed ui so callers need no second setStatus check.
export type StatusUi = UiApi & { setStatus: NonNullable<UiApi['setStatus']> };

export function statusUi(ctx: ExtensionCtx | undefined): StatusUi | undefined {
  try {
    const ui = ctx?.ui;
    return ui?.setStatus ? (ui as StatusUi) : undefined;
  } catch {
    return undefined;
  }
}

// Which context a status bar paints through. Never remember a UI-less event:
// that mutes every later bare syncStatus(), freezing the bar on a stale preset.
export function paintableCtx(remembered: ExtensionCtx | undefined, next: ExtensionCtx | undefined): ExtensionCtx | undefined {
  return statusUi(next) ? next : remembered;
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
  // cannot strand a matching preset at 'custom' and drop the combo bar.
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
  // The level reflects the final triplet, never the write order, so a preset
  // entry followed by the same values reconciles back to the preset.
  return publish(normalizedState(modes));
}

// One-line session-wide mode summary for change confirmations.
export function activeModesSummary(state: { caveman: string; rtk: string; ponytail: string }): string {
  return `caveman=${state.caveman.toUpperCase()}, rtk=${state.rtk.toUpperCase()}, ponytail=${state.ponytail.toUpperCase()}`;
}

export function setSharedComboListener(listener: ((state: Readonly<ComboState>) => void) | null): void {
  // Additive: every sibling syncs its mirror on publish, so a /tersio or
  // /combo switch lands next turn with no reload. A null listener clears all.
  if (typeof listener === 'function') bridge().listeners.add(listener);
  else bridge().listeners.clear();
}

export function resetSharedComboState(): Readonly<ComboState> {
  return setSharedComboLevel('off');
}
