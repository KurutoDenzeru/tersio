// Guards the slash-command output: one line, no write path, and a combo label that admits a hand-set mode.
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, test} from 'vitest';
import {runModes} from '../../cli/modes.ts';
import {saveHostDefaults, storedProfile} from '../../cli/profile.ts';

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
      'Session defaults for claude saved: combo=custom (caveman=full · rtk=on · ponytail=lite · pstack=off · headroom=on) · codegraph=on · codegraph sync=live',
    ]);
  });
});
test('CodeGraph mode is limited to hosts that load its extension', async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'tersio-codegraph-hosts-'));
  process.env.HOME = home;
  const tersioHome = path.join(home, '.tersio');
  process.env.TERSIO_HOME = tersioHome;
  const settingsFile = path.join(tersioHome, 'settings.json');
  const oldLog = console.log;
  const oldError = console.error;
  const oldExitCode = process.exitCode;
  const errors: string[] = [];
  console.log = () => { };
  console.error = (...args: unknown[]) => errors.push(args.map(String).join(' '));
  try {
    mkdirSync(tersioHome, { recursive: true });
    for (const host of ['omp', 'pi', 'pig', 'opencode']) {
      writeFileSync(settingsFile, '{}', 'utf8');
      process.exitCode = 0;
      await runModes(['codegraph', 'off', '--host', host]);
      expect(process.exitCode).toBe(0);
      expect(JSON.parse(readFileSync(settingsFile, 'utf8'))).toMatchObject({
        hosts: { [host]: { codegraphDefault: 'off' } },
      });
    }
    for (const host of ['dsh', 'codex', 'claude']) {
      writeFileSync(settingsFile, '{}', 'utf8');
      errors.length = 0;
      process.exitCode = 0;
      await runModes(['codegraph', 'on', '--host', host]);
      expect(process.exitCode).toBe(1);
      expect(errors).toEqual([`[fail] codegraph is not supported for ${host}`]);
      expect(readFileSync(settingsFile, 'utf8')).toBe('{}');
    }

    process.exitCode = 0;
    await runModes(['codegraph', 'status', '--host', 'codex']);
    expect(process.exitCode).toBe(1);
    expect(errors.at(-1)).toBe('[fail] codegraph is not supported for codex');
  } finally {
    console.log = oldLog;
    console.error = oldError;
    process.exitCode = oldExitCode;
    rmSync(home, { recursive: true, force: true });
  }
});
