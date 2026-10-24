// Dashboard server + usage APIs. Binds 127.0.0.1; --export writes a file. No Promise.withResolvers (Node 20.12).
import { spawn } from 'node:child_process';
import { readActivity, recordActivity } from './activity.ts';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pricesCachePath } from '../extensions/shared/pricing.ts';
import { isCurrencyCode } from './currency.ts';
import type { CurrencyCode } from './currency.ts';
import {
  OMP_AGENT_DIR, OMP_PLUGINS_DIR, PACKAGE_VERSION,
} from './common.ts';
import { BACKUP_SCHEDULES, applyComboPreset, clampSidebarWidth, comboLevelOf, formatCliStatus, storedProfile, writePluginSettings } from './profile.ts';
import { patchState, readState, takeLegacy } from '../extensions/shared/state.ts';
import { REMOTE_MARKS } from '../extensions/shared/brand-marks.ts';
import { setUpdatePrefs, startApply, startCheck, startUpdateWatch, updateView } from './dashboard-update.ts';
import type { UpdatePrefs } from './dashboard-update.ts';
import type { BackupSchedule } from './profile.ts';
import { normalizeComboLevel } from '../extensions/shared/session-state.ts';
import { ACCENT_DEFAULTS, CAVEMAN_DEFAULTS, COMBO_PRESET_MODES, PONYTAIL_DEFAULTS, PSTACK_DEFAULTS } from './common.ts';
import type { ComboLevel } from '../extensions/shared/types.ts';
import { PACKAGE_NAME } from './common.ts';
import { detectHosts } from './hosts.ts';
import { findPackageRoot, resolveRtkBinary, ruleBodyProblem, tersioHome } from '../extensions/shared/utils.ts';
import { BACKUP_KEEP, backupDir, backupDiskBytes, createDataBackup, dataSources, deleteDataBackup, listDataBackups, restoreDataBackup } from '../extensions/shared/snapshots.ts';
import { resetCounts, resetStatistics } from './reset.ts';
import { CAVEMAN_PIN, cachedScorecard, refreshScorecard, upstreamHistory } from './upstream.ts';
import { readBackupSchedule, syncUsageDb } from '../extensions/shared/usage-store.ts';
import { agentDbPath, emptyRequestEntry, isAgentView, isRangeKey, readAgentRequestEntry, readAgentStats, readSessionTrace, statsDbPath } from '../extensions/shared/agent-stats.ts';
import type { AgentStats, AgentView, RangeKey } from '../extensions/shared/agent-stats.ts';

export interface DashboardOptions {
  port: number;
  open: boolean;
  exportFile: string | null;
  /** The resolved display currency: --currency, then the stored default, then USD. */
  currency: CurrencyCode;
}

const DASHBOARD_DIST = path.join(findPackageRoot(path.dirname(fileURLToPath(import.meta.url))), 'dashboard', 'dist');
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

/** The range a page opens on, matching the reference dashboard. */
const DEFAULT_AGENT_RANGE: RangeKey = '24h';

/** Poll memo TTL: every poll re-reads the aggregate, so a repeat poll reuses the last answer. */
const AGENT_REFRESH_MS = 5000;

/** A sync walks every transcript, so it runs at most this often even while a poll outruns it. */
const AGENT_SYNC_MS = 15_000;

let agentMemo: { range: RangeKey; view: AgentView; offset: number; stamp: string; at: number; value: AgentStats } | null = null;

let lastSyncAt = 0;

function fileStamp(file: string): string {
  try {
    const stat = statSync(file);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return '-';
  }
}

/** Both sources: the usage store carries every host's rows, agent.db only omp's quota snapshots. */
function storeStamp(): string {
  return `${fileStamp(statsDbPath())}|${fileStamp(agentDbPath())}`;
}

/** Syncs before reading past the throttle; without it a page misses pi and OpenCode rows. */
function agentStats(range: RangeKey, view: AgentView = 'all', offset = 0): AgentStats {
  const held = agentMemo;
  if (held && held.range === range && held.view === view && held.offset === offset && held.stamp === storeStamp() && Date.now() - held.at < AGENT_REFRESH_MS) {
    return held.value;
  }
  if (Date.now() - lastSyncAt >= AGENT_SYNC_MS) {
    lastSyncAt = Date.now();
    try {
      syncUsageDb();
    } catch { /* a store that will not write still reads the rows it already holds */ }
  }
  const value = readAgentStats(range, view, Date.now(), offset);
  agentMemo = { range, view, offset, stamp: storeStamp(), at: Date.now(), value };
  return value;
}

/** `?range=` on any of the omp routes; an unknown value falls back to the default. */
function queryParam(url: string, name: string): string | null {
  return (url.split('?')[1] ?? '').split('&').find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
}

function rangeFrom(url: string): RangeKey {
  const raw = queryParam(url, 'range');
  return isRangeKey(raw) ? raw : DEFAULT_AGENT_RANGE;
}

function viewFrom(url: string): AgentView {
  const raw = queryParam(url, 'view');
  return isAgentView(raw) ? raw : 'all';
}

/** `?offset=` in whole rows, floored; a later page starts further back instead of clamping at the cap. */
function offsetFrom(url: string): number {
  const raw = queryParam(url, 'offset');
  const value = raw === null ? 0 : Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function agentJson(range: RangeKey, view: AgentView, offset: number): string {
  return JSON.stringify({ range, view, offset, agent: agentStats(range, view, offset) });
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
    pstack: profile.pstackDefault,
  });
}

/**
 * Run a host command in its own process: the installer the terminal runs, with the server free to
 * answer. The page polls /api/hosts until the host settles, because the child outlives the request.
 */
interface HostJob {
  action: 'install' | 'uninstall' | 'update';
  startedAt: number;
  /** `null` while the child runs, then its exit code. */
  code: number | null;
}

/** The last command run per host, so the guide can stop waiting the moment it exits. */
const hostJobs = new Map<string, HostJob>();

/** The favicon types the mark catalog uses, served as the type the bytes actually are. */
const MARK_TYPES: Readonly<Record<string, string>> = {
  svg: 'image/svg+xml', png: 'image/png', ico: 'image/x-icon', webp: 'image/webp', jpg: 'image/jpeg', gif: 'image/gif', avif: 'image/avif',
};
const MARK_EXTS = Object.keys(MARK_TYPES);
const MARK_EXT_OF_TYPE: Readonly<Record<string, string>> = {
  ...Object.fromEntries(Object.entries(MARK_TYPES).map(([ext, type]) => [type, ext])),
  'image/vnd.microsoft.icon': 'ico',
};

function spawnCli(command: 'install' | 'uninstall' | 'update', host: string): boolean {
  const entry = process.argv[1];
  if (!entry || !existsSync(entry)) return false;
  const runtime = entry.endsWith('.ts') ? 'bun' : process.execPath;
  const child = spawn(runtime, [entry, command, '--host', host, '--yes'], { detached: true, stdio: 'ignore' });
  const job: HostJob = { action: command, startedAt: Date.now(), code: null };
  hostJobs.set(host, job);
  const verb = `${command[0].toUpperCase()}${command.slice(1)}`;
  recordActivity('agent', `${verb} ${host} started`);
  child.on('exit', (code) => {
    job.code = code ?? 0;
    recordActivity('agent', `${verb} ${host} ${job.code === 0 ? 'finished' : 'failed'}`, undefined, job.code === 0);
  });
  child.on('error', (error) => {
    job.code = -1;
    recordActivity('agent', `${verb} ${host} failed`, error.message, false);
  });
  child.unref();
  return true;
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

function codexPath(): string | null {
  return binOnPath('codex');
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
  const detectedCodexPath = codexPath();
  const agentDir = (id: 'omp' | 'pi' | 'opencode' | 'codex'): string | null => {
    if (id === 'omp') return path.join(process.env.HOME || process.env.USERPROFILE || '', '.omp');
    if (id === 'pi') return path.join(process.env.HOME || process.env.USERPROFILE || '', '.pi');
    if (id === 'codex') return path.join(process.env.HOME || process.env.USERPROFILE || '', '.codex');
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
    codex: agentVersion(detectedCodexPath),
    codexPath: detectedCodexPath,
    codexDir: agentDir('codex'),
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

// The report lives in state.json; an overridden DB keeps it beside that DB so tests never touch the real home.
function diagReport(): DoctorReport | null {
  const raw = (process.env.TERSIO_USAGE_DB ? legacyDiag() : readState().diag ?? migratedDiag()) as Partial<DoctorReport> | undefined;
  if (!raw || !Array.isArray(raw.rows) || typeof raw.checkedAt !== 'number') return null;
  const schedule: DiagSchedule = raw.schedule === 'daily' || raw.schedule === 'weekly' || raw.schedule === 'monthly' ? raw.schedule : 'manual';
  return { rows: raw.rows as DoctorRow[], checkedAt: raw.checkedAt, schedule };
}

// The old report sat loose in the data home; read it once, then keep it in state.json.
function migratedDiag(): Partial<DoctorReport> | null {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const old = takeLegacy(path.join(home, '.tersio', 'diag.json'), (raw) => JSON.parse(raw) as Partial<DoctorReport>);
  if (old) patchState({ diag: old });
  return old;
}

function legacyDiag(): Partial<DoctorReport> | null {
  try {
    return JSON.parse(readFileSync(path.join(path.dirname(process.env.TERSIO_USAGE_DB as string), 'diag.json'), 'utf8')) as Partial<DoctorReport>;
  } catch {
    return null;
  }
}

function writeDiagReport(report: DoctorReport): void {
  if (process.env.TERSIO_USAGE_DB) {
    try {
      const file = path.join(path.dirname(process.env.TERSIO_USAGE_DB), 'diag.json');
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(report) + '\n', 'utf8');
    } catch { /* best-effort */ }
    return;
  }
  patchState({ diag: report });
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
  // A listed extension whose file is gone makes the host warn on every load, so surface it here.
  const dangling = explicitEntries
    .filter((entry) => entry.includes(`extensions${path.sep}`) || entry.includes('extensions/'))
    .filter((entry) => !ok(path.isAbsolute(entry) ? entry : path.resolve(OMP_AGENT_DIR, entry)));
  addon('Extension files present', dangling.length === 0, dangling.length ? dangling.join(', ') : 'ok', 'Extensions');
  ext('Caveman extension', path.join(tersioPluginDir, 'extensions', 'caveman', 'index.ts'));
  ext('pstack extension', path.join(tersioPluginDir, 'extensions', 'pstack', 'index.ts'));
  ext('RTK extension', path.join(tersioPluginDir, 'extensions', 'rtk', 'session.ts'));
  const rule = path.join(tersioPluginDir, 'extensions', 'caveman', 'rule.md');
  const ruleAge = ageStr(rule);
  const ruleAt = absTime(rule);
  // The body carries no version, so the release it came from is the number: the pinned one, or the one a pull recorded.
  const cavemanRelease = (readState().cavemanUpstream?.tag ?? CAVEMAN_PIN).replace(/^v/, '');
  addon('Caveman rule', ruleAge !== null, ruleAge && ruleAt ? `${cavemanRelease} (updated ${ruleAge} · ${ruleAt})` : rule);
  // The pstack body is a Tersio fork with no remote, so this row proves it is usable, not current.
  const pstackRule = path.join(tersioPluginDir, 'extensions', 'pstack', 'rule.md');
  let pstackProblem: string | null = 'missing — run: tersio install';
  try { pstackProblem = ruleBodyProblem(readFileSync(pstackRule, 'utf8')); } catch { /* missing stays */ }
  const pstackAge = ageStr(pstackRule);
  const pstackAt = absTime(pstackRule);
  addon('pstack rule', pstackProblem === null, pstackProblem ?? `(updated ${pstackAge} · ${pstackAt})`);
  const rtkVer = rtkBin ? rtkVersion(rtkBin) : null;
  const rtkAge = rtkBin ? ageStr(rtkBin) : null;
  const rtkAt = rtkBin ? absTime(rtkBin) : null;
  addon('RTK binary', rtkVer !== null, rtkVer && rtkAge && rtkAt ? `${rtkVer} (updated ${rtkAge} · ${rtkAt})` : rtkBin || 'not found in PATH');
  // Ponytail rides inside the plugin now, so the version comes from the vendored copy, not a sibling package.
  const ponytailPkg = path.join(tersioPluginDir, 'extensions', 'ponytail', 'package.json');
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

// A report holding any of these labels is stale by definition.
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

// Recompute when forced, missing, retired, or past schedule; manual schedules recompute on open, dated ones reuse.
function getDoctorReport(force: boolean): DoctorReport {
  const saved = diagReport();
  const ttl = saved ? DIAG_TTL_MS[saved.schedule] : 0;
  if (!force && saved && !isRetiredReport(saved) && ttl > 0 && Date.now() - saved.checkedAt < ttl) return saved;
  const report: DoctorReport = { rows: computeDoctorRows(), checkedAt: Date.now(), schedule: saved?.schedule ?? 'manual' };
  writeDiagReport(report);
  return report;
}

function setDiagSchedule(schedule: DiagSchedule): DoctorReport {
  const base = diagReport() ?? { rows: computeDoctorRows(), checkedAt: Date.now(), schedule };
  base.schedule = schedule;
  writeDiagReport(base);
  return base;
}

// One field per call, validated against the same sets the CLI uses.
async function saveDefaults(body: Record<string, unknown>): Promise<
  { ok: true; profile: Record<string, unknown> } | { ok: false; error: string }
> {
  const profile = await storedProfile();
  const events: string[] = [];
  if (body.comboDefault !== undefined) {
    const level = normalizeComboLevel(body.comboDefault);
    // A preset level only: `custom` is what the three modes say, never a level to write.
    if (!level || !Object.hasOwn(COMBO_PRESET_MODES, level)) return { ok: false, error: 'unknown combo level' };
    Object.assign(profile, applyComboPreset(profile, level));
    events.push(`Combo preset to ${level}`);
  }
  if (body.cavemanDefault !== undefined) {
    const v = String(body.cavemanDefault);
    if (!CAVEMAN_DEFAULTS.has(v)) return { ok: false, error: 'unknown caveman level' };
    profile.cavemanDefault = v;
    events.push(`Caveman to ${v}`);
  }
  if (body.ponytailDefault !== undefined) {
    const v = String(body.ponytailDefault);
    if (!PONYTAIL_DEFAULTS.has(v)) return { ok: false, error: 'unknown ponytail level' };
    profile.ponytailDefault = v;
    events.push(`Ponytail to ${v}`);
  }
  if (body.pstackDefault !== undefined) {
    const v = String(body.pstackDefault);
    if (!PSTACK_DEFAULTS.has(v)) return { ok: false, error: 'unknown pstack level' };
    profile.pstackDefault = v;
    events.push(`pstack to ${v}`);
  }
  if (body.backupSchedule !== undefined) {
    const v = String(body.backupSchedule);
    if (!BACKUP_SCHEDULES.has(v)) return { ok: false, error: 'unknown backup schedule' };
    profile.backupSchedule = v as BackupSchedule;
  }
  if (body.rtkDefault !== undefined) {
    if (typeof body.rtkDefault !== 'boolean') return { ok: false, error: 'rtk default must be true or false' };
    profile.rtkDefault = body.rtkDefault;
    events.push(`RTK to ${body.rtkDefault ? 'on' : 'off'}`);
  }
  if (body.devTools !== undefined) {
    if (typeof body.devTools !== 'boolean') return { ok: false, error: 'devTools must be true or false' };
    profile.devTools = body.devTools;
  }
  if (body.accent !== undefined) {
    const v = String(body.accent);
    if (!ACCENT_DEFAULTS.has(v)) return { ok: false, error: 'unknown accent' };
    profile.accent = v;
    events.push(`Accent to ${v}`);
  }
  if (body.sidebarWidth !== undefined) {
    if (typeof body.sidebarWidth !== 'number') return { ok: false, error: 'sidebarWidth must be a number' };
    // A drag changes it often, so it is saved without an activity line.
    profile.sidebarWidth = clampSidebarWidth(body.sidebarWidth);
  }
  await writePluginSettings(profile, {});
  for (const title of events) recordActivity('mode', title, 'Applies to new sessions.');
  return {
    ok: true,
    profile: {
      comboDefault: profile.comboDefault,
      cavemanDefault: profile.cavemanDefault,
      rtkDefault: profile.rtkDefault,
      ponytailDefault: profile.ponytailDefault,
      pstackDefault: profile.pstackDefault,
      backupSchedule: profile.backupSchedule,
      devTools: profile.devTools,
      accent: profile.accent,
      sidebarWidth: profile.sidebarWidth,
    },
  };
}

function readDiagSchedule(): DiagSchedule {
  return diagReport()?.schedule ?? 'manual';
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


function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: unknown) => { body += String(chunk); });
    req.on('end', () => { resolve(body); });
    req.on('error', () => { resolve(''); });
  });
}

function openBrowser(url: string): void {
  // `start` is a cmd builtin, not an executable: spawning it by name fails with ENOENT.
  const [cmd, args]: [string, string[]] = process.platform === 'darwin'
    ? ['open', [url]]
    : process.platform === 'win32'
      ? [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'start', '', url]]
      : ['xdg-open', [url]];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
}

// Replacers throughout: session data holds `$'` (shell quoting) and `</script>`, which String.replace would mangle.
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

async function exportDashboard(exportFile: string, currency: CurrencyCode): Promise<void> {
  requireDashboardBundle();
  const [bundle, icon] = await Promise.all([readSegment(DASHBOARD_INDEX), brandDataUri()]);
  // Minified: fetch reads `fetch(\`brand.webp\`)` or `fetch("brand.webp")`; a mismatch loses the card's mark.
  const b64 = icon.split(',')[1] ?? '';
  // atob yields one byte per char, so a Uint8Array is needed or bytes >= 0x80 double and corrupt the webp.
  const brandBytes = `(() => { const c = atob(${JSON.stringify(b64)}); const v = new Uint8Array(c.length); for (let i = 0; i < c.length; i++) v[i] = c.charCodeAt(i); return v; })()`;
  const inline = bundle
    .replace('window.__TERSIO_SNAP = null;', () => `window.__TERSIO_SNAP = ${escapeInline(JSON.stringify({ currency, agent: agentStats(DEFAULT_AGENT_RANGE), health: parseOwnJson(healthJson(), 'health'), doctor: getDoctorReport(false) }))};`)
    // A mark is an HTML attribute or JSX prop; match every quote or the file keeps an unresolvable reference.
    .replace(/((?:src|href)[=:][ \t]*)([`"'])brand\.webp\2/g, (_all, head: string, quote: string) => `${head}${quote}${icon}${quote}`)
    .replace(/fetch\(([`"])brand\.webp\1\)/g, () => `Promise.resolve({ ok: true, blob: async () => new Blob([${brandBytes}], { type: "image/webp" }) })`);
  await fs.writeFile(exportFile, inline, 'utf8');
  console.log(`[ok] Dashboard exported → ${exportFile}`);
}

async function runDashboard(options: DashboardOptions): Promise<void> {
  if (options.exportFile) {
    await exportDashboard(options.exportFile, options.currency);
    return;
  }
  requireDashboardBundle();
  const server = http.createServer(async (req, res) => {
    if (req.url === '/api/upstream' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ card: await cachedScorecard(), history: await upstreamHistory() }));
      return;
    }
    if (req.url === '/api/upstream/check' && req.method === 'POST') {
      try {
        const card = await refreshScorecard();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, card, history: await upstreamHistory() }));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: (error as Error).message || 'check failed' }));
      }
      return;
    }
    if (req.url === '/api/data' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        dir: backupDir(),
        keep: BACKUP_KEEP,
        sources: dataSources(),
        backups: listDataBackups(),
        schedule: readBackupSchedule(),
        bytes: backupDiskBytes(),
        reset: resetCounts(),
      }));
      return;
    }
    if (req.url === '/api/data' && req.method === 'POST') {
      let body: Record<string, unknown> = {};
      try {
        body = (JSON.parse(await readBody(req)) as Record<string, unknown>) ?? {};
      } catch { body = {}; }
      const action = String(body.action ?? '');
      const name = String(body.name ?? '');
      // A missing SQLite engine, or a locked file, is a 500 with a message rather than a silent no-op.
      try {
        if (action === 'create') {
          const made = createDataBackup();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, name: made.name }));
          return;
        }
        if (action === 'restore') {
          const ok = restoreDataBackup(name);
          res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(ok ? { ok: true, name } : { ok: false, error: 'unknown snapshot' }));
          return;
        }
        if (action === 'reset') {
          const done = resetStatistics();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, ...done }));
          return;
        }
        if (action === 'delete') {
          const ok = deleteDataBackup(name);
          res.writeHead(ok ? 200 : 400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(ok ? { ok: true, name } : { ok: false, error: 'unknown snapshot' }));
          return;
        }
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: (error as Error).message || 'backup failed' }));
        return;
      }
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'unknown action' }));
      return;
    }
    if (req.url?.startsWith('/api/mark?') && req.method === 'GET') {
      // Marks are CDN files. Fetch each once into ~/.tersio/marks, then serve the copy, so a reload
      // never asks the network again and a CDN hiccup cannot blank a tile.
      const slug = new URL(req.url, 'http://127.0.0.1').searchParams.get('slug') ?? '';
      const remote = REMOTE_MARKS[slug];
      if (!remote) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('unknown mark');
        return;
      }
      // The catalog mixes favicon types, and a host may answer a `.png` URL with WebP; label every file by its bytes.
      const cacheDir = path.join(tersioHome(), 'marks');
      const cacheControl = 'public, max-age=604800, stale-while-revalidate=86400';
      for (const tryExt of MARK_EXTS) {
        try {
          // Read before writing: a miss must reach the fetch below with headers unsent.
          const bytes = await fs.readFile(path.join(cacheDir, `${slug}.${tryExt}`));
          res.writeHead(200, { 'Content-Type': MARK_TYPES[tryExt], 'Cache-Control': cacheControl });
          res.end(bytes);
          return;
        } catch { /* not cached under this type */ }
      }
      try {
        const answer = await fetch(remote, { signal: AbortSignal.timeout(5000) });
        if (!answer.ok) throw new Error(`HTTP ${answer.status}`);
        const type = answer.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
        const saveExt = MARK_EXT_OF_TYPE[type];
        // A redirect to a login or error page must not cache HTML as a mark.
        if (!saveExt) throw new Error(`unexpected type ${type}`);
        const bytes = Buffer.from(await answer.arrayBuffer());
        await fs.mkdir(cacheDir, { recursive: true });
        await fs.writeFile(path.join(cacheDir, `${slug}.${saveExt}`), bytes);
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cacheControl });
        res.end(bytes);
      } catch {
        res.writeHead(502, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
        res.end('mark unavailable');
      }
      return;
    }
    if (req.url?.startsWith('/api/logs') && req.method === 'GET') {
      const raw = new URL(req.url, 'http://127.0.0.1').searchParams.get('limit');
      const limit = Math.min(2000, Math.max(1, Number.parseInt(raw ?? '', 10) || 400));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(readActivity(limit)));
      return;
    }
    if (req.url === '/api/hosts' && req.method === 'GET') {
      // What the guide draws as connected: the host directories an install writes, read from disk.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(detectHosts().map((host) => ({
        id: host.id,
        label: host.label,
        installed: host.installed,
        version: host.version,
      }))));
      return;
    }
    if (req.url === '/api/hosts/action' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([...hostJobs].map(([host, job]) => ({ host, ...job }))));
      return;
    }
    if (req.url === '/api/hosts/action' && req.method === 'POST') {
      // Add an agent or turn one off from the guide. The CLI does the work, so the tree on disk and
      // the guide cannot drift apart.
      let body: Record<string, unknown> = {};
      try {
        body = (JSON.parse(await readBody(req)) as Record<string, unknown>) ?? {};
      } catch {
        body = {};
      }
      const host = String(body.host ?? '');
      const action = String(body.action ?? '');
      const known = detectHosts().some((entry) => entry.id === host);
      if (!known || (action !== 'install' && action !== 'uninstall' && action !== 'update')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'unknown host or action' }));
        return;
      }
      if (!spawnCli(action, host)) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'cannot find the tersio entry point' }));
        return;
      }
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, pending: true, host, action }));
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
          pstackDefault: profile.pstackDefault,
          comboLevel: comboLevelOf(profile),
          backupSchedule: profile.backupSchedule,
          devTools: profile.devTools,
          accent: profile.accent,
          sidebarWidth: profile.sidebarWidth,
          currency: options.currency,
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
    if (req.url === '/api/update' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(updateView()));
      return;
    }
    if (req.url === '/api/update' && req.method === 'POST') {
      let prefs: UpdatePrefs = {};
      try {
        prefs = (JSON.parse(await readBody(req)) as UpdatePrefs) ?? {};
      } catch { prefs = {}; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(setUpdatePrefs(prefs)));
      return;
    }
    // Both start work and return at once: the page's poll carries the status and the streamed log.
    if (req.url === '/api/update/check' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(startCheck(true)));
      return;
    }
    if (req.url === '/api/update/apply' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(startApply()));
      return;
    }
    if (req.url === '/api/agent' || req.url?.startsWith('/api/agent?')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(agentJson(rangeFrom(req.url), viewFrom(req.url), offsetFrom(req.url)));
      return;
    }
    if (req.url?.startsWith('/api/agent/session')) {
      const file = decodeURIComponent(queryParam(req.url, 'file') ?? '');
      const body = file ? readSessionTrace(file) : {
        sessionFile: '', project: '', title: '', cwd: '', startedAt: 0, endedAt: 0,
        tracks: [], markers: [], summary: {
          wallMs: 0, modelMs: 0, toolMs: 0, idleMs: 0, turns: 0, requests: 0, toolCalls: 0, agents: 0,
          totalTokens: 0, costUsd: 0,
        },
        toolStats: [], truncated: false,
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
      return;
    }
    if (req.url?.startsWith('/api/agent/entry')) {
      const file = decodeURIComponent(queryParam(req.url, 'file') ?? '');
      const entry = decodeURIComponent(queryParam(req.url, 'entry') ?? '');
      const body = file && entry ? readAgentRequestEntry(file, entry) : emptyRequestEntry();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
      return;
    }
    if (req.url?.startsWith('/export')) {
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
      recordActivity('doctor', schedule === 'manual' ? 'Doctor check' : `Check schedule to ${schedule}`, 'From the dashboard.');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(report));
      return;
    }
    if (req.url === '/doctor/fix' && req.method === 'POST') {
      try {
        const { runDoctorRepairs } = await import('./doctor-fix.ts');
        const failed = await runDoctorRepairs(['extensions', 'registrations', 'ponytail']);
        recordActivity('doctor', 'Doctor repair', failed.length === 0 ? 'Extensions, registrations, and Ponytail checked.' : `${failed.length} step(s) failed.`, failed.length === 0);
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
        // No-store: after an update the reload has to serve the new bundle, not a cached one.
        res.writeHead(200, { 'Content-Type': contentType(file), 'Cache-Control': 'no-store' });
        res.end(body);
        return;
      } catch { /* fall through to index */ }
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(await readSegment(DASHBOARD_INDEX));
  });
  await new Promise<void>((resolve, reject) => {
    let stopping = false;
    const rejectOnce = (err: Error): void => {
      if (!stopping) reject(err);
    };
    const stop = (): void => {
      if (stopping) return;
      stopping = true;
      server.close(() => resolve());
      server.closeIdleConnections();
    };

    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    server.once('error', rejectOnce);
    server.listen(options.port, '127.0.0.1', () => {
      try { process.title = 'tersio dashboard'; } catch { /* non-POSIX shells keep node */ }
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : options.port;
      const url = `http://127.0.0.1:${port}`;
      console.log(`[ok] Dashboard live → ${url} (Ctrl-C to stop)`);
      // The cadence only matters while a server is up, so the watch starts with it.
      startUpdateWatch();
      if (options.open) openBrowser(url);
    });
  });
}

export { agentStats, runDashboard, saveDashboardCurrency, readDiagSchedule, setDiagSchedule, offsetFrom };
export type { DiagSchedule };
