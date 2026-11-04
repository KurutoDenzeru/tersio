// The three remote homes a sealed backup can live in: one interface, three wire formats.
import { createHash, createHmac } from 'node:crypto';

export type SyncMode = 'webdav' | 's3' | 'github';

export interface WebDavConfig { address: string; user: string; password: string }
export interface S3Config { endpoint: string; bucket: string; prefix: string; region: string; accessKey: string; secret: string; pathStyle: boolean }
export interface GithubConfig { repository: string; branch: string; folder: string; token: string }

export interface SyncConfig {
  mode: SyncMode;
  webdav: WebDavConfig;
  s3: S3Config;
  github: GithubConfig;
}

export interface RemoteEntry { name: string; bytes: number; mtime: number }

export interface Remote {
  /** Sealed files this account already holds, newest first. */
  list(): Promise<RemoteEntry[]>;
  put(name: string, body: Buffer): Promise<void>;
  get(name: string): Promise<Buffer>;
}

/** Every remote keeps Tersio's own folder, so a shared bucket or repository is never touched outside it. */
const FOLDER = 'tersio';
export const REMOTE_EXT = '.tsb';

function fail(what: string, status: number, body: string): Error {
  const detail = body.replace(/\s+/g, ' ').slice(0, 200).trim();
  return new Error(`${what} failed: HTTP ${status}${detail ? ` — ${detail}` : ''}`);
}

function newestFirst(a: RemoteEntry, b: RemoteEntry): number {
  return b.mtime - a.mtime;
}

function webdav(config: WebDavConfig): Remote {
  const base = config.address.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) throw new Error('WebDAV needs an http(s) address');
  const dir = `${base}/${FOLDER}/`;
  const auth = `Basic ${Buffer.from(`${config.user}:${config.password}`).toString('base64')}`;
  const call = (method: string, url: string, body?: BodyInit, headers: Record<string, string> = {}) => fetch(url, {
    method,
    body,
    headers: { authorization: auth, ...headers },
    signal: AbortSignal.timeout(30_000),
  });

  return {
    async list() {
      const answer = await call('PROPFIND', dir, '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>', {
        depth: '1',
        'content-type': 'application/xml',
      });
      if (answer.status === 404) return [];
      if (!answer.ok) throw fail('WebDAV listing', answer.status, await answer.text());
      const xml = await answer.text();
      const entries: RemoteEntry[] = [];
      // One <d:response> per child; href carries the name, the other two props its facts.
      for (const block of xml.split(/<\/[^>]*response>/)) {
        const href = block.match(/<[^>]*href>([^<]+)</)?.[1];
        if (!href) continue;
        const name = decodeURIComponent(href.split('/').filter(Boolean).at(-1) ?? '');
        if (!name.endsWith(REMOTE_EXT)) continue;
        const bytes = Number(block.match(/<[^>]*getcontentlength>(\d+)</)?.[1] ?? 0);
        const when = block.match(/<[^>]*getlastmodified>([^<]+)</)?.[1];
        entries.push({ name, bytes, mtime: when ? Date.parse(when) : 0 });
      }
      return entries.sort(newestFirst);
    },
    async put(name, body) {
      // A folder that already exists answers 405; anything else is reported by the PUT below.
      await call('MKCOL', dir).catch(() => undefined);
      const answer = await call('PUT', `${dir}${name}`, body as unknown as BodyInit, { 'content-type': 'application/octet-stream' });
      if (!answer.ok) throw fail('WebDAV upload', answer.status, await answer.text());
    },
    async get(name) {
      const answer = await call('GET', `${dir}${name}`);
      if (!answer.ok) throw fail('WebDAV download', answer.status, await answer.text());
      return Buffer.from(await answer.arrayBuffer());
    },
  };
}

function sha256Hex(body: Buffer | string): string {
  return createHash('sha256').update(body).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

/** Each path segment is encoded on its own, so the slashes stay and spaces become %20. */
function canonicalPath(pathname: string): string {
  return pathname.split('/').map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');
}

/**
 * SigV4 for one S3 request: the same algorithm every S3-compatible host accepts.
 * Exported so the AWS documentation example can pin it.
 */
export function sigV4(method: string, url: URL, body: Buffer, config: Pick<S3Config, 'region' | 'accessKey' | 'secret'>, extraHeaders: Record<string, string> = {}, at: Date = new Date()): Record<string, string> {
  const now = at;
  const amzDate = `${now.toISOString().replace(/[:-]|\.\d{3}/g, '')}`;
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const headers: Record<string, string> = { ...extraHeaders, host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const signed = Object.keys(headers).sort();
  const canonicalHeaders = signed.map((name) => `${name}:${headers[name]}\n`).join('');
  const canonicalQuery = [...url.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`).join('&');
  const canonicalRequest = [method, canonicalPath(url.pathname), canonicalQuery, canonicalHeaders, signed.join(';'), payloadHash].join('\n');
  const scope = `${day}/${config.region || 'us-east-1'}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.secret}`, day), config.region || 'us-east-1'), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKey}/${scope}, SignedHeaders=${signed.join(';')}, Signature=${signature}`,
  };
}

const authorize = (method: string, url: URL, body: Buffer, config: S3Config, extraHeaders: Record<string, string>): Record<string, string> =>
  sigV4(method, url, body, config, extraHeaders);

function s3(config: S3Config): Remote {
  if (!config.bucket.trim()) throw new Error('S3 needs a bucket');
  if (!config.accessKey.trim() || !config.secret.trim()) throw new Error('S3 needs an access key and a secret');
  const endpoint = new URL(config.endpoint.trim() || 'https://s3.amazonaws.com');
  const prefix = `${config.prefix.trim().replace(/^\/+|\/+$/g, '') ? `${config.prefix.trim().replace(/^\/+|\/+$/g, '')}/` : ''}${FOLDER}/`;
  const target = (key: string, query = ''): URL => {
    const url = new URL(endpoint.href);
    const path = `${config.pathStyle ? `/${config.bucket}` : ''}/${prefix}${key}`;
    url.pathname = path.replace(/\/{2,}/g, '/');
    url.search = query;
    if (!config.pathStyle) url.host = `${config.bucket}.${endpoint.host}`;
    return url;
  };

  return {
    async list() {
      const url = target('', `list-type=2&prefix=${encodeURIComponent(prefix)}`);
      const answer = await fetch(url, { headers: authorize('GET', url, Buffer.alloc(0), config, {}) , signal: AbortSignal.timeout(30_000) });
      if (!answer.ok) throw fail('S3 listing', answer.status, await answer.text());
      const xml = await answer.text();
      const entries: RemoteEntry[] = [];
      for (const block of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const key = block[1].match(/<Key>([^<]+)<\/Key>/)?.[1] ?? '';
        const name = key.split('/').filter(Boolean).at(-1) ?? '';
        if (!name.endsWith(REMOTE_EXT)) continue;
        entries.push({
          name,
          bytes: Number(block[1].match(/<Size>(\d+)<\/Size>/)?.[1] ?? 0),
          mtime: Date.parse(block[1].match(/<LastModified>([^<]+)<\/LastModified>/)?.[1] ?? '') || 0,
        });
      }
      return entries.sort(newestFirst);
    },
    async put(name, body) {
      const url = target(name);
      const answer = await fetch(url, {
        method: 'PUT',
        body: body as unknown as BodyInit,
        headers: authorize('PUT', url, body, config, { 'content-type': 'application/octet-stream' }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!answer.ok) throw fail('S3 upload', answer.status, await answer.text());
    },
    async get(name) {
      const url = target(name);
      const answer = await fetch(url, { headers: authorize('GET', url, Buffer.alloc(0), config, {}), signal: AbortSignal.timeout(120_000) });
      if (!answer.ok) throw fail('S3 download', answer.status, await answer.text());
      return Buffer.from(await answer.arrayBuffer());
    },
  };
}

function github(config: GithubConfig): Remote {
  const repository = config.repository.trim();
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) throw new Error('GitHub needs a repository in owner/repo form');
  if (!config.token.trim()) throw new Error('GitHub needs a token with contents write access');
  const folder = config.folder.trim().replace(/^\/+|\/+$/g, '') || FOLDER;
  // TERSIO_GITHUB_API is a test seam: the shipped value is the real API and the panel never sets it.
  const api = `${(process.env.TERSIO_GITHUB_API ?? 'https://api.github.com').replace(/\/+$/, '')}/repos/${repository}/contents`;
  const headers = {
    authorization: `Bearer ${config.token.trim()}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'tersio',
  };
  const ref = config.branch.trim() ? `?ref=${encodeURIComponent(config.branch.trim())}` : '';

  return {
    async list() {
      const answer = await fetch(`${api}/${folder}${ref}`, { headers, signal: AbortSignal.timeout(30_000) });
      if (answer.status === 404) return [];
      if (!answer.ok) throw fail('GitHub listing', answer.status, await answer.text());
      const rows = (await answer.json()) as Array<{ name?: string; size?: number; type?: string }>;
      return rows
        .filter((row) => row.type === 'file' && (row.name ?? '').endsWith(REMOTE_EXT))
        .map((row) => ({ name: row.name ?? '', bytes: row.size ?? 0, mtime: 0 }));
    },
    async put(name, body) {
      const url = `${api}/${folder}/${encodeURIComponent(name)}`;
      // An existing file needs its blob sha, or GitHub refuses the write.
      const existing = await fetch(`${url}${ref}`, { headers, signal: AbortSignal.timeout(30_000) });
      const sha = existing.ok ? ((await existing.json()) as { sha?: string }).sha : undefined;
      const answer = await fetch(url, {
        method: 'PUT',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: `tersio: backup ${name}`,
          content: body.toString('base64'),
          ...(sha ? { sha } : {}),
          ...(config.branch.trim() ? { branch: config.branch.trim() } : {}),
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!answer.ok) throw fail('GitHub upload', answer.status, await answer.text());
    },
    async get(name) {
      const answer = await fetch(`${api}/${folder}/${encodeURIComponent(name)}${ref}`, {
        headers: { ...headers, accept: 'application/vnd.github.raw' },
        signal: AbortSignal.timeout(120_000),
      });
      if (!answer.ok) throw fail('GitHub download', answer.status, await answer.text());
      return Buffer.from(await answer.arrayBuffer());
    },
  };
}

/** The remote a saved configuration names; a missing field throws before any request is made. */
export function remoteFor(config: SyncConfig): Remote {
  if (config.mode === 'webdav') return webdav(config.webdav);
  if (config.mode === 's3') return s3(config.s3);
  if (config.mode === 'github') return github(config.github);
  throw new Error(`unknown sync target: ${String(config.mode)}`);
}
