// Fixtures for the three schemas the aggregate reads: the usage store, omp's quota db, and a session journal.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { sqliteExec } from '../../extensions/shared/sqlite.ts';

/** The usage store, as `usage-store.ts` writes it. */
const STORE_SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS files (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT UNIQUE NOT NULL, mtime REAL NOT NULL, size INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS messages (file_id INTEGER NOT NULL REFERENCES files(id), t REAL, model TEXT NOT NULL,
  i INTEGER NOT NULL, o INTEGER NOT NULL, d REAL, tf REAL, cr INTEGER NOT NULL, cw INTEGER NOT NULL,
  usd REAL, st TEXT NOT NULL, code REAL, note TEXT, tools TEXT NOT NULL DEFAULT '[]', h TEXT, a TEXT, id TEXT, tc TEXT, p TEXT);
CREATE INDEX idx_messages_file ON messages(file_id);
CREATE INDEX idx_messages_t ON messages(t);
CREATE INDEX idx_messages_h_t ON messages(h, t);
CREATE INDEX idx_messages_model ON messages(model);
`;

/** omp's quota snapshots, the one thing only omp records. */
const QUOTA_SCHEMA = `
CREATE TABLE usage_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recorded_at INTEGER NOT NULL, provider TEXT NOT NULL, account_key TEXT NOT NULL,
  email TEXT, account_id TEXT, limit_id TEXT NOT NULL, label TEXT NOT NULL, window_label TEXT,
  used_fraction REAL, status TEXT, resets_at INTEGER
);
CREATE INDEX idx_usage_history_series ON usage_history(provider, account_key, limit_id, recorded_at);
`;

export interface MessageFixture {
  /** Absolute transcript path. Its `<root>/sessions/<project>/` segment names the project. */
  session: string;
  /** The store's row id. */
  entry: string;
  /** Full model id. Its first segment names the gateway only when the row carries no `gateway`. */
  model: string;
  /** The gateway the transcript named, which the model id cannot show. */
  gateway?: string;
  ts: number;
  stop?: string;
  error?: string | null;
  duration?: number | null;
  /** First-token latency in ms. Absent reads as null, the way a host that records none does. */
  ttft?: number | null;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  /** The cost the host reported. Absent when the host priced nothing, which reads as $0.00. */
  cost?: number | null;
  agentType?: string;
  /** Tool names this message handed off to, as the store keeps them. */
  tools?: string[];
  /** Per-call facts, as a store written by this build keeps them. Absent reads as a names-only row. */
  toolFacts?: Array<{ n: string; a: number; r: number; e: number }>;
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

/** A transcript path under a session root; use an absolute root so strings stay stable across platforms. */
export function sessionPath(root: string, project: string, file: string): string {
  return path.join(root, 'agent', 'sessions', project, file);
}

export function writeUsageStore(file: string, fixture: { messages: MessageFixture[] }): string {
  mkdirSync(path.dirname(file), { recursive: true });
  // One file row per distinct transcript, because the store holds the path once and joins on it.
  const paths = [...new Set(fixture.messages.map((m) => m.session))];
  const script = [
    STORE_SCHEMA,
    insert(
      'files',
      ['path', 'mtime', 'size'],
      paths.map((p) => [p, 0, 0]),
    ),
    ...paths.map((p, index) =>
      insert(
        'messages',
        [
          'file_id',
          't',
          'model',
          'i',
          'o',
          'd',
          'tf',
          'cr',
          'cw',
          'usd',
          'st',
          'note',
          'tools',
          'h',
          'a',
          'id',
          'tc',
          'p',
        ],
        fixture.messages
          .filter((m) => m.session === p)
          .map((m) => [
            index + 1,
            m.ts,
            m.model,
            m.input ?? 0,
            m.output ?? 0,
            m.duration ?? null,
            m.ttft ?? null,
            m.cacheRead ?? 0,
            m.cacheWrite ?? 0,
            m.cost ?? null,
            m.stop === 'stop' || m.stop === undefined ? 'completed' : m.stop,
            m.error ?? null,
            JSON.stringify(m.tools ?? []),
            'omp',
            m.agentType ?? 'main',
            m.entry,
            m.toolFacts ? JSON.stringify(m.toolFacts) : null,
            m.gateway ?? null,
          ]),
      ),
    ),
  ];
  sqliteExec(file, script.join('\n'));
  return file;
}

export function writeQuotaDb(file: string, windows: WindowFixture[]): string {
  mkdirSync(path.dirname(file), { recursive: true });
  const script = [
    QUOTA_SCHEMA,
    insert(
      'usage_history',
      [
        'recorded_at',
        'provider',
        'account_key',
        'email',
        'account_id',
        'limit_id',
        'label',
        'window_label',
        'used_fraction',
        'status',
        'resets_at',
      ],
      windows.map((w) => [
        w.ts,
        w.provider,
        w.accountKey,
        w.email ?? null,
        w.accountId ?? null,
        w.limitId,
        w.label,
        w.windowLabel ?? null,
        w.usedFraction ?? null,
        w.status ?? null,
        w.resetsAt ?? null,
      ]),
    ),
  ];
  sqliteExec(file, script.join('\n'));
  return file;
}

/** A session transcript as omp writes it: the trace reader needs both `timestamp` and `startedAt`. */
export function writeSessionFixture(file: string, messages: Array<Record<string, unknown>>): string {
  mkdirSync(path.dirname(file), { recursive: true });
  const lines = [
    JSON.stringify({
      type: 'session',
      version: 3,
      id: 'sess',
      timestamp: '2026-01-01T00:00:00.000Z',
      cwd: '/tmp/project',
    }),
    ...messages.map((message, index) => {
      const { timestamp, startedAt, ...body } = message;
      const line: Record<string, unknown> = {
        type: 'message',
        id: `m${index}`,
        timestamp: typeof timestamp === 'string' ? timestamp : '2026-01-01T00:00:01.000Z',
        message: typeof startedAt === 'number' ? { ...body, timestamp: startedAt } : body,
      };
      return JSON.stringify(line);
    }),
  ];
  writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
  return file;
}
