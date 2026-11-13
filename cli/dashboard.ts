// Dashboard server + usage APIs. Binds 127.0.0.1; --export writes a file. No Promise.withResolvers (Node 20.12).
import { spawn, type ChildProcess } from 'node:child_process';
import { readActivity, recordActivity } from './activity.ts';
import { cacheGet, cachePut } from '../extensions/shared/cache-store.ts';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync, watch } from 'node:fs';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import type { Socket } from 'node:net';
import { gzipSync } from 'node:zlib';
import { readHeadroomRoute } from '../extensions/shared/headroom-routing.ts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCurrencyCode } from './currency.ts';
import type { CurrencyCode } from './currency.ts';
import { qrTerminal } from './qr.ts';
import { ensureHeadroomRuntime } from '../extensions/shared/headroom-runtime.ts';
import { handleBenchRoutes } from './dashboard-bench.ts';
import { handleHeadroomRoutes } from './dashboard-headroom.ts';
import { handleVendorRoutes } from './dashboard-vendor.ts';
import { handleHostRoutes } from './dashboard-hosts.ts';
import { OMP_AGENT_DIR, OMP_PLUGINS_DIR, PACKAGE_VERSION } from './common.ts';
import {
  BACKUP_SCHEDULES,
  applyComboPreset,
  clampSidebarWidth,
  comboLevelOf,
  formatCliStatus,
  RETENTION_DAYS,
  saveHostDefaults,
  storedProfile,
  writePluginSettings,
} from './profile.ts';
import { readState } from '../extensions/shared/state.ts';
import { REMOTE_MARKS } from '../extensions/shared/brand-marks.ts';
import { setUpdatePrefs, startApply, startCheck, startUpdateWatch, updateView } from './dashboard-update.ts';
import type { UpdatePrefs } from './dashboard-update.ts';
import type { BackupSchedule, HostDefaultField } from './profile.ts';
import { normalizeComboLevel } from '../extensions/shared/session-state.ts';
import {
  ACCENT_DEFAULTS,
  CAVEMAN_DEFAULTS,
  COMBO_PRESET_MODES,
  HEADROOM_DEFAULTS,
  PONYTAIL_DEFAULTS,
  PSTACK_DEFAULTS,
} from './common.ts';
import { PACKAGE_NAME } from './common.ts';
import { detectHosts, dshHome, dshPresent, dshVersionBinary, hostAgentInfo } from './hosts.ts';
import { checkHostTrees } from './host-tree.ts';
import {
  findPackageRoot,
  homeDir,
  openCommand,
  resolveCodexBinary,
  resolveHeadroomBinary,
  resolveHostBinary,
  resolveRtkBinary,
  ruleBodyProblem,
  tersioHome,
} from '../extensions/shared/utils.ts';
import { tersioSettingsFile } from '../extensions/shared/plugin-settings.ts';
import { codexHome } from '../extensions/shared/codex-state.ts';
import { claudeHome } from '../extensions/shared/claude-state.ts';
import { tersioMcpConfigured, tersioMcpSupported } from '../extensions/shared/mcp-config.ts';
import {
  BACKUP_KEEP,
  backupDir,
  backupDiskBytes,
  createDataBackup,
  dataSources,
  deleteDataBackup,
  listDataBackups,
  restoreDataBackup,
} from '../extensions/shared/snapshots.ts';
import {
  applyTarget,
  emptyConfig,
  listSyncVersions,
  publicFields,
  readSync,
  restoreSync,
  runSync,
  saveSync,
  syncTarget,
  testTarget,
} from './dashboard-sync.ts';
import { remoteFor } from '../extensions/shared/sync-remote.ts';
import {
  CAVEMAN_PIN,
  PSTACK_PIN,
  cachedScorecard,
  cachedScorecardSync,
  refreshScorecard,
  upstreamHistory,
} from './upstream.ts';
import { resetCounts, resetStatistics } from './reset.ts';

import { readBackupSchedule } from '../extensions/shared/usage-store.ts';
import {
  emptyRequestEntry,
  isAgentView,
  isRangeKey,
  readAgentRequestEntry,
  readHeadroomReport,
  readSessionTrace,
} from '../extensions/shared/agent-stats.ts';
import { agentStats, DEFAULT_AGENT_RANGE } from '../extensions/shared/agent-snapshot.ts';
import type { AgentView, RangeKey } from '../extensions/shared/agent-types.ts';

/** The listen address: every interface by default, so a phone can open it. `local` keeps it loopback. */
export function resolveBind(bind?: string | null): string {
  const value = (bind ?? '').trim().toLowerCase();
  if (value === '') return '0.0.0.0';
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

/** One mode's shipped version against the newest upstream the last check saw; null when no check ran. */
interface ModeVersion {
  installed: string | null;
  upstream: string | null;
  outdated: boolean | null;
}

/**
 * The version inside a tool's own line: `rtk 1.1.0` and `v1.2.3` both read as `1.1.0` and `1.2.3`.
 * A commit pin compares as its short SHA, so a scorecard's full SHA still matches.
 */
function bare(value: string | null | undefined): string | null {
  if (!value || value === 'unknown' || value === 'HEAD') return null;
  const tail = value
    .trim()
    .replace(/^[a-z][a-z-]*\s+(?=\d)/i, '')
    .replace(/^v(?=\d)/i, '');
  // An installed value that is already a short SHA stays short; a full one is trimmed to compare.
  return tail.trim() || null;
}

/** True when a value is a commit SHA short enough to be a prefix rather than a release. */
function isShortSha(value: string): boolean {
  return /^[0-9a-f]{7,}$/i.test(value);
}

function sameRelease(mine: string, theirs: string): boolean {
  if (mine === theirs) return true;
  return isShortSha(mine) && theirs.toLowerCase().startsWith(mine.toLowerCase());
}

/** A mode is outdated only when both sides are known and differ, so an offline check never paints a false orange. */
function modeVersion(installed: string | null, upstream: string | null): ModeVersion {
  const mine = bare(installed);
  const theirs = bare(upstream);
  return {
    installed: mine,
    upstream: theirs,
    outdated: mine !== null && theirs !== null ? !sameRelease(mine, theirs) : null,
  };
}

/** The per-mode versions the canvas badges read, from the shipped pins and the last scorecard. */
function modeVersions(rtk: string | null, headroom: string | null): Record<string, ModeVersion> {
  const sources = cachedScorecardSync()?.sources ?? [];
  const upstreamOf = (name: string): string | null => sources.find((row) => row.source === name)?.upstream ?? null;
  return {
    caveman: modeVersion(CAVEMAN_PIN, upstreamOf('Caveman')),
    ponytail: modeVersion(ponytailVersion(), upstreamOf('Ponytail')),
    // The scorecard pins pstack to a commit, so its readable version is the short SHA.
    pstack: modeVersion(PSTACK_PIN.slice(0, 7), upstreamOf('pstack')),
    rtk: modeVersion(rtk, upstreamOf('RTK')),
    headroom: modeVersion(headroom, upstreamOf('Headroom')),
  };
}

/** The ponytail version this build vendors, read from its package; null when the tree is absent. */
function ponytailVersion(): string | null {
  try {
    const pkg = path.join(
      findPackageRoot(path.dirname(fileURLToPath(import.meta.url))),
      'extensions',
      'ponytail',
      'package.json',
    );
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

/** `?range=` on any of the omp routes; an unknown value falls back to the default. */
function queryParam(url: string, name: string): string | null {
  return (
    (url.split('?')[1] ?? '')
      .split('&')
      .find((part) => part.startsWith(`${name}=`))
      ?.slice(name.length + 1) ?? null
  );
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

/** The third-party binary Tersio installs and removes; rtk manages its own, so anything else is a bad request. */
export function isVendorTool(tool: string): tool is 'headroom' {
  return tool === 'headroom';
}

/** The one Headroom install job, so the Tools page can poll until the binary appears or the pip run fails. */
const headroomJob: { startedAt: number; code: number | null; error: string | null } = {
  startedAt: 0,
  code: null,
  error: null,
};
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
    recordActivity(
      'agent',
      `Headroom install ${ok ? 'finished' : 'failed'}`,
      ok ? undefined : headroomJob.error?.split('\n')[0],
      ok,
    );
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

function codexPath(): string | null {
  return resolveCodexBinary();
}

/** DeepSeek Harness may be a CLI, the desktop app's bundled runner, or only its home; one of them answers. */
function dshPath(): string | null {
  if (!dshPresent()) return null;
  const runner = dshVersionBinary();
  if (runner) return runner;
  // Neither a CLI nor the app answers, so the harness is only its home directory; there is no version to ask for.
  return null;
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
      const out = execFileSync(exe, ['/d', '/s', '/c', bin, '--version'], {
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true,
      });
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
    return (
      execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true })
        .trim()
        .split(/\r?\n/)[0] || null
    );
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
const agentDir = (id: 'omp' | 'pi' | 'pig' | 'opencode' | 'dsh' | 'codex' | 'claude'): string | null => {
  if (id === 'omp') return path.join(homeDir(), '.omp');
  if (id === 'pi') return path.join(homeDir(), '.pi');
  if (id === 'pig') return path.join(homeDir(), '.pig');
  if (id === 'dsh') return dshHome();
  if (id === 'codex') return codexHome();
  if (id === 'claude') return claudeHome();
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
  const detectedCodexPath = codexPath();
  const detectedDshPath = dshPath();
  const detectedClaudePath = resolveHostBinary('claude', path.join(homeDir(), '.local', 'bin'));
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
    codex: agentVersion(detectedCodexPath),
    codexPath: detectedCodexPath,
    codexDir: agentDir('codex'),
    claude: agentVersion(detectedClaudePath),
    claudePath: detectedClaudePath,
    claudeDir: agentDir('claude'),
    dsh: agentVersion(detectedDshPath),
    dshPath: detectedDshPath,
    dshDir: agentDir('dsh'),
    provider: ompDefaultModel(),
    rtk: {
      present: rtkPresent,
      version: rtkPresent ? rtkVersion(rtkBin as string) : null,
      path: rtkBin || 'not found in PATH',
    },
    headroom: {
      present: headroomPresent,
      version: headroomPresent ? headroomVersion(headroomBin as string) : null,
      path: headroomBin || 'not found in PATH',
    },
    // The shipped-build pins: what this dashboard's own tree carries, not what upstream released.
    modes: { caveman: CAVEMAN_PIN.replace(/^v/, ''), ponytail: ponytailVersion(), pstack: null },
    modeVersions: modeVersions(
      rtkPresent ? rtkVersion(rtkBin as string) : null,
      headroomPresent ? headroomVersion(headroomBin as string) : null,
    ),
    home: tersioHomePath(),
  });
}

function tersioHomePath(): string {
  return path.join(homeDir(), '.tersio');
}

interface DoctorRow {
  label: string;
  ok: boolean;
  detail: string;
  group: string;
  neutral?: boolean;
  warn?: boolean;
  host?: string;
  /** False when the agent itself is not on this machine, so the row can dim and stop hovering. */
  agentPresent?: boolean;
}

interface DoctorReport {
  rows: DoctorRow[];
  checkedAt: number;
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

/** A pin's own age, short like the Upstream page: `5d ago`, not a local file's mtime. */
function pinnedAge(at: number | null | undefined): string {
  if (!at) return '';
  const days = Math.floor((Date.now() - at) / 86_400_000);
  if (days >= 1) return `${days}d ago`;
  const hours = Math.floor((Date.now() - at) / 3_600_000);
  return hours >= 1 ? `${hours}h ago` : 'today';
}

function listed(items: string[]): string {
  return `${items.slice(0, 6).join(', ')}${items.length > 6 ? ` +${items.length - 6} more` : ''}`;
}

function computeDoctorRows(): DoctorRow[] {
  const rows: DoctorRow[] = [];
  const warnings: DoctorRow[] = [];
  const rtkBin = resolveRtkBinary();
  const tersioPluginDir = path.join(OMP_PLUGINS_DIR, 'node_modules', ...PACKAGE_NAME.split('/'));
  const addon = (label: string, present: boolean, detail: string, group = 'Add-ons', neutral = false): void => {
    rows.push({ label, ok: present, detail, group, ...(neutral ? { neutral: true } : {}) });
  };
  const warning = (label: string, detail: string, host?: string): void => {
    warnings.push({ label, ok: false, detail, group: 'Warnings', warn: true, ...(host ? { host } : {}) });
  };
  // A missing host is not a fault: it stays visible with no install command and no fix prompt.
  for (const host of detectHosts()) {
    const agent = hostAgentInfo(host.id);
    const agentDetail = agent.version ? `v${agent.version}` : '';
    const row = (ok: boolean, detail: string, neutral = false): void => {
      rows.push({
        label: host.label,
        ok,
        detail,
        group: 'Hosts',
        host: host.id,
        agentPresent: agent.present,
        ...(neutral ? { neutral: true } : {}),
      });
    };
    if (!host.installed) {
      row(false, agentDetail, true);
      continue;
    }
    row(true, agentDetail);
    if (host.id === 'omp' && host.version && host.version !== PACKAGE_VERSION) {
      warning(
        'Oh My Pi plugin version',
        `v${host.version} while this CLI is v${PACKAGE_VERSION} — run: tersio install --host omp`,
        host.id,
      );
    }
    // Declining the MCP entry at install is allowed, so this row informs without counting as a fault.
    if (!tersioMcpConfigured(host.id)) {
      warning(
        `${host.label} MCP`,
        tersioMcpSupported(host.id)
          ? `MCP server not wired — tersio install --host ${host.id}`
          : 'MCP entry missing from the bundle patch',
        host.id,
      );
    }
  }
  const scorecard = cachedScorecardSync();
  const upstreamPin = (source: string, fallback: string): string => {
    const row = scorecard?.sources.find((entry) => entry.source.toLowerCase() === source.toLowerCase());
    const age = pinnedAge(row?.pinnedAt);
    return `${row?.pin ?? fallback}${age ? ` · ${age}` : ''}`;
  };
  const rule = path.join(tersioPluginDir, 'extensions', 'caveman', 'rule.md');
  const ruleAge = ageStr(rule);
  const ruleAt = absTime(rule);
  // The body carries no version, so the release it came from is the number: the pinned one, or the one a pull recorded.
  const cavemanRelease = (readState().cavemanUpstream?.tag ?? CAVEMAN_PIN).replace(/^v/, '');
  const cavemanPin = upstreamPin('Caveman', cavemanRelease);
  addon(
    '🪨 Caveman rule',
    ruleAge !== null,
    ruleAge && ruleAt ? `${cavemanPin} (updated ${ruleAge} · ${ruleAt})` : rule,
  );
  // The pstack body is a Tersio fork with no remote, so this row proves it is usable, not current.
  const pstackRule = path.join(tersioPluginDir, 'extensions', 'pstack', 'rule.md');
  let pstackProblem: string | null = 'missing — run: tersio install';
  try {
    pstackProblem = ruleBodyProblem(readFileSync(pstackRule, 'utf8'));
  } catch {
    /* missing stays */
  }
  const pstackAge = ageStr(pstackRule);
  const pstackAt = absTime(pstackRule);
  addon(
    '🥔 pstack',
    pstackProblem === null,
    pstackProblem ?? `${upstreamPin('pstack', PSTACK_PIN.slice(0, 7))} (updated ${pstackAge} · ${pstackAt})`,
  );
  const rtkVer = rtkBin ? rtkVersion(rtkBin) : null;
  const rtkAge = rtkBin ? ageStr(rtkBin) : null;
  const rtkAt = rtkBin ? absTime(rtkBin) : null;
  addon(
    '🗜️ RTK binary',
    rtkVer !== null,
    rtkVer && rtkAge && rtkAt ? `${rtkVer} (updated ${rtkAge} · ${rtkAt})` : rtkBin || 'not found in PATH',
  );
  // Opt-in and user-owned: the row reports the binary when it exists and stays quiet when it does not.
  const headroomBin = resolveHeadroomBinary();
  if (headroomBin) addon('🍃 Headroom binary', true, headroomVersion(headroomBin) ?? headroomBin);
  // Ponytail rides inside the plugin now, so the version comes from the vendored copy, not a sibling package.
  const ponytailPkg = path.join(tersioPluginDir, 'extensions', 'ponytail', 'package.json');
  let ponytailVer: string | null = null;
  try {
    ponytailVer = (JSON.parse(readFileSync(ponytailPkg, 'utf8')) as { version?: string }).version ?? null;
  } catch {
    ponytailVer = null;
  }
  const ponytailAge = ageStr(ponytailPkg);
  const ponytailAt = absTime(ponytailPkg);
  addon(
    '🧠 Ponytail',
    ponytailVer !== null,
    ponytailVer && ponytailAge && ponytailAt ? `${ponytailVer} (updated ${ponytailAge} · ${ponytailAt})` : ponytailPkg,
  );
  const tree = checkHostTrees(
    detectHosts().filter((host) => host.installed && host.id !== 'codex'),
    path.join(tersioPluginDir, 'extensions'),
  );
  if (tree.stale.length > 0)
    warning(
      'Per-host add-on files',
      `stale in ${tree.stale.length} file${tree.stale.length === 1 ? '' : 's'}: ${listed(tree.stale)} — run: tersio install --host <host>`,
    );
  if (tree.missing.length > 0)
    warning(
      'Per-host add-on files',
      `never installed in ${tree.missing.length} file${tree.missing.length === 1 ? '' : 's'}: ${listed(tree.missing)} — run: tersio install --host <host>`,
    );
  if (tree.orphan.length > 0)
    warning(
      'Per-host add-on files',
      `orphaned in ${tree.orphan.length} file${tree.orphan.length === 1 ? '' : 's'}: ${listed(tree.orphan)} — run: tersio doctor --fix extensions`,
    );
  if (tree.unwritten.length > 0)
    addon(
      'Add-on tree content',
      false,
      `${tree.unwritten.length} declared file${tree.unwritten.length === 1 ? '' : 's'} not written for a host reading as installed: ${listed(tree.unwritten)} — run: tersio doctor --fix extensions`,
      'Issues',
    );
  rows.push(...warnings);
  return rows;
}

// The diagnosis runs every time it is read; there is no schedule or cached report.
function getDoctorReport(): DoctorReport {
  return { rows: computeDoctorRows(), checkedAt: Date.now() };
}

// One field per call, validated against the same sets the CLI uses. A body with a `host` writes that
// agent's own section, so one agent's preset never becomes every agent's.
// Writes serialize: every call re-reads the profile inside the queue, so two overlapping requests (a sidebar drag racing a toggle) can never write whole profiles from stale snapshots.
let profileWriteQueue: Promise<unknown> = Promise.resolve();

function saveDefaults(
  body: Record<string, unknown>,
): Promise<{ ok: true; profile: Record<string, unknown> } | { ok: false; error: string }> {
  const run = async (): Promise<{ ok: true; profile: Record<string, unknown> } | { ok: false; error: string }> => {
    const HOST_SCOPES = ['omp', 'pi', 'opencode', 'pig', 'dsh', 'codex', 'claude'] as const;
    const hostScope =
      typeof body.host === 'string' && (HOST_SCOPES as readonly string[]).includes(body.host)
        ? (body.host as (typeof HOST_SCOPES)[number])
        : null;
    if (body.host !== undefined && hostScope === null) return { ok: false, error: 'unknown host scope' };
    const profile = await storedProfile(hostScope);
    const events: string[] = [];
    // A host scope carries only the mode fields the request changed; non-mode fields stay global-only.
    const changedFields: HostDefaultField[] = [];
    // `inherit` describes one agent's section; a shared write has nothing to hand the value back to.
    const inherited = [
      'comboDefault',
      'cavemanDefault',
      'rtkDefault',
      'ponytailDefault',
      'pstackDefault',
      'headroomDefault',
    ].filter((key) => String(body[key]) === 'inherit');
    if (inherited.length > 0 && !body.host) return { ok: false, error: 'inherit applies to one agent — pass a host' };
    if (String(body.comboDefault) === 'inherit') {
      // SAFETY: the typed profile omits 'inherit', but the request validated it above and the shared store accepts it.
      Object.assign(profile as unknown as Record<string, unknown>, {
        comboDefault: 'inherit',
        cavemanDefault: 'inherit',
        rtkDefault: 'inherit',
        ponytailDefault: 'inherit',
      });
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
      if (body.rtkDefault !== 'inherit' && typeof body.rtkDefault !== 'boolean')
        return { ok: false, error: 'rtk default must be true, false, or inherit' };
      // SAFETY: rtkDefault is validated above as a boolean or the literal 'inherit', which the store accepts.
      (profile as unknown as Record<string, unknown>).rtkDefault = body.rtkDefault;
      events.push(
        body.rtkDefault === 'inherit' ? 'RTK back to the shared default' : `RTK to ${body.rtkDefault ? 'on' : 'off'}`,
      );
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
    for (const title of events)
      recordActivity('mode', title, hostScope ? `Applies to new ${hostScope} sessions.` : 'Applies to new sessions.');
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
  };

  const result = profileWriteQueue.then(run, run);
  profileWriteQueue = result.catch(() => null);
  return result;
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
    req.on('data', (chunk: unknown) => {
      body += String(chunk);
    });
    req.on('end', () => {
      resolve(body);
    });
    req.on('error', () => {
      resolve('');
    });
  });
}

/** One JSON reply: every route answers this shape, so the header is set in one place. */
export function json(res: Pick<http.ServerResponse, 'writeHead' | 'end'>, code: number, body: unknown): void {
  // A string here would be serialized twice; the routes that build their own text call jsonText.
  if (typeof body === 'string')
    throw new Error('json() takes a value, not text: use jsonText() for a serialized payload');
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
  // The exported Tools page has no server to read Headroom's CLI, so the snapshot carries what it said now.
  const headroom = await readHeadroomReport();
  const inline = bundle
    .replace(
      'window.__TERSIO_SNAP = null;',
      () =>
        `window.__TERSIO_SNAP = ${escapeInline(JSON.stringify({ currency, agent: agentStats(DEFAULT_AGENT_RANGE), headroom, health: parseOwnJson(healthJson(), 'health'), doctor: getDoctorReport() }))};`,
    )
    // A mark is an HTML attribute or JSX prop; match every quote or the file keeps an unresolvable reference.
    .replace(
      /((?:src|href)[=:][ \t]*)([`"'])brand\.webp\2/g,
      (_all, head: string, quote: string) => `${head}${quote}${icon}${quote}`,
    )
    .replace(
      /fetch\(([`"])brand\.webp\1\)/g,
      () => `Promise.resolve({ ok: true, blob: async () => new Blob([${brandBytes}], { type: "image/webp" }) })`,
    );
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
      // The child owns the live, LAN, and QR lines; its crashes stay in the watcher.
      stdio: ['inherit', 'inherit', 'ignore'],
    });
    child.on('exit', () => {
      if (stopping) return;
      if (pendingRestart) {
        pendingRestart = false;
        setTimeout(spawnChild, 300);
        return;
      }
      setTimeout(() => {
        if (!stopping) spawnChild();
      }, 500);
    });
  };
  const restart = (): void => {
    if (!child || pendingRestart) return;
    pendingRestart = true;
    child.kill('SIGTERM');
  };
  spawnChild();
  // UI rebuilds ride vite's own watcher: the server serves dist fresh per request, so a reload picks them up.
  // Bun is the repo's package runner; without it, run vite's own entry under this interpreter.
  // The watcher stays quiet, so the live block is the only output a user sees.
  vite = spawn(bun ?? process.execPath, [viteBin, 'build', '--watch', '--logLevel', 'warn'], {
    stdio: ['ignore', 'ignore', 'ignore'],
    cwd: appDir,
  });
  // Watch only the trees the server reads; recursing the repo root would carry node_modules and .git.
  const watched = ['cli', 'extensions'].map((dir) => path.join(root, dir)).filter((dir) => existsSync(dir));
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
  } catch {
    /* a platform without recursive watch simply skips auto-restart */
  }
  const stop = (code: number): void => {
    stopping = true;
    try {
      child?.kill('SIGTERM');
    } catch {
      /* gone */
    }
    try {
      vite?.kill('SIGTERM');
    } catch {
      /* gone */
    }
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
  if (
    (options.watch || (shouldAutoWatch(hasSource, tty) && !options.exportFile)) &&
    process.env.TERSIO_DASHBOARD_CHILD !== '1'
  ) {
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
      } catch {
        /* no bundle yet */
      }
      res.setHeader('Cache-Control', 'no-store');
      json(res, 200, { id });
      return;
    }
    if (
      await handleHeadroomRoutes(req, res, {
        json,
        bodyOf,
        spawnHeadroomInstall,
        headroomInstallState,
        ensureRuntime: ensureHeadroomRuntime,
      })
    )
      return;
    if (await handleVendorRoutes(req, res, { json, bodyOf, spawnHeadroomInstall, isVendorTool })) return;
    if (await handleHostRoutes(req, res, { json, bodyOf, detectHosts, hostJobs, spawnCli })) return;
    if (handleBenchRoutes(req, res, { json })) return;
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
        if (action === 'delete' && Array.isArray(body.names)) {
          const names = body.names.filter((entry): entry is string => typeof entry === 'string');
          const deleted = names.filter((entry) => deleteDataBackup(entry));
          json(res, 200, { ok: true, deleted });
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
    if (req.url === '/api/sync' && req.method === 'GET') {
      const saved = readSync();
      let versions: Awaited<ReturnType<typeof listSyncVersions>> = [];
      let error: string | null = null;
      if (saved.config) {
        // A credential that stopped working must not blank the panel: the saved target still shows.
        try {
          versions = await listSyncVersions();
        } catch (caught) {
          error = (caught as Error).message;
        }
      }
      json(res, 200, {
        configured: saved.config !== null,
        mode: saved.config?.mode ?? null,
        target: syncTarget(saved.config),
        passphraseSet: saved.passphrase.trim() !== '',
        fields: publicFields(saved.config),
        versions,
        error,
      });
      return;
    }
    if (req.url === '/api/sync' && req.method === 'POST') {
      const body = await bodyOf(req);
      const mode = String(body.mode ?? '');
      if (mode !== 'webdav' && mode !== 's3' && mode !== 'github') {
        json(res, 400, { ok: false, error: 'unknown sync target' });
        return;
      }
      const target = body.target && typeof body.target === 'object' ? (body.target as Record<string, unknown>) : {};
      const config = applyTarget(mode, target, readSync().config ?? emptyConfig());
      try {
        // The same constructor the upload uses, so an incomplete target fails here and not at 3 a.m.
        remoteFor(config);
      } catch (caught) {
        json(res, 400, { ok: false, error: (caught as Error).message });
        return;
      }
      saveSync({ config, passphrase: String(body.passphrase ?? '') });
      json(res, 200, { ok: true, target: syncTarget(config) });
      return;
    }
    if (req.url === '/api/sync/test' && req.method === 'POST') {
      const body = await bodyOf(req);
      const mode = String(body.mode ?? '');
      if (mode !== 'webdav' && mode !== 's3' && mode !== 'github') {
        json(res, 400, { ok: false, error: 'unknown sync target' });
        return;
      }
      const target = body.target && typeof body.target === 'object' ? (body.target as Record<string, unknown>) : {};
      const config = applyTarget(mode, target, readSync().config ?? emptyConfig());
      const result = await testTarget(config);
      json(res, result.ok ? 200 : 400, result);
      return;
    }
    if (req.url === '/api/sync/run' && req.method === 'POST') {
      try {
        const made = await runSync();
        json(res, 200, { ok: true, ...made });
      } catch (caught) {
        json(res, 400, { ok: false, error: (caught as Error).message });
      }
      return;
    }
    if (req.url === '/api/sync/restore' && req.method === 'POST') {
      const body = await bodyOf(req);
      const name = String(body.name ?? '');
      if (!name.endsWith('.tsb')) {
        json(res, 400, { ok: false, error: 'unknown backup name' });
        return;
      }
      try {
        const restored = await restoreSync(name);
        json(res, 200, { ok: true, ...restored });
      } catch (caught) {
        json(res, 400, { ok: false, error: (caught as Error).message });
      }
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
        res.writeHead(200, {
          'Content-Type': type,
          'Cache-Control': 'public, max-age=604800, stale-while-revalidate=86400',
        });
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
        } catch {
          raw = null;
        }
      }
      let positions: unknown = {};
      try {
        if (raw !== null) positions = JSON.parse(raw) as unknown;
      } catch {
        /* a damaged record reads empty */
      }
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
          hosts =
            (JSON.parse(readFileSync(tersioSettingsFile(), 'utf8') ?? '{}') as { hosts?: Record<string, unknown> })
              .hosts ?? {};
        } catch {
          /* no store yet: every host reads the flat defaults */
        }
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
      } catch {
        code = null;
      }
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
      let prefs: UpdatePrefs;
      try {
        prefs = (JSON.parse(await readBody(req)) as UpdatePrefs) ?? {};
      } catch {
        prefs = {};
      }
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
      const body = file
        ? readSessionTrace(file)
        : {
          sessionFile: '',
          project: '',
          title: '',
          cwd: '',
          startedAt: 0,
          endedAt: 0,
          tracks: [],
          markers: [],
          summary: {
            wallMs: 0,
            modelMs: 0,
            toolMs: 0,
            idleMs: 0,
            turns: 0,
            requests: 0,
            toolCalls: 0,
            agents: 0,
            totalTokens: 0,
            costUsd: 0,
          },
          toolStats: [],
          truncated: false,
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
    if (req.url === '/doctor/fix' && req.method === 'POST') {
      try {
        const { runDoctorRepairs } = await import('./doctor-fix.ts');
        const failed = await runDoctorRepairs(['extensions', 'registrations', 'ponytail']);
        recordActivity(
          'doctor',
          'Doctor repair',
          failed.length === 0 ? 'Extensions, registrations, and Ponytail checked.' : `${failed.length} step(s) failed.`,
          failed.length === 0,
        );
        getDoctorReport();
        json(res, 200, { ok: failed.length === 0, failed });
      } catch (e) {
        json(res, 200, { ok: false, failed: ['fix'], error: (e as Error).message });
      }
      return;
    }
    if (req.url === '/doctor' || req.url?.startsWith('/doctor?')) {
      json(res, 200, getDoctorReport());
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
      } catch {
        /* fall through to index */
      }
    }
    // A watch restart can land before Vite writes its first bundle; retry on the next reload instead of throwing.
    let index: string;
    try {
      index = await readSegment(DASHBOARD_INDEX);
    } catch {
      res.writeHead(503, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'Retry-After': '1',
      });
      res.end('Dashboard is building. Reload in a moment.');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(index);
  });
  await new Promise<void>((resolve, reject) => {
    let stopping = false;
    let signals = 0;
    let settled = false;
    // A browser tab holds keep-alive sockets, and a close that waits for them never releases the port.
    const sockets = new Set<Socket>();
    const settle = (): void => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    const rejectOnce = (err: Error): void => {
      if (!stopping) reject(err);
    };
    const stop = (): void => {
      signals += 1;
      // A second Ctrl-C skips the grace: the operator asked twice.
      if (signals > 1) {
        try {
          server.closeAllConnections();
        } catch {
          /* a runtime without the call */
        }
        for (const socket of sockets) {
          try {
            socket.destroy();
          } catch {
            /* gone */
          }
        }
        process.exit(130);
      }
      if (stopping) return;
      stopping = true;
      server.close(settle);
      try {
        server.closeIdleConnections();
      } catch {
        /* a runtime without the call */
      }
      // A request still in flight gets a moment; after that every socket is cut and the port is free.
      const cut = setTimeout(() => {
        try {
          server.closeAllConnections();
        } catch {
          /* a runtime without the call */
        }
        for (const socket of sockets) {
          try {
            socket.destroy();
          } catch {
            /* gone */
          }
        }
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
    const onListening = (boundPort: number): void => {
      try {
        process.title = 'tersio dashboard';
      } catch {
        /* non-POSIX shells keep node */
      }
      const url = `http://127.0.0.1:${boundPort}`;
      console.log(`[ok] Dashboard live → ${url} (Ctrl-C to stop)`);
      for (const lan of lanUrls(boundPort, listenHost)) {
        console.log(`[lan] ${lan}`);
        const qr = process.stdout.isTTY && !process.env.NO_COLOR ? qrTerminal(lan) : null;
        if (qr) console.log(qr);
      }
      const runtimeBin = resolveHeadroomBinary();
      if (runtimeBin && detectHosts().some((host) => readHeadroomRoute(host.id).routed)) {
        void ensureHeadroomRuntime(runtimeBin);
      }
      startUpdateWatch();
      const warm: RangeKey[] = process.env.TERSIO_WARM === '0' ? [] : ['24h', '7d', 'all'];
      const warmNext = (index: number): void => {
        const range = warm[index];
        if (!range) return;
        try {
          agentStats(range, 'overview');
        } catch {
          /* the request path retries it */
        }
        setTimeout(() => warmNext(index + 1), 800);
      };
      setTimeout(() => warmNext(0), 250);
      if (options.open) openBrowser(url);
    };

    let attemptPort = options.port;
    const tryListen = (): void => {
      const errorHandler = (err: NodeJS.ErrnoException): void => {
        server.removeListener('error', errorHandler);
        if (err.code === 'EADDRINUSE' && options.port > 0 && attemptPort < options.port + 10) {
          attemptPort += 1;
          tryListen();
        } else {
          rejectOnce(err);
        }
      };
      server.once('error', errorHandler);
      server.listen(attemptPort, listenHost, () => {
        server.removeListener('error', errorHandler);
        server.on('error', rejectOnce);
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : attemptPort;
        onListening(port);
      });
    };
    tryListen();
  });
}

export { agentStats, runDashboard, saveDashboardCurrency, offsetFrom };
