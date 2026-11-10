// The Caveman `rule.md` fork: upstream's body with one adapted line, re-applied on every refresh.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { adaptCavemanFull } from '../../extensions/shared/updater.ts';

process.env.HOME = new URL('../definitely-missing-home/updater', import.meta.url).pathname;
process.env.TERSIO_HOME = process.env.HOME;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('the adaptation rewrites the one line Tersio forks', () => {
  const upstream = 'line one\n5. Anything persisted outside chat. `/caveman-compress` exempt.\nline three';
  expect(adaptCavemanFull(upstream)).toBe(
    'line one\n5. Anything persisted outside chat. `/caveman-compress`, where the host offers it, is exempt.\nline three',
  );
});

test('the adaptation is idempotent, so a refresh never compounds it', () => {
  const once = adaptCavemanFull('`/caveman-compress` exempt.');
  expect(adaptCavemanFull(once)).toBe(once);
});

test('text without the upstream sentence passes through untouched', () => {
  const other = '5. Anything persisted outside chat. `/caveman-compress`, where the host offers it, is exempt.';
  expect(adaptCavemanFull(other)).toBe(other);
  expect(adaptCavemanFull('no caveman line here')).toBe('no caveman line here');
});

// The shipped body is the fork of the current upstream, so the first update check reads up to date.
test("the bundled body carries the adapted line and not upstream's", () => {
  const body = readFileSync(path.join(ROOT, 'extensions', 'caveman', 'rule.md'), 'utf8');
  expect(body).toContain('`/caveman-compress`, where the host offers it, is exempt.');
  expect(body).not.toContain('`/caveman-compress` exempt.');
});
