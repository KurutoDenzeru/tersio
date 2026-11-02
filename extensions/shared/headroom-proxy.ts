// Headroom's durable agent integrations: the init targets headroom installs itself, plus the two config
// writers its `init` omits. Nothing here starts a proxy; headroom's own install does that.
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { homeDir } from './utils.ts';
import { HOST_CAPS, hostCap } from './host-caps.ts';

const execFileP = promisify(execFile);

/** Headroom's default proxy port, written into the durable config of the tools its init omits. */
export const HEADROOM_PORT = 8787;

/** The URL every reader and writer uses; the override keeps tests and alternate installs off the default port. */
export function headroomProxyUrl(): string {
  return (process.env.TERSIO_HEADROOM_PROXY_URL ?? `http://127.0.0.1:${HEADROOM_PORT}/`).trim();
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
export const DURABLE_CONFIG = Object.values(HOST_CAPS).filter((cap) => cap.headroom).map((cap) => cap.id) as ReadonlyArray<'omp' | 'opencode'>;

/** The Tersio hosts headroom can route. Every other host has no durable integration to offer. */
export function headroomHostSupported(host: string): boolean {
  return hostCap(host)?.headroom === true;
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

/** omp's `modelRoles` registry, which names the model each role runs. */
export function ompConfigFile(): string {
  return path.join(ompAgentDir(), 'config.yml');
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
}

function loopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

interface OmpProviderBlock {
  name: string;
  api: string;
  baseUrl: string;
  marker: string;
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
      current = { name: line.trim().slice(0, -1), api: '', baseUrl: '', marker: '', baseLine: -1, markerLine: null };
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

/** The local OpenAI-compatible gateway omp uses, or a route Tersio already wrote. */
export function readOmpGateway(port: number = HEADROOM_PORT): OmpGatewayRoute | null {
  try {
    const blocks = ompProviderBlocks(fs.readFileSync(ompModelsFile(), 'utf8'));
    for (const block of blocks) {
      if (block.name === 'anthropic') continue;
      if (block.marker && block.baseUrl === `http://127.0.0.1:${port}/v1`) {
        return { provider: block.name, baseUrl: block.marker };
      }
      if (!block.api.startsWith('openai') || !block.baseUrl) continue;
      try {
        const url = new URL(block.baseUrl);
        if (!loopbackHost(url.hostname) || Number(url.port || 80) === port) continue;
        return { provider: block.name, baseUrl: block.baseUrl };
      } catch { /* not a URL: leave it alone */ }
    }
  } catch { /* no models.yml */ }
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
    const marker = `${indent}# tersio-headroom-upstream: ${route.baseUrl}`;
    if (block.marker !== route.baseUrl && block.markerLine === null) lines.splice(block.baseLine, 0, marker);
    const baseLine = block.baseLine + (block.markerLine === null && block.marker !== route.baseUrl ? 1 : 0);
    lines[baseLine] = `${indent}baseUrl: http://127.0.0.1:${port}/v1`;
    fs.writeFileSync(file, lines.join('\n'), 'utf8');
    return true;
  } catch {
    return false;
  }
}
