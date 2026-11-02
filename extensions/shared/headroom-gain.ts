// Headroom's savings read through its own CLI: measured=false plus a failure, never a zero that reads as data, and a memo so a poll does not shell out each render.

import { execFileSync } from 'node:child_process';
import { headroomProxyUrl } from './headroom-proxy.ts';
import { resolveHeadroomBinary, shimCommand } from './utils.ts';
import type { HeadroomClientRow, HeadroomProxyStats } from './agent-types.ts';

export interface HeadroomWindow {
  tokensSaved: number;
  tokensBefore: number;
  costUsd: number;
  calls: number;
  savingsPercent: number;
}

export interface HeadroomModelRow {
  model: string;
  costUsd: number;
}

export interface HeadroomGain {
  measured: boolean;
  failure: string;
  lifetime: HeadroomWindow;
  windows: { today: HeadroomWindow; last7Days: HeadroomWindow; last30Days: HeadroomWindow };
  byClient: HeadroomClientRow[];
  byModel: HeadroomModelRow[];
}

export interface HeadroomGainOptions {
  /** Test seam: a fake binary path, else the PATH probe. `null` skips the call entirely. */
  binary?: string | null;
  budgetMs?: number;
  /** Proxy port for `headroom doctor`; the ledger itself has no port. */
  port?: number;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function window(raw: unknown): HeadroomWindow {
  const w = (raw ?? {}) as Record<string, unknown>;
  return {
    tokensSaved: num(w.tokens_saved),
    tokensBefore: num(w.tokens_before),
    costUsd: num(w.cost_usd),
    calls: num(w.calls),
    savingsPercent: num(w.savings_percent),
  };
}

// Field names differ between schema versions; every read tolerates a miss and prices it zero.
export function parseHeadroomSavings(raw: string): HeadroomGain {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const windows = (parsed.windows ?? {}) as Record<string, unknown>;
  const clients = Array.isArray(parsed.by_client) ? parsed.by_client : [];
  const models = Array.isArray(parsed.by_model) ? parsed.by_model : [];
  return {
    measured: true,
    failure: '',
    lifetime: window(parsed.lifetime),
    windows: {
      today: window(windows.today),
      last7Days: window(windows.last_7_days),
      last30Days: window(windows.last_30_days),
    },
    byClient: clients.map((row) => {
      const r = (row ?? {}) as Record<string, unknown>;
      return { client: String(r.client ?? 'unknown'), calls: num(r.calls), tokensSaved: num(r.tokens_saved ?? r.tokens) };
    }),
    byModel: models.map((row) => {
      const r = (row ?? {}) as Record<string, unknown>;
      return { model: String(r.model ?? 'unknown'), costUsd: num(r.cost_usd ?? r.cost) };
    }),
  };
}

export function emptyHeadroomGain(failure: string): HeadroomGain {
  const zero = { tokensSaved: 0, tokensBefore: 0, costUsd: 0, calls: 0, savingsPercent: 0 };
  return {
    measured: false,
    failure,
    lifetime: { ...zero },
    windows: { today: { ...zero }, last7Days: { ...zero }, last30Days: { ...zero } },
    byClient: [],
    byModel: [],
  };
}

export interface HeadroomCheck {
  name: string;
  status: string;
  summary: string;
  hint: string | null;
}

export interface HeadroomDoctor {
  measured: boolean;
  failure: string;
  exitCode: number | null;
  version: string | null;
  checks: HeadroomCheck[];
}

export function parseHeadroomDoctor(raw: string): HeadroomDoctor {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const checks = Array.isArray(parsed.checks) ? parsed.checks : [];
  return {
    measured: true,
    failure: '',
    exitCode: typeof parsed.exit_code === 'number' ? parsed.exit_code : null,
    version: typeof parsed.installed_version === 'string' ? parsed.installed_version : null,
    checks: checks.map((row) => {
      const r = (row ?? {}) as Record<string, unknown>;
      return {
        name: String(r.name ?? 'check'),
        status: String(r.status ?? 'unknown'),
        summary: String(r.summary ?? ''),
        hint: typeof r.hint === 'string' ? r.hint : null,
      };
    }),
  };
}

/** The live counters `/stats` reports; they reset with the proxy, unlike the durable savings ledger. */
export function parseHeadroomStats(raw: string): HeadroomProxyStats {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const summary = (parsed.summary ?? {}) as Record<string, unknown>;
  const compression = (summary.compression ?? {}) as Record<string, unknown>;
  return {
    measured: true,
    failure: '',
    requests: num(summary.api_requests),
    compressed: num(compression.requests_compressed),
    tokensSaved: num(compression.total_tokens_saved_all_layers ?? compression.total_tokens_removed),
    avgCompressionPct: num(compression.avg_compression_pct),
  };
}

export function emptyHeadroomStats(failure: string): HeadroomProxyStats {
  return { measured: false, failure, requests: 0, compressed: 0, tokensSaved: 0, avgCompressionPct: 0 };
}

// The probe costs a subprocess plus localhost round-trips; the dashboard polls, so each probe holds its own answer briefly (the ledger moves slowly, the routing check less so).
const MEMOS = new Map<string, { at: number; value: unknown }>();

/** Tests only: drops the memo so a refetch re-runs the CLI or the proxy probe. */
export function resetHeadroomGainMemo(): void {
  MEMOS.clear();
}

function runProbe<T>(probe: 'savings' | 'doctor', binary: string, budgetMs: number, memoMs: number,
  parse: (raw: string) => T, blank: (failure: string) => T, port?: number): T {
  const label = `headroom ${probe}`;
  const hit = MEMOS.get(probe);
  if (hit && Date.now() - hit.at < memoMs) return hit.value as T;
  try {
    // A Windows install can land as `headroom.cmd`, and cmd.exe only runs through the shim.
    const shim = shimCommand(binary, [probe, '--json']);
    const stdout = execFileSync(shim.cmd, shim.args, {
      timeout: budgetMs,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
      encoding: 'utf8',
      env: port ? { ...process.env, HEADROOM_PORT: String(port) } : process.env,
    });
    const value = parse(stdout);
    MEMOS.set(probe, { at: Date.now(), value });
    return value;
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string; killed?: boolean };
    // `doctor` exits 2 on a failing check and still prints its JSON: the exit is a reading, not an error.
    if (probe === 'doctor' && typeof err.stdout === 'string' && err.stdout.trim().startsWith('{')) {
      const value = parse(err.stdout);
      MEMOS.set(probe, { at: Date.now(), value });
      return value;
    }
    MEMOS.delete(probe);
    return blank(err.killed ? `${label} timed out` : (err.stderr?.trim() || err.message || `${label} failed`));
  }
}

/** Headroom's routing check; it exits 2 on a failing check and still prints JSON, so a non-zero exit is a reading. */
export function readHeadroomDoctor(options: HeadroomGainOptions = {}): HeadroomDoctor {
  const binary = options.binary !== undefined ? options.binary : resolveHeadroomBinary();
  if (!binary) return { measured: false, failure: 'headroom binary not found in PATH', exitCode: null, version: null, checks: [] };
  return runProbe('doctor', binary, options.budgetMs ?? 8000, 15000, parseHeadroomDoctor,
    (failure) => ({ measured: false, failure, exitCode: null, version: null, checks: [] }), options.port);
}

export function readHeadroomSavings(options: HeadroomGainOptions = {}): HeadroomGain {
  const binary = options.binary !== undefined ? options.binary : resolveHeadroomBinary();
  if (!binary) return emptyHeadroomGain('headroom binary not found in PATH');
  return runProbe('savings', binary, options.budgetMs ?? 5000, 5000, parseHeadroomSavings, emptyHeadroomGain);
}

/** The proxy's live counters. The CLI has no stats command, so this reads the same HTTP endpoint the dashboard uses. */
export function readHeadroomStats(options: { url?: string; budgetMs?: number } = {}): HeadroomProxyStats {
  const url = options.url ?? new URL('/stats', headroomProxyUrl()).toString();
  const budget = options.budgetMs ?? 800;
  const hit = MEMOS.get('stats');
  if (hit && Date.now() - hit.at < 5000) return hit.value as HeadroomProxyStats;
  try {
    // A synchronous caller cannot await fetch, so a short-lived same-runtime child performs the read.
    const script = `fetch(process.argv[1],{signal:AbortSignal.timeout(${budget})}).then((r)=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.text()}).then((t)=>process.stdout.write(t)).catch((e)=>{console.error(e.message);process.exit(1)})`;
    const stdout = execFileSync(process.execPath, ['-e', script, url], {
      timeout: budget + 500,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
      encoding: 'utf8',
    });
    const value = parseHeadroomStats(stdout);
    MEMOS.set('stats', { at: Date.now(), value });
    return value;
  } catch (e) {
    const err = e as { stderr?: string; message?: string; killed?: boolean };
    MEMOS.delete('stats');
    return emptyHeadroomStats(err.killed ? 'headroom stats timed out' : (err.stderr?.trim() || err.message || 'headroom stats failed'));
  }
}