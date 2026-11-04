// The three remote homes a sealed backup can live in: one interface, three wire formats.
import { createHash, createHmac } from 'node:crypto';

export type SyncMode = 'webdav' | 's3' | 'github';

export interface WebDavConfig { address: string; user: string; password: string }
export interface S3Config { endpoint: string; bucket: string; prefix: string; region: string; accessKey: string; secret: string; sessionToken: string; pathStyle: boolean }
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
  /** Delete one file; used by the write probe and by pruning. A missing file is not an error. */
  remove(name: string): Promise<void>;
}

/** Transient answers worth one more try; a 403 or a 404 is not. */
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** fetch with two retries on a transient status or a network error, honouring Retry-After when sent. */
async function request(url: URL | string, init: RequestInit, timeoutMs = 30_000): Promise<Response> {
  let last: unknown;
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    try {
      const answer = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (!RETRY_STATUS.has(answer.status) || attempt === ATTEMPTS - 1) return answer;
      const after = Number(answer.headers.get('retry-after'));
      await sleep(Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 5000) : 300 * 2 ** attempt);
    } catch (error) {
      last = error;
      if (attempt === ATTEMPTS - 1) throw error;
      await sleep(300 * 2 ** attempt);
    }
  }
  throw last instanceof Error ? last : new Error('the request failed');
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
  const call = (method: string, url: string, body?: BodyInit, headers: Record<string, string> = {}, timeoutMs = 30_000) => request(url, {
    method,
    body,
    headers: { authorization: auth, ...headers },
  }, timeoutMs);

  /** Some boxes accept a PUT into an existing folder but not the folder itself, so every parent is tried. */
  const ensureParents = async (): Promise<void> => {
    const parsed = new URL(base);
    const origin = `${parsed.protocol}//${parsed.host}`;
    let walked = '';
    for (const segment of parsed.pathname.split('/').filter(Boolean)) {
      walked += `/${encodeURIComponent(segment)}`;
      await call('MKCOL', `${origin}${walked}`).catch(() => undefined);
    }
    await call('MKCOL', dir).catch(() => undefined);
  };

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
      return entries.toSorted(newestFirst);
    },
    async put(name, body) {
      // A folder that already exists answers 405; anything else is reported by the PUT below.
      await ensureParents();
      const answer = await call('PUT', `${dir}${name}`, body as unknown as BodyInit, { 'content-type': 'application/octet-stream' }, 120_000);
      if (!answer.ok) throw fail('WebDAV upload', answer.status, await answer.text());
    },
    async get(name) {
      const answer = await call('GET', `${dir}${name}`, undefined, {}, 120_000);
      if (!answer.ok) throw fail('WebDAV download', answer.status, await answer.text());
      return Buffer.from(await answer.arrayBuffer());
    },
    async remove(name) {
      const answer = await call('DELETE', `${dir}${name}`);
      if (!answer.ok && answer.status !== 404) throw fail('WebDAV delete', answer.status, await answer.text());
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
export function sigV4(method: string, url: URL, body: Buffer, config: Pick<S3Config, 'region' | 'accessKey' | 'secret'> & { sessionToken?: string }, extraHeaders: Record<string, string> = {}, at: Date = new Date()): Record<string, string> {
  const now = at;
  const amzDate = `${now.toISOString().replace(/[:-]|\.\d{3}/g, '')}`;
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const headers: Record<string, string> = { ...extraHeaders, host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  if (config.sessionToken) headers['x-amz-security-token'] = config.sessionToken;
  const signed = Object.keys(headers).toSorted();
  const canonicalHeaders = signed.map((name) => `${name}:${headers[name]}\n`).join('');
  const canonicalQuery = [...url.searchParams.entries()].toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
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
  // An endpoint may carry its own base path (a gateway, MinIO behind a proxy); keep it instead of replacing the path.
  const basePath = endpoint.pathname.replace(/\/+$/, '');
  const target = (key: string, query = ''): URL => {
    const url = new URL(endpoint.href);
    url.host = config.pathStyle ? endpoint.host : `${config.bucket}.${endpoint.host}`;
    url.pathname = `${basePath}${config.pathStyle ? `/${config.bucket}` : ''}/${prefix}${key}`.replace(/\/{2,}/g, '/');
    url.search = query;
    return url;
  };

  return {
    async list() {
      const entries: RemoteEntry[] = [];
      let token: string | undefined;
      // ListObjectsV2 answers one page of 1000 keys; a long-lived bucket needs the continuation loop.
      for (let page = 0; page < 10; page += 1) {
        const query = `list-type=2&prefix=${encodeURIComponent(prefix)}${token ? `&continuation-token=${encodeURIComponent(token)}` : ''}`;
        const url = target('', query);
        const answer = await request(url, { headers: authorize('GET', url, Buffer.alloc(0), config, {}) });
        if (!answer.ok) throw fail('S3 listing', answer.status, await answer.text());
        const xml = await answer.text();
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
        token = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1];
        if (!token) break;
      }
      return entries.toSorted(newestFirst);
    },
    async put(name, body) {
      const url = target(name);
      const answer = await request(url, {
        method: 'PUT',
        body: body as unknown as BodyInit,
        headers: authorize('PUT', url, body, config, { 'content-type': 'application/octet-stream' }),
      }, 120_000);
      if (!answer.ok) throw fail('S3 upload', answer.status, await answer.text());
    },
    async get(name) {
      const url = target(name);
      const answer = await request(url, { headers: authorize('GET', url, Buffer.alloc(0), config, {}) }, 120_000);
      if (!answer.ok) throw fail('S3 download', answer.status, await answer.text());
      return Buffer.from(await answer.arrayBuffer());
    },
    async remove(name) {
      const url = target(name);
      const answer = await request(url, { method: 'DELETE', headers: authorize('DELETE', url, Buffer.alloc(0), config, {}) });
      if (!answer.ok && answer.status !== 404) throw fail('S3 delete', answer.status, await answer.text());
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
      // The contents API carries no per-file date; the timestamped name is the only order there is.
      return rows
        .filter((row) => row.type === 'file' && (row.name ?? '').endsWith(REMOTE_EXT))
        .map((row) => ({ name: row.name ?? '', bytes: row.size ?? 0, mtime: 0 }))
        .toSorted((a, b) => b.name.localeCompare(a.name));
    },
    async put(name, body) {
      // The contents API refuses a file above ~100 MB; say so instead of failing at the request.
      if (body.length > 90 * 1024 * 1024) throw new Error('this backup is larger than GitHub accepts in one file');
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
    async remove(name) {
      const url = `${api}/${folder}/${encodeURIComponent(name)}`;
      const existing = await request(`${url}${ref}`, { headers });
      if (existing.status === 404) return;
      if (!existing.ok) throw fail('GitHub lookup', existing.status, await existing.text());
      const sha = ((await existing.json()) as { sha?: string }).sha;
      if (!sha) throw new Error(`GitHub did not return a sha for ${name}`);
      const answer = await request(url, {
        method: 'DELETE',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ message: `tersio: remove ${name}`, sha, ...(config.branch.trim() ? { branch: config.branch.trim() } : {}) }),
      });
      if (!answer.ok && answer.status !== 404) throw fail('GitHub delete', answer.status, await answer.text());
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
