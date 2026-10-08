// extensions/shared/session-trace.ts — span extraction from pi/omp session transcripts.
//
// One track per transcript file: the main session plus each subagent file under the
// session's sibling directory (the host writes `<session-stem>/<task name>.jsonl`).
// Spans use only timestamps the host actually wrote — message timestamps, completedAt,
// tool_execution_start rows, toolResult timestamps — and fall back to the row's own
// write time. Nothing is invented: a tool call with no result yet ends at the last row
// and stays marked unterminated.
import fs from 'node:fs';
import path from 'node:path';
import type { TokenBreakdown } from './usage-ledger.ts';

export type SpanKind = 'turn' | 'model' | 'tool' | 'subagent' | 'background';

export interface TraceSpan {
  id: string;
  kind: SpanKind;
  start: number;
  end: number;
  label: string;
  /** The transcript row that owns the span, for the entry drawer. */
  entryId?: string;
  /** Tool arguments, task prompt — capped, for the span drawer. */
  detail?: string;
  childTrackId?: string;
  model?: string;
  ttft?: number;
  tokens?: number;
  error?: boolean;
  stop?: string;
  unterminated?: boolean;
}

export interface TraceMarker {
  time: number;
  kind: 'model_change' | 'mode_change' | 'session_exit';
  label: string;
}

export interface TraceTrack {
  id: string;
  parentId: string | null;
  label: string;
  agent: string | null;
  file: string;
  model: string | null;
  spans: TraceSpan[];
  markers: TraceMarker[];
}

export interface TraceToolStat {
  tool: string;
  calls: number;
  errors: number;
  totalMs: number;
  maxMs: number;
}

export interface TraceSummary {
  /** First turn to last activity in the main file — what the session took wall-clock. */
  wallMs: number;
  modelMs: number;
  toolMs: number;
  idleMs: number;
  /** User turns of the main track; a subagent's task prompt is not a user turn. */
  turns: number;
  requests: number;
  toolCalls: number;
  subagents: number;
  totalTokens: number;
  /** API-equivalent estimate across every priced request; unpriced usage adds nothing. */
  costTotal: number;
  unpricedRequests: number;
  /** Distinct model ids seen across all tracks. */
  models: string[];
  toolStats: TraceToolStat[];
}

export interface SessionTrace {
  file: string;
  title: string | null;
  cwd: string | null;
  startedAt: number;
  endedAt: number;
  tracks: TraceTrack[];
  summary: TraceSummary;
}

export interface SessionListEntry {
  file: string;
  folder: string | null;
  title: string | null;
  startedAt: number;
  endedAt: number;
  requests: number;
  toolCalls: number;
  subagents: number;
  totalTokens: number;
  costTotal: number;
  unpricedRequests: number;
  models: string[];
}

/** A subagent transcript paired with its absolute path. */
export interface ChildTranscript {
  file: string;
  text: string;
}

/** Prices one model's token buckets. Supplied by the caller so this module stays free of the pricing catalog. */
export type PriceFn = (model: string, tokens: TokenBreakdown) => { usd: number; priced: boolean };

// Argument text and prompt details reach the span drawer; a raw 400 KB tool payload does not.
const DETAIL_CAP = 2000;
const LABEL_CAP = 80;

interface Msg {
  role?: string;
  content?: unknown;
  timestamp?: unknown;
  model?: string;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    totalTokens?: number;
  };
  stopReason?: string;
  completedAt?: unknown;
  duration?: unknown;
  durationMs?: unknown;
  ttft?: unknown;
  isError?: unknown;
  toolCallId?: string;
}

interface Row {
  type?: string;
  id?: string;
  timestamp?: unknown;
  model?: string;
  mode?: string;
  title?: string;
  cwd?: string;
  customType?: string;
  data?: unknown;
  message?: Msg;
}

interface TurnRec {
  rowId: string;
  start: number;
  label: string;
}

interface ModelRec {
  rowId: string;
  start: number;
  end: number;
  model: string | null;
  ttft: number | null;
  tokens: number;
  breakdown: TokenBreakdown;
  error: boolean;
  stop: string | null;
}

interface PendingCall {
  callId: string;
  name: string;
  args: unknown;
  detail: string;
  emittedAt: number | null;
  entryId: string;
}

interface ResultRec {
  end: number;
  isError: boolean;
  entryId: string;
}

interface FileData {
  startedAt: number;
  endedAt: number;
  title: string | null;
  cwd: string | null;
  turns: TurnRec[];
  models: ModelRec[];
  calls: PendingCall[];
  callStarts: Map<string, number>;
  results: Map<string, ResultRec>;
  markers: TraceMarker[];
  lastModel: string | null;
}

interface TaskEntry {
  name: string;
  agent: string | null;
  detail: string;
}

function ms(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function clip(s: string, cap: number): string {
  return s.length > cap ? s.slice(0, cap) + '…' : s;
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const p of content) {
    if (typeof p === 'string') {
      parts.push(p);
    } else if (p && typeof p === 'object') {
      if ('type' in p && p.type === 'text' && 'text' in p && typeof p.text === 'string') parts.push(p.text);
    }
  }
  return parts.join(' ');
}

function argText(args: unknown): string {
  if (typeof args === 'string') return args;
  if (args && typeof args === 'object') {
    try {
      return JSON.stringify(args);
    } catch {
      return '';
    }
  }
  return '';
}

/** Tasks inside a `task` tool call's arguments: the child file is named after `name`. */
function taskEntries(args: unknown): TaskEntry[] {
  if (!args || typeof args !== 'object' || !('tasks' in args)) return [];
  const tasks = args.tasks;
  if (!Array.isArray(tasks)) return [];
  const out: TaskEntry[] = [];
  for (const t of tasks) {
    if (!t || typeof t !== 'object' || !('name' in t) || typeof t.name !== 'string' || t.name === '') continue;
    const prompt = 'task' in t && typeof t.task === 'string'
      ? t.task
      : 'context' in t && typeof t.context === 'string'
        ? t.context
        : '';
    out.push({
      name: t.name,
      agent: 'agent' in t && typeof t.agent === 'string' && t.agent !== '' ? t.agent : null,
      detail: clip(prompt, DETAIL_CAP),
    });
  }
  return out;
}

function parseRows(text: string): Row[] {
  const rows: Row[] = [];
  for (const line of text.split('\n')) {
    if (line === '' || line[0] !== '{') continue;
    try {
      // Shape-checked object; every field read below re-guards its own type.
      const parsed: unknown = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) rows.push(parsed as Row);
    } catch { /* a torn tail line while a session is live: skip it */ }
  }
  return rows;
}

function parseFile(text: string): FileData {
  const data: FileData = {
    startedAt: 0,
    endedAt: 0,
    title: null,
    cwd: null,
    turns: [],
    models: [],
    calls: [],
    callStarts: new Map(),
    results: new Map(),
    markers: [],
    lastModel: null,
  };
  let first: number | null = null;
  let last: number | null = null;
  const rows = parseRows(text);
  for (const row of rows) {
    const rowMs = ms(row.timestamp);
    if (rowMs !== null) {
      if (first === null || rowMs < first) first = rowMs;
      if (last === null || rowMs > last) last = rowMs;
    }
    if (row.type === 'session' && typeof row.cwd === 'string' && data.cwd === null) data.cwd = row.cwd;
    if ((row.type === 'title' || row.type === 'title_change') && typeof row.title === 'string') {
      // Later rows win: title_change fires after the automatic title.
      data.title = row.title;
    }
    if (row.type === 'model_change' && rowMs !== null) {
      data.markers.push({ time: rowMs, kind: 'model_change', label: String(row.model ?? '') });
      if (typeof row.model === 'string') data.lastModel = row.model;
      continue;
    }
    if (row.type === 'mode_change' && rowMs !== null) {
      data.markers.push({ time: rowMs, kind: 'mode_change', label: String(row.mode ?? '') });
      continue;
    }
    if (row.type === 'custom' && row.customType === 'session_exit' && rowMs !== null) {
      const exit = row.data;
      let label = 'exit';
      if (exit && typeof exit === 'object' && 'kind' in exit && typeof exit.kind === 'string') label = exit.kind;
      else if (exit && typeof exit === 'object' && 'reason' in exit && typeof exit.reason === 'string') label = exit.reason;
      data.markers.push({ time: rowMs, kind: 'session_exit', label });
      continue;
    }
    if (row.type === 'custom' && row.customType === 'tool_execution_start') {
      const d = row.data;
      if (d && typeof d === 'object' && 'toolCallId' in d && typeof d.toolCallId === 'string') {
        const startedAt = 'startedAt' in d ? ms(d.startedAt) : null;
        data.callStarts.set(d.toolCallId, startedAt ?? rowMs ?? 0);
      }
      continue;
    }
    const msg = row.message;
    if (!msg) continue;
    if (msg.role === 'user') {
      const start = ms(msg.timestamp) ?? rowMs;
      if (start === null || !row.id) continue;
      if (first === null || start < first) first = start;
      const label = clip(textOf(msg.content).trim(), LABEL_CAP);
      data.turns.push({ rowId: row.id, start, label });
      continue;
    }
    if (msg.role === 'assistant') {
      const start = ms(msg.timestamp) ?? rowMs;
      if (start === null) continue;
      let end = ms(msg.completedAt);
      if (end === null && typeof msg.duration === 'number') end = start + msg.duration;
      if (end === null && typeof msg.durationMs === 'number') end = start + msg.durationMs;
      if (end === null) end = rowMs ?? start;
      if (end < start) end = start;
      // The message can outlive its row: hosts write the row first and completedAt after.
      if (first === null || start < first) first = start;
      if (last === null || end > last) last = end;
      const usage = msg.usage;
      const breakdown: TokenBreakdown = {
        input: num(usage?.input),
        output: num(usage?.output),
        cacheRead: num(usage?.cacheRead),
        cacheWrite: num(usage?.cacheWrite),
      };
      const tokens = typeof usage?.totalTokens === 'number'
        ? usage.totalTokens
        : breakdown.input + breakdown.output + breakdown.cacheRead + breakdown.cacheWrite;
      const model = typeof msg.model === 'string' ? msg.model : null;
      data.models.push({
        rowId: row.id ?? '',
        start,
        end,
        model,
        ttft: ms(msg.ttft) ?? (typeof msg.ttft === 'number' ? msg.ttft : null),
        tokens,
        breakdown,
        error: msg.stopReason === 'error',
        stop: typeof msg.stopReason === 'string' ? msg.stopReason : null,
      });
      if (model !== null) data.lastModel = model;
      if (row.id) {
        for (const part of Array.isArray(msg.content) ? msg.content : []) {
          if (!part || typeof part !== 'object') continue;
          if (!('type' in part) || part.type !== 'toolCall') continue;
          if (!('id' in part) || typeof part.id !== 'string') continue;
          if (!('name' in part) || typeof part.name !== 'string') continue;
          data.calls.push({
            callId: part.id,
            name: part.name,
            args: 'arguments' in part ? part.arguments : undefined,
            detail: clip(argText('arguments' in part ? part.arguments : undefined), DETAIL_CAP),
            emittedAt: end,
            entryId: row.id,
          });
        }
      }
      continue;
    }
    if (msg.role === 'toolResult' && typeof msg.toolCallId === 'string') {
      const end = ms(msg.timestamp) ?? rowMs ?? 0;
      if (last === null || end > last) last = end;
      data.results.set(msg.toolCallId, {
        end,
        isError: msg.isError === true,
        entryId: row.id ?? '',
      });
    }
  }
  data.startedAt = first ?? 0;
  data.endedAt = last ?? 0;
  return data;
}

interface BuiltTrack {
  track: TraceTrack;
  data: FileData;
  toolSpans: TraceSpan[];
  modelMs: number;
  tokens: number;
  requests: number;
  models: string[];
}

/** Spans for one file: models and tools first, then turn windows closed over that file's activity. */
function buildTrack(
  trackId: string,
  parentId: string | null,
  label: string,
  agent: string | null,
  file: string,
  data: FileData,
): BuiltTrack {
  const spans: TraceSpan[] = [];
  const toolSpans: TraceSpan[] = [];
  let modelMs = 0;
  let tokens = 0;
  const models: string[] = [];

  for (const m of data.models) {
    modelMs += m.end - m.start;
    tokens += m.tokens;
    if (m.model !== null) models.push(m.model);
    const span: TraceSpan = {
      id: `${trackId}:${m.rowId}`,
      kind: 'model',
      start: m.start,
      end: m.end,
      label: m.model ?? 'model',
      entryId: m.rowId,
      tokens: m.tokens,
    };
    if (m.model !== null) span.model = m.model;
    if (m.ttft !== null) span.ttft = m.ttft;
    if (m.error) span.error = true;
    if (m.stop !== null) span.stop = m.stop;
    spans.push(span);
  }

  for (const call of data.calls) {
    const res = data.results.get(call.callId);
    const start = data.callStarts.get(call.callId) ?? call.emittedAt ?? res?.end ?? data.endedAt;
    const end = res?.end ?? data.endedAt;
    const kind: SpanKind = call.name === 'task' ? 'background' : 'tool';
    const span: TraceSpan = {
      id: kind === 'background' ? `${trackId}:bg:${call.callId}` : `${trackId}:tool:${call.callId}`,
      kind,
      start: Math.min(start, end),
      end,
      label: kind === 'background' ? 'task job' : call.name,
      detail: call.detail,
    };
    const entryId = res?.entryId || call.entryId;
    if (entryId) span.entryId = entryId;
    if (res?.isError) span.error = true;
    if (!res) span.unterminated = true;
    spans.push(span);
    if (kind === 'tool') toolSpans.push(span);
  }

  // A turn runs from the user's message to the last activity it caused; idle after that
  // belongs to the gap before the next turn, not to the turn.
  for (let i = 0; i < data.turns.length; i++) {
    const turn = data.turns[i];
    let end = turn.start;
    for (const s of spans) {
      if (s.start >= turn.start && s.end > end) end = s.end;
    }
    spans.push({
      id: `${trackId}:${turn.rowId}`,
      kind: 'turn',
      start: turn.start,
      end,
      label: turn.label,
      entryId: turn.rowId,
    });
  }

  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  data.markers.sort((a, b) => a.time - b.time);
  return {
    track: { id: trackId, parentId, label, agent, file, model: data.lastModel, spans, markers: data.markers },
    data,
    toolSpans,
    modelMs,
    tokens,
    requests: data.models.length,
    models,
  };
}

export function extractSessionTrace(
  file: string,
  text: string,
  children: ChildTranscript[],
  price?: PriceFn,
): SessionTrace {
  const main = parseFile(text);
  const built: BuiltTrack[] = [];
  const mainBuilt = buildTrack('main', null, 'Main agent', null, file, main);
  built.push(mainBuilt);

  // Task calls name their child file: `<session-stem>/<task name>.jsonl`.
  const tasks: TaskEntry[] = [];
  for (const call of main.calls) {
    if (call.name === 'task') tasks.push(...taskEntries(call.args));
  }

  for (const child of children) {
    const stem = path.basename(child.file, '.jsonl');
    const entry = tasks.find((t) => t.name === stem) ?? null;
    const data = parseFile(child.text);
    const track = buildTrack(stem, 'main', entry?.agent ?? stem, entry?.agent ?? null, child.file, data);
    built.push(track);

    // The parent's view of the child: one agent span from the child's own bounds.
    const span: TraceSpan = {
      id: `main:sub:${stem}`,
      kind: 'subagent',
      start: data.startedAt,
      end: data.endedAt,
      label: entry?.agent ?? stem,
      childTrackId: stem,
    };
    if (entry?.detail) span.detail = entry.detail;
    if (data.lastModel !== null) span.model = data.lastModel;
    if (data.startedAt > 0 && data.endedAt >= data.startedAt) {
      mainBuilt.track.spans.push(span);
      mainBuilt.track.spans.sort((a, b) => a.start - b.start || a.end - b.end);
    }
  }

  const toolStatsMap = new Map<string, TraceToolStat>();
  let modelMs = 0;
  let toolMs = 0;
  let totalTokens = 0;
  let requests = 0;
  let toolCalls = 0;
  const tokensByModel = new Map<string, TokenBreakdown>();
  const requestsByModel = new Map<string, number>();
  const models = new Set<string>();

  for (const b of built) {
    modelMs += b.modelMs;
    totalTokens += b.tokens;
    requests += b.requests;
    for (const s of b.toolSpans) {
      const dur = Math.max(0, s.end - s.start);
      toolMs += dur;
      toolCalls += 1;
      const stat = toolStatsMap.get(s.label) ?? { tool: s.label, calls: 0, errors: 0, totalMs: 0, maxMs: 0 };
      stat.calls += 1;
      if (s.error) stat.errors += 1;
      stat.totalMs += dur;
      stat.maxMs = Math.max(stat.maxMs, dur);
      toolStatsMap.set(s.label, stat);
    }
    for (const m of b.models) models.add(m);
    for (const rec of b.data.models) {
      const key = rec.model ?? '(unknown)';
      const into = tokensByModel.get(key) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      into.input += rec.breakdown.input;
      into.output += rec.breakdown.output;
      into.cacheRead += rec.breakdown.cacheRead;
      into.cacheWrite += rec.breakdown.cacheWrite;
      tokensByModel.set(key, into);
      requestsByModel.set(key, (requestsByModel.get(key) ?? 0) + 1);
    }
  }

  let costTotal = 0;
  let unpricedRequests = 0;
  if (price) {
    for (const [model, buckets] of tokensByModel) {
      const priced = price(model, buckets);
      costTotal += priced.usd;
      if (!priced.priced) unpricedRequests += requestsByModel.get(model) ?? 0;
    }
  }

  const firstTurn = main.turns[0]?.start ?? main.startedAt;
  const wallMs = Math.max(0, main.endedAt - firstTurn);
  const summary: TraceSummary = {
    wallMs,
    modelMs,
    toolMs,
    idleMs: Math.max(0, wallMs - modelMs - toolMs),
    turns: main.turns.length,
    requests,
    toolCalls,
    subagents: built.length - 1,
    totalTokens,
    costTotal,
    unpricedRequests,
    models: [...models].sort(),
    toolStats: [...toolStatsMap.values()].sort((a, b) => b.totalMs - a.totalMs),
  };

  return {
    file,
    title: main.title,
    cwd: main.cwd,
    startedAt: main.startedAt,
    endedAt: main.endedAt,
    tracks: built.map((b) => b.track),
    summary,
  };
}

export function sessionListEntry(trace: SessionTrace): SessionListEntry {
  return {
    file: trace.file,
    folder: trace.cwd,
    title: trace.title,
    startedAt: trace.startedAt,
    endedAt: trace.endedAt,
    requests: trace.summary.requests,
    toolCalls: trace.summary.toolCalls,
    subagents: trace.summary.subagents,
    totalTokens: trace.summary.totalTokens,
    costTotal: trace.summary.costTotal,
    unpricedRequests: trace.summary.unpricedRequests,
    models: trace.summary.models,
  };
}

/**
 * A file is a subagent transcript when its parent directory is named after a sibling
 * session file: `<stem>/<task>.jsonl` beside `<stem>.jsonl`.
 */
export function isSubagentFile(file: string): boolean {
  // The main file sits beside the stem directory, not inside it:
  // `<root>/<stem>.jsonl` next to `<root>/<stem>/<task>.jsonl`.
  const dir = path.dirname(file);
  return fs.existsSync(path.join(path.dirname(dir), path.basename(dir) + '.jsonl'));
}

/** Every child transcript of a main session file, for trace extraction. */
export function readChildTranscripts(file: string): ChildTranscript[] {
  const dir = path.join(path.dirname(file), path.basename(file, '.jsonl'));
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: ChildTranscript[] = [];
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    try {
      out.push({ file: path.join(dir, name), text: fs.readFileSync(path.join(dir, name), 'utf8') });
    } catch { /* a file that vanished between listing and reading */ }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}
