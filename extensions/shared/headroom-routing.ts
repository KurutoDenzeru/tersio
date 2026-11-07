// Whether the model the agent will call reaches Headroom's proxy. A live proxy with an unrouted
// model compresses nothing, so the session block must stay out until this answer is yes.

import fs from 'node:fs';
import path from 'node:path';
import { defaultOmpModel, headroomProxyUrl, ompCachedEndpoint, ompConfigFile, ompModelsFile, ompProviderNames, opencodeConfigFiles } from './headroom-proxy.ts';
import { piCatalogEndpoint } from './headroom-agent.ts';

export { defaultOmpModel };
import { homeDir, piAgentDir, pigAgentDir } from './utils.ts';

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
  if (found) return found;
  // A provider-prefixed id resolves by the block's name even when the block lists no models of its own.
  const prefix = bare.includes('/') ? bare.slice(0, bare.indexOf('/')) : '';
  return prefix ? ompBlockEndpoint(text, prefix) : null;
}

/** The provider-level baseUrl of one block, or null when the block names none. */
export function ompBlockEndpoint(text: string, name: string): OmpEndpoint | null {
  let provider: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = indentOf(line);
    if (indent === 2 && /^[^:\s][^:]*:\s*$/.test(trimmed)) {
      provider = unquote(trimmed.slice(0, -1));
      continue;
    }
    if (provider !== name || indent !== 4 || !trimmed.startsWith('baseUrl:')) continue;
    return { provider, baseUrl: valueOf(trimmed) };
  }
  return null;
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

/** A provider or model block's endpoint, in the key spelling its host accepts. */
export function jsonBaseUrl(record: Record<string, unknown>): string | null {
  for (const key of ['baseUrl', 'baseURL', 'base_url']) {
    if (typeof record[key] === 'string') return record[key] as string;
  }
  return null;
}

/** The entry an active model id names, so a model-level endpoint is never missed. */
export function jsonModelEntry(record: Record<string, unknown>, model: string, provider: string): Record<string, unknown> | null {
  const list = Array.isArray(record.models) ? record.models : [];
  const ids = new Set([model, model.replace(/:[^:]+$/, '')]);
  if (provider && model.startsWith(`${provider}/`)) {
    const rest = model.slice(provider.length + 1);
    ids.add(rest);
    ids.add(rest.replace(/:[^:]+$/, ''));
  }
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    if (typeof item.id === 'string' && ids.has(item.id)) return item;
  }
  return null;
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

/** The provider omp will call: a configured block wins, then its own cached catalog, then the block listing the id. */
function ompResolvedEndpoint(models: string, model: string): OmpEndpoint | null {
  const bare = model.replace(/:[^:]+$/, '');
  const slash = bare.indexOf('/');
  const prefix = slash > 0 ? bare.slice(0, slash) : '';
  if (prefix && ompProviderNames(models).has(prefix)) {
    const listed = ompModelRoute(models, model);
    // A block that names the provider owns it; another block merely listing the id does not.
    if (listed?.provider === prefix) return listed;
    return ompBlockEndpoint(models, prefix) ?? listed;
  }
  const cached = ompCachedEndpoint(model);
  if (cached) return { provider: cached.provider, baseUrl: cached.baseUrl };
  return ompModelRoute(models, model);
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
  const endpoint = ompResolvedEndpoint(models, model);
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

/**
 * OpenCode V2 keeps the endpoint under `providers.<id>.settings`; V1 under `provider.<id>.api` or its
 * `options`. Both are read, so a config that has not been migrated still reports its real endpoint.
 */
function opencodeBaseUrl(provider: unknown): string | null {
  if (!provider || typeof provider !== 'object') return null;
  const record = provider as Record<string, unknown>;
  const settings = record.settings && typeof record.settings === 'object' ? record.settings as Record<string, unknown> : {};
  const options = record.options && typeof record.options === 'object' ? record.options as Record<string, unknown> : {};
  if (typeof settings.baseURL === 'string') return settings.baseURL;
  for (const key of ['baseURL', 'baseUrl', 'base_url']) {
    if (typeof options[key] === 'string') return options[key] as string;
    if (typeof record[key] === 'string') return record[key] as string;
  }
  // V1 names the endpoint `api`; it doubles as the dialect, which is why it is checked last.
  return typeof record.api === 'string' ? record.api : null;
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
    const map = data.providers ?? data.provider;
    const providers = map && typeof map === 'object' ? map as Record<string, unknown> : {};
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

/** Pi and PiG keep the active provider beside the model list; both use the same shape. */
export function piRouteFrom(settingsText: string, modelsText: string, host: string, proxyUrl: string): HeadroomRoute {
  let settings: Record<string, unknown>;
  let models: Record<string, unknown>;
  try {
    settings = JSON.parse(settingsText) as Record<string, unknown>;
    models = JSON.parse(modelsText) as Record<string, unknown>;
  } catch (e) {
    return emptyRoute(host, proxyUrl, `settings are not valid JSON: ${(e as Error).message}`);
  }
  const model = typeof settings.defaultModel === 'string' ? settings.defaultModel : '';
  const named = typeof settings.defaultProvider === 'string' ? settings.defaultProvider : '';
  const provider = named || (model.includes('/') ? model.slice(0, model.indexOf('/')) : '');
  if (!provider) return emptyRoute(host, proxyUrl, 'settings name no default provider');
  const providers = models.providers && typeof models.providers === 'object' ? models.providers as Record<string, unknown> : {};
  const entry = providers[provider];
  const record = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
  const modelEntry = jsonModelEntry(record, model, provider);
  const baseUrl = (modelEntry ? jsonBaseUrl(modelEntry) : null) ?? jsonBaseUrl(record);
  return {
    measured: true,
    failure: '',
    host,
    proxyUrl,
    model,
    provider,
    baseUrl,
    routed: baseUrl ? sameProxyEndpoint(baseUrl, proxyUrl) : false,
  };
}

export interface DshProvider {
  name: string;
  api: string;
  baseUrl: string;
  /** The zero-based line that holds `baseURL`, or -1 when the block has none. */
  baseLine: number;
}

/** A small YAML read for dsh's provider blocks, in file order. */
export function dshProviders(text: string): DshProvider[] {
  const out: DshProvider[] = [];
  const lines = text.split(/\r?\n/);
  let inLlm = false;
  let inProviders = false;
  let providerIndent = -1;
  let current: DshProvider | null = null;
  let api = '';
  const finish = (): void => {
    if (current) out.push(current);
    current = null;
    api = '';
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = indentOf(line);
    if (trimmed.startsWith('- id:')) {
      // The next loader entry ends this plugin's block.
      if (inLlm && inProviders) break;
      if (/^-\s*id:\s*llm-pi-ai\b/.test(trimmed)) inLlm = true;
      continue;
    }
    if (!inLlm) {
      if (trimmed === 'llm-pi-ai:') inLlm = true;
      continue;
    }
    if (trimmed === 'providers:') {
      inProviders = true;
      providerIndent = indent + 2;
      finish();
      continue;
    }
    if (!inProviders) continue;
    if (indent < providerIndent) {
      finish();
      inProviders = false;
      continue;
    }
    if (indent === providerIndent && /^[^:\s][^:]*:\s*$/.test(trimmed)) {
      finish();
      current = { name: unquote(trimmed.slice(0, -1)), api: '', baseUrl: '', baseLine: -1 };
      continue;
    }
    if (!current) continue;
    if (indent === providerIndent + 2 && trimmed.startsWith('api:')) {
      api = unquote(trimmed.slice('api:'.length).replace(/\s+#.*$/, '').trim());
      current.api = api;
    } else if (indent === providerIndent + 2 && trimmed.startsWith('baseURL:')) {
      current.baseUrl = valueOf(trimmed)?.replace(/\s+#.*$/, '') ?? '';
      current.baseLine = i;
    }
  }
  finish();
  return out;
}

/** A small YAML read for dsh's provider block: provider name to baseURL. */
export function dshProviderBaseUrls(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const provider of dshProviders(text)) {
    if (provider.baseUrl) out.set(provider.name, provider.baseUrl);
  }
  return out;
}

/** The provider and model the desktop or web profile starts with. */
export function dshDefaultRoute(profileText: string): { provider: string; model: string } {
  let active = false;
  let provider = '';
  let model = '';
  for (const line of profileText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- id:')) {
      active = trimmed.slice('- id:'.length).replace(/\s+#.*$/, '').trim() === 'agent-default-model';
      continue;
    }
    if (!active) continue;
    if (trimmed.startsWith('provider:')) provider = unquote(trimmed.slice('provider:'.length).replace(/\s+#.*$/, '').trim());
    else if (trimmed.startsWith('model:')) model = unquote(trimmed.slice('model:'.length).replace(/\s+#.*$/, '').trim());
  }
  return { provider, model };
}

/** DeepSeek Harness reads one provider block and one profile default, both plain YAML. */
export function dshRouteFrom(settingsText: string, profileText: string, proxyUrl: string): HeadroomRoute {
  const providers = dshProviderBaseUrls(settingsText);
  // A profile patch overrides the shared settings, so its provider blocks win.
  for (const [name, baseUrl] of dshProviderBaseUrls(profileText)) providers.set(name, baseUrl);
  if (providers.size === 0) return emptyRoute('dsh', proxyUrl, 'settings name no llm-pi-ai providers');
  const { provider, model } = dshDefaultRoute(profileText);
  if (!provider) return emptyRoute('dsh', proxyUrl, 'the active dsh profile names no default provider');
  const baseUrl = providers.get(provider) ?? null;
  return {
    measured: true,
    failure: '',
    host: 'dsh',
    proxyUrl,
    model,
    provider,
    baseUrl,
    routed: baseUrl ? sameProxyEndpoint(baseUrl, proxyUrl) : false,
  };
}

function readPiRoute(host: 'pi' | 'pig', proxyUrl: string): HeadroomRoute {
  const dir = host === 'pig' ? pigAgentDir() : piAgentDir();
  try {
    const route = piRouteFrom(
      fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'),
      fs.readFileSync(path.join(dir, 'models.json'), 'utf8'),
      host,
      proxyUrl,
    );
    // A provider the host keeps in its own catalog still has a real endpoint, so the reader shows it.
    if (!route.measured || route.baseUrl || !route.provider) return route;
    const catalog = piCatalogEndpoint(dir, route.provider, route.model);
    if (!catalog) return route;
    return { ...route, baseUrl: catalog.baseUrl, routed: sameProxyEndpoint(catalog.baseUrl, proxyUrl) };
  } catch (e) {
    return emptyRoute(host, proxyUrl, (e as Error).message);
  }
}

/**
 * The profile files to read and write, most likely first. The running harness names its profile;
 * otherwise the CLI profile wins, because the desktop app owns its own and refuses CLI writes.
 */
export function dshProfileFiles(root: string = path.join(homeDir(), '.dsh')): string[] {
  const named = (process.env.DSH_PROFILE ?? '').trim();
  const order = named === 'web' || named === 'desktop' ? [named, named === 'web' ? 'desktop' : 'web'] : ['web', 'desktop'];
  return order
    .map((profile) => path.join(root, 'profiles', profile, 'cordis.patch.yml'))
    .filter((file) => fs.existsSync(file));
}

function readDshRoute(proxyUrl: string): HeadroomRoute {
  let settings: string;
  try {
    settings = fs.readFileSync(path.join(homeDir(), '.dsh', 'settings.yaml'), 'utf8');
  } catch (e) {
    return emptyRoute('dsh', proxyUrl, (e as Error).message);
  }
  for (const file of dshProfileFiles()) {
    try {
      return dshRouteFrom(settings, fs.readFileSync(file, 'utf8'), proxyUrl);
    } catch { /* try the next profile */ }
  }
  return emptyRoute('dsh', proxyUrl, 'no dsh profile found');
}

const ROUTE_READERS: Record<string, (proxyUrl: string) => HeadroomRoute> = {
  omp: readOmpRoute,
  opencode: readOpencodeRoute,
  pi: (proxyUrl) => readPiRoute('pi', proxyUrl),
  pig: (proxyUrl) => readPiRoute('pig', proxyUrl),
  dsh: readDshRoute,
};

/** Whether the host's active model reaches the proxy. Unmeasured beats a guessed yes. */
export function readHeadroomRoute(host: string, proxyUrl: string = headroomProxyUrl()): HeadroomRoute {
  const reader = ROUTE_READERS[host];
  return reader ? reader(proxyUrl) : emptyRoute(host, proxyUrl, `${host} has no headroom route`);
}

/** One line for the dashboard and the prompt block. */
export function describeHeadroomRoute(route: HeadroomRoute): string {
  if (!route.measured) return `route unknown: ${route.failure}`;
  const via = route.provider ? ` via ${route.provider}` : '';
  const at = route.baseUrl ? ` at ${route.baseUrl}` : '';
  return route.routed ? `routed: ${route.model}${via}` : `not routed: ${route.model}${via}${at}`;
}
