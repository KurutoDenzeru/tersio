// The wrap record Tersio keeps, in the usage ledger beside the rest of the machine state, and headroom's own view of routing.
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { cacheGet, cachePut } from './cache-store.ts';
import { tersioHome } from './utils.ts';

const WRAPS_KEY = 'headroom.wraps';

/** One check row from `headroom doctor --json`. */
export type HeadroomDoctorCheck = { name: string; status: string; summary: string };

/** The stored record corrected by headroom's checks: a pass adds, a warn or fail clears, and a skip keeps the flag. */
export function mergeHeadroomWraps(
  stored: Record<string, unknown>,
  checks: HeadroomDoctorCheck[],
  targets: readonly string[],
): Record<string, true> {
  const merged: Record<string, true> = {};
  for (const name of targets) if (stored[name] === true) merged[name] = true;
  for (const check of checks) {
    if (!targets.includes(check.name)) continue;
    if (check.status === 'pass' && /routed via/i.test(check.summary)) merged[check.name] = true;
    else if (check.status === 'warn' || check.status === 'fail') delete merged[check.name];
  }
  return merged;
}

/** The record as stored, with the loose file an older build wrote imported once. */
function readStored(): Record<string, unknown> {
  const text = cacheGet(WRAPS_KEY);
  if (text !== null) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch { /* a damaged record reads empty */ }
    return {};
  }
  const legacy = path.join(tersioHome(), 'headroom-wraps.json');
  try {
    const parsed: unknown = JSON.parse(readFileSync(legacy, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      cachePut(WRAPS_KEY, JSON.stringify(parsed));
      rmSync(legacy, { force: true });
      return parsed as Record<string, unknown>;
    }
  } catch { /* none yet */ }
  return {};
}

/** The wrapped targets the page draws. */
export function readHeadroomWraps(): Record<string, true> {
  const stored = readStored();
  const wraps: Record<string, true> = {};
  for (const [name, value] of Object.entries(stored)) if (value === true) wraps[name] = true;
  return wraps;
}

/** Replaces the whole record, so a doctor pass can correct it in one write. */
export function writeHeadroomWraps(wraps: Record<string, unknown>): void {
  cachePut(WRAPS_KEY, JSON.stringify(wraps));
}

/** One name on or off in the stored record; a failed write only costs the next read. */
export function setStoredWrap(name: string, on: boolean): void {
  const stored = readStored();
  if (on) stored[name] = true;
  else delete stored[name];
  cachePut(WRAPS_KEY, JSON.stringify(stored));
}
