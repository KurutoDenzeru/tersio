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

// Box-drawing table, plain text (piped-safe, byte-stable). Numeric columns
// right-align; long cells truncate with an ellipsis.
function table(headers: string[], rows: string[][], right: boolean[] = [], maxW = 32): string[] {
  const cells = [headers, ...rows].map((r) =>
    r.map((c) => (c.length > maxW ? c.slice(0, maxW - 1) + '…' : c)),
  );
  const widths = headers.map((_, i) => Math.max(...cells.map((r) => r[i].length)));
  const line = (l: string, m: string, r: string): string =>
    l + widths.map((w) => '─'.repeat(w + 2)).join(m) + r;
  const row = (cs: string[]): string =>
    '│ ' + cs.map((c, i) => (right[i] ? c.padStart(widths[i]) : pad(c, widths[i]))).join(' │ ') + ' │';
  const out = [line('┌', '┬', '┐'), row(cells[0]), line('├', '┼', '┤')];
  for (const r of cells.slice(1)) out.push(row(r));
  out.push(line('└', '┴', '┘'));
  return out.map((l) => '  ' + l);
}

function printReport(report: UsageReport): void {
  console.log(`\n=== Tersio Usage v${report.version} · ${fmt(report.messages)} msgs ===`);
  if (report.empty) {
    console.log('  No ledger rows or session tokens yet — run session commands first.');
    return;
  }
  const t = report.tokens;
  console.log(`  TOKENS  ${fmt(t.input)} in · ${fmt(t.output)} out · ${fmt(t.cacheRead)} cache read${t.cacheWrite > 0 ? ` · ${fmt(t.cacheWrite)} written` : ''}`);
  console.log(`  COST    $${report.usd.toFixed(2)}${report.priced ? '' : ' (includes default pricing)'} · ~$${report.savedUsd.toFixed(2)} cache-saved (est.) · ~${report.co2g.toFixed(1)}g CO2 (est.)`);
  const models = Object.entries(report.byModel).filter(([, b]) => b.input + b.output + b.cacheRead + b.cacheWrite > 0).sort((a, b) => (b[1].input + b[1].output) - (a[1].input + a[1].output)).slice(0, 8);
  if (models.length) {
    console.log('  BY MODEL');
    const top = models.reduce((m, [, b]) => Math.max(m, b.input + b.output + b.cacheRead + b.cacheWrite), 1);
    const mrows = models.map(([model, b]) => {
      const mt = b.input + b.output + b.cacheRead + b.cacheWrite;
      const hit = b.input + b.cacheRead ? (b.cacheRead / (b.input + b.cacheRead)) * 100 : 0;
      const usd = report.byModelUsd[model] ?? 0;
      return [model, `in ${fmt(b.input)}`, `out ${fmt(b.output)}`, `${fmt(b.cacheRead)}/${fmt(b.cacheWrite)}`, `$${usd.toFixed(2)}`, `${hit.toFixed(1)}%`, `${bar(mt / top, 8)} ${fmtShort(mt)}`];
    });
    for (const l of table(['Model', 'Input', 'Output', 'Cache r/w', 'USD', 'Hit', 'Share'], mrows, [false, true, true, true, true, true, false])) {
      console.log(l);
    }
  }
  const cmdRows: { name: string; count: number; saved: number | null; avgPct: number | null; avgMs: number | null }[] =
    report.byTool.map(([tool, n]) => ({ name: tool, count: n, saved: null, avgPct: null, avgMs: null }));
  for (const r of report.rtkGain.byCommand) {
    cmdRows.push({ name: r.command, count: r.count, saved: r.saved, avgPct: r.avgPct, avgMs: r.avgMs });
  }
  cmdRows.sort((a, b) => b.count - a.count);
  if (cmdRows.length) {
    const g = report.rtkGain;
    const scope = g.commands
      ? `  COMMAND TOOLS  ${fmt(report.byTool.length)} tools · ${fmt(g.commands)} commands · ${fmtShort(g.saved)} saved`
      : '  COMMAND TOOLS';
    console.log(scope);
    const top = cmdRows.reduce((m, r) => Math.max(m, r.count), 1);
    const crows = cmdRows.slice(0, 15).map((r, idx) => [
      String(idx + 1),
      r.name,
      fmt(r.count),
      r.saved === null ? '–' : fmtShort(r.saved),
      r.avgPct === null ? '–' : `${r.avgPct.toFixed(1)}%`,
      r.avgMs === null ? '–' : fmtMs(r.avgMs),
      bar(r.count / top, 8),
    ]);
    for (const l of table(['#', 'Tool/Command', 'Count', 'Saved', 'Avg%', 'Time', 'Impact'], crows, [true, false, true, true, true, true, false], 30)) {
      console.log(l);
    }
  }
}

async function runUsage(): Promise<void> {
  const report = await withInteractiveSpinner('Reading usage ledger', async () => summarizeUsage(readUsage()));
  printReport(report);
}

export { runUsage };
