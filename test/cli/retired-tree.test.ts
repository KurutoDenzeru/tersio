import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { isObsoleteTreeFile, reapObsoleteTreeDirs } from '../../cli/manifest.ts';
import { withHome } from '../helpers/env.ts';

test('install cleanup removes the retired WordPress resolver and preserves neighboring graph extensions', async () => {
  await withHome(async (home) => {
    const dir = path.join(home, 'extensions', 'codegraph');
    mkdirSync(dir, { recursive: true });
    const retired = path.join(dir, 'wordpress-resolver.ts');
    const custom = path.join(dir, 'user-resolver.ts');
    writeFileSync(retired, 'retired managed extension');
    writeFileSync(custom, 'user extension');
    expect(isObsoleteTreeFile('codegraph/wordpress-resolver.ts', 'omp')).toBe(true);
    await reapObsoleteTreeDirs(path.dirname(dir), { dryRun: true });
    expect(existsSync(retired)).toBe(true);
    await reapObsoleteTreeDirs(path.dirname(dir), {});
    expect(existsSync(retired)).toBe(false);
    expect(readFileSync(custom, 'utf8')).toBe('user extension');
  });
});

test('install cleanup removes retired routing files without removing neighboring user files', async () => {
  await withHome(async (home) => {
    const dir = path.join(home, 'extensions', 'routing');
    mkdirSync(dir, { recursive: true });
    const retired = ['index.ts', 'omp.ts', 'stage-router.ts', 'task-router.ts'];
    for (const file of retired) writeFileSync(path.join(dir, file), 'retired extension');
    const custom = path.join(dir, 'custom.ts');
    writeFileSync(custom, 'user extension');
    await reapObsoleteTreeDirs(path.dirname(dir), {});
    for (const file of retired) expect(existsSync(path.join(dir, file))).toBe(false);
    expect(readFileSync(custom, 'utf8')).toBe('user extension');
  });
});

// codegraph hooks was removed with its implementation; an installed tree from an older build keeps the file
// until the reaper names it, so the name has to be on the list or every upgraded machine carries dead code.
test('install cleanup removes the retired codegraph git-hooks helper alone', async () => {
  await withHome(async (home) => {
    const dir = path.join(home, 'extensions', 'codegraph');
    mkdirSync(dir, { recursive: true });
    const retired = path.join(dir, 'git-hooks.ts');
    writeFileSync(retired, 'retired helper');
    const live = path.join(dir, 'shared.ts');
    writeFileSync(live, 'live engine');
    expect(isObsoleteTreeFile('codegraph/git-hooks.ts', 'omp')).toBe(true);
    await reapObsoleteTreeDirs(path.dirname(dir), {});
    expect(existsSync(retired)).toBe(false);
    expect(readFileSync(live, 'utf8')).toBe('live engine');
  });
});
