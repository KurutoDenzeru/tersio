// cli/usage.ts — ledger + session-token usage report, tokscale-style.
import {
  co2Grams,
  importSessionTokens,
  priceFor,
  readUsage,
  usdCost,
} from '../extensions/shared/usage-ledger.ts';
import type { TokenBreakdown, UsageRow } from '../extensions/shared/usage-ledger.ts';
import { withInteractiveSpinner } from './interactive.ts';

export interface UsageReport {
  total: number;
  byKind: Record<string, number>;
  byDetail: Array<[string, number]>;
  lastWrite: string | null;
  empty: boolean;
  messages: number;
  tokens: TokenBreakdown;
  byModel: Record<string, TokenBreakdown>;
  byDay: Record<string, TokenBreakdown>;
  byDayModel: Record<string, Record<string, number>>;
  byTool: Array<[string, number]>;
  usd: number;
  priced: boolean;
  savedUsd: number;
  costMeasured: number;
  co2g: number;
}

export function summarizeUsage(rows: UsageRow[]): UsageReport {
  const byKind: Record<string, number> = {};
  const detailCounts: Record<string, number> = {};
  for (const r of rows) {
    byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    detailCounts[r.detail] = (detailCounts[r.detail] ?? 0) + 1;
  }
  const byDetail = Object.entries(detailCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const session = importSessionTokens();
  let usd = 0;
  let priced = true;
  let savedUsd = 0;
  for (const [model, t] of Object.entries(session.byModel)) {
    const c = usdCost(t, model);
    usd += c.usd;
    if (!c.priced) priced = false;
    savedUsd += (t.cacheRead / 1e6) * priceFor(model).price.input;
  }
  const byTool = Object.entries(session.byTool).sort((a, b) => b[1] - a[1]).slice(0, 10);
  return {
    total: rows.length,
    byKind,
    byDetail,
    lastWrite: rows.length ? new Date(rows[rows.length - 1].ts).toISOString() : null,
    empty: rows.length === 0 && session.messages === 0,
    messages: session.messages,
    tokens: session.totals,
    byModel: session.byModel,
    byDay: session.byDay,
    byDayModel: session.byDayModel,
    byTool,
    usd,
    priced,
    savedUsd,
    costMeasured: session.costMeasured,
    co2g: co2Grams(session.totals.output),
  };
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function printReport(report: UsageReport): void {
  console.log('\n=== Tersio Usage ===');
  if (report.empty) {
    console.log('  No ledger rows or session tokens yet — run session commands first.');
    return;
  }
  const t = report.tokens;
  console.log(`  Tokens  input ${fmt(t.input)} · output ${fmt(t.output)} · cache read ${fmt(t.cacheRead)} · cache write ${fmt(t.cacheWrite)} (${report.messages} assistant messages)`);
  console.log(`  Cost    $${report.usd.toFixed(2)}${report.priced ? '' : ' (includes default pricing for unknown models)'} · ~$${report.savedUsd.toFixed(2)} saved by cache (est.) · CO2 ~${report.co2g.toFixed(1)}g (est.)`);
  const models = Object.entries(report.byModel).sort((a, b) => (b[1].input + b[1].output) - (a[1].input + a[1].output)).slice(0, 5);
  if (models.length) {
    console.log('  By model');
    for (const [model, b] of models) {
      console.log(`    ${model}: in ${fmt(b.input)} · out ${fmt(b.output)} · cache r/w ${fmt(b.cacheRead)}/${fmt(b.cacheWrite)}`);
    }
  }
  if (report.byTool.length) {
    console.log('  Top tools');
    for (const [tool, n] of report.byTool) {
      console.log(`    ${n}× ${tool}`);
    }
  }
  if (report.total) {
    console.log('  Activity');
    for (const [kind, n] of Object.entries(report.byKind)) {
      console.log(`    ${kind}: ${n}`);
    }
    console.log('  Top commands');
    for (const [detail, n] of report.byDetail) {
      console.log(`    ${n}× ${detail}`);
    }
  }
}

async function runUsage(): Promise<void> {
  const report = await withInteractiveSpinner('Reading usage ledger', async () => summarizeUsage(readUsage()));
  printReport(report);
}

export { runUsage };
