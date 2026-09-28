// Pi's view of the host-free mode state in extensions/shared/. Persistence is
// identical to OMP's (same entries, same branch shape), so only the prompt
// surface differs: a mode writes its own sealed section rather than returning a
// replacement prompt. The bridge is a process-global symbol, not `pi.events`:
// extensions share one JS realm, and a message bus would turn every turn into an
// async handshake.
import {
  COMBO_LEVELS,
  activeModesSummary,
  getSharedComboState,
  isComboPresetActive,
  lastCustomValue,
  normalizeComboLevel,
  normalizeInputCommand,
  normalizeMode,
  paintableCtx,
  paintStatusBar,
  reconcileSharedComboEntries,
  sessionEntries,
  setSharedComboLevel,
  setSharedComboListener,
  setSharedComboMode,
} from '../shared/session-state.ts';
import type { ExtensionCtx } from './pi-types.ts';

export {
  COMBO_LEVELS,
  activeModesSummary,
  getSharedComboState,
  isComboPresetActive,
  lastCustomValue,
  normalizeComboLevel,
  normalizeInputCommand,
  normalizeMode,
  paintableCtx,
  paintStatusBar,
  reconcileSharedComboEntries,
  sessionEntries,
  setSharedComboLevel,
  setSharedComboListener,
  setSharedComboMode,
};

// One section per extension, so two never overwrite each other. Fails open, and
// falsy content is omitted by Pi, so '' switches the mode off.
export function injectPiSection(
  event: { systemPromptOptions?: { sections?: Record<string, unknown> } | null } | null | undefined,
  section: string,
  text: string,
): void {
  const sections = event?.systemPromptOptions?.sections;
  if (!sections || typeof sections !== 'object') return;
  sections[section] = text;
}

// Guarded: a mode switch in a non-TUI run must not throw and take the handler.
export function notify(ctx: ExtensionCtx | undefined, message: string, level: 'info' | 'warning' = 'info'): void {
  ctx?.ui?.notify?.(message, level);
}

export type { ExtensionCtx };
