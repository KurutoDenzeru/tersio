// cli/usage.ts — ledger + session-token usage report, tokscale-style.
import {
  co2GramsFor,
  energyWhFor,
  importSessionTokens,
  priceFor,
  readUsage,
  usdCost,
} from '../extensions/shared/usage-ledger.ts';
import type { TokenBreakdown, UsageRow } from '../extensions/shared/usage-ledger.ts';
import { readRtkGain } from '../extensions/shared/rtk-gain.ts';
import type { RtkGain } from '../extensions/shared/rtk-gain.ts';
import { withInteractiveSpinner } from './interactive.ts';
import { PACKAGE_VERSION } from './common.ts';

export interface UsageReport {
  total: number;
  byKind: Record<string, number>;
  byDetail: Array<[string, number]>;
  lastWrite: string | null;
  empty: boolean;
  messages: number;
  tokens: TokenBreakdown;
  byModel: Record<string, TokenBreakdown>;
  byModelUsd: Record<string, number>;
  byModelMessages: Record<string, number>;
  byDay: Record<string, TokenBreakdown>;
  byDayModel: Record<string, Record<string, number>>;
  byTool: Array<[string, number]>;
  rtkGain: RtkGain;
  usd: number;
  priced: boolean;
  savedUsd: number;
  costMeasured: number;
  co2g: number;
  energyWh: number;
  version: string;
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
  const byModelUsd: Record<string, number> = {};
  let co2g = 0;
  let energyWh = 0;
  for (const [model, t] of Object.entries(session.byModel)) {
    const c = usdCost(t, model);
    usd += c.usd;
    byModelUsd[model] = c.usd;
    co2g += co2GramsFor(model, t.output);
    energyWh += energyWhFor(model, t.output);
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
    byModelUsd,
    byModelMessages: session.byModelMessages,
    byDay: session.byDay,
    byDayModel: session.byDayModel,
    byTool,
    rtkGain: readRtkGain(),
    usd,
    priced,
    savedUsd,
    costMeasured: session.costMeasured,
    co2g,
    energyWh,
    version: PACKAGE_VERSION,
  };
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
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
      console.log(`    ${model}: in ${fmt(b.input)} · out ${fmt(b.output)} · cache r/w ${fmt(b.cacheRead)}/${fmt(b.cacheWrite)} · $${(report.byModelUsd[model] ?? 0).toFixed(2)}`);
    }
  }
  if (report.rtkGain.commands) {
    const g = report.rtkGain;
    console.log(`  RTK measured  ${fmt(g.commands)} commands · ${fmt(g.saved)} saved (${g.avgPct.toFixed(1)}%)`);
    for (const r of g.byCommand) {
      console.log(`    ${r.count}x ${r.command} · ${fmt(r.saved)} saved · ${r.avgPct.toFixed(1)}% · ${fmtMs(r.avgMs)}`);
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
