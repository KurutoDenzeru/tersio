// cli/dashboard.ts — gain dashboard. Serves the single plain-HTML
// template (no deps, no build) plus a /data.json endpoint from the ledger.
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
  BUN_BIN_DIR, OMP_AGENT_DIR, OMP_BIN, OMP_PLUGINS_DIR,
  PACKAGE_VERSION, RTK_BINARY_NAME,
} from './common.ts';
import { storedProfile, writePluginSettings } from './profile.ts';
import { withInteractiveSpinner } from './interactive.ts';

export interface DashboardOptions {
  port: number;
  open: boolean;
  exportFile: string | null;
}

const DASH_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dashboard');
const TEMPLATE = path.join(DASH_DIR, 'template.html');
const STYLES = path.join(DASH_DIR, 'styles.css');
const APP = path.join(DASH_DIR, 'app.js');
const BRAND = path.join(DASH_DIR, 'brand.webp');

async function readSegment(file: string): Promise<string> {
  return fs.readFile(file, 'utf8');
}

async function faviconDataUri(): Promise<string> {
  const png = await fs.readFile(BRAND);
  return `data:image/webp;base64,${png.toString('base64')}`;
}

function dataJson(): string {
  return JSON.stringify(summarizeUsage(readUsage()));
}

// Local-only health + diagnosis for the settings modal. No network: version
// probes run with short timeouts, file checks are existsSync.
function ompVersion(): string | null {
  try {
    const exe = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : OMP_BIN;
    const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'omp', '--version'] : ['--version'];
    return execFileSync(exe, args, { encoding: 'utf8', timeout: 5000, windowsHide: true }).trim() || null;
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
  const rtkBin = path.join(BUN_BIN_DIR, RTK_BINARY_NAME);
  const rtkPresent = existsSync(rtkBin);
  return JSON.stringify({
    tersio: PACKAGE_VERSION,
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    omp: ompVersion(),
    provider: ompDefaultModel(),
    rtk: { present: rtkPresent, version: rtkPresent ? rtkVersion(rtkBin) : null, path: rtkBin },
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
  const extDir = path.join(OMP_AGENT_DIR, 'extensions');
  const rtkBin = path.join(BUN_BIN_DIR, RTK_BINARY_NAME);
  const ponytailPkg = path.join(OMP_PLUGINS_DIR, 'node_modules', '@dietrichgebert', 'ponytail', 'package.json');
  const ok = (p: string): boolean => existsSync(p);
  const ext = (label: string, p: string): void => {
    rows.push({ label, ok: ok(p), detail: ok(p) ? 'installed' : p, group: 'Extensions' });
  };
  const addon = (label: string, present: boolean, detail: string): void => {
    rows.push({ label, ok: present, detail, group: 'Add-ons' });
  };
  ext('Caveman extension', path.join(extDir, 'caveman-session', 'index.ts'));
  ext('RTK extension', path.join(extDir, 'rtk-session', 'index.ts'));
  ext('Ponytail extension', path.join(OMP_PLUGINS_DIR, 'node_modules', '@dietrichgebert', 'ponytail', 'pi-extension', 'index.js'));
  const rule = path.join(extDir, 'caveman-session', 'rule.md');
  const ruleAge = ageStr(rule);
  const ruleAt = absTime(rule);
  addon('Caveman rule', ruleAge !== null, ruleAge && ruleAt ? `(updated ${ruleAge} · ${ruleAt})` : rule);
  const rtkVer = ok(rtkBin) ? rtkVersion(rtkBin) : null;
  const rtkAge = ageStr(rtkBin);
  const rtkAt = absTime(rtkBin);
  addon('RTK binary', rtkVer !== null, rtkVer && rtkAge && rtkAt ? `${rtkVer} (updated ${rtkAge} · ${rtkAt})` : rtkBin);
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
  addon('Prices feed', pricesAge !== null, pricesAge && pricesAt ? `(pulled ${pricesAge} · ${pricesAt})` : prices);
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
// `tersio gain` run serves a fresh ephemeral port (a new origin), so the
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

async function runDashboard(options: DashboardOptions): Promise<void> {
  if (options.exportFile) {
    const [template, css, js, icon] = await Promise.all([
      readSegment(TEMPLATE), readSegment(STYLES), readSegment(APP), faviconDataUri(),
    ]);
    // Replacer functions throughout: session data routinely contains `$'`
    // sequences (shell quoting in tool details), which String.replace would
    // expand as match-suffix patterns and corrupt the file.
    // RTK-metered command lines routinely contain literal `</script>` (Vue
    // SFC probes), which would close the inlined <script> early and dump the
    // rest of the JSON as page text. Escape it; JSON.parse never sees the
    // backslash form inside a string literal, the browser decodes it first.
    const inline = template
      .replace('<link rel="stylesheet" href="styles.css">', () => `<style>\n${css}</style>`)
      .replace('<script src="app.js" defer></script>', () => `<script>\n${js}</script>`)
      .replace('window.__TERSIO_SNAP = null;', () => `window.__TERSIO_SNAP = ${JSON.stringify({ health: JSON.parse(healthJson()), doctor: getDoctorReport(false) }).replace(/<\/(script)/gi, '<\\/$1')};`)
      .replace(
        "fetch('data.json')",
        () => `Promise.resolve({ json: function () { return ${dataJson().replace(/<\/(script)/gi, '<\\/$1')}; } })`,
      )
      // Exported file runs on file:// where load() early-returns before the
      // stub above ever runs, so nothing ever renders. Drop that guard in
      // the export only; template.html keeps it to avoid 404 polling loops.
      .replace("if (window.location.protocol === 'file:') return;", () => `if (false) return;`)
      .replace('href="brand.webp"', () => `href="${icon}"`)
      .replace('src="brand.webp"', () => `src="${icon}"`);
    await fs.writeFile(options.exportFile, inline, 'utf8');
    console.log(`[ok] gain exported → ${options.exportFile}`);
    return;
  }
  const html = await withInteractiveSpinner('Loading dashboard template', () => readSegment(TEMPLATE));
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
    if (req.url === '/styles.css') {
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
      res.end(await readSegment(STYLES));
      return;
    }
    if (req.url === '/app.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      res.end(await readSegment(APP));
      return;
    }
    if (req.url === '/brand.webp') {
      try {
        const png = await fs.readFile(BRAND);
        res.writeHead(200, { 'Content-Type': 'image/webp' });
        res.end(png);
      } catch {
        res.writeHead(404);
        res.end();
      }
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  server.listen(options.port, '127.0.0.1', () => {
    try { process.title = 'tersio gain'; } catch { /* non-POSIX shells keep node */ }
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : options.port;
    const url = `http://127.0.0.1:${port}`;
    console.log(`[ok] gain live → ${url} (Ctrl-C to stop)`);
    if (options.open) openBrowser(url);
  });
}

export { runDashboard, saveDashboardCurrency, readDiagSchedule, setDiagSchedule, DiagSchedule };
