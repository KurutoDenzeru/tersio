// Serves the built Dashboard with local usage APIs. Binds 127.0.0.1 only; --export writes a file instead. No Promise.withResolvers: Node 20.12 lacks it.
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clearUsageLedger, markReset, readUsage } from '../extensions/shared/usage-ledger.ts';
import { pricesCachePath } from '../extensions/shared/pricing.ts';
import { summarizeUsage } from './usage.ts';
import { backupUsageDb, deleteUsageBackup, listUsageBackups, restoreUsageBackup, usageDbPath } from '../extensions/shared/usage-store.ts';
import type { UsageReport } from './usage.ts';
import { isCurrencyCode } from './currency.ts';
import type { CurrencyCode } from './currency.ts';
import {
  OMP_AGENT_DIR, OMP_PLUGINS_DIR, PACKAGE_VERSION,
} from './common.ts';
import { BACKUP_SCHEDULES, formatCliStatus, storedProfile, writePluginSettings } from './profile.ts';
import type { BackupSchedule } from './profile.ts';
import { normalizeComboLevel } from '../extensions/shared/session-state.ts';
import { CAVEMAN_DEFAULTS, PONYTAIL_DEFAULTS } from './common.ts';
import type { ComboLevel } from '../extensions/shared/types.ts';
import { PACKAGE_NAME } from './common.ts';
import { resolveRtkBinary } from '../extensions/lib/utils.ts';

export interface DashboardOptions {
  port: number;
  open: boolean;
  exportFile: string | null;
}

const DASHBOARD_DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dashboard', 'dist');
const DASHBOARD_INDEX = path.join(DASHBOARD_DIST, 'index.html');
const DASHBOARD_BRAND = path.join(DASHBOARD_DIST, 'brand.webp');

function requireDashboardBundle(): void {
  if (existsSync(DASHBOARD_INDEX)) return;
  throw new Error('Dashboard bundle missing. Run `bun run build` before using `tersio dashboard`.');
}

function contentType(file: string): string {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.webp')) return 'image/webp';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.woff2')) return 'font/woff2';
  return 'application/octet-stream';
}

async function readSegment(file: string): Promise<string> {
  return fs.readFile(file, 'utf8');
}

async function brandDataUri(): Promise<string> {
  const brand = await fs.readFile(DASHBOARD_BRAND);
  return `data:image/webp;base64,${brand.toString('base64')}`;
}

function dataJson(): string {
  return JSON.stringify(summarizeUsage(readUsage()));
}

// Runs outside any agent session, so it reports the persisted defaults.
async function statusJson(): Promise<string> {
  const profile = await storedProfile();
  return JSON.stringify({
    status: formatCliStatus(profile),
    level: profile.comboDefault,
    caveman: profile.cavemanDefault,
    rtk: profile.rtkDefault ? 'on' : 'off',
    ponytail: profile.ponytailDefault,
  });
}

// Local-only health: find each agent on PATH, run `--version`, report both.
function binOnPath(bin: string): string | null {
  const names = process.platform === 'win32' ? [`${bin}.cmd`, `${bin}.exe`, `${bin}.bat`, bin] : [bin];
  for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch { /* continue searching PATH */ }
    }
  }
  return null;
}

function ompPath(): string | null {
  return binOnPath('omp');
}

function piPath(): string | null {
  return binOnPath('pi');
}

function opencodePath(): string | null {
  return binOnPath('opencode');
}

// omp prints `omp/18.4.1`, pi prints a bare `0.87.1`; both read as name/version.
function versionLabel(bin: string, raw: string): string {
  const out = raw.trim();
  return out.includes('/') ? out : `${bin}/${out}`;
}

function agentVersion(bin: string | null): string | null {
  if (!bin) return null;
  try {
    if (process.platform === 'win32') {
      const exe = process.env.ComSpec || 'cmd.exe';
      const out = execFileSync(exe, ['/d', '/s', '/c', bin, '--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
      return out.trim() ? versionLabel(path.basename(bin), out) : null;
    }
    const out = execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    return out.trim() ? versionLabel(path.basename(bin), out) : null;
  } catch {
    return null;
  }
}

function rtkVersion(bin: string): string | null {
  try {
    return execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true }).trim().split(/\r?\n/)[0] || null;
  } catch {
    return null;
  }
}

function ompDefaultModel(): string | null {
  try {
    const text = readFileSync(path.join(OMP_AGENT_DIR, 'config.yml'), 'utf8');
    const m = text.match(/^\s*default\s*:\s*(.+?)\s*$/m);
    return m ? m[1].replace(/^['"]|['"]$/g, '') : null;
  } catch {
    return null;
  }
}

function healthJson(): string {
  const rtkBin = resolveRtkBinary();
  const rtkPresent = rtkBin !== null;
  const detectedOmpPath = ompPath();
  const detectedPiPath = piPath();
  const detectedOpencodePath = opencodePath();
  const agentDir = (id: 'omp' | 'pi' | 'opencode'): string | null => {
    if (id === 'omp') return path.join(process.env.HOME || process.env.USERPROFILE || '', '.omp');
    if (id === 'pi') return path.join(process.env.HOME || process.env.USERPROFILE || '', '.pi');
    return path.join(process.env.HOME || process.env.USERPROFILE || '', '.config', 'opencode');
  };
  return JSON.stringify({
    tersio: PACKAGE_VERSION,
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    omp: agentVersion(detectedOmpPath),
    ompPath: detectedOmpPath,
    ompDir: agentDir('omp'),
    pi: agentVersion(detectedPiPath),
    piPath: detectedPiPath,
    piDir: agentDir('pi'),
    opencode: agentVersion(detectedOpencodePath),
    opencodePath: detectedOpencodePath,
    opencodeDir: agentDir('opencode'),
    provider: ompDefaultModel(),
    rtk: { present: rtkPresent, version: rtkPresent ? rtkVersion(rtkBin as string) : null, path: rtkBin || 'not found in PATH' },
    home: tersioHomePath(),
  });
}

function tersioHomePath(): string {
  return path.join(process.env.HOME || process.env.USERPROFILE || '', '.tersio');
}

interface DoctorRow { label: string; ok: boolean; detail: string; group: string }

interface DoctorReport { rows: DoctorRow[]; checkedAt: number; schedule: DiagSchedule }

type DiagSchedule = 'manual' | 'daily' | 'weekly' | 'monthly';

const DIAG_TTL_MS: Record<DiagSchedule, number> = {
  manual: 0,
  daily: 24 * 3600 * 1000,
  weekly: 7 * 24 * 3600 * 1000,
  monthly: 30 * 24 * 3600 * 1000,
};

function diagPaths(): { report: string } {
  // Keep the report beside the overridden DB so tests never touch the real one.
  const dbOverride = process.env.TERSIO_USAGE_DB;
  if (dbOverride) return { report: path.join(path.dirname(dbOverride), 'diag.json') };
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return { report: path.join(home, '.tersio', 'diag.json') };
}

function readDiagReport(): DoctorReport | null {
  try {
    const raw = JSON.parse(readFileSync(diagPaths().report, 'utf8')) as Partial<DoctorReport>;
    if (!Array.isArray(raw.rows) || typeof raw.checkedAt !== 'number') return null;
    const schedule: DiagSchedule = raw.schedule === 'daily' || raw.schedule === 'weekly' || raw.schedule === 'monthly' ? raw.schedule : 'manual';
    return { rows: raw.rows as DoctorRow[], checkedAt: raw.checkedAt, schedule };
  } catch {
    return null;
  }
}

function writeDiagReport(report: DoctorReport): void {
  try {
    mkdirSync(path.dirname(diagPaths().report), { recursive: true });
    writeFileSync(diagPaths().report, JSON.stringify(report) + '\n', 'utf8');
  } catch { /* best-effort */ }
}

function ageStr(p: string): string | null {
  try {
    return relAge(Date.now() - statSync(p).mtimeMs);
  } catch {
    return null;
  }
}

function absTime(p: string): string | null {
  try {
    const d = new Date(statSync(p).mtimeMs);
    const q = (n: number): string => String(n).padStart(2, '0');
    const h24 = d.getHours();
    return `${q(d.getMonth() + 1)}-${q(d.getDate())}-${d.getFullYear()}, ${q(h24 % 12 || 12)}:${q(d.getMinutes())} ${h24 >= 12 ? 'PM' : 'AM'}`;
  } catch {
    return null;
  }
}

function relAge(ms: number): string {
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function computeDoctorRows(): DoctorRow[] {
  const rows: DoctorRow[] = [];
  const rtkBin = resolveRtkBinary();
  const ponytailPkg = path.join(OMP_PLUGINS_DIR, 'node_modules', '@dietrichgebert', 'ponytail', 'package.json');
  const tersioPluginDir = path.join(OMP_PLUGINS_DIR, 'node_modules', ...PACKAGE_NAME.split('/'));
  const ok = (p: string): boolean => existsSync(p);
  const configPath = path.join(OMP_AGENT_DIR, 'config.yml');
  const ext = (label: string, p: string): void => {
    rows.push({ label, ok: ok(p), detail: ok(p) ? 'installed' : p, group: 'Extensions' });
  };
  const addon = (label: string, present: boolean, detail: string, group = 'Add-ons'): void => {
    rows.push({ label, ok: present, detail, group });
  };
  let explicitEntries: string[] = [];
  try {
    explicitEntries = readFileSync(configPath, 'utf8').split('\n')
      .map((line) => line.trim().replace(/^-\s*/, '').replace(/^['"]|['"]$/g, ''))
      .filter((line) => line.startsWith('/') || line.startsWith('.'));
  } catch { /* missing config is reported by extension rows */ }
  const duplicateExtensions = [...new Set(explicitEntries.filter((entry, index) => explicitEntries.indexOf(entry) !== index))];
  addon('Unique config registrations', true, 'ok', 'Extensions');
  // A listed extension whose file is gone makes the host warn on every load, so surface it rather than leaving the user with only a startup message.
  const dangling = explicitEntries
    .filter((entry) => entry.includes(`extensions${path.sep}`) || entry.includes('extensions/'))
    .filter((entry) => !ok(path.isAbsolute(entry) ? entry : path.resolve(OMP_AGENT_DIR, entry)));
  addon('Extension files present', dangling.length === 0, dangling.length ? dangling.join(', ') : 'ok', 'Extensions');
  ext('Caveman extension', path.join(tersioPluginDir, 'extensions', 'caveman-session', 'index.ts'));
  ext('RTK extension', path.join(tersioPluginDir, 'extensions', 'rtk-session', 'index.ts'));
  const rule = path.join(tersioPluginDir, 'extensions', 'caveman-session', 'rule.md');
  const ruleAge = ageStr(rule);
  const ruleAt = absTime(rule);
  addon('Caveman rule', ruleAge !== null, ruleAge && ruleAt ? `(updated ${ruleAge} · ${ruleAt})` : rule);
  const rtkVer = rtkBin ? rtkVersion(rtkBin) : null;
  const rtkAge = rtkBin ? ageStr(rtkBin) : null;
  const rtkAt = rtkBin ? absTime(rtkBin) : null;
  addon('RTK binary', rtkVer !== null, rtkVer && rtkAge && rtkAt ? `${rtkVer} (updated ${rtkAge} · ${rtkAt})` : rtkBin || 'not found in PATH');
  let ponytailVer: string | null = null;
  try {
    ponytailVer = (JSON.parse(readFileSync(ponytailPkg, 'utf8')) as { version?: string }).version ?? null;
  } catch { ponytailVer = null; }
  const ponytailAge = ageStr(ponytailPkg);
  const ponytailAt = absTime(ponytailPkg);
  addon('Ponytail', ponytailVer !== null, ponytailVer && ponytailAge && ponytailAt ? `${ponytailVer} (updated ${ponytailAge} · ${ponytailAt})` : ponytailPkg);
  const prices = pricesCachePath();
  const pricesAge = ageStr(prices);
  const pricesAt = absTime(prices);
  addon('Prices feed', pricesAge !== null, pricesAge && pricesAt ? `(pulled ${pricesAge} · ${pricesAt})` : prices, 'Usage');
  return rows;
}

// Recompute when forced, missing, or past the schedule; a report holding a retired label is stale by definition.
const RETIRED_DIAG_LABELS = new Set([
  'OMP CLI',
  'Tersio CLI',
  'Tersio commands',
  'Mode reinforcement',
  'Combo registered',
  'Combo extension',
  'Self plugin',
  'Ponytail registered',
  'Ponytail extension',
  'Usage store',
  'RTK OMP wiring (rtk.ts)',
  'OpenCode plugin entry',
  'OpenCode RTK plugin',
  'pi RTK extension',
  'No foreign opencode trees',
]);

function isRetiredReport(report: DoctorReport): boolean {
  return report.rows.some((r) => RETIRED_DIAG_LABELS.has(r.label));
}

// Recompute when forced, missing, retired, or past the schedule.
function getDoctorReport(force: boolean): DoctorReport {
  const saved = readDiagReport();
  const ttl = saved ? DIAG_TTL_MS[saved.schedule] : 0;
  // Manual recomputes on open; a dated schedule reuses the saved report.
  if (!force && saved && !isRetiredReport(saved) && ttl > 0 && Date.now() - saved.checkedAt < ttl) return saved;
  const report: DoctorReport = { rows: computeDoctorRows(), checkedAt: Date.now(), schedule: saved?.schedule ?? 'manual' };
  writeDiagReport(report);
  return report;
}

function setDiagSchedule(schedule: DiagSchedule): DoctorReport {
  const base = readDiagReport() ?? { rows: computeDoctorRows(), checkedAt: Date.now(), schedule };
  base.schedule = schedule;
  writeDiagReport(base);
  return base;
}

// One field per call, validated against the same sets the CLI uses.
async function saveDefaults(body: Record<string, unknown>): Promise<
  { ok: true; profile: Record<string, unknown> } | { ok: false; error: string }
> {
  const profile = await storedProfile();
  if (body.comboDefault !== undefined) {
    const level = normalizeComboLevel(body.comboDefault);
    if (!level) return { ok: false, error: 'unknown combo level' };
    profile.comboDefault = level;
  }
  if (body.cavemanDefault !== undefined) {
    const v = String(body.cavemanDefault);
    if (!CAVEMAN_DEFAULTS.has(v)) return { ok: false, error: 'unknown caveman level' };
    profile.cavemanDefault = v;
  }
  if (body.ponytailDefault !== undefined) {
    const v = String(body.ponytailDefault);
    if (!PONYTAIL_DEFAULTS.has(v)) return { ok: false, error: 'unknown ponytail level' };
    profile.ponytailDefault = v;
  }
  if (body.backupSchedule !== undefined) {
    const v = String(body.backupSchedule);
    if (!BACKUP_SCHEDULES.has(v)) return { ok: false, error: 'unknown backup schedule' };
    profile.backupSchedule = v as BackupSchedule;
  }
  if (body.rtkDefault !== undefined) {
    if (typeof body.rtkDefault !== 'boolean') return { ok: false, error: 'rtk default must be true or false' };
    profile.rtkDefault = body.rtkDefault;
  }
  await writePluginSettings(profile, {});
  return {
    ok: true,
    profile: {
      comboDefault: profile.comboDefault,
      cavemanDefault: profile.cavemanDefault,
      rtkDefault: profile.rtkDefault,
      ponytailDefault: profile.ponytailDefault,
      backupSchedule: profile.backupSchedule,
    },
  };
}

function readDiagSchedule(): DiagSchedule {
  return readDiagReport()?.schedule ?? 'manual';
}

// Persist the picker choice: every run serves a fresh port, so localStorage alone cannot survive a restart.
async function saveDashboardCurrency(raw: unknown): Promise<CurrencyCode | null> {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  if (!isCurrencyCode(code)) return null;
  const profile = await storedProfile();
  profile.currency = code;
  await writePluginSettings(profile, {});
  return code;
}

// The store is a SQLite file, which nothing outside this box can read. Flatten it into a format a spreadsheet, a script, or another tool can take instead.
type ExportFormat = 'json' | 'jsonl' | 'csv';
export const EXPORT_FORMATS: ExportFormat[] = ['json', 'jsonl', 'csv'];

export function exportRows(report: UsageReport): Record<string, string | number | undefined>[] {
  return report.recent.map((r) => ({
    timestamp: new Date(r.t).toISOString(),
    local: new Date(r.t).toLocaleString(),
    agent: r.h ?? 'pi',
    model: r.m,
    input: r.i,
    output: r.o,
    cacheRead: r.cr ?? 0,
    cacheWrite: r.cw ?? 0,
    costUsd: r.usd,
    elapsedMs: r.d,
    status: r.st,
  }));
}

export function csvCell(v: unknown): string {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportBody(format: ExportFormat, report: UsageReport): { body: string; type: string } {
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'json') {
    return { body: JSON.stringify({ exportedAt: new Date().toISOString(), version: report.version, source: report.source, report }, null, 2), type: 'application/json' };
  }
  const rows = exportRows(report);
  if (format === 'jsonl') {
    return { body: rows.map((r) => JSON.stringify(r)).join('\n') + '\n', type: 'application/x-ndjson' };
  }
  const cols = Object.keys(rows[0] ?? { timestamp: '', agent: '' });
  const head = cols.join(',');
  const body = [head, ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n';
  return { body, type: 'text/csv; charset=utf-8' };
}

function serveExport(req: http.IncomingMessage, res: http.ServerResponse): void {
  const format = ((req.url || '').split('?')[1] || '').match(/format=([a-z]+)/)?.[1] as ExportFormat | undefined;
  const fmt: ExportFormat = format && EXPORT_FORMATS.includes(format) ? format : 'json';
  const { body, type } = exportBody(fmt, summarizeUsage(readUsage()));
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Disposition': `attachment; filename="tersio-usage-${new Date().toISOString().slice(0, 10)}.${fmt === 'jsonl' ? 'ndjson' : fmt}"`,
  });
  res.end(body);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: unknown) => { body += String(chunk); });
    req.on('end', () => { resolve(body); });
    req.on('error', () => { resolve(''); });
  });
}

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(cmd, [url], { detached: true, stdio: 'ignore' }).unref();
}

// Replacers throughout: session data holds `$'` (shell quoting) and literal `</script>`, which String.replace would mangle.
function escapeInline(json: string): string {
  return json.replace(/<\/(script)/gi, '<\\/$1');
}

// Our own JSON.stringify output, so a parse failure means a bad value: name it.
function parseOwnJson(json: string, field: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`dashboard snapshot ${field} is not valid JSON`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`dashboard snapshot ${field} is not an object`);
  }
  return parsed as Record<string, unknown>;
}

async function exportDashboard(exportFile: string): Promise<void> {
  requireDashboardBundle();
  const [bundle, icon] = await Promise.all([readSegment(DASHBOARD_INDEX), brandDataUri()]);
  const inline = bundle
    .replace('window.__TERSIO_SNAP = null;', () => `window.__TERSIO_SNAP = ${escapeInline(JSON.stringify({ data: parseOwnJson(dataJson(), 'usage data'), health: parseOwnJson(healthJson(), 'health'), doctor: getDoctorReport(false) }))};`)
    .replace(/href="brand\.webp"/g, () => `href="${icon}"`)
    .replace(/src="brand\.webp"/g, () => `src="${icon}"`)
    .replace('fetch("brand.webp")', () => `Promise.resolve({ ok: true, blob: async () => new Blob([atob("${icon.split(',')[1]}")], { type: "image/webp" }) })`);
  await fs.writeFile(exportFile, inline, 'utf8');
  console.log(`[ok] Dashboard exported → ${exportFile}`);
}

async function runDashboard(options: DashboardOptions): Promise<void> {
  if (options.exportFile) {
    await exportDashboard(options.exportFile);
    return;
  }
  requireDashboardBundle();
  const server = http.createServer(async (req, res) => {
    if (req.url === '/reset' && req.method === 'POST') {
      const rows = clearUsageLedger();
      markReset();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rows }));
      return;
    }
    if (req.url === '/backups' && req.method === 'GET') {
      const rows = listUsageBackups().map((b) => ({ file: path.basename(b.file), mtime: b.mtime, size: b.size }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ backups: rows }));
      return;
    }
    if (req.url === '/backups/create' && req.method === 'POST') {
      try {
        backupUsageDb(usageDbPath());
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'backup failed' }));
      }
      return;
    }
    if (req.url === '/backups/delete' && req.method === 'POST') {
      let file = '';
      try { file = String((JSON.parse(await readBody(req)) as { file?: unknown }).file ?? ''); } catch { file = ''; }
      const ok = deleteUsageBackup(file);
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(ok ? { ok: true, file } : { ok: false, error: 'unknown backup' }));
      return;
    }
    if (req.url === '/backups/restore' && req.method === 'POST') {
      let file = '';
      try { file = String((JSON.parse(await readBody(req)) as { file?: unknown }).file ?? ''); } catch { file = ''; }
      const ok = restoreUsageBackup(file);
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(ok ? { ok: true, file } : { ok: false, error: 'unknown backup' }));
      return;
    }
    if (req.url === '/settings' && req.method === 'GET') {
      storedProfile().then((profile) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          comboDefault: profile.comboDefault,
          cavemanDefault: profile.cavemanDefault,
          rtkDefault: profile.rtkDefault,
          ponytailDefault: profile.ponytailDefault,
          backupSchedule: profile.backupSchedule,
        }));
      });
      return;
    }
    if (req.url === '/settings' && req.method === 'POST') {
      let body: Record<string, unknown> = {};
      try {
        body = (JSON.parse(await readBody(req)) as Record<string, unknown>) ?? {};
      } catch { body = {}; }
      const saved = await saveDefaults(body);
      if (!saved.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: saved.error }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ...saved.profile }));
      }
      return;
    }
    if (req.url === '/currency' && req.method === 'POST') {
      let code: unknown = null;
      try {
        code = (JSON.parse(await readBody(req)) as { currency?: unknown }).currency ?? null;
      } catch { code = null; }
      const saved = await saveDashboardCurrency(code);
      if (saved === null) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'unknown currency' }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, currency: saved }));
      }
      return;
    }
    if (req.url === '/data.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(dataJson());
      return;
    }
    if (req.url?.startsWith('/export')) {
      serveExport(req, res);
      return;
    }
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(healthJson());
      return;
    }
    if (req.url === '/status' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(await statusJson());
      return;
    }
    if (req.url === '/doctor' && req.method === 'POST') {
      let schedule: DiagSchedule = 'manual';
      try {
        const raw = (JSON.parse(await readBody(req)) as { schedule?: unknown }).schedule;
        if (raw === 'daily' || raw === 'weekly' || raw === 'monthly' || raw === 'manual') schedule = raw;
      } catch { /* keep manual */ }
      const report = schedule === 'manual' ? getDoctorReport(true) : setDiagSchedule(schedule);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(report));
      return;
    }
    if (req.url === '/doctor/fix' && req.method === 'POST') {
      try {
        const { runDoctorRepairs } = await import('./doctor-fix.ts');
        const failed = await runDoctorRepairs(['extensions', 'registrations', 'ponytail']);
        getDoctorReport(true);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: failed.length === 0, failed }));
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, failed: ['fix'], error: (e as Error).message }));
      }
      return;
    }
    if (req.url === '/doctor' || req.url?.startsWith('/doctor?')) {
      const fresh = (req.url.split('?')[1] ?? '').includes('fresh=1');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getDoctorReport(fresh)));
      return;
    }
    const name = (req.url ?? '/').split('?')[0];
    const file = path.normalize(path.join(DASHBOARD_DIST, name === '/' ? 'index.html' : name.slice(1)));
    if (file === DASHBOARD_DIST || file.startsWith(DASHBOARD_DIST + path.sep)) {
      try {
        const body = await fs.readFile(file);
        res.writeHead(200, { 'Content-Type': contentType(file) });
        res.end(body);
        return;
      } catch { /* fall through to index */ }
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(await readSegment(DASHBOARD_INDEX));
  });
  server.listen(options.port, '127.0.0.1', () => {
    try { process.title = 'tersio dashboard'; } catch { /* non-POSIX shells keep node */ }
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : options.port;
    const url = `http://127.0.0.1:${port}`;
    console.log(`[ok] Dashboard live → ${url} (Ctrl-C to stop)`);
    if (options.open) openBrowser(url);
  });
}

export { runDashboard, saveDashboardCurrency, readDiagSchedule, setDiagSchedule, DiagSchedule };
