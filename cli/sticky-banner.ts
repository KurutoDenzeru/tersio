// A status line pinned to the terminal's last row. Clack never draws there, so
// it survives every frame; the banner repaints itself after each one.
import { getColumns, getRows } from '@clack/core';
import type { Writable } from 'node:stream';

// Absolute row addressing: the cursor can be anywhere, and only `rows;1H` lands
// on the final row every time.
const LAST_ROW = (rows: number): string => `\x1b[${rows};1H`;
const SAVE_CURSOR = '\x1b7';
const RESTORE_CURSOR = '\x1b8';
const ERASE_ROW = '\x1b[2K';

/** Columns a string occupies: emoji are double-width, joiners and variation selectors none. */
function displayWidth(text: string): number {
  let total = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0x200d || code === 0xfe0f || code === 0xfe0e) continue;
    if ((code >= 0x1f300 && code <= 0x1faff) || (code >= 0x2600 && code <= 0x27bf)) { total += 2; continue; }
    total += 1;
  }
  return total;
}

/** Truncate to the terminal width, reserving a column for the ellipsis. */
function fit(text: string, width: number): string {
  if (displayWidth(text) <= width) return text;
  let out = '';
  let used = 0;
  for (const ch of text) {
    const w = displayWidth(ch);
    if (used + w > width - 1) break;
    out += ch;
    used += w;
  }
  return `${out}…`;
}

export class StickyBanner {
  private lastDrawn = '';
  private onResize?: () => void;

  constructor(private readonly output: Writable, private readonly getStatus: () => string) {}

  private line(): string {
    return fit(this.getStatus(), Math.max(2, getColumns(this.output)));
  }

  // Erases the row above too: an overflowing Clack frame scrolls and leaves a
  // fragment there, which would otherwise outlive the banner.
  draw(): void {
    const rows = Math.max(2, getRows(this.output));
    const at = `${LAST_ROW(rows - 1)}${ERASE_ROW}${LAST_ROW(rows)}${ERASE_ROW}`;
    this.output.write(`${SAVE_CURSOR}${at}${this.line()}${RESTORE_CURSOR}`);
    this.lastDrawn = this.getStatus();
  }

  /** Clack writes far more often than the line changes. */
  refresh(): void {
    if (this.getStatus() === this.lastDrawn) return;
    this.draw();
  }

  restore(): void {
    const rows = Math.max(2, getRows(this.output));
    this.output.write(`${LAST_ROW(rows - 1)}${ERASE_ROW}${LAST_ROW(rows)}${ERASE_ROW}`);
    this.lastDrawn = '';
  }

  watchResize(): void {
    this.onResize = () => this.refresh();
    process.stdout.on('resize', this.onResize);
  }

  unwatchResize(): void {
    if (!this.onResize) return;
    process.stdout.off('resize', this.onResize);
    this.onResize = undefined;
  }
}

/** The banner for `tersio` prompts, or undefined when there is no terminal. */
export function bannerFor(output: Writable, getStatus: () => string): StickyBanner | undefined {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return undefined;
  return new StickyBanner(output, getStatus);
}