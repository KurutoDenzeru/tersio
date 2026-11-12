// An import target must be git-tracked, not merely on disk, or a fresh checkout fails at `tsc`.
import { expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function trackedFiles(): Set<string> {
  const result = spawnSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' });
  expect(result.status, `git ls-files failed: ${result.stderr}`).toBe(0);
  return new Set(
    result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

function stripComments(body: string): string {
  return body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function relativeSpecs(body: string): string[] {
  const specs: string[] = [];
  const clean = stripComments(body);
  for (const re of [
    /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/g,
    /import\s*['"]([^'"]+)['"]/g,
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]) {
    for (const match of clean.matchAll(re)) specs.push(match[1]);
  }
  return specs.filter((spec) => spec.startsWith('.'));
}

// Compiled .js is gitignored, so tracked sources are always .ts; a Vite `?raw` query still names its file.
function candidates(source: string, spec: string): string[] {
  const bare = spec.replace(/\?.*$/, '');
  const stem = path.posix.join(path.posix.dirname(source), bare);
  if (/\.(svg|png|webp|css|json)$/.test(bare)) return [stem];
  const noExt = stem.replace(/\.(ts|tsx|js|jsx)$/, '');
  return [`${noExt}.ts`, `${noExt}.tsx`, `${noExt}/index.ts`];
}

test('tracked sources only import git-tracked files', () => {
  const tracked = trackedFiles();
  const sources = [...tracked].filter((file) => file.endsWith('.ts') && existsSync(path.join(root, file))).toSorted();
  expect(sources.length > 0, 'expected tracked .ts sources').toBeTruthy();
  const violations: string[] = [];
  for (const source of sources) {
    const body = readFileSync(path.join(root, source), 'utf8');
    for (const spec of new Set(relativeSpecs(body))) {
      if (!candidates(source, spec).some((file) => tracked.has(file))) {
        violations.push(`${source} -> ${spec}`);
      }
    }
  }
  expect(
    violations,
    `tracked sources reference files that are not committed — a fresh clone fails at tsc. ` +
      `Commit the targets or fix the imports:\n${violations.join('\n')}`,
  ).toEqual([]);
});

// A spawn spreading process.env and overriding HOME still writes the real ~/.pi/agent; cliEnv() pins both.
function gitTsFiles(): string[] {
  return [...trackedFiles()].filter((f) => f.endsWith('.ts'));
}

test('no test spawns the CLI with process.env and an overridden HOME', () => {
  const offenders: string[] = [];
  for (const file of gitTsFiles().filter((f) => f.startsWith('test/') && f !== 'test/setup.ts')) {
    for (const [i, line] of readFileSync(path.join(root, file), 'utf8').split('\n').entries()) {
      if (!line.includes('...process.env')) continue;
      if (/\bHOME\b/.test(line) && !line.includes('cliEnv')) offenders.push(`${file}:${i + 1}`);
    }
  }
  expect(offenders, `use cliEnv() from test/helpers/env.ts:\n${offenders.join('\n')}`).toEqual([]);
});

// `opencode plugin add` resolves the server entrypoint through exports["./server"].
test('package exports a loadable opencode server entrypoint', () => {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
    exports?: Record<string, string>;
  };
  const entry = pkg.exports?.['./server'];
  expect(entry, 'exports["./server"] must exist for `opencode plugin add`').toBeDefined();
  // The export points at gitignored dist/ output; its tracked source is the .ts beside it.
  const tracked = (entry as string)
    .replace(/^\.\//, '')
    .replace(/^dist\//, '')
    .replace(/\.js$/, '.ts');
  expect(existsSync(path.join(root, tracked)), `${tracked} must exist for a fresh checkout`).toBe(true);
});

// A native Claude Code install reads the repo root marketplace, so the shipped package must carry both.
test('the git marketplace points at the Claude plugin and ships in the package', () => {
  const market = JSON.parse(readFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), 'utf8')) as {
    plugins?: Array<{ name?: string; source?: string }>;
  };
  const entry = market.plugins?.find((plugin) => plugin.name === 'tersio');
  expect(entry?.source, '.claude-plugin/marketplace.json must name the tersio plugin source').toBe('./plugins/claude');
  expect(existsSync(path.join(root, 'plugins', 'claude', '.claude-plugin', 'plugin.json'))).toBe(true);
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { files?: string[] };
  expect(pkg.files, 'package.json files must carry the marketplace for a GitHub repo install').toContain(
    '.claude-plugin/**/*',
  );
});

// `pi` manifest (prevents fallback to `extensions/*.ts` -> error "does not export a valid factory function")
test('package declares a pi manifest that omits the OpenCode entry', () => {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
    pi?: { extensions?: string[]; skills?: string[] };
  };
  const entries = pkg.pi?.extensions;
  expect(entries, 'pi.extensions must exist so pi does not conventionally discover extensions/').toBeDefined();
  expect(entries, 'the OpenCode entry must not be a pi extension').not.toContain('./extensions/server.ts');
  const missing = (entries as string[]).filter((e) => !existsSync(path.join(root, e.slice(2))));
  expect(missing, `declared pi extensions must exist:\n${missing.join('\n')}`).toEqual([]);
  // Without a skills entry pi offers no skill bodies at all, so the Ponytail skills would ship unread.
  const skills = pkg.pi?.skills;
  expect(skills, 'pi.skills must exist so the bundled skills reach a pi install').toBeDefined();
  const skillDirs = (skills as string[]).flatMap((s) => {
    const dir = path.join(root, s.slice(2));
    if (!existsSync(dir)) return [dir];
    return readdirSync(dir)
      .filter((n) => existsSync(path.join(dir, n, 'SKILL.md')))
      .map((n) => path.join(dir, n));
  });
  expect(skillDirs.length, 'at least one skill body must resolve under pi.skills').toBeGreaterThan(0);
});

// tsc emits 0644, so a build that forgets the chmod leaves the npm bin link unrunnable ("permission denied").
// Windows has no POSIX mode bits, so there is no execute bit to check there.
test.skipIf(process.platform === 'win32')('the built bin keeps its execute bit', () => {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { bin?: Record<string, string> };
  const target = path.join(root, pkg.bin?.tersio ?? '');
  if (!existsSync(target)) return; // dist/ is gitignored; `verify` builds before it tests
  expect(statSync(target).mode & 0o111, `${pkg.bin?.tersio} is not executable — build must chmod it`).toBeTruthy();
});

// Recharts animates in JS on mount, so a byte comparison of two captures drifts; the entrance stays off.
test('no dashboard chart re-enables a recharts entrance animation', () => {
  const offenders: string[] = [];
  for (const file of trackedFiles()) {
    if (!file.startsWith('dashboard/app/src/') || !/\.tsx?$/.test(file)) continue;
    const body = readFileSync(path.join(root, file), 'utf8');
    if (/isAnimationActive=\{true\}/.test(body) || /isAnimationActive=\{!false\}/.test(body)) {
      offenders.push(file);
    }
  }
  expect(
    offenders,
    `set isAnimationActive={false}; a JS entrance animation moves the chart ` +
      `between two captures of the same page:\n${offenders.join('\n')}`,
  ).toEqual([]);
});
