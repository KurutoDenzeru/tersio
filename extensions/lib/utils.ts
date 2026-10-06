// Shared helpers for the installer and the AI add-ons updater. Node built-ins only — this module must stay dependency-free.

import { createHash } from 'node:crypto';
import { accessSync, constants, createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import fs from 'node:fs/promises';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';

export interface HttpOptions {
  maxRedirects?: number;
  signal?: AbortSignal;
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

export const RTK_RELEASE_API = 'https://api.github.com/repos/rtk-ai/rtk/releases/latest';
export const CAVEMAN_REMOTE_ULTRA = 'https://raw.githubusercontent.com/JuliusBrussee/caveman/main/skills/ultracave/SKILL.md';
export const CAVEMAN_REMOTE_MEGACAVE = 'https://raw.githubusercontent.com/JuliusBrussee/caveman/main/skills/megacave/SKILL.md';

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

// The 3xx+location redirect rule shared by httpsGet/httpsDownload.
function redirectNext(res: { statusCode?: number; headers: { location?: string } }, url: string): string | null {
  if (res.statusCode !== undefined && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
    return new URL(res.headers.location, url).href;
  }
  return null;
}

// pi sets PI_CODING_AGENT; OMP does not. OMP does read PI_CODING_AGENT_DIR as its own relocation variable, so the override only counts under that marker.
export function isPiProcess(): boolean {
  return process.env.PI_CODING_AGENT === 'true';
}

export function piAgentDir(): string {
  const override = process.env.PI_CODING_AGENT_DIR;
  return isPiProcess() && override ? override : path.join(homeDir(), '.pi', 'agent');
}

// Ponytail is a Tersio dependency that npm hoists, so it can sit in Tersio's node_modules, a host's plugin dir, or beside it. Walking up covers all.
export function findHoistedPackage(pkg: string, fromDir: string, ...relInside: string[]): string | null {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', ...pkg.split('/'), ...relInside);
    if (existsSync(candidate)) return candidate;
    // pi installs npm packages under ~/.pi/agent/npm/node_modules.
    const piCandidate = path.join(dir, 'npm', 'node_modules', ...pkg.split('/'), ...relInside);
    if (existsSync(piCandidate)) return piCandidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function httpsGet(url: string, opts: HttpOptions = {}): Promise<string> {
  const { promise, resolve, reject } = withResolvers<string>();
  const maxRedirects = opts.maxRedirects ?? 5;
  const req = https.get(url, { headers: { 'User-Agent': 'tersio', Accept: 'application/json,*/*' }, signal: opts.signal }, (res) => {
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
  req.setTimeout(30000, () => req.destroy(new Error(`Timeout fetching ${url}`)));
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

export async function fetchJson<T>(url: string): Promise<T> {
  const body = await httpsGet(url);
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

// Chunked so a 200 MiB host binary is never held in memory. `tail` keeps the last needle.length-1 bytes of the previous chunk, because a match can begin near the end of one chunk and finish inside the next.
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

// Tersio-owned data home: ~/.tersio. First use moves legacy ~/.omp/plugins/tersio-* files over so existing installs keep their history.
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
