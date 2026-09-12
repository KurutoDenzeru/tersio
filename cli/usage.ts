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

function fmtShort(n: number): string {
  if (n >= 1e12) return (n / 1e12).toFixed(1) + 'T';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.round(n));
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function bar(frac: number, width = 12): string {
  const filled = Math.max(0, Math.min(width, Math.round(frac * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function printReport(report: UsageReport): void {
  console.log(`\n=== Tersio Usage v${report.version} · ${fmt(report.messages)} msgs ===`);
  if (report.empty) {
    console.log('  No ledger rows or session tokens yet — run session commands first.');
    return;
  }
  const t = report.tokens;
  console.log(`  TOKENS  ${fmt(t.input)} in · ${fmt(t.output)} out · ${fmt(t.cacheRead)} cache read · ${fmt(t.cacheWrite)} written`);
  console.log(`  COST    $${report.usd.toFixed(2)}${report.priced ? '' : ' (includes default pricing)'} · ~$${report.savedUsd.toFixed(2)} cache-saved (est.) · ~${report.co2g.toFixed(1)}g CO2 (est.)`);
  const models = Object.entries(report.byModel).filter(([, b]) => b.input + b.output + b.cacheRead + b.cacheWrite > 0).sort((a, b) => (b[1].input + b[1].output) - (a[1].input + a[1].output)).slice(0, 8);
  if (models.length) {
    console.log('  BY MODEL');
    const top = models.reduce((m, [, b]) => Math.max(m, b.input + b.output + b.cacheRead + b.cacheWrite), 1);
    for (const [model, b] of models) {
      const mt = b.input + b.output + b.cacheRead + b.cacheWrite;
      const hit = b.input + b.cacheRead ? (b.cacheRead / (b.input + b.cacheRead)) * 100 : 0;
      const usd = report.byModelUsd[model] ?? 0;
      console.log(`    ${model}: in ${fmt(b.input)} · out ${fmt(b.output)} · cache r/w ${fmt(b.cacheRead)}/${fmt(b.cacheWrite)} · $${usd.toFixed(2)} · hit ${hit.toFixed(1)}% ${bar(mt / top)} ${fmtShort(mt)}`);
    }
  }
if (report.rtkGain.commands) {
  const g = report.rtkGain;
  console.log(`  RTK MEASURED  ${fmt(g.commands)} commands · ${fmt(g.saved)} saved (${g.avgPct.toFixed(1)}%)`);
  const nameW = Math.min(28, g.byCommand.reduce((m, r) => Math.max(m, r.command.length), 0));
  const top = g.byCommand.reduce((m, r) => Math.max(m, r.saved), 1);
  for (const r of g.byCommand) {
    console.log(`    ${pad(r.command.slice(0, nameW), nameW)} ${String(r.count).padStart(4)}x  ${fmtShort(r.saved).padStart(7)} saved  ${r.avgPct.toFixed(1).padStart(5)}%  ${fmtMs(r.avgMs).padStart(6)}  ${bar(r.saved / top, 10)}`);
  }
}
if (report.byTool.length) {
  console.log('  TOP TOOLS');
  const sum = report.byTool.reduce((a, [, n]) => a + n, 0);
  const top = report.byTool.reduce((m, [, n]) => Math.max(m, n), 1);
  const nameW = Math.min(16, report.byTool.reduce((m, [t]) => Math.max(m, t.length), 0));
  for (const [tool, n] of report.byTool) {
    console.log(`    ${pad(tool.slice(0, nameW), nameW)} ${String(n).padStart(5)}  ${String(Math.round((n / sum) * 100)).padStart(3)}%  ${bar(n / top, 10)}`);
  }
}
if (report.total) {
  console.log('  ACTIVITY');
  for (const [kind, n] of Object.entries(report.byKind)) {
    console.log(`    ${kind}: ${n}`);
  }
  console.log('  Top commands');
  for (const [detail, n] of report.byDetail) {
    console.log(`    ${n}x ${detail}`);
  }
}
}

async function runUsage(): Promise<void> {
  const report = await withInteractiveSpinner('Reading usage ledger', async () => summarizeUsage(readUsage()));
  printReport(report);
}

export { runUsage };
