// Shared temp-HOME harness. Installer and wiring tests all need the same three
// things: a throwaway home, HOME pointed at it, and cleanup afterwards.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const installer = path.join(repoRoot, "tersio.js");

/** Creates a throwaway home. Pair with `withHome` or `runTersio`. */
export function tempHome(prefix = "tersio-test-"): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function removeHome(home: string): void {
  rmSync(home, { recursive: true, force: true });
}

/**
 * Points HOME and USERPROFILE at `home` for the duration of `work`.
 * Needed because the wiring modules read the env at call time, not at import.
 */
export async function withHome<T>(home: string, work: () => Promise<T> | T): Promise<T> {
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    return await work();
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** Runs the real CLI with HOME pointed at `home`. */
export function runTersio(home: string, argv: string[], timeout = 120000): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [installer, ...argv], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout,
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
}
