// A status line pinned to the bottom terminal row while a Clack prompt owns
// the screen. Clack redraws its own frame on every keystroke, so the banner is
// a separate writer that parks itself below the cursor rather than a prompt
// line: it survives every render() because Clack never touches those rows.
import { getColumns, getRows } from '@clack/core';
import type { Writable } from 'node:stream';
// Absolute row addressing beats relative motion: the cursor can be anywhere,
// and only `rows;1H` lands on the final row every time.
const LAST_ROW = (rows: number): string => `\x1b[${rows};1H`;
const SAVE_CURSOR = '\x1b7';
const RESTORE_CURSOR = '\x1b8';
const ERASE_ROW = '\x1b[2K';

export interface StickyBannerOptions {
  output: Writable;
  /** Refresher run on resize, so a re-wrapped line is redrawn. */
  getStatus: () => string;
}

/**
 * Draws `getStatus()` as the final terminal line and keeps it there.
 *
 * Clack writes its frame to the cursor position, so the banner is rewritten
 * after every frame it emits. `restore()` puts the cursor back where the user
 * left it, so a following prompt does not start one row too high.
 */
export class StickyBanner {
  private readonly output: Writable;
  private readonly getStatus: () => string;
  private lastDrawn = '';
  private onResize?: () => void;

  constructor(options: StickyBannerOptions) {
    this.output = options.output;
    this.getStatus = options.getStatus;
  }

  /**
   * Terminal columns a string occupies. Emoji in this line are double-width,
   * and zero-width joiners and variation selectors occupy nothing, so a plain
   * `String.length` over-counts and lets the line wrap off the last row.
   */
  static width(text: string): number {
    let total = 0;
    for (const ch of text) {
      const code = ch.codePointAt(0) ?? 0;
      if (code === 0x200d || code === 0xfe0f || code === 0xfe0e) continue;
      if (code >= 0x1f300 && code <= 0x1faff) { total += 2; continue; }
      if (code >= 0x2600 && code <= 0x27bf) { total += 2; continue; }
      total += 1;
    }
    return total;
  }

  /** The line as it should appear, truncated to the terminal width. */
  text(): string {
    const width = Math.max(2, getColumns(this.output));
    const status = this.getStatus();
    if (StickyBanner.width(status) <= width) return status;
    let out = '';
    let used = 0;
    // Reserve one column for the ellipsis so the result never wraps.
    for (const ch of status) {
      const w = StickyBanner.width(ch);
      if (used + w > width - 1) break;
      out += ch;
      used += w;
    }
    return out + '…';
  }

  /**
   * Draw on the final row, then put the cursor back where the user left it.
   *
   * The row above is erased too: when Clack's own frame overflows, it scrolls
   * and leaves a fragment on the second-to-last row, which would otherwise
   * outlive the banner.
   */
  draw(): void {
    const rows = Math.max(2, getRows(this.output));
    const line = this.text();
    this.write(`${SAVE_CURSOR}${LAST_ROW(rows - 1)}${ERASE_ROW}${LAST_ROW(rows)}${ERASE_ROW}${line}${RESTORE_CURSOR}`);
    this.lastDrawn = line;
  }

  /** Redraw only when the text changed; Clack calls render far more often. */
  refresh(): void {
    if (this.text() === this.lastDrawn) return;
    this.draw();
  }

  /** Clear the banner and hand the rows back to the shell. */
  restore(): void {
    const rows = Math.max(2, getRows(this.output));
    this.write(`${LAST_ROW(rows - 1)}${ERASE_ROW}${LAST_ROW(rows)}${ERASE_ROW}`);
    this.lastDrawn = '';
  }

  /** Redraw when the terminal is resized, so wrapping cannot leave debris. */
  watchResize(): void {
    this.onResize = () => this.refresh();
    process.stdout.on('resize', this.onResize);
  }

  unwatchResize(): void {
    if (!this.onResize) return;
    process.stdout.off('resize', this.onResize);
    this.onResize = undefined;
  }

  private write(text: string): void {
    this.output.write(text);
  }
}

/** The banner for `tersio` prompts, or undefined when there is no terminal. */
export function bannerFor(output: Writable | undefined, getStatus: () => string): StickyBanner | undefined {
  if (!output || !process.stdin.isTTY || !process.stdout.isTTY) return undefined;
  return new StickyBanner({ output, getStatus });
}