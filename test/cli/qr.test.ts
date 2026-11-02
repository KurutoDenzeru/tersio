import { describe, expect, test } from 'vitest';
import { qrMatrix, qrTerminal } from '../../cli/qr.ts';

// The LAN card is scanned from a phone; a wrong symbol size or a dropped quiet zone makes it useless.
describe('dashboard QR', () => {
  test('picks the smallest version the URL fits', () => {
    expect(qrMatrix('A')?.length).toBe(21);
    expect(qrMatrix('http://192.168.8.155:61290')?.length).toBe(25);
    expect(qrMatrix('x'.repeat(106))?.length).toBe(41);
    expect(qrMatrix('x'.repeat(107))).toBeNull();
  });

  test('the terminal form keeps a quiet zone and half-block rows', () => {
    const rendered = qrTerminal('A');
    expect(rendered).not.toBeNull();
    const lines = rendered!.split('\n');
    expect(lines).toHaveLength(15);
    expect(lines[0]).toContain('\x1b[30;47m');
    expect(lines[0]?.endsWith('\x1b[0m')).toBe(true);
    expect(rendered).toContain('\u2588');
  });

  test('the terminal glyphs rebuild the module grid', () => {
    for (const text of ['A', 'http://192.168.8.155:61290']) {
      const rendered = qrTerminal(text)!;
      const expected = qrMatrix(text)!;
      const size = expected.length + 8;
      const cells = rendered.split('\n').map((line) => line.replace(/^\x1b\[30;47m/, '').replace(/\x1b\[0m$/, ''));
      expect(cells[0]?.length).toBe(size);
      const rebuilt = Array.from({ length: size }, () => Array.from({ length: size }, () => false));
      cells.forEach((line, index) => {
        for (let col = 0; col < size; col += 1) {
          const glyph = line[col];
          rebuilt[index * 2][col] = glyph === '\u2588' || glyph === '\u2580';
          if (index * 2 + 1 < size) rebuilt[index * 2 + 1][col] = glyph === '\u2588' || glyph === '\u2584';
        }
      });
      // The quiet zone stays white, and the code itself matches the matrix the glyphs came from.
      for (let i = 0; i < size; i += 1) {
        expect([rebuilt[3][i], rebuilt[i][3], rebuilt[size - 4][i], rebuilt[i][size - 4]].every((v) => !v)).toBe(true);
      }
      expect(rebuilt.slice(4, 4 + expected.length).map((row) => row.slice(4, 4 + expected.length))).toEqual(expected);
    }
  });
});
