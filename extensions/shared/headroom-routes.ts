// The endpoints Tersio writes itself, for every agent it can route. Only the active provider's
// endpoint changes, so a later model edit stays intact and the off switch puts the old URL back.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { headroomProxyUpstream, headroomProxyUrl } from './headroom-proxy.ts';
import {
  durableConfigInstalled, headroomProxyPort, installDurableConfig, readOmpGateway, routeOmpGateway,
} from './headroom-proxy.ts';
import { describeHeadroomRoute, dshDefaultRoute, dshProviders, jsonBaseUrl, jsonModelEntry, readHeadroomRoute, sameProxyEndpoint } from './headroom-routing.ts';
import type { HeadroomRoute } from './headroom-routing.ts';
import { hostCap } from './host-caps.ts';
import { patchState, readState } from './state.ts';
import { homeDir, piAgentDir, pigAgentDir, resolveHeadroomBinary } from './utils.ts';
import type { HeadroomRouteRecord } from './state.ts';

export type NativeRouteHost = 'pi' | 'pig' | 'dsh';
export const NATIVE_ROUTE_HOSTS: ReadonlyArray<NativeRouteHost> = ['pi', 'pig', 'dsh'];

export interface NativeRouteResult {
  ok: boolean;
  detail: string;
}

export function isNativeRouteHost(host: string): host is NativeRouteHost {
  return (NATIVE_ROUTE_HOSTS as ReadonlyArray<string>).includes(host);
}

/** The URL the host's protocol needs: OpenAI clients add `/v1`, Anthropic clients use the root. */
export function nativeProxyUrl(api: string, proxyUrl: string = headroomProxyUrl()): string {
  const root = proxyUrl.replace(/\/+$/, '');
  return /anthropic/i.test(api) ? root : `${root}/v1`;
}

/** The same upstream, path included: a proxy pointed at another provider must not take this route. */
function sameUpstream(a: string, b: string): boolean {
  try {
    const left = new URL(a);
    const right = new URL(b);
    return left.origin === right.origin && left.pathname.replace(/\/+$/, '') === right.pathname.replace(/\/+$/, '');
  } catch {
    return a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
  }
}

export function nativeRouteRecords(host: NativeRouteHost): HeadroomRouteRecord[] {
  return readState().headroomRoutes?.[host] ?? [];
}

export function hasNativeRoute(host: NativeRouteHost): boolean {
  return nativeRouteRecords(host).length > 0;
}

/**
 * True when a tool other than Tersio put the endpoint back. A model switcher that owns the provider
 * block rewrites it on every switch, so the recorded route disappears without the user asking.
 * Only the endpoint Tersio replaced counts: a newer edit of the user's own is left alone.
 */
export function routeDrifted(host: string, route: HeadroomRoute): boolean {
  if (!isNativeRouteHost(host) || !route.measured || route.routed || !route.baseUrl) return false;
  const current = route.baseUrl;
  return nativeRouteRecords(host).some((record) => sameProxyEndpoint(current, record.original));
}

function saveRecords(host: NativeRouteHost, records: HeadroomRouteRecord[]): void {
  const all = readState().headroomRoutes ?? {};
  if (records.length > 0) all[host] = records;
  else delete all[host];
  patchState({ headroomRoutes: all });
}

interface Target {
  file: string;
  provider: string;
  /** Set when the record owns one model's endpoint instead of the provider's. */
  model?: string;
  api: string;
  original: string;
  write: (url: string) => void;
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** The endpoint key a block actually uses, so a write keeps the host's own spelling. */
function endpointKey(record: Record<string, unknown>): string {
  return ['baseUrl', 'baseURL', 'base_url'].find((key) => typeof record[key] === 'string') ?? '';
}

/** The protocol, host, and port two endpoints share; a path may differ and still reach one service. */
function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/** Write one endpoint into the provider block, or into the model entry that overrides it. */
function writeJsonEndpoint(file: string, provider: string, model: string | null, key: string, url: string): void {
  const fresh = readJson(file);
  if (!fresh) throw new Error(`${file} is not valid JSON`);
  const list = fresh.providers && typeof fresh.providers === 'object' ? fresh.providers as Record<string, unknown> : {};
  const block = list[provider];
  if (!block || typeof block !== 'object') throw new Error(`${provider} is not in ${file}`);
  const target = model ? jsonModelEntry(block as Record<string, unknown>, model, provider) : block as Record<string, unknown>;
  if (!target) throw new Error(`${model} is not in ${file}`);
  target[key] = url;
  writeFileSync(file, `${JSON.stringify(fresh, null, 2)}\n`, 'utf8');
}

function piTargets(host: 'pi' | 'pig'): Target[] {
  const dir = host === 'pig' ? pigAgentDir() : piAgentDir();
  const settings = readJson(path.join(dir, 'settings.json'));
  const modelsFile = path.join(dir, 'models.json');
  const models = readJson(modelsFile);
  if (!settings || !models) return [];
  const model = typeof settings.defaultModel === 'string' ? settings.defaultModel : '';
  const named = typeof settings.defaultProvider === 'string' ? settings.defaultProvider : '';
  const provider = named || (model.includes('/') ? model.slice(0, model.indexOf('/')) : '');
  if (!provider) return [];
  const providers = models.providers && typeof models.providers === 'object' ? models.providers as Record<string, unknown> : {};
  const entry = providers[provider];
  const record = entry && typeof entry === 'object' ? entry as Record<string, unknown> : null;
  if (!record) return [];
  const api = typeof record.api === 'string' ? record.api : '';
  const targets: Target[] = [];
  const providerKey = endpointKey(record);
  if (providerKey) {
    targets.push({
      file: modelsFile,
      provider,
      api,
      original: record[providerKey] as string,
      write: (url: string) => writeJsonEndpoint(modelsFile, provider, null, providerKey, url),
    });
  }
  // A model that names its own endpoint beats the provider's, so it is routed beside it.
  const modelEntry = model ? jsonModelEntry(record, model, provider) : null;
  const modelKey = modelEntry ? endpointKey(modelEntry) : '';
  const modelId = modelEntry && typeof modelEntry.id === 'string' ? modelEntry.id : '';
  if (modelId && modelKey) {
    targets.push({
      file: modelsFile,
      provider,
      model: modelId,
      api,
      original: modelEntry![modelKey] as string,
      write: (url: string) => writeJsonEndpoint(modelsFile, provider, modelId, modelKey, url),
    });
  }
  return targets;
}

/** The dsh files that hold the active provider, with the settings file first. */
function dshTargets(): Target[] {
  const root = path.join(homeDir(), '.dsh');
  const settingsFile = path.join(root, 'settings.yaml');
  const profiles = ['desktop', 'web'].map((profile) => path.join(root, 'profiles', profile, 'cordis.patch.yml'));
  const profile = profiles.find((file) => existsSync(file));
  if (!profile) return [];
  let provider = '';
  try { provider = dshDefaultRoute(readFileSync(profile, 'utf8')).provider; } catch { /* absent */ }
  if (!provider) return [];
  const targets: Target[] = [];
  for (const file of [settingsFile, ...profiles]) {
    if (!existsSync(file)) continue;
    let text: string;
    try { text = readFileSync(file, 'utf8'); } catch { continue; }
    const block = dshProviders(text).find((entry) => entry.name === provider && entry.baseLine >= 0);
    if (!block || !block.baseUrl) continue;
    targets.push({
      file,
      provider,
      api: block.api,
      original: block.baseUrl,
      write: (url: string) => {
        const fresh = readFileSync(file, 'utf8');
        const freshBlock = dshProviders(fresh).find((entry) => entry.name === provider && entry.baseLine >= 0);
        if (!freshBlock) throw new Error(`${provider} is not in ${file}`);
        const lines = fresh.split(/\r?\n/);
        const line = lines[freshBlock.baseLine];
        if (line === undefined) throw new Error(`${file} changed while routing`);
        const indent = line.match(/^\s*/)?.[0] ?? '';
        const comment = line.match(/\s+#.*$/)?.[0] ?? '';
        lines[freshBlock.baseLine] = `${indent}baseURL: ${url}${comment}`;
        writeFileSync(file, lines.join(fresh.includes('\r\n') ? '\r\n' : '\n'), 'utf8');
      },
    });
  }
  return targets;
}

const TARGET_PLANNERS: Record<NativeRouteHost, () => Target[]> = {
  pi: () => piTargets('pi'),
  pig: () => piTargets('pig'),
  dsh: dshTargets,
};

function targetsFor(host: NativeRouteHost): Target[] {
  return TARGET_PLANNERS[host]();
}

/** Point the active provider at Headroom and keep the URL it replaced. */
export function installNativeRoute(host: NativeRouteHost, proxyUrl: string = headroomProxyUrl()): NativeRouteResult {
  // A provider change leaves the old record behind; put that endpoint back before recording a new one.
  if (nativeRouteRecords(host).length > 0) {
    const restored = removeNativeRoute(host);
    if (!restored.ok) return restored;
  }
  let targets: Target[];
  try { targets = targetsFor(host); } catch (e) { return { ok: false, detail: (e as Error).message }; }
  if (targets.length === 0) return { ok: false, detail: `no active provider endpoint found for ${host}` };
  // A route only makes sense when the proxy names the provider it replaces for this protocol.
  for (const target of targets) {
    if (target.model) continue;
    const upstream = headroomProxyUpstream(target.api);
    if (!upstream) {
      const flag = /anthropic/i.test(target.api) ? '--anthropic-api-url' : '--openai-api-url';
      return {
        ok: false,
        detail: `${host}: Headroom names no upstream for ${target.api || 'OpenAI'} traffic. Start it with ${flag} ${target.original} first.`,
      };
    }
    if (!sameUpstream(upstream, target.original)) {
      return {
        ok: false,
        detail: `${host}: ${target.original} is not Headroom's upstream (${upstream}). Start Headroom with the provider URL first.`,
      };
    }
  }
  // A model's own endpoint may spell its path differently, so only the service has to match.
  for (const target of targets) {
    if (!target.model) continue;
    const provider = targets.find((entry) => !entry.model && entry.file === target.file && entry.provider === target.provider);
    const expected = provider ? provider.original : target.original;
    if (!sameOrigin(target.original, expected)) {
      return { ok: false, detail: `${host}: ${target.original} is a different service from ${expected}. Route ${target.model} by hand.` };
    }
  }
  const records: HeadroomRouteRecord[] = [];
  const applied: Target[] = [];
  try {
    for (const target of targets) {
      const url = nativeProxyUrl(target.api, proxyUrl);
      if (sameProxyEndpoint(target.original, url)) continue;
      target.write(url);
      applied.push(target);
      records.push({ file: target.file, provider: target.provider, model: target.model, original: target.original, written: url });
    }
  } catch (e) {
    for (const target of applied) {
      try { target.write(target.original); } catch { /* best effort */ }
    }
    return { ok: false, detail: (e as Error).message };
  }
  if (records.length === 0) return { ok: true, detail: `${host} already reaches Headroom` };
  saveRecords(host, records);
  const check = readHeadroomRoute(host, proxyUrl);
  if (check.routed) {
    return { ok: true, detail: `${host}: ${records.length} endpoint${records.length === 1 ? '' : 's'} routed through Headroom` };
  }
  const restored = removeNativeRoute(host);
  return {
    ok: false,
    detail: `${host} still bypasses Headroom after the write (${describeHeadroomRoute(check)})${restored.ok ? ', endpoints restored' : ''}`,
  };
}

/**
 * Put back a route a third-party writer replaced. A native host still has Tersio's record, so the
 * recorded endpoint proves the drift. A durable host's block belongs to headroom, so its own writer
 * restores it and no record is needed. Neither path touches the gateway that overwrote the route.
 */
export async function repairHeadroomRoute(host: string, proxyUrl: string = headroomProxyUrl()): Promise<NativeRouteResult> {
  const route = readHeadroomRoute(host, proxyUrl);
  if (!route.measured) return { ok: false, detail: describeHeadroomRoute(route) };
  if (route.routed) return { ok: true, detail: `${host} already reaches Headroom` };
  if (isNativeRouteHost(host)) {
    if (!routeDrifted(host, route)) return { ok: false, detail: describeHeadroomRoute(route) };
    return installNativeRoute(host, proxyUrl);
  }
  if (!hostCap(host)?.headroomDurable || !durableConfigInstalled(host)) return { ok: false, detail: describeHeadroomRoute(route) };
  const bin = resolveHeadroomBinary();
  if (!bin) return { ok: false, detail: `${host}: no headroom binary to rewrite its block` };
  const port = headroomProxyPort();
  if (!(await installDurableConfig(bin, host, port))) return { ok: false, detail: `${host}: headroom could not rewrite its block` };
  // The omp gateway line moves with the block, or the block still points at the gateway.
  const gateway = hostCap(host)?.headroomGateway ? readOmpGateway(port) : null;
  if (gateway) routeOmpGateway(gateway, port);
  const repaired = readHeadroomRoute(host, proxyUrl);
  return repaired.routed
    ? { ok: true, detail: `${host}: ${describeHeadroomRoute(repaired)}` }
    : { ok: false, detail: describeHeadroomRoute(repaired) };
}

/** Put back the endpoint Tersio replaced, leaving any newer edit alone. */
export function removeNativeRoute(host: NativeRouteHost): NativeRouteResult {
  const records = nativeRouteRecords(host);
  if (records.length === 0) return { ok: true, detail: `no Tersio route recorded for ${host}` };
  const failed: HeadroomRouteRecord[] = [];
  for (const record of records) {
    try {
      const text = readFileSync(record.file, 'utf8');
      if (host === 'dsh') {
        const block = dshProviders(text).find((entry) => entry.name === record.provider && entry.baseLine >= 0);
        if (!block) continue;
        if (!sameProxyEndpoint(block.baseUrl, record.written)) continue;
        const lines = text.split(/\r?\n/);
        const line = lines[block.baseLine];
        if (line === undefined) throw new Error(`${record.file} changed while unwrapping`);
        const indent = line.match(/^\s*/)?.[0] ?? '';
        const comment = line.match(/\s+#.*$/)?.[0] ?? '';
        lines[block.baseLine] = `${indent}baseURL: ${record.original}${comment}`;
        writeFileSync(record.file, lines.join(text.includes('\r\n') ? '\r\n' : '\n'), 'utf8');
      } else {
        const data = JSON.parse(text) as Record<string, unknown>;
        const providers = data.providers && typeof data.providers === 'object' ? data.providers as Record<string, unknown> : {};
        const block = providers[record.provider];
        if (!block || typeof block !== 'object') continue;
        const recordBlock = block as Record<string, unknown>;
        const target = record.model ? jsonModelEntry(recordBlock, record.model, record.provider) : recordBlock;
        if (!target) continue;
        const key = endpointKey(target);
        const current = key ? jsonBaseUrl(target) : null;
        if (typeof current !== 'string' || !sameProxyEndpoint(current, record.written)) continue;
        target[key] = record.original;
        writeFileSync(record.file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
      }
    } catch {
      failed.push(record);
    }
  }
  saveRecords(host, failed);
  return failed.length === 0
    ? { ok: true, detail: `${host}: endpoint restored` }
    : { ok: false, detail: `${host}: ${failed.length} endpoint${failed.length === 1 ? '' : 's'} could not be restored` };
}
