// CodeGraph Dashboard routes: provides live index status and sync triggers for the dashboard.

import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';
import { URL } from 'node:url';
import { getCodeGraphStatus, indexCodeGraph, syncCodeGraph } from '../extensions/codegraph/client.ts';
import { findRepoRoot } from '../extensions/codegraph/shared.ts';
import { readCodegraphDefault, readCodegraphSync } from '../extensions/shared/plugin-settings.ts';

export interface CodeGraphRouteCtx {
  json: (res: Pick<http.ServerResponse, 'writeHead' | 'end'>, code: number, body: unknown) => void;
  bodyOf: (req: http.IncomingMessage) => Promise<Record<string, unknown>>;
  projectRoot?: string;
}

/** A directory the routes may read or index: it exists and is a git checkout or already holds a CodeGraph index. */
function isRepoRoot(dir: string): boolean {
  try {
    if (!fs.statSync(dir).isDirectory()) return false;
  } catch {
    return false;
  }
  return fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, '.codegraph'));
}

/** The nearest repository at or above the dashboard's working directory. */
function cwdRepoRoot(start: string): string | null {
  return findRepoRoot(start);
}

/**
 * The root a request names, checked before anything reads or indexes under it. The dashboard binds every
 * interface with `--lan`, so an arbitrary path must never be indexed. Throws with the reason when refused.
 */
export function resolveRepoRoot(requested: string | null | undefined, start = process.cwd()): string {
  const found = cwdRepoRoot(start);
  if (!found) throw new Error('No git repository above the dashboard working directory.');
  const root = fs.realpathSync(found);
  const raw = requested?.trim();
  if (raw) {
    const dir = path.resolve(raw);
    if (!isRepoRoot(dir) || fs.realpathSync(dir) !== root)
      throw new Error('Requested repository is not the dashboard project.');
  }
  return root;
}

function localMutation(req: http.IncomingMessage): boolean {
  const address = req.socket?.remoteAddress;
  if (address && address !== '::1' && !address.startsWith('127.') && !address.startsWith('::ffff:127.')) return false;
  const origin = req.headers?.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

async function bodyOrEmpty(req: http.IncomingMessage, ctx: CodeGraphRouteCtx): Promise<Record<string, unknown>> {
  try {
    return await ctx.bodyOf(req);
  } catch {
    return {};
  }
}

/** The validated root, or null after a 400 has been written. */
function rootOr400(
  res: http.ServerResponse,
  ctx: CodeGraphRouteCtx,
  requested: string | null | undefined,
): string | null {
  try {
    return resolveRepoRoot(requested, ctx.projectRoot);
  } catch (err) {
    ctx.json(res, 400, { ok: false, error: (err as Error).message });
    return null;
  }
}

/**
 * Handle CodeGraph API endpoints for the dashboard.
 * Returns true when the route matches and was handled.
 */
export async function handleCodeGraphRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: CodeGraphRouteCtx,
): Promise<boolean> {
  const reqUrl = req.url ?? '';
  const parsed = new URL(reqUrl, 'http://127.0.0.1');

  if (parsed.pathname === '/api/codegraph/status' && req.method === 'GET') {
    const root = rootOr400(res, ctx, parsed.searchParams.get('root'));
    if (root === null) return true;
    try {
      const status = await getCodeGraphStatus(root);
      ctx.json(res, 200, {
        ok: true,
        root,
        status,
        syncMode: readCodegraphSync(),
        enabled: readCodegraphDefault() === 'on',
      });
    } catch (err) {
      ctx.json(res, 500, { ok: false, error: (err as Error).message });
    }
    return true;
  }

  if (parsed.pathname === '/api/codegraph/sync' && req.method === 'POST') {
    if (!localMutation(req)) {
      ctx.json(res, 403, { ok: false, error: 'CodeGraph sync is available only to the local dashboard.' });
      return true;
    }
    const body = await bodyOrEmpty(req, ctx);
    const root = rootOr400(res, ctx, typeof body.root === 'string' ? body.root : null);
    if (root === null) return true;
    try {
      const stats = await syncCodeGraph(root);
      ctx.json(res, 200, { ok: true, stats });
    } catch (err) {
      ctx.json(res, 500, { ok: false, error: (err as Error).message });
    }
    return true;
  }

  if (parsed.pathname === '/api/codegraph/init' && req.method === 'POST') {
    if (!localMutation(req)) {
      ctx.json(res, 403, { ok: false, error: 'CodeGraph indexing is available only to the local dashboard.' });
      return true;
    }
    const body = await bodyOrEmpty(req, ctx);
    const root = rootOr400(res, ctx, typeof body.root === 'string' ? body.root : null);
    if (root === null) return true;
    try {
      const stats = await indexCodeGraph(root);
      ctx.json(res, 200, { ok: true, stats });
    } catch (err) {
      ctx.json(res, 500, { ok: false, error: (err as Error).message });
    }
    return true;
  }

  return false;
}
