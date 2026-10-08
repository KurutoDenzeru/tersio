// cli/usage.ts — ledger + session-token usage report, tokscale-style.
import {
  co2GramsFor,
  displayModelId,
  energyWhFor,
  foldModelsByLabel,
  importSessionTokens,
  ledgerPath,
  priceFor,
  providerOf,
  readResetWatermark,
  readRtkAdoption,
  readRtkRecallDiagnostics,
  readUsage,
  refreshPricesIfStale,
  sessionsDir,
  usdCost,
} from '../extensions/shared/usage-ledger.ts';
import type { RecentRequest, RtkAdoption, RtkRecallDiagnostics, SessionTokens, TokenBreakdown, UsageRow } from '../extensions/shared/usage-ledger.ts';
import { resolveRtkBinary } from '../extensions/lib/utils.ts';
import { loadCatalog, providerLabels } from '../extensions/shared/pricing.ts';
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

/** A model the price feed does not cover, so its usage cannot be valued at public API rates. */
export interface UnpricedModel {
  model: string;
  tokens: number;
  messages: number;
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
  byDay: Record<string, TokenBreakdown>;
  byDayModel: Record<string, Record<string, number>>;
  /** Per-day, per-model tokens: the exact input to a model breakdown and a cost-over-time series. */
  byDayModelTokens: Record<string, Record<string, TokenBreakdown>>;
  /** Per-day requests per model, so the share chart can be request-based. */
  byDayModelRuns: Record<string, Record<string, number>>;
  /** Per-day tables, so a page can recompute its own numbers for the selected range. */
  byDayProvider: Record<string, Record<string, TokenBreakdown>>;
  byDayProject: Record<string, Record<string, TokenBreakdown>>;
  byDayErrors: Record<string, Record<string, number>>;
  /** Per-day failures per model key, so a model row can show its own error rate for the range. */
  byDayModelErrors: Record<string, Record<string, number>>;
  byDayTool: Record<string, Record<string, number>>;
  /** Vendor-reported cost per day. Empty when the host reported none. */
  byDayCost: Record<string, number>;
  /** API-equivalent cost per day, priced models only, so cost follows the selected range. */
  byDayApiUsd: Record<string, number>;
  /** Cache savings per day, priced models only. */
  byDaySavedUsd: Record<string, number>;
  /** API-equivalent cost per day per model label, so a model table follows the range. */
  byDayModelUsd: Record<string, Record<string, number>>;
  byTool: Array<[string, number]>;
  /** Provider totals are token-only: one provider spans models, so no single price applies. */
  byProvider: Array<[string, TokenBreakdown]>;
  byProject: Array<[string, TokenBreakdown]>;
  reasoning: number;
  /** Runs that did not end completed, by status. */
  errors: Record<string, number>;
  recent: RecentRequestRow[];
  rtkGain: RtkGain;
  rtkAdoption: RtkAdoption;
  rtkRecall: RtkRecallDiagnostics;
  /** API-equivalent total: priced models only. Unpriced usage is excluded, never defaulted. */
  usd: number;
  /** False when at least one model lacked a public price, so `usd` understates what was really spent. */
  priced: boolean;
  /** How many models had a public price, of how many ran. A sum without its coverage is not a figure. */
  pricingCoverage: { priced: number; total: number };
  /** Internal model key to display label, so every page names a model the same way. */
  modelLabels: Record<string, string>;
  /**
   * Catalogued rate per display label plus the provider that serves it, quoted per million tokens.
   * This is how a page shows where a price came from instead of only that one is missing.
   */
  modelRates: Record<string, { provider: string | null; known: boolean; input: number; output: number; cacheRead: number; cacheWrite: number }>;
  /** The pricing catalog's own size, so a coverage figure has a source behind it. */
  pricingCatalog: { providers: number; models: number; fetchedAt: number | null };
  /** Mean elapsed wall clock per model. Absent for a model that carried no duration. */
  latency: Record<string, { ms: number; n: number }>;
  /** Mean time to first token per model. OMP reports it; pi and opencode do not. */
  ttft: Record<string, { ms: number; n: number }>;
  /** Models with no public price. Excluded from `usd`, and listed so the gap stays visible. */
  unpriced: UnpricedModel[];
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
  let priced = true;
  // Counted by display label, not by internal key: two gateway keys can name one model, and
  // counting both would report a coverage figure the model table does not show.
  const labelSeen = new Set<string>();
  const labelPriced = new Set<string>();
  const unpricedByLabel = new Map<string, UnpricedModel>();
  let savedUsd = 0;
  // One name per model across every page, taken from the same helper the CLI prints with.
  const modelLabels: Record<string, string> = {};
  for (const model of Object.keys(session.byModel)) modelLabels[model] = displayModelId(model);
  // Where each price came from: the catalog's rate for the model, and the provider that serves it.
  const modelRates: UsageReport['modelRates'] = {};
  for (const [model, label] of Object.entries(modelLabels)) {
    const resolved = priceFor(model);
    modelRates[label] = {
      provider: providerOf(model) ?? null,
      known: resolved.known,
      input: resolved.price.input,
      output: resolved.price.output,
      cacheRead: resolved.price.cacheRead,
      cacheWrite: resolved.price.cacheWrite,
    };
  }
  const catalogEntries = providerLabels(loadCatalog());
  const pricingCatalog = {
    providers: catalogEntries.length,
    models: catalogEntries.reduce((n, entry) => n + entry.models, 0),
    fetchedAt: loadCatalog()?.fetchedAt ?? null,
  };
  const byModelUsd: Record<string, number> = {};
  const byModelBucketUsd: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {};
  const byHost: Record<string, Record<string, TokenBreakdown>> = {};
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
  for (const [model, t] of Object.entries(session.byModel)) {
    const c = usdCost(t, model);
    const label = displayModelId(model);
    if (c.priced) {
      labelPriced.add(label);
      usd += c.usd;
      byModelUsd[label] = (byModelUsd[label] ?? 0) + c.usd;
      byModelBucketUsd[label] ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      addTok(byModelBucketUsd[label], c.buckets);
      // Cache savings need a real input rate; a default rate would invent the figure.
      savedUsd += (t.cacheRead / 1e6) * priceFor(model).price.input;
    } else {
      // A model with no public price is N/A, not a Sonnet-rate estimate. Folded by label so one
      // model listed under two gateway ids is reported once.
      const row = unpricedByLabel.get(label) ?? { model: label, tokens: 0, messages: 0 };
      row.tokens += t.input + t.output + t.cacheRead + t.cacheWrite;
      row.messages += session.byModelMessages[model] ?? 0;
      unpricedByLabel.set(label, row);
    }
    labelSeen.add(label);
    for (const [host, hb] of Object.entries(session.byHost[model] ?? {})) {
      byHost[label] ??= {};
      byHost[label][host] ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      addTok(byHost[label][host], hb);
    }
    co2g += co2GramsFor(model, t.output);
    energyWh += energyWhFor(model, t.output);
  }
  for (const [day, per] of Object.entries(session.byDayModel)) {
    for (const [model, n] of Object.entries(per)) {
      const label = displayModelId(model);
      byDayModel[day] ??= {};
      byDayModel[day][label] = (byDayModel[day][label] ?? 0) + n;
    }
  }
  // Per-day money, so a range filter can show cost without holding the price table client-side.
  const byDayApiUsd: Record<string, number> = {};
  const byDaySavedUsd: Record<string, number> = {};
  const byDayModelUsd: Record<string, Record<string, number>> = {};
  for (const [day, per] of Object.entries(session.byDayModelTokens)) {
    let api = 0;
    let saved = 0;
    const perModelUsd: Record<string, number> = {};
    for (const [model, tb] of Object.entries(per)) {
      const c = usdCost(tb, model);
      // An unpriced model contributes to neither figure, for the same reason it is excluded above.
      if (!c.priced) continue;
      const label = displayModelId(model);
      api += c.usd;
      saved += (tb.cacheRead / 1e6) * priceFor(model).price.input;
      perModelUsd[label] = (perModelUsd[label] ?? 0) + c.usd;
    }
    byDayApiUsd[day] = api;
    byDaySavedUsd[day] = saved;
    byDayModelUsd[day] = perModelUsd;
  }
  const byTool = Object.entries(session.byTool).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const tot = (b: TokenBreakdown): number => b.input + b.output + b.cacheRead + b.cacheWrite;
  const byProvider = Object.entries(session.byProvider).sort((a, b) => tot(b[1]) - tot(a[1]));
  const byProject = Object.entries(session.byProject).sort((a, b) => tot(b[1]) - tot(a[1]));
  // Coverage is reported per display label, matching the model table and the unpriced list.
  const totalModels = labelSeen.size;
  const pricedModels = labelPriced.size;
  priced = totalModels > 0 && totalModels === pricedModels;
  const unpriced = [...unpricedByLabel.values()]
    .filter((row) => !labelPriced.has(row.model))
    .sort((a, b) => b.tokens - a.tokens);
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
    byDay: session.byDay,
    byDayModel,
    byDayModelTokens: session.byDayModelTokens,
    byDayModelRuns: session.byDayModelRuns,
    byDayProvider: session.byDayProvider,
    byDayProject: session.byDayProject,
    byDayErrors: session.byDayErrors,
    byDayModelErrors: session.byDayModelErrors,
    byDayTool: session.byDayTool,
    byDayCost: session.byDayCost,
    byDayApiUsd,
    byDaySavedUsd,
    byDayModelUsd,
    byTool,
    byProvider,
    byProject,
    reasoning: session.reasoning,
    errors: session.errors,
    recent: session.recent.map((r) => ({
      ...r,
      est: usdCost({ input: r.i, output: r.o, cacheRead: r.cr ?? 0, cacheWrite: r.cw ?? 0 }, r.m).usd,
    })),
    rtkGain: readRtkGain(RTK_COMMAND_ROWS, watermark || undefined),
    rtkAdoption: readRtkAdoption(),
    rtkRecall: readRtkRecallDiagnostics(resolveRtkBinary()),
    usd,
    priced,
    pricingCoverage: { priced: pricedModels, total: totalModels },
    modelLabels,
    modelRates,
    pricingCatalog,
    latency: session.latency,
    ttft: session.ttft,
    unpriced,
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

// A project's identifying part is the tail of its path, so cut the front: the plain table
// truncation keeps the shared prefix of every path and hides the one segment that differs.
function shortProject(p: string): string {
  const segs = p.split('/').filter(Boolean);
  return segs.length <= 2 ? p : `…/${segs.slice(-2).join('/')}`;
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
  const errors = report.errors.error ?? 0;
  const aborted = report.errors.aborted ?? 0;
  const notCompleted = errors + aborted;
  const donePct = report.messages ? ((report.messages - notCompleted) / report.messages) * 100 : 0;
  const rows: string[][] = [
    ['Tokens', `${fmt(t.input)} in · ${fmt(t.output)} out · ${fmt(t.cacheRead)} cache read · ${fmt(t.cacheWrite)} cache write${report.reasoning > 0 ? ` · ${fmt(report.reasoning)} reasoning` : ''}`],
    ['Cost', `${formatCurrency(report.usd, report.currency)} API-equivalent · ${formatCurrency(report.costMeasured, report.currency)} measured · ~${formatCurrency(report.savedUsd, report.currency)} cache-saved (est.) · ~${report.co2g.toFixed(1)}g CO2 (est.)`],
    ['Pricing', `${fmt(report.pricingCoverage.priced)}/${fmt(report.pricingCoverage.total)} models priced — unpriced usage is excluded from the API-equivalent total, never estimated`],
    ['Runs', `${fmt(report.messages - notCompleted)} completed (${donePct.toFixed(1)}%) · ${fmt(aborted)} aborted · ${fmt(errors)} error`],
    ['RTK adoption', `${fmt(a.rtkCalls)}/${fmt(a.eligibleCalls)} eligible Bash calls use RTK (${a.adoptionPct.toFixed(1)}%) · ${fmt(a.missedCalls)} missed · recall ${report.rtkRecall.available ? `${report.rtkRecall.mode} (${report.rtkRecall.entries})` : 'unavailable'}`],
  ];
  if (report.unpriced.length) {
    const names = report.unpriced.slice(0, 4).map((u) => u.model).join(', ');
    rows.push(['Unpriced', `${fmt(report.unpriced.length)} model(s) with no public price: ${names}${report.unpriced.length > 4 ? `, +${fmt(report.unpriced.length - 4)} more` : ''}`]);
  }
  for (const l of textTable(['Metric', 'Value'], rows, [false, false], 118)) console.log(l);
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
  // Provider and project carry the same shape, so one renderer covers both.
  const tokenTable = (title: string, entries: Array<[string, TokenBreakdown]>, label: string): void => {
    if (!entries.length) {
      console.log(`  ${title}  none captured yet`);
      return;
    }
    const totals = entries.map(([, b]) => b.input + b.output + b.cacheRead + b.cacheWrite);
    const top = Math.max(...totals, 1);
    console.log(`  ${title}  ${fmt(entries.length)} ${label.toLowerCase()}s · ${fmtShort(totals.reduce((x, y) => x + y, 0))} tokens`);
    const prows = entries.slice(0, ROW_CAP).map(([name, b], i) => [
      name,
      fmt(b.input),
      fmt(b.output),
      `${fmt(b.cacheRead)}/${fmt(b.cacheWrite)}`,
      `${bar(totals[i] / top, 8)} ${fmtShort(totals[i])}`,
    ]);
    for (const l of textTable([label, 'Input', 'Output', 'Cache r/w', 'Share'], prows, [false, true, true, true, false], 40)) {
      console.log(l);
    }
    if (entries.length > ROW_CAP) console.log(`  showing top ${ROW_CAP} of ${fmt(entries.length)} ${label.toLowerCase()}s`);
  };
  tokenTable('BY PROVIDER', report.byProvider, 'Provider');
  tokenTable('BY PROJECT', report.byProject.map(([p, b]) => [shortProject(p), b] as [string, TokenBreakdown]), 'Project');
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
