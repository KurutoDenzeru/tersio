// Headroom's durable agent integrations: the init targets headroom installs itself, plus the two config
// writers its `init` omits. Nothing here starts a proxy; headroom's own install does that.
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { homeDir } from './utils.ts';
import { HOST_CAPS, hostCap } from './host-caps.ts';
import { sqliteRead } from './sqlite.ts';

const execFileP = promisify(execFile);

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
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, profile, 'manifest.json'), 'utf8')) as Record<string, unknown>;
      const updated = typeof manifest.updated_at === 'string' ? manifest.updated_at : typeof manifest.created_at === 'string' ? manifest.created_at : '';
      if (!newest || updated > newest.updated) newest = { updated, manifest };
    } catch { /* a broken profile cannot name an upstream */ }
  }
  if (!newest) return null;
  const env = newest.manifest.base_env && typeof newest.manifest.base_env === 'object'
    ? newest.manifest.base_env as Record<string, unknown>
    : {};
  const args = Array.isArray(newest.manifest.proxy_args)
    ? newest.manifest.proxy_args.filter((arg): arg is string => typeof arg === 'string')
    : [];
  const anthropic = /anthropic/i.test(api);
  const flag = anthropic ? '--anthropic-api-url' : '--openai-api-url';
  const envKey = anthropic ? 'ANTHROPIC_TARGET_API_URL' : 'OPENAI_TARGET_API_URL';
  const at = args.indexOf(flag);
  const fromArgs = at >= 0 ? args[at + 1] : null;
  const fromEnv = typeof env[envKey] === 'string' ? env[envKey] as string : null;
  return fromArgs || fromEnv || null;
}

/** The port the rest of the system must write into a durable config. */
export function headroomProxyPort(): number {
  try {
    const port = new URL(headroomProxyUrl()).port;
    if (port) return Number(port);
  } catch { /* an invalid override falls back to headroom's default */ }
  return HEADROOM_PORT;
}

/** A headroom command's output, or an empty string: the caller decides what a failure means. */
async function headroomText(bin: string, args: string[], timeoutMs: number): Promise<string> {
  try {
    const run = await execFileP(bin, args, { timeout: timeoutMs });
    return String(run.stdout ?? '') + '\n' + String(run.stderr ?? '');
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return String(err.stdout ?? '') + '\n' + String(err.stderr ?? '');
  }
}

/** The agents headroom integrates durably, read from its own init help so upstream additions appear unprompted. */
export async function discoverInitTargets(bin: string, timeoutMs = 15_000): Promise<string[] | null> {
  const text = await headroomText(bin, ['init', '--help'], timeoutMs);
  // Scope from the Commands block on: option rows start with "-", so they cannot match.
  const section = text.slice(text.indexOf('Commands:'));
  const targets: string[] = [];
  for (const line of section.split('\n')) {
    const match = line.match(/^\s{2,}([a-z-]+)\s+Install\b/);
    if (match) targets.push(match[1]);
  }
  return targets.length > 0 ? targets : null;
}

/** The tools whose `wrap --help` registers a subcommand; a name outside the catalog never shows. */
export async function discoverWrapTargets(bin: string, timeoutMs = 15_000): Promise<Array<{ name: string; label: string }> | null> {
  const text = await headroomText(bin, ['wrap', '--help'], timeoutMs);
  const targets: Array<{ name: string; label: string }> = [];
  for (const line of text.split('\n')) {
    const match = line.match(/^\s{2,}headroom wrap ([a-z-]+)\s+#\s*(.+)$/);
    if (match) targets.push({ name: match[1], label: match[2].trim() });
  }
  return targets.length > 0 ? targets : null;
}

/** Headroom can write these two configs durably itself, though its `init` does not list them. */
export const DURABLE_CONFIG = Object.values(HOST_CAPS)
  .filter((cap) => cap.headroomDurable === true)
  .map((cap) => cap.id) as ReadonlyArray<'omp' | 'opencode'>;

/** The Tersio hosts headroom can route, with a writer or a hand-set provider endpoint. */
export function headroomHostSupported(host: string): boolean {
  return hostCap(host)?.headroom === true;
}

/** True when the host has a writer Tersio can run; the rest need a manual endpoint. */
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
  try { catalog = JSON.parse(raw.split('\t')[0]!); } catch { return null; }
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

/** OpenCode's config; the first that exists wins, matching headroom's own lookup order. */
export function opencodeConfigFiles(): string[] {
  return [path.join(homeDir(), '.config', 'opencode', 'opencode.json'), path.join(homeDir(), '.config', 'opencode', 'opencode.jsonc')];
}

/** True when headroom's own writer already installed the durable block for this tool. */
export function durableConfigInstalled(name: string): boolean {
  try {
    if (name === 'omp') return fs.readFileSync(ompModelsFile(), 'utf8').includes('managed by `headroom wrap omp`');
    if (name === 'opencode') {
      for (const file of opencodeConfigFiles()) {
        try {
          if (/"headroom"\s*:/.test(fs.readFileSync(file, 'utf8'))) return true;
        } catch { /* try the next path */ }
      }
    }
  } catch { /* absent */ }
  return false;
}

/** The Python behind the headroom console script; its durable writers live in that package, not in the CLI. */
function headroomPython(bin: string): string | null {
  try {
    const real = fs.realpathSync(bin);
    for (const name of process.platform === 'win32' ? ['python.exe', 'python3.exe'] : ['python3', 'python']) {
      const candidate = path.join(path.dirname(real), name);
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch { /* not a script with a sibling interpreter */ }
  return null;
}

/** Writes the durable block headroom's own wrap would write, without launching the tool. */
export async function installDurableConfig(bin: string, name: string, port: number = HEADROOM_PORT): Promise<boolean> {
  const python = headroomPython(bin);
  if (!python) return false;
  const call = name === 'omp'
    ? `from headroom.providers.omp.runtime import inject_models_override as f; f(${port})`
    : name === 'opencode'
      ? `from headroom.providers.opencode.config import inject_opencode_provider_config as f; f(${port})`
      : null;
  if (!call) return false;
  try {
    // Headroom's own module reads the same env and writes the same marker, backup, and unwrap record.
    execFileSync(python, ['-c', call], { timeout: 60_000, cwd: homeDir(), stdio: 'ignore', windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

export interface OmpGatewayRoute {
  provider: string;
  baseUrl: string;
  /** The active role's model, whose own endpoint beats the provider's when it names one. */
  model: string | null;
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
      current = { name: line.trim().slice(0, -1), api: '', baseUrl: '', marker: '', models: [], baseLine: -1, markerLine: null };
      continue;
    }
    // A model entry may sit at the provider's own indent, so a list item counts as one.
    if (current && (indent > 4 || line.trimStart().startsWith('- '))) {
      const match = line.trim().replace(/^-\s*/, '').match(/^id:\s*(.+)$/);
      if (match) current.models.push(match[1]!.trim().replace(/^['"]|['"]$/g, ''));
      continue;
    }
    if (!current || indent !== 4) continue;
    const trimmed = line.trim();
    if (trimmed.startsWith('api:')) current.api = trimmed.slice(4).trim();
    else if (trimmed.startsWith('baseUrl:')) {
      current.baseUrl = trimmed.slice(8).trim().replace(/^['"]|['"]$/g, '');
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

/** The local gateway the active model uses, or a route Tersio already wrote. */
export function readOmpGateway(port: number = HEADROOM_PORT): OmpGatewayRoute | null {
  let blocks: OmpProviderBlock[];
  let model: string | null = null;
  try {
    blocks = ompProviderBlocks(fs.readFileSync(ompModelsFile(), 'utf8'));
    try { model = defaultOmpModel(fs.readFileSync(ompConfigFile(), 'utf8')); } catch { /* no config */ }
  } catch {
    return null;
  }
  // The role's own provider carries the traffic, so another local gateway is left alone.
  const active = ompModelProvider(blocks, model);
  const ordered = [...blocks.filter((block) => block.name === active), ...blocks.filter((block) => block.name !== active)];
  for (const block of ordered) {
    if (block.name === 'anthropic') continue;
    if (block.marker && block.baseUrl === `http://127.0.0.1:${port}/v1`) {
      return { provider: block.name, baseUrl: block.marker, model };
    }
    if (!block.api.startsWith('openai') || !block.baseUrl) continue;
    try {
      const url = new URL(block.baseUrl);
      if (!loopbackHost(url.hostname) || Number(url.port || 80) === port) continue;
      return { provider: block.name, baseUrl: block.baseUrl, model };
    } catch { /* not a URL: leave it alone */ }
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
    const url = `http://127.0.0.1:${port}/v1`;
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

/** Route the provider omp's default role calls; a built-in provider with no block gets an override block. */
export function routeOmpDefaultModel(port: number = HEADROOM_PORT): boolean {
  let model: string | null = null;
  try { model = defaultOmpModel(fs.readFileSync(ompConfigFile(), 'utf8')); } catch { return false; }
  if (!model) return false;
  const file = ompModelsFile();
  let text: string;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return false; }
  const bare = model.replace(/:[^:]+$/, '');
  const slash = bare.indexOf('/');
  const provider = slash > 0 ? bare.slice(0, slash) : '';
  // A configured block is what routeOmpGateway moves; only a provider omp keeps built-in needs a new one.
  if (!provider || ompProviderNames(text).has(provider)) return true;
  const endpoint = ompCachedEndpoint(model);
  if (!endpoint || !endpoint.api.startsWith('openai')) return false;
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((line) => /^providers:\s*$/.test(line));
  if (at < 0) return false;
  lines.splice(at + 1, 0,
    `  ${endpoint.provider}:`,
    '    api: openai-completions',
    `    # tersio-headroom-upstream: ${endpoint.baseUrl}`,
    `    baseUrl: http://127.0.0.1:${port}/v1`,
  );
  try {
    fs.writeFileSync(file, lines.join('\n'), 'utf8');
  } catch {
    return false;
  }
  return true;
}
