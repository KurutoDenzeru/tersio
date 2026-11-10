import { afterEach, describe, expect, test } from 'vitest';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { applyTarget, emptyConfig, publicFields, testTarget } from '../../cli/dashboard-sync.ts';

describe('sync configuration', () => {
  test('a blank secret keeps the saved one, so the panel can save without echoing it', () => {
    const base = { ...emptyConfig(), webdav: { address: 'https://dav.example.com', user: 'me', password: 'saved' } };
    const next = applyTarget('webdav', { address: 'https://dav.example.com', user: 'me', password: '' }, base);
    expect(next.webdav.password).toBe('saved');
    const replaced = applyTarget('webdav', { address: 'https://dav.example.com', user: 'me', password: 'new' }, base);
    expect(replaced.webdav.password).toBe('new');
  });

  test('only the fields a protocol owns are copied, and they are trimmed', () => {
    const next = applyTarget(
      's3',
      {
        endpoint: ' https://r2.example.com ',
        bucket: ' backups ',
        secret: 's',
        accessKey: 'k',
        pathStyle: true,
        repository: 'smuggled/repo',
      },
      emptyConfig(),
    );
    expect(next.mode).toBe('s3');
    expect(next.s3.endpoint).toBe('https://r2.example.com');
    expect(next.s3.bucket).toBe('backups');
    expect(next.s3.region).toBe('us-east-1');
    expect(next.s3.pathStyle).toBe(true);
    // A GitHub field in an S3 request must not overwrite the stored GitHub configuration.
    expect(next.github.repository).toBe('');
  });

  test('the panel never receives a password or a token', () => {
    const config = applyTarget(
      'github',
      { repository: 'me/backups', branch: 'main', folder: '', token: 'ghp_secret' },
      emptyConfig(),
    );
    const fields = publicFields(config);
    expect(JSON.stringify(fields)).not.toContain('ghp_secret');
    expect(fields.github).toMatchObject({ repository: 'me/backups', branch: 'main' });
    const webdav = applyTarget('webdav', { address: 'https://x', user: 'u', password: 'pw' }, config);
    expect(JSON.stringify(publicFields(webdav))).not.toContain('pw');
  });
});

const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

describe('connection test', () => {
  test('a usable WebDAV folder reports its backup count', async () => {
    const writes: string[] = [];
    const server = createServer((req, res) => {
      // The probe proves write and delete, so the fake must accept PUT and DELETE as well as listing.
      if (req.method === 'PUT' || req.method === 'DELETE') {
        writes.push(`${req.method} ${req.url}`);
        res.writeHead(200);
        res.end();
        return;
      }
      if (req.method !== 'PROPFIND') {
        res.writeHead(405);
        res.end();
        return;
      }
      res.writeHead(207, { 'content-type': 'application/xml' });
      res.end(
        `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/tersio/data-1.tsb</d:href><d:prop><d:getcontentlength>10</d:getcontentlength><d:getlastmodified>Wed, 04 Nov 2026 14:00:00 GMT</d:getlastmodified></d:prop></d:response></d:multistatus>`,
      );
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    const config = applyTarget(
      'webdav',
      { address: `http://127.0.0.1:${address.port}`, user: 'u', password: 'p' },
      emptyConfig(),
    );
    await expect(testTarget(config)).resolves.toEqual({ ok: true, count: 1 });
    expect(writes).toContain('PUT /tersio/tersio-write-probe.tmp');
    expect(writes).toContain('DELETE /tersio/tersio-write-probe.tmp');
  });

  test('an unusable target returns the reason instead of throwing at the caller', async () => {
    const config = applyTarget('webdav', { address: 'nas.local/dav', user: '', password: '' }, emptyConfig());
    const answer = await testTarget(config);
    expect(answer.ok).toBe(false);
    if (!answer.ok) expect(answer.error).toMatch(/http/i);
  });

  test('a missing GitHub token is refused before any request', async () => {
    const config = applyTarget('github', { repository: 'me/backups', token: '' }, emptyConfig());
    const answer = await testTarget(config);
    expect(answer.ok).toBe(false);
    if (!answer.ok) expect(answer.error).toMatch(/token/);
  });
});
