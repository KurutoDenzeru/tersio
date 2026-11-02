// Dashboard server + usage APIs. Binds 127.0.0.1; --export writes a file. No Promise.withResolvers (Node 20.12).
import { spawn, type ChildProcess } from 'node:child_process';
import { readActivity, recordActivity } from './activity.ts';
import { cacheDelete, cacheGet, cacheKeys, cachePut, cacheStamp } from '../extensions/shared/cache-store.ts';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, watch, writeFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import type { Socket } from 'node:net';
import { gzipSync } from 'node:zlib';
import { DURABLE_CONFIG, durableConfigInstalled } from '../extensions/shared/headroom-proxy.ts';
import { readHeadroomWraps } from '../extensions/shared/headroom-wraps.ts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCurrencyCode } from './currency.ts';
import type { CurrencyCode } from './currency.ts';
import { qrTerminal } from './qr.ts';
import { ensureHeadroomRuntime } from './headroom-runtime.ts';
import { handleHeadroomRoutes } from './dashboard-headroom.ts';
import { handleVendorRoutes } from './dashboard-vendor.ts';
import { handleHostRoutes } from './dashboard-hosts.ts';
import {
  OMP_AGENT_DIR, OMP_PLUGINS_DIR, PACKAGE_VERSION, execFileP,
} from './common.ts';
import { BACKUP_SCHEDULES, applyComboPreset, clampSidebarWidth, comboLevelOf, formatCliStatus, RETENTION_DAYS, saveHostDefaults, storedProfile, writePluginSettings } from './profile.ts';
import { patchState, readState, takeLegacy } from '../extensions/shared/state.ts';
import { REMOTE_MARKS } from '../extensions/shared/brand-marks.ts';
import { setUpdatePrefs, startApply, startCheck, startUpdateWatch, updateView } from './dashboard-update.ts';
import type { UpdatePrefs } from './dashboard-update.ts';
import type { BackupSchedule, HostDefaultField } from './profile.ts';
import { normalizeComboLevel } from '../extensions/shared/session-state.ts';
import { ACCENT_DEFAULTS, CAVEMAN_DEFAULTS, COMBO_PRESET_MODES, HEADROOM_DEFAULTS, PONYTAIL_DEFAULTS, PSTACK_DEFAULTS } from './common.ts';
import { PACKAGE_NAME } from './common.ts';
import { detectHosts } from './hosts.ts';
import { findPackageRoot, homeDir, openCommand, resolveHeadroomBinary, resolveHostBinary, resolveRtkBinary, ruleBodyProblem, tersioHome } from '../extensions/shared/utils.ts';
import { tersioSettingsFile } from '../extensions/shared/plugin-settings.ts';
import { BACKUP_KEEP, backupDir, backupDiskBytes, createDataBackup, dataSources, deleteDataBackup, listDataBackups, restoreDataBackup } from '../extensions/shared/snapshots.ts';
import { CAVEMAN_PIN, cachedScorecard, refreshScorecard, upstreamHistory } from './upstream.ts';
import { resetCounts, resetStatistics } from './reset.ts';

import { readBackupSchedule, syncUsageDb } from '../extensions/shared/usage-store.ts';
import { agentDbPath, emptyRequestEntry, isAgentView, isRangeKey, readAgentRequestEntry, readAgentStats, readSessionTrace, statsDbPath } from '../extensions/shared/agent-stats.ts';
import type { AgentStats, AgentView, RangeKey } from '../extensions/shared/agent-types.ts';

/** The agents headroom's own compatibility table lists, minus Continue (service discontinued). */
const WRAP_TARGETS = [
  'omp', 'claude', 'codex', 'copilot', 'vscode', 'aider', 'vibe', 'grok', 'cursor', 'cline',
  'goose', 'openhands', 'openclaw', 'opencode', 'kimi',
  'bob', 'antigravity', 'grok-build', 'openclaude', 'vscode-claude',
] as const;

/** The wrap target names headroom's README compatibility table prints, so the drawer reads the same. */
const WRAP_LABELS: Record<string, string> = {
  omp: 'Oh My Pi', claude: 'Claude Code', codex: 'Codex', copilot: 'Copilot CLI',
  vscode: 'VS Code Copilot', aider: 'Aider', vibe: 'Mistral Vibe', grok: 'Grok CLI',
  cursor: 'Cursor', cline: 'Cline', goose: 'Goose', openhands: 'OpenHands',
  openclaw: 'OpenClaw', opencode: 'OpenCode', kimi: 'Kimi CLI',
  bob: 'IBM Bob', antigravity: 'Antigravity', 'grok-build': 'Grok Build',
  openclaude: 'OpenClaude', 'vscode-claude': 'VS Code Claude',
};

const WRAP_BINARY: Record<string, string> = {
  vscode: 'code', 'vscode-claude': 'code', cline: 'code', copilot: 'gh', 'grok-build': 'grok',
};

/** Whether a wrap target's binary resolves: PATH first, then the directory the installer owns for it. */
const WRAP_MANAGED_DIR: Record<string, string> = {
  omp: path.join(homeDir(), '.bun', 'bin'),
  opencode: path.join(homeDir(), '.opencode', 'bin'),
};

async function binaryExists(name: string): Promise<boolean> {
  return resolveHostBinary(WRAP_BINARY[name] ?? name, WRAP_MANAGED_DIR[name] ?? path.join(homeDir(), '.local', 'bin')) !== null;
}

/** Home-relative config markers per OS: an agent whose binary lives off PATH still shows when its config home exists. */
const WRAP_CONFIG_MARKERS: Record<string, string> = {
  claude: '.claude',
  codex: '.codex',
  cursor: '.cursor',
  grok: '.grok',
  aider: '.aider',
  openclaw: '.openclaw',
  openhands: '.openhands',
  opencode: '.opencode',
  omp: '.omp',
};

/** A wrap target is present when its binary resolves or its config home exists on this OS. */
async function wrapTargetPresent(name: string): Promise<boolean> {
  // Copilot CLI is a gh extension, not a binary: the gh CLI alone must not count as installed.
  if (name === 'copilot') {
    try {
      const gh = await execFileP('gh', ['extension', 'list'], { timeout: 4000 });
      return String(gh.stdout ?? '').toLowerCase().includes('copilot');
    } catch {
      return false;
    }
  }
  if (await binaryExists(name)) return true;
  const marker = WRAP_CONFIG_MARKERS[name];
  if (!marker) return false;
  try {
    return existsSync(path.join(homeDir(), marker));
  } catch {
    return false;
  }
}

/** The listen address: every interface by default, so a phone can open it. `local` keeps it loopback. */
export function resolveBind(bind?: string | null): string {
  const value = (bind ?? '').trim().toLowerCase();
  if (value === '' ) return '0.0.0.0';
  if (value === 'local' || value === 'loopback' || value === 'localhost' || value === '127.0.0.1') return '127.0.0.1';
  if (value === 'lan' || value === 'all' || value === '*' || value === '0.0.0.0') return '0.0.0.0';
  if (value === '::' || value === '::1') return value;
  // A value that is neither an address nor a known word keeps the default: every interface.
  return /^[0-9a-f:.]+$/i.test(value) ? value : '0.0.0.0';
}

/** Every address a phone on this network can type, printed beside the loopback one. */
export function lanUrls(port: number, host: string): string[] {
  if (host !== '0.0.0.0' && host !== '::') return host === '127.0.0.1' ? [] : [`http://${host}:${port}`];
  const urls: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) urls.push(`http://${iface.address}:${port}`);
    }
  }
  return urls;
}

/** The ponytail version this build vendors, read from its package; null when the tree is absent. */
function ponytailVersion(): string | null {
  try {
    const pkg = path.join(findPackageRoot(path.dirname(fileURLToPath(import.meta.url))), 'extensions', 'ponytail', 'package.json');
    return (JSON.parse(readFileSync(pkg, 'utf8')) as { version?: string }).version ?? null;
  } catch {
    return null;
  }
}
export interface DashboardOptions {
  port: number;
  /** Listen address: absent means every interface, `local` means loopback. */
  bind?: string | null;
  /** Supervise the server in a child that restarts on source change. */
  watch?: boolean;
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
const AGENT_REFRESH_MS = 30_000;

/** A sync walks every transcript, so it runs at most this often even while a poll outruns it. */
const AGENT_SYNC_MS = 60_000;

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

/** Bumped when the payload shape changes, so a cached row from an older build is never read as the new shape. */
const AGENT_CACHE_VERSION = 2;

/** One cache row per range and view, so a restarted server serves what the last one built. */
function agentCacheKey(range: RangeKey, view: AgentView, offset: number): string {
  return `dashboard.agent.v${AGENT_CACHE_VERSION}.${range}-${view}-${offset}`;
}

/** The loose JSON cache an older build wrote moves into the ledger once, then leaves the data home. */
let agentCacheMigrated = false;
function migrateAgentCache(): void {
  if (agentCacheMigrated) return;
  agentCacheMigrated = true;
  const dir = path.join(tersioHome(), 'cache', 'agent');
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      try { cachePut(`dashboard.agent.${name.slice(0, -5)}`, readFileSync(path.join(dir, name), 'utf8')); } catch { /* one unreadable file costs one rebuild */ }
    }
    rmSync(path.join(tersioHome(), 'cache'), { recursive: true, force: true });
  } catch { /* no legacy cache */ }
}

/** A cached payload is reused only while the store it was built from is unchanged. */
function readAgentCache(key: string, stamp: string): AgentStats | null {
  const text = cacheGet(key);
  if (text === null) return null;
  try {
    const raw = JSON.parse(text) as { stamp?: string; value?: AgentStats };
    if (raw.stamp !== stamp || !raw.value) return null;
    return raw.value;
  } catch {
    return null;
  }
}

function writeAgentCache(key: string, stamp: string, value: AgentStats): void {
  cachePut(key, JSON.stringify({ stamp, value }));
}

/** Keep the cache small: the newest rows are the ones a page opens on. */
function pruneAgentCache(): void {
  const rows = cacheKeys('dashboard.agent.')
    .map((key) => ({ key, at: cacheStamp(key) }))
    .toSorted((a, b) => b.at - a.at);
  for (const row of rows.slice(24)) cacheDelete(row.key);
}

/** Syncs before reading past the throttle; without it a page misses pi and OpenCode rows. */
function agentStats(range: RangeKey, view: AgentView = 'all', offset = 0): AgentStats {
  const stamp = storeStamp();
  const held = agentMemo;
  if (held && held.range === range && held.view === view && held.offset === offset && held.stamp === stamp && Date.now() - held.at < AGENT_REFRESH_MS) {
    return held.value;
  }
  // A payload built from this exact store is reused across restarts, so a page never waits for the scan again.
  migrateAgentCache();
  const key = agentCacheKey(range, view, offset);
  const cached = readAgentCache(key, stamp);
  if (cached) {
    agentMemo = { range, view, offset, stamp, at: Date.now(), value: cached };
    return cached;
  }
  if (Date.now() - lastSyncAt >= AGENT_SYNC_MS) {
    lastSyncAt = Date.now();
    try {
      syncUsageDb();
    } catch { /* a store that will not write still reads the rows it already holds */ }
  }
  const value = readAgentStats(range, view, Date.now(), offset);
  const builtStamp = storeStamp();
  agentMemo = { range, view, offset, stamp: builtStamp, at: Date.now(), value };
  writeAgentCache(key, builtStamp, value);
  pruneAgentCache();
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

export function agentJson(range: RangeKey, view: AgentView, offset: number): string {
  return JSON.stringify({ range, view, offset, agent: agentStats(range, view, offset) });
}

// Runs outside any agent session, so it reports the persisted defaults.
export async function statusJson(): Promise<string> {
  const profile = await storedProfile();
  return JSON.stringify({
    status: formatCliStatus(profile),
    level: profile.comboDefault,
    caveman: profile.cavemanDefault,
    rtk: profile.rtkDefault ? 'on' : 'off',
    ponytail: profile.ponytailDefault,
    pstack: profile.pstackDefault,
    headroom: profile.headroomDefault,
  });
}

/** Run a host command in its own process: the installer the terminal runs, with the server free to answer. The page polls /api/hosts until the host settles, because the child outlives the request. */
interface HostJob {
  action: 'install' | 'uninstall' | 'update';
  startedAt: number;
  /** `null` while the child runs, then its exit code. */
  code: number | null;
}

/** The last command run per host, so the guide can stop waiting the moment it exits. */
const hostJobs = new Map<string, HostJob>();

/** Whether a name is one of headroom's wrapped tools, so a route never passes an arbitrary string to the binary. */
export function isHeadroomWrapTarget(name: string): boolean {
  return (WRAP_TARGETS as readonly string[]).includes(name);
}

/** The two third-party binaries Tersio's footers manage; anything else is a bad request. */
export function isVendorTool(tool: string): tool is 'headroom' | 'rtk' {
  return tool === 'headroom' || tool === 'rtk';
}

/** The one Headroom install job, so the Tools page can poll until the binary appears or the pip run fails. */
const headroomJob: { startedAt: number; code: number | null; error: string | null } = { startedAt: 0, code: null, error: null };
/** pip's stderr stays in memory for this run, then its tail lands in the activity log a failure reads. */
const HEADROOM_LOG_CAP = 16 * 1024;
let headroomStderr = '';

function tailOf(text: string, lines = 6): string | null {
  const parts = text.trim().split(/\r?\n/);
  return parts.slice(-lines).join('\n') || null;
}

/** The state the Tools page polls; `error` is the pip output tail once a run has failed. */
function headroomInstallState(): { startedAt: number; code: number | null; error: string | null } {
  if (headroomJob.code !== null && headroomJob.code !== 0 && !headroomJob.error) {
    headroomJob.error = tailOf(headroomStderr) ?? 'the pip run failed without output';
  }
  return { ...headroomJob };
}

/** Installs Headroom on request: uv first, pip --user as the fallback whose scripts dir the resolver probes. */
function spawnHeadroomInstall(): boolean {
  const uv = resolveHostBinary('uv');
  const cmd = uv ? 'uv' : process.platform === 'win32' ? 'pip' : 'python3';
  const args = uv
    ? ['tool', 'install', 'headroom-ai[all]']
    : process.platform === 'win32'
      ? ['install', '--user', 'headroom-ai[all]']
      : ['-m', 'pip', 'install', '--user', 'headroom-ai[all]'];
  headroomStderr = '';
  const child = spawn(cmd, args, { detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
  headroomJob.startedAt = Date.now();
  headroomJob.code = null;
  headroomJob.error = null;
  recordActivity('agent', 'Headroom install started');
  child.stderr?.on('data', (chunk: Buffer) => {
    headroomStderr = (headroomStderr + chunk.toString()).slice(-HEADROOM_LOG_CAP);
  });
  child.on('exit', (code) => {
    headroomJob.code = code ?? 0;
    const ok = headroomJob.code === 0;
    if (!ok) {
      headroomJob.error = tailOf(headroomStderr) ?? 'the pip run failed without output';
      // The failing output is the one thing worth keeping, so it goes where the Logs page already reads.
      recordActivity('agent', 'Headroom install output', headroomJob.error.slice(-1500), false);
    }
    recordActivity('agent', `Headroom install ${ok ? 'finished' : 'failed'}`, ok ? undefined : headroomJob.error?.split('\n')[0], ok);
  });
  child.on('error', (error) => {
    headroomJob.code = -1;
    headroomJob.error = error.message;
    recordActivity('agent', 'Headroom install failed', error.message, false);
  });
  child.unref();
  return true;
}

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

// Local-only health: find each agent, run `--version`, report both. The probes read the managed install dirs the doctor uses, so a dashboard started with a minimal PATH still finds the agents.
function ompPath(): string | null {
  return resolveHostBinary('omp');
}

function piPath(): string | null {
  return resolveHostBinary('pi', path.join(homeDir(), '.local', 'bin'));
}

function pigPath(): string | null {
  return resolveHostBinary('pig', path.join(homeDir(), '.local', 'bin'));
}

function opencodePath(): string | null {
  return resolveHostBinary('opencode', path.join(homeDir(), '.opencode', 'bin'));
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

function headroomVersion(bin: string): string | null {
  // Headroom prints `headroom, version 0.40.0`; keep the bare version so the UI reads like the agents' rows.
  const raw = rtkVersion(bin);
  const m = raw?.match(/version\s+(\S+)/);
  return m ? m[1] : raw;
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

/** The config root per agent, for the health report. */
const agentDir = (id: 'omp' | 'pi' | 'pig' | 'opencode'): string | null => {
  if (id === 'omp') return path.join(homeDir(), '.omp');
  if (id === 'pi') return path.join(homeDir(), '.pi');
  if (id === 'pig') return path.join(homeDir(), '.pig');
  return path.join(homeDir(), '.config', 'opencode');
};

export function healthJson(): string {
  const rtkBin = resolveRtkBinary();
  const rtkPresent = rtkBin !== null;
  const headroomBin = resolveHeadroomBinary();
  const headroomPresent = headroomBin !== null;
  const detectedOmpPath = ompPath();
  const detectedPiPath = piPath();
  const detectedPigPath = pigPath();
  const detectedOpencodePath = opencodePath();
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
    pig: agentVersion(detectedPigPath),
    pigPath: detectedPigPath,
    pigDir: agentDir('pig'),
    opencode: agentVersion(detectedOpencodePath),
    opencodePath: detectedOpencodePath,
    opencodeDir: agentDir('opencode'),
    provider: ompDefaultModel(),
    rtk: { present: rtkPresent, version: rtkPresent ? rtkVersion(rtkBin as string) : null, path: rtkBin || 'not found in PATH' },
    headroom: { present: headroomPresent, version: headroomPresent ? headroomVersion(headroomBin as string) : null, path: headroomBin || 'not found in PATH' },
    // The shipped-build pins: what this dashboard's own tree carries, not what upstream released.
    modes: { caveman: CAVEMAN_PIN.replace(/^v/, ''), ponytail: ponytailVersion(), pstack: null },
    home: tersioHomePath(),
  });
}

function tersioHomePath(): string {
  return path.join(homeDir(), '.tersio');
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
  const home = homeDir();
  const old = takeLegacy(path.join(home, '.tersio', 'diag.json'), (raw) => {
    try { return JSON.parse(raw) as Partial<DoctorReport>; } catch { return null; }
  });
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

/** Two-digit padding for the absTime stamp. */
const pad2 = (n: number): string => String(n).padStart(2, '0');

function absTime(p: string): string | null {
  try {
    const d = new Date(statSync(p).mtimeMs);
    const h24 = d.getHours();
    return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}-${d.getFullYear()}, ${pad2(h24 % 12 || 12)}:${pad2(d.getMinutes())} ${h24 >= 12 ? 'PM' : 'AM'}`;
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

/** Whether an extension file the doctor names exists. */
const pathExists = (p: string): boolean => existsSync(p);

function computeDoctorRows(): DoctorRow[] {
  const rows: DoctorRow[] = [];
  const rtkBin = resolveRtkBinary();
  const tersioPluginDir = path.join(OMP_PLUGINS_DIR, 'node_modules', ...PACKAGE_NAME.split('/'));
  const configPath = path.join(OMP_AGENT_DIR, 'config.yml');
  const ext = (label: string, p: string): void => {
    rows.push({ label, ok: pathExists(p), detail: pathExists(p) ? 'installed' : p, group: 'Extensions' });
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
    .filter((entry) => !pathExists(path.isAbsolute(entry) ? entry : path.resolve(OMP_AGENT_DIR, entry)));
  addon('Extension files present', dangling.length === 0, dangling.length ? dangling.join(', ') : 'ok', 'Extensions');
  ext('Caveman extension', path.join(tersioPluginDir, 'extensions', 'caveman', 'index.ts'));
  ext('pstack extension', path.join(tersioPluginDir, 'extensions', 'pstack', 'index.ts'));
  ext('Headroom extension', path.join(tersioPluginDir, 'extensions', 'headroom', 'index.ts'));
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
  // Opt-in and user-owned: the row reports the binary when it exists and stays quiet when it does not.
  const headroomBin = resolveHeadroomBinary();
  if (headroomBin) addon('Headroom binary', true, headroomVersion(headroomBin) ?? headroomBin);
  // Ponytail rides inside the plugin now, so the version comes from the vendored copy, not a sibling package.
  const ponytailPkg = path.join(tersioPluginDir, 'extensions', 'ponytail', 'package.json');
  let ponytailVer: string | null = null;
  try {
    ponytailVer = (JSON.parse(readFileSync(ponytailPkg, 'utf8')) as { version?: string }).version ?? null;
  } catch { ponytailVer = null; }
  const ponytailAge = ageStr(ponytailPkg);
  const ponytailAt = absTime(ponytailPkg);
  addon('Ponytail', ponytailVer !== null, ponytailVer && ponytailAge && ponytailAt ? `${ponytailVer} (updated ${ponytailAge} · ${ponytailAt})` : ponytailPkg);
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

// One field per call, validated against the same sets the CLI uses. A body with a `host` writes that
// agent's own section, so one agent's preset never becomes every agent's.
// Writes serialize: every call re-reads the profile inside the queue, so two overlapping requests (a sidebar drag racing a toggle) can never write whole profiles from stale snapshots.
let profileWriteQueue: Promise<unknown> = Promise.resolve();

function saveDefaults(body: Record<string, unknown>): Promise<
  { ok: true; profile: Record<string, unknown> } | { ok: false; error: string }
> {
  const run = async (): Promise<
    { ok: true; profile: Record<string, unknown> } | { ok: false; error: string }
  > => {
  const HOST_SCOPES = ['omp', 'pi', 'opencode'] as const;
  const hostScope = typeof body.host === 'string' && (HOST_SCOPES as readonly string[]).includes(body.host)
    ? body.host as (typeof HOST_SCOPES)[number]
    : null;
  if (body.host !== undefined && hostScope === null) return { ok: false, error: 'unknown host scope' };
  const profile = await storedProfile(hostScope);
  const events: string[] = [];
  // A host scope carries only the mode fields the request changed; non-mode fields stay global-only.
  const changedFields: HostDefaultField[] = [];
  // `inherit` describes one agent's section; a shared write has nothing to hand the value back to.
  const inherited = ['comboDefault', 'cavemanDefault', 'rtkDefault', 'ponytailDefault', 'pstackDefault', 'headroomDefault']
    .filter((key) => String(body[key]) === 'inherit');
  if (inherited.length > 0 && !body.host) return { ok: false, error: 'inherit applies to one agent — pass a host' };
  if (String(body.comboDefault) === 'inherit') {
    // SAFETY: the typed profile omits 'inherit', but the request validated it above and the shared store accepts it.
    Object.assign(profile as unknown as Record<string, unknown>, { comboDefault: 'inherit', cavemanDefault: 'inherit', rtkDefault: 'inherit', ponytailDefault: 'inherit' });
    events.push('Combo back to the shared defaults');
    changedFields.push('comboDefault', 'cavemanDefault', 'rtkDefault', 'ponytailDefault');
  } else if (body.comboDefault !== undefined) {
    const level = normalizeComboLevel(body.comboDefault);
    // A preset level only: `custom` is what the three modes say, never a level to write.
    if (!level || !Object.hasOwn(COMBO_PRESET_MODES, level)) return { ok: false, error: 'unknown combo level' };
    Object.assign(profile, applyComboPreset(profile, level));
    events.push(`Combo preset to ${level}`);
    changedFields.push('comboDefault', 'cavemanDefault', 'rtkDefault', 'ponytailDefault');
  }
  if (body.cavemanDefault !== undefined) {
    const v = String(body.cavemanDefault);
    if (v !== 'inherit' && !CAVEMAN_DEFAULTS.has(v)) return { ok: false, error: 'unknown caveman level' };
    profile.cavemanDefault = v;
    events.push(`Caveman to ${v}`);
    if (!changedFields.includes('cavemanDefault')) changedFields.push('cavemanDefault');
  }
  if (body.ponytailDefault !== undefined) {
    const v = String(body.ponytailDefault);
    if (v !== 'inherit' && !PONYTAIL_DEFAULTS.has(v)) return { ok: false, error: 'unknown ponytail level' };
    profile.ponytailDefault = v;
    events.push(`Ponytail to ${v}`);
    if (!changedFields.includes('ponytailDefault')) changedFields.push('ponytailDefault');
  }
  if (body.pstackDefault !== undefined) {
    const v = String(body.pstackDefault);
    if (v !== 'inherit' && !PSTACK_DEFAULTS.has(v)) return { ok: false, error: 'unknown pstack level' };
    profile.pstackDefault = v;
    events.push(`pstack to ${v}`);
    changedFields.push('pstackDefault');
  }
  if (body.headroomDefault !== undefined) {
    const v = String(body.headroomDefault);
    if (v !== 'inherit' && !HEADROOM_DEFAULTS.has(v)) return { ok: false, error: 'unknown headroom level' };
    profile.headroomDefault = v;
    events.push(`Headroom to ${v}`);
    changedFields.push('headroomDefault');
  }
  if (body.backupSchedule !== undefined) {
    const v = String(body.backupSchedule);
    if (!BACKUP_SCHEDULES.has(v)) return { ok: false, error: 'unknown backup schedule' };
    profile.backupSchedule = v as BackupSchedule;
  }
  if (body.retentionDays !== undefined) {
    const v = Number(body.retentionDays);
    if (!RETENTION_DAYS.has(v)) return { ok: false, error: 'unknown retention window' };
    profile.retentionDays = v;
  }
  if (body.rtkDefault !== undefined) {
    if (body.rtkDefault !== 'inherit' && typeof body.rtkDefault !== 'boolean') return { ok: false, error: 'rtk default must be true, false, or inherit' };
    // SAFETY: rtkDefault is validated above as a boolean or the literal 'inherit', which the store accepts.
    (profile as unknown as Record<string, unknown>).rtkDefault = body.rtkDefault;
    events.push(body.rtkDefault === 'inherit' ? 'RTK back to the shared default' : `RTK to ${body.rtkDefault ? 'on' : 'off'}`);
    changedFields.push('rtkDefault');
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
  if (body.sidebarOpen !== undefined) {
    if (typeof body.sidebarOpen !== 'boolean') return { ok: false, error: 'sidebarOpen must be true or false' };
    profile.sidebarOpen = body.sidebarOpen;
  }
  if (body.sidebarWidth !== undefined) {
    if (typeof body.sidebarWidth !== 'number') return { ok: false, error: 'sidebarWidth must be a number' };
    // A drag changes it often, so it is saved without an activity line.
    profile.sidebarWidth = clampSidebarWidth(body.sidebarWidth);
  }
  // A host scope writes only the mode fields the request changed; non-mode fields are global-only and never host-scoped.
  if (hostScope) {
    if (changedFields.length > 0) await saveHostDefaults(hostScope, changedFields, profile, {});
  } else {
    await writePluginSettings(profile, {});
  }
  for (const title of events) recordActivity('mode', title, hostScope ? `Applies to new ${hostScope} sessions.` : 'Applies to new sessions.');
  return {
    ok: true,
    profile: {
      comboDefault: profile.comboDefault,
      cavemanDefault: profile.cavemanDefault,
      rtkDefault: profile.rtkDefault,
      ponytailDefault: profile.ponytailDefault,
      pstackDefault: profile.pstackDefault,
      headroomDefault: profile.headroomDefault,
      backupSchedule: profile.backupSchedule,
      retentionDays: profile.retentionDays,
      devTools: profile.devTools,
      accent: profile.accent,
      sidebarWidth: profile.sidebarWidth,
      sidebarOpen: profile.sidebarOpen,
    },
  };
  }

  const result = profileWriteQueue.then(run, run);
  profileWriteQueue = result.catch(() => null);
  return result;
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

/** One JSON reply: every route answers this shape, so the header is set in one place. */
export function json(res: Pick<http.ServerResponse, 'writeHead' | 'end'>, code: number, body: unknown): void {
  // A string here would be serialized twice; the routes that build their own text call jsonText.
  if (typeof body === 'string') throw new Error('json() takes a value, not text: use jsonText() for a serialized payload');
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** A reply whose JSON is already serialized: the big payloads build their own string. */
function jsonText(res: http.ServerResponse, code: number, text: string): void {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(text);
}

/** The largest replies are serialized JSON, so gzip them when the client asks: the agent payload shrinks about six times. */
function jsonGzip(req: http.IncomingMessage, res: http.ServerResponse, code: number, text: string): void {
  const accepts = String(req.headers['accept-encoding'] ?? '').includes('gzip');
  if (!accepts || text.length < 4096) {
    jsonText(res, code, text);
    return;
  }
  const body = gzipSync(text);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Content-Encoding': 'gzip',
    Vary: 'Accept-Encoding',
    'Content-Length': body.length,
  });
  res.end(body);
}

/** The request body as an object; a missing or malformed one reads as empty, as every route assumed. */
async function bodyOf(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readBody(req));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The last lines of a command's output, trimmed to non-empty ones. */
const tail = (text: string): string[] => text.trim().split('\n').filter(Boolean);

/** Runs a headroom command and returns its last lines; a failure carries the same tail. */
async function headroomRun(bin: string, args: string[], timeout: number): Promise<{ ok: boolean; lines: string[] }> {
  try {
    // The home cwd keeps headroom's project-local artifacts (wrap locks in .claude) out of whatever directory the dashboard was launched from.
    const run = await execFileP(bin, args, { timeout, cwd: homeDir() });
    return { ok: true, lines: tail(`${run.stdout}\n${run.stderr}`) };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, lines: tail(`${err.stdout ?? ''}\n${err.stderr ?? ''}`) };
  }
}

function openBrowser(url: string): void {
  const [cmd, argv] = openCommand(url);
  spawn(cmd, argv, { detached: true, stdio: 'ignore' }).unref();
}

// Replacers throughout: session data holds `$'` (shell quoting) and `</script>`, which String.replace would mangle.
function escapeInline(raw: string): string {
  return raw.replace(/<\/(script)/gi, '<\\/$1');
}

// Our own JSON.stringify output, so a parse failure means a bad value: name it.
function parseOwnJson(raw: string, field: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
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

/** A port the child keeps across restarts: a new one on every bounce would move the browser tab. */
async function stableWatchPort(preferred: number, host: string): Promise<number> {
  if (preferred > 0) return preferred;
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(preferred || 0));
    probe.listen(0, host, () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/** Watch mode: this process supervises; the real server runs in a child that bounces on source change.
 *  UI edits need no bounce at all: vite build --watch rewrites the bundle and the server serves dist fresh. */
async function runDashboardWatch(options: DashboardOptions): Promise<void> {
  const root = findPackageRoot(path.dirname(fileURLToPath(import.meta.url)));
  // The watcher runs the source when bun is present, so a CLI edit reaches the child without a manual build.
  const bun = resolveHostBinary('bun');
  const source = existsSync(path.join(root, 'tersio.ts'));
  const runner = bun ?? process.execPath;
  const entry = bun && source ? path.join(root, 'tersio.ts') : path.join(root, 'dist', 'tersio.js');
  const bind = options.bind ?? '';
  const port = await stableWatchPort(options.port, resolveBind(options.bind));
  const appDir = path.join(root, 'dashboard', 'app');
  const viteBin = path.join(appDir, 'node_modules', 'vite', 'bin', 'vite.js');
  let child: ChildProcess | null = null;
  let vite: ChildProcess | null = null;
  let stopping = false;
  let pendingRestart = false;
  let firstSpawn = true;
  const flags: string[] = ['dashboard', '--port', String(port), '--bind', bind];
  if (options.open) flags.push('--open');
  if (options.currency) flags.push('--currency', options.currency);
  const spawnChild = (): void => {
    const argv = [...flags];
    // The tab is opened once; every bounce would otherwise steal focus with another tab.
    if (!firstSpawn) {
      const openAt = argv.indexOf('--open');
      if (openAt >= 0) argv.splice(openAt, 1);
    }
    firstSpawn = false;
    child = spawn(runner, [entry, ...argv], {
      env: { ...process.env, TERSIO_DASHBOARD_CHILD: '1' },
      stdio: 'inherit',
    });
    child.on('exit', (code: number | null) => {
      if (stopping) return;
      if (pendingRestart) { pendingRestart = false; setTimeout(spawnChild, 300); return; }
      console.log('[watch] server exited (' + code + ') \u2014 restarting in 500ms');
      setTimeout(() => { if (!stopping) spawnChild(); }, 500);
    });
  };
  const restart = (): void => {
    if (!child || pendingRestart) return;
    console.log('[watch] server source changed \u2014 restarting');
    pendingRestart = true;
    child.kill('SIGTERM');
  };
  spawnChild();
  // UI rebuilds ride vite's own watcher: the server serves dist fresh per request, so a reload picks them up.
  // Bun is the repo's package runner; without it, run vite's own entry under this interpreter.
  // Only warnings and errors reach the terminal; the routine transform and bundle lines stay quiet.
  vite = spawn(bun ?? process.execPath, [viteBin, 'build', '--watch', '--logLevel', 'warn'], {
    stdio: ['ignore', 'ignore', 'pipe'],
    cwd: appDir,
  });
  vite.stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk));
  vite.on('exit', (code: number | null) => {
    if (!stopping) console.log('[watch] UI watcher exited (' + code + ') \u2014 UI edits need `bun run build:dashboard`');
  });
  // Watch only the trees the server reads; recursing the repo root would carry node_modules and .git.
  const watched = ['cli', 'extensions']
    .map((dir) => path.join(root, dir))
    .filter((dir) => existsSync(dir));
  try {
    const onChange = (_event: string, file: string | null): void => {
      if (stopping || !file) return;
      const rel = String(file).replace(/\\/g, '/');
      if (rel.includes('/node_modules/') || rel.includes('/.git/')) return;
      if (rel.startsWith('dashboard/') || rel.startsWith('dist/') || rel.startsWith('skills/')) return;
      if (!/\.(ts|js|md)$/.test(rel)) return;
      restart();
    };
    for (const dir of watched) watch(dir, { recursive: true }, onChange);
    const entryFile = path.join(root, 'tersio.ts');
    if (existsSync(entryFile)) watch(entryFile, onChange);
  } catch { /* a platform without recursive watch simply skips auto-restart */ }
  const stop = (code: number): void => {
    stopping = true;
    try { child?.kill('SIGTERM'); } catch { /* gone */ }
    try { vite?.kill('SIGTERM'); } catch { /* gone */ }
    process.exit(code);
  };
  process.once('SIGINT', () => stop(130));
  process.once('SIGTERM', () => stop(0));
  await new Promise(() => undefined);
}

/** A source checkout with a terminal gets hot reload without a flag; CI, exports, and children never do. */
export function shouldAutoWatch(hasSource: boolean, tty: boolean, env: NodeJS.ProcessEnv = process.env): boolean {
  return hasSource && tty && env.TERSIO_NO_WATCH !== '1' && env.TERSIO_DASHBOARD_CHILD !== '1';
}

async function runDashboard(options: DashboardOptions): Promise<void> {
  const hasSource = existsSync(path.join(findPackageRoot(path.dirname(fileURLToPath(import.meta.url))), 'tersio.ts'));
  const tty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if ((options.watch || (shouldAutoWatch(hasSource, tty) && !options.exportFile)) && process.env.TERSIO_DASHBOARD_CHILD !== '1') {
    await runDashboardWatch(options);
    return;
  }
  const listenHost = resolveBind(options.bind);
  if (options.exportFile) {
    await exportDashboard(options.exportFile, options.currency);
    return;
  }
  requireDashboardBundle();
  const server = http.createServer(async (req, res) => {
    // The bundle's own build id: an open tab reloads itself after vite rewrites dist, with no manual refresh.
    if (req.url === '/api/build' && req.method === 'GET') {
      let id = '0';
      try {
        const stat = statSync(DASHBOARD_INDEX);
        id = `${Math.floor(stat.mtimeMs)}-${stat.size}`;
      } catch { /* no bundle yet */ }
      res.setHeader('Cache-Control', 'no-store');
      json(res, 200, { id });
      return;
    }
    if (await handleHeadroomRoutes(req, res, {
      json, bodyOf, wrapTargetPresent, spawnHeadroomInstall, headroomInstallState, headroomRun,
      wrapTargets: WRAP_TARGETS, wrapLabels: WRAP_LABELS,
    })) return;
    if (await handleVendorRoutes(req, res, { json, bodyOf, spawnHeadroomInstall, isVendorTool })) return;
    if (await handleHostRoutes(req, res, { json, bodyOf, detectHosts, hostJobs, spawnCli })) return;
    if (req.url === '/api/upstream' && req.method === 'GET') {
      json(res, 200, { card: await cachedScorecard(), history: await upstreamHistory() });
      return;
    }
    if (req.url === '/api/upstream/check' && req.method === 'POST') {
      try {
        const card = await refreshScorecard();
        json(res, 200, { ok: true, card, history: await upstreamHistory() });
      } catch (error) {
        json(res, 500, { ok: false, error: (error as Error).message || 'check failed' });
      }
      return;
    }
    if (req.url === '/api/data' && req.method === 'GET') {
      json(res, 200, {
        dir: backupDir(),
        keep: BACKUP_KEEP,
        sources: dataSources(),
        backups: listDataBackups(),
        schedule: readBackupSchedule(),
        bytes: backupDiskBytes(),
        reset: resetCounts(),
      });
      return;
    }
    if (req.url === '/api/data' && req.method === 'POST') {
      const body = await bodyOf(req);
      const action = String(body.action ?? '');
      const name = String(body.name ?? '');
      // A missing SQLite engine, or a locked file, is a 500 with a message rather than a silent no-op.
      try {
        if (action === 'create') {
          const made = createDataBackup();
          json(res, 200, { ok: true, name: made.name });
          return;
        }
        if (action === 'restore') {
          const ok = restoreDataBackup(name);
          json(res, ok ? 200 : 400, ok ? { ok: true, name } : { ok: false, error: 'unknown snapshot' });
          return;
        }
        if (action === 'reset') {
          const done = resetStatistics();
          json(res, 200, { ok: true, ...done });
          return;
        }
        if (action === 'delete') {
          const ok = deleteDataBackup(name);
          json(res, ok ? 200 : 400, ok ? { ok: true, name } : { ok: false, error: 'unknown snapshot' });
          return;
        }
      } catch (error) {
        json(res, 500, { ok: false, error: (error as Error).message || 'backup failed' });
        return;
      }
      json(res, 400, { ok: false, error: 'unknown action' });
      return;
    }
    if (req.url?.startsWith('/api/mark?') && req.method === 'GET') {
      // Marks are CDN files, fetched through on demand: the browser caches them, and Tersio keeps no copies on disk.
      const slug = new URL(req.url, 'http://127.0.0.1').searchParams.get('slug') ?? '';
      const remote = REMOTE_MARKS[slug];
      if (!remote) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('unknown mark');
        return;
      }
      try {
        const answer = await fetch(remote, { signal: AbortSignal.timeout(5000) });
        if (!answer.ok) throw new Error(`HTTP ${answer.status}`);
        // A redirect to a login or error page must never render as a mark.
        const type = answer.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
        if (!type.startsWith('image/')) throw new Error(`unexpected type ${type}`);
        const bytes = Buffer.from(await answer.arrayBuffer());
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=604800, stale-while-revalidate=86400' });
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
      json(res, 200, readActivity(limit));
      return;
    }
    // The canvas node layout lives tersio-side, not in the browser: localStorage is scoped to the
    // origin, so a dashboard restart on a new port would forget every node the user placed.
    if (req.url === '/api/pipeline/positions' && req.method === 'GET') {
      let raw = cacheGet('dashboard.pipeline');
      if (raw === null) {
        // One-time import of the loose file an older build wrote.
        try {
          raw = readFileSync(path.join(tersioHome(), 'pipeline-positions.json'), 'utf8');
          cachePut('dashboard.pipeline', raw);
          rmSync(path.join(tersioHome(), 'pipeline-positions.json'), { force: true });
        } catch { raw = null; }
      }
      let positions: unknown = {};
      try { if (raw !== null) positions = JSON.parse(raw) as unknown; } catch { /* a damaged record reads empty */ }
      json(res, 200, { ok: true, positions: positions && typeof positions === 'object' ? positions : {} });
      return;
    }
    if (req.url === '/api/pipeline/positions' && req.method === 'POST') {
      const body = await bodyOf(req);
      const stored = body.positions;
      if (!stored || typeof stored !== 'object') {
        json(res, 400, { ok: false, error: 'positions must be an object' });
        return;
      }
      cachePut('dashboard.pipeline', JSON.stringify(stored));
      json(res, 200, { ok: true });
      return;
    }
    if (req.url === '/settings' && req.method === 'GET') {
      storedProfile().then((profile) => {
        // The per-host sections ride along, so the canvas can show and set one agent's own defaults.
        let hosts: Record<string, unknown> = {};
        try {
          hosts = (JSON.parse(readFileSync(tersioSettingsFile(), 'utf8') ?? '{}') as { hosts?: Record<string, unknown> }).hosts ?? {};
        } catch { /* no store yet: every host reads the flat defaults */ }
        json(res, 200, {
          comboDefault: profile.comboDefault,
          cavemanDefault: profile.cavemanDefault,
          rtkDefault: profile.rtkDefault,
          ponytailDefault: profile.ponytailDefault,
          pstackDefault: profile.pstackDefault,
          headroomDefault: profile.headroomDefault,
          hosts,
          comboLevel: comboLevelOf(profile),
          backupSchedule: profile.backupSchedule,
          retentionDays: profile.retentionDays,
          devTools: profile.devTools,
          accent: profile.accent,
          sidebarWidth: profile.sidebarWidth,
          sidebarOpen: profile.sidebarOpen,
          currency: options.currency,
        });
      });
      return;
    }
    if (req.url === '/settings' && req.method === 'POST') {
      const body = await bodyOf(req);
      const saved = await saveDefaults(body);
      if (!saved.ok) {
        json(res, 400, { ok: false, error: saved.error });
      } else {
        json(res, 200, { ok: true, ...saved.profile });
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
        json(res, 400, { ok: false, error: 'unknown currency' });
      } else {
        json(res, 200, { ok: true, currency: saved });
      }
      return;
    }
    if (req.url === '/api/update' && req.method === 'GET') {
      json(res, 200, updateView());
      return;
    }
    if (req.url === '/api/update' && req.method === 'POST') {
      let prefs: UpdatePrefs = {};
      try {
        prefs = (JSON.parse(await readBody(req)) as UpdatePrefs) ?? {};
      } catch { prefs = {}; }
      json(res, 200, setUpdatePrefs(prefs));
      return;
    }
    // Both start work and return at once: the page's poll carries the status and the streamed log.
    if (req.url === '/api/update/check' && req.method === 'POST') {
      json(res, 200, startCheck(true));
      return;
    }
    if (req.url === '/api/update/apply' && req.method === 'POST') {
      json(res, 200, startApply());
      return;
    }
    if (req.url === '/api/agent' || req.url?.startsWith('/api/agent?')) {
      jsonGzip(req, res, 200, agentJson(rangeFrom(req.url), viewFrom(req.url), offsetFrom(req.url)));
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
      json(res, 200, body);
      return;
    }
    if (req.url?.startsWith('/api/agent/entry')) {
      const file = decodeURIComponent(queryParam(req.url, 'file') ?? '');
      const entry = decodeURIComponent(queryParam(req.url, 'entry') ?? '');
      const body = file && entry ? readAgentRequestEntry(file, entry) : emptyRequestEntry();
      json(res, 200, body);
      return;
    }
    if (req.url?.startsWith('/export')) {
      return;
    }
    if (req.url === '/health') {
      jsonText(res, 200, healthJson());
      return;
    }
    if (req.url === '/status' && req.method === 'GET') {
      jsonText(res, 200, await statusJson());
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
      json(res, 200, report);
      return;
    }
    if (req.url === '/doctor/fix' && req.method === 'POST') {
      try {
        const { runDoctorRepairs } = await import('./doctor-fix.ts');
        const failed = await runDoctorRepairs(['extensions', 'registrations', 'ponytail']);
        recordActivity('doctor', 'Doctor repair', failed.length === 0 ? 'Extensions, registrations, and Ponytail checked.' : `${failed.length} step(s) failed.`, failed.length === 0);
        getDoctorReport(true);
        json(res, 200, { ok: failed.length === 0, failed });
      } catch (e) {
        json(res, 200, { ok: false, failed: ['fix'], error: (e as Error).message });
      }
      return;
    }
    if (req.url === '/doctor' || req.url?.startsWith('/doctor?')) {
      const fresh = (req.url.split('?')[1] ?? '').includes('fresh=1');
      json(res, 200, getDoctorReport(fresh));
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
    let signals = 0;
    let settled = false;
    // A browser tab holds keep-alive sockets, and a close that waits for them never releases the port.
    const sockets = new Set<Socket>();
    const settle = (): void => {
      if (!settled) { settled = true; resolve(); }
    };
    const rejectOnce = (err: Error): void => {
      if (!stopping) reject(err);
    };
    const stop = (): void => {
      signals += 1;
      // A second Ctrl-C skips the grace: the operator asked twice.
      if (signals > 1) {
        try { server.closeAllConnections(); } catch { /* a runtime without the call */ }
        for (const socket of sockets) { try { socket.destroy(); } catch { /* gone */ } }
        process.exit(130);
      }
      if (stopping) return;
      stopping = true;
      server.close(settle);
      try { server.closeIdleConnections(); } catch { /* a runtime without the call */ }
      // A request still in flight gets a moment; after that every socket is cut and the port is free.
      const cut = setTimeout(() => {
        try { server.closeAllConnections(); } catch { /* a runtime without the call */ }
        for (const socket of sockets) { try { socket.destroy(); } catch { /* gone */ } }
        settle();
      }, 300);
      cut.unref();
    };

    server.on('connection', (socket: Socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    server.once('error', rejectOnce);
    server.listen(options.port, listenHost, () => {
      try { process.title = 'tersio dashboard'; } catch { /* non-POSIX shells keep node */ }
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : options.port;
      const url = `http://127.0.0.1:${port}`;
      console.log(`[ok] Dashboard live → ${url} (Ctrl-C to stop)`);
      for (const lan of lanUrls(port, listenHost)) {
        console.log(`[lan] ${lan}`);
        // A phone scans this; skip it when the output is piped or color is disabled.
        const qr = process.stdout.isTTY && !process.env.NO_COLOR ? qrTerminal(lan) : null;
        if (qr) console.log(qr);
      }
      // An enabled integration outlives a reboot, but its proxy does not. Restore the runtime the config expects.
      const runtimeBin = resolveHeadroomBinary();
      if (runtimeBin && (Object.values(readHeadroomWraps()).some(Boolean) || DURABLE_CONFIG.some((name) => durableConfigInstalled(name)))) {
        void ensureHeadroomRuntime(runtimeBin);
      }

      // The cadence only matters while a server is up, so the watch starts with it.
      startUpdateWatch();
      // The first page load should not pay for a cold read: warm the default range once the port is up.
      // Warm the two ranges a page opens on, one per tick so the port stays responsive.
      const warm: RangeKey[] = process.env.TERSIO_WARM === '0' ? [] : ['24h', '7d', 'all'];
      const warmNext = (index: number): void => {
        const range = warm[index];
        if (!range) return;
        try { agentStats(range); } catch { /* the request path retries it */ }
        setTimeout(() => warmNext(index + 1), 800);
      };
      setTimeout(() => warmNext(0), 250);
      if (options.open) openBrowser(url);
    });
  });
}

export { agentStats, runDashboard, saveDashboardCurrency, readDiagSchedule, setDiagSchedule, offsetFrom };
export type { DiagSchedule };