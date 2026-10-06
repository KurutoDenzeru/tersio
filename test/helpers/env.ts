// Pins the pi agent vars alongside a temp HOME, so a spawned CLI cannot write
// the developer's real ~/.pi/agent — once deleted a real extension tree.
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The usage store shells out to sqlite3; tests that need it skip when it is absent. */
export function hasSqlite(): boolean {
  try {
    execSync('command -v sqlite3', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function cliEnv(home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    PI_CODING_AGENT: 'true',
    PI_CODING_AGENT_DIR: path.join(home, '.pi', 'agent'),
    ...extra,
  };
}

// TERSIO_HOME is what the settings store resolves through; HOME alone is not enough.
export function withHome<T>(fn: (home: string) => T): T {
  const home = mkdtempSync(path.join(os.tmpdir(), 'tersio-home-'));
  const previous = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, TERSIO_HOME: process.env.TERSIO_HOME };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.TERSIO_HOME = path.join(home, '.tersio');
  const cleanup = (): void => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(home, { recursive: true, force: true });
  };
  try {
    const out = fn(home);
    // An async body keeps the fake HOME until it settles.
    if (out instanceof Promise) return out.finally(cleanup) as T;
    cleanup();
    return out;
  } catch (err) {
    cleanup();
    throw err;
  }
}
