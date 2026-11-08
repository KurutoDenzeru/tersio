// The MCP server: one stdio endpoint so any MCP client can read Tersio's data and steer its modes.
import { createInterface } from 'node:readline';
import { readActivity } from './activity.ts';
import { CAVEMAN_DEFAULTS, COMBO_DEFAULTS, HEADROOM_DEFAULTS, PACKAGE_VERSION, PONYTAIL_DEFAULTS, PSTACK_DEFAULTS, RTK_DEFAULTS, execFileP } from './common.ts';
import { resolveHeadroomBinary } from '../extensions/shared/utils.ts';
import { formatCurrency, readStoredCurrency } from './currency.ts';
import { agentStats } from '../extensions/shared/agent-snapshot.ts';
import { detectHosts } from './hosts.ts';
import { applyComboPreset, formatProfile, saveHostDefaults, storedProfile, writePluginSettings } from './profile.ts';
import type { HostDefaultField } from './profile.ts';
import { isRangeKey, RANGES } from '../extensions/shared/agent-stats.ts';
import type { RangeKey } from '../extensions/shared/agent-types.ts';
import { readHeadroomSavings, readHeadroomStats } from '../extensions/shared/headroom-gain.ts';
import { headroomProxyUrl } from '../extensions/shared/headroom-proxy.ts';
import { describeHeadroomRoute, readHeadroomRoute } from '../extensions/shared/headroom-routing.ts';
import { hostCap } from '../extensions/shared/host-caps.ts';
import type { HostId } from '../extensions/shared/host-caps.ts';
import { tersioMcpConfigured, tersioMcpHosts } from '../extensions/shared/mcp-config.ts';
import { hostOfSessionFile } from '../extensions/shared/usage-ledger.ts';

/** The spec version this server speaks; a client asking for an older one it knows gets that back. */
const PROTOCOL_VERSION = '2025-06-18';
const SUPPORTED_PROTOCOLS: ReadonlySet<string> = new Set([PROTOCOL_VERSION, '2025-03-26', '2024-11-05']);

class RpcError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
  }
}

/** Compact counts for a model reading numbers: `2.9M`, not `2945123`. */
function shortCount(n: number): string {
  return n.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 });
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

interface StatsToolArgs {
  range?: unknown;
}

interface ActivityToolArgs {
  limit?: unknown;
}

interface HeadroomToolArgs {
  action?: string;
  suite?: string;
  hash?: unknown;
}

interface ModesToolArgs {
  combo?: unknown;
  caveman?: unknown;
  rtk?: unknown;
  ponytail?: unknown;
  pstack?: unknown;
  headroom?: unknown;
  /** One agent's own section, so a mode can differ per host. */
  host?: unknown;
}

/** One validated value per mode a call may set; null means the call left that mode alone. */
interface ModeWants {
  combo: string | null;
  caveman: string | null;
  rtk: 'on' | 'off' | null;
  ponytail: string | null;
  pstack: 'on' | 'off' | null;
  headroom: 'on' | 'off' | null;
}

/** The only stdout a client ever sees is the protocol, so a tool that prints (the settings save line) is captured and its text becomes the tool's answer. */
async function captureLog<T>(fn: () => Promise<T>): Promise<{ value: T; text: string }> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  try {
    const value = await fn();
    return { value, text: lines.join('\n') };
  } finally {
    console.log = original;
  }
}

function statsText(range: RangeKey): string {
  const stats = agentStats(range, 'summary');
  if (!stats.available) return `No agent data for ${range} yet. Stats appear once sessions run with Tersio installed.`;
  const currency = readStoredCurrency();
  const o = stats.overall;
  const lines = [
    `Tersio usage, last ${range}: ${o.requests.toLocaleString('en-US')} requests (${o.failed.toLocaleString('en-US')} failed, ${pct(o.errorRate)})`,
    `Tokens: ${shortCount(o.total)} total — ${shortCount(o.input)} in, ${shortCount(o.output)} out, ${shortCount(o.cacheRead)} cache read, ${shortCount(o.cacheWrite)} cache write`,
    `Cache rate: ${pct(o.cacheRate)} · API-equivalent cost: ${formatCurrency(o.costUsd, currency)} (${currency})`,
  ];
  for (const model of stats.topModels.slice(0, 3)) {
    lines.push(`Model ${model.key}: ${shortCount(model.total)} tokens, ${formatCurrency(model.costUsd, currency)}`);
  }
  for (const provider of stats.byProvider.slice(0, 3)) {
    lines.push(`Provider ${provider.provider}: ${shortCount(provider.total)} tokens, ${formatCurrency(provider.costUsd, currency)}`);
  }
  return lines.join('\n');
}

function activityText(limit: number): string {
  const entries = readActivity(limit);
  if (entries.length === 0) return 'No activity recorded yet. The log fills as Tersio changes modes, installs, or updates.';
  return entries.map((e) => `${new Date(e.at).toISOString()} [${e.kind}] ${e.title}${e.detail ? ` — ${e.detail}` : ''}`).join('\n');
}

function hostRows(): Array<{ id: string; label: string; installed: boolean; version: string | null; mcp: boolean; supported: boolean; hint: string }> {
  return detectHosts().map((host) => ({
    id: host.id,
    label: host.label,
    installed: host.installed,
    version: host.version,
    mcp: tersioMcpConfigured(host.id),
    supported: hostCap(host.id)?.mcp != null,
    hint: host.installCmd,
  }));
}

function hostsText(): string {
  const rows = hostRows();
  return [
    `Tersio ${PACKAGE_VERSION} — ${rows.filter((row) => row.installed).length} of ${rows.length} agents installed`,
    ...rows.map((row) => {
      const state = row.installed ? `installed${row.version ? ` ${row.version}` : ''}` : 'not installed';
      const mcp = row.mcp ? 'MCP wired' : row.supported ? 'MCP not wired — run `tersio install --host ' + row.id + '`' : 'MCP not wired';
      return `${row.label} (${row.id}): ${state} · ${mcp}`;
    }),
  ].join('\n');
}

/** The newest sessions behind the usage numbers, so an agent can see what it has been costing. */
function sessionsText(range: RangeKey, limit: number): string {
  const stats = agentStats(range, 'summary');
  if (!stats.available) return `No sessions for ${range} yet. Sessions appear once an agent runs with Tersio installed.`;
  const rows = stats.traces.toSorted((a, b) => b.lastTs - a.lastTs).slice(0, limit);
  if (rows.length === 0) return `No sessions in the last ${range}.`;
  const currency = readStoredCurrency();
  return rows.map((row) => {
    const when = new Date(row.lastTs).toISOString().slice(0, 16).replace('T', ' ');
    const models = row.models.slice(0, 2).join(', ') || 'unknown model';
    return `${when} · ${hostOfSessionFile(row.sessionFile)} · ${row.project} · ${models} · ${row.requests} req · ${shortCount(row.tokens)} tokens · ${formatCurrency(row.costUsd, currency)}${row.subagents > 0 ? ` · ${row.subagents} subagent(s)` : ''}`;
  }).join('\n');
}

async function modesText(want: ModeWants, host: HostId | null): Promise<string> {
  const stored = host ? await storedProfile(host) : await storedProfile();
  // The preset lands first, so a single mode in the same call overrides just its piece of it.
  let next = want.combo !== null ? applyComboPreset(stored, want.combo) : stored;
  if (want.caveman !== null) next = { ...next, cavemanDefault: want.caveman };
  if (want.rtk !== null) next = { ...next, rtkDefault: want.rtk === 'on' };
  if (want.ponytail !== null) next = { ...next, ponytailDefault: want.ponytail };
  if (want.pstack !== null) next = { ...next, pstackDefault: want.pstack };
  if (want.headroom !== null) next = { ...next, headroomDefault: want.headroom };
  const fields: HostDefaultField[] = [];
  if (want.combo !== null) fields.push('comboDefault', 'cavemanDefault', 'rtkDefault', 'ponytailDefault');
  if (want.caveman !== null) fields.push('cavemanDefault');
  if (want.rtk !== null) fields.push('rtkDefault');
  if (want.ponytail !== null) fields.push('ponytailDefault');
  if (want.pstack !== null) fields.push('pstackDefault');
  if (want.headroom !== null) fields.push('headroomDefault');
  if (fields.length === 0) {
    const scope = host ? ` for ${host}` : '';
    return `Current session defaults${scope}: ${formatProfile(next)}. Pass combo (${[...COMBO_DEFAULTS].join(', ')}) or any single mode — caveman, rtk, ponytail, pstack, headroom — to change them${host ? `, and host to scope them to one agent` : ''}.`;
  }
  // A host argument writes that agent's own section, which wins over the shared store at session start.
  const { text } = await captureLog(() => (host
    ? saveHostDefaults(host, fields, next, { quiet: true })
    : writePluginSettings(next, { quiet: true })));
  return [text, `Session defaults${host ? ` for ${host}` : ''} saved: ${formatProfile(next)}`].filter(Boolean).join('\n');
}

/** One combined read: live proxy counters, compression routing, durable savings, and MCP wiring. */
function headroomStatusText(): string {
  const stats = readHeadroomStats();
  const gain = readHeadroomSavings();
  const routing = ['omp', 'opencode'].map((host) => `${host}: ${describeHeadroomRoute(readHeadroomRoute(host))}`);
  const mcp = tersioMcpHosts().map((host) => `${host}: ${tersioMcpConfigured(host) ? 'wired' : 'not wired'}`);
  return [
    stats.measured
      ? `Proxy ${headroomProxyUrl()}: up — ${shortCount(stats.requests)} requests, ${shortCount(stats.compressed)} compressed, ${shortCount(stats.tokensSaved)} tokens saved since it started`
      : `Proxy ${headroomProxyUrl()}: unavailable — ${stats.failure}`,
    `Routing — ${routing.join(' · ')}`,
    gain.measured
      ? `Savings ledger: ${shortCount(gain.lifetime.tokensSaved)} of ${shortCount(gain.lifetime.tokensBefore)} tokens (${gain.lifetime.savingsPercent.toFixed(1)}%) across ${shortCount(gain.lifetime.calls)} calls`
      : `Savings ledger: not measured — ${gain.failure}`,
    `Tersio MCP — ${mcp.join(' · ')}`,
  ].join('\n');
}

/** The original behind a compression marker, fetched from the proxy's CCR store. */
async function retrieveText(hash: string, signal?: AbortSignal): Promise<{ text: string; isError: boolean }> {
  const url = new URL('/v1/retrieve', headroomProxyUrl()).toString();
  const timeout = AbortSignal.timeout(15_000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hash }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    const body = await response.text();
    if (!response.ok) return { text: `Headroom retrieve failed (HTTP ${response.status}): ${body.trim() || hash}`, isError: true };
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const original = parsed.original_content ?? parsed.content;
    return { text: typeof original === 'string' ? original : JSON.stringify(parsed, null, 2), isError: false };
  } catch (e) {
    return { text: `Headroom retrieve failed for ${hash}: ${(e as Error).message}`, isError: true };
  }
}

/** JSON Schema per tool, the shape every MCP client knows how to render. */
const TOOLS = [
  {
    name: 'tersio_stats',
    description: 'Agent usage for a time range: requests, errors, tokens, cache rate, cost, and the top models and providers.',
    inputSchema: {
      type: 'object',
      properties: { range: { type: 'string', enum: [...RANGES], description: `Time range, default 24h. One of ${RANGES.join(', ')}.` } },
    },
  },
  {
    name: 'tersio_activity',
    description: 'What Tersio changed on this machine, newest first: mode switches, installs, updates, removals, doctor runs.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Entries to return, 1-200, default 20.' } },
    },
  },
  {
    name: 'tersio_hosts',
    description: 'Every agent Tersio supports, its installed version, and whether the Tersio MCP server is wired into it. The first call to reach for when a tool is missing or an install looks stale.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'tersio_sessions',
    description: 'The newest agent sessions behind the usage numbers: when, which agent, project, model, requests, tokens, and cost.',
    inputSchema: {
      type: 'object',
      properties: {
        range: { type: 'string', enum: [...RANGES], description: `Time range, default 24h. One of ${RANGES.join(', ')}.` },
        limit: { type: 'number', description: 'Sessions to return, 1-50, default 10.' },
      },
    },
  },
  {
    name: 'tersio_modes',
    description: 'Read the session-start mode defaults, or set them: combo applies a preset, and any single mode (caveman, rtk, ponytail, pstack, headroom) overrides its piece of that preset. Pass host to scope the change to one agent.',
    inputSchema: {
      type: 'object',
      properties: {
        combo: { type: 'string', enum: [...COMBO_DEFAULTS], description: `Combo preset to apply: ${[...COMBO_DEFAULTS].join(', ')}.` },
        caveman: { type: 'string', enum: [...CAVEMAN_DEFAULTS], description: `Caveman reply level: ${[...CAVEMAN_DEFAULTS].join(', ')}.` },
        rtk: { type: 'string', enum: [...RTK_DEFAULTS], description: 'Condensed shell output: on or off.' },
        ponytail: { type: 'string', enum: [...PONYTAIL_DEFAULTS], description: `Lean-code level: ${[...PONYTAIL_DEFAULTS].join(', ')}.` },
        pstack: { type: 'string', enum: [...PSTACK_DEFAULTS], description: 'Rigor mode: on or off.' },
        headroom: { type: 'string', enum: [...HEADROOM_DEFAULTS], description: 'Headroom token-saver mode: on or off. Opt-in; tracks the user\'s own Headroom install.' },
        host: { type: 'string', enum: tersioMcpHosts(), description: 'Scope the read or the write to one agent. Omit it to read or write the shared defaults every agent inherits.' },
      },
    },
  },
  {
    name: 'tersio_headroom',
    description: 'Headroom, the token saver: savings by default, live proxy counters and routing with status, original content by hash with retrieve, or its memory store, an eval suite, and the savings dashboard. Unmeasured when Headroom is not installed.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['savings', 'status', 'retrieve', 'memory', 'evals', 'dashboard'], description: 'What to ask headroom for. savings is the default. retrieve needs hash.' },
        suite: { type: 'string', description: 'With evals: the suite name, as `headroom evals --help` lists them.' },
        hash: { type: 'string', description: 'With retrieve: the hash from a <<ccr:HASH>> compression marker.' },
      },
    },
  },
] as const;

async function callTool(params: unknown, signal?: AbortSignal): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const call = (params ?? {}) as { name?: unknown; arguments?: unknown };
  const name = typeof call.name === 'string' ? call.name : null;
  const args = (call.arguments ?? {}) as StatsToolArgs & ActivityToolArgs & ModesToolArgs & HeadroomToolArgs;
  if (name === 'tersio_stats') {
    if (args.range !== undefined && !isRangeKey(args.range)) throw new RpcError(-32602, `range must be one of ${RANGES.join(', ')}`);
    return { content: [{ type: 'text', text: statsText(isRangeKey(args.range) ? args.range : '24h') }] };
  }
  if (name === 'tersio_activity') {
    const limit = args.limit === undefined ? 20 : Math.min(200, Math.max(1, Math.round(Number(args.limit))));
    if (!Number.isFinite(limit)) throw new RpcError(-32602, 'limit must be a number');
    return { content: [{ type: 'text', text: activityText(limit) }] };
  }
  if (name === 'tersio_hosts') return { content: [{ type: 'text', text: hostsText() }] };
  if (name === 'tersio_sessions') {
    if (args.range !== undefined && !isRangeKey(args.range)) throw new RpcError(-32602, `range must be one of ${RANGES.join(', ')}`);
    const limit = args.limit === undefined ? 10 : Math.min(50, Math.max(1, Math.round(Number(args.limit))));
    if (!Number.isFinite(limit)) throw new RpcError(-32602, 'limit must be a number');
    return { content: [{ type: 'text', text: sessionsText(isRangeKey(args.range) ? args.range : '24h', limit) }] };
  }
  if (name === 'tersio_modes') {
    // One validated value per mode; the sets are the same ones the CLI flags and Settings dialog use.
    const oneOf = (value: unknown, set: Set<string>, label: string): string | null => {
      if (value === undefined) return null;
      if (typeof value !== 'string' || !set.has(value)) throw new RpcError(-32602, `${label} must be one of ${[...set].join(', ')}`);
      return value;
    };
    const rtkOrPstack = (value: unknown, set: Set<string>, label: string): 'on' | 'off' | null => {
      const picked = oneOf(value, set, label);
      return picked === null ? null : (picked as 'on' | 'off');
    };
    const want: ModeWants = {
      combo: oneOf(args.combo, COMBO_DEFAULTS, 'combo'),
      caveman: oneOf(args.caveman, CAVEMAN_DEFAULTS, 'caveman'),
      rtk: rtkOrPstack(args.rtk, RTK_DEFAULTS, 'rtk'),
      ponytail: oneOf(args.ponytail, PONYTAIL_DEFAULTS, 'ponytail'),
      pstack: rtkOrPstack(args.pstack, PSTACK_DEFAULTS, 'pstack'),
      headroom: rtkOrPstack(args.headroom, HEADROOM_DEFAULTS, 'headroom'),
    };
    const asked = args.host === undefined ? null : String(args.host);
    if (asked !== null && hostCap(asked) === null) throw new RpcError(-32602, `host must be one of ${tersioMcpHosts().join(', ')}`);
    const host = asked as HostId | null;
    return { content: [{ type: 'text', text: await modesText(want, host) }] };
  }
  if (name === 'tersio_headroom') {
    // Upstream owns these surfaces; Tersio passes the command through and returns its tail.
    const action = args.action ?? 'savings';
    if (!['savings', 'status', 'retrieve', 'memory', 'evals', 'dashboard'].includes(action)) throw new RpcError(-32602, 'action must be savings, status, retrieve, memory, evals, or dashboard');
    if (action === 'status') return { content: [{ type: 'text', text: headroomStatusText() }] };
    if (action === 'retrieve') {
      const hash = typeof args.hash === 'string' ? args.hash.trim() : '';
      if (!hash) throw new RpcError(-32602, 'hash is required for retrieve');
      const result = await retrieveText(hash, signal);
      return { content: [{ type: 'text', text: result.text }], ...(result.isError ? { isError: true } : {}) };
    }
    if (action !== 'savings') {
      const bin = resolveHeadroomBinary();
      if (!bin) return { content: [{ type: 'text', text: 'Headroom: not installed — install it from the dashboard Tools page, or run pip install "headroom-ai[all]".' }] };
      const argv = action === 'dashboard' ? ['dashboard'] : action === 'memory' ? ['memory', 'stats'] : ['evals', ...(typeof args.suite === 'string' && args.suite ? [args.suite] : [])];
      try {
        const run = await execFileP(bin, argv, { timeout: 120_000, signal });
        return { content: [{ type: 'text', text: (`${run.stdout}\n${run.stderr}`.trim() || `headroom ${argv.join(' ')}: done`) }] };
      } catch (e) {
        const err = e as { stdout?: string; stderr?: string; message?: string };
        const said = `${err.stdout ?? ''}\n${err.stderr ?? ''}`.trim();
        return { isError: true, content: [{ type: 'text', text: said || err.message || `headroom ${argv.join(' ')} failed` }] };
      }
    }
    const gain = readHeadroomSavings();
    if (!gain.measured) return { content: [{ type: 'text', text: `Headroom savings: not measured — ${gain.failure}. Install Headroom, then wrap your tools (headroom wrap <tool>, or the switch on the dashboard) so their traffic flows through it.` }] };
    const lines = [
      `Headroom savings — lifetime: ${gain.lifetime.tokensSaved.toLocaleString()} of ${gain.lifetime.tokensBefore.toLocaleString()} tokens (${gain.lifetime.savingsPercent.toFixed(1)}%), $${gain.lifetime.costUsd.toFixed(4)} avoided across ${gain.lifetime.calls} calls.`,
      `Today: ${gain.windows.today.tokensSaved.toLocaleString()} tokens · 7 days: ${gain.windows.last7Days.tokensSaved.toLocaleString()} · 30 days: ${gain.windows.last30Days.tokensSaved.toLocaleString()}.`,
      ...gain.byClient.map((row) => `${row.client}: ${row.calls} calls · ${row.tokensSaved.toLocaleString()} tokens saved`),
    ];
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
  throw new RpcError(-32602, `unknown tool: ${name}`);
}

type WireMessage = { jsonrpc?: string; id?: unknown; method?: unknown; params?: unknown };

/** A cancelling client names the request it gave up on; its tool call is aborted in place. */
const inflight = new Map<string, AbortController>();

/** Read-only snapshots a client can pull without spending a tool call. */
const RESOURCES = [
  { uri: 'tersio://settings', name: 'Session defaults', description: 'The stored mode defaults, currency, and dashboard preferences.', mimeType: 'application/json' },
  { uri: 'tersio://hosts', name: 'Agent hosts', description: 'Every supported agent, its installed version, and whether the Tersio MCP server is wired into it.', mimeType: 'application/json' },
];

async function readResource(uri: string): Promise<{ uri: string; mimeType: string; text: string }> {
  if (uri === 'tersio://settings') return { uri, mimeType: 'application/json', text: JSON.stringify(await storedProfile(), null, 2) };
  if (uri === 'tersio://hosts') return { uri, mimeType: 'application/json', text: JSON.stringify(hostRows(), null, 2) };
  throw new RpcError(-32602, `unknown resource: ${uri}`);
}

/** Handles one wire message; exposed so a test can drive the protocol without a process. Async because tools/call awaits the tool. */
export async function handleMessage(message: WireMessage, send: (msg: unknown) => void): Promise<void> {
  const { id, method, params } = message;
  if (method === 'notifications/cancelled') {
    const requestId = (params as { requestId?: unknown } | undefined)?.requestId;
    if (requestId !== undefined && requestId !== null) inflight.get(String(requestId))?.abort();
    return;
  }
  // A notification carries no id and wants no answer.
  const reply = id !== undefined && id !== null;
  const key = reply ? String(id) : '';
  if (typeof method !== 'string' || method.startsWith('notifications/')) return;
  const controller = new AbortController();
  if (reply) inflight.set(key, controller);
  try {
    let result: unknown;
    if (method === 'initialize') {
      const asked = (params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
      result = {
        // A client that speaks an older revision gets that revision back, so its own framing rules apply.
        protocolVersion: typeof asked === 'string' && SUPPORTED_PROTOCOLS.has(asked) ? asked : PROTOCOL_VERSION,
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'tersio', version: PACKAGE_VERSION },
        instructions: 'Tersio watches this machine\'s agent sessions. Ask for usage with tersio_stats, the newest sessions with tersio_sessions, recent changes with tersio_activity, which agents are wired with tersio_hosts, read or set session modes with tersio_modes, and Headroom compression savings with tersio_headroom.',
      };
    } else if (method === 'ping') result = {};
    else if (method === 'tools/list') result = { tools: TOOLS };
    else if (method === 'tools/call') result = await callTool(params, controller.signal);
    else if (method === 'resources/list') result = { resources: RESOURCES };
    else if (method === 'resources/read') {
      const uri = (params as { uri?: unknown } | undefined)?.uri;
      if (typeof uri !== 'string') throw new RpcError(-32602, 'uri is required');
      result = { contents: [await readResource(uri)] };
    } else throw new RpcError(-32601, `unknown method: ${method}`);
    if (reply) send({ jsonrpc: '2.0', id, result });
  } catch (e) {
    const cancelled = controller.signal.aborted;
    const code = cancelled ? -32800 : e instanceof RpcError ? e.code : -32603;
    const text = cancelled ? 'request cancelled' : (e as Error).message;
    if (reply) send({ jsonrpc: '2.0', id, error: { code, message: text } });
  } finally {
    if (reply) inflight.delete(key);
  }
}

function mcpSend(msg: unknown): void {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

/** Serves one client over stdio and exits when the client disconnects. */
export async function runMcpServer(): Promise<void> {
  const lines = createInterface({ input: process.stdin });
  let queue: Promise<void> = Promise.resolve();
  lines.on('line', (line) => {
    const text = line.trim();
    if (text === '') return;
    let message: WireMessage | null = null;
    try {
      message = JSON.parse(text) as WireMessage;
    } catch { /* a malformed line is dropped; the client's own timeout surfaces it */ }
    // A client may call tools in parallel, and the printing tools patch the console, so one handler at a time; an overlapping patch could leak a print onto the wire.
    if (message) queue = queue.then(() => handleMessage(message, mcpSend));
  });
  // The server never outlives its client: a closed stream ends the process.
  lines.on('close', () => process.exit(0));
  const { promise } = Promise.withResolvers<void>();
  await promise;
}