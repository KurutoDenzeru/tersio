// Host routes: what the guide draws as installed, and the install/uninstall/update actions.

import type http from 'node:http';
import type { HostEntry } from './hosts.ts';

interface HostJob {
  action: string;
  startedAt: number;
  code: number | null;
}

export interface HostRouteCtx {
  json: (res: Pick<http.ServerResponse, 'writeHead' | 'end'>, code: number, body: unknown) => void;
  bodyOf: (req: http.IncomingMessage) => Promise<Record<string, unknown>>;
  detectHosts: () => HostEntry[];
  hostJobs: Map<string, HostJob>;
  spawnCli: (command: 'install' | 'uninstall' | 'update', host: string) => boolean;
}

export async function handleHostRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: HostRouteCtx,
): Promise<boolean> {
  if (req.url === '/api/hosts' && req.method === 'GET') {
    ctx.json(res, 200, ctx.detectHosts().map((host) => ({
      id: host.id,
      label: host.label,
      installed: host.installed,
      version: host.version,
    })));
    return true;
  }
  if (req.url === '/api/hosts/action' && req.method === 'GET') {
    ctx.json(res, 200, [...ctx.hostJobs].map(([host, job]) => ({ host, ...job })));
    return true;
  }
  if (req.url === '/api/hosts/action' && req.method === 'POST') {
    const body = await ctx.bodyOf(req);
    const host = String(body.host ?? '');
    const action = String(body.action ?? '');
    const known = ctx.detectHosts().some((entry) => entry.id === host);
    if (!known || (action !== 'install' && action !== 'uninstall' && action !== 'update')) {
      ctx.json(res, 400, { ok: false, error: 'unknown host or action' });
      return true;
    }
    if (!ctx.spawnCli(action, host)) {
      ctx.json(res, 500, { ok: false, error: 'cannot find the tersio entry point' });
      return true;
    }
    ctx.json(res, 202, { ok: true, pending: true, host, action });
    return true;
  }
  return false;
}
