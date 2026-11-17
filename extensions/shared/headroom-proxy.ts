// Headroom's durable agent integrations: the config writers its own `init` does not cover, plus the
// omp model route. Nothing here starts a proxy; headroom's own install does that.
import fs from 'node:fs';
import path from 'node:path';
import { homeDir } from './utils.ts';
import { hostCap } from './host-caps.ts';
import { sqliteRead } from './sqlite.ts';

/** Headroom's default proxy port, written into the durable config of the tools its init omits. */
export const HEADROOM_PORT = 8787;

/** The URL every reader and writer uses; the override keeps tests and alternate installs off the default port. */
export function headroomProxyUrl(): string {
  return (process.env.TERSIO_HEADROOM_PROXY_URL ?? `http://127.0.0.1:${HEADROOM_PORT}/`).trim();
}

/** The upstream Headroom's saved deployment forwards to, or null when no manifest names one. */
export function headroomProxyUpstream(api: string, home: string = homeDir()): string | null {
  const dir = path.join(home, '.headroom', 'deploy');
  let profiles: string[];
  try {
    profiles = fs.readdirSync(dir);
  } catch {
    return null;
  }
  let newest: { updated: string; manifest: Record<string, unknown> } | null = null;
  for (const profile of profiles) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, profile, 'manifest.json'), 'utf8')) as Record<
        string,
        unknown
      >;
      const updated =
        typeof manifest.updated_at === 'string'
          ? manifest.updated_at
          : typeof manifest.created_at === 'string'
            ? manifest.created_at
            : '';
      if (!newest || updated > newest.updated) newest = { updated, manifest };
    } catch {
      /* a broken profile cannot name an upstream */
    }
  }
  if (!newest) return null;
  const env =
    newest.manifest.base_env && typeof newest.manifest.base_env === 'object'
      ? (newest.manifest.base_env as Record<string, unknown>)
      : {};
  const args = Array.isArray(newest.manifest.proxy_args)
    ? newest.manifest.proxy_args.filter((arg): arg is string => typeof arg === 'string')
    : [];
  const anthropic = /anthropic/i.test(api);
  const flag = anthropic ? '--anthropic-api-url' : '--openai-api-url';
  const envKey = anthropic ? 'ANTHROPIC_TARGET_API_URL' : 'OPENAI_TARGET_API_URL';
  const at = args.indexOf(flag);
  const fromArgs = at >= 0 ? args[at + 1] : null;
  const fromEnv = typeof env[envKey] === 'string' ? (env[envKey] as string) : null;
  return fromArgs || fromEnv || null;
}

/** The port the rest of the system must write into a durable config. */
export function headroomProxyPort(): number {
  try {
    const port = new URL(headroomProxyUrl()).port;
    if (port) return Number(port);
  } catch {
    /* an invalid override falls back to headroom's default */
  }
  return HEADROOM_PORT;
}

/** The Tersio hosts headroom can route, with a writer or a hand-set provider endpoint. */
export function headroomHostSupported(host: string): boolean {
  return hostCap(host)?.headroom === true;
}

/** True when the host's provider block lives in a file Tersio writes itself. */
export function headroomHostDurable(host: string): boolean {
  return hostCap(host)?.headroomDurable === true;
}

/** omp's agent state directory, honoring the relocation variable headroom's own helper reads. */
export function ompAgentDir(): string {
  const moved = (process.env.PI_CODING_AGENT_DIR ?? '').trim();
  return moved || path.join(homeDir(), '.omp', 'agent');
}

/** omp's provider registry. */
export function ompModelsFile(): string {
  return path.join(ompAgentDir(), 'models.yml');
}

/** Create a minimal models.yml when omp has none, so headroom routing has a file to write into. */
export function ensureOmpModelsFile(): string {
  const file = ompModelsFile();
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const scaffold = 'providers:\n';
  try {
    fs.writeFileSync(file, scaffold, { flag: 'wx', encoding: 'utf8' });
    return scaffold;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      return fs.readFileSync(file, 'utf8');
    }
    throw err;
  }
}

/** omp's model cache: the catalog it resolves a selector against, including its built-in providers. */
export function ompModelsDb(): string {
  return path.join(ompAgentDir(), 'models.db');
}

/** omp's `modelRoles` registry, which names the model each role runs. */
export function ompConfigFile(): string {
  return path.join(ompAgentDir(), 'config.yml');
}

/** omp's default role, with the effort suffix kept for display. */
export function defaultOmpModel(text: string): string | null {
  const block = text.match(/^modelRoles:\s*\n((?:[ \t]+[^\n]*\n?)+)/m)?.[1] ?? '';
  const match = block.match(/^[ \t]+default:\s*(.+?)\s*$/m);
  if (!match) return null;
  const value = match[1]!.trim();
  return (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
    ? value.slice(1, -1)
    : value;
}

export interface OmpCachedEndpoint {
  provider: string;
  api: string;
  baseUrl: string;
}

/** The endpoint omp's own model cache records for a selector: the provider a fresh session will call. */
export function ompCachedEndpoint(model: string): OmpCachedEndpoint | null {
  const bare = model.replace(/:[^:]+$/, '');
  const slash = bare.indexOf('/');
  const provider = slash > 0 ? bare.slice(0, slash) : '';
  if (!provider) return null;
  const id = bare.slice(provider.length + 1);
  let raw: string;
  try {
    const safe = provider.replace(/[^A-Za-z0-9._-]/g, '');
    raw = sqliteRead(ompModelsDb(), `select models from model_cache where provider_id = '${safe}'`).trim();
  } catch {
    return null;
  }
  if (!raw) return null;
  let catalog: unknown;
  try {
    catalog = JSON.parse(raw.split('\t')[0]!);
  } catch {
    return null;
  }
  if (!Array.isArray(catalog)) return null;
  for (const entry of catalog) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const entryId = typeof record.id === 'string' ? record.id : '';
    const selector = typeof record.selector === 'string' ? record.selector : '';
    if (entryId !== id && entryId !== bare && selector !== bare) continue;
    const baseUrl = typeof record.baseUrl === 'string' ? record.baseUrl : '';
    if (!baseUrl) continue;
    return { provider, api: typeof record.api === 'string' ? record.api : 'openai-completions', baseUrl };
  }
  return null;
}


/** Resolves the default endpoint for an entire provider directly from omp's model cache. */
export function ompCachedProviderEndpoint(provider: string): OmpCachedEndpoint | null {
  const safe = provider.replace(/[^A-Za-z0-9._-]/g, '');
  if (!safe) return null;
  let raw: string;
  try {
    raw = sqliteRead(
      ompModelsDb(),
      `select provider_id, models from model_cache where provider_id = '${safe}' or provider_id like '${safe}:%' limit 1`,
    ).trim();
  } catch {
    return null;
  }
  if (!raw) return null;
  const parts = raw.split('\t');
  const matchedProviderId = parts.length > 1 ? parts[0] : '';
  if (matchedProviderId && matchedProviderId !== safe && !matchedProviderId.startsWith(`${safe}:`)) return null;
  const catalogJson = parts.length > 1 ? parts[1] : parts[0];
  try {
    const catalog = JSON.parse(catalogJson);
    if (!Array.isArray(catalog) || catalog.length === 0) return null;
    const first = catalog[0];
    const baseUrl = typeof first?.baseUrl === 'string' ? first.baseUrl : '';
    if (!baseUrl) return null;
    const api = typeof first?.api === 'string' ? first.api : 'openai-completions';
    return { provider, api, baseUrl };
  } catch {
    return null;
  }
}

/** OpenCode's config; the first that exists wins, matching headroom's own lookup order. */
export function opencodeConfigFiles(): string[] {
  return [
    path.join(homeDir(), '.config', 'opencode', 'opencode.json'),
    path.join(homeDir(), '.config', 'opencode', 'opencode.jsonc'),
  ];
}

export interface OmpGatewayRoute {
  provider: string;
  baseUrl: string;
  /** The active role's model, whose own endpoint beats the provider's when it names one. */
  model: string | null;
}

/** Returns true when a provider offers models under more than one API dialect. */
export function ompProviderIsMultiDialect(provider: string): boolean {
  const safe = provider.replace(/[^A-Za-z0-9._-]/g, '');
  if (!safe) return false;
  try {
    const raw = sqliteRead(
      ompModelsDb(),
      `select models from model_cache where provider_id = '${safe}' or provider_id like '${safe}:%' limit 1`,
    ).trim();
    if (!raw) return false;
    const parts = raw.split('\t');
    const catalogJson = parts.length > 1 ? parts[1] : parts[0];
    if (!catalogJson) return false;
    const catalog = JSON.parse(catalogJson);
    if (!Array.isArray(catalog)) return false;
    const apis = new Set(catalog.map((m) => (typeof m?.api === 'string' ? m.api : '')));
    apis.delete('');
    return apis.size > 1;
  } catch {
    return false;
  }
}

function loopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

interface OmpProviderBlock {
  name: string;
  api: string;
  baseUrl: string;
  marker: string;
  /** The ids the block lists, so a role's model finds its own provider. */
  models: string[];
  baseLine: number;
  markerLine: number | null;
}

/** The path an API expects after the proxy root: Anthropic and Google Antigravity clients use root, OpenAI /v1. */
function proxyApiPath(api: string): '' | '/v1' {
  return /anthropic|google-gemini-cli/i.test(api) ? '' : '/v1';
}

export function isHeadroomCompatibleApi(api: string): boolean {
  return /anthropic|openai|google-gemini-cli/i.test(api);
}
/** The provider blocks in omp's models.yml, with line numbers for a surgical baseUrl rewrite. */
function ompProviderBlocks(text: string): OmpProviderBlock[] {
  const lines = text.split(/\r?\n/);
  const blocks: OmpProviderBlock[] = [];
  let current: OmpProviderBlock | null = null;
  const finish = (): void => {
    if (current) blocks.push(current);
    current = null;
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const indent = line.length - line.trimStart().length;
    if (indent === 2 && /^[^:\s][^:]*:\s*$/.test(line.trim())) {
      finish();
      current = {
        name: line.trim().slice(0, -1),
        api: '',
        baseUrl: '',
        marker: '',
        models: [],
        baseLine: -1,
        markerLine: null,
      };
      continue;
    }
    // A model entry may sit at the provider's own indent, so a list item counts as one.
    if (current && (indent > 4 || line.trimStart().startsWith('- '))) {
      const match = line
        .trim()
        .replace(/^-\s*/, '')
        .match(/^id:\s*(.+)$/);
      if (match) current.models.push(match[1]!.trim().replace(/^['"]|['"]$/g, ''));
      continue;
    }
    if (!current || indent !== 4) continue;
    const trimmed = line.trim();
    if (trimmed.startsWith('api:')) current.api = trimmed.slice(4).trim();
    else if (trimmed.startsWith('baseUrl:')) {
      current.baseUrl = trimmed
        .slice(8)
        .trim()
        .replace(/^['"]|['"]$/g, '');
      current.baseLine = i;
    } else if (trimmed.startsWith('# tersio-headroom-upstream:')) {
      current.marker = trimmed.slice('# tersio-headroom-upstream:'.length).trim();
      current.markerLine = i;
    }
  }
  finish();
  return blocks;
}

/** The provider names `models.yml` defines, so a caller can tell a configured block from omp's built-in one. */
export function ompProviderNames(text: string): Set<string> {
  return new Set(ompProviderBlocks(text).map((block) => block.name));
}

/** The block that lists the role's model, so a model id without a provider prefix still resolves. */
function ompModelProvider(blocks: OmpProviderBlock[], model: string | null): string {
  if (!model) return '';
  const prefixed = blocks.find((block) => model.startsWith(`${block.name}/`));
  const ids = new Set([model, model.replace(/:[^:]+$/, '')]);
  if (prefixed) {
    const rest = model.slice(prefixed.name.length + 1);
    ids.add(rest);
    ids.add(rest.replace(/:[^:]+$/, ''));
  }
  const owner = blocks.find((block) => block.models.some((id) => ids.has(id)));
  return owner ? owner.name : prefixed ? prefixed.name : '';
}

/** The API a block speaks; the official Anthropic block may omit it, and cached providers resolve from the catalog. */
function ompBlockApi(block: { name: string; api: string }): string {
  if (block.api) return block.api;
  const cached = ompCachedProviderEndpoint(block.name)?.api;
  if (cached) return cached;
  return block.name === 'anthropic' ? 'anthropic-messages' : '';
}

/** The local gateway the active model uses, or a route Tersio already wrote. */
export function readOmpGateway(port: number = HEADROOM_PORT): OmpGatewayRoute | null {
  let blocks: OmpProviderBlock[];
  let model: string | null = null;
  try {
    blocks = ompProviderBlocks(fs.readFileSync(ompModelsFile(), 'utf8'));
    try {
      model = defaultOmpModel(fs.readFileSync(ompConfigFile(), 'utf8'));
    } catch {
      /* no config */
    }
  } catch {
    return null;
  }
  // The role's own provider carries the traffic, so another local gateway is left alone.
  const active = ompModelProvider(blocks, model);
  const ordered = [
    ...blocks.filter((block) => block.name === active),
    ...blocks.filter((block) => block.name !== active),
  ];
  for (const block of ordered) {
    const api = ompBlockApi(block);
    const proxy = `http://127.0.0.1:${port}${proxyApiPath(api)}`;
    if (block.marker && block.baseUrl === proxy) {
      return { provider: block.name, baseUrl: block.marker, model };
    }
    if ((!isHeadroomCompatibleApi(api) && !/^(?:openai|anthropic)/.test(api)) || !block.baseUrl) continue;
    try {
      const url = new URL(block.baseUrl);
      if (!loopbackHost(url.hostname) || Number(url.port || 80) === port) continue;
      return { provider: block.name, baseUrl: block.baseUrl, model };
    } catch {
      /* not a URL: leave it alone */
    }
  }
  return null;
}

/** The line holding one model's own baseUrl inside the provider block, or null when it names none. */
function ompModelBaseLine(lines: string[], providerLine: number, model: string | null): number | null {
  if (!model) return null;
  const bare = model.slice(model.indexOf('/') + 1);
  const ids = new Set([model, model.replace(/:[^:]+$/, ''), bare, bare.replace(/:[^:]+$/, '')]);
  const ranges: Array<[number, number]> = [];
  let start = -1;
  for (let i = providerLine + 1; i < lines.length; i += 1) {
    const raw = lines[i]!;
    const trimmed = raw.trim();
    if (trimmed !== '' && raw.length - raw.trimStart().length <= 2) break;
    if (!trimmed.startsWith('- ')) continue;
    if (start >= 0) ranges.push([start, i]);
    start = i;
  }
  if (start >= 0) ranges.push([start, lines.length]);
  // A model block may name its endpoint before its id, so each entry is read whole.
  for (const [from, to] of ranges) {
    let id = '';
    let base = -1;
    for (let i = from; i < to; i += 1) {
      const raw = lines[i]!;
      const trimmed = raw.trim();
      if (!id) {
        const match = trimmed.replace(/^-\s*/, '').match(/^id:\s*(.+)$/);
        if (match) id = match[1]!.trim().replace(/^['"]|['"]$/g, '');
      }
      if (base < 0 && raw.length - raw.trimStart().length > 4 && trimmed.startsWith('baseUrl:')) base = i;
    }
    if (base >= 0 && ids.has(id)) return base;
  }
  return null;
}

/** Point omp's local OpenAI gateway at Headroom; Headroom itself forwards to the recorded URL. */
export function routeOmpGateway(route: OmpGatewayRoute, port: number = HEADROOM_PORT): boolean {
  const file = ompModelsFile();
  try {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    const block = ompProviderBlocks(lines.join('\n')).find((entry) => entry.name === route.provider);
    if (!block || block.baseLine < 0) return false;
    const indent = lines[block.baseLine]!.match(/^\s*/)?.[0] ?? '    ';
    const url = `http://127.0.0.1:${port}${proxyApiPath(ompBlockApi(block))}`;
    const fresh = block.marker !== route.baseUrl && block.markerLine === null;
    if (fresh) lines.splice(block.baseLine, 0, `${indent}# tersio-headroom-upstream: ${route.baseUrl}`);
    const baseLine = block.baseLine + (fresh ? 1 : 0);
    lines[baseLine] = `${indent}baseUrl: ${url}`;
    // A model entry that names its own endpoint never reaches the provider line, so it moves too.
    const modelLine = ompModelBaseLine(lines, baseLine, route.model);
    if (modelLine !== null) {
      const modelIndent = lines[modelLine]!.match(/^\s*/)?.[0] ?? '      ';
      lines[modelLine] = `${modelIndent}baseUrl: ${url}`;
    }
    fs.writeFileSync(file, lines.join('\n'), 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Put back the endpoints Tersio moved in omp's models file and drop the markers it wrote. Only a line
 * still pointing at this proxy is restored, so a provider the user changed afterwards is left alone.
 */
export function restoreOmpGateway(port: number = HEADROOM_PORT): boolean {
  const file = ompModelsFile();
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return false;
  }
  const lines = text.split(/\r?\n/);
  const drop = new Set<number>();
  let changed = false;
  for (const block of ompProviderBlocks(text)) {
    if (!block.marker || block.markerLine === null || block.baseLine < 0) continue;
    const proxy = `http://127.0.0.1:${port}${proxyApiPath(ompBlockApi(block))}`;
    if (block.baseUrl !== proxy) continue;
    const indent = lines[block.baseLine]!.match(/^\s*/)?.[0] ?? '    ';
    lines[block.baseLine] = `${indent}baseUrl: ${block.marker}`;
    drop.add(block.markerLine);
    // A model entry that names its own endpoint was moved too, and shares the marker's original.
    for (let i = block.baseLine + 1; i < lines.length; i += 1) {
      const raw = lines[i]!;
      const trimmed = raw.trim();
      if (trimmed !== '' && raw.length - raw.trimStart().length <= 2) break;
      if (trimmed.startsWith('baseUrl:') && trimmed.includes(`127.0.0.1:${port}`)) {
        lines[i] = `${raw.match(/^\s*/)?.[0] ?? '      '}baseUrl: ${block.marker}`;
      }
    }
    changed = true;
  }
  if (!changed) return false;
  try {
    fs.writeFileSync(file, lines.filter((_, index) => !drop.has(index)).join('\n'), 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** Route the providers omp calls across roles and fallbacks; built-in providers with no block get override blocks. */
export function routeOmpDefaultModel(port: number = HEADROOM_PORT): boolean {
  let configText = '';
  try {
    configText = fs.readFileSync(ompConfigFile(), 'utf8');
  } catch {
    return false;
  }
  const defaultModel = defaultOmpModel(configText);
  if (!defaultModel) return false;
  try {
    ensureOmpModelsFile();
  } catch {
    return false;
  }

  // Collect all models referenced across modelRoles and fallback chains, default first
  const models = [defaultModel];
  const matches = configText.matchAll(/(?:^|\n)\s*(?:[a-zA-Z0-9_-]+:|-)\s*['"]?([a-zA-Z0-9_-]+\/[a-zA-Z0-9._:/-]+)['"]?/g);
  for (const m of matches) {
    const val = m[1]?.trim();
    if (val && !models.includes(val)) models.push(val);
  }

  let routedAny = false;
  for (const model of models) {
    if (routeOmpModel(model, port)) routedAny = true;
  }
  return routedAny;
}

/** Route any given omp model or provider to Headroom, discovering its endpoint dynamically from the catalog. */
export function routeOmpModel(model: string, port: number = HEADROOM_PORT): boolean {
  const bare = model.replace(/:[^:]+$/, '');
  const slash = bare.indexOf('/');
  const file = ompModelsFile();
  let text: string;
  try {
    text = ensureOmpModelsFile();
  } catch {
    return false;
  }

  const provider = slash > 0 ? bare.slice(0, slash) : bare;
  if (!provider) return false;
  if (ompProviderNames(text).has(provider)) {
    const block = ompProviderBlocks(text).find((b) => b.name === provider);
    if (block && block.baseUrl && block.baseLine >= 0) {
      const api = ompBlockApi(block);
      if (!isHeadroomCompatibleApi(api)) return false;
      const proxy = `http://127.0.0.1:${port}${proxyApiPath(api)}`;
      if (block.baseUrl !== proxy) {
        return routeOmpGateway({ provider, baseUrl: block.marker || block.baseUrl, model: slash > 0 ? model : null }, port);
      }
    }
    return true;
  }

  const endpoint = (slash > 0 ? ompCachedEndpoint(model) : null) ?? ompCachedProviderEndpoint(provider);
  if (!endpoint || !isHeadroomCompatibleApi(endpoint.api)) return false;

  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((line) => /^providers:\s*$/.test(line));
  if (at < 0) return false;
  const baseUrl = `http://127.0.0.1:${port}${proxyApiPath(endpoint.api)}`;
  const blockLines = [`  ${endpoint.provider}:`];
  // Omit provider-level api override when the provider serves multiple dialects (e.g. commandcode, openai).
  if (!ompProviderIsMultiDialect(endpoint.provider)) {
    blockLines.push(`    api: ${endpoint.api}`);
  }
  blockLines.push(
    `    # tersio-headroom-upstream: ${endpoint.baseUrl}`,
    `    baseUrl: ${baseUrl}`,
  );
  lines.splice(at + 1, 0, ...blockLines);
  try {
    fs.writeFileSync(file, lines.join('\n'), 'utf8');
    return true;
  } catch {
    return false;
  }
}
