// cli/update.ts — update check, per-add-on plan, latest-installer run.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  BUN_BIN_DIR, IS_WINDOWS, OMP_AGENT_DIR, OMP_PLUGINS_DIR,
  PACKAGE_BIN, PACKAGE_NAME, PACKAGE_VERSION, RTK_BINARY_NAME, SCOPE_MAP,
  dryRun, execP, parseJsonObject, scopeFlag, verbose,
} from './common.ts';
import { execNetwork } from './interactive.ts';
import { readTextIfExists } from '../extensions/lib/utils.ts';
import { refreshPrices } from '../extensions/shared/pricing.ts';
import {
  CAVEMAN_REMOTE_RULE, RTK_RELEASE_API, RtkRelease,
  fetchJson, httpsGet, normalizeRtkVersion, sha256Hex,
} from '../extensions/lib/utils.ts';

const UPDATE_CHECK_TTL_MS = 6 * 60 * 60 * 1000;

function newerThan(a: string, b: string): boolean {
  const pa = a.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

async function latestPublishedVersion(): Promise<string | null> {
  try {
    const args = IS_WINDOWS
      ? ['/d', '/s', '/c', 'npm', 'view', PACKAGE_NAME, 'version', '--prefer-online']
      : ['view', PACKAGE_NAME, 'version', '--prefer-online'];
    const r = await execNetwork('Checking npm registry for tersio updates', IS_WINDOWS ? process.env.ComSpec || 'cmd.exe' : 'npm', args, {
      timeout: 4000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      shell: false,
    });
    return r.stdout.trim() || null;
  } catch {
    return null;
  }
}

// Returns a newer published version, null when up to date, or 'unknown' when
// the registry cannot be reached. Reads the registry at most once per TTL
// (cached under OMP_PLUGINS_DIR) unless force skips the cache — an explicit
// "check for updates" must never trust a stale cache.
async function checkForUpdate(force = false): Promise<string | null | 'unknown'> {
  const cachePath = path.join(OMP_PLUGINS_DIR, 'tersio-update-check.json');
  const cached = parseJsonObject<{ latest?: string; lastCheck?: number }>(await readTextIfExists(cachePath));
  const cacheFresh = typeof cached?.lastCheck === 'number' && Date.now() - cached.lastCheck < UPDATE_CHECK_TTL_MS;
  if (!force && cacheFresh && cached?.latest) return newerThan(cached.latest, PACKAGE_VERSION) ? cached.latest : null;

  const latest = await latestPublishedVersion();
  if (latest) {
    await fs.mkdir(OMP_PLUGINS_DIR, { recursive: true }).catch(() => { });
    await fs.writeFile(cachePath, JSON.stringify({ latest, lastCheck: Date.now() }) + '\n', 'utf8').catch(() => { });
    return newerThan(latest, PACKAGE_VERSION) ? latest : null;
  }
  // Registry unreachable: a stale cache naming a newer release is still
  // actionable; otherwise report unknown so callers never claim "latest".
  return cached?.latest && newerThan(cached.latest, PACKAGE_VERSION) ? cached.latest : 'unknown';
}

// Race a probe against a timeout; slow or failing probes resolve null so the
// update plan stays best-effort and never blocks the update itself.
async function settle<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work.then((value) => value, () => null),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Plain `npm view <spec> version` with no spinner, for background probes.
async function npmViewVersion(spec: string, timeoutMs: number): Promise<string | null> {
  try {
    const exe = IS_WINDOWS ? process.env.ComSpec || 'cmd.exe' : 'npm';
    const args = IS_WINDOWS
      ? ['/d', '/s', '/c', 'npm', 'view', spec, 'version', '--prefer-online']
      : ['view', spec, 'version', '--prefer-online'];
    const r = await execP(exe, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true, shell: false });
    return r.stdout.trim() || null;
  } catch {
    return null;
  }
}

// Run a child with inherited stdio for live output. Used when the child
// renders its own interactive UI (the delegated installer runs Clack
// spinners), which a concurrent outer spinner would corrupt into stray bars.
async function execInherit(cmd: string, args: string[]): Promise<void> {
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', resolve);
  });
  if (code !== 0) throw new Error(`${cmd} exited with code ${code}`);
}

interface UpdatePlan {
  cli: string | null;
  rtk: [string | null, string | null];
  rule: [string | null, string | null];
  ponytail: [string | null, string | null];
}

// Current → latest per add-on. Every probe is capped and nullable; the plan
// prints `unknown` for anything unreachable and the update proceeds anyway.
async function probeUpdatePlan(cliLatest: string | null): Promise<UpdatePlan> {
  const rtkBin = path.join(BUN_BIN_DIR, RTK_BINARY_NAME);
  const ponytailPkg = path.join(OMP_PLUGINS_DIR, 'node_modules', '@dietrichgebert', 'ponytail', 'package.json');
  const ruleDest = path.join(OMP_AGENT_DIR, 'extensions', 'caveman-session', 'rule.md');
  const [rtkLocal, rtkRelease, ruleLocalText, ruleRemoteText, ponytailLocalText, ponytailLatest] = await Promise.all([
    settle(execP(rtkBin, ['--version'], { timeout: 5000 }).then((r) => normalizeRtkVersion(r.stdout.trim() || r.stderr.trim()) || null), 6000),
    settle(fetchJson<RtkRelease>(RTK_RELEASE_API).then((r) => normalizeRtkVersion(r.tag_name) || null), 4000),
    readTextIfExists(ruleDest),
    settle(httpsGet(CAVEMAN_REMOTE_RULE), 4000),
    readTextIfExists(ponytailPkg),
    settle(npmViewVersion('@dietrichgebert/ponytail', 4000), 5000),
  ]);
  const shortHash = (text: string | null): string | null => text === null ? null : sha256Hex(text).slice(0, 8);
  return {
    cli: cliLatest,
    rtk: [rtkLocal, rtkRelease],
    rule: [shortHash(ruleLocalText), shortHash(ruleRemoteText)],
    ponytail: [ponytailLocalText ? parseJsonObject<{ version?: string }>(ponytailLocalText)?.version ?? null : null, ponytailLatest],
  };
}

function planLine(name: string, current: string | null, latest: string | null): void {
  if (!current && !latest) console.log(`  ${name}: unknown`);
  else if (!latest) console.log(`  ${name}: ${current} (latest unknown)`);
  else if (current === latest) console.log(`  ${name}: ${current} (up to date)`);
  else console.log(`  ${name}: ${current ?? 'missing'} → ${latest}`);
}

async function runLatestUpdate(): Promise<void> {
  const updateScope = scopeFlag || 'user';
  if (!Object.hasOwn(SCOPE_MAP, updateScope)) {
    console.error(`[fail] Invalid --scope: ${updateScope}. Use: user, project, both`);
    process.exitCode = 1;
    return;
  }

  const forwardedArgs = ['--yes', '--scope', updateScope];
  if (dryRun) forwardedArgs.push('--dry-run');
  if (verbose) forwardedArgs.push('--verbose');

  const npmCommand = IS_WINDOWS ? process.env.ComSpec || 'cmd.exe' : 'npm';

  console.log('=== Updating Tersio ===');

  // Resolve the target explicitly: `npm view --prefer-online` beats the local
  // metadata cache, so a stale `@latest` can never pin an older release.
  const cliLatest = await latestPublishedVersion();
  const target = cliLatest && /^\d+\.\d+\.\d+$/.test(cliLatest) ? `@${cliLatest}` : '@latest';

  // Current → latest per add-on. Best-effort; unreachable probes print as
  // unknown and never block the update.
  const plan = await probeUpdatePlan(cliLatest);
  planLine('Tersio', PACKAGE_VERSION, plan.cli);
  planLine('RTK', plan.rtk[0], plan.rtk[1]);
  planLine('Caveman rule', plan.rule[0], plan.rule[1]);
  planLine('Ponytail', plan.ponytail[0], plan.ponytail[1]);
  console.log('');

  // The npx delegation below only refreshes the OMP-side files; the globally
  // installed CLI keeps its old version until npm -g runs. Refresh both.
  const globalArgs = IS_WINDOWS
    ? ['/d', '/s', '/c', 'npm', 'install', '-g', `${PACKAGE_NAME}${target}`, '--no-audit', '--no-fund', '--prefer-online']
    : ['install', '-g', `${PACKAGE_NAME}${target}`, '--no-audit', '--no-fund', '--prefer-online'];
  if (dryRun) {
    console.log(`  [dry-run] would run: npm install -g ${PACKAGE_NAME}${target} --no-audit --no-fund --prefer-online`);
  } else {
    try {
      const globalResult = await execNetwork(`Updating global Tersio CLI to ${PACKAGE_NAME}${target}`, npmCommand, globalArgs, {
        timeout: 300000,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
        shell: false,
      });
      if (globalResult.stdout) process.stdout.write(globalResult.stdout);
      if (globalResult.stderr) process.stderr.write(globalResult.stderr);
      console.log(`  [ok] CLI updated to ${PACKAGE_NAME}${target}`);
    } catch (e) {
      console.log(`  [warn] Global CLI update skipped: ${(e as Error).message}`);
      console.log(`  [hint] Manual: npm install -g ${PACKAGE_NAME}${target} --no-audit --no-fund --prefer-online`);
    }
  }

  const npmArgs = [
    'exec',
    '--yes',
    '--prefer-online',
    `--package=${PACKAGE_NAME}${target}`,
    '--',
    PACKAGE_BIN,
    '--apply-update',
    ...forwardedArgs,
  ];
  const npmCommandArgs = IS_WINDOWS ? ['/d', '/s', '/c', 'npm', ...npmArgs] : npmArgs;

  // Inherited stdio, no outer spinner: the delegated installer renders its
  // own Clack UI live, which capture-then-dump would corrupt into stray bars.
  console.log(`  Running ${PACKAGE_NAME}${target} installer...`);
  try {
    await execInherit(npmCommand, npmCommandArgs);
    console.log('\n=== Update complete ===');
    if (!dryRun) {
      try {
        if (await refreshPrices()) console.log('  [ok] model price table refreshed');
      } catch { /* pricing is best-effort; update already succeeded */ }
    }
  } catch (e) {
    const err = e as Error;
    console.error(`\n[fail] Could not run ${PACKAGE_NAME}${target}: ${err.message}`);
    process.exitCode = 1;
  }
}
export { checkForUpdate, runLatestUpdate };
