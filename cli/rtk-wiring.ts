// cli/rtk-wiring.ts — wire the installed rtk binary into OMP.
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
export interface WiringOptions {
  dryRun?: boolean;
  quiet?: boolean;
  verbose?: boolean;
}

function debugWire(options: WiringOptions, msg: string): void {
  if (!options.quiet) console.log(`  ${msg}`);
}

function shortWiringError(e: unknown): string {
  const err = e as Error & { stderr?: string; code?: string | number; signal?: string };
  const why = [err.code !== undefined ? `code ${err.code}` : '', err.signal ?? '', err.stderr?.trim(), err.message]
    .filter(Boolean).join(' · ');
  return why.slice(0, 200);
}

function execFileP(cmd: string, args: string[], timeout: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) {
        (err as Error & { stderr?: string }).stderr = String(stderr || '');
        reject(err);
      } else {
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      }
    });
  });
}

// Idempotent: rtk rewrites its extension file on every init run, so reinstalling tersio refreshes the wiring for free.
export async function wireRtkOmp(rtkBin: string, options: WiringOptions = {}): Promise<boolean> {
  return wireRtkAgent(rtkBin, 'omp', options);
}

// The rtk.ts path rtk init writes (mirrors OMP_AGENT_DIR in cli/common.ts without importing it — see header note on argv...
function rtkExtensionPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  return path.join(home, '.omp', 'agent', 'extensions', 'rtk.ts');
}

// OMP loads only listed extensions: append rtk.ts after the existing entries (or create the key) so a fresh wire takes...
export async function ensureRtkInConfig(options: WiringOptions): Promise<void> {
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  const configPath = path.join(home, '.omp', 'agent', 'config.yml');
  const extPath = rtkExtensionPath().replace(/\\/g, '/');
  let raw: string | null = null;
  try {
    raw = await fs.readFile(configPath, 'utf8');
  } catch {
    return;
  }
  if (raw.includes(extPath)) {
    debugWire(options, 'rtk already in config.yml');
    return;
  }
  const lines = raw.split('\n');
  const keyIdx = lines.findIndex((l) => /^\s*extensions\s*:/i.test(l));
  const line = `  - ${extPath}`;
  if (keyIdx === -1) {
    lines.push('extensions:', line, '');
  } else {
    if (/^\s*extensions\s*:\s*(?:\[\s*\]|null|~)?\s*$/i.test(lines[keyIdx])) lines[keyIdx] = 'extensions:';
    lines.splice(keyIdx + 1, 0, line);
  }
  try {
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.copyFile(configPath, `${configPath}.bak`).catch(() => { });
    await fs.writeFile(configPath, lines.join('\n'), 'utf8');
    debugWire(options, 'rtk registered in config.yml');
  } catch (e) {
    console.log(`  [warn] could not register rtk in config.yml: ${(e as Error).message}`);
  }
}

// rtk's own init owns the extension format for the hosts it supports, so tersio delegates rather than writing its own.
const RTK_AGENTS = { omp: 'omp', pi: 'pi' } as const;

export type RtkAgent = (typeof RTK_AGENTS)[keyof typeof RTK_AGENTS];

// The rtk agent name for a host tersio delegates wiring to, if any.
export function rtkAgentFor(hostId: string): RtkAgent | null {
  const agent = (RTK_AGENTS as Record<string, RtkAgent | undefined>)[hostId];
  return agent ?? null;
}

// Wires a host whose rewrite is an rtk-owned extension file. Fails open.
export async function wireRtkAgent(rtkBin: string, agent: RtkAgent, options: WiringOptions = {}): Promise<boolean> {
  if (!options.dryRun) debugWire(options, `Wiring rtk → ${agent} (bash tool_call rewrite)…`);
  if (options.dryRun) return true;
  const wired = await runRtkInit(rtkBin, agent, options);
  if (!wired) return false;
  if (agent === 'omp') await ensureRtkInConfig(options);
  return true;
}

export async function wireRtkPi(rtkBin: string, options: WiringOptions = {}): Promise<boolean> {
  return wireRtkAgent(rtkBin, 'pi', options);
}

// The Pi extension rtk's own init writes. Home-passed (rather than reading `$HOME` like `rtkExtensionPath` above) so...
export function piRtkExtensionPath(home: string): string {
  const relocated = process.env.PI_CODING_AGENT_DIR;
  const base = relocated && relocated.trim() !== ''
    ? relocated
    : path.join(home, '.pi', 'agent');
  return path.join(base, 'extensions', 'rtk.ts');
}

// Removes Pi's rtk wiring, so a Pi uninstall does not leave the rewrite live and Pi keeps rewriting after tersio is gone.
export async function removePiRtk(home: string, options: WiringOptions = {}): Promise<boolean> {
  const target = piRtkExtensionPath(home);
  let found = false;
  try {
    await fs.access(target);
    found = true;
  } catch { /* absent is the normal case */ }
  if (!found) return false;
  const shown = target.replace(`${home}/`, '~/');
  if (!options.quiet) console.log(`  ${options.dryRun ? '[dry-run] would remove' : '[rm]'} ${shown}`);
  if (!options.dryRun) await fs.rm(target, { force: true });
  return true;
}

async function runRtkInit(rtkBin: string, agent: RtkAgent, options: WiringOptions): Promise<boolean> {
  try {
    await execFileP(rtkBin, ['init', '-g', '--agent', agent], 30000);
    debugWire(options, `rtk ${agent} extension wired`);
    return true;
  } catch (first) {
    // A freshly written binary can lose its first exec to macOS Gatekeeper verification;
    await new Promise((resolve) => setTimeout(resolve, 2000));
    try {
      await execFileP(rtkBin, ['init', '-g', '--agent', 'omp'], 30000);
      debugWire(options, 'rtk OMP extension wired');
      return true;
    } catch (e) {
      void first;
      console.log(`  [warn] could not wire rtk → ${agent}: ${shortWiringError(e)}`);
      console.log(`  [hint] Manual: rtk init -g --agent ${agent} (needs rtk >= 0.49)`);
      return false;
    }
  }
}
