// Headroom routes: install the binary, start its proxy, and point an agent at it for good. One
// action per agent — no per-session wrap, no ledger of which tool was wrapped when.

import type http from 'node:http';
import { hostCap } from '../extensions/shared/host-caps.ts';
import {
  headroomHostDurable, headroomProxyPort, headroomProxyUrl, installDurableConfig, readOmpGateway, routeOmpGateway,
} from '../extensions/shared/headroom-proxy.ts';
import { ensureAgentProviderRoute } from '../extensions/shared/headroom-agent.ts';
import { describeHeadroomRoute, readHeadroomRoute } from '../extensions/shared/headroom-routing.ts';
import { installNativeRoute, isNativeRouteHost, removeNativeRoute } from '../extensions/shared/headroom-routes.ts';
import { detectHosts } from './hosts.ts';
import { ensureHeadroomRuntime } from './headroom-runtime.ts';
import { resolveHeadroomBinary, resolveHostBinary } from '../extensions/shared/utils.ts';

export interface HeadroomRouteCtx {
  json: (res: Pick<http.ServerResponse, 'writeHead' | 'end'>, code: number, body: unknown) => void;
  bodyOf: (req: http.IncomingMessage) => Promise<Record<string, unknown>>;
  spawnHeadroomInstall: () => boolean;
  headroomInstallState: () => { startedAt: number; code: number | null; error: string | null };
  headroomRun: (bin: string, args: string[], timeout: number) => Promise<{ ok: boolean; lines: string[] }>;
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
    ctx.json(res, 200, await ensureHeadroomRuntime(bin));
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
          agentPresent: resolveHostBinary(host.bin) !== null,
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
      const gateway = cap.headroomGateway ? readOmpGateway(headroomProxyPort()) : null;
      const runtime = await ensureHeadroomRuntime(bin, gateway?.baseUrl);
      if (!runtime.ok) {
        ctx.json(res, 200, { ok: false, error: `headroom runtime did not start: ${runtime.detail}` });
        return true;
      }
    }
    if (body.on === false) {
      if (isNativeRouteHost(name)) {
        const removed = removeNativeRoute(name);
        ctx.json(res, 200, removed.ok ? { ok: true, detail: removed.detail } : { ok: false, error: removed.detail });
        return true;
      }
      // One switch-off must not strand the other agents: headroom's unwrap stops the proxy by default.
      const run = await ctx.headroomRun(bin, ['unwrap', name, '--no-stop-proxy'], 120_000);
      const out = run.lines.slice(-2).join(' · ');
      ctx.json(res, 200, run.ok
        ? { ok: true, detail: out || `${name}: headroom route removed` }
        : { ok: false, error: out || `the ${name} unwrap failed` });
      return true;
    }
    const port = headroomProxyPort();
    if (isNativeRouteHost(name)) {
      // A provider the agent keeps in its own catalog needs a block before the endpoint can move.
      const ensured = ensureAgentProviderRoute(name, port);
      if (!ensured.ok) {
        ctx.json(res, 200, { ok: false, error: ensured.detail });
        return true;
      }
      const routed = installNativeRoute(name, headroomProxyUrl());
      ctx.json(res, 200, routed.ok ? { ok: true, detail: routed.detail } : { ok: false, error: routed.detail });
      return true;
    }
    // omp and opencode keep their providers in headroom's own block: its writer, its markers, its unwrap.
    const gateway = cap.headroomGateway ? readOmpGateway(port) : null;
    if (!(await installDurableConfig(bin, name, port))) {
      ctx.json(res, 200, { ok: false, error: `headroom could not write ${name}'s config` });
      return true;
    }
    if (gateway && !routeOmpGateway(gateway, port)) {
      ctx.json(res, 200, { ok: false, error: `headroom could not point ${gateway.provider} at the proxy` });
      return true;
    }
    // A provider the agent keeps built in needs its own block; its catalog supplies the endpoint.
    const ensured = ensureAgentProviderRoute(name, port);
    if (!ensured.ok) {
      ctx.json(res, 200, { ok: false, error: ensured.detail });
      return true;
    }
    // The reader decides: a block the active model bypasses is not a route.
    const route = readHeadroomRoute(name);
    ctx.json(res, 200, route.routed
      ? { ok: true, detail: `${name}: headroom config written for port ${port}; it survives restarts` }
      : { ok: false, error: `${name}: ${describeHeadroomRoute(route)}` });
    return true;
  }
  return false;
}
