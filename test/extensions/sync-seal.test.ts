import { describe, expect, test } from 'vitest';
import { open, seal } from '../../extensions/shared/sync-seal.ts';

describe('sealed backups', () => {
  test('a sealed file opens with the same passphrase', () => {
    const body = Buffer.from('usage ledger and settings');
    const sealed = seal(body, 'correct horse');
    expect(sealed.subarray(0, 7).toString()).toBe('TSYNC1\n');
    expect(open(sealed, 'correct horse').equals(body)).toBe(true);
    // Two seals of one body differ: a fresh salt and IV each time.
    expect(seal(body, 'correct horse').equals(sealed)).toBe(false);
  });

  test('a wrong passphrase fails the tag instead of returning bytes', () => {
    const sealed = seal(Buffer.from('secret'), 'right');
    expect(() => open(sealed, 'wrong')).toThrow(/passphrase does not open|damaged/);
  });

  test('a damaged or foreign file is named as such', () => {
    expect(() => open(Buffer.from('not a backup'), 'x')).toThrow(/not a sealed Tersio backup/);
    const sealed = seal(Buffer.from('payload'), 'pass');
    const broken = Buffer.from(sealed);
    broken[broken.length - 1] ^= 0xff;
    expect(() => open(broken, 'pass')).toThrow(/passphrase does not open|damaged/);
  });

  test('an empty passphrase is refused on both sides', () => {
    expect(() => seal(Buffer.from('x'), '   ')).toThrow(/passphrase is required/);
    const sealed = seal(Buffer.from('x'), 'pass');
    expect(() => open(sealed, ' ')).toThrow(/passphrase is empty/);
  });
});
