// Codex reaches CodeGraph through the prompt hook, so the sync has to fire without a session and never touch the hook's answer.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';
import { fakeExecutable } from '../helpers/env.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const installer = path.join(root, 'tersio.ts');

const homes: string[] = [];
afterEach(() => {
  while (homes.length > 0) {
    const home = homes.pop()!;
    rmSync(home, { recursive: true, force: true });
  }
});

/** A project with or without a map, plus a fake `tersio` on PATH whose sync appends its cwd to a probe file. */
function project(withMap: boolean): { repo: string; marker: string; dir: string; home: string } {
  const home = mkdtempSync(path.join(tmpdir(), 'tersio-codex-hook-'));
  homes.push(home);
  const repo = path.join(home, 'project');
  mkdirSync(path.join(repo, '.git'), { recursive: true });
  if (withMap) {
    mkdirSync(path.join(repo, '.codegraph'), { recursive: true });
    writeFileSync(path.join(repo, '.codegraph', 'codegraph.db'), 'map');
  }
  const dir = path.join(home, 'bin');
  const marker = path.join(home, 'sync-probe');
  fakeExecutable(dir, 'tersio', `pwd >> "$CODEGRAPH_PROBE"`);
  return { repo, marker, dir, home };
}

/** One hook run: the settings store is written first, stdin carries the prompt payload, and stdout stays machine-readable. */
function hook(
  setup: { repo: string; marker: string; dir: string; home: string },
  hosts?: unknown,
): { status: number | null; stdout: string; stderr: string } {
  if (hosts !== undefined) {
    const settings = path.join(setup.home, '.tersio', 'settings.json');
    mkdirSync(path.dirname(settings), { recursive: true });
    writeFileSync(settings, `${JSON.stringify({ hosts })}\n`, 'utf8');
  }
  const result = spawnSync(process.execPath, [installer, 'codex-hook', 'user-prompt-submit'], {
    cwd: setup.repo,
    input: `${JSON.stringify({ prompt: 'hello', cwd: setup.repo, session_id: 's1' })}\n`,
    encoding: 'utf8',
    timeout: 20000,
    env: {
      ...process.env,
      HOME: setup.home,
      TERSIO_HOME: path.join(setup.home, '.tersio'),
      CODEGRAPH_PROBE: setup.marker,
      PATH: `${setup.dir}${path.delimiter}${process.env.PATH}`,
    },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** The detached sync writes the probe only after it runs; a short poll stands in for a fixed sleep. */
async function probeText(marker: string): Promise<string> {
  for (let i = 0; i < 40; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    try {
      return readFileSync(marker, 'utf8');
    } catch {
      /* the detached sync has not run yet */
    }
  }
  return '';
}

describe('the codex codegraph sync', () => {
  test('a prompt on a mapped project syncs in the background and still answers the hook', async () => {
    const setup = project(true);
    const run = hook(setup);
    expect(run.status, run.stderr).toBe(0);
    // The hook's answer stays machine-readable: the sync must never write into stdout.
    const answer = JSON.parse(run.stdout) as Record<string, unknown>;
    expect(Object.keys(answer).length).toBeGreaterThan(0);
    expect(await probeText(setup.marker)).toContain(setup.repo);
  });

  test('a project without a map never starts one from the hook', async () => {
    const setup = project(false);
    const run = hook(setup);
    expect(run.status, run.stderr).toBe(0);
    expect(await probeText(setup.marker)).toBe('');
  });

  test('the codex switch wins: codegraph off means no sync even on a mapped project', async () => {
    const setup = project(true);
    const run = hook(setup, { codex: { codegraphDefault: 'off' } });
    expect(run.status, run.stderr).toBe(0);
    expect(await probeText(setup.marker)).toBe('');
  });
});
