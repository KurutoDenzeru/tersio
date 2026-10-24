// Upstream scorecard: how faithfully Tersio's four sources track their upstreams, and how current they are.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, promises as fs, readdirSync } from 'node:fs';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { PACKAGE_VERSION, args, flagValue, parseJsonObject } from './common.ts';
import { newerThan } from './update.ts';
import { readState } from '../extensions/shared/state.ts';
import { detectHosts, hostExtensionsDir } from './hosts.ts';
import { EXT_DIR, PI_PONYTAIL_FILES, PONYTAIL_BUNDLE_FILES, PONYTAIL_DIR, PONYTAIL_PKG, PONYTAIL_VERSION, shippedOmpManifest, sourcePath, treeFileText, treeFilesFor } from './manifest.ts';
import { textTable } from './common.ts';
import { adaptCavemanFull } from '../extensions/updater/index.ts';
import {
  codexExistingPluginDirs,
  codexInstalledPlugin,
  codexPluginFiles,
  codexPluginFilesForLayout,
  codexPluginState,
} from '../extensions/shared/codex-plugin.ts';
import {
  RTK_RELEASE_API,
  RTK_REPO,
  fetchJson,
  httpsGet,
  httpsGetBuffer,
  normalizeRtkVersion,
  piAgentDir,
  readTextIfExists,
  resolveRtkBinary,
  shimCommand,
  tersioHome,
} from '../extensions/shared/utils.ts';

const GH = 'https://api.github.com';
/** The package server, which serves a published version's files one by one. */
const UNPKG = 'https://unpkg.com';
const RAW = 'https://raw.githubusercontent.com';
const PONYTAIL_NPM = 'https://registry.npmjs.org/@dietrichgebert/ponytail/latest';

const CAVEMAN_REPO = 'JuliusBrussee/caveman';
const PONYTAIL_REPO = 'DietrichGebert/ponytail';
const PSTACK_REPO = 'cursor/plugins';
const PSTACK_PATH = 'pstack/skills/poteto-mode/';

/** Pins are deliberate: bump one only after reviewing the upstream diff it names. */
export const CAVEMAN_PIN = 'v4.0.1';
// a968159 is the newest commit that touched a body we track; its one change renames the skill in frontmatter, which the fork drops.
const PSTACK_PIN = 'a968159326d1fc6b7d483491ec5c457986a20af2';

/** Every upstream artifact in one folder, so the data home stays readable. */
export function upstreamDir(): string {
  return path.join(tersioHome(), 'upstream');
}

/** The old loose files move under upstream/ once, so a rerun reads one layout. */
async function migrateLayout(): Promise<void> {
  const dir = upstreamDir();
  await fs.mkdir(dir, { recursive: true }).catch(() => {});
  const moves: Array<[string, string]> = [
    [path.join(tersioHome(), 'scorecard.json'), path.join(dir, 'scorecard.json')],
    [path.join(tersioHome(), 'upstream-scorecard.md'), path.join(dir, 'scorecard.md')],
    [path.join(tersioHome(), 'upstream-trees'), path.join(dir, 'trees')],
  ];
  for (const [from, to] of moves) {
    if (!existsSync(to) && existsSync(from)) await fs.rename(from, to).catch(() => {});
  }
}

/** Upstream path for one local pstack file: the port renamed leaves into the skill tree it came from. */
export function pstackUpstreamPath(local: string): string | null {
  if (local === 'rule.md') return `${PSTACK_PATH}SKILL.md`;
  if (local.startsWith('playbooks/') || local.startsWith('references/')) return `${PSTACK_PATH}${local}`;
  if (local.startsWith('principles/')) return `pstack/skills/principle-${path.basename(local, '.md')}/SKILL.md`;
  if (local.startsWith('skills/')) return `pstack/${local}`;
  return null;
}

/** Every markdown file in the shipped pstack tree, relative to extensions/pstack. */
function pstackLocalFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), child);
      else if (entry.name.endsWith('.md')) out.push(child);
    }
  };
  walk(path.join(EXT_DIR, 'pstack'), '');
  return out.toSorted();
}

/** Upstream paths whose bytes Tersio carries, keyed by upstream path → local tree path. */
interface SourcePin {
  id: string;
  label: string;
  repo: string;
  pin: string;
  /**
   * Files already known to have moved upstream since the pin, at the time the pin was reviewed.
   * `--strict` fails when the count grows, which is the signal to review the diff and re-port.
   */
  driftCeiling: number;
  /** Upstream paths whose bytes Tersio carries. */
  files: ReadonlyArray<{ upstream: string; local: string; adapt?: (text: string) => string }>;
  /** Local bodies Tersio wrote itself, so there is no upstream byte to match. */
  localOnly: readonly string[];
}

const CAVEMAN: SourcePin = {
  id: 'caveman',
  label: 'Caveman',
  repo: CAVEMAN_REPO,
  pin: CAVEMAN_PIN,
  files: [
    { upstream: 'skills/caveman/SKILL.md', local: 'caveman/rule.md', adapt: adaptCavemanFull },
    { upstream: 'skills/ultracave/SKILL.md', local: 'caveman/rule-ultra.md' },
    { upstream: 'skills/megacave/SKILL.md', local: 'caveman/rule-megacave.md' },
  ],
  localOnly: ['caveman/rule-lite.md', 'caveman/rule-megacave-lite.md', 'caveman/rule-megacave-ultra.md'],
  driftCeiling: 0,
};

const PSTACK: SourcePin = {
  id: 'pstack',
  label: 'pstack',
  repo: PSTACK_REPO,
  pin: PSTACK_PIN,
  files: pstackLocalFiles()
    .map((local) => ({ local, upstream: pstackUpstreamPath(local) }))
    .filter((f): f is { local: string; upstream: string } => f.upstream !== null),
  localOnly: [],
  driftCeiling: 0,
};

/** How a source proves one tracked file: byte equality with the pin, a fork that is merely present, or a version. */
export type SourceKind = 'bytes' | 'presence' | 'version';

/** Why a source could not be measured, when it could not be: a dead pin is upstream moving, not a dead network. */
export type SourceStatus = 'ok' | 'offline' | 'pin-missing' | 'error';

/** One scorecard line. `matched` counts a file whose bytes match upstream, or a declared fork that is present. */
export interface SourceRow {
  source: string;
  pin: string;
  upstream: string;
  tracked: number;
  matched: number;
  drift: number;
  added: number;
  /** Tracked upstream paths that are gone from HEAD; also counted in `drift`. */
  removed: number;
  /** Drift already reviewed when the pin was taken; `--strict` fails above it. */
  ceiling: number;
  /** False when the feed could not be read, so a strict gate never passes on an unmeasured drift. */
  measured: boolean;
  status: SourceStatus;
  kind: SourceKind;
  /** Where to read this pin upstream: a compare view for a commit, the release page for a version. */
  link: string;
  /** Our tracked bodies that are absent or differ, by local path, with the reason. */
  gaps: string[];
  /** Upstream paths that moved since the pin. */
  moved: string[];
  /** Upstream paths inside a tracked directory that the pin did not have. */
  appeared: string[];
  /** Upstream paths the pin had and HEAD does not. */
  gone: string[];
  /** Skill directories upstream publishes that this port does not carry. */
  uncarried: number;
  /** How many of those moved since the pin. */
  uncarriedMoved: number;
  /** When the pin was taken, so a reader sees how long it has been held. */
  pinnedAt: number | null;
  /** The upstream state a new pin would name, so the operator can copy it. */
  candidate: string | null;
  /** The head of each file that moved upstream, so a review reads the change. */
  preview: Preview[];
  note: string;
}

/** One moved file, with the head of its new content. */
export interface Preview {
  path: string;
  lines: number;
  head: string;
}

export interface HostRow {
  host: string;
  installed: boolean;
  files: number;
  matched: number;
  stale: number;
  missing: number;
  staleFiles: string[];
  missingFiles: string[];
  /** Entries the shipped manifest loads that this host's manifest does not, so the module never runs there. */
  unloaded: string[];
  /** What to run to repair the stale files, named from the version gap. */
  fix: string;
}

export interface Scorecard {
  version: string;
  checkedAt: number;
  sources: SourceRow[];
  hosts: HostRow[];
  accuracy: number;
  drift: number;
  [key: string]: unknown;
}

/** The last scorecard, or null when none has been written yet. */
export async function cachedScorecard(): Promise<Scorecard | null> {
  return parseJsonObject<Scorecard>(await readTextIfExists(path.join(upstreamDir(), 'scorecard.json')));
}

/** One run, as the page reads it back. */
export interface HistoryPoint {
  at: number;
  accuracy: number;
  drift: number;
  sources: Array<{ source: string; pct: number }>;
}

/** The last runs, oldest first, so the page can plot the accuracy. */
export async function upstreamHistory(limit = 60): Promise<HistoryPoint[]> {
  const text = await readTextIfExists(path.join(upstreamDir(), 'history.jsonl'));
  if (!text) return [];
  const rows = text.split('\n').filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line) as HistoryPoint]; } catch { return []; }
  });
  return rows.slice(-limit);
}

/** One line per run, appended, so the accuracy has a history. */
async function writeHistory(card: Scorecard): Promise<void> {
  const point: HistoryPoint = {
    at: card.checkedAt,
    accuracy: card.accuracy,
    drift: card.drift,
    sources: card.sources.map((row) => ({ source: row.source, pct: row.tracked === 0 ? 100 : Math.round((row.matched / row.tracked) * 1000) / 10 })),
  };
  await fs.appendFile(path.join(upstreamDir(), 'history.jsonl'), `${JSON.stringify(point)}\n`, 'utf8').catch(() => { });
}

/** Run the live check, cache both artifacts, and hand the card back. */
export async function refreshScorecard(withinMs = 90_000): Promise<Scorecard> {
  // The feed has no read timeout of its own, so a stalled connection would hang the caller. Bound it.
  let timer: NodeJS.Timeout | undefined;
  try {
    const card = await Promise.race([
      collect(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`the check timed out after ${Math.round(withinMs / 1000)}s`)), withinMs);
      }),
    ]);
    await fs.mkdir(upstreamDir(), { recursive: true }).catch(() => {});
    await fs.writeFile(path.join(upstreamDir(), 'scorecard.json'), `${JSON.stringify(card, null, 2)}\n`, 'utf8').catch(() => {});
    await fs.writeFile(path.join(upstreamDir(), 'scorecard.md'), scorecardMarkdown(card), 'utf8').catch(() => {});
    return card;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** A git blob id, so a local file compares to a tree entry without fetching the body. */
export function gitBlobSha(text: string): string {
  const bytes = Buffer.from(text, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

/** Where to read the diff between a pin and the current upstream, so a drift row is one click from its cause. */
function compareUrl(repo: string, pin: string): string {
  return `https://github.com/${repo}/compare/${pin}...HEAD`;
}

/** The release page a version pin names: both upstream repos tag every release `v<version>`. */
function releaseUrl(repo: string, version: string): string {
  return `https://github.com/${repo}/releases/tag/v${version}`;
}

/** A commit's tree is immutable, so it is cached forever; HEAD is cached for six hours, since GitHub rate-limits unauthenticated reads. */
const HEAD_TTL_MS = 6 * 60 * 60 * 1000;

/** Keep the trees of pins we no longer read. HEAD is exempt: it is refetched on its own TTL. */
const TREE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** How many names one host or source prints before the list folds. The JSON and Markdown keep every one. */
const GAP_CAP = 12;

/** An env token, else the one `gh` already holds: the unauthenticated limit is 60 calls an hour. */
let ghToken: string | null | undefined;
function githubToken(): string | null {
  const env = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (env) return env;
  if (ghToken === undefined) {
    try {
      ghToken = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
    } catch { ghToken = null; }
  }
  return ghToken;
}

interface FetchFailure { status: SourceStatus; reason: string }

/** A 404 on the pin means upstream deleted or rewrote that revision; a 403 is GitHub's hourly limit. */
function classifyFetch(e: unknown, ref: string): FetchFailure {
  const msg = e instanceof Error ? e.message : String(e);
  const code = /HTTP (\d{3})/.exec(msg)?.[1];
  if (code === '404') return { status: 'pin-missing', reason: `${ref} is gone upstream (404)` };
  if (code === '403' || code === '429') return { status: 'offline', reason: `GitHub rate limit (${code}); set GITHUB_TOKEN to lift it` };
  if (code) return { status: 'error', reason: `HTTP ${code} reading ${ref}` };
  return { status: 'error', reason: msg.slice(0, 80) };
}

interface TreeResult { entries: Map<string, string> | null; failure: FetchFailure | null }

/**
 * One commit's tree as path → blob sha. A cached tree is used whenever the live read fails, but the failure is
 * still reported, so a rate-limited run never passes for a clean one.
 */
async function treeOf(repo: string, ref: string): Promise<TreeResult> {
  const cacheDir = path.join(upstreamDir(), 'trees');
  const immutable = /^[0-9a-f]{7,40}$/i.test(ref);
  const cacheFile = path.join(cacheDir, `${repo.replace('/', '-')}@${ref}.json`);
  const cached = parseJsonObject<{ entries?: Array<[string, string]>; fetchedAt?: number }>(await readTextIfExists(cacheFile));
  if (cached?.entries && (immutable || (cached.fetchedAt ?? 0) > Date.now() - HEAD_TTL_MS)) {
    // A hit keeps the file alive so an abandoned pin ages out instead of sitting forever.
    if (immutable) await fs.utimes(cacheFile, new Date(), new Date()).catch(() => { });
    return { entries: new Map(cached.entries), failure: null };
  }
  const token = githubToken();
  try {
    const json = await fetchJson<{ tree?: Array<{ path: string; type: string; sha: string }> }>(
      `${GH}/repos/${repo}/git/trees/${ref}?recursive=1`,
      token ? { headers: { Authorization: `Bearer ${token}` } } : {},
    );
    const entries = (json.tree ?? []).filter((e) => e.type === 'blob').map((e) => [e.path, e.sha] as [string, string]);
    await fs.mkdir(cacheDir, { recursive: true }).catch(() => {});
    await fs.writeFile(cacheFile, `${JSON.stringify({ entries, fetchedAt: Date.now() })}\n`, 'utf8').catch(() => {});
    await pruneTrees(cacheDir).catch(() => { });
    return { entries: new Map(entries), failure: null };
  } catch (e) {
    // Drift is best-effort: an unreachable API must not erase a figure that was already measured.
    return { entries: cached?.entries ? new Map(cached.entries) : null, failure: classifyFetch(e, ref) };
  }
}

/** Drop the tree cache of pins nobody reads. An immutable pin's tree is kept while its pin file stays. */
async function pruneTrees(cacheDir: string): Promise<void> {
  for (const name of await fs.readdir(cacheDir)) {
    if (!name.endsWith('.json') || name.includes('@HEAD')) continue;
    const stat = await fs.stat(path.join(cacheDir, name)).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs > TREE_TTL_MS) await fs.rm(path.join(cacheDir, name), { force: true });
  }
}

/** When a revision was committed, so a pin's age is visible. */
async function dateOf(repo: string, ref: string): Promise<number | null> {
  try {
    const token = githubToken();
    const json = await fetchJson<{ commit?: { committer?: { date?: string } } }>(`${GH}/repos/${repo}/commits/${ref}`, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
    const at = json.commit?.committer?.date;
    return at ? Date.parse(at) : null;
  } catch {
    return null;
  }
}

/** The newest commit under a path: the candidate for a commit pin. */
async function newestCommitUnder(repo: string, under: string): Promise<string | null> {
  try {
    const token = githubToken();
    const json = await fetchJson<Array<{ sha?: string }>>(`${GH}/repos/${repo}/commits?path=${encodeURIComponent(under)}&per_page=1`, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
    return json[0]?.sha ?? null;
  } catch {
    return null;
  }
}

/** The head of an upstream file, so a review reads what moved. */
async function previewOf(repo: string, ref: string, file: string): Promise<Preview | null> {
  try {
    const lines = (await httpsGet(`${RAW}/${repo}/${ref}/${file}`)).split('\n');
    return { path: file, lines: lines.length, head: lines.slice(0, 12).join('\n') };
  } catch {
    return null;
  }
}

/** The newest release a repository publishes, or null when the feed cannot be read. */
async function latestRelease(repo: string): Promise<string | null> {
  try {
    const token = githubToken();
    const json = await fetchJson<{ tag_name?: string }>(`${GH}/repos/${repo}/releases/latest`, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
    const tag = json.tag_name ?? '';
    return tag ? tag.replace(/^v/, '') : null;
  } catch {
    return null;
  }
}
interface Drift { changed: string[]; added: string[]; gone: string[] }

/** The directory a source's skills live in: the common parent of every tracked directory. */
export function skillRoot(upstreamPaths: string[]): string {
  const dirs = [...new Set(upstreamPaths.map((up) => path.posix.dirname(up)))];
  if (dirs.length === 0) return '';
  let parts = dirs[0].split('/');
  for (const dir of dirs.slice(1)) {
    const other = dir.split('/');
    let i = 0;
    while (i < parts.length && i < other.length && parts[i] === other[i]) i++;
    parts = parts.slice(0, i);
  }
  return parts.join('/');
}

/** The skill directories upstream publishes that this port does not carry, and how many of them moved since the pin. */
export function uncarriedOf(pinned: TreeResult, head: TreeResult, upstreamPaths: string[], root: string): { count: number; moved: number } {
  const headTree = head.entries;
  const pinTree = pinned.entries;
  if (!headTree || !root) return { count: 0, moved: 0 };
  const carried = new Set(upstreamPaths.map((up) => path.posix.dirname(up)));
  const dirs = new Map<string, string[]>();
  for (const [p] of headTree) {
    if (!p.startsWith(`${root}/`)) continue;
    const dir = `${root}/${p.slice(root.length + 1).split('/')[0]}`;
    if (carried.has(dir)) continue;
    dirs.set(dir, [...(dirs.get(dir) ?? []), p]);
  }
  let moved = 0;
  for (const files of dirs.values()) {
    if (!pinTree) continue;
    const existed = files.some((f) => pinTree.has(f));
    const changed = files.some((f) => pinTree.has(f) && pinTree.get(f) !== headTree.get(f));
    if (existed && changed) moved++;
  }
  return { count: dirs.size, moved };
}

/**
 * Changed, added, and removed upstream paths. Added means a file inside a directory this build already
 * tracks, which is the signal a new playbook, reference, or principle leaf exists upstream.
 */
export function driftOf(pinned: TreeResult, head: TreeResult, upstreamPaths: string[]): Drift {
  const none: Drift = { changed: [], added: [], gone: [] };
  if (!pinned.entries || !head.entries) return none;
  const tracked = new Set(upstreamPaths);
  const dirs = new Set([...tracked].map((up) => `${path.posix.dirname(up)}/`));
  // A new skill directory sits beside the tracked ones, so the parent of a tracked directory is watched too.
  for (const dir of [...dirs]) {
    const parent = path.posix.dirname(dir);
    if (parent && parent !== '.' && parent !== '/') dirs.add(`${parent}/`);
  }
  const changed: string[] = [];
  const gone: string[] = [];
  for (const up of tracked) {
    const before = pinned.entries.get(up);
    const now = head.entries.get(up);
    if (before === now) continue;
    if (now === undefined) gone.push(up);
    else changed.push(up);
  }
  const added: string[] = [];
  for (const up of head.entries.keys()) {
    if (tracked.has(up) || pinned.entries.has(up)) continue;
    if ([...dirs].some((dir) => up.startsWith(dir))) added.push(up);
  }
  return { changed: changed.toSorted(), added: added.toSorted(), gone: gone.toSorted() };
}

interface RawText { text: string | null; failure: FetchFailure | null }

/** A pinned body, or the reason it could not be read. */
async function rawAt(url: string, ref: string): Promise<RawText> {
  try {
    return { text: await httpsGet(url), failure: null };
  } catch (e) {
    return { text: null, failure: classifyFetch(e, ref) };
  }
}

/** The one-line note for a table cell: the loudest gap, and nothing else. */
function noteOf(failure: FetchFailure | null, gaps: string[], moved: string[]): string {
  if (failure) return failure.reason;
  if (gaps.length) return gaps[0];
  if (moved.length) return `upstream moved: ${moved[0]}`;
  return '';
}

/** The end-of-central-directory record, read from the tail of the archive. */
const ZIP_EOCD = 0x06054b50;
const ZIP_CENTRAL = 0x02014b50;

/** Every file in a zip archive, by its path inside it. Deflate and stored entries are read. */
export function zipEntries(archive: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let eocd = -1;
  for (let i = archive.length - 22; i >= 0 && i > archive.length - 22 - 0xffff; i--) {
    if (archive.readUInt32LE(i) === ZIP_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) return out;
  const count = archive.readUInt16LE(eocd + 10);
  let at = archive.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (at + 46 > archive.length || archive.readUInt32LE(at) !== ZIP_CENTRAL) break;
    const method = archive.readUInt16LE(at + 10);
    const compressedSize = archive.readUInt32LE(at + 20);
    const nameLength = archive.readUInt16LE(at + 28);
    const extraLength = archive.readUInt16LE(at + 30);
    const commentLength = archive.readUInt16LE(at + 32);
    const local = archive.readUInt32LE(at + 42);
    const name = archive.toString('utf8', at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    const localNameLength = archive.readUInt16LE(local + 26);
    const localExtraLength = archive.readUInt16LE(local + 28);
    const start = local + 30 + localNameLength + localExtraLength;
    const data = archive.subarray(start, start + compressedSize);
    out.set(name, method === 0 ? Buffer.from(data) : inflateRawSync(data));
  }
  return out;
}

/** The Caveman body as the pinned release ships it, read from the release asset and not the repository. */
async function cavemanAssetBody(): Promise<{ text: string | null; failure: FetchFailure | null }> {
  try {
    const token = githubToken();
    const release = await fetchJson<{ assets?: Array<{ name?: string; browser_download_url?: string }> }>(
      `${GH}/repos/${CAVEMAN_REPO}/releases/tags/${CAVEMAN_PIN}`,
      token ? { headers: { Authorization: `Bearer ${token}` } } : {},
    );
    const asset = release.assets?.find((a) => a.name === 'caveman.skill');
    if (!asset?.browser_download_url) return { text: null, failure: { status: 'error', reason: `the ${CAVEMAN_PIN} release ships no caveman.skill` } };
    const entries = zipEntries(await httpsGetBuffer(asset.browser_download_url));
    const body = entries.get('caveman/SKILL.md');
    if (!body) return { text: null, failure: { status: 'error', reason: 'the caveman.skill asset carries no caveman/SKILL.md' } };
    return { text: body.toString('utf8'), failure: null };
  } catch (e) {
    return { text: null, failure: classifyFetch(e, 'the Caveman release asset') };
  }
}

/** What the release asset says about the bundled body: a gap, or null when the body is the one the release ships. */
export function cavemanAssetGap(assetText: string, local: string | null): string | null {
  if (local === null) return 'caveman/rule.md is missing locally';
  if (gitBlobSha(local) !== gitBlobSha(adaptCavemanFull(assetText))) return 'caveman/rule.md differs from the release asset';
  return null;
}

/** Caveman: three bodies track upstream, three are Tersio's own. Drift is a changed upstream body. */
async function checkCaveman(): Promise<SourceRow> {
  const [pinned, head, asset] = await Promise.all([treeOf(CAVEMAN_REPO, CAVEMAN_PIN), treeOf(CAVEMAN_REPO, 'HEAD'), cavemanAssetBody()]);
  const gaps: string[] = [];
  const bodies = await Promise.all(CAVEMAN.files.map(async (file) => {
    const at = await rawAt(`${RAW}/${CAVEMAN_REPO}/${CAVEMAN_PIN}/${file.upstream}`, CAVEMAN_PIN);
    if (at.text === null) return { failure: at.failure, why: `${file.upstream} is unreadable at the pin` };
    const local = await readTextIfExists(sourcePath(file.local));
    if (local === null) return { failure: null, why: `${file.local} is missing locally` };
    const expected = file.adapt ? file.adapt(at.text) : at.text;
    if (gitBlobSha(local) !== gitBlobSha(expected)) return { failure: null, why: `${file.local} differs from the pin` };
    // The full body also has to be the one the release ships, so a mutated archive cannot read clean.
    if (file.local === 'caveman/rule.md' && asset.text !== null) {
      const gap = cavemanAssetGap(asset.text, local);
      if (gap) return { failure: null, why: gap };
    }
    return { failure: null, why: null };
  }));
  let matched = 0;
  for (const body of bodies) {
    if (body.why === null) matched++;
    else gaps.push(body.why);
  }
  if (asset.text === null) gaps.push(asset.failure?.reason ?? 'the caveman.skill asset could not be read');
  for (const local of CAVEMAN.localOnly) {
    if ((await readTextIfExists(sourcePath(local))) !== null) matched++;
    else gaps.push(`${local} is missing locally`);
  }
  const failure = bodies.find((b) => b.failure)?.failure ?? pinned.failure ?? head.failure ?? asset.failure;
  const drift = driftOf(pinned, head, CAVEMAN.files.map((f) => f.upstream));
  const uncarried = uncarriedOf(pinned, head, CAVEMAN.files.map((f) => f.upstream), skillRoot(CAVEMAN.files.map((f) => f.upstream)));
  const release = await latestRelease(CAVEMAN_REPO);
  const pinnedVersion = CAVEMAN_PIN.replace(/^v/, '');
  const previews = (await Promise.all(drift.changed.map((file) => previewOf(CAVEMAN_REPO, 'HEAD', file)))).filter((x): x is Preview => x !== null);
  return {
    source: CAVEMAN.label,
    pin: pinnedVersion,
    upstream: release ?? 'unknown',
    tracked: CAVEMAN.files.length + CAVEMAN.localOnly.length,
    matched,
    drift: drift.changed.length + drift.gone.length,
    added: drift.added.length,
    removed: drift.gone.length,
    ceiling: CAVEMAN.driftCeiling,
    measured: failure === null,
    status: failure ? failure.status : 'ok',
    kind: 'bytes',
    link: compareUrl(CAVEMAN_REPO, CAVEMAN_PIN),
    gaps,
    moved: drift.changed,
    appeared: drift.added,
    gone: drift.gone,
    uncarried: uncarried.count,
    uncarriedMoved: uncarried.moved,
    pinnedAt: await dateOf(CAVEMAN_REPO, CAVEMAN_PIN),
    candidate: release && release !== pinnedVersion ? `v${release}` : null,
    preview: previews,
    note: release && release !== pinnedVersion ? `release ${release} is out` : noteOf(failure, gaps, drift.changed),
  };
}

/** pstack: every body is a declared fork, so presence is the match and drift is the review signal. */
async function checkPstack(): Promise<SourceRow> {
  const [pinned, head] = await Promise.all([treeOf(PSTACK_REPO, PSTACK_PIN), treeOf(PSTACK_REPO, 'HEAD')]);
  const gaps: string[] = [];
  let matched = 0;
  for (const file of PSTACK.files) {
    const local = await readTextIfExists(sourcePath(`pstack/${file.local}`));
    // A fork is matched by presence: every body had Cursor's surface stripped, so no byte comparison exists.
    if (local === null) gaps.push(`${file.local} is missing locally`);
    else if (local.trim() === '') gaps.push(`${file.local} is empty`);
    else matched++;
  }
  const failure = pinned.failure ?? head.failure;
  const drift = driftOf(pinned, head, PSTACK.files.map((f) => f.upstream));
  const uncarried = uncarriedOf(pinned, head, PSTACK.files.map((f) => f.upstream), skillRoot(PSTACK.files.map((f) => f.upstream)));
  const candidate = await newestCommitUnder(PSTACK_REPO, 'pstack');
  const previews = (await Promise.all([...drift.changed, ...drift.added].slice(0, 6).map((file) => previewOf(PSTACK_REPO, 'HEAD', file)))).filter((x): x is Preview => x !== null);
  return {
    source: PSTACK.label,
    pin: PSTACK.pin.slice(0, 7),
    upstream: candidate ?? 'HEAD',
    tracked: PSTACK.files.length,
    matched,
    drift: drift.changed.length + drift.gone.length,
    added: drift.added.length,
    removed: drift.gone.length,
    ceiling: PSTACK.driftCeiling,
    measured: failure === null,
    status: failure ? failure.status : 'ok',
    kind: 'presence',
    link: compareUrl(PSTACK_REPO, PSTACK_PIN),
    gaps,
    moved: drift.changed,
    appeared: drift.added,
    gone: drift.gone,
    uncarried: uncarried.count,
    uncarriedMoved: uncarried.moved,
    pinnedAt: await dateOf(PSTACK_REPO, PSTACK_PIN),
    candidate: candidate && candidate !== PSTACK_PIN ? candidate : null,
    preview: previews,
    note: noteOf(failure, gaps, drift.changed) || 'fork: Cursor surface removed',
  };
}

/** Every file in the vendored copy, as paths under its root. */
function vendoredFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), child);
      else out.push(child);
    }
  };
  walk(root, '');
  return out.toSorted();
}

/** One vendored file against the package's own hash: a match, or the gap it is. */
export function vendoredVerdict(rel: string, bytes: Buffer | null, integrity: string | undefined, version: string): string | null {
  if (bytes === null) return `${rel} is missing from the vendored copy`;
  if (!integrity) return `${rel} is not in the package at ${version}`;
  const ours = createHash('sha256').update(bytes).digest('base64');
  return ours === integrity.replace(/^sha256-/, '') ? null : `${rel} differs from the package at ${version}`;
}

/** The vendored copy against the package it declares: a hand edit there is invisible to the host copies. */
async function checkVendored(root: string, version: string): Promise<{ matched: number; total: number; gaps: string[]; failure: FetchFailure | null }> {
  const files = vendoredFiles(root);
  let manifest: Map<string, string>;
  try {
    const json = await fetchJson<{ files?: Array<{ path?: string; integrity?: string }> }>(`${UNPKG}/${PONYTAIL_PKG}@${version}/?meta`);
    manifest = new Map((json.files ?? []).map((f) => [String(f.path ?? '').replace(/^\//, ''), String(f.integrity ?? '')]));
  } catch (e) {
    return { matched: 0, total: files.length, gaps: [], failure: classifyFetch(e, `the package at ${version}`) };
  }
  const gaps: string[] = [];
  let matched = 0;
  for (const rel of files) {
    const bytes = await fs.readFile(path.join(root, ...rel.split('/'))).catch(() => null);
    const gap = vendoredVerdict(rel, bytes, manifest.get(rel), version);
    if (gap) gaps.push(gap);
    else matched++;
  }
  return { matched, total: files.length, gaps, failure: null };
}

/** Ponytail: the vendored copy is the source of truth, and each host's copy must match it. */
async function checkPonytail(hosts: HostRow[]): Promise<SourceRow> {
  const bundled = PONYTAIL_VERSION;
  const root = PONYTAIL_DIR;
  const copies: Array<{ dir: string; files: readonly string[] }> = [];
  for (const host of hosts) {
    if (!host.installed) continue;
    if (host.host === 'opencode') copies.push({ dir: path.join(hostExtensionsDir('opencode'), 'ponytail-bundle'), files: PONYTAIL_BUNDLE_FILES });
    if (host.host === 'pi') copies.push({ dir: path.join(piAgentDir(), 'ponytail'), files: PI_PONYTAIL_FILES });
  }
  let tracked = 0;
  let matched = 0;
  const gaps: string[] = [];
  const vendored = root ? await checkVendored(root, bundled ?? 'latest') : { matched: 0, total: 0, gaps: [] as string[], failure: null };
  tracked += vendored.total;
  matched += vendored.matched;
  gaps.push(...vendored.gaps);
  for (const copy of copies) {
    for (const rel of copy.files) {
      tracked++;
      const theirs = root ? await readTextIfExists(path.join(root, ...rel.split('/'))) : null;
      const ours = await readTextIfExists(path.join(copy.dir, ...rel.split('/')));
      if (theirs === null) gaps.push(`${rel} is missing from the installed package`);
      else if (ours === null) gaps.push(`${path.basename(copy.dir)}/${rel} is missing`);
      else if (ours !== theirs) gaps.push(`${path.basename(copy.dir)}/${rel} differs from the package`);
      else matched++;
    }
  }
  let latest: string | null = null;
  let failure: FetchFailure | null = vendored.failure;
  try {
    latest = (await fetchJson<{ version?: string }>(PONYTAIL_NPM)).version ?? null;
  } catch (e) { failure = failure ?? classifyFetch(e, 'the npm registry'); }
  const drift = bundled && latest && bundled !== latest;
  return {
    source: 'Ponytail',
    pin: bundled ?? 'missing',
    upstream: latest ?? 'unknown',
    tracked,
    matched,
    drift: drift ? 1 : 0,
    added: 0,
    removed: 0,
    ceiling: 0,
    measured: failure === null,
    status: failure ? failure.status : 'ok',
    kind: 'bytes',
    link: bundled ? releaseUrl(PONYTAIL_REPO, bundled) : '',
    gaps,
    moved: [],
    appeared: [],
    gone: [],
    uncarried: 0,
    uncarriedMoved: 0,
    pinnedAt: null,
    candidate: drift ? latest : null,
    preview: [],
    note: failure ? failure.reason : drift ? `bundled ${bundled} is behind ${latest}` : noteOf(null, gaps, []),
  };
}

/** RTK: the binary's own version is the fact; the release feed is the drift. */
async function checkRtk(): Promise<SourceRow> {
  const bin = resolveRtkBinary();
  let local: string | null = null;
  if (bin) {
    try {
      const shim = shimCommand(bin, ['--version']);
      local = normalizeRtkVersion(execFileSync(shim.cmd, shim.args, { encoding: 'utf8', timeout: 5000, windowsHide: true })) || null;
    } catch { local = null; }
  }
  let latest: string | null = null;
  let failure: FetchFailure | null = null;
  try {
    const token = githubToken();
    const release = await fetchJson<{ tag_name?: string }>(RTK_RELEASE_API, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
    latest = normalizeRtkVersion(release.tag_name) || null;
  } catch (e) { failure = classifyFetch(e, 'the RTK release feed'); }
  const behind = local && latest && local !== latest;
  return {
    source: 'RTK',
    pin: local ?? 'not installed',
    upstream: latest ?? 'unknown',
    // An absent binary has no bytes to compare, so it is not a miss; the pin column already says "not installed".
    tracked: local === null ? 0 : 1,
    matched: local === null ? 0 : 1,
    drift: behind ? 1 : 0,
    added: 0,
    removed: 0,
    ceiling: 0,
    measured: failure === null,
    status: failure ? failure.status : 'ok',
    kind: 'version',
    link: local ? releaseUrl(RTK_REPO, local) : '',
    gaps: local === null ? ['the rtk binary is not on PATH'] : [],
    moved: [],
    appeared: [],
    gone: [],
    uncarried: 0,
    uncarriedMoved: 0,
    pinnedAt: null,
    candidate: behind ? latest : null,
    preview: [],
    note: failure ? failure.reason : behind ? `installed ${local} is behind ${latest}` : local === null ? 'binary not on PATH' : '',
  };
}

/**
 * The extension entries an installed package manifest loads, or null when the host keeps none.
 * A host can carry every file and still never load one, because the manifest is what names them.
 */
async function loadedEntries(extensionsDir: string): Promise<string[] | null> {
  const pkg = parseJsonObject<{ omp?: { extensions?: unknown } }>(await readTextIfExists(path.join(extensionsDir, '..', 'package.json')));
  const list = pkg?.omp?.extensions;
  return Array.isArray(list) ? list.map((entry) => String(entry)) : null;
}

/** What repairs a host's stale files: an install behind this build needs the install, the other way needs the update. */
export function hostFix(id: string, version: string | null): string {
  const tag = readState().cavemanUpstream?.tag;
  if (tag && newerThan(tag, CAVEMAN_PIN)) return `the installed body is from ${tag}, this build ships ${CAVEMAN_PIN.replace(/^v/, '')} — review the diff and bump the pin`;
  if (version && newerThan(PACKAGE_VERSION, version)) return `run: tersio install --host ${id}`;
  if (version && newerThan(version, PACKAGE_VERSION)) return 'run: tersio update';
  return `run: tersio install --host ${id}`;
}

/**
 * Codex: the installed plugin against the file set this build writes. The bundled layout embeds
 * this machine's Node and launcher paths in its MCP entry and hooks, so those two files are checked
 * for presence; every other body is compared byte for byte.
 */
async function checkCodexHost(): Promise<HostRow> {
  // A partial download is still a plugin on disk, so its missing bytes stay visible instead of reading as absent.
  const dir = codexInstalledPlugin()?.dir ?? codexExistingPluginDirs()[0] ?? null;
  if (dir === null) {
    const files = codexPluginFilesForLayout('bundled').length;
    return { host: 'codex', installed: false, files, matched: 0, stale: 0, missing: 0, staleFiles: [], missingFiles: [], unloaded: [], fix: '' };
  }
  const state = codexPluginState(dir);
  const layout = state.layout;
  const expected = codexPluginFiles(layout === 'bundled');
  const pathDependent = layout === 'bundled' ? new Set(['.mcp.json', 'hooks/hooks.json']) : new Set<string>();
  let matched = 0;
  const staleFiles: string[] = [];
  const missingFiles: string[] = [];
  for (const rel of codexPluginFilesForLayout(layout)) {
    const theirs = await readTextIfExists(path.join(dir, ...rel.split('/')));
    if (theirs === null) {
      missingFiles.push(rel);
      continue;
    }
    // A copied body compares to the extension tree; a build-only file, such as `dist/`, has none.
    const ours = expected[rel] ?? (rel.startsWith('extensions/') ? treeFileText(rel.slice('extensions/'.length)) : null);
    if (pathDependent.has(rel) || ours === null || ours === theirs) matched++;
    else staleFiles.push(rel);
  }
  return {
    host: 'codex',
    installed: true,
    files: matched + staleFiles.length + missingFiles.length,
    matched,
    stale: staleFiles.length,
    missing: missingFiles.length,
    staleFiles: staleFiles.toSorted(),
    missingFiles: missingFiles.toSorted(),
    unloaded: [],
    fix: hostFix('codex', state.version),
  };
}

/** Per host: does the tree each agent loads carry this build's bytes, and does its manifest load every entry? */
export async function checkHosts(): Promise<HostRow[]> {
  const rows: HostRow[] = [];
  for (const host of detectHosts()) {
    if (host.id === 'codex') {
      rows.push(await checkCodexHost());
      continue;
    }
    const treeId = host.id === 'omp' ? 'opencode' : host.id;
    const base = host.id === 'omp' ? (host.dir ? path.join(host.dir, 'extensions') : null) : hostExtensionsDir(host.id);
    if (!host.installed || !base) {
      rows.push({ host: host.id, installed: false, files: treeFilesFor(treeId).length, matched: 0, stale: 0, missing: 0, staleFiles: [], missingFiles: [], unloaded: [], fix: '' });
      continue;
    }
    const shipped = shippedOmpManifest()?.extensions;
    const loaded = await loadedEntries(base);
    const unloaded = Array.isArray(shipped) && loaded
      ? shipped.map((entry) => String(entry)).filter((entry) => !loaded.includes(entry))
      : [];
    let matched = 0;
    const staleFiles: string[] = [];
    const missingFiles: string[] = [];
    for (const rel of treeFilesFor(treeId)) {
      const expected = treeFileText(rel);
      if (expected === null) continue;
      const theirs = await readTextIfExists(path.join(base, ...rel.split('/')));
      if (theirs === null) missingFiles.push(rel);
      else if (theirs === expected) matched++;
      else staleFiles.push(rel);
    }
    rows.push({
      host: host.id,
      installed: true,
      files: matched + staleFiles.length + missingFiles.length,
      matched,
      stale: staleFiles.length,
      missing: missingFiles.length,
      staleFiles: staleFiles.toSorted(),
      missingFiles: missingFiles.toSorted(),
      unloaded,
      fix: hostFix(host.id, host.version),
    });
  }
  return rows;
}

/** A host carrying a stale or missing file: a real fault, so it fails even a plain run. */
export function hostBroken(card: Scorecard): boolean {
  return card.hosts.some((h) => h.installed && (h.stale > 0 || h.missing > 0));
}

/** Every reason the gate would fail, in the order an operator would fix them. One list, so the print and the exit code never disagree. */
export function gateReasons(card: Scorecard, strict: boolean): string[] {
  const ceiling = card.sources.reduce((sum, r) => sum + r.ceiling, 0);
  const reasons: string[] = [];
  for (const h of card.hosts) {
    if (!h.installed) continue;
    if (h.missing > 0) reasons.push(`${h.host}: ${h.missing} installed file(s) missing`);
    if (h.stale > 0) reasons.push(`${h.host}: ${h.stale} installed file(s) stale`);
    if (h.unloaded.length > 0) reasons.push(`${h.host}: ${h.unloaded.length} extension(s) not in its manifest, so they never load`);
  }
  for (const r of card.sources) {
    if (r.status === 'pin-missing') reasons.push(`${r.source}: the pinned revision is gone upstream`);
    if (r.matched < r.tracked) reasons.push(`${r.source}: ${r.tracked - r.matched} of ${r.tracked} tracked file(s) do not match`);
  }
  if (card.accuracy < 100) reasons.push(`accuracy ${card.accuracy}% is below 100%`);
  if (strict) {
    if (card.drift > ceiling) reasons.push(`drift ${card.drift} is past the reviewed ceiling of ${ceiling}`);
    // A rate-limited or unreachable run cannot prove upstream is unchanged, so strict fails rather than passing on silence.
    for (const r of card.sources) if (r.status !== 'ok') reasons.push(`${r.source}: ${r.status}, so upstream is unproven`);
  }
  return reasons;
}

/** The automation gate. `--check` fails on any gap of ours; `--strict` also fails on drift past the reviewed ceiling. */
export function gateFails(card: Scorecard, strict: boolean): boolean {
  return gateReasons(card, strict).length > 0;
}

/** Overall accuracy: files that match over files that should. Drift stays out of it, since drift is upstream's move, not ours. */
export function accuracyOf(rows: SourceRow[], hosts: HostRow[]): number {
  const installed = hosts.filter((h) => h.installed);
  const tracked = rows.reduce((sum, r) => sum + r.tracked, 0) + installed.reduce((sum, h) => sum + h.files, 0);
  if (tracked === 0) return 100;
  const matched = rows.reduce((sum, r) => sum + r.matched, 0) + installed.reduce((sum, h) => sum + h.matched, 0);
  return Math.round((matched / tracked) * 1000) / 10;
}

/** One source failing to reach its upstream leaves a row that says so; it never sinks the whole scorecard. */
async function rowOrFailure(label: string, probe: () => Promise<SourceRow>): Promise<SourceRow> {
  try {
    return await probe();
  } catch (e) {
    return {
      source: label, pin: '—', upstream: 'unreachable', tracked: 0, matched: 0, drift: 0, added: 0, removed: 0,
      ceiling: 0, measured: false, status: classifyFetch(e, label).status, kind: 'bytes', link: '',
      gaps: [classifyFetch(e, label).reason], moved: [], appeared: [], gone: [], uncarried: 0, uncarriedMoved: 0,
      pinnedAt: null, candidate: null, preview: [],
      note: classifyFetch(e, label).reason,
    };
  }
}

async function collect(): Promise<Scorecard> {
  const hosts = await checkHosts();
  const [caveman, pstack, ponytail, rtk] = await Promise.all([
    rowOrFailure('Caveman', checkCaveman),
    rowOrFailure('pstack', checkPstack),
    rowOrFailure('Ponytail', () => checkPonytail(hosts)),
    rowOrFailure('RTK', checkRtk),
  ]);
  const sources = [caveman, pstack, rtk, ponytail];
  const card: Scorecard = {
    version: PACKAGE_VERSION,
    checkedAt: Date.now(),
    sources,
    hosts,
    accuracy: accuracyOf(sources, hosts),
    drift: sources.reduce((sum, r) => sum + r.drift, 0),
  };
  await writeHistory(card);
  return card;
}

/** The UTC stamp both reports print, so a cron log and the Markdown agree to the second. */
function stamp(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

/** A 20-cell bar, so a table row still shows a shape when the file is read as plain text. */
function bar(part: number, whole: number): string {
  if (whole === 0) return '—';
  const filled = Math.round((part / whole) * 20);
  return `${'█'.repeat(filled)}${'░'.repeat(20 - filled)}`;
}

/** One named gap: what it is, where it is, and whose move it was. */
interface Gap { group: string; kind: 'ours' | 'drift' | 'unmeasured'; text: string }

/**
 * Every gap in the run, ours first: a body of ours that drifted from the pin is actionable today, an upstream
 * file that moved is a review to schedule, and an unmeasured source is a run to repeat with a token.
 */
export function gapsOf(card: Scorecard): Gap[] {
  const out: Gap[] = [];
  for (const r of card.sources) {
    if (r.status !== 'ok') out.push({ group: r.source, kind: 'unmeasured', text: r.note || r.status });
    for (const gap of r.gaps) out.push({ group: r.source, kind: 'ours', text: gap });
  }
  for (const h of card.hosts) {
    if (!h.installed) continue;
    for (const rel of h.missingFiles) out.push({ group: h.host, kind: 'ours', text: `missing: ${rel}` });
    for (const rel of h.staleFiles) out.push({ group: h.host, kind: 'ours', text: `stale: ${rel}` });
    for (const entry of h.unloaded) out.push({ group: h.host, kind: 'ours', text: `not loaded: ${entry}` });
  }
  for (const r of card.sources) {
    for (const up of r.moved) out.push({ group: r.source, kind: 'drift', text: `moved upstream: ${up}` });
    for (const up of r.appeared) out.push({ group: r.source, kind: 'drift', text: `new upstream: ${up}` });
    for (const up of r.gone) out.push({ group: r.source, kind: 'drift', text: `gone upstream: ${up}` });
  }
  return out;
}

/** The gaps of one kind, grouped by the source or host they belong to, in first-seen order. */
function grouped(gaps: Gap[]): Array<[string, Gap[]]> {
  const byOwner = new Map<string, Gap[]>();
  for (const gap of gaps) byOwner.set(gap.group, [...(byOwner.get(gap.group) ?? []), gap]);
  return [...byOwner];
}

/** A gap list, folded to the first `GAP_CAP` names so a wholly stale host cannot flood a terminal. */
function folded(items: string[]): string[] {
  if (items.length <= GAP_CAP) return items;
  return [...items.slice(0, GAP_CAP), `+${items.length - GAP_CAP} more, in the Markdown report`];
}

/** The Markdown report: tables for the numbers, the gap list in full, Mermaid for the shape. Written beside the JSON cache. */
export function scorecardMarkdown(card: Scorecard): string {
  const when = stamp(card.checkedAt);
  const ceiling = card.sources.reduce((sum, r) => sum + r.ceiling, 0);
  const lines: string[] = [
    `# Tersio upstream scorecard`,
    '',
    `Tersio v${card.version} · checked ${when} UTC`,
    '',
    `**Accuracy ${card.accuracy}%** · **drift ${card.drift}** file${card.drift === 1 ? '' : 's'} since the pin (reviewed ceiling ${ceiling})`,
    '',
    '## Sources of truth',
    '',
    '| Source | Pinned | Upstream | Match | Drift | New | Gone | Uncarried | How | Note |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of card.sources) {
    const uncarried = r.uncarried ? `${r.uncarried}${r.uncarriedMoved ? ` (${r.uncarriedMoved} moved)` : ''}` : '—';
    lines.push(`| ${r.source} | ${r.pin} | ${r.upstream} | ${r.matched}/${r.tracked} | ${r.drift}/${r.ceiling} | ${r.added} | ${r.removed} | ${uncarried} | ${r.kind} | ${r.note || '—'} |`);
  }
  lines.push('', 'Match per source:', '', '```text');
  for (const r of card.sources) {
    lines.push(`${r.source.padEnd(9)} ${bar(r.matched, r.tracked)} ${r.tracked === 0 ? 'n/a' : `${Math.round((r.matched / r.tracked) * 100)}%`}`);
  }
  lines.push('```', '');
  lines.push('## Installed hosts', '', '| Host | Installed | Match | Stale | Missing | Unloaded |', '|---|---|---|---|---|---|');
  for (const h of card.hosts) {
    lines.push(`| ${h.host} | ${h.installed ? 'yes' : 'no'} | ${h.matched}/${h.files} | ${h.stale} | ${h.missing} | ${h.unloaded.length} |`);
  }
  const installed = card.hosts.filter((h) => h.installed);
  lines.push('', 'Files matching this build, per host:', '', '```text');
  if (installed.length === 0) lines.push('no host installed');
  for (const h of installed) lines.push(`${h.host.padEnd(9)} ${bar(h.matched, h.files)} ${Math.round((h.matched / h.files) * 100)}%`);
  lines.push('```', '');
  // One chart over every tracked unit: a source that matches and a host that does not read side by side.
  const units = [...card.sources.map((r) => ({ name: r.source, pct: r.tracked === 0 ? 100 : Math.round((r.matched / r.tracked) * 100) })), ...installed.map((h) => ({ name: h.host, pct: h.files === 0 ? 100 : Math.round((h.matched / h.files) * 100) }))];
  lines.push('## Match by unit', '', '```mermaid', 'xychart-beta', '  title "Files matching this build (%)"', `  x-axis [${units.map((u) => `"${u.name}"`).join(', ')}]`, '  y-axis "percent" 0 --> 100', `  bar [${units.map((u) => u.pct).join(', ')}]`, '```', '');
  const drifted = card.sources.filter((r) => r.drift > 0);
  if (drifted.length > 0) {
    lines.push('## Upstream drift', '', '```mermaid', 'xychart-beta', '  title "Files moved since the pin"', `  x-axis [${drifted.map((r) => `"${r.source}"`).join(', ')}]`, '  y-axis "files" 0 --> ' + Math.max(...drifted.map((r) => Math.max(r.drift, r.ceiling))) , `  bar [${drifted.map((r) => r.drift).join(', ')}]`, '```', '');
  }
  lines.push('## Gaps', '');
  const gaps = gapsOf(card);
  if (gaps.length === 0) {
    lines.push('No gaps: every tracked body matches its pin, and every installed host carries this build\'s bytes.', '');
  } else {
    for (const kind of ['ours', 'drift', 'unmeasured'] as const) {
      const group = gaps.filter((g) => g.kind === kind);
      if (group.length === 0) continue;
      lines.push(`### ${kind === 'ours' ? 'Ours to fix' : kind === 'drift' ? 'Upstream moved' : 'Unmeasured'}`, '');
      for (const [owner, items] of grouped(group)) {
        for (const gap of items) lines.push(`- **${owner}** ${gap.text}`);
        const row = card.sources.find((r) => r.source === owner);
        if (kind === 'drift' && row?.link) lines.push(`  Review the diff: ${row.link}`);
        const host = card.hosts.find((h) => h.host === owner);
        if (kind === 'ours' && host?.fix) lines.push(`  Fix: ${host.fix}`);
      }
      lines.push('');
    }
  }
  lines.push('## What the numbers mean', '');
  lines.push('- **Match** counts a file whose bytes equal its pin, or a declared fork that is present.');
  lines.push('- **Drift** counts upstream files that moved or vanished since the pin. It is upstream moving, not a Tersio fault.');
  lines.push('- **Ceiling** is the drift already reviewed when the pin was taken; `--strict` fails only above it.');
  lines.push('- **How** names the proof: `bytes` is byte equality with the pin, `presence` is a declared fork that must exist and be non-empty, `version` is a version comparison.');
  lines.push('- **Unmeasured** means the feed could not be read, so nothing is claimed; set `GITHUB_TOKEN` and rerun.');
  lines.push('- **Accuracy** is matched files over tracked files, sources plus installed hosts.');
  lines.push('');
  return lines.join('\n');
}

function printScorecard(card: Scorecard, cached: boolean, strict: boolean): void {
  console.log(`\nTersio upstream scorecard · v${card.version} · ${cached ? 'cached' : 'live'} · ${stamp(card.checkedAt)} UTC`);
  console.log('\nSources of truth');
  const sourceRows = card.sources.map((r) => [
    r.source, r.pin, r.upstream, `${r.matched}/${r.tracked}`, `${r.drift}/${r.ceiling}`, r.added ? `+${r.added}` : '0', String(r.removed),
    r.uncarried ? `${r.uncarried}${r.uncarriedMoved ? ` (${r.uncarriedMoved})` : ''}` : '—', r.kind, r.note || '—',
  ]);
  for (const line of textTable(['Source', 'Pinned', 'Upstream', 'Match', 'Drift', 'New', 'Gone', 'Uncarried', 'How', 'Note'], sourceRows, [false, false, false, true, true, true, true, false, false, false], 30)) {
    console.log(line);
  }
  console.log('\nInstalled hosts');
  const hostRows = card.hosts.map((h) => [h.host, h.installed ? 'yes' : 'no', `${h.matched}/${h.files}`, String(h.stale), String(h.missing), String(h.unloaded.length)]);
  for (const line of textTable(['Host', 'Installed', 'Match', 'Stale', 'Missing', 'Unloaded'], hostRows, [false, false, true, true, true, true])) {
    console.log(line);
  }
  const gaps = gapsOf(card);
  console.log('\nGaps');
  if (gaps.length === 0) console.log('  none · every tracked body matches its pin, and every installed host carries this build');
  for (const kind of ['ours', 'drift', 'unmeasured'] as const) {
    const group = gaps.filter((g) => g.kind === kind);
    if (group.length === 0) continue;
    console.log(`  ${kind === 'ours' ? 'ours to fix' : kind === 'drift' ? 'upstream moved' : 'unmeasured'}`);
    // A host can carry dozens of stale files; the print names the first few and the report keeps the rest.
    for (const [owner, items] of grouped(group)) {
      for (const text of folded(items.map((g) => g.text))) console.log(`    ${owner.padEnd(9)} ${text}`);
      const row = card.sources.find((r) => r.source === owner);
      if (kind === 'drift' && row?.link) console.log(`    ${''.padEnd(9)} review: ${row.link}`);
      const host = card.hosts.find((h) => h.host === owner);
      if (kind === 'ours' && host?.fix) console.log(`    ${''.padEnd(9)} fix: ${host.fix}`);
    }
  }
  const ceiling = card.sources.reduce((sum, r) => sum + r.ceiling, 0);
  const installed = card.hosts.filter((h) => h.installed);
  console.log(`\n  Accuracy ${card.accuracy}% · drift ${card.drift} since the pin (reviewed ceiling ${ceiling}) · ${installed.length} host${installed.length === 1 ? '' : 's'} installed`);
  const reasons = gateReasons(card, strict);
  if (reasons.length > 0) {
    console.log('  Gate:');
    for (const reason of reasons) console.log(`    ✗ ${reason}`);
    console.log('  Fix a gap of ours, then review the drift and bump the pin in cli/upstream.ts.');
  } else {
    console.log('  Gate: clear.');
  }
}

/** The scorecard command: read, cache, print, and gate. */
export async function runUpstream(): Promise<void> {
  await migrateLayout();
  const offline = args.includes('--offline');
  const json = args.includes('--json');
  const strict = args.includes('--strict');
  // Strict is check plus drift, so it arms the gate on its own; a report alone never fails.
  const check = args.includes('--check') || strict;
  const cacheFile = path.join(upstreamDir(), 'scorecard.json');
  let card: Scorecard | null = null;
  if (offline) card = parseJsonObject<Scorecard>(await readTextIfExists(cacheFile));
  else {
    try {
      card = await collect();
      await fs.mkdir(tersioHome(), { recursive: true }).catch(() => {});
      await fs.writeFile(cacheFile, `${JSON.stringify(card, null, 2)}\n`, 'utf8').catch(() => {});
    } catch (e) {
      console.error(`[warn] live check failed (${(e as Error).message}); reading the last scorecard`);
      card = parseJsonObject<Scorecard>(await readTextIfExists(cacheFile));
    }
  }
  if (!card) {
    console.error('[fail] No scorecard yet. Run `tersio upstream` with a network connection.');
    process.exitCode = 1;
    return;
  }
  if (json) console.log(JSON.stringify(card, null, 2));
  else printScorecard(card, offline, strict);
  if (!json) {
    // `--md <file>` writes where asked; the default lands beside the JSON cache so a rerun overwrites one file.
    const mdFile = flagValue('--md') ?? path.join(upstreamDir(), 'scorecard.md');
    await fs.mkdir(path.dirname(mdFile), { recursive: true }).catch(() => {});
    await fs.writeFile(mdFile, scorecardMarkdown(card), 'utf8').catch(() => {});
    console.log(`  Report: ${mdFile}`);
  }
  // A plain run only reports; --check, or --strict, turns a gap of ours, or drift past the ceiling, into a failure.
  if (check && gateFails(card, strict)) process.exitCode = 1;
}
