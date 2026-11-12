// Headroom routes: install the binary, start its proxy, and point an agent at it for good. One
// action per agent — no per-session wrap, no ledger of which tool was wrapped when.

import type http from 'node:http';
import { hostCap } from '../extensions/shared/host-caps.ts';
import { headroomHostDurable, headroomProxyUrl } from '../extensions/shared/headroom-proxy.ts';
import { describeHeadroomRoute, readHeadroomRoute } from '../extensions/shared/headroom-routing.ts';
import { headroomRoutedHosts, routeHostOff, routeHostOn } from '../extensions/shared/headroom-routes.ts';
import { stopHeadroomRuntime } from '../extensions/shared/headroom-runtime.ts';
import { readHeadroomReport } from '../extensions/shared/agent-stats.ts';
import { detectHosts } from './hosts.ts';
import { codexPresent, resolveHeadroomBinary, resolveHostBinary } from '../extensions/shared/utils.ts';

export interface HeadroomRouteCtx {
  json: (res: Pick<http.ServerResponse, 'writeHead' | 'end'>, code: number, body: unknown) => void;
  bodyOf: (req: http.IncomingMessage) => Promise<Record<string, unknown>>;
  spawnHeadroomInstall: () => boolean;
  headroomInstallState: () => { startedAt: number; code: number | null; error: string | null };
  ensureRuntime: (bin: string, openAiTarget?: string | null) => Promise<{ ok: boolean; detail: string }>;
}

/** True when the route was answered. */
export async function handleHeadroomRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: HeadroomRouteCtx,
): Promise<boolean> {
  if (req.url === '/api/headroom/install' && req.method === 'GET') {
    ctx.json(res, 200, { ok: true, present: resolveHeadroomBinary() !== null, ...ctx.headroomInstallState() });
    return true;
  }
  // The Tools page reads this after its ledger rows, so a slow savings CLI never holds the table.
  if (req.url === '/api/headroom/gain' && req.method === 'GET') {
    ctx.json(res, 200, { ok: true, headroom: await readHeadroomReport() });
    return true;
  }
  if (req.url === '/api/headroom/install' && req.method === 'POST') {
    if (resolveHeadroomBinary()) {
      ctx.json(res, 200, { ok: true, present: true });
      return true;
    }
    if (!ctx.spawnHeadroomInstall()) {
      ctx.json(res, 500, { ok: false, error: 'cannot start the install here — run: pip install "headroom-ai[all]"' });
      return true;
    }
    ctx.json(res, 202, { ok: true, pending: true });
    return true;
  }
  // The Tools page and the drawer can start headroom's own runtime; a switch alone cannot.
  if (req.url === '/api/headroom/runtime' && req.method === 'POST') {
    const bin = resolveHeadroomBinary();
    if (!bin) {
      ctx.json(res, 400, { ok: false, error: 'headroom is not installed' });
      return true;
    }
    ctx.json(res, 200, await ctx.ensureRuntime(bin));
    return true;
  }
  // Every Tersio agent, with the one fact a reader needs: does its traffic reach the proxy.
  if (req.url === '/api/headroom/route' && req.method === 'GET') {
    const bin = resolveHeadroomBinary();
    const targets = detectHosts()
      .filter((host) => hostCap(host.id)?.headroom === true)
      .map((host) => {
        const route = readHeadroomRoute(host.id);
        return {
          name: host.id,
          label: host.label,
          agentInstalled: host.installed,
          agentPresent: host.id === 'codex' ? codexPresent() : resolveHostBinary(host.bin) !== null,
          routed: route.routed,
          durable: headroomHostDurable(host.id),
          detail: describeHeadroomRoute(route),
        };
      });
    ctx.json(res, 200, { ok: bin !== null, endpoint: headroomProxyUrl(), targets });
    return true;
  }
  if (req.url === '/api/headroom/route' && req.method === 'POST') {
    const body = await ctx.bodyOf(req);
    const name = String(body.name ?? '');
    const cap = hostCap(name);
    if (!cap?.headroom) {
      ctx.json(res, 400, { ok: false, error: 'unknown agent' });
      return true;
    }
    const bin = resolveHeadroomBinary();
    if (!bin) {
      ctx.json(res, 400, { ok: false, error: 'headroom is not installed' });
      return true;
    }
    // A route points the agent at the proxy, so the proxy answers before the config is written.
    if (body.on !== false) {
      // headroom forwards to one upstream, and the agent's own endpoint is the only one it can be.
      const upstream = readHeadroomRoute(name).baseUrl;
      const runtime = await ctx.ensureRuntime(bin, upstream);
      if (!runtime.ok) {
        ctx.json(res, 200, { ok: false, error: `headroom runtime did not start: ${runtime.detail}` });
        return true;
      }
    }
    if (body.on === false) {
      const removed = await routeHostOff(name);
      // The last route is what makes the proxy worth its memory, so the daemon stops with it.
      if (removed.ok && headroomRoutedHosts(name).length === 0) await stopHeadroomRuntime();
      ctx.json(res, 200, removed.ok ? { ok: true, detail: removed.detail } : { ok: false, error: removed.detail });
      return true;
    }
    const routed = await routeHostOn(name, headroomProxyUrl());
    ctx.json(
      res,
      200,
      routed.ok ? { ok: true, detail: `${routed.detail}; it survives restarts` } : { ok: false, error: routed.detail },
    );
    return true;
  }
  return false;
}
