// Agent-neutral Headroom routing: one contract every host fills, so a switch works the same way
// whether the agent keeps its providers in YAML, in JSON, or only in its own model catalog.
//
// A host fills three answers: the model it runs, whether its config carries the provider that model
// names, and the endpoint its own catalog records. Tersio writes a block only from those answers, so
// the switch never guesses an endpoint and never edits a file the agent does not own.

import fs from 'node:fs';
import path from 'node:path';
import { hostCap, type HostId } from './host-caps.ts';
import {
  HEADROOM_PORT,
  defaultOmpModel,
  ensureOmpModelsFile,
  ompCachedEndpoint,
  ompConfigFile,
  ompProviderNames,
  isHeadroomCompatibleApi,
  routeOmpDefaultModel,
} from './headroom-proxy.ts';
import { piAgentDir, pigAgentDir } from './utils.ts';
import { readHeadroomRoute } from './headroom-routing.ts';

/** The endpoint an agent's own catalog records for a provider the agent keeps built in. */
export interface AgentEndpoint {
  api: string;
  baseUrl: string;
  /** The catalog's model entries, so a written block is a usable provider and not an empty shell. */
  models: Array<Record<string, unknown>>;
}

export interface AgentProviderRoute {
  model: string;
  provider: string;
  /** True when the agent's own config already carries a block for this provider. */
  configured: boolean;
  /** The endpoint the catalog records, read only when the config has no block. */
  catalog: AgentEndpoint | null;
  /** Write the block the catalog describes; null when this host has no writer. */
  add: ((endpoint: AgentEndpoint) => boolean) | null;
}

export interface AgentRouteResult {
  ok: boolean;
  detail: string;
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function providerOf(model: string, named: string): string {
  if (named) return named;
  const bare = model.replace(/:[^:]+$/, '');
  const slash = bare.indexOf('/');
  return slash > 0 ? bare.slice(0, slash) : '';
}

/** The model entries a written block keeps: the catalog's own fields, minus endpoints that would bypass the proxy. */
function catalogModels(entries: unknown[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const record = { ...(entry as Record<string, unknown>) };
    delete record.baseUrl;
    delete record.baseURL;
    delete record.base_url;
    delete record.provider;
    out.push(record);
  }
  return out;
}

/** The endpoint a provider's catalog entry records, or null when the catalog has no entry. */
export function piCatalogEndpoint(dir: string, provider: string, model: string): AgentEndpoint | null {
  const store = readJson(path.join(dir, 'models-store.json'));
  const entry = store?.[provider];
  if (!entry || typeof entry !== 'object') return null;
  const list = (entry as Record<string, unknown>).models;
  if (!Array.isArray(list) || list.length === 0) return null;
  const bare = model.replace(/:[^:]+$/, '');
  const match =
    list.find((item) => item && typeof item === 'object' && (item as Record<string, unknown>).id === bare) ??
    list.find(
      (item) => item && typeof item === 'object' && `${provider}/${(item as Record<string, unknown>).id}` === bare,
    ) ??
    list[0];
  const record = match && typeof match === 'object' ? (match as Record<string, unknown>) : {};
  const baseUrl =
    typeof record.baseUrl === 'string' ? record.baseUrl : typeof record.baseURL === 'string' ? record.baseURL : '';
  if (!baseUrl) return null;
  return {
    api: typeof record.api === 'string' ? record.api : 'openai-completions',
    baseUrl,
    models: catalogModels(list),
  };
}

/** Add a provider block to Pi's models.json, mirroring the endpoint its catalog already records. */
function writePiProvider(dir: string, provider: string, endpoint: AgentEndpoint): boolean {
  const file = path.join(dir, 'models.json');
  const data = readJson(file) ?? {};
  const providers =
    data.providers && typeof data.providers === 'object' ? (data.providers as Record<string, unknown>) : {};
  providers[provider] = {
    api: endpoint.api,
    baseUrl: endpoint.baseUrl,
    models: endpoint.models,
  };
  data.providers = providers;
  try {
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

function piAgentProviderRoute(host: 'pi' | 'pig'): AgentProviderRoute | null {
  const dir = host === 'pig' ? pigAgentDir() : piAgentDir();
  const settings = readJson(path.join(dir, 'settings.json'));
  if (!settings) return null;
  const model = typeof settings.defaultModel === 'string' ? settings.defaultModel : '';
  const named = typeof settings.defaultProvider === 'string' ? settings.defaultProvider : '';
  const provider = providerOf(model, named);
  if (!provider) return null;
  const models = readJson(path.join(dir, 'models.json'));
  const providers =
    models?.providers && typeof models.providers === 'object' ? (models.providers as Record<string, unknown>) : {};
  const configured = Boolean(providers[provider]);
  return {
    model,
    provider,
    configured,
    catalog: configured ? null : piCatalogEndpoint(dir, provider, model),
    add: (endpoint) => writePiProvider(dir, provider, endpoint),
  };
}

function ompAgentProviderRoute(port: number): AgentProviderRoute | null {
  let config: string;
  let models: string;
  try {
    config = fs.readFileSync(ompConfigFile(), 'utf8');
    models = ensureOmpModelsFile();
  } catch {
    return null;
  }
  const model = defaultOmpModel(config);
  if (!model) return null;
  // The block that lists the model owns it: a gateway (magpie, a local llm) serves models whose own
  // prefix names another provider, so the prefix alone would look for a block that is not there.
  const provider = readHeadroomRoute('omp').provider || providerOf(model, '');
  if (!provider) return null;
  const configured = ompProviderNames(models).has(provider);
  const cached = configured ? null : ompCachedEndpoint(model);
  return {
    model,
    provider,
    configured,
    catalog: cached ? { api: cached.api, baseUrl: cached.baseUrl, models: [] } : null,
    // omp's own writer adds the block for the provider omp keeps built-in.
    add: () => routeOmpDefaultModel(port),
  };
}

/** The active provider's route for one host, or null when the host names no model to route. */
export function agentProviderRoute(host: string, port: number = HEADROOM_PORT): AgentProviderRoute | null {
  if (!hostCap(host)?.headroom) return null;
  switch (host as HostId) {
    case 'omp':
      return ompAgentProviderRoute(port);
    case 'pi':
      return piAgentProviderRoute('pi');
    case 'pig':
      return piAgentProviderRoute('pig');
    default:
      return null;
  }
}

/**
 * Make one host's active provider reach the proxy. Configured hosts are left to their own writer;
 * a provider the host keeps built-in is written from its catalog. Hosts with no catalog answer
 * `ok` with nothing to do, so the switch never invents an endpoint.
 */
export function ensureAgentProviderRoute(host: string, port: number = HEADROOM_PORT): AgentRouteResult {
  const route = agentProviderRoute(host, port);
  if (!route) return { ok: true, detail: '' };
  if (route.configured) return { ok: true, detail: '' };
  if (!route.add) return { ok: false, detail: `${host}: ${route.provider} has no block and this host has no writer` };
  if (!route.catalog) return { ok: false, detail: `${host}: ${route.provider} is not in the agent's catalog` };
  const api = route.catalog.api;
  if (!isHeadroomCompatibleApi(api)) {
    return {
      ok: false,
      detail: `${host}: ${route.provider} speaks ${api}, which the proxy route does not rewrite`,
    };
  }
  if (!route.add(route.catalog))
    return { ok: false, detail: `${host}: headroom could not write the ${route.provider} block` };
  return { ok: true, detail: `${host}: ${route.provider} written from its catalog` };
}
