// cli/update.ts — update check, per-add-on plan, latest-installer run.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  IS_WINDOWS, OMP_PLUGINS_DIR,
  PACKAGE_BIN, PACKAGE_NAME, PACKAGE_VERSION,
  dryRun, execP, parseJsonObject, verbose,
} from './common.ts';
import { execNetwork, sayTagged } from './interactive.ts';
import { readTextIfExists, resolveRtkBinary, tersioDataPath } from '../extensions/lib/utils.ts';
import { refreshPrices } from '../extensions/shared/pricing.ts';
import {
  CAVEMAN_REMOTE_RULE, RTK_RELEASE_API,
  httpsGet, normalizeRtkVersion, sha256Hex,
} from '../extensions/lib/utils.ts';
import type { RtkRelease } from '../extensions/lib/utils.ts';

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

// A newer published version, null when up to date, 'unknown' when the registry is unreachable. Cached for a TTL unless force, which must not trust a cache.
async function checkForUpdate(force = false): Promise<string | null | 'unknown'> {
  const cachePath = tersioDataPath('update-check.json', 'tersio-update-check.json');
  const cached = parseJsonObject<{ latest?: string; lastCheck?: number }>(await readTextIfExists(cachePath));
  const cacheFresh = typeof cached?.lastCheck === 'number' && Date.now() - cached.lastCheck < UPDATE_CHECK_TTL_MS;
  if (!force && cacheFresh && cached?.latest) return newerThan(cached.latest, PACKAGE_VERSION) ? cached.latest : null;

  const latest = await latestPublishedVersion();
  if (latest) {
    await fs.mkdir(OMP_PLUGINS_DIR, { recursive: true }).catch(() => { });
    await fs.writeFile(cachePath, JSON.stringify({ latest, lastCheck: Date.now() }) + '\n', 'utf8').catch(() => { });
    return newerThan(latest, PACKAGE_VERSION) ? latest : null;
  }
  // Unreachable registry: a stale cache naming a newer release is still actionable, else report unknown so nobody claims "latest".
  return cached?.latest && newerThan(cached.latest, PACKAGE_VERSION) ? cached.latest : 'unknown';
}

// Race a probe against a timeout; failures resolve null so nothing blocks.
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

// Inherited stdio, so a child spinner cannot corrupt this parent's.
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
  // Bundled with tersio: only the local copy is probed. Missing marks stale; present is never stale on its own.
  ponytail: string | null;
}

// Current → latest per add-on. Every probe is capped and nullable, and the plan prints `unknown` for anything unreachable.
async function probeUpdatePlan(cliLatest: string | null): Promise<UpdatePlan> {
  const rtkBin = resolveRtkBinary();
  const ponytailPkg = path.join(OMP_PLUGINS_DIR, 'node_modules', '@dietrichgebert', 'ponytail', 'package.json');
  const tersioRule = path.join(OMP_PLUGINS_DIR, 'node_modules', '@krtclcdy', 'tersio', 'extensions', 'caveman-session', 'rule.md');
  const controller = new AbortController();
  const [rtkLocal, rtkRelease, ruleLocalText, ruleRemoteText, ponytailLocalText] = await Promise.all([
    settle(rtkBin ? execP(rtkBin, ['--version'], { timeout: 5000 }).then((r) => normalizeRtkVersion(r.stdout.trim() || r.stderr.trim()) || null) : Promise.resolve(null), 6000),
    settle(httpsGet(RTK_RELEASE_API, { signal: controller.signal }).then((text) => normalizeRtkVersion((JSON.parse(text) as RtkRelease).tag_name) || null), 1500),
    readTextIfExists(tersioRule),
    settle(httpsGet(CAVEMAN_REMOTE_RULE, { signal: controller.signal }).then((text) => sha256Hex(text).slice(0, 8)), 1500),
    readTextIfExists(ponytailPkg),
  ]);
  controller.abort();
  return {
    cli: cliLatest,
    rtk: [rtkLocal, rtkRelease],
    rule: [ruleLocalText ? sha256Hex(ruleLocalText).slice(0, 8) : null, ruleRemoteText],
    ponytail: ponytailLocalText ? parseJsonObject<{ version?: string }>(ponytailLocalText)?.version ?? null : null,
  };
}

// Every add-on prints a version jump when stale, "up to date" otherwise, and "unknown" when its source cannot be reached.
function planLines(plan: UpdatePlan): { stale: string[]; status: string[] } {
  const stale: string[] = [];
  const status: string[] = [];
  const push = (name: string, current: string | null, latest: string | null): void => {
    if (!current && !latest) status.push(`${name}: unknown`);
    else if (!latest) status.push(`${name}: ${current} (latest unknown)`);
    else if (current === latest) status.push(`${name}: ${current} (up to date)`);
    else {
      status.push(`${name}: ${current ?? 'missing'} → ${latest}`);
      stale.push(`${name}: ${current ?? 'missing'} → ${latest}`);
    }
  };
  push('Tersio', PACKAGE_VERSION, plan.cli);
  push('RTK', plan.rtk[0], plan.rtk[1]);
  push('Caveman rule', plan.rule[0], plan.rule[1]);
  if (plan.ponytail) status.push(`Ponytail: ${plan.ponytail} (bundled with tersio)`);
  else {
    status.push('Ponytail: missing → bundled reinstall');
    stale.push('Ponytail: missing → bundled reinstall');
  }
  return { stale, status };
}

async function runLatestUpdate(): Promise<void> {
  const forwardedArgs = ['--yes'];
  if (dryRun) forwardedArgs.push('--dry-run');
  if (verbose) forwardedArgs.push('--verbose');

  const npmCommand = IS_WINDOWS ? process.env.ComSpec || 'cmd.exe' : 'npm';

  // `--prefer-online` beats the local cache, so a stale @latest cannot pin down.
  const cliLatest = await latestPublishedVersion();
  const target = cliLatest && /^\d+\.\d+\.\d+$/.test(cliLatest) ? `@${cliLatest}` : '@latest';

  // Best-effort: unreachable probes print as unknown.
  const plan = await probeUpdatePlan(cliLatest);
  const { stale, status } = planLines(plan);
  if (dryRun) {
    console.log(`tersio update (dry-run):\n  ${status.join('\n  ')}`);
    sayTagged(`  [dry-run] would run: npm install -g ${PACKAGE_NAME}${target} --no-audit --no-fund --prefer-online`);
    sayTagged(`  [dry-run] would delegate: npm exec --yes --prefer-online --package=${PACKAGE_NAME}${target} -- tersio --apply-update ${forwardedArgs.join(' ')}`);
    return;
  }
  console.log(`Checking for updates:\n  ${status.join('\n  ')}`);
  if (stale.length === 0) {
    console.log(`tersio ${PACKAGE_VERSION} — up to date`);
    return;
  }
  console.log(`Updating ${stale.join(', ')}`);

  // Broken payloads (v2.20.0) crash on boot — smoke-check the target before touching anything installed.
  const smokeArgs = IS_WINDOWS
    ? ['/d', '/s', '/c', 'npm', 'exec', '--yes', '--prefer-online', `--package=${PACKAGE_NAME}${target}`, '--', PACKAGE_BIN, '--version']
    : ['exec', '--yes', '--prefer-online', `--package=${PACKAGE_NAME}${target}`, '--', PACKAGE_BIN, '--version'];
  try {
    await execP(npmCommand, smokeArgs, {
      timeout: 120000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      shell: false,
    });
  } catch (e) {
    console.error(`[fail] Update payload ${PACKAGE_NAME}${target} failed its smoke check — staying on ${PACKAGE_VERSION}.`);
    console.error(`[fail] ${(e as Error).message.split('\n')[0]}`);
    console.error(`[hint] Retry once released fixed; manual: npm install -g ${PACKAGE_NAME}@latest --no-audit --no-fund --prefer-online`);
    process.exitCode = 1;
    return;
  }

  // The npx delegation below only refreshes the OMP-side files; the globally installed CLI keeps its old version until npm -g runs. Refresh both.
  const globalArgs = IS_WINDOWS
    ? ['/d', '/s', '/c', 'npm', 'install', '-g', `${PACKAGE_NAME}${target}`, '--no-audit', '--no-fund', '--prefer-online']
    : ['install', '-g', `${PACKAGE_NAME}${target}`, '--no-audit', '--no-fund', '--prefer-online'];
  try {
    const globalResult = await execNetwork(`Updating global Tersio CLI to ${PACKAGE_NAME}${target}`, npmCommand, globalArgs, {
      timeout: 300000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
      shell: false,
    });
    // npm -g echoes its own added/changed summary; only failures surface here.
    if (globalResult.stderr) process.stderr.write(globalResult.stderr);
  } catch (e) {
    sayTagged(`  [warn] Global CLI update skipped: ${(e as Error).message}`);
    sayTagged(`  [hint] Manual: npm install -g ${PACKAGE_NAME}${target} --no-audit --no-fund --prefer-online`);
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

  // Inherited stdio, no outer spinner; the delegated installer runs quiet and this parent owns both the plan line and the closing summary.
  try {
    await execInherit(npmCommand, npmCommandArgs);
    console.log(`Done — tersio ${plan.cli ?? PACKAGE_VERSION}. Restart OMP.`);
    if (!dryRun) {
      try {
        await refreshPrices();
      } catch { /* pricing is best-effort; update already succeeded */ }
    }
  } catch (e) {
    const err = e as Error;
    console.error(`[fail] Could not run ${PACKAGE_NAME}${target}: ${err.message}`);
    process.exitCode = 1;
  }
}
export { checkForUpdate, runLatestUpdate };
