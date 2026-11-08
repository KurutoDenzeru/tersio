// The installed bin's shebang names node, so every command boots under node. A machine that has bun gets the rest of the run there instead: it starts faster, and the dashboard already builds with it.
import { spawn, spawnSync } from 'node:child_process';
import { resolveHostBinary } from '../extensions/shared/utils.ts';

const IS_WINDOWS = process.platform === 'win32';
/** Set on the bun child, so a bun that cannot run this file cannot loop back into node. */
const CHILD_MARKER = 'TERSIO_BUN_CHILD';

function bunBinary(): string | null {
  // bun ships a real bun.exe on Windows; the .cmd shim would need cmd.exe in front of it.
  return resolveHostBinary(IS_WINDOWS ? 'bun.exe' : 'bun');
}

/** Bun's doctor rejects a file that is not a script, so the probe names a harmless flag instead. */
async function execveBun(bun: string, argv: readonly string[]): Promise<boolean> {
  const execve = process.execve;
  const self = process.argv[1];
  if (!execve || !self) return false;
  try {
    // No fork and no second runtime is kept alive, so the node image is replaced rather than sitting under a bun child.
    execve(bun, [bun, self, ...argv], { ...process.env, [CHILD_MARKER]: '1' });
    return true;
  } catch {
    // A platform without execve, or one that refused it: the caller falls back to a child process.
    return false;
  }
}

/**
 * Re-runs argv under bun and exits with its status. No-op when this is already bun, when bun is
 * absent or broken, or when TERSIO_RUNTIME=node asks for node.
 */
export async function preferBun(argv: readonly string[]): Promise<void> {
  if (process.versions.bun) return;
  if (process.env[CHILD_MARKER] || process.env.TERSIO_RUNTIME === 'node') return;
  const self = process.argv[1];
  if (!self) return;
  const bun = bunBinary();
  if (!bun) return;
  // An installed but broken bun must not take the whole CLI down with it.
  const probe = spawnSync(bun, ['--version'], { encoding: 'utf8', timeout: 2000, windowsHide: true });
  if (probe.status !== 0 || !probe.stdout.trim()) return;
  // Replace this image when the platform allows it: a node parent waiting on a bun child is the memory the swap removes.
  if (await execveBun(bun, argv)) return;
  // The child inherits this terminal and its pipes, so a prompt or an MCP stream reaches it directly.
  const child = spawn(bun, [self, ...argv], { stdio: 'inherit', env: { ...process.env, [CHILD_MARKER]: '1' } });
  const { promise, resolve } = Promise.withResolvers<number | null>();
  child.on('exit', (code) => resolve(code));
  child.on('error', () => resolve(null));
  process.exit((await promise) ?? 1);
}
