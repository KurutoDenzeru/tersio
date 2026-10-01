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
export async function wireRtkOmp(rtkBin: string, options: WiringOptions = {}): Promise<boolean> {
  if (!options.dryRun) debugWire(options, 'Wiring rtk → OMP (bash tool_call rewrite)…');
  if (options.dryRun) return true;
  const wired = await runRtkInit(rtkBin, options);
  if (!wired) return false;
  await ensureRtkInConfig(options);
  return true;
}

// The rtk.ts path rtk init writes (OMP_AGENT_DIR inlined; see header note).
function rtkExtensionPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  return path.join(home, '.omp', 'agent', 'extensions', 'rtk.ts');
}

// Append rtk.ts after the existing entries (or create the key) so the wire
// takes effect on the next OMP start.
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

async function runRtkInit(rtkBin: string, options: WiringOptions): Promise<boolean> {
  try {
    await execFileP(rtkBin, ['init', '-g', '--agent', 'omp'], 30000);
    debugWire(options, 'rtk OMP extension wired');
    return true;
  } catch (first) {
    // A fresh binary can lose its first exec to macOS Gatekeeper, so settle and
    // retry once before reporting failure.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    try {
      await execFileP(rtkBin, ['init', '-g', '--agent', 'omp'], 30000);
      debugWire(options, 'rtk OMP extension wired');
      return true;
    } catch (e) {
      void first;
      console.log(`  [warn] could not wire rtk → OMP: ${shortWiringError(e)}`);
      console.log('  [hint] Manual: rtk init -g --agent omp (needs rtk >= 0.49)');
      return false;
    }
  }
}
