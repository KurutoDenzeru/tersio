import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { handleCodeGraphRoutes } from '../../cli/dashboard-codegraph.ts';
import { shutdownCodeGraphWorker, stopWatching } from '../../extensions/codegraph/client.ts';
import { type CodeGraphTestFixture, createCodeGraphTestFixture } from '../helpers/codegraph.ts';

describe('dashboard CodeGraph routes', () => {
  let fixture: CodeGraphTestFixture;
  let tmpDir: string;
  beforeAll(() => {
    fixture = createCodeGraphTestFixture();
    tmpDir = fixture.projectRoot;
    fs.mkdirSync(path.join(tmpDir, '.git'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'sample.ts'), 'export const hello = "world";');
  });
  afterAll(async () => {
    await stopWatching(tmpDir);
    await shutdownCodeGraphWorker();
    fixture.cleanup();
  });

  test('returns false for unrelated route', async () => {
    const req = { url: '/api/unknown', method: 'GET' } as http.IncomingMessage;
    const res = {} as http.ServerResponse;
    const ctx = {
      json: () => {},
      bodyOf: async () => ({}),
    };
    const handled = await handleCodeGraphRoutes(req, res, ctx);
    expect(handled).toBe(false);
  });

  test('GET /api/codegraph/status returns index status for a directory', async () => {
    const req = {
      url: `/api/codegraph/status?root=${encodeURIComponent(tmpDir)}`,
      method: 'GET',
    } as http.IncomingMessage;
    const res = {} as http.ServerResponse;
    let statusCode = 0;
    let payload: Record<string, unknown> = {};

    const ctx = {
      projectRoot: tmpDir,
      json: (_res: unknown, code: number, body: unknown) => {
        statusCode = code;
        payload = body as Record<string, unknown>;
      },
      bodyOf: async () => ({}),
    };

    const handled = await handleCodeGraphRoutes(req, res, ctx);
    expect(handled).toBe(true);
    expect(statusCode).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.status).toBeDefined();
    const status = payload.status as Record<string, unknown>;
    expect(status).toHaveProperty('initialized');
    expect(status).toHaveProperty('nodeCount');
    expect(status).toHaveProperty('edgeCount');
    expect(status).toHaveProperty('isWatching');
    expect(typeof payload.syncMode).toBe('string');
  });

  test('POST /api/codegraph/init and /sync triggers indexing on tmpDir', async () => {
    const reqInit = { url: '/api/codegraph/init', method: 'POST' } as http.IncomingMessage;
    const res = {} as http.ServerResponse;
    let statusCode = 0;
    let payload: Record<string, unknown> = {};

    const ctx = {
      projectRoot: tmpDir,
      json: (_res: unknown, code: number, body: unknown) => {
        statusCode = code;
        payload = body as Record<string, unknown>;
      },
      bodyOf: async () => ({ root: tmpDir }),
    };

    const handledInit = await handleCodeGraphRoutes(reqInit, res, ctx);
    expect(handledInit).toBe(true);
    expect(statusCode).toBe(200);
    expect(payload.ok).toBe(true);

    const reqSync = { url: '/api/codegraph/sync', method: 'POST' } as http.IncomingMessage;
    const handledSync = await handleCodeGraphRoutes(reqSync, res, ctx);
    expect(handledSync).toBe(true);
    expect(statusCode).toBe(200);
    expect(payload.ok).toBe(true);
  });

  test('refuses a root that is not a git checkout or CodeGraph index', async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'test-cg-plain-'));
    const req = {
      url: `/api/codegraph/status?root=${encodeURIComponent(plain)}`,
      method: 'GET',
    } as http.IncomingMessage;
    let statusCode = 0;
    const ctx = {
      projectRoot: tmpDir,
      json: (_res: unknown, code: number) => {
        statusCode = code;
      },
      bodyOf: async () => ({}),
    };
    expect(await handleCodeGraphRoutes(req, {} as http.ServerResponse, ctx)).toBe(true);
    expect(statusCode).toBe(400);
    fs.rmSync(plain, { recursive: true, force: true });
  });

  test('rejects another repository and remote or cross-origin indexing requests', async () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'test-cg-other-'));
    fs.mkdirSync(path.join(other, '.git'));
    let code = 0;
    const ctx = {
      projectRoot: tmpDir,
      json: (_res: unknown, status: number) => {
        code = status;
      },
      bodyOf: async () => ({ root: other }),
    };
    try {
      const another = {
        url: `/api/codegraph/status?root=${encodeURIComponent(other)}`,
        method: 'GET',
      } as http.IncomingMessage;
      await handleCodeGraphRoutes(another, {} as http.ServerResponse, ctx);
      expect(code).toBe(400);
      const remote = {
        url: '/api/codegraph/init',
        method: 'POST',
        socket: { remoteAddress: '192.0.2.10' },
      } as http.IncomingMessage;
      await handleCodeGraphRoutes(remote, {} as http.ServerResponse, ctx);
      expect(code).toBe(403);
      const crossOrigin = {
        url: '/api/codegraph/sync',
        method: 'POST',
        socket: { remoteAddress: '127.0.0.1' },
        headers: { origin: 'https://untrusted.example', host: '127.0.0.1:3000' },
      } as http.IncomingMessage;
      await handleCodeGraphRoutes(crossOrigin, {} as http.ServerResponse, ctx);
      expect(code).toBe(403);
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });
});
