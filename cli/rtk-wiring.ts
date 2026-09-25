// cli/rtk-wiring.ts — wire the installed rtk binary into OMP.
// `rtk init -g --agent omp` writes rtk's tool_call extension to
// ~/.omp/agent/extensions/rtk.ts, and we register that path in config.yml
// (OMP only loads listed extensions — rtk init does not register it).
// Once loaded, OMP rewrites bash commands to rtk before execution, so every
// rewritten call lands in rtk's history.db and shows metered savings.
// Fail-open: a failed wire only downgrades to manual `rtk` prefixing.
// Deliberately free of cli/common.ts imports (argv side effects) so tests
// can load it directly.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { homeDir, readTextIfExists, resolveRtkBinary } from '../extensions/lib/utils.ts';
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

// Idempotent: rtk rewrites its extension file on every init run, so
// reinstalling tersio refreshes the wiring for free.
export async function wireRtkOmp(rtkBin: string, options: WiringOptions = {}): Promise<boolean> {
  if (!options.dryRun) debugWire(options, 'Wiring rtk → OMP (bash tool_call rewrite)…');
  if (options.dryRun) return true;
  const wired = await runRtkInitAgent(rtkBin, 'omp');
  if (!wired) return false;
  await ensureRtkInConfig(options);
  return true;
}

// The rtk.ts path rtk init writes (mirrors OMP_AGENT_DIR in cli/common.ts
// without importing it — see header note on argv side effects).
function rtkExtensionPath(): string {
  return path.join(homeDir(), '.omp', 'agent', 'extensions', 'rtk.ts');
}

// OMP loads only listed extensions: append rtk.ts after the existing entries
// (or create the key) so a fresh wire takes effect on next OMP start.
export async function ensureRtkInConfig(options: WiringOptions): Promise<void> {
  const configPath = path.join(homeDir(), '.omp', 'agent', 'config.yml');
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

async function runRtkInitAgent(rtkBin: string, agent: string, extra: string[] = []): Promise<boolean> {
  const args = ['init', '-g', '--agent', agent, ...extra];
  try {
    await execFileP(rtkBin, args, 30000);
    return true;
  } catch (first) {
    // A freshly written binary can lose its first exec to macOS Gatekeeper
    // verification; give it one settle-and-retry before reporting failure.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    try {
      await execFileP(rtkBin, args, 30000);
      return true;
    } catch (e) {
      void first;
      console.log(`  [warn] could not wire rtk → ${agent}: ${shortWiringError(e)}`);
      console.log(`  [hint] Manual: rtk init -g --agent ${agent} (needs rtk >= 0.49)`);
      return false;
    }
  }
}

// Pi loads ~/.pi/agent/extensions/*.ts through jiti and has no JSON hook file at
// all, so the generic emitter cannot serve it: it would write a JSON object into
// a .ts path, which fails to parse and silently disables rewriting. `rtk init`
// writes the real extension, and the same file serves Pi and OMP.
const PI_EXT_DIR = ['.pi', 'agent', 'extensions'];

export async function wireRtkPi(rtkBin: string, options: WiringOptions = {}): Promise<boolean> {
  if (!options.dryRun) debugWire(options, 'Wiring rtk → Pi (bash tool_call rewrite)…');
  if (options.dryRun) return true;
  // rtk 0.49 added `--agent pi`. An older binary ignores the flag and writes an
  // OMP extension instead, which would look like success while leaving Pi
  // unwired — so check the advertised support before running it.
  if (!(await rtkSupportsAgent(rtkBin, 'pi'))) {
    console.log(`  [skip] ${rtkBin} has no --agent pi support — upgrade rtk, then run: rtk init -g --agent pi`);
    return false;
  }
  const ext = path.join(homeDir(), ...PI_EXT_DIR, 'rtk.ts');
  const present = await readTextIfExists(ext);
  // A Pi extension already on disk is ours to refresh, so overwrite it without
  // a prompt: rtk asks before replacing a non-stock file, which made a
  // reinstall hang or silently do nothing.
  const wired = await runRtkInitAgent(rtkBin, 'pi', present === null ? [] : ['--yes']);
  if (!wired) return false;
  if (!(await readTextIfExists(ext))) {
    console.log(`  [warn] rtk init --agent pi did not write ${ext}`);
    return false;
  }
  debugWire(options, 'rtk Pi extension wired');
  return true;
}

/** True when the binary's help lists `agent` among --agent's values. */
async function rtkSupportsAgent(rtkBin: string, agent: string): Promise<boolean> {
  try {
    const help = await execFileP(rtkBin, ['init', '--help'], 15000);
    return help.stdout.includes(agent);
  } catch {
    return false;
  }
}

// A Pi-only run installs no rtk binary of its own, so wire whatever rtk the
// machine already has. PATH is searched before the managed dir, so a Homebrew
// or custom install wires just as well as a tersio-managed one.
export function findRtk(): string | null {
  return resolveRtkBinary();
}
