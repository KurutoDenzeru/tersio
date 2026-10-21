// The dashboard's update surface: one view the page polls, the child process that applies a release,
// and the background check the operator's cadence drives. Node built-ins only.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACKAGE_VERSION } from './common.ts';
import { findPackageRoot, withResolvers } from '../extensions/shared/utils.ts';
import { patchState, readState } from '../extensions/shared/state.ts';
import type { TersioState } from '../extensions/shared/state.ts';
import { checkForUpdate, newerThan } from './update.ts';

export type UpdateSchedule = 'off' | 'daily' | 'weekly' | 'monthly';
export type UpdateStatus = 'idle' | 'checking' | 'applying';

/** Every tick asks whether the cadence is due, so a daily check lands within a quarter hour of it. */
const TICK_MS = 15 * 60 * 1000;
/** The first tick waits, so a dashboard opened and closed in a minute pays for no check. */
const FIRST_TICK_MS = 5_000;
/** What "Remind me later" buys. */
export const SNOOZE_MS = 6 * 60 * 60 * 1000;
/** Cap on the retained apply output, so a chatty npm run cannot grow without bound. */
const LOG_CAP = 200;
/** How much of that log the page receives. */
const VIEW_LOG = 40;

const SCHEDULE_MS: Record<UpdateSchedule, number> = {
  off: 0,
  daily: 86_400_000,
  weekly: 604_800_000,
  monthly: 2_592_000_000,
};
const SCHEDULES = Object.keys(SCHEDULE_MS) as UpdateSchedule[];
const DEFAULT_SCHEDULE: UpdateSchedule = 'daily';

export interface UpdateView {
  /** The version installed on disk, which moves the moment an install finishes. */
  current: string;
  /** The version this process runs: older than `current` until the page reloads. */
  running: string;
  /** Newest release the registry or the release feed named, its source, and the registry's tag. */
  latest: string | null;
  source: 'npm' | 'github' | null;
  npmLatest: string | null;
  /** A newer release exists that this build has not skipped. */
  available: boolean;
  /** The page should prompt now: available, nothing snoozing it, no work running. */
  prompt: boolean;
  schedule: UpdateSchedule;
  lastCheck: number | null;
  /** Ms until the next background check, or null when the cadence is off. */
  dueIn: number | null;
  /** Ms left on a reminder, or null when none holds: a duration, so the page does no clock math. */
  snoozeIn: number | null;
  skipped: string | null;
  status: UpdateStatus;
  /** Tail of the last apply's output, so the page can show progress. */
  log: string[];
  error: string | null;
}

export interface UpdatePrefs {
  schedule?: unknown;
  /** `snooze` hides the prompt for a while, `now` clears that, `skip` retires one release. */
  action?: 'snooze' | 'now' | 'skip';
  version?: unknown;
}

let status: UpdateStatus = 'idle';
let log: string[] = [];
let error: string | null = null;
let started = false;

/** Ms until the next check, floor 0 once it is due. Null when the cadence is off. */
export function dueIn(lastCheck: number | null | undefined, schedule: UpdateSchedule, now = Date.now()): number | null {
  const wait = SCHEDULE_MS[schedule];
  if (!wait) return null;
  return Math.max(0, (lastCheck ?? 0) + wait - now);
}

/** The tick's own question: off never is, a missing stamp is due at once, a future one never is. */
export function isDue(lastCheck: unknown, schedule: UpdateSchedule, now = Date.now()): boolean {
  const wait = SCHEDULE_MS[schedule];
  if (!wait) return false;
  const stamp = typeof lastCheck === 'number' && Number.isFinite(lastCheck) ? lastCheck : 0;
  if (stamp <= 0) return true;
  return now - stamp >= wait;
}

/** A newer release the operator has not skipped. */
export function newerAvailable(
  current: string,
  latest: string | null | undefined,
  skipped: string | null | undefined,
): boolean {
  return !!latest && latest !== skipped && newerThan(latest, current);
}

/** The prompt rule, split out so the toast, the pane, and the auto-apply cannot disagree. */
export function shouldPrompt(view: Omit<UpdateView, 'prompt'>): boolean {
  return view.available && view.status === 'idle' && view.snoozeIn === null;
}

/** The version installed on disk: an install moves it while this process keeps running the old build. */
function installedVersion(): string {
  try {
    const file = path.join(findPackageRoot(path.dirname(fileURLToPath(import.meta.url))), 'package.json');
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown };
    if (typeof parsed.version === 'string' && parsed.version) return parsed.version;
  } catch { /* a missing or unreadable manifest falls back to the running build */ }
  return PACKAGE_VERSION;
}

function storedSchedule(): UpdateSchedule {
  const value = readState().updateSchedule;
  return value && SCHEDULES.includes(value) ? value : DEFAULT_SCHEDULE;
}

/** The state the About pane and the toast both read, in one round trip. */
export function updateView(): UpdateView {
  const state = readState();
  const latest = state.updateCheck?.latest ?? null;
  const source = state.updateCheck?.source ?? null;
  const npmLatest = state.updateCheck?.npm ?? null;
  const skipped = state.updateSkip ?? null;
  const lastCheck = state.updateCheck?.lastCheck ?? null;
  const schedule = storedSchedule();
  const current = installedVersion();
  const now = Date.now();
  const snoozeLeft = state.updateSnoozeUntil ? state.updateSnoozeUntil - now : 0;
  const base: Omit<UpdateView, 'prompt'> = {
    current,
    running: PACKAGE_VERSION,
    latest,
    source,
    npmLatest,
    available: newerAvailable(current, latest, skipped),
    schedule,
    lastCheck,
    dueIn: dueIn(lastCheck, schedule),
    snoozeIn: snoozeLeft > 0 ? snoozeLeft : null,
    skipped,
    status,
    log: log.slice(-VIEW_LOG),
    error,
  };
  return { ...base, prompt: shouldPrompt(base) };
}

/** Store one operator choice. An unknown value leaves that field alone. */
export function setUpdatePrefs(prefs: UpdatePrefs): UpdateView {
  const patch: Partial<TersioState> = {};
  if (typeof prefs.schedule === 'string' && SCHEDULES.includes(prefs.schedule as UpdateSchedule)) {
    patch.updateSchedule = prefs.schedule as UpdateSchedule;
  }
  if (prefs.action === 'snooze') patch.updateSnoozeUntil = Date.now() + SNOOZE_MS;
  if (prefs.action === 'now') patch.updateSnoozeUntil = 0;
  if (prefs.action === 'skip' && typeof prefs.version === 'string') {
    patch.updateSkip = prefs.version;
    patch.updateSnoozeUntil = 0;
  }
  if (Object.keys(patch).length > 0) patchState(patch);
  return updateView();
}

/** The CLI this server runs from: the built entry beside the package, as the bin resolves it. */
function cliEntry(): string {
  return path.join(findPackageRoot(path.dirname(fileURLToPath(import.meta.url))), 'dist', 'tersio.js');
}

/** Run a child with both streams captured: the log is what the page shows, so nothing is inherited. */
function runChild(cmd: string, args: string[]): Promise<{ code: number | null; lines: string[] }> {
  const { promise, resolve, reject } = withResolvers<{ code: number | null; lines: string[] }>();
  const lines: string[] = [];
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const collect = (chunk: Buffer): void => {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (line.trim()) lines.push(line.trimEnd());
    }
    if (lines.length > LOG_CAP) lines.splice(0, lines.length - LOG_CAP);
  };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);
  child.on('error', reject);
  child.on('close', (code) => resolve({ code, lines }));
  return promise;
}

async function runCheck(force: boolean): Promise<void> {
  status = 'checking';
  try {
    const found = await checkForUpdate(force);
    // No source answered: the cache stays, so stamp the attempt and hold the cadence.
    patchState({ updateCheck: { ...readState().updateCheck, lastCheck: Date.now() } });
    error = found === 'unknown' ? 'Neither npm nor the release feed answered.' : null;
  } catch (e) {
    error = (e as Error).message;
  } finally {
    status = 'idle';
  }
}

async function runApply(): Promise<void> {
  status = 'applying';
  log = [];
  error = null;
  try {
    const entry = cliEntry();
    if (!existsSync(entry)) throw new Error(`No CLI to run at ${entry}. Build first.`);
    // The child runs this CLI's own update path, so the smoke check and the add-on refresh stay in one place.
    const { code, lines } = await runChild(process.execPath, [entry, 'update', '--yes']);
    log = lines;
    if (code !== 0) error = `tersio update exited with code ${code}.`;
  } catch (e) {
    error = (e as Error).message;
  } finally {
    status = 'idle';
  }
}

/** Read the registry now. Returns at once; the poll the page already runs carries `status`. */
export function startCheck(force = true): UpdateView {
  if (status === 'idle') void runCheck(force);
  return updateView();
}

/** Start the update. Returns at once; the poll carries `status` and the streamed log. */
export function startApply(): UpdateView {
  if (status === 'idle') void runApply();
  return updateView();
}

async function tick(): Promise<void> {
  if (status !== 'idle') return;
  const before = updateView();
  // Asked of the stamp, not of the derived wait: a nonsense stamp must not read as a quiet cadence.
  if (!isDue(before.lastCheck, before.schedule)) return;
  await runCheck(true);
}

/** One timer per server: asks the registry when the operator's cadence comes due. */
export function startUpdateWatch(): void {
  if (started) return;
  started = true;
  setTimeout(() => void tick(), FIRST_TICK_MS).unref();
  setInterval(() => void tick(), TICK_MS).unref();
}
