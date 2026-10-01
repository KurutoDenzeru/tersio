// The one status string every surface renders: session message, clack banner,
// dashboard banner. Nothing else formats mode state.
import { getSharedComboState } from './session-state.ts';

export interface StatusState {
  level: string;
  caveman: string;
  rtk: string;
  ponytail: string;
}

/** OFF collapses the three modes into one word; a preset or a mix names itself. */
export function formatStatus(state: StatusState): string {
  const { level, caveman, rtk, ponytail } = state;
  if (level === 'off' && caveman === 'off' && rtk === 'off' && ponytail === 'off') return '🧩 combo OFF';
  const label = level === 'custom' ? 'CUSTOM' : level.toUpperCase();
  return `🧩 combo ${label}: 🪨caveman=${caveman.toUpperCase()} ⚡rtk=${rtk.toUpperCase()} 🦥ponytail=${ponytail.toUpperCase()}`;
}

/** Read the live shared bridge, not a per-extension copy. */
export function currentStatus(): string {
  return formatStatus(getSharedComboState());
}

/**
 * Announce a status change through the host's own notice channel.
 *
 * `ui.notify` renders in the transcript and never enters the model context, so
 * this costs the session nothing. Do not route it through a message or a tool
 * result: both are billed again on every later turn.
 *
 * Dedupe is by rendered text, so a restore that fires repeatedly for an
 * unchanged state stays silent.
 */
export function announceStatus(ctx: { ui?: { notify?: (message: string, level?: string) => void } } | undefined, lastSent: { value: string }): void {
  const text = currentStatus();
  if (lastSent.value === text) return;
  lastSent.value = text;
  ctx?.ui?.notify?.(text, 'info');
}