// Headroom routes: install, runtime, durable wraps, and the wrap ledger. Kept out of the server
// shell so the route table does not become one thousand-line function.

import type http from 'node:http';
import { readHeadroomDoctor } from '../extensions/shared/headroom-gain.ts';
import { hostCap } from '../extensions/shared/host-caps.ts';
import {
  DURABLE_CONFIG, discoverInitTargets, durableConfigInstalled,
  headroomHostDurable, headroomProxyPort, headroomProxyUrl, installDurableConfig, readOmpGateway, routeOmpGateway,
} from '../extensions/shared/headroom-proxy.ts';
import { ensureAgentProviderRoute } from '../extensions/shared/headroom-agent.ts';
import { describeHeadroomRoute, readHeadroomRoute } from '../extensions/shared/headroom-routing.ts';
import { hasNativeRoute, installNativeRoute, isNativeRouteHost, removeNativeRoute, routeDrifted } from '../extensions/shared/headroom-routes.ts';
import { detectHosts } from './hosts.ts';
import { mergeHeadroomWraps, readHeadroomWraps, setStoredWrap, writeHeadroomWraps } from '../extensions/shared/headroom-wraps.ts';
import { ensureHeadroomRuntime } from './headroom-runtime.ts';
import { resolveHeadroomBinary } from '../extensions/shared/utils.ts';

export interface HeadroomRouteCtx {
  json: (res: Pick<http.ServerResponse, 'writeHead' | 'end'>, code: number, body: unknown) => void;
  bodyOf: (req: http.IncomingMessage) => Promise<Record<string, unknown>>;
  wrapTargetPresent: (name: string) => Promise<boolean>;
  spawnHeadroomInstall: () => boolean;
  headroomInstallState: () => { startedAt: number; code: number | null; error: string | null };
  headroomRun: (bin: string, args: string[], timeout: number) => Promise<{ ok: boolean; lines: string[] }>;
  wrapTargets: readonly string[];
  wrapLabels: Record<string, string>;
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
  // Tersio's five agents only. Headroom's own extra tools stay out of this drawer.
  if (req.url === '/api/headroom/wrap' && req.method === 'GET') {
    const bin = resolveHeadroomBinary();
    const hosts = detectHosts();
    const present = await Promise.all(hosts.map((host) => ctx.wrapTargetPresent(host.id)));
    const targets = hosts.map((host, i) => {
      const agentPresent = present[i] === true;
      if (headroomHostDurable(host.id)) {
        const route = readHeadroomRoute(host.id);
        return {
          name: host.id,
          label: host.label,
          durable: true,
          manual: false,
          // The config block can exist while the active model bypasses it, so the row reads the route.
          installed: route.routed,
          configured: durableConfigInstalled(host.id),
          agentInstalled: host.installed,
          agentPresent,
        };
      }
      const route = readHeadroomRoute(host.id);
      const native = isNativeRouteHost(host.id);
      return {
        name: host.id,
        label: host.label,
        manual: !native,
        durable: native,
        route: true,
        installed: route.routed,
        // A route another tool reset reads as installed-but-drifted, so the drawer names the cause.
        drifted: routeDrifted(host.id, route),
        managed: isNativeRouteHost(host.id) ? hasNativeRoute(host.id) : undefined,
        agentInstalled: host.installed,
        agentPresent,
        detail: describeHeadroomRoute(route),
      };
    });
    ctx.json(res, 200, { ok: bin !== null, endpoint: headroomProxyUrl(), targets });
    return true;
  }
  // The automated durable install: one documented headroom command per tool, never a per-session wrap.
  if (req.url === '/api/headroom/wrap' && req.method === 'POST') {
    const body = await ctx.bodyOf(req);
    const name = String(body.name ?? '');
    const bin = resolveHeadroomBinary();
    const native = isNativeRouteHost(name);
    const canConfig = (DURABLE_CONFIG as readonly string[]).includes(name);
    const knownInit = bin ? (await discoverInitTargets(bin)) ?? [] : [];
    if (!bin || (!ctx.wrapTargets.includes(name) && !canConfig && !native && !knownInit.includes(name))) {
      ctx.json(res, 400, { ok: false, error: 'unknown wrap target or no headroom binary' });
      return true;
    }
    if (!canConfig && !native && !knownInit.includes(name)) {
      ctx.json(res, 200, { ok: false, error: `${name} has no durable headroom integration; run headroom wrap ${name} yourself per session` });
      return true;
    }
    // A switch points the agent at the proxy, so the proxy must answer before the config is written.
    const port = headroomProxyPort();
    const gateway = hostCap(name)?.headroomGateway ? readOmpGateway(port) : null;
    if (body.action !== 'unwrap') {
      const runtime = await ensureHeadroomRuntime(bin, gateway?.baseUrl);
      if (!runtime.ok) {
        ctx.json(res, 200, { ok: false, error: `headroom runtime did not start: ${runtime.detail}` });
        return true;
      }
    }
    if (body.action === 'unwrap') {
      if (isNativeRouteHost(name)) {
        const removed = removeNativeRoute(name);
        if (removed.ok) setStoredWrap(name, false);
        ctx.json(res, 200, removed.ok ? { ok: true, detail: removed.detail } : { ok: false, error: removed.detail });
        return true;
      }
      // One switch-off must not strand the other durable agents: headroom's unwrap stops the proxy by default.
      const run = await ctx.headroomRun(bin, ['unwrap', name, '--no-stop-proxy'], 120_000);
      setStoredWrap(name, false);
      const out = run.lines.slice(-2).join(' · ');
      ctx.json(res, 200, run.ok
        ? { ok: true, detail: out || `${name}: headroom integration removed` }
        : { ok: false, error: out || `the ${name} unwrap failed` });
      return true;
    }
    if (isNativeRouteHost(name)) {
      // A provider the host keeps in its own catalog needs a block before the endpoint can move.
      const ensured = ensureAgentProviderRoute(name, port);
      if (!ensured.ok) {
        ctx.json(res, 200, { ok: false, error: ensured.detail });
        return true;
      }
      const routed = installNativeRoute(name, headroomProxyUrl());
      if (routed.ok) setStoredWrap(name, true);
      ctx.json(res, 200, routed.ok ? { ok: true, detail: routed.detail } : { ok: false, error: routed.detail });
      return true;
    }
    if (canConfig) {
      // Headroom's own writer, so the marker, backup, and unwrap contract are headroom's.
      const wrote = await installDurableConfig(bin, name, port);
      if (wrote && gateway && !routeOmpGateway(gateway, port)) {
        ctx.json(res, 200, { ok: false, error: `headroom could not point ${gateway.provider} at the proxy` });
        return true;
      }
      // A provider the agent keeps built in needs its own block; its catalog supplies the endpoint.
      const ensured = wrote ? ensureAgentProviderRoute(name, port) : { ok: true, detail: '' };
      if (!ensured.ok) {
        ctx.json(res, 200, { ok: false, error: ensured.detail });
        return true;
      }
      // The reader decides: a block the active model bypasses is not a route.
      const route = readHeadroomRoute(name);
      if (wrote && !route.routed) {
        ctx.json(res, 200, { ok: false, error: `${name}: ${describeHeadroomRoute(route)}` });
        return true;
      }
      if (wrote) setStoredWrap(name, true);
      ctx.json(res, 200, wrote
        ? { ok: true, detail: `${name}: headroom config written for port ${port}; it survives restarts` }
        : { ok: false, error: `headroom could not write ${name}'s config` });
      return true;
    }
    // Durable init: headroom writes its own hooks and owns their removal.
    const init = await ctx.headroomRun(bin, ['init', '-g', name], 120_000);
    if (init.ok) {
      setStoredWrap(name, true);
      ctx.json(res, 200, { ok: true, detail: init.lines.slice(-2).join(' · ') || `${name}: durable headroom integration installed` });
      return true;
    }
    ctx.json(res, 200, { ok: false, error: init.lines.slice(-2).join(' · ') || `the ${name} integration failed` });
    return true;
  }
  // The wrap record lives tersio-side too, so a second browser sees the same switches.
  if (req.url === '/api/headroom/wraps' && req.method === 'GET') {
    const stored = readHeadroomWraps();
    const bin = resolveHeadroomBinary();
    let wraps = mergeHeadroomWraps(stored, [], ctx.wrapTargets);
    const doctor = bin ? readHeadroomDoctor({ binary: bin, port: headroomProxyPort() }) : null;
    if (doctor?.measured) {
      wraps = mergeHeadroomWraps(stored, doctor.checks, ctx.wrapTargets);
      try { writeHeadroomWraps(wraps); } catch { /* best effort */ }
    }
    for (const name of DURABLE_CONFIG) if (readHeadroomRoute(name).routed) wraps[name] = true;
    ctx.json(res, 200, { ok: true, wraps });
    return true;
  }
  if (req.url === '/api/headroom/wraps' && req.method === 'POST') {
    const body = await ctx.bodyOf(req);
    if (!body.wraps || typeof body.wraps !== 'object') {
      ctx.json(res, 400, { ok: false, error: 'wraps must be an object' });
      return true;
    }
    writeHeadroomWraps(body.wraps as Record<string, unknown>);
    ctx.json(res, 200, { ok: true });
    return true;
  }
  return false;
}
