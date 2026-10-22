// Shared helpers for the installer and AI add-ons updater. Node built-ins only — must stay dependency-free.

import { createHash } from 'node:crypto';
import { accessSync, constants, createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import fs from 'node:fs/promises';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';

export interface HttpOptions {
  maxRedirects?: number;
  signal?: AbortSignal;
  // Extra request headers; a GitHub token lifts the unauthenticated rate limit.
  headers?: Record<string, string>;
  // Whole-request budget. A caller with a deadline of its own, such as the doctor's spawn budget, sets this.
  timeout?: number;
}

// Promise.withResolvers is Node 22+; the package supports Node 18+.
export function withResolvers<T>(): PromiseWithResolvers<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// os.homedir() can ignore a runtime HOME, so a redirected home would read the real one.
export function homeDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE;
  return home && home.trim() !== '' ? home : os.homedir();
}

/** Windows cannot run a `.cmd` or `.bat` directly, so a shim path goes through the shell; a real `.exe` or POSIX binary passes through. */
export function shimCommand(cmd: string, args: string[]): { cmd: string; args: string[] } {
  if (process.platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(cmd)) return { cmd, args };
  return { cmd: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', cmd, ...args] };
}

/** rtk's own dirs: `config_dir()` for config.toml and `data_local_dir()` for history.db, which differ per platform; a guess here empties the Gain charts. */
export function rtkDirs(): { data: string; config: string } {
  if (process.platform === 'darwin') {
    const base = path.join(homeDir(), 'Library', 'Application Support', 'rtk');
    return { data: base, config: base };
  }
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(homeDir(), 'AppData', 'Local');
    const roaming = process.env.APPDATA || path.join(homeDir(), 'AppData', 'Roaming');
    return { data: path.join(local, 'rtk'), config: path.join(roaming, 'rtk') };
  }
  const xdgData = process.env.XDG_DATA_HOME || path.join(homeDir(), '.local', 'share');
  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(homeDir(), '.config');
  return { data: path.join(xdgData, 'rtk'), config: path.join(xdgConfig, 'rtk') };
}

/** The RTK project, named once: the release feed and the release page both read it. */
export const RTK_REPO = 'rtk-ai/rtk';
export const RTK_RELEASE_API = `https://api.github.com/repos/${RTK_REPO}/releases/latest`;
/** Caveman's bodies, as paths in the repository. A body is fetched at a release tag, never at the tip. */
export const CAVEMAN_BODY_PATHS = {
  full: 'skills/caveman/SKILL.md',
  ultra: 'skills/ultracave/SKILL.md',
  megacave: 'skills/megacave/SKILL.md',
} as const;
export const CAVEMAN_RAW = 'https://raw.githubusercontent.com/JuliusBrussee/caveman';
export const CAVEMAN_RELEASES = 'https://api.github.com/repos/JuliusBrussee/caveman/releases/latest';

/** The newest published Caveman release, so a body comes from an immutable tag. */
export async function cavemanRelease(): Promise<string | null> {
  try {
    // The release feed is rate-limited without a token, so the environment's token is used when there is one.
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    const json = await fetchJson<{ tag_name?: string }>(CAVEMAN_RELEASES, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
    return json.tag_name ?? null;
  } catch {
    return null;
  }
}

/** This project, named once: the update check reads its releases beside the registry's tag. */
export const TERSIO_REPO = 'KurutoDenzeru/tersio';
export const TERSIO_RELEASE_API = `https://api.github.com/repos/${TERSIO_REPO}/releases/latest`;

// A fetch that returns an error page or a truncated body must not reach the extension tree.
export function ruleBodyProblem(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === '') return 'empty body';
  if (/^\s*<(!doctype|html)/i.test(trimmed)) return 'HTML page, not markdown';
  if (/^\s*404\b/im.test(trimmed)) return 'upstream 404 page';
  if (trimmed.length < 800) return `truncated (${trimmed.length} chars)`;
  return null;
}

export interface RtkPlatformSpec {
  triple: string;
  ext: string;
  binary: string;
}

export interface RtkReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface RtkRelease {
  tag_name?: string;
  assets?: RtkReleaseAsset[];
}

const RTK_PLATFORM_SPECS: Record<string, RtkPlatformSpec> = {
  'win32/x64': { triple: 'x86_64-pc-windows-msvc', ext: '.zip', binary: 'rtk.exe' },
  'linux/x64': { triple: 'x86_64-unknown-linux-musl', ext: '.tar.gz', binary: 'rtk' },
  'linux/arm64': { triple: 'aarch64-unknown-linux-gnu', ext: '.tar.gz', binary: 'rtk' },
  'darwin/x64': { triple: 'x86_64-apple-darwin', ext: '.tar.gz', binary: 'rtk' },
  'darwin/arm64': { triple: 'aarch64-apple-darwin', ext: '.tar.gz', binary: 'rtk' },
};

// First executable `name` on PATH, else the managed Bun bin dir.
function firstExecutable(name: string, managedDir: string | null): string | null {
  const ext = process.platform === 'win32' ? '.cmd' : '';
  const candidates = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
    .flatMap((dir) => [path.join(dir, name + ext), path.join(dir, name)]);
  if (managedDir) candidates.push(path.join(managedDir, name + ext), path.join(managedDir, name));
  for (const candidate of candidates) {
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch { /* keep searching */ }
  }
  return null;
}

export function resolveRtkBinary(managedDir = path.join(homeDir(), '.bun', 'bin')): string | null {
  return firstExecutable(process.platform === 'win32' ? 'rtk.exe' : 'rtk', managedDir);
}

// A host binary to scan for its subagent marker.
export function resolveHostBinary(name: string, managedDir = path.join(homeDir(), '.bun', 'bin')): string | null {
  return firstExecutable(name, managedDir);
}

export function rtkPlatformSpec(platform: string = process.platform, arch: string = process.arch): RtkPlatformSpec | null {
  return RTK_PLATFORM_SPECS[`${platform}/${arch}`] || null;
}

// Walk up to the nearest package.json; identical for the source and compiled trees.
export function findPackageRoot(fromDir: string): string {
  let dir = fromDir;
  for (;;) {
    if (existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('package root not found');
    dir = parent;
  }
}

/** Where a mode's rule bodies sit: beside the module, else the package's own `extensions/<name>`. */
export function ruleDir(name: string, ownDir: string): string {
  if (existsSync(path.join(ownDir, 'rule.md'))) return ownDir;
  try { return path.join(findPackageRoot(ownDir), 'extensions', name); } catch { return ownDir; }
}

// The 3xx+location redirect rule shared by httpsGet/httpsDownload.
function redirectNext(res: { statusCode?: number; headers: { location?: string } }, url: string): string | null {
  if (res.statusCode !== undefined && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
    return new URL(res.headers.location, url).href;
  }
  return null;
}

// pi sets PI_CODING_AGENT; OMP does not. It reads PI_CODING_AGENT_DIR to relocate, so the override only counts there.
export function isPiProcess(): boolean {
  return process.env.PI_CODING_AGENT === 'true';
}

export function piAgentDir(): string {
  const override = process.env.PI_CODING_AGENT_DIR;
  return isPiProcess() && override ? override : path.join(homeDir(), '.pi', 'agent');
}

export function httpsGet(url: string, opts: HttpOptions = {}): Promise<string> {
  const { promise, resolve, reject } = withResolvers<string>();
  const maxRedirects = opts.maxRedirects ?? 5;
  const req = https.get(url, { headers: { 'User-Agent': 'tersio', Accept: 'application/json,*/*', ...opts.headers }, signal: opts.signal }, (res) => {
    const next = redirectNext(res, url);
    if (next) {
      if (maxRedirects <= 0) { res.resume(); reject(new Error(`Too many redirects fetching ${url}`)); return; }
      res.resume();
      resolve(httpsGet(next, { maxRedirects: maxRedirects - 1, signal: opts.signal }));
      return;
    }
    if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode} for ${url}`)); return; }
    let body = '';
    // Streamed accumulation: fine for tens of KB.
    res.setEncoding('utf8');
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => resolve(body));
  });
  req.on('error', reject);
  req.setTimeout(opts.timeout ?? 30000, () => req.destroy(new Error(`Timeout fetching ${url}`)));
  return promise;
}

export function httpsGetBuffer(url: string, opts: HttpOptions = {}): Promise<Buffer> {
  const { promise, resolve, reject } = withResolvers<Buffer>();
  const maxRedirects = opts.maxRedirects ?? 5;
  const req = https.get(url, { headers: { 'User-Agent': 'tersio', Accept: '*/*', ...opts.headers }, signal: opts.signal }, (res) => {
    const next = redirectNext(res, url);
    if (next) {
      if (maxRedirects <= 0) { res.resume(); reject(new Error(`Too many redirects downloading ${url}`)); return; }
      res.resume();
      resolve(httpsGetBuffer(next, { ...opts, maxRedirects: maxRedirects - 1 }));
      return;
    }
    if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode} for ${url}`)); return; }
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => { chunks.push(chunk); });
    res.on('end', () => resolve(Buffer.concat(chunks)));
  });
  req.on('error', reject);
  req.setTimeout(opts.timeout ?? 30000, () => req.destroy(new Error(`Timeout fetching ${url}`)));
  return promise;
}

export function httpsDownload(url: string, dest: string, opts: HttpOptions = {}): Promise<void> {
  const { promise, resolve, reject } = withResolvers<void>();
  const maxRedirects = opts.maxRedirects ?? 5;
  const req = https.get(url, { headers: { 'User-Agent': 'tersio', Accept: '*/*' } }, (res) => {
    const next = redirectNext(res, url);
    if (next) {
      if (maxRedirects <= 0) { res.resume(); reject(new Error(`Too many redirects downloading ${url}`)); return; }
      res.resume();
      resolve(httpsDownload(next, dest, { maxRedirects: maxRedirects - 1 }));
      return;
    }
    if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode} for ${url}`)); return; }
    const file = createWriteStream(dest);
    res.pipe(file);
    file.on('finish', () => file.close(() => resolve()));
    file.on('error', (err) => {
      req.destroy();
      res.resume();
      reject(err);
    });
  });
  req.on('error', reject);
  req.setTimeout(120000, () => req.destroy(new Error(`Timeout downloading ${url}`)));
  return promise;
}

export async function fetchJson<T>(url: string, opts: HttpOptions = {}): Promise<T> {
  const body = await httpsGet(url, opts);
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(`${url} did not return JSON`);
  }
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export async function sha256File(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  return createHash('sha256').update(buf).digest('hex');
}

export function parseChecksum(checksumsText: string, assetName: string): string | null {
  const target = path.basename(assetName);
  for (const line of checksumsText.split(/\r?\n/)) {
    const m = line.match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (m && path.basename(m[2]) === target) return m[1].toLowerCase();
  }
  return null;
}

export async function findFile(dir: string, name: string): Promise<string | null> {
  try {
    const ents = await fs.readdir(dir, { withFileTypes: true });
    for (const e of ents) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        const found = await findFile(full, name);
        if (found) return found;
      } else if (e.isFile()) {
        if (e.name === name) return full;
        // Match rtk-* asset names (e.g. rtk-x86_64-unknown-linux-musl).
        if (name === 'rtk' || name === 'rtk.exe') {
          const base = e.name.toLowerCase();
          if (!/\.(txt|md|json|sha256|sig|asc|pem|crt|license)$/i.test(base)) {
            if (base === 'rtk' || base === 'rtk.exe' || /^rtk[-_.]/.test(base)) return full;
          }
        }
      }
    }
  } catch { /* ignore */ }
  return null;
}

export async function readTextIfExists(p: string): Promise<string | null> {
  try { return await fs.readFile(p, 'utf8'); } catch { return null; }
}

// Chunked: a 200 MiB binary never fits memory. `tail` keeps needle.length-1 bytes in case a match spans chunks.
export async function fileContains(filePath: string, needleText: string): Promise<boolean> {
  const needle = Buffer.from(needleText, 'utf8');
  if (needle.length === 0) return false;
  const keep = needle.length - 1;
  let handle;
  try {
    handle = await fs.open(filePath, 'r');
    const { size } = await handle.stat();
    const chunk = Buffer.allocUnsafe(1 << 20);
    let tail = Buffer.alloc(0);
    for (let position = 0; position < size;) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
      if (bytesRead === 0) break;
      const window = Buffer.concat([tail, chunk.subarray(0, bytesRead)]);
      if (window.includes(needle)) return true;
      tail = window.subarray(Math.max(0, window.length - keep));
      position += bytesRead;
    }
    return false;
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => { });
  }
}

// Tersio data home: ~/.tersio. First use moves legacy ~/.omp/plugins/tersio-* files over so installs keep history.
const migratedTersioFiles = new Set<string>();

export function tersioHome(): string {
  // Matches the other TERSIO_* overrides so a test never reads the real home.
  const override = process.env.TERSIO_HOME;
  if (override && override.trim() !== '') return override;
  return path.join(homeDir(), '.tersio');
}


export function tersioDataPath(name: string, legacy: string): string {
  const dest = path.join(tersioHome(), name);
  if (!migratedTersioFiles.has(name)) {
    migratedTersioFiles.add(name);
    try {
      if (!existsSync(dest)) {
        const src = path.join(homeDir(), '.omp', 'plugins', legacy);
        if (existsSync(src)) {
          mkdirSync(tersioHome(), { recursive: true });
          renameSync(src, dest);
        }
      }
    } catch { /* best-effort; callers tolerate a missing file */ }
  }
  return dest;
}

export function normalizeRtkVersion(value: string | undefined): string {
  return String(value || '').replace(/^rtk\s+/i, '').replace(/^v/i, '').trim();
}
