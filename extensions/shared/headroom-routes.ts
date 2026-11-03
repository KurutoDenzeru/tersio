// The routes Tersio writes for hosts Headroom has no writer for. Only the active provider's
// endpoint changes, so a later model edit stays intact and the off switch puts the old URL back.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { headroomProxyUpstream, headroomProxyUrl } from './headroom-proxy.ts';
import { dshDefaultRoute, dshProviders, sameProxyEndpoint } from './headroom-routing.ts';
import { patchState, readState } from './state.ts';
import { homeDir, piAgentDir, pigAgentDir } from './utils.ts';
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

function saveRecords(host: NativeRouteHost, records: HeadroomRouteRecord[]): void {
  const all = readState().headroomRoutes ?? {};
  if (records.length > 0) all[host] = records;
  else delete all[host];
  patchState({ headroomRoutes: all });
}

interface Target {
  file: string;
  provider: string;
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
  const key = typeof record.baseUrl === 'string' ? 'baseUrl' : typeof record.baseURL === 'string' ? 'baseURL' : '';
  const rawOriginal = key ? record[key] : null;
  const original = typeof rawOriginal === 'string' ? rawOriginal : '';
  if (!key || !original) return [];
  const api = typeof record.api === 'string' ? record.api : '';
  return [{
    file: modelsFile,
    provider,
    api,
    original,
    write: (url: string) => {
      const fresh = readJson(modelsFile);
      if (!fresh) throw new Error(`${modelsFile} is not valid JSON`);
      const list = fresh.providers && typeof fresh.providers === 'object' ? fresh.providers as Record<string, unknown> : {};
      const block = list[provider];
      if (!block || typeof block !== 'object') throw new Error(`${provider} is not in ${modelsFile}`);
      (block as Record<string, unknown>)[key] = url;
      writeFileSync(modelsFile, `${JSON.stringify(fresh, null, 2)}\n`, 'utf8');
    },
  }];
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

function targetsFor(host: NativeRouteHost): Target[] {
  return host === 'dsh' ? dshTargets() : piTargets(host);
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
  const records: HeadroomRouteRecord[] = [];
  const applied: Target[] = [];
  try {
    for (const target of targets) {
      const url = nativeProxyUrl(target.api, proxyUrl);
      if (sameProxyEndpoint(target.original, url)) continue;
      target.write(url);
      applied.push(target);
      records.push({ file: target.file, provider: target.provider, original: target.original, written: url });
    }
  } catch (e) {
    for (const target of applied) {
      try { target.write(target.original); } catch { /* best effort */ }
    }
    return { ok: false, detail: (e as Error).message };
  }
  if (records.length === 0) return { ok: true, detail: `${host} already reaches Headroom` };
  saveRecords(host, records);
  return { ok: true, detail: `${host}: ${records.length} endpoint${records.length === 1 ? '' : 's'} routed through Headroom` };
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
        const key = typeof recordBlock.baseUrl === 'string' ? 'baseUrl' : 'baseURL';
        const current = recordBlock[key];
        if (typeof current !== 'string' || !sameProxyEndpoint(current, record.written)) continue;
        recordBlock[key] = record.original;
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
