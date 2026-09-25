// cli/dashboard.ts — serves the built shadcn Dashboard with local usage APIs.
// Binds 127.0.0.1 only; --export writes a file://-ready file instead.
// Note: no Promise.withResolvers here — engines still allow Node 20.12,
// which lacks it; the listening server itself keeps the process alive.
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
import { isCurrencyCode } from './currency.ts';
import type { CurrencyCode } from './currency.ts';
import {
  OMP_AGENT_DIR, OMP_PLUGINS_DIR, PACKAGE_VERSION, relTime, absDate,
} from './common.ts';
import { storedProfile, writePluginSettings } from './profile.ts';
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

// Local-only health + diagnosis for the settings modal. No network: version
// probes run with short timeouts, file checks are existsSync.
function ompPath(): string | null {
  const names = process.platform === 'win32' ? ['omp.cmd', 'omp.exe', 'omp.bat', 'omp'] : ['omp'];
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

function ompVersion(bin = ompPath()): string | null {
  if (!bin) return null;
  try {
    if (process.platform === 'win32') {
      const exe = process.env.ComSpec || 'cmd.exe';
      return execFileSync(exe, ['/d', '/s', '/c', bin, '--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true }).trim() || null;
    }
    return execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true }).trim() || null;
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
  return JSON.stringify({
    tersio: PACKAGE_VERSION,
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    omp: ompVersion(detectedOmpPath),
    ompPath: detectedOmpPath,
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
  // Hermetic env (tests) overrides the DB path: keep the report next to it
  // so test runs never touch the real ~/.tersio/diag.json.
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
    return relTime(Date.now() - statSync(p).mtimeMs);
  } catch {
    return null;
  }
}

function absTime(p: string): string | null {
  try {
    return absDate(statSync(p).mtimeMs);
  } catch {
    return null;
  }
}

function computeDoctorRows(): DoctorRow[] {
  const rows: DoctorRow[] = [];
  const extDir = path.join(OMP_AGENT_DIR, 'extensions');
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
  addon('Unique config registrations', duplicateExtensions.length === 0, duplicateExtensions.length ? duplicateExtensions.join(', ') : 'ok', 'Extensions');
  const retiredReinforcement = explicitEntries.filter((entry) => entry.endsWith('/shared/mode-reinforcement.ts')).length;
  addon('No retired reinforcement', retiredReinforcement === 0, retiredReinforcement ? `${retiredReinforcement} registration(s)` : 'ok', 'Extensions');
  ext('Caveman extension', path.join(tersioPluginDir, 'extensions', 'caveman-session', 'index.ts'));
  ext('RTK extension', path.join(tersioPluginDir, 'extensions', 'rtk-session', 'index.ts'));
  ext('Ponytail extension', path.join(OMP_PLUGINS_DIR, 'node_modules', '@dietrichgebert', 'ponytail', 'pi-extension', 'index.js'));
  const rule = path.join(tersioPluginDir, 'extensions', 'caveman-session', 'rule.md');
  const ruleAge = ageStr(rule);
  const ruleAt = absTime(rule);
  addon('Caveman rule', ruleAge !== null, ruleAge && ruleAt ? `(updated ${ruleAge} · ${ruleAt})` : rule);
  const rtkVer = rtkBin ? rtkVersion(rtkBin) : null;
  const rtkAge = rtkBin ? ageStr(rtkBin) : null;
  const rtkAt = rtkBin ? absTime(rtkBin) : null;
  addon('RTK binary', rtkVer !== null, rtkVer && rtkAge && rtkAt ? `${rtkVer} (updated ${rtkAge} · ${rtkAt})` : rtkBin || 'not found in PATH');
  const wiring = path.join(extDir, 'rtk.ts');
  addon('RTK OMP wiring (rtk.ts)', ok(wiring), ok(wiring) ? 'loaded' : wiring);
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

// Retained diagnosis: recompute when forced, missing, or older than the
// schedule. Otherwise return the saved report so users never re-run.
// Labels retired from the report. A saved report containing any of them
// is stale by definition and always recomputes.
const RETIRED_DIAG_LABELS = new Set([
  'OMP CLI',
  'Tersio CLI',
  'Tersio commands',
  'Mode reinforcement',
  'Combo registered',
  'Combo extension',
  'Self plugin',
  'Ponytail registered',
  'Usage store',
]);

function isRetiredReport(report: DoctorReport): boolean {
  return report.rows.some((r) => RETIRED_DIAG_LABELS.has(r.label));
}

// Retained diagnosis: recompute when forced, missing, retired, or older
// than the schedule. Otherwise return the saved report.
function getDoctorReport(force: boolean): DoctorReport {
  const saved = readDiagReport();
  const ttl = saved ? DIAG_TTL_MS[saved.schedule] : 0;
  // Manual always recomputes on open; dated schedules reuse the saved
  // report until stale. Otherwise a retained snapshot hides new rows.
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

function readDiagSchedule(): DiagSchedule {
  return readDiagReport()?.schedule ?? 'manual';
}

// Persist the dashboard's picker choice so close → reopen keeps it: each
// `tersio dashboard` run serves a fresh ephemeral port (a new origin), so the
// browser's localStorage alone cannot survive a restart. The stored default
// feeds data.json and `tersio usage` on the next run.
async function saveDashboardCurrency(raw: unknown): Promise<CurrencyCode | null> {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  if (!isCurrencyCode(code)) return null;
  const profile = await storedProfile();
  profile.currency = code;
  await writePluginSettings(profile, {});
  return code;
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

// Replacer functions throughout: session data routinely contains `$'`
// sequences (shell quoting in tool details), which String.replace would
// expand as match-suffix patterns and corrupt the file.
// RTK-metered command lines routinely contain literal `</script>` (Vue
// SFC probes), which would close the inlined <script> early and dump the
// rest of the JSON as page text. Escape it; JSON.parse never sees the
// backslash form inside a string literal, the browser decodes it first.
function escapeInline(json: string): string {
  return json.replace(/<\/(script)/gi, '<\\/$1');
}

async function exportDashboard(exportFile: string): Promise<void> {
  requireDashboardBundle();
  const [bundle, icon] = await Promise.all([readSegment(DASHBOARD_INDEX), brandDataUri()]);
  const inline = bundle
    .replace('window.__TERSIO_SNAP = null;', () => `window.__TERSIO_SNAP = ${escapeInline(JSON.stringify({ data: JSON.parse(dataJson()), health: JSON.parse(healthJson()), doctor: getDoctorReport(false) }))};`)
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
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(healthJson());
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
