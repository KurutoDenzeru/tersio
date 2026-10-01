// The one status string every surface renders: session message, CLI menu
// title, dashboard banner. Nothing else formats mode state.
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

// `ui.notify` stays out of the model context; a message or tool result would be
// billed again on every later turn.
export function announceStatus(ctx: { ui?: { notify?: (message: string, level?: string) => void } } | undefined, lastSent: { value: string }): void {
  // Dedupe by rendered text: a restore can fire repeatedly for one state.
  const text = formatStatus(getSharedComboState());
  if (lastSent.value === text) return;
  lastSent.value = text;
  ctx?.ui?.notify?.(text, 'info');
}