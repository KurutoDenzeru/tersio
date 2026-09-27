// extensions/pi/shared/session-state.ts — Pi's view of the shared mode state.
//
// The state machine itself is host-free and lives in extensions/shared/. What
// differs on Pi is how an extension reads and writes it:
//
//   - Persistence is identical. `pi.appendEntry` writes the same custom entries
//     OMP does, and `ctx.sessionManager.getBranch()` returns the same shape, so
//     the same reconciliation and last-wins scan work unchanged.
//   - The prompt surface is not. Pi's before_agent_start carries a rendered
//     read-only string plus mutable `systemPromptOptions.sections`, so a mode
//     injects by writing its own section rather than by returning a replacement
//     prompt.
//   - There is no `session_branch`. Pi documents session_start, session_tree,
//     session_before_fork, and session_before_switch; the mode restore hooks
//     session_start and session_tree, which are the two that fire when the
//     active conversation changes.
//
// The bridge is a process-global symbol, not `pi.events`. Extensions in one Pi
// process share one JS realm, so the same bridge gives the sibling mirrors OMP
// relies on; pi.events is a message bus and would turn a synchronous read into
// an async handshake on every turn.
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

/**
 * Writes one extension's mode text into the turn's prompt.
 *
 * Each port owns exactly one section, so two extensions never overwrite each
 * other's text and a single one clearing its own section leaves the rest of the
 * prompt alone. Fails open: a turn that cannot be decorated still runs.
 *
 * Falsy content is omitted by Pi, so an empty string switches that mode off
 * without leaving a blank section in the prompt.
 */
export function injectPiSection(
  event: { systemPromptOptions?: { sections?: Record<string, unknown> } | null } | null | undefined,
  section: string,
  text: string,
): void {
  const sections = event?.systemPromptOptions?.sections;
  if (!sections || typeof sections !== 'object') return;
  sections[section] = text;
}

/**
 * Guarded notify, for a host with no UI (print and JSON modes, and a
 * headless child session). Without the guard a mode switch in a non-TUI run
 * threw and took the command handler with it.
 */
export function notify(ctx: ExtensionCtx | undefined, message: string, level: 'info' | 'warning' = 'info'): void {
  ctx?.ui?.notify?.(message, level);
}

export type { ExtensionCtx };
