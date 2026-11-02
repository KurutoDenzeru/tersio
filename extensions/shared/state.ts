// One state row in the usage ledger: reset watermark, update check, rtk heads, and the doctor report. Each key migrates from its old file.
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { cacheGet, cachePut } from './cache-store.ts';
import { tersioHome } from './utils.ts';

export interface TersioState {
  reset?: number;
  /** The newest release any source named, its source, and the registry's own tag. */
  updateCheck?: { latest?: string; source?: 'npm' | 'github'; npm?: string | null; lastCheck?: number };
  /** The upstream release the installed Caveman body came from, so a newer body is traceable. */
  cavemanUpstream?: { tag: string; at: number };
  /** Cadence of the dashboard's background check. Off leaves it to an explicit click. */
  updateSchedule?: 'off' | 'daily' | 'weekly' | 'monthly';
  /** A release the operator skipped, so the prompt stops naming it. */
  updateSkip?: string;
  /** Epoch ms until which the prompt stays hidden. */
  updateSnoozeUntil?: number;
  rtkEligible?: { version?: string; heads?: string[]; sig?: string };
  diag?: unknown;
}

const STATE_KEY = 'state';

/** The loose file an older build wrote; kept for the one-time import below. */
export function tersioStateFile(): string {
  return path.join(tersioHome(), 'state.json');
}

/** The state row, importing the old file and then removing it, so the data home keeps no copy. */
function current(): TersioState {
  const text = cacheGet(STATE_KEY);
  if (text !== null) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as TersioState;
    } catch { /* a damaged row reads empty */ }
    return {};
  }
  try {
    const raw = readFileSync(tersioStateFile(), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      cachePut(STATE_KEY, raw);
      rmSync(tersioStateFile(), { force: true });
      return parsed as TersioState;
    }
  } catch { /* none yet */ }
  return {};
}

let migrated = false;

/** Fold the old loose files into the state row once, and delete the two with no reader left. */
function migrateLegacy(): void {
  if (migrated) return;
  migrated = true;
  const home = tersioHome();
  const pick = <T>(name: string, parse: (raw: string) => T | null): T | null =>
    takeLegacy(path.join(home, name), parse);
  const reset = pick('reset.json', (raw) => {
    const parsed = JSON.parse(raw) as { ts?: unknown };
    const ts = parsed.ts;
    return typeof ts === 'number' && Number.isFinite(ts) && ts > 0 ? ts : null;
  });
  const updateCheck = pick('update-check.json', (raw) => {
    const parsed = JSON.parse(raw) as TersioState['updateCheck'] | null;
    return parsed ?? null;
  });
  const rtkEligible = pick('rtk-eligible.json', (raw) => {
    const parsed = JSON.parse(raw) as TersioState['rtkEligible'] | null;
    return parsed ?? null;
  });
  const diag = pick('diag.json', (raw) => JSON.parse(raw) as unknown);
  const patch: Partial<TersioState> = {};
  if (reset !== null) patch.reset = reset;
  if (updateCheck) patch.updateCheck = updateCheck;
  if (rtkEligible) patch.rtkEligible = rtkEligible;
  if (diag) patch.diag = diag;
  // Both are orphaned: no writer and no reader remain in this build.
  for (const dead of ['agents.json', 'prices-modelsdev.json']) rmSync(path.join(home, dead), { force: true });
  if (Object.keys(patch).length > 0) patchState(patch);
}

export function readState(): TersioState {
  migrateLegacy();
  return current();
}

/** Read, merge, write. One row write is atomic, so a crash never leaves half a state. */
export function patchState(patch: Partial<TersioState>): void {
  try {
    const next = { ...current(), ...patch };
    cachePut(STATE_KEY, JSON.stringify(next));
  } catch { /* state is best-effort; never break the caller */ }
}

/** The old per-key file, read once and then removed, so a stale copy never wins later. */
export function takeLegacy<T>(file: string, parse: (raw: string) => T | null): T | null {
  try {
    const value = parse(readFileSync(file, 'utf8'));
    if (value !== null) rmSync(file, { force: true });
    return value;
  } catch {
    return null;
  }
}
