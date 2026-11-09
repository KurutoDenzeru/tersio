import { expect, test } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { withHome } from '../helpers/env.ts';
import { configEntries, defaultProfile, saveHostDefaults, writePluginSettings } from '../../cli/profile.ts';

function store(home: string, settings: unknown): string {
  const dir = path.join(home, '.tersio');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'settings.json');
  writeFileSync(file, JSON.stringify(settings), 'utf8');
  return file;
}
const row = (host: 'omp' | 'pi' | 'pig', key: string) => configEntries(host).find((entry) => entry.key === key);

test("the shared store names each value's source, and inherit clears an override", async () => {
  await withHome(async (home) => {
    const file = store(home, {
      comboDefault: 'balanced',
      cavemanDefault: 'full',
      hosts: { omp: { comboDefault: 'lite' }, pi: { comboDefault: 'inherit' }, pig: { cavemanDefault: 'nonsense' } },
    });
    expect(row('omp', 'comboDefault')).toMatchObject({ value: 'lite', source: 'override' });
    expect(row('omp', 'cavemanDefault')).toMatchObject({ value: 'full', source: 'inherited' });
    expect(row('pi', 'comboDefault'), 'explicit inherit reads the shared store').toMatchObject({
      value: 'balanced',
      source: 'inherited',
    });
    expect(row('pig', 'cavemanDefault'), 'an invalid value never reads as a real choice').toMatchObject({
      value: 'full',
      source: 'invalid',
    });

    await saveHostDefaults(
      'omp',
      ['comboDefault'],
      { ...defaultProfile(), comboDefault: 'inherit' },
      { dryRun: false, quiet: true, verbose: false },
    );
    expect(
      (JSON.parse(readFileSync(file, 'utf8')) as { hosts?: Record<string, Record<string, unknown>> }).hosts?.omp
        ?.comboDefault,
    ).toBeUndefined();
    expect(row('omp', 'comboDefault')?.source).toBe('inherited');

    await writePluginSettings(
      { ...defaultProfile(), comboDefault: 'inherit' },
      { dryRun: false, quiet: true, verbose: false },
    );
    expect(
      (JSON.parse(readFileSync(file, 'utf8')) as { comboDefault?: string }).comboDefault,
      'the shared store never holds inherit',
    ).toBe('balanced');
  });
});
