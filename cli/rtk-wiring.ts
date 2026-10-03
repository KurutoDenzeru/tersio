// OMP loads only listed extensions, so register rtk's path; fail-open.
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

// Idempotent: rtk rewrites its file on every init run.
interface WireSpec {
  host: string;
  mechanism: string;
  initArgs: string[];
  hint: string;
}

async function runWire(rtkBin: string, spec: WireSpec, options: WiringOptions): Promise<boolean> {
  if (!options.dryRun) debugWire(options, `Wiring rtk → ${spec.host} (${spec.mechanism} rewrite)…`);
  if (options.dryRun) return true;
  try {
    await tryRtkInit(rtkBin, spec.initArgs);
  } catch (e) {
    console.log(`  [warn] could not wire rtk → ${spec.host}: ${shortWiringError(e)}`);
    console.log(`  [hint] Manual: ${spec.hint}`);
    return false;
  }
  return true;
}

export async function wireRtkOmp(rtkBin: string, options: WiringOptions = {}): Promise<boolean> {
  if (!(await runWire(rtkBin, { host: 'OMP', mechanism: 'bash tool_call', initArgs: ['init', '-g', '--agent', 'omp'], hint: 'rtk init -g --agent omp (needs rtk >= 0.49)' }, options))) return false;
  await ensureRtkInConfig(options);
  return true;
}

export async function wireRtkOpencode(rtkBin: string, options: WiringOptions = {}): Promise<boolean> {
  return runWire(rtkBin, { host: 'OpenCode', mechanism: 'tool.execute.before', initArgs: ['init', '-g', '--opencode'], hint: 'rtk init -g --opencode' }, options);
}

export async function wireRtkPi(rtkBin: string, options: WiringOptions = {}): Promise<boolean> {
  return runWire(rtkBin, { host: 'pi', mechanism: 'bash tool_call', initArgs: ['init', '-g', '--agent', 'pi'], hint: 'rtk init -g --agent pi' }, options);
}

// The rtk.ts path rtk init writes (OMP_AGENT_DIR inlined; see header note).
function rtkExtensionPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  return path.join(home, '.omp', 'agent', 'extensions', 'rtk.ts');
}

// Append rtk.ts after the existing entries (or create the key) so the wire takes effect on the next OMP start.
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

async function tryRtkInit(rtkBin: string, initArgs: string[]): Promise<void> {
  try {
    await execFileP(rtkBin, initArgs, 30000);
    return;
  } catch {
    // A fresh binary can lose its first exec to macOS Gatekeeper: settle, then retry once.
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
  await execFileP(rtkBin, initArgs, 30000);
}
