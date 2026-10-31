// The MCP server: one stdio endpoint so any MCP client can read Tersio's data and steer its modes.
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readActivity } from './activity.ts';
import { CAVEMAN_DEFAULTS, COMBO_DEFAULTS, HEADROOM_DEFAULTS, IS_WINDOWS, PACKAGE_VERSION, PONYTAIL_DEFAULTS, PSTACK_DEFAULTS, RTK_DEFAULTS, execFileP } from './common.ts';
import { resolveHeadroomBinary } from '../extensions/shared/utils.ts';
import { formatCurrency, readStoredCurrency } from './currency.ts';
import { agentStats } from './dashboard.ts';
import { applyComboPreset, formatProfile, storedProfile, writePluginSettings } from './profile.ts';
import { isRangeKey, RANGES } from '../extensions/shared/agent-stats.ts';
import type { RangeKey } from '../extensions/shared/agent-stats.ts';
import { readHeadroomSavings } from '../extensions/shared/headroom-gain.ts';

/** The spec version this server speaks; a client naming another is answered with this one. */
const PROTOCOL_VERSION = '2025-06-18';

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
}

interface ModesToolArgs {
  combo?: unknown;
  caveman?: unknown;
  rtk?: unknown;
  ponytail?: unknown;
  pstack?: unknown;
  headroom?: unknown;
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
  const stats = agentStats(range);
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

async function modesText(want: ModeWants): Promise<string> {
  const stored = await storedProfile();
  // The preset lands first, so a single mode in the same call overrides just its piece of it.
  let next = want.combo !== null ? applyComboPreset(stored, want.combo) : stored;
  if (want.caveman !== null) next = { ...next, cavemanDefault: want.caveman };
  if (want.rtk !== null) next = { ...next, rtkDefault: want.rtk === 'on' };
  if (want.ponytail !== null) next = { ...next, ponytailDefault: want.ponytail };
  if (want.pstack !== null) next = { ...next, pstackDefault: want.pstack };
  if (want.headroom !== null) next = { ...next, headroomDefault: want.headroom };
  const changed = want.combo !== null || want.caveman !== null || want.rtk !== null || want.ponytail !== null || want.pstack !== null || want.headroom !== null;
  if (!changed) {
    return `Current session defaults: ${formatProfile(next)}. Pass combo (${[...COMBO_DEFAULTS].join(', ')}) or any single mode — caveman, rtk, ponytail, pstack, headroom — to change them.`;
  }
  const { text } = await captureLog(() => writePluginSettings(next, { quiet: true }));
  return [text, `Session defaults saved: ${formatProfile(next)}`].filter(Boolean).join('\n');
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
    name: 'tersio_modes',
    description: 'Read the session-start mode defaults, or set them: combo applies a preset, and any single mode (caveman, rtk, ponytail, pstack, headroom) overrides its piece of that preset.',
    inputSchema: {
      type: 'object',
      properties: {
        combo: { type: 'string', enum: [...COMBO_DEFAULTS], description: `Combo preset to apply: ${[...COMBO_DEFAULTS].join(', ')}.` },
        caveman: { type: 'string', enum: [...CAVEMAN_DEFAULTS], description: `Caveman reply level: ${[...CAVEMAN_DEFAULTS].join(', ')}.` },
        rtk: { type: 'string', enum: [...RTK_DEFAULTS], description: 'Condensed shell output: on or off.' },
        ponytail: { type: 'string', enum: [...PONYTAIL_DEFAULTS], description: `Lean-code level: ${[...PONYTAIL_DEFAULTS].join(', ')}.` },
        pstack: { type: 'string', enum: [...PSTACK_DEFAULTS], description: 'Rigor mode: on or off.' },
        headroom: { type: 'string', enum: [...HEADROOM_DEFAULTS], description: 'Headroom token-saver mode: on or off. Opt-in; tracks the user\'s own Headroom install.' },
      },
    },
  },
  {
    name: 'tersio_headroom',
    description: 'Headroom, the token saver: compression savings by default, or its memory store, an eval suite, and the savings dashboard. Unmeasured when Headroom is not installed.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['savings', 'memory', 'evals', 'dashboard'], description: 'What to ask headroom for. savings is the default.' },
        suite: { type: 'string', description: 'With evals: the suite name, as `headroom evals --help` lists them.' },
      },
    },
  },
] as const;

async function callTool(params: unknown): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
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
    return { content: [{ type: 'text', text: await modesText(want) }] };
  }
  if (name === 'tersio_headroom') {
    // Upstream owns these surfaces; Tersio passes the command through and returns its tail.
    const action = args.action ?? 'savings';
    if (!['savings', 'memory', 'evals', 'dashboard'].includes(action)) throw new RpcError(-32602, 'action must be savings, memory, evals, or dashboard');
    if (action !== 'savings') {
      const bin = resolveHeadroomBinary();
      if (!bin) return { content: [{ type: 'text', text: 'Headroom: not installed — install it from the dashboard Tools page, or run pip install "headroom-ai[all]".' }] };
      const argv = action === 'dashboard' ? ['dashboard'] : action === 'memory' ? ['memory', 'stats'] : ['evals', ...(typeof args.suite === 'string' && args.suite ? [args.suite] : [])];
      try {
        const run = await execFileP(bin, argv, { timeout: 120_000 });
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

/** Handles one wire message; exposed so a test can drive the protocol without a process. Async because tools/call awaits the tool. */
export async function handleMessage(message: WireMessage, send: (msg: unknown) => void): Promise<void> {
  const { id, method, params } = message;
  // A notification carries no id and wants no answer.
  const reply = id !== undefined && id !== null;
  if (typeof method !== 'string' || method.startsWith('notifications/')) return;
  try {
    let result: unknown;
    if (method === 'initialize') {
      result = {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'tersio', version: PACKAGE_VERSION },
        instructions: 'Tersio watches this machine\'s agent sessions. Ask for usage with tersio_stats, recent changes with tersio_activity, read or set session modes with tersio_modes, and Headroom compression savings with tersio_headroom.',
      };
    } else if (method === 'ping') result = {};
    else if (method === 'tools/list') result = { tools: TOOLS };
    else if (method === 'tools/call') result = await callTool(params);
    else throw new RpcError(-32601, `unknown method: ${method}`);
    if (reply) send({ jsonrpc: '2.0', id, result });
  } catch (e) {
    const code = e instanceof RpcError ? e.code : -32603;
    if (reply) send({ jsonrpc: '2.0', id, error: { code, message: (e as Error).message } });
  }
}

/** Re-runs this server under bun when bun is on PATH and node is the runtime now. The client spawns `tersio mcp`, so the switch happens once, here, before the stream is read. */
export async function preferBun(): Promise<void> {
  // The installed CLI runs under node, so a bun shebang alone would never take effect.
  if (process.versions.bun) return;
  // A marker stops a bun that cannot run this file from looping back into node.
  if (process.env.TERSIO_MCP_RUNTIME) return;
  const bun = spawnSync(IS_WINDOWS ? 'bun.cmd' : 'bun', ['--version'], { encoding: 'utf8', windowsHide: true, shell: false, timeout: 2000 });
  if (bun.status !== 0 || !bun.stdout.trim()) return;
  const self = process.argv[1];
  if (!self) return;
  // This process keeps the client's pipe and pumps it in: one reader, so the child sees EOF once and exits.
  const child = spawn(IS_WINDOWS ? 'bun.exe' : 'bun', [self, 'mcp'], {
    stdio: ['pipe', 'inherit', 'inherit'],
    env: { ...process.env, TERSIO_MCP_RUNTIME: 'bun' },
  });
  process.stdin.pipe(child.stdin);
  const { promise, resolve } = Promise.withResolvers<number | null>();
  child.on('exit', (code) => resolve(code));
  child.on('error', () => resolve(null));
  const code = await promise;
  process.exit(code ?? 1);
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