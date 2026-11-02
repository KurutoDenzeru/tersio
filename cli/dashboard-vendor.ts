// Vendor routes: update or remove the two third-party binaries the Tools page owns.

import { spawn } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import type http from 'node:http';
import { recordActivity } from './activity.ts';
import { detectHosts } from './hosts.ts';
import { homeDir, resolveHeadroomBinary } from '../extensions/shared/utils.ts';

export interface VendorRouteCtx {
  json: (res: Pick<http.ServerResponse, 'writeHead' | 'end'>, code: number, body: unknown) => void;
  bodyOf: (req: http.IncomingMessage) => Promise<Record<string, unknown>>;
  spawnHeadroomInstall: () => boolean;
  isVendorTool: (tool: string) => tool is 'headroom' | 'rtk';
}

/** True when the route was answered. */
export async function handleVendorRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: VendorRouteCtx,
): Promise<boolean> {
  if (req.url === '/api/vendor/update' && req.method === 'POST') {
    const body = await ctx.bodyOf(req);
    const tool = String(body.tool ?? '');
    if (!ctx.isVendorTool(tool)) {
      ctx.json(res, 400, { ok: false, error: 'unknown tool' });
      return true;
    }
    if (tool === 'headroom') {
      const bin = resolveHeadroomBinary();
      if (!bin) {
        if (!ctx.spawnHeadroomInstall()) {
          ctx.json(res, 500, { ok: false, error: 'cannot find the tersio entry point' });
          return true;
        }
        ctx.json(res, 200, { ok: true, detail: 'headroom installs in the background' });
        return true;
      }
      const child = spawn(bin, ['update'], { detached: true, stdio: 'ignore', cwd: homeDir() });
      child.unref();
      recordActivity('agent', 'Headroom update started');
      ctx.json(res, 200, { ok: true, detail: 'headroom updates in the background' });
      return true;
    }
    const entry = process.argv[1];
    const host = detectHosts().find((candidate) => candidate.installed)?.id;
    if (!entry || !host) {
      ctx.json(res, 400, { ok: false, error: 'no installed agent to refresh rtk through' });
      return true;
    }
    const runtime = entry.endsWith('.ts') ? 'bun' : process.execPath;
    const child = spawn(runtime, [entry, 'install', '--host', host, '--apply-update', '--yes'], { detached: true, stdio: 'ignore' });
    child.unref();
    recordActivity('agent', 'RTK update started');
    ctx.json(res, 200, { ok: true, detail: `rtk updates through the ${host} refresh — running in the background` });
    return true;
  }
  if (req.url === '/api/vendor/uninstall' && req.method === 'POST') {
    const body = await ctx.bodyOf(req);
    const tool = String(body.tool ?? '');
    if (!ctx.isVendorTool(tool)) {
      ctx.json(res, 400, { ok: false, error: 'unknown tool' });
      return true;
    }
    const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
    dirs.push(path.join(homeDir(), '.local', 'bin'));
    if (tool === 'headroom') {
      const viaUv = dirs.some((dir) => existsSync(path.join(dir, 'uv')));
      const cmd = viaUv ? 'uv' : 'pip3';
      const args = viaUv ? ['tool', 'uninstall', 'headroom-ai'] : ['uninstall', '-y', 'headroom-ai'];
      const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
      child.unref();
      recordActivity('agent', 'Headroom uninstall started');
      ctx.json(res, 200, { ok: true, detail: `uninstalling headroom-ai with ${cmd} in the background` });
      return true;
    }
    const found = dirs.map((dir) => path.join(dir, 'rtk')).find((candidate) => existsSync(candidate));
    if (!found) {
      ctx.json(res, 400, { ok: false, error: 'rtk is not installed' });
      return true;
    }
    try {
      if (existsSync(`${found}.bak`)) unlinkSync(`${found}.bak`);
      unlinkSync(found);
      recordActivity('agent', 'RTK uninstalled');
      ctx.json(res, 200, { ok: true, detail: 'the rtk binary is removed — its hooks skip a missing rtk' });
    } catch (e) {
      ctx.json(res, 500, { ok: false, error: (e as Error).message || 'could not remove the rtk binary' });
    }
    return true;
  }
  return false;
}
