// Reads a live omp stats database. Fixtures here mirror the on-disk shape so the aggregate can be
// pinned without an omp install: same column names, same nullable columns, same defaults.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_file TEXT NOT NULL, entry_id TEXT NOT NULL, folder TEXT NOT NULL,
  model TEXT NOT NULL, provider TEXT NOT NULL, api TEXT NOT NULL,
  timestamp INTEGER NOT NULL, duration INTEGER, ttft INTEGER,
  stop_reason TEXT NOT NULL, error_message TEXT,
  input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL, cache_write_tokens INTEGER NOT NULL, total_tokens INTEGER NOT NULL,
  premium_requests REAL NOT NULL,
  cost_input REAL NOT NULL, cost_output REAL NOT NULL, cost_cache_read REAL NOT NULL,
  cost_cache_write REAL NOT NULL, cost_total REAL NOT NULL, cost_no_cache_input REAL,
  agent_type TEXT NOT NULL DEFAULT 'main', cost_unpriced INTEGER NOT NULL DEFAULT 0, service_tier TEXT,
  UNIQUE(session_file, entry_id)
);
CREATE INDEX idx_messages_timestamp ON messages(timestamp);
CREATE TABLE tool_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_file TEXT NOT NULL, entry_id TEXT NOT NULL, tool_call_id TEXT NOT NULL, folder TEXT NOT NULL,
  tool_name TEXT NOT NULL, model TEXT NOT NULL, provider TEXT NOT NULL, timestamp INTEGER NOT NULL,
  agent_type TEXT NOT NULL DEFAULT 'main', calls_in_turn INTEGER NOT NULL DEFAULT 1,
  args_chars INTEGER NOT NULL DEFAULT 0, result_chars INTEGER, is_error INTEGER,
  UNIQUE(session_file, tool_call_id)
);
`;

const AGENT_SCHEMA = `
CREATE TABLE usage_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recorded_at INTEGER NOT NULL, provider TEXT NOT NULL, account_key TEXT NOT NULL,
  email TEXT, account_id TEXT, limit_id TEXT NOT NULL, label TEXT NOT NULL, window_label TEXT,
  used_fraction REAL, status TEXT, resets_at INTEGER
);
CREATE INDEX idx_usage_history_series ON usage_history(provider, account_key, limit_id, recorded_at);
`;

export interface MessageFixture {
  session: string;
  entry: string;
  folder: string;
  model: string;
  provider: string;
  ts: number;
  stop?: string;
  error?: string | null;
  duration?: number | null;
  ttft?: number | null;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total?: number;
  cost?: number;
  noCacheCost?: number | null;
  costInput?: number;
  costOutput?: number;
  costRead?: number;
  costWrite?: number;
  agentType?: string;
  costUnpriced?: number;
}

export interface ToolFixture {
  session: string;
  entry: string;
  toolCallId: string;
  tool: string;
  model: string;
  provider: string;
  ts: number;
  callsInTurn?: number;
  argsChars?: number;
  resultChars?: number | null;
  isError?: number;
}

export interface WindowFixture {
  ts: number;
  provider: string;
  accountKey: string;
  email?: string | null;
  accountId?: string | null;
  limitId: string;
  label: string;
  windowLabel?: string | null;
  usedFraction?: number | null;
  status?: string | null;
  resetsAt?: number | null;
}

function q(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  return `'${value.replace(/'/g, "''")}'`;
}

function insert(table: string, columns: string[], rows: Array<Array<string | number | null | undefined>>): string {
  if (rows.length === 0) return '';
  const values = rows.map((row) => `(${row.map(q).join(',')})`).join(',');
  return `INSERT INTO ${table} (${columns.join(',')}) VALUES ${values};`;
}

export function writeAgentStatsDb(file: string, fixture: {
  messages: MessageFixture[];
  tools?: ToolFixture[];
}): string {
  mkdirSync(path.dirname(file), { recursive: true });
  const script = [SCHEMA];
  script.push(insert(
    'messages',
    ['session_file', 'entry_id', 'folder', 'model', 'provider', 'api', 'timestamp', 'duration', 'ttft',
      'stop_reason', 'error_message', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens',
      'total_tokens', 'premium_requests', 'cost_input', 'cost_output', 'cost_cache_read', 'cost_cache_write',
      'cost_total', 'cost_no_cache_input', 'agent_type', 'cost_unpriced'],
    fixture.messages.map((m) => [
      m.session, m.entry, m.folder, m.model, m.provider, 'openai-completions', m.ts,
      m.duration ?? null, m.ttft ?? null, m.stop ?? 'stop', m.error ?? null,
      m.input ?? 0, m.output ?? 0, m.cacheRead ?? 0, m.cacheWrite ?? 0, m.total ?? 0,
      0, m.costInput ?? 0, m.costOutput ?? 0, m.costRead ?? 0, m.costWrite ?? 0,
      m.cost ?? 0, m.noCacheCost ?? null, m.agentType ?? 'main', m.costUnpriced ?? 0,
    ]),
  ));
  script.push(insert(
    'tool_calls',
    ['session_file', 'entry_id', 'tool_call_id', 'folder', 'tool_name', 'model', 'provider', 'timestamp',
      'calls_in_turn', 'args_chars', 'result_chars', 'is_error'],
    (fixture.tools ?? []).map((t) => [
      t.session, t.entry, t.toolCallId, '', t.tool, t.model, t.provider, t.ts,
      t.callsInTurn ?? 1, t.argsChars ?? 0, t.resultChars ?? null, t.isError ?? 0,
    ]),
  ));
  execFileSync('sqlite3', [file], { input: script.join('\n'), timeout: 30_000 });
  return file;
}

export function writeOmpAgentDb(file: string, windows: WindowFixture[]): string {
  mkdirSync(path.dirname(file), { recursive: true });
  const script = [AGENT_SCHEMA, insert(
    'usage_history',
    ['recorded_at', 'provider', 'account_key', 'email', 'account_id', 'limit_id', 'label', 'window_label',
      'used_fraction', 'status', 'resets_at'],
    windows.map((w) => [
      w.ts, w.provider, w.accountKey, w.email ?? null, w.accountId ?? null, w.limitId, w.label,
      w.windowLabel ?? null, w.usedFraction ?? null, w.status ?? null, w.resetsAt ?? null,
    ]),
  )];
  execFileSync('sqlite3', [file], { input: script.join('\n'), timeout: 30_000 });
  return file;
}

/** One session transcript, in the shape omp writes under `agent/sessions`. */
export function writeSessionFixture(file: string, messages: Array<Record<string, unknown>>): string {
  mkdirSync(path.dirname(file), { recursive: true });
  const lines = [
    JSON.stringify({ type: 'session', version: 3, id: 'sess', timestamp: '2026-01-01T00:00:00.000Z', cwd: '/tmp/project' }),
    ...messages.map((message) => JSON.stringify({ type: 'message', id: 'x', timestamp: '2026-01-01T00:00:01.000Z', message })),
  ];
  writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
  return file;
}
