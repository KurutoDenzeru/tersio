// Shared temp-HOME harness. Installer and wiring tests all need the same three
// things: a throwaway home, HOME pointed at it, and cleanup afterwards.
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const installer = path.join(repoRoot, "tersio.js");

/** Creates a throwaway home. Pair with `withHome` or `runTersio`. */
export function tempHome(prefix = "tersio-test-"): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function removeHome(home: string): void {
  rmSync(home, { recursive: true, force: true });
}
/**
 * Writes an executable stub rtk into the temp home's managed bin dir.
 *
 * `rtk init -g --agent <agent>` is what installs the Pi and OMP extensions, so
 * any test asserting those files must supply the binary itself. Relying on the
 * developer's real rtk made tests pass locally and fail in CI, which has none
 * in `~/.bun/bin`. The stub mirrors the real binary's observable behavior:
 * `init --help` lists the agents, a file it wrote itself is reported up to
 * date, and any other file triggers an overwrite prompt that a
 * non-interactive shell answers "no".
 *
 * `markerPath`, when given, is touched on every run so a test can prove this
 * stub — not the developer's rtk — is the binary the CLI executed.
 */
export function seedFakeRtk(home: string, markerPath?: string): string {
  const binDir = path.join(home, ".bun", "bin");
  mkdirSync(binDir, { recursive: true });
  const bin = path.join(binDir, process.platform === "win32" ? "rtk.exe" : "rtk");
  writeFileSync(bin, [
    "#!/bin/sh",
    ...(markerPath ? [`: > ${JSON.stringify(markerPath)}`] : []),
    "# Stand-in for the rtk binary. Answers `rewrite` (what the OpenCode",
    "# plugin and the generated rewriters call) and `init` (what the installer",
    "# calls), so tests never depend on a real rtk being installed.",
    'if [ "$1" = "rewrite" ]; then',
    '  cmd="$2"',
    '  case "$cmd" in',
    '    "ls "*|"ls") echo "rtk $cmd"; exit 0 ;;',
    '    *) echo "rtk $cmd (passthrough)"; exit 3 ;;',
    "  esac",
    "fi",
    'if [ "$1" = "init" ] && [ "$2" = "--help" ]; then',
    "  echo 'Usage: rtk init [OPTIONS]'",
    "  echo '      --agent <AGENT>  Target agent to install hooks for'",
    "  echo '          - omp:  Oh My Pi (OMP)'",
    "  echo '          - pi:   Pi coding agent'",
    "  exit 0",
    "fi",
    'agent=omp',
    'prev=""',
    'for arg in "$@"; do',
    '  [ "$prev" = "--agent" ] && agent="$arg"',
    '  prev="$arg"',
    "done",
    'dir="$HOME/.omp/agent/extensions"',
    '[ "$agent" = "pi" ] && dir="$HOME/.pi/agent/extensions"',
    'if [ -f "$dir/rtk.ts" ]; then',
    '  if grep -q "export default" "$dir/rtk.ts"; then',
    '    echo "RTK Pi extension already up to date:"',
    '    echo "  Extension: $dir/rtk.ts"',
    "    exit 0",
    "  fi",
    '  echo "Overwrite the non-stock Pi extension at $dir/rtk.ts? [y/N]"',
    '  echo "(non-interactive mode, defaulting to N)"',
    "  exit 1",
    "fi",
    'mkdir -p "$dir"',
    'cat > "$dir/rtk.ts" <<EOF',
    '// RTK extension stub (test double).',
    'export default async function (pi) {',
    '  pi.on("tool_call", async (event) => event);',
    '}',
    'EOF',
    'echo "stub rtk: wrote $dir/rtk.ts for $agent"',
  ].join("\n"), "utf8");
  chmodSync(bin, 0o755);
  return bin;
}

/**
 * Points HOME and USERPROFILE at `home` for the duration of `work`.
 * Needed because the wiring modules read the env at call time, not at import.
 */
export async function withHome<T>(home: string, work: () => Promise<T> | T): Promise<T> {
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    return await work();
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/**
 * Runs the real CLI with HOME pointed at `home`.
 * Pass `pathOverride` to hide the developer's own binaries, so a test that
 * supplies a stub rtk cannot be shadowed by a real rtk earlier on PATH.
 */
export function runTersio(home: string, argv: string[], timeout = 120000, pathOverride?: string): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [installer, ...argv], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      ...(pathOverride ? { PATH: pathOverride } : {}),
    },
  });
}

/**
 * A PATH that cannot reach the developer's rtk: the system dirs for the shell
 * and node, nothing else. Stub binaries live in the temp home and are found
 * through HOME, so they are unaffected.
 */
export function hermeticPath(): string {
  return ["/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(path.delimiter);
}
