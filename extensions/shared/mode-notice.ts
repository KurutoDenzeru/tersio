// Desktop hosts have no status bar, so a mode change is a chat message the agent answers; DeepSeek Harness is the reference.

/** The same glyphs every Tersio status line uses, in the order the modes are read. */
export const MODE_GLYPHS = {
  caveman: '🪨',
  rtk: '🗜️',
  ponytail: '🧠',
  pstack: '🥔',
  headroom: '🍃',
} as const;

export interface ModeSnapshot {
  caveman: string;
  rtk: boolean;
  ponytail: string;
  pstack: string | boolean;
  headroom: string;
}

/** One line naming every mode, so a desktop host and a status bar cannot disagree. */
export function formatModeLine(modes: ModeSnapshot): string {
  const pstack = modes.pstack === true || modes.pstack === 'on' ? 'on' : 'off';
  return [
    `${MODE_GLYPHS.caveman} caveman=${modes.caveman}`,
    `${MODE_GLYPHS.rtk} rtk=${modes.rtk ? 'on' : 'off'}`,
    `${MODE_GLYPHS.ponytail} ponytail=${modes.ponytail}`,
    `${MODE_GLYPHS.pstack} pstack=${pstack}`,
    `${MODE_GLYPHS.headroom} headroom=${modes.headroom}`,
  ].join(' · ');
}

// The message a desktop host sends after a mode change; the one-line ask keeps the assistant's reply short.
export function buildModeNotice(label: string, modes: ModeSnapshot): string {
  return `${label} — ${formatModeLine(modes)}. Confirm in one short line.`;
}
