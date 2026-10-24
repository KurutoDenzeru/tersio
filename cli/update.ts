// cli/update.ts — update check, per-add-on plan, latest-installer run.
import { existsSync, promises as fs, realpathSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  BUN_BIN, HOME, IS_WINDOWS, NPM_BIN, OMP_PLUGINS_DIR,
  PACKAGE_BIN, PACKAGE_NAME, PACKAGE_VERSION,
  args, assumeYes, dryRun, execP, parseJsonObject, verbose,
} from './common.ts';
import { askInteractiveChoice, closeRL, execNetwork, sayTagged, tty } from './interactive.ts';
import { readTextIfExists, resolveRtkBinary, tersioDataPath } from '../extensions/shared/utils.ts';
import { patchState, readState, takeLegacy } from '../extensions/shared/state.ts';
import { refreshPrices } from '../extensions/shared/pricing.ts';
import {
  CAVEMAN_BODY_PATHS,
  CAVEMAN_RAW,
  RTK_RELEASE_API,
  TERSIO_RELEASE_API,
  cavemanRelease,
  httpsGet, normalizeRtkVersion, sha256Hex,
} from '../extensions/shared/utils.ts';
import type { RtkRelease } from '../extensions/shared/utils.ts';
import { detectHosts, hostOptions, parseHostArg } from './hosts.ts';
import { CAVEMAN_PIN } from './upstream.ts';
import { CODEX_MARKETPLACE_NAME, CODEX_PLUGIN_ID, codexInstalledPlugin, codexPluginDir, codexPluginIdForDir } from '../extensions/shared/codex-plugin.ts';

const UPDATE_CHECK_TTL_MS = 6 * 60 * 60 * 1000;
/** How long one source gets before the check gives up on it. */
const LATEST_TIMEOUT_MS = 3000;

function newerThan(a: string, b: string): boolean {
  const pa = a.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

/** The registry's latest tag. `TERSIO_UPDATE_URL` points it at a stub, the way the prices feed does. */
function updateUrl(): string {
  return process.env.TERSIO_UPDATE_URL || `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
}

/** The release feed, beside the registry: a tag lands there before npm serves it. */
function releasesUrl(): string {
  return process.env.TERSIO_RELEASES_URL || TERSIO_RELEASE_API;
}

/** One source's newest version, null when it did not answer. */
async function fetchLatestVersion(url: string, key: string): Promise<string | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), LATEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const body = parseJsonObject<Record<string, unknown>>(await res.text());
    const value = body?.[key];
    return typeof value === 'string' && value ? value.replace(/^v/, '') : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The newest release either source named, and the registry's own tag behind it. */
export interface LatestRelease {
  version: string;
  source: 'npm' | 'github';
  npm: string | null;
}

/** The newest release across the registry and the release feed; null when neither answers. */
export async function latestRelease(): Promise<LatestRelease | null> {
  const [npm, github] = await Promise.all([
    fetchLatestVersion(updateUrl(), 'version'),
    fetchLatestVersion(releasesUrl(), 'tag_name'),
  ]);
  if (!npm && !github) return null;
  // A tie goes to npm: that version is the one an install can reach.
  const fromGithub = !!github && (!npm || newerThan(github, npm));
  return {
    version: fromGithub ? (github as string) : (npm as string),
    source: fromGithub ? 'github' : 'npm',
    npm,
  };
}

// A newer version, null when up to date, 'unknown' when no source answered. Cached for a TTL unless force.
async function checkForUpdate(force = false): Promise<string | null | 'unknown'> {
  const cached = readState().updateCheck ?? takeLegacy(tersioDataPath('update-check.json', 'tersio-update-check.json'), (raw) => parseJsonObject<{ latest?: string; lastCheck?: number }>(raw));
  const cacheFresh = typeof cached?.lastCheck === 'number' && Date.now() - cached.lastCheck < UPDATE_CHECK_TTL_MS;
  if (!force && cacheFresh && cached?.latest) return newerThan(cached.latest, PACKAGE_VERSION) ? cached.latest : null;

  const found = await latestRelease();
  if (found) {
    patchState({ updateCheck: { latest: found.version, source: found.source, npm: found.npm, lastCheck: Date.now() } });
    return newerThan(found.version, PACKAGE_VERSION) ? found.version : null;
  }
  // No source answered: a stale cache naming a newer release is actionable, else unknown, so none claim "latest".
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

/** The real path when the file exists, else the resolved one: both sides of the prefix test must agree on symlinks. */
function realOrResolved(target: string): string {
  const resolved = path.resolve(target);
  try { return realpathSync(resolved); } catch { return resolved; }
}

/**
 * The package manager that installed the running CLI. `bun install -g` writes to `~/.bun`, npm to its
 * own prefix, and each keeps its own copy, so updating the wrong one leaves the old CLI in place and the
 * update prompt comes back on the next run.
 */
export function installerManager(self = process.argv[1] ?? '', home = HOME): { cmd: string; args: (target: string) => string[]; label: string } {
  // `home` is a seam for tests: a runner has no installed copy, so the symlink there must be judged by the same rule.
  const bunRoot = path.join(realOrResolved(home), '.bun', 'install', 'global', 'node_modules', ...PACKAGE_NAME.split('/'));
  // The bin is a symlink into the global tree, so argv[1] is the link path; the target is what says who installed it.
  const real = realOrResolved(self);
  if (real.startsWith(bunRoot)) {
    return { cmd: BUN_BIN, args: (target) => ['install', '-g', `${PACKAGE_NAME}${target}`], label: 'bun' };
  }
  return {
    cmd: IS_WINDOWS ? process.env.ComSpec || 'cmd.exe' : NPM_BIN,
    args: (target) => (IS_WINDOWS
      ? ['/d', '/s', '/c', NPM_BIN, 'install', '-g', `${PACKAGE_NAME}${target}`, '--no-audit', '--no-fund', '--prefer-online']
      : ['install', '-g', `${PACKAGE_NAME}${target}`, '--no-audit', '--no-fund', '--prefer-online']),
    label: 'npm',
  };
}

interface UpdatePlan {
  cli: string | null;
  cliSource: 'npm' | 'github' | null;
  npm: string | null;
  rtk: [string | null, string | null];
  ruleLocal: string | null;
  // The rule bodies at the newest release; the tag names them, the hashes only decide staleness.
  rule: { tag: string; hashes: string } | null;
  // Bundled with tersio: only the local copy is probed. Missing marks stale; present is never stale on its own.
  ponytail: string | null;
}

/** The tag and the two upstream bodies at the newest release, so the plan compares against a published version. */
async function cavemanRemoteRule(signal: AbortSignal): Promise<{ tag: string; hashes: string } | null> {
  const tag = await cavemanRelease();
  if (!tag) return null;
  const texts = await Promise.all([
    httpsGet(`${CAVEMAN_RAW}/${tag}/${CAVEMAN_BODY_PATHS.ultra}`, { signal }),
    httpsGet(`${CAVEMAN_RAW}/${tag}/${CAVEMAN_BODY_PATHS.megacave}`, { signal }),
  ]);
  return { tag, hashes: texts.map((t) => sha256Hex(t).slice(0, 8)).join('+') };
}

// Current → latest per add-on. Probes are capped and nullable; the plan prints `unknown` for anything unreachable.
async function probeUpdatePlan(release: LatestRelease | null): Promise<UpdatePlan> {
  const rtkBin = resolveRtkBinary();
  // Ponytail ships inside this package; the separate sibling the old probe read was removed on install.
  const ponytailPkg = path.join(OMP_PLUGINS_DIR, 'node_modules', '@krtclcdy', 'tersio', 'extensions', 'ponytail', 'package.json');
  // rule.md ships with the release; only the tracked bodies can go stale.
  const tersioRule = (name: string) => path.join(OMP_PLUGINS_DIR, 'node_modules', '@krtclcdy', 'tersio', 'extensions', 'caveman', name);
  // A Codex-only install carries the same bodies under the Codex plugin tree.
  const codexTree = (rel: string) => path.join(codexPluginDir(), rel);
  const controller = new AbortController();
  const [rtkLocal, rtkRelease, ruleLocal, ruleRemote, ponytailLocalText] = await Promise.all([
    settle(rtkBin ? execP(rtkBin, ['--version'], { timeout: 5000 }).then((r) => normalizeRtkVersion(r.stdout.trim() || r.stderr.trim()) || null) : Promise.resolve(null), 6000),
    settle(httpsGet(RTK_RELEASE_API, { signal: controller.signal }).then((text) => normalizeRtkVersion((JSON.parse(text) as RtkRelease).tag_name) || null), 1500),
    Promise.all([readTextIfExists(tersioRule('rule-ultra.md')), readTextIfExists(tersioRule('rule-megacave.md'))])
      .then((texts) => (texts.every(Boolean) ? texts.map((t) => sha256Hex(t as string).slice(0, 8)).join('+') : null))
      .then(async (hashes) => hashes ?? Promise.all([readTextIfExists(codexTree('extensions/caveman/rule-ultra.md')), readTextIfExists(codexTree('extensions/caveman/rule-megacave.md'))])
        .then((texts) => (texts.every(Boolean) ? texts.map((t) => sha256Hex(t as string).slice(0, 8)).join('+') : null))),
    settle(cavemanRemoteRule(controller.signal), 1500),
    readTextIfExists(ponytailPkg).then(async (text) => text ?? readTextIfExists(codexTree('extensions/ponytail/package.json'))),
  ]);
  controller.abort();
  return {
    cli: release?.version ?? null,
    cliSource: release?.source ?? null,
    npm: release?.npm ?? null,
    rtk: [rtkLocal, rtkRelease],
    ruleLocal,
    rule: ruleRemote,
    ponytail: ponytailLocalText ? parseJsonObject<{ version?: string }>(ponytailLocalText)?.version ?? null : null,
  };
}

// Every add-on prints a version jump when stale, "up to date" otherwise, and "unknown" when unreachable.
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
  // The feed can name a version npm has not served yet; the plan says which source won.
  if (plan.cliSource === 'github' && plan.npm && plan.cli && newerThan(plan.cli, plan.npm)) {
    status.push(`npm serves ${plan.npm}; the release feed has ${plan.cli}`);
  }
  push('RTK', plan.rtk[0], plan.rtk[1]);
  // The rule body carries no version, so the tag recorded at pull time names it; the pin covers a fresh install.
  const ruleCurrent = (readState().cavemanUpstream?.tag ?? CAVEMAN_PIN).replace(/^v/, '');
  if (plan.ruleLocal && plan.rule && plan.ruleLocal === plan.rule.hashes) status.push(`Caveman rule: ${ruleCurrent} (up to date)`);
  else if (plan.rule) {
    status.push(`Caveman rule: ${ruleCurrent} → ${plan.rule.tag.replace(/^v/, '')}`);
    stale.push(`Caveman rule: ${ruleCurrent} → ${plan.rule.tag.replace(/^v/, '')}`);
  } else if (plan.ruleLocal) status.push(`Caveman rule: ${ruleCurrent} (latest unknown)`);
  else status.push('Caveman rule: unknown');
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
  let pinned: string | undefined;
  try {
    pinned = parseHostArg(args);
  } catch (e) {
    console.error(`[fail] ${(e as Error).message}`);
    process.exitCode = 1;
    return;
  }
  // A bare `tersio update` asks which agent to refresh: `--host` pins it, and --yes keeps the default for scripts.
  if (!pinned && tty() && !assumeYes) {
    const installed = detectHosts();
    // Open on an agent that has Tersio on it, so Enter keeps a real install instead of adding another.
    const initial = installed.find((host) => host.installed)?.id ?? 'omp';
    const choice = await askInteractiveChoice('Update which agent?', hostOptions(installed), initial);
    if (choice.status !== 'selected') {
      closeRL();
      process.exitCode = 130;
      return;
    }
    pinned = choice.value;
  }
  if (pinned) forwardedArgs.push('--host', pinned);
  const codexTarget = pinned === 'codex';

  const npmCommand = IS_WINDOWS ? process.env.ComSpec || 'cmd.exe' : 'npm';
  // Refresh the copy that is actually running, or the old CLI stays on PATH and offers this again.
  const manager = installerManager();

  // `--prefer-online` beats the local cache, so a stale @latest cannot pin down.
  const release = await latestRelease();
  const cliLatest = release?.version ?? null;
  const target = cliLatest && /^\d+\.\d+\.\d+$/.test(cliLatest) ? `@${cliLatest}` : '@latest';

  const plan = await probeUpdatePlan(release);
  const { stale, status } = planLines(plan);
  if (codexTarget) {
    // Codex loads the cache or the local fallback, not the global CLI package.
    const installed = codexInstalledPlugin();
    const bundled = installed?.layout === 'bundled' || existsSync(path.join(HOME, '.tersio', 'codex-plugin'));
    if (dryRun) {
      console.log(`tersio update --host codex (dry-run):\n  ${status.join('\n  ')}`);
      if (bundled) {
        sayTagged('  [dry-run] would refresh the bundled Codex plugin');
      } else {
        sayTagged(`  [dry-run] would run: codex plugin marketplace upgrade ${CODEX_MARKETPLACE_NAME}`);
        const id = installed === null ? CODEX_PLUGIN_ID : codexPluginIdForDir(installed.dir) ?? CODEX_PLUGIN_ID;
        sayTagged(`  [dry-run] would run: codex plugin add ${id}`);
      }
      return;
    }
    console.log(`Checking for updates:\n  ${status.join('\n  ')}`);
    if (bundled) {
      const { stepCodexBundled } = await import('./install.ts');
      try {
        await stepCodexBundled({ dryRun: false, verbose, yes: true, reinstall: true });
      } catch (e) {
        console.error(`[fail] Codex plugin update: ${(e as Error).message.split('\n')[0]}`);
        process.exitCode = 1;
        return;
      }
      console.log('Done — the bundled Codex plugin and session defaults updated.');
      await refreshPrices().catch(() => { /* pricing is best-effort; update already succeeded */ });
      return;
    }
    try {
      await execNetwork('Refreshing the Tersio Codex marketplace', 'codex', [
        'plugin', 'marketplace', 'upgrade', CODEX_MARKETPLACE_NAME, '--json',
      ], { timeout: 180000 });
      await execNetwork('Installing the Tersio Codex plugin', 'codex', [
        'plugin', 'add', installed === null ? CODEX_PLUGIN_ID : codexPluginIdForDir(installed.dir) ?? CODEX_PLUGIN_ID, '--json',
      ], { timeout: 180000 });
    } catch (e) {
      console.error(`[fail] Codex plugin update: ${(e as Error).message.split('\n')[0]}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Done — tersio ${PACKAGE_VERSION} and the Codex plugin updated.`);
    await refreshPrices().catch(() => { /* pricing is best-effort; update already succeeded */ });
    return;
  }
  if (dryRun) {
    console.log(`tersio update (dry-run):\n  ${status.join('\n  ')}`);
    sayTagged(`  [dry-run] would run: ${manager.label} install -g ${PACKAGE_NAME}${target}`);
    sayTagged(`  [dry-run] would delegate: npm exec --yes --prefer-online --package=${PACKAGE_NAME}${target} -- tersio --apply-update ${forwardedArgs.join(' ')}`);
    return;
  }
  console.log(`Checking for updates:\n  ${status.join('\n  ')}`);
  if (stale.length === 0) {
    console.log(`tersio ${PACKAGE_VERSION} — up to date`);
    return;
  }
  console.log(`Updating ${stale.join(', ')}`);


  // A checkout runs its own entry: the published CLI cannot carry unshipped changes, and the global
  // install would replace the tree this copy lives in.
  const sourceEntry = process.argv[1]?.endsWith('.ts') ? process.argv[1] : null;
  if (sourceEntry) {
    try {
      await execInherit(process.execPath, [sourceEntry, '--apply-update', ...forwardedArgs]);
      console.log(`Done — tersio ${PACKAGE_VERSION} and add-ons updated.`);
      await refreshPrices().catch(() => { /* pricing is best-effort; update already succeeded */ });
    } catch (e) {
      console.error(`[fail] Could not run ${sourceEntry}: ${(e as Error).message}`);
      process.exitCode = 1;
    }
    return;
  }

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
    if (release?.source === 'github') console.error(`[hint] The release feed has ${release.version}; npm may not serve it yet.`);
    console.error(`[hint] Retry once released fixed; manual: npm install -g ${PACKAGE_NAME}@latest --no-audit --no-fund --prefer-online`);
    process.exitCode = 1;
    return;
  }

  // The npx delegation below only refreshes the host-side files; the global CLI keeps its old version until this runs.
  try {
    const globalResult = await execNetwork(`Updating global Tersio CLI to ${PACKAGE_NAME}${target}`, manager.cmd, manager.args(target), {
      timeout: 300000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
      shell: false,
    });
    // The package manager echoes its own added/changed summary; only failures surface here.
    if (globalResult.stderr) process.stderr.write(globalResult.stderr);
  } catch (e) {
    sayTagged(`  [warn] Global CLI update skipped: ${(e as Error).message}`);
    sayTagged(`  [hint] Manual: ${manager.label} install -g ${PACKAGE_NAME}${target}`);
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

  // Inherited stdio, no outer spinner; the quiet installer runs, so this parent owns the plan line and closing summary.
  try {
    await execInherit(npmCommand, npmCommandArgs);
    console.log(`Done — tersio ${plan.cli ?? PACKAGE_VERSION} and add-ons updated.`);
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
export { checkForUpdate, newerThan, runLatestUpdate };
