// Headroom's durable agent integrations: the init targets headroom installs itself, plus the two config
// writers its `init` omits. Nothing here starts a proxy; headroom's own install does that.
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { homeDir } from './utils.ts';

const execFileP = promisify(execFile);

/** Headroom's default proxy port, written into the durable config of the tools its init omits. */
export const HEADROOM_PORT = 8787;

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
export const DURABLE_CONFIG = ['omp', 'opencode'] as const;

/** The Tersio hosts headroom can route. Every other host has no durable integration to offer. */
export function headroomHostSupported(host: string): boolean {
  return (DURABLE_CONFIG as readonly string[]).includes(host);
}

/** omp's provider registry, honoring the relocation variable headroom's own helper reads. */
function ompModelsFile(): string {
  const moved = (process.env.PI_CODING_AGENT_DIR ?? '').trim();
  return path.join(moved || path.join(homeDir(), '.omp', 'agent'), 'models.yml');
}

/** OpenCode's config; the first that exists wins, matching headroom's own lookup order. */
function opencodeConfigFiles(): string[] {
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
