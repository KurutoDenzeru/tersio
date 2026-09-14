// cli/rtk-wiring.ts — wire the installed rtk binary into OMP.
// `rtk init -g --agent omp` writes rtk's tool_call extension to
// ~/.omp/agent/extensions/rtk.ts; OMP auto-loads it and rewrites bash
// commands to rtk before execution, so every rewritten call lands in
// rtk's history.db and shows metered savings in the gain dashboard.
// Fail-open: a failed wire only downgrades to manual `rtk` prefixing.
// Deliberately free of cli/common.ts imports (argv side effects) so tests
// can load it directly.
import { execFile } from 'node:child_process';

export interface WiringOptions {
  dryRun?: boolean;
  quiet?: boolean;
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
  if (!options.quiet) console.log('  Wiring rtk → OMP (bash tool_call rewrite)...');
  if (options.dryRun) {
    if (!options.quiet) console.log('  [dry-run] would run: rtk init -g --agent omp');
    return true;
  }
  try {
    await execFileP(rtkBin, ['init', '-g', '--agent', 'omp'], 30000);
    if (!options.quiet) console.log('  [ok] rtk OMP extension wired (~/.omp/agent/extensions/rtk.ts)');
    return true;
  } catch (first) {
    // A freshly written binary can lose its first exec to macOS Gatekeeper
    // verification; give it one settle-and-retry before reporting failure.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    try {
      await execFileP(rtkBin, ['init', '-g', '--agent', 'omp'], 30000);
      if (!options.quiet) console.log('  [ok] rtk OMP extension wired (~/.omp/agent/extensions/rtk.ts)');
      return true;
    } catch (e) {
      void first;
      console.log(`  [warn] could not wire rtk → OMP: ${shortWiringError(e)}`);
      console.log('  [hint] Manual: rtk init -g --agent omp (needs rtk >= 0.49)');
      return false;
    }
  }
}
