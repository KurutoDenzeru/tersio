// Shared usage ledger: append-only JSON-lines file. One source of truth read
// by `tersio usage`, `/tersio usage`, and the gain dashboard.
// Best-effort by design: a ledger failure never breaks the caller, and
// corrupt lines are skipped on read (same pattern as the config normalizer).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type UsageKind = 'command' | 'toggle' | 'install' | 'update' | 'rtk-audit';

export interface UsageRow {
  ts: number;
  kind: UsageKind;
  detail: string;
}

export function ledgerPath(): string {
  const override = process.env.TERSIO_USAGE_FILE;
  if (override) return override;
  return path.join(os.homedir(), '.omp', 'plugins', 'tersio-usage.jsonl');
}

export function appendUsage(kind: UsageKind, detail: string): void {
  const row = JSON.stringify({ ts: Date.now(), kind, detail }) + '\n';
  try {
    fs.mkdirSync(path.dirname(ledgerPath()), { recursive: true });
    fs.appendFileSync(ledgerPath(), row, 'utf8');
  } catch { /* ledger is best-effort; never break the caller */ }
}

export function readUsage(): UsageRow[] {
  let text: string;
  try {
    text = fs.readFileSync(ledgerPath(), 'utf8');
  } catch {
    return [];
  }
  const rows: UsageRow[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as Partial<UsageRow>;
      if (typeof row.ts === 'number' && typeof row.kind === 'string' && typeof row.detail === 'string') {
        rows.push({ ts: row.ts, kind: row.kind as UsageKind, detail: row.detail });
      }
    } catch { /* skip corrupt lines */ }
  }
  return rows;
}
