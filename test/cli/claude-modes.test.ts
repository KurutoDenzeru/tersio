// Guards the slash-command output: one line, no write path, and a combo label that admits a hand-set mode.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { runModes } from '../../cli/modes.ts';
import { saveHostDefaults, storedProfile } from '../../cli/profile.ts';

const savedHome = process.env.HOME;
const savedTersioHome = process.env.TERSIO_HOME;

afterEach(() => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedTersioHome === undefined) delete process.env.TERSIO_HOME;
  else process.env.TERSIO_HOME = savedTersioHome;
});

describe('Claude mode output', () => {
  test('a host override equal to the shared value is removed, not left stale', async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'tersio-host-modes-'));
    process.env.HOME = home;
    process.env.TERSIO_HOME = path.join(home, '.tersio');
    mkdirSync(process.env.TERSIO_HOME, { recursive: true });
    const file = path.join(process.env.TERSIO_HOME, 'settings.json');
    writeFileSync(
      file,
      JSON.stringify({
        headroomDefault: 'off',
        cavemanDefault: 'off',
        hosts: { claude: { headroomDefault: 'on' } },
      }),
      'utf8',
    );
    const profile = await storedProfile('claude');
    expect(profile.headroomDefault).toBe('on');
    await saveHostDefaults('claude', ['headroomDefault'], { ...profile, headroomDefault: 'off' }, { quiet: true });
    const stored = JSON.parse(readFileSync(file, 'utf8')) as {
      hosts?: Record<string, { headroomDefault?: string }>;
    };
    expect(stored.hosts?.claude?.headroomDefault).toBeUndefined();
    expect((await storedProfile('claude')).headroomDefault).toBe('off');
  });

  test('one line, no [write], and a custom combo label', async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'tersio-modes-'));
    process.env.HOME = home;
    process.env.TERSIO_HOME = path.join(home, '.tersio');
    mkdirSync(process.env.TERSIO_HOME, { recursive: true });
    writeFileSync(
      path.join(process.env.TERSIO_HOME, 'settings.json'),
      JSON.stringify({
        hosts: {
          claude: {
            comboDefault: 'lite',
            cavemanDefault: 'lite',
            rtkDefault: true,
            ponytailDefault: 'lite',
            pstackDefault: 'off',
            headroomDefault: 'on',
          },
        },
      }),
      'utf8',
    );
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    };
    try {
      await runModes(['caveman', 'full', '--host', 'claude']);
    } finally {
      console.log = original;
    }
    expect(lines).toEqual([
      'Session defaults for claude saved: combo=custom (caveman=full · rtk=on · ponytail=lite · pstack=off · headroom=on)',
    ]);
  });
});
