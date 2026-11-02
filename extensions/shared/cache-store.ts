// Machine caches live inside the usage ledger, beside the data they describe, so the data home keeps its loose files for user config and human reports.
import path from 'node:path';
import zlib from 'node:zlib';
import { tersioHome } from './utils.ts';
import { sqliteAvailable, sqliteExec, sqliteRead } from './sqlite.ts';

/** Keys are stable strings: `prices`, `upstream.scorecard`, `upstream.tree.<repo>@<ref>`. */
const memory = new Map<string, Map<string, string>>();

/** Tables created this process; a read must not take a write lock just to re-assert its own schema. */
const ready = new Set<string>();

function dbFile(): string {
  return path.join(tersioHome(), 'usage.db');
}

/** The fallback map for this data home, so one HOME's cache never answers for another's. */
function fallback(): Map<string, string> {
  const file = dbFile();
  let rows = memory.get(file);
  if (!rows) {
    rows = new Map();
    memory.set(file, rows);
  }
  return rows;
}

/** SQLite text cannot carry the tabs and newlines sqliteRead splits on, so the value rides as base64. */
function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Gzip before base64: these payloads are JSON, which halves twice over. `z:` marks a compressed row; older rows stay readable. */
function encode(text: string): string {
  return `z:${zlib.gzipSync(Buffer.from(text, 'utf8')).toString('base64')}`;
}

function decode(stored: string): string {
  if (!stored.startsWith('z:')) return Buffer.from(stored, 'base64').toString('utf8');
  return zlib.gunzipSync(Buffer.from(stored.slice(2), 'base64')).toString('utf8');
}

function ensure(file: string): boolean {
  if (ready.has(file)) return true;
  if (!sqliteAvailable()) return false;
  try {
    sqliteExec(file, 'CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);');
    ready.add(file);
    return true;
  } catch {
    return false;
  }
}

/** The stored text, or null when the key is absent or SQLite cannot answer. */
export function cacheGet(key: string): string | null {
  const file = dbFile();
  if (!ensure(file)) return fallback().get(key) ?? null;
  try {
    const rows = sqliteRead(file, `SELECT value FROM cache WHERE key = ${quote(key)}`);
    const line = rows.split('\n').find((row) => row.trim() !== '');
    if (!line) return null;
    const stored = line.split('\t')[0];
    const text = decode(stored);
    // A row an older build wrote as plain base64 is rewritten compressed once, so the ledger shrinks as it is read.
    if (!stored.startsWith('z:')) cachePut(key, text);
    return text;
  } catch {
    return fallback().get(key) ?? null;
  }
}

/** Writes the key and its update stamp; the in-memory copy keeps a single process working without SQLite. */
export function cachePut(key: string, value: string): boolean {
  const file = dbFile();
  fallback().set(key, value);
  if (!ensure(file)) return false;
  try {
    sqliteExec(file, `INSERT OR REPLACE INTO cache (key, value, updated_at) VALUES (${quote(key)}, ${quote(encode(value))}, ${Date.now()});`);
    return true;
  } catch {
    // A database that vanished under the process gets one fresh attempt on the next call.
    ready.delete(file);
    return false;
  }
}

export function cacheDelete(key: string): void {
  const file = dbFile();
  fallback().delete(key);
  if (!ensure(file)) return;
  try {
    sqliteExec(file, `DELETE FROM cache WHERE key = ${quote(key)};`);
  } catch { /* a missing table is already the desired state */ }
}

/** The write time in milliseconds, so a reader can tell a hit from a stale entry. */
export function cacheStamp(key: string): number {
  const file = dbFile();
  if (!ensure(file)) return fallback().has(key) ? 1 : 0;
  try {
    const rows = sqliteRead(file, `SELECT updated_at FROM cache WHERE key = ${quote(key)}`);
    const line = rows.split('\n').find((row) => row.trim() !== '');
    return line ? Number(line.split('\t')[0]) || 0 : 0;
  } catch {
    return fallback().has(key) ? 1 : 0;
  }
}

/** Every key under a prefix, so a cache can prune its own rows. */
export function cacheKeys(prefix: string): string[] {
  const file = dbFile();
  if (!ensure(file)) return [...fallback().keys()].filter((name) => name.startsWith(prefix));
  try {
    const rows = sqliteRead(file, `SELECT key FROM cache WHERE key LIKE ${quote(`${prefix}%`)}`);
    return rows.split('\n').map((row) => row.split('\t')[0]).filter((name) => name !== '');
  } catch {
    return [...fallback().keys()].filter((name) => name.startsWith(prefix));
  }
}
