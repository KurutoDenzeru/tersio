// cli/usage.ts — ledger-backed usage + savings report.
import { readUsage } from '../extensions/shared/usage-ledger.ts';
import type { UsageRow } from '../extensions/shared/usage-ledger.ts';
import { withInteractiveSpinner } from './interactive.ts';

export interface UsageReport {
  total: number;
  byKind: Record<string, number>;
  byDetail: Array<[string, number]>;
  lastWrite: string | null;
  empty: boolean;
}

export function summarizeUsage(rows: UsageRow[]): UsageReport {
  const byKind: Record<string, number> = {};
  const detailCounts: Record<string, number> = {};
  for (const r of rows) {
    byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    detailCounts[r.detail] = (detailCounts[r.detail] ?? 0) + 1;
  }
  const byDetail = Object.entries(detailCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  return {
    total: rows.length,
    byKind,
    byDetail,
    lastWrite: rows.length ? new Date(rows[rows.length - 1].ts).toISOString() : null,
    empty: rows.length === 0,
  };
}

function printReport(report: UsageReport): void {
  console.log('\n=== Tersio Usage ===');
  if (report.empty) {
    console.log('  No ledger rows yet — run session commands or install/update first.');
    console.log(`  Host token usage: n/a (OMP exposes no token counters).`);
    return;
  }
  console.log('  Activity');
  for (const [kind, n] of Object.entries(report.byKind)) {
    console.log(`    ${kind}: ${n}`);
  }
  console.log('  Top commands');
  for (const [detail, n] of report.byDetail) {
    console.log(`    ${n}× ${detail}`);
  }
  console.log(`  Total rows: ${report.total} · last write: ${report.lastWrite}`);
  console.log('  Savings: RTK measured rows appear here once RTK_HOOK_AUDIT=1 imports land;');
  console.log('           reply-brevity figures are ~est. heuristics, never exact.');
  console.log('  Host token usage: n/a (OMP exposes no token counters).');
}

async function runUsage(): Promise<void> {
  const report = await withInteractiveSpinner('Reading usage ledger', async () => summarizeUsage(readUsage()));
  printReport(report);
}

export { runUsage };
