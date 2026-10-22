// Eligible heads come from rtk's own contract: `rtk rewrite <probe>` exits 0 or 3 when rtk handles the command, 1 when it has no equivalent.
import { execFileSync } from 'node:child_process';
import { normalizeRtkVersion, shimCommand, tersioDataPath } from './utils.ts';
import { patchState, readState, takeLegacy } from './state.ts';
import type { TersioState } from './state.ts';

/** Verified against rtk 1.0.1; the drift test fails when rtk's set moves. */
export const FALLBACK_ELIGIBLE_HEADS: readonly string[] = [
  'rtk', 'git', 'gh', 'glab', 'docker', 'kubectl', 'psql', 'aws', 'bunx', 'npx',
  'pytest', 'mypy', 'cat', 'grep', 'rg', 'find', 'tree', 'diff', 'ls', 'ast-grep',
  'wget', 'prettier', 'playwright', 'prisma', 'jest', 'vitest', 'ctest', 'lint',
  'wc', 'tsc', 'curl', 'cargo', 'npm', 'pnpm', 'bun', 'go', 'ruff', 'next',
  'dotnet', 'oc', 'jq', 'make', 'head', 'tail', 'eslint',
  'sqlfluff', 'php', 'phpunit', 'phpstan', 'pest', 'paratest', 'ecs', 'pint',
  'rake', 'rubocop', 'rspec', 'pip', 'uv', 'deno', 'sbt', 'gt', 'golangci-lint',
  'gradlew', 'mvn', 'mvnd',
];

const PROBES: Record<string, string> = {
  git: 'git log', gh: 'gh pr list', glab: 'glab mr list', docker: 'docker ps',
  kubectl: 'kubectl get pods', psql: 'psql --version', aws: 'aws --version',
  bunx: 'bunx --version', npx: 'npx --version', pytest: 'pytest --version',
  mypy: 'mypy --version', cat: 'cat README.md', grep: 'grep rtk README.md',
  rg: 'rg rtk README.md', find: 'find . -name x', tree: 'tree .', diff: 'diff a b',
  ls: 'ls -la', 'ast-grep': 'ast-grep --version', wget: 'wget --version',
  prettier: 'prettier --version', playwright: 'playwright --version', prisma: 'prisma --version',
  jest: 'jest --version', vitest: 'vitest --version', ctest: 'ctest --version',
  lint: 'lint .', wc: 'wc -l x', tsc: 'tsc --version', curl: 'curl --version',
  cargo: 'cargo test', npm: 'npm run build', pnpm: 'pnpm run build', bun: 'bun run test',
  go: 'go test ./...', ruff: 'ruff check .', next: 'next build', dotnet: 'dotnet build',
  oc: 'oc get pods', jq: 'jq . x', make: 'make', head: 'head README.md',
  tail: 'tail -n 5 README.md', eslint: 'eslint .',
  sqlfluff: 'sqlfluff lint .', php: 'php artisan', phpunit: 'phpunit --version',
  phpstan: 'phpstan analyse', pest: 'pest --version', paratest: 'paratest --version',
  ecs: 'ecs check', pint: 'pint --version', rake: 'rake test',
  rubocop: 'rubocop --version', rspec: 'rspec --version', pip: 'pip install x',
  uv: 'uv run x', deno: 'deno run x', sbt: 'sbt test', gt: 'gt pr list',
  'golangci-lint': 'golangci-lint run', gradlew: 'gradlew build', mvn: 'mvn test',
  mvnd: 'mvnd test',
};

function probe(bin: string, command: string): boolean {
  try {
    const shim = shimCommand(bin, ['rewrite', command]);
    const out = execFileSync(shim.cmd, shim.args, { encoding: 'utf8', timeout: 5000, windowsHide: true });
    return out.trim().length > 0;
  } catch (e) {
    // Non-zero exit throws; exit 3 still prints a rewrite, exits 1 and 2 do not.
    const err = e as { status?: number; stdout?: string | Buffer };
    if (err.status !== 0 && err.status !== 3) return false;
    return String(err.stdout ?? '').trim().length > 0;
  }
}

/** One set of heads for this rtk build, read straight from its rewrite contract. */
export function deriveEligibleHeads(bin: string): Set<string> {
  const heads = new Set<string>(['rtk']);
  for (const [head, command] of Object.entries(PROBES)) {
    if (probe(bin, command)) heads.add(head);
  }
  return heads;
}

/** The probe set decides the derived list, so its signature belongs in the cache key. */
const PROBE_SIGNATURE = Object.keys(PROBES).join(',');

function rtkVersion(bin: string): string {
  try {
    const shim = shimCommand(bin, ['--version']);
    return normalizeRtkVersion(execFileSync(shim.cmd, shim.args, { encoding: 'utf8', timeout: 5000, windowsHide: true }));
  } catch {
    return '';
  }
}

/** Heads rtk rewrites, cached per binary version; without a binary, or on any read failure, the verified fallback stands. */
export function eligibleHeads(bin: string | null): ReadonlySet<string> {
  if (!bin) return new Set(FALLBACK_ELIGIBLE_HEADS);
  const version = rtkVersion(bin);
  const cached = readState().rtkEligible
    ?? takeLegacy(tersioDataPath('rtk-eligible.json', 'rtk-eligible.json'), (raw): TersioState['rtkEligible'] | null => {
      const parsed = JSON.parse(raw) as { version?: unknown; heads?: unknown };
      return typeof parsed.version === 'string' && Array.isArray(parsed.heads)
        ? { version: parsed.version, heads: parsed.heads as string[] }
        : null;
    });
  if (cached?.version === version && cached?.sig === PROBE_SIGNATURE && Array.isArray(cached.heads) && cached.heads.every((h) => typeof h === 'string')) {
    return new Set(cached.heads);
  }
  const heads = deriveEligibleHeads(bin);
  patchState({ rtkEligible: { version, sig: PROBE_SIGNATURE, heads: [...heads] } });
  return heads;
}
