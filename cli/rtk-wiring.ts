// RTK owns its own host wiring: one `rtk init -g --agent <name>` writes the hook and registers it.
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { piAgentDir, pigAgentDir, shimCommand } from '../extensions/shared/utils.ts';
import { hostCap } from '../extensions/shared/host-caps.ts';
import type { HostId } from '../extensions/shared/host-caps.ts';

export interface WiringOptions {
  dryRun?: boolean;
  quiet?: boolean;
  verbose?: boolean;
}

function shortError(e: unknown): string {
  const err = e as Error & { stderr?: string; code?: string | number; signal?: string };
  return [err.code !== undefined ? `code ${err.code}` : '', err.signal ?? '', err.stderr?.trim(), err.message]
    .filter(Boolean).join(' · ').slice(0, 200);
}

function run(cmd: string, args: string[], timeout: number): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const shim = shimCommand(cmd, args);
  execFile(shim.cmd, shim.args, { timeout, encoding: 'utf8' }, (err, _stdout, stderr) => {
    if (err) {
      (err as Error & { stderr?: string }).stderr = String(stderr || '');
      reject(err);
    } else resolve();
  });
  return promise;
}

async function init(rtkBin: string, agent: string): Promise<void> {
  try {
    await run(rtkBin, ['init', '-g', '--agent', agent], 30_000);
  } catch {
    // A fresh binary can lose its first exec to macOS Gatekeeper: settle, then retry once.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await run(rtkBin, ['init', '-g', '--agent', agent], 30_000);
  }
}

async function copyPiHook(source: HostId, options: WiringOptions): Promise<boolean> {
  const from = path.join(source === 'pig' ? pigAgentDir() : piAgentDir(), 'extensions', 'rtk.ts');
  const to = path.join(pigAgentDir(), 'extensions', 'rtk.ts');
  if (!existsSync(from)) return true;
  try {
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to);
    return true;
  } catch (e) {
    if (!options.quiet) console.log(`  [warn] could not copy the rtk hook to PiG: ${shortError(e)}`);
    return false;
  }
}

/** One host's RTK binding. OpenCode's rewrite rides inside the Tersio plugin. */
export async function wireRtk(rtkBin: string, host: HostId, options: WiringOptions = {}): Promise<boolean> {
  const cap = hostCap(host);
  if (cap?.rtkPlugin) {
    if (!options.dryRun && !options.quiet) console.log('  RTK — no separate entry; the Tersio plugin owns the rewrite');
    return existsSync(rtkBin);
  }
  const agent = cap?.rtkAgent;
  if (!agent) return false;
  if (options.dryRun) {
    if (!options.quiet) console.log(`  RTK — would run: rtk init -g --agent ${agent}`);
    return true;
  }
  if (!options.quiet) console.log(`  RTK — bind ${host} with rtk init -g --agent ${agent}`);
  try {
    await init(rtkBin, agent);
  } catch (e) {
    console.log(`  [warn] could not wire rtk → ${host}: ${shortError(e)}`);
    console.log(`  [hint] Manual: rtk init -g --agent ${agent}`);
    return false;
  }
  return cap?.rtkCopyFrom ? copyPiHook(cap.rtkCopyFrom, options) : true;
}
