// Codex rollout JSONL: one parser for usage rows and the dashboard trace.

export interface CodexUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface CodexToolFact {
  n: string;
  a: number;
  r: number;
  e: number;
}

export interface CodexTool {
  id: string;
  name: string;
  detail: string;
  startTs: number;
  endTs: number;
  durationMs: number;
  argsChars: number;
  resultChars: number;
  isError: boolean;
}

export interface CodexRequest {
  id: string;
  startTs: number;
  endTs: number;
  model: string;
  provider: string;
  cwd: string;
  usage: CodexUsage;
  durationMs?: number;
  ttftMs?: number;
  status: 'completed' | 'error' | 'aborted';
  code?: number;
  note?: string;
  tools: string[];
  toolFacts: CodexToolFact[];
}

export interface CodexTurn {
  id: string;
  startTs: number;
  endTs: number;
  detail: string;
}

export interface CodexTranscript {
  provider: string;
  model: string;
  cwd: string;
  startedAt: number;
  endedAt: number;
  title: string;
  requests: CodexRequest[];
  tools: CodexTool[];
  turns: CodexTurn[];
}

type Row = Record<string, unknown>;

function obj(value: unknown): Row {
  return value && typeof value === 'object' ? (value as Row) : {};
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function stamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Date.parse(str(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function durationMs(value: unknown): number {
  const duration = obj(value);
  return Math.max(0, num(duration.secs) * 1000 + num(duration.nanos) / 1_000_000);
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        const part = obj(entry);
        return str(part.text) || str(part.content);
      })
      .filter(Boolean)
      .join('\n');
  }
  const record = obj(value);
  return str(record.text) || str(record.content);
}

function charsOf(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'string') return value.length;
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

function recordOf(value: unknown): Row {
  if (typeof value !== 'string') return obj(value);
  try {
    return obj(JSON.parse(value));
  } catch {
    return {};
  }
}

function lead(command: string): string {
  const first = command.trim().split(/\s+/)[0] ?? '';
  return first.replace(/^['"]|['"]$/g, '') || 'bash';
}

function toolName(name: string, detail: string): string {
  if (name === 'exec_command' || name === 'write_stdin' || name === 'bash') {
    return detail ? `bash:${lead(detail)}` : 'bash';
  }
  return name || 'tool';
}

function usageOf(usage: Row): CodexUsage {
  const output = num(usage.output_tokens);
  const cacheRead = num(usage.cached_input_tokens);
  const cacheWrite = num(usage.cache_write_input_tokens);
  const inputTotal = num(usage.input_tokens);
  const total = num(usage.total_tokens);
  if (inputTotal + output + cacheRead + cacheWrite === 0) {
    return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  }
  // Codex's input bucket includes cached tokens; Tersio stores prompt, cache-read, and cache-write apart.
  const input =
    total > 0 ? Math.max(0, total - output - cacheRead - cacheWrite) : Math.max(0, inputTotal - cacheRead - cacheWrite);
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
  };
}

export function looksLikeCodexTranscript(text: string): boolean {
  return (
    /"type"\s*:\s*"(?:session_meta|turn_context|token_count|token_usage_record)"/.test(text) &&
    /"payload"\s*:\s*\{/.test(text)
  );
}

/** The gateway is the model id's first segment when it names one; otherwise Codex's provider is all there is. */
export function codexModelIdentity(model: string, provider: string): { model: string; provider: string } {
  const id = model || 'codex';
  const slash = id.indexOf('/');
  if (slash > 0) return { model: id, provider: id.slice(0, slash) };
  return { model: id, provider };
}

/**
 * Fold the rollout into model requests and the tools each request called. Codex reports token usage
 * once after a request and its tools finish, so each token_count closes the pending call set.
 */
export function parseCodexTranscript(text: string): CodexTranscript {
  let provider = '';
  let model = '';
  let cwd = '';
  let startedAt = 0;
  let endedAt = 0;
  let title = '';
  let lastTs = 0;
  let modelStartTs: number | null = null;
  let agentMessageTs: number | null = null;
  let pendingError: { code?: number; note?: string } | null = null;
  let pendingTools: CodexTool[] = [];
  const calls = new Map<string, CodexTool>();
  const requests: CodexRequest[] = [];
  const tools: CodexTool[] = [];
  const turns: CodexTurn[] = [];
  let lastUsage: CodexUsage | null = null;
  let lastUsageSource: 'record' | 'event' | null = null;

  const addTool = (id: string, name: string, ts: number, args: unknown, detail = ''): CodexTool => {
    const held = calls.get(id) ?? {
      id,
      name,
      detail,
      startTs: ts,
      endTs: ts,
      durationMs: 0,
      argsChars: 0,
      resultChars: 0,
      isError: false,
    };
    held.name = name;
    if (detail) held.detail = detail;
    held.argsChars = Math.max(held.argsChars, charsOf(args));
    held.startTs = Math.min(held.startTs || ts, ts);
    calls.set(id, held);
    if (!pendingTools.includes(held)) pendingTools.push(held);
    if (!tools.includes(held)) tools.push(held);
    return held;
  };

  const sameUsage = (left: CodexUsage, right: CodexUsage): boolean =>
    left.input === right.input &&
    left.output === right.output &&
    left.cacheRead === right.cacheRead &&
    left.cacheWrite === right.cacheWrite;

  const recordUsage = (
    usage: CodexUsage,
    ts: number,
    previousTs: number,
    source: 'record' | 'event',
    responseId = '',
  ): void => {
    if (usage.input + usage.output + usage.cacheRead + usage.cacheWrite === 0) return;
    const startTs = modelStartTs ?? agentMessageTs ?? previousTs ?? ts;
    const endTs = agentMessageTs ?? ts;
    const status = pendingError ? 'error' : 'completed';
    const facts = pendingTools.map((tool) => ({
      n: tool.name,
      a: tool.argsChars,
      r: tool.resultChars,
      e: tool.isError ? 1 : 0,
    }));
    const prior = requests.at(-1);
    // Codex writes the same usage twice: a top-level record and an event. Their order and gap vary after compaction.
    const duplicate = prior && lastUsage !== null && sameUsage(lastUsage, usage) && source !== lastUsageSource;
    if (duplicate) {
      const known = new Set(prior.tools);
      for (const tool of pendingTools) {
        if (!known.has(tool.name)) prior.tools.push(tool.name);
      }
      const knownFacts = new Set(prior.toolFacts.map((fact) => `${fact.n}:${fact.a}:${fact.r}`));
      for (const fact of facts) {
        if (!knownFacts.has(`${fact.n}:${fact.a}:${fact.r}`)) prior.toolFacts.push(fact);
      }
      if (pendingError) {
        prior.status = 'error';
        if (pendingError.code !== undefined) prior.code = pendingError.code;
        if (pendingError.note) prior.note = pendingError.note;
      }
      pendingTools = [];
      pendingError = null;
      modelStartTs = null;
      agentMessageTs = null;
      lastUsage = usage;
      lastUsageSource = source;
      return;
    }
    const identity = codexModelIdentity(model || 'codex', provider);
    requests.push({
      id: responseId || `codex-${ts}`,
      startTs,
      endTs,
      model: identity.model,
      provider: identity.provider,
      cwd,
      usage,
      status,
      ...(pendingError?.code !== undefined ? { code: pendingError.code } : {}),
      ...(pendingError?.note ? { note: pendingError.note } : {}),
      tools: pendingTools.map((tool) => tool.name),
      toolFacts: facts,
    });
    lastUsage = usage;
    lastUsageSource = source;
    pendingTools = [];
    pendingError = null;
    modelStartTs = null;
    agentMessageTs = null;
  };

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let row: Row;
    try {
      row = JSON.parse(line) as Row;
    } catch {
      continue;
    }
    const previousTs = lastTs;
    const ts = stamp(row.timestamp) || lastTs;
    if (ts) lastTs = ts;
    if (startedAt === 0 && ts) startedAt = ts;
    if (ts > endedAt) endedAt = ts;
    const payload = obj(row.payload);
    const type = str(row.type);
    const payloadType = str(payload.type);

    if (type === 'session_meta') {
      provider = str(payload.model_provider) || provider;
      cwd = str(payload.cwd) || cwd;
      startedAt = stamp(payload.timestamp) || startedAt;
      continue;
    }
    if (type === 'turn_context') {
      model = str(payload.model) || model;
      cwd = str(payload.cwd) || cwd;
      const turnId = str(payload.turn_id);
      const existing = turns.at(-1);
      if (turnId && existing?.id !== turnId) {
        if (existing) existing.endTs = ts;
        turns.push({ id: turnId, startTs: ts, endTs: ts, detail: '' });
      }
      continue;
    }
    if (type === 'response_item') {
      const id = str(payload.call_id) || str(payload.id);
      if (payloadType === 'function_call' || payloadType === 'custom_tool_call') {
        const args = payload.arguments ?? payload.input ?? '';
        const command = str(recordOf(args).cmd) || str(recordOf(args).command);
        const detail = command ? command.slice(0, 300) : typeof args === 'string' ? args.slice(0, 300) : '';
        addTool(id, toolName(str(payload.name), command), ts, args, detail);
      } else if (payloadType === 'function_call_output' || payloadType === 'custom_tool_call_output') {
        const held = calls.get(str(payload.call_id));
        if (held) {
          held.endTs = Math.max(held.endTs, ts);
          held.resultChars = Math.max(held.resultChars, charsOf(payload.output));
          const exit = textOf(payload.output).match(/Process exited with code (-?\d+)/);
          if (exit) {
            const code = Number(exit[1]);
            held.isError = code !== 0;
            held.durationMs = Math.max(held.durationMs, held.endTs - held.startTs);
          }
        }
      } else if (payloadType.endsWith('_call')) {
        const args = payload.arguments ?? payload.input ?? payload.action ?? '';
        const detail = typeof args === 'string' ? args.slice(0, 300) : '';
        addTool(id, payloadType.slice(0, -'_call'.length), ts, args, detail);
      } else if (payloadType.endsWith('_output')) {
        const held = calls.get(str(payload.call_id));
        if (held) {
          held.endTs = Math.max(held.endTs, ts);
          held.resultChars = Math.max(held.resultChars, charsOf(payload.output ?? payload.result ?? payload.tools));
          held.durationMs = Math.max(held.durationMs, held.endTs - held.startTs);
          held.isError = held.isError || str(payload.status) === 'failed';
        }
      } else if (payloadType === 'message' && str(payload.role) === 'assistant') {
        const body = textOf(payload.content);
        if (body && !agentMessageTs) agentMessageTs = ts;
        if (!title && body) title = body.split('\n')[0]!.slice(0, 120);
      } else if (payloadType === 'reasoning' && modelStartTs === null) {
        modelStartTs = previousTs || ts;
      }
      continue;
    }
    if (type === 'token_usage_record') {
      recordUsage(usageOf(obj(payload.usage)), ts, previousTs, 'record', str(payload.response_id));
      continue;
    }
    if (type !== 'event_msg') continue;

    if (payloadType === 'task_started') {
      const turnId = str(payload.turn_id);
      const existing = turns.at(-1);
      if (!existing || existing.id !== turnId) {
        if (existing) existing.endTs = ts;
        turns.push({ id: turnId, startTs: ts, endTs: ts, detail: '' });
      }
      continue;
    }
    if (payloadType === 'task_complete') {
      const turnId = str(payload.turn_id);
      const turn = turns.at(-1);
      if (turn && (!turnId || turn.id === turnId)) turn.endTs = ts;
      const last = requests.at(-1);
      if (last) {
        last.durationMs = num(payload.duration_ms) || last.durationMs;
        last.ttftMs = num(payload.time_to_first_token_ms) || last.ttftMs;
      }
      continue;
    }
    if (payloadType === 'item_completed') {
      const item = obj(payload.item);
      const itemType = str(item.type);
      const itemId = str(item.id);
      if (itemType === 'UserMessage') {
        const detail = textOf(item.content).split('\n')[0]?.slice(0, 300) || '';
        const turn = turns.at(-1);
        if (turn) turn.detail = turn.detail || detail;
        if (!title) title = detail.slice(0, 120);
      } else if (itemType === 'Reasoning') {
        if (modelStartTs === null) modelStartTs = previousTs || ts;
      } else if (itemType === 'AgentMessage') {
        if (modelStartTs === null) modelStartTs = previousTs || ts;
        agentMessageTs = ts;
        const body = textOf(item.content);
        if (!title && body) title = body.split('\n')[0]!.slice(0, 120);
      } else if (itemType === 'CommandExecution') {
        const command = Array.isArray(item.command) ? str(item.command.at(-1)) : str(item.command);
        const heldMs = durationMs(item.duration);
        const startTs = calls.get(itemId)?.startTs || (heldMs ? ts - heldMs : ts);
        const held = addTool(itemId, 'bash', startTs, item.command, command);
        held.durationMs = heldMs || held.durationMs;
        held.endTs = heldMs ? startTs + heldMs : ts;
        held.resultChars = Math.max(held.resultChars, charsOf(item.aggregated_output));
        const code = num(item.exit_code);
        held.isError = str(item.status) !== 'completed' || code !== 0;
        held.name = toolName('exec_command', command);
        cwd = str(item.cwd).replace(/^file:\/\//, '') || cwd;
      } else if (itemType === 'FileChange') {
        const held = addTool(itemId, 'apply_patch', ts, item.changes);
        held.endTs = ts;
        held.durationMs = Math.max(held.durationMs, ts - held.startTs);
        held.resultChars = Math.max(held.resultChars, charsOf(item.changes));
        held.isError = str(item.status) !== 'completed';
        held.name = 'apply_patch';
      } else if (itemType === 'McpToolCall') {
        const server = str(item.server);
        const tool = str(item.tool);
        const name = `mcp:${[server, tool].filter(Boolean).join('/') || 'tool'}`;
        const heldMs = durationMs(item.duration);
        const startTs = calls.get(itemId)?.startTs || (heldMs ? ts - heldMs : ts);
        const held = addTool(itemId, name, startTs, item.arguments, tool);
        held.durationMs = heldMs || held.durationMs;
        held.endTs = heldMs ? startTs + heldMs : ts;
        held.resultChars = Math.max(held.resultChars, charsOf(item.result));
        held.isError = str(item.status) !== 'completed';
      }
      continue;
    }
    if (payloadType === 'token_count' || payloadType === 'token_usage_record') {
      const usage =
        payloadType === 'token_usage_record'
          ? usageOf(obj(payload.usage))
          : usageOf(obj(obj(payload.info).last_token_usage));
      recordUsage(usage, ts, previousTs, 'event', str(payload.response_id));
      continue;
    }
    if (payloadType === 'error' || payloadType === 'stream_error') {
      const message = textOf(payload.message) || str(payload.error) || str(payload.detail);
      pendingError = { note: message.slice(0, 180) || 'request failed' };
    }
  }

  const turn = turns.at(-1);
  if (turn) turn.endTs = Math.max(turn.endTs, endedAt);
  return { provider, model, cwd, startedAt, endedAt, title, requests, tools, turns };
}
