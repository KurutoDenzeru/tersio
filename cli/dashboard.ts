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
  OMP_AGENT_DIR, OMP_PLUGINS_DIR, PACKAGE_VERSION,
} from './common.ts';
import { storedProfile, writePluginSettings } from './profile.ts';
import { agentChoices, findHostBinary, readSelection, reportHosts } from './agents.ts';
import { HOSTS } from './agent-hosts.ts';
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

/** Bound on a version probe. One slow agent must not stall the whole pane. */
const VERSION_TIMEOUT_MS = 4000;

/**
 * `<bin> --version` for any host, with a short timeout. The dashboard reports a
 * version for every agent the user has installed, so this runs in parallel and
 * is bounded; an agent that hangs costs the timeout, not the pane.
 */
function hostVersion(bin: string): string | null {
  try {
    if (process.platform === 'win32') {
      const exe = process.env.ComSpec || 'cmd.exe';
      return execFileSync(exe, ['/d', '/s', '/c', bin, '--version'], { encoding: 'utf8', timeout: VERSION_TIMEOUT_MS, windowsHide: true }).trim() || null;
    }
    return execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: VERSION_TIMEOUT_MS, windowsHide: true }).trim() || null;
  } catch {
    return null;
  }
}

export { agentsJsonAsync as agentsJson };

/**
 * One row per supported agent for the dashboard's Connection pane. Reads the
 * same registry the installer does, so a host cannot appear here with wiring
 * the installer would not give it.
 *
 * Binary paths come from a PATH walk (no subprocess) and are resolved for every
 * host. Versions cost a spawn each, so they are only probed for hosts that
 * actually have a binary, and all of them run concurrently.
 */
async function agentsJsonAsync(
  home: string = process.env.HOME || process.env.USERPROFILE || '',
  env: NodeJS.ProcessEnv = process.env,
): Promise<Array<Record<string, unknown>>> {
  const selected = readSelection(home).hosts;
  const rows = new Map(reportHosts(selected, home).map((r) => [r.host.id, r]));
  // `env` is threaded through rather than read from process.env inside, so a
  // caller passing a sandbox home does not get the real machine's PATH back.
  const found = new Map(HOSTS.map((h) => [h.id, findHostBinary(h, env)]));
  const versions = new Map(await Promise.all(
    HOSTS.map(async (h) => {
      const bin = found.get(h.id) ?? null;
      return [h.id, bin ? hostVersion(bin) : null] as const;
    }),
  ));

  return agentChoices().map((choice) => {
    const binPath = found.get(choice.value) ?? null;
    // OMP is installed by its own plugin path, never by the generic emitters,
    // so it never appears in agents.json. Reporting it "Not selected" beside a
    // detected omp binary reads as a contradiction, so its row is computed from
    // the OMP install directly.
    if (choice.value === 'omp') return ompRow(home, binPath, versions.get('omp') ?? null);
    const row = rows.get(choice.value);
    const isSelected = selected.includes(choice.value);
    return {
      id: choice.value,
      label: choice.label,
      selected: isSelected,
      // Configured means every file this host needs is on disk.
      configured: isSelected && !!row && row.missing.length === 0,
      missing: row ? row.missing.length : 0,
      present: row ? row.present.length : 0,
      wiring: choice.hint,
      binPath,
      version: versions.get(choice.value) ?? null,
    };
  });
}

/**
 * What the OMP install actually wrote, which is the only honest source here.
 *
 * Paths are built from the same `home` as the rest of this function. The
 * module-level OMP_AGENT_DIR / OMP_PLUGINS_DIR constants resolve against the
 * real os.homedir(), so using them here would read the developer's own ~/.omp
 * regardless of the home the caller asked about.
 */
function ompRow(home: string, binPath: string | null, version: string | null): Record<string, unknown> {
  const present = [
    path.join(home, '.omp', 'agent', 'extensions', 'rtk.ts'),
    path.join(home, '.omp', 'plugins', 'node_modules', PACKAGE_NAME),
  ].filter((p) => {
    try {
      return existsSync(p);
    } catch {
      return false;
    }
  });
  return {
    id: 'omp',
    label: 'Oh My Pi (OMP)',
    selected: true,
    configured: present.length > 0,
    missing: 2 - present.length,
    present: present.length,
    wiring: 'plugin · live commands',
    binPath,
    version,
  };
}

async function healthJson(): Promise<string> {
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
    agents: await agentsJsonAsync(),
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

/** Any value that survives a JSON round trip. These payloads are re-inlined into the exported page. */
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/**
 * The payload inlined into an exported dashboard. Each sub-report is parsed
 * independently and degrades to null, so one bad report costs that panel
 * instead of failing the whole export.
 */
async function snapJson(): Promise<string> {
  const parse = (text: string): JsonValue => {
    try {
      // Boundary cast: the source is tersio's own JSON, and the value is
      // immediately re-serialized, so there is nothing to narrow further.
      return JSON.parse(text) as JsonValue;
    } catch {
      return null;
    }
  };
  return escapeInline(JSON.stringify({
    data: parse(dataJson()),
    health: parse(await healthJson()),
    doctor: getDoctorReport(false),
  }));
}

async function exportDashboard(exportFile: string): Promise<void> {
  requireDashboardBundle();
  const [bundle, icon, snap] = await Promise.all([readSegment(DASHBOARD_INDEX), brandDataUri(), snapJson()]);
  const inline = bundle
    .replace('window.__TERSIO_SNAP = null;', () => `window.__TERSIO_SNAP = ${snap};`)
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
      res.end(await healthJson());
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
