// Vendor routes: update or remove the one third-party binary Tersio ships for — Headroom. rtk's
// binary is its own install; Tersio only binds it into an agent.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type http from 'node:http';
import { recordActivity } from './activity.ts';
import { homeDir, resolveHeadroomBinary } from '../extensions/shared/utils.ts';

export interface VendorRouteCtx {
  json: (res: Pick<http.ServerResponse, 'writeHead' | 'end'>, code: number, body: unknown) => void;
  bodyOf: (req: http.IncomingMessage) => Promise<Record<string, unknown>>;
  spawnHeadroomInstall: () => boolean;
  isVendorTool: (tool: string) => tool is 'headroom';
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
      // The reporter has no TTY, so headroom's own "Proceed with the upgrade?" prompt would answer
      // itself with Aborted. --yes is what makes this run at all.
      const child = spawn(bin, ['update', '--yes'], { detached: true, stdio: 'ignore', cwd: homeDir() });
      child.unref();
      recordActivity('agent', 'Headroom update started');
      ctx.json(res, 200, { ok: true, detail: 'headroom updates in the background' });
      return true;
    }
    ctx.json(res, 400, { ok: false, error: 'rtk is not managed here' });
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
    ctx.json(res, 400, { ok: false, error: 'rtk is not managed here' });
    return true;
  }
  return false;
}
