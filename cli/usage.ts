// cli/usage.ts — ledger + session-token usage report, tokscale-style.
import {
  PRICE_TIERS_FIRM,
  co2GramsFor,
  displayModelId,
  energyWhFor,
  foldModelsByLabel,
  importSessionTokens,
  ledgerPath,
  priceFor,
  pricesOverridePath,
  readResetWatermark,
  readRtkAdoption,
  readRtkRecallDiagnostics,
  readUsage,
  refreshPricesIfStale,
  sessionsDir,
  usdCost,
} from '../extensions/shared/usage-ledger.ts';
import type { RecentRequest, RtkAdoption, RtkRecallDiagnostics, SessionTokens, TokenBreakdown, UsageRow } from '../extensions/shared/usage-ledger.ts';
import { resolveRtkBinary } from '../extensions/shared/utils.ts';
import { readRtkGain } from '../extensions/shared/rtk-gain.ts';
import type { RtkGain } from '../extensions/shared/rtk-gain.ts';
import { readUsageDb, reparseGuardReport, syncUsageDb, usageDbPath } from '../extensions/shared/usage-store.ts';
import { withInteractiveSpinner } from './interactive.ts';
import { PACKAGE_VERSION, currency } from './common.ts';
import { formatCurrency } from './currency.ts';
import type { CurrencyCode } from './currency.ts';

// `est` is tersio's modeled cost; the dashboard prefers a measured figure, so the two are never blended into one unlabeled number.
export interface RecentRequestRow extends RecentRequest {
  est: number;
}

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
  byModelBucketUsd: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>;
  byModelMessages: Record<string, number>;
  byHost: Record<string, Record<string, TokenBreakdown>>;
  /** Agent kind -> tokens and message count, so a subagent's work reads apart from its root's. */
  byAgent: Record<string, { tokens: TokenBreakdown; msgs: number }>;
  byDay: Record<string, TokenBreakdown>;
  byDayModel: Record<string, Record<string, number>>;
  byTool: Array<[string, number]>;
  recent: RecentRequestRow[];
  rtkGain: RtkGain;
  rtkAdoption: RtkAdoption;
  rtkRecall: RtkRecallDiagnostics;
  usd: number;
  priced: boolean;
  /** Tokens priced by a tier that is not firm: another provider's rate, or the default table. */
  estimatedUsd: number;
  /** How many models resolved at each tier, so a reader can judge the estimate. */
  priceTiers: Record<string, number>;
  /**
   * Ledger keys still priced by a guess, heaviest first, five at most. Keys rather than labels,
   * because the key is what `prices.local.json` spells. One list covers every host.
   */
  weakModels: string[];
  /** Models the host priced itself, so the reader knows whose figure that is. */
  measuredModels: string[];
  savedUsd: number;
  costMeasured: number;
  co2g: number;
  energyWh: number;
  version: string;
  currency: CurrencyCode;
  source: 'live' | 'stored' | 'stored-stale';
  paths: { ledger: string; sessions: string; usageDb: string };
}
// RTK's history is machine-wide; rows group by command alone. 2000 groups covers a long history while still bounding /data.json.
const RTK_COMMAND_ROWS = 2000;

export function summarizeUsage(rows: UsageRow[]): UsageReport {
  refreshPricesIfStale();
  const byKind: Record<string, number> = {};
  const detailCounts: Record<string, number> = {};
  for (const r of rows) {
    byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    detailCounts[r.detail] = (detailCounts[r.detail] ?? 0) + 1;
  }
  const byDetail = Object.entries(detailCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  // usage.db is a cache of the same per-message rows: sync best-effort, read stored, fall back to the live parse when the store is missing or stale.
  let synced = false;
  try {
    synced = syncUsageDb();
  } catch {
    synced = false;
  }
  const guard = reparseGuardReport();
  if (guard) console.warn(`[warn] usage mirror: ${guard}`);
  let stored: SessionTokens | null = null;
  try {
    stored = readUsageDb()?.tokens ?? null;
  } catch {
    stored = null;
  }
  const session: SessionTokens = stored ?? importSessionTokens();
  const source: UsageReport['source'] = stored ? (synced ? 'stored' : 'stored-stale') : 'live';
  const watermark = readResetWatermark();
  let usd = 0;
  let estimatedUsd = 0;
  let priced = true;
  let savedUsd = 0;
  const byModelUsd: Record<string, number> = {};
  const byModelBucketUsd: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {};
  const byHost: Record<string, Record<string, TokenBreakdown>> = {};
  const byAgent: Record<string, { tokens: TokenBreakdown; msgs: number }> = {};
  const byDayModel: Record<string, Record<string, number>> = {};
  let co2g = 0;
  let energyWh = 0;
  const addTok = (into: TokenBreakdown, t: TokenBreakdown): void => {
    into.input += t.input;
    into.output += t.output;
    into.cacheRead += t.cacheRead;
    into.cacheWrite += t.cacheWrite;
  };
  // Price by exact key first (gateways can differ), then fold every map under the display label.
  const folded = foldModelsByLabel(session.byModel, session.byModelMessages);
  const priceTiers: Record<string, number> = {};
  // Named in the loop so the list is built in one pass, then sorted by token volume below.
  const weakModels: string[] = [];
  const measuredModels: string[] = [];
  for (const [model, t] of Object.entries(session.byModel)) {
    // A model is measured only when the host priced every one of its messages; a partly measured
    // model would read its unpriced messages as zero, which is the one error worse than a guess.
    const covered = (session.byModelCostMessages[model] ?? 0) >= (session.byModelMessages[model] ?? 0);
    const measured = covered ? session.byModelMeasured[model] : undefined;
    const c = usdCost(t, model, measured);
    usd += c.usd;
    priceTiers[c.tier] = (priceTiers[c.tier] ?? 0) + 1;
    if (c.tier === 'measured') measuredModels.push(model);
    // A tier that is not firm is an estimate, so it is kept out of the firm total rather than
    // summed beside a measured cost that would make the whole figure read as a bill.
    if (!PRICE_TIERS_FIRM.includes(c.tier)) {
      estimatedUsd += c.usd;
      weakModels.push(model);
    }
    const label = displayModelId(model);
    byModelUsd[label] = (byModelUsd[label] ?? 0) + c.usd;
    byModelBucketUsd[label] ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    addTok(byModelBucketUsd[label], c.buckets);
    for (const [host, hb] of Object.entries(session.byHost[model] ?? {})) {
      byHost[label] ??= {};
      byHost[label][host] ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      addTok(byHost[label][host], hb);
    }
    for (const [agent, ab] of Object.entries(session.byAgent[model] ?? {})) {
      byAgent[agent] ??= { tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, msgs: 0 };
      addTok(byAgent[agent].tokens, ab);
      byAgent[agent].msgs += session.byAgentMessages[model]?.[agent] ?? 0;
    }
    co2g += co2GramsFor(model, t.output);
    energyWh += energyWhFor(model, t.output);
    if (!c.priced) priced = false;
    savedUsd += (t.cacheRead / 1e6) * priceFor(model).price.input;
  }
  for (const [day, per] of Object.entries(session.byDayModel)) {
    for (const [model, n] of Object.entries(per)) {
      const label = displayModelId(model);
      byDayModel[day] ??= {};
      byDayModel[day][label] = (byDayModel[day][label] ?? 0) + n;
    }
  }
  const byTool = Object.entries(session.byTool).sort((a, b) => b[1] - a[1]).slice(0, 10);
  // Heaviest first, then capped to five: the line is guidance, not a dump of the model table.
  const weakKeys = weakModels
    .toSorted((a, b) => tokenTotal(session.byModel[b]) - tokenTotal(session.byModel[a]))
    .slice(0, 5);
  return {
    total: rows.length,
    byKind,
    byDetail,
    lastWrite: rows.length ? new Date(rows[rows.length - 1].ts).toISOString() : null,
    empty: rows.length === 0 && session.messages === 0,
    messages: session.messages,
    tokens: session.totals,
    byModel: folded.byModel,
    byModelUsd,
    byModelBucketUsd,
    byModelMessages: folded.byModelMessages,
    byHost,
    byAgent,
    byDay: session.byDay,
    byDayModel,
    byTool,
    recent: session.recent.map((r) => ({
      ...r,
      est: usdCost({ input: r.i, output: r.o, cacheRead: r.cr ?? 0, cacheWrite: r.cw ?? 0 }, r.m).usd,
    })),
    rtkGain: readRtkGain(RTK_COMMAND_ROWS, watermark || undefined),
    rtkAdoption: readRtkAdoption(),
    rtkRecall: readRtkRecallDiagnostics(resolveRtkBinary()),
    usd,
    priced,
    estimatedUsd,
    priceTiers,
    weakModels: weakKeys,
    measuredModels,
    savedUsd,
    costMeasured: session.costMeasured,
    co2g,
    energyWh,
    version: PACKAGE_VERSION,
    currency,
    source,
    paths: { ledger: ledgerPath(), sessions: sessionsDir(), usageDb: usageDbPath() },
  };
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

/** Every billed bucket, so a model sorts by how much of the estimate it carries. */
function tokenTotal(t: TokenBreakdown): number {
  return t.input + t.output + t.cacheRead + t.cacheWrite;
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

const ROW_CAP = 15;

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

// Box-drawing table, plain text (piped-safe, byte-stable). Numeric columns right-align; long cells truncate with an ellipsis. Shared with cli/settings.ts.
function textTable(headers: string[], rows: string[][], right: boolean[] = [], maxW = 32): string[] {
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
  console.log(`\n=== Tersio Usage v${report.version} · ${fmt(report.messages)} msgs · ${report.source} ===`);
  if (report.empty) {
    console.log('  No ledger rows or session tokens yet — run session commands first.');
    return;
  }
  const t = report.tokens;
  const a = report.rtkAdoption;
  // A tier that is not firm is named, so a figure that is partly a guess never reads as a bill.
  const weak = ['tail', 'default'].reduce((sum, tier) => sum + (report.priceTiers[tier] ?? 0), 0);
  const overridden = report.priceTiers.override ?? 0;
  // The count stays in the cell; the names go on their own line below, because the cell is a
  // fixed 118 columns and a list of model ids would be truncated to nothing.
  const listed = report.weakModels.map((m) => displayModelId(m));
  const measuredCount = report.measuredModels.length;
  const costNote = weak > 0
    ? ` · ${weak} model${weak === 1 ? '' : 's'} priced from another provider or the default table — add them to ${pricesOverridePath()}`
    : overridden > 0
      ? ` · ${overridden} model${overridden === 1 ? '' : 's'} priced from your override file`
      : measuredCount > 0
        ? ` · ${measuredCount} model${measuredCount === 1 ? '' : 's'} priced by the host`
        : '';
  for (const l of textTable(['Metric', 'Value'], [
    ['Tokens', `${fmt(t.input)} in · ${fmt(t.output)} out · ${fmt(t.cacheRead)} cache read · ${fmt(t.cacheWrite)} cache write`],
    ['Cost', `${formatCurrency(report.usd, report.currency)}${report.priced ? '' : ' (includes default pricing)'} · ~${formatCurrency(report.savedUsd, report.currency)} cache-saved (est.) · ~${report.co2g.toFixed(1)}g CO2 (est.)${costNote}`],
    ['RTK adoption', `${fmt(a.rtkCalls)}/${fmt(a.eligibleCalls)} eligible Bash calls use RTK (${a.adoptionPct.toFixed(1)}%) · ${fmt(a.missedCalls)} missed · recall ${report.rtkRecall.available ? `${report.rtkRecall.mode} (${report.rtkRecall.entries})` : 'unavailable'}`],
  ], [false, false], 118)) console.log(l);
  if (measuredCount > 0) {
    // Named, because a measured figure is only worth trusting when a reader sees whose it is.
    console.log(`  Priced by the host: ${measuredCount} model${measuredCount === 1 ? '' : 's'}`);
  }
  if (weak > 0) {
    // Heaviest first, one per host spelling, so the operator sees exactly what to write.
    console.log(`  Unpriced (heaviest first): ${listed.join(', ')}`);
  }
  const allModels = Object.entries(report.byModel).filter(([, b]) => b.input + b.output + b.cacheRead + b.cacheWrite > 0).sort((a, b) => (b[1].input + b[1].output) - (a[1].input + a[1].output));
  const models = allModels.slice(0, ROW_CAP);
  if (models.length) {
    console.log('  BY MODEL');
    const top = models.reduce((m, [, b]) => Math.max(m, b.input + b.output + b.cacheRead + b.cacheWrite), 1);
    const mrows = models.map(([model, b]) => {
      const mt = b.input + b.output + b.cacheRead + b.cacheWrite;
      const hit = b.input + b.cacheRead ? (b.cacheRead / (b.input + b.cacheRead)) * 100 : 0;
      const usd = report.byModelUsd[model] ?? 0;
      return [model, fmt(b.input), fmt(b.output), `${fmt(b.cacheRead)}/${fmt(b.cacheWrite)}`, formatCurrency(usd, report.currency), `${hit.toFixed(1)}%`, `${bar(mt / top, 8)} ${fmtShort(mt)}`];
    });
    for (const l of textTable(['Model', 'Input', 'Output', 'Cache r/w', report.currency, 'Hit', 'Share'], mrows, [false, true, true, true, true, true, false])) {
      console.log(l);
    }
    if (allModels.length > ROW_CAP) console.log(`  showing top ${ROW_CAP} of ${fmt(allModels.length)} models — full set in the dashboard`);
  }
  const agentKinds = Object.entries(report.byAgent).filter(([, per]) => per.msgs > 0).toSorted((x, y) => y[1].msgs - x[1].msgs);
  if (agentKinds.length > 1) {
    console.log('  BY AGENT');
    const top = agentKinds.reduce((m, [, per]) => Math.max(m, per.tokens.input + per.tokens.output + per.tokens.cacheRead + per.tokens.cacheWrite), 1);
    const arows = agentKinds.map(([kind, per]) => {
      const total = per.tokens.input + per.tokens.output + per.tokens.cacheRead + per.tokens.cacheWrite;
      return [kind === 'subagent' ? 'Subagents' : 'Main agent', fmt(per.msgs), fmt(per.tokens.input), fmt(per.tokens.output), fmt(per.tokens.cacheRead), `${bar(total / top, 8)} ${fmtShort(total)}`];
    });
    for (const line of textTable(['Agent', 'Msgs', 'Input', 'Output', 'Cache read', 'Share'], arows, [false, true, true, true, true, false])) {
      console.log(line);
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
      ? `  COMMAND TOOLS  ${fmt(cmdRows.length)} commands · ${fmt(g.commands)} runs · ${fmtShort(g.saved)} saved`
      : '  COMMAND TOOLS';
    console.log(scope);
    const top = cmdRows.reduce((m, r) => Math.max(m, r.count), 1);
    const crows = cmdRows.slice(0, ROW_CAP).map((r, idx) => [
      String(idx + 1),
      r.name,
      fmt(r.count),
      r.saved === null ? '–' : fmtShort(r.saved),
      r.avgPct === null ? '–' : `${r.avgPct.toFixed(1)}%`,
      r.avgMs === null ? '–' : fmtMs(r.avgMs),
      bar(r.count / top, 8),
    ]);
    for (const l of textTable(['#', 'Tool/Command', 'Count', 'Saved', 'Avg%', 'Time', 'Impact'], crows, [true, false, true, true, true, true, false], 30)) {
      console.log(l);
    }
    if (cmdRows.length > ROW_CAP) console.log(`  showing top ${ROW_CAP} of ${fmt(cmdRows.length)} commands — full set in the dashboard`);
  }
}

async function runUsage(): Promise<void> {
  const report = await withInteractiveSpinner('Reading usage ledger', async () => summarizeUsage(readUsage()));
  printReport(report);
}

export { runUsage, textTable };
