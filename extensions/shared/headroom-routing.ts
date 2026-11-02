// Whether the model the agent will call reaches Headroom's proxy. A live proxy with an unrouted
// model compresses nothing, so the session block must stay out until this answer is yes.

import fs from 'node:fs';
import path from 'node:path';
import { headroomProxyUrl, ompConfigFile, ompModelsFile, opencodeConfigFiles } from './headroom-proxy.ts';

export interface HeadroomRoute {
  /** True when a config was read far enough to answer. */
  measured: boolean;
  failure: string;
  host: string;
  proxyUrl: string;
  model: string;
  provider: string | null;
  baseUrl: string | null;
  routed: boolean;
}

interface OmpEndpoint {
  provider: string;
  baseUrl: string | null;
}

function unquote(text: string): string {
  const value = text.trim();
  return (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
    ? value.slice(1, -1)
    : value;
}

function valueOf(line: string): string | null {
  const at = line.indexOf(':');
  if (at < 0) return null;
  const value = line.slice(at + 1).trim();
  return value === '' ? null : unquote(value);
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** The provider and endpoint for one model id, read from the small YAML subset `models.yml` uses. */
export function ompModelRoute(text: string, model: string): OmpEndpoint | null {
  // omp prefixes a role's model with its provider id; models.yml stores the id without it.
  const bare = model.replace(/:[^:]+$/, '');
  let provider: string | null = null;
  let providerBase: string | null = null;
  let inModels = false;
  let target: { provider: string; providerBase: string | null; modelBase: string | null; id: string } | null = null;
  let found: OmpEndpoint | null = null;

  const finish = (): void => {
    if (target) {
      const ids = new Set([model, bare]);
      if (model.startsWith(`${target.provider}/`)) {
        const rest = model.slice(target.provider.length + 1);
        ids.add(rest);
        ids.add(rest.replace(/:[^:]+$/, ''));
      }
      if (ids.has(target.id)) found = { provider: target.provider, baseUrl: target.modelBase ?? target.providerBase };
    }
    target = null;
  };

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = indentOf(line);
    if (indent === 0) {
      finish();
      provider = null;
      providerBase = null;
      inModels = false;
      continue;
    }
    if (indent === 2 && /^[^:\s][^:]*:\s*$/.test(trimmed)) {
      finish();
      provider = unquote(trimmed.slice(0, -1));
      providerBase = null;
      inModels = false;
      continue;
    }
    if (!provider) continue;
    if (indent === 4 && trimmed.startsWith('baseUrl:')) {
      providerBase = valueOf(trimmed);
      continue;
    }
    if (indent === 4 && trimmed === 'models:') {
      inModels = true;
      continue;
    }
    if (!inModels) continue;
    if (indent >= 4 && trimmed.startsWith('- ')) {
      finish();
      target = { provider, providerBase, modelBase: null, id: '' };
      const rest = trimmed.slice(2).trim();
      const id = rest.startsWith('id:') ? valueOf(rest) : null;
      if (id) target.id = id;
      continue;
    }
    if (!target) continue;
    if (indent >= 6 && trimmed.startsWith('id:')) {
      target.id = valueOf(trimmed) ?? target.id;
    } else if (indent >= 6 && trimmed.startsWith('baseUrl:')) {
      target.modelBase = valueOf(trimmed);
    }
  }
  finish();
  return found;
}

/** omp's default role, with the effort suffix kept for display. */
export function defaultOmpModel(text: string): string | null {
  const block = text.match(/^modelRoles:\s*\n((?:[ \t]+[^\n]*\n?)+)/m)?.[1] ?? '';
  const match = block.match(/^[ \t]+default:\s*(.+?)\s*$/m);
  return match ? unquote(match[1]) : null;
}

/** Same scheme, port, and host; loopback spellings count as the same machine. */
export function sameProxyEndpoint(baseUrl: string, proxyUrl: string): boolean {
  try {
    const base = new URL(baseUrl);
    const proxy = new URL(proxyUrl);
    const basePort = base.port || (base.protocol === 'https:' ? '443' : '80');
    const proxyPort = proxy.port || (proxy.protocol === 'https:' ? '443' : '80');
    const baseLoop = base.hostname === 'localhost' || base.hostname === '127.0.0.1' || base.hostname === '::1' || base.hostname === '[::1]';
    const proxyLoop = proxy.hostname === 'localhost' || proxy.hostname === '127.0.0.1' || proxy.hostname === '::1' || proxy.hostname === '[::1]';
    return base.protocol === proxy.protocol && basePort === proxyPort && (base.hostname === proxy.hostname || (baseLoop && proxyLoop));
  } catch {
    return false;
  }
}

export function stripJsonComments(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
    } else if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
    } else if (char === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 1;
    } else {
      out += char;
    }
  }
  return out;
}

function emptyRoute(host: string, proxyUrl: string, failure: string): HeadroomRoute {
  return { measured: false, failure, host, proxyUrl, model: '', provider: null, baseUrl: null, routed: false };
}

/** The default omp role's provider endpoint. */
function readOmpRoute(proxyUrl: string): HeadroomRoute {
  let config: string;
  let models: string;
  try {
    config = fs.readFileSync(ompConfigFile(), 'utf8');
    models = fs.readFileSync(ompModelsFile(), 'utf8');
  } catch (e) {
    return emptyRoute('omp', proxyUrl, (e as Error).message);
  }
  const model = defaultOmpModel(config);
  if (!model) return emptyRoute('omp', proxyUrl, `${ompConfigFile()} has no modelRoles.default`);
  const endpoint = ompModelRoute(models, model);
  if (!endpoint) return emptyRoute('omp', proxyUrl, `${model} is not in ${path.basename(ompModelsFile())}`);
  return {
    measured: true,
    failure: '',
    host: 'omp',
    proxyUrl,
    model,
    provider: endpoint.provider,
    baseUrl: endpoint.baseUrl,
    routed: endpoint.baseUrl ? sameProxyEndpoint(endpoint.baseUrl, proxyUrl) : false,
  };
}

function opencodeBaseUrl(provider: unknown): string | null {
  if (!provider || typeof provider !== 'object') return null;
  const record = provider as Record<string, unknown>;
  const options = record.options && typeof record.options === 'object' ? record.options as Record<string, unknown> : {};
  for (const key of ['baseURL', 'baseUrl', 'base_url']) {
    if (typeof options[key] === 'string') return options[key] as string;
    if (typeof record[key] === 'string') return record[key] as string;
  }
  return null;
}

/** The active OpenCode model's provider endpoint. */
function readOpencodeRoute(proxyUrl: string): HeadroomRoute {
  for (const file of opencodeConfigFiles()) {
    if (!fs.existsSync(file)) continue;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(stripJsonComments(fs.readFileSync(file, 'utf8'))) as Record<string, unknown>;
    } catch (e) {
      return emptyRoute('opencode', proxyUrl, `${path.basename(file)} is not valid JSON: ${(e as Error).message}`);
    }
    const model = typeof data.model === 'string' ? data.model : '';
    if (!model.includes('/')) return emptyRoute('opencode', proxyUrl, `${path.basename(file)} names no active model`);
    const provider = model.slice(0, model.indexOf('/'));
    const providers = data.provider && typeof data.provider === 'object' ? data.provider as Record<string, unknown> : {};
    const baseUrl = opencodeBaseUrl(providers[provider]);
    return {
      measured: true,
      failure: '',
      host: 'opencode',
      proxyUrl,
      model,
      provider,
      baseUrl,
      routed: baseUrl ? sameProxyEndpoint(baseUrl, proxyUrl) : false,
    };
  }
  return emptyRoute('opencode', proxyUrl, 'no opencode config found');
}

/** Whether the host's active model reaches the proxy. Unmeasured beats a guessed yes. */
export function readHeadroomRoute(host: string, proxyUrl: string = headroomProxyUrl()): HeadroomRoute {
  if (host === 'omp') return readOmpRoute(proxyUrl);
  if (host === 'opencode') return readOpencodeRoute(proxyUrl);
  return emptyRoute(host, proxyUrl, `${host} has no headroom route`);
}

/** One line for the dashboard and the prompt block. */
export function describeHeadroomRoute(route: HeadroomRoute): string {
  if (!route.measured) return `route unknown: ${route.failure}`;
  const via = route.provider ? ` via ${route.provider}` : '';
  const at = route.baseUrl ? ` at ${route.baseUrl}` : '';
  return route.routed ? `routed: ${route.model}${via}` : `not routed: ${route.model}${via}${at}`;
}
