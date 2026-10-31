// One place that runs SQL: Bun or Node 22.5+ in process, the `sqlite3` binary as the fallback, and rows in its CLI shape for every caller. The write path leaves the journal mode alone (see docs/ERRORS.md).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

/** A read this large used to vanish behind a 1MB cap, which cleared on one busy session_message table. */
const SQLITE_READ_BUFFER = 50 * 1024 * 1024;

const TIMEOUT = 30_000;
const requireOptional = createRequire(import.meta.url);

interface Engine {
  kind: 'bun' | 'node';
  read(db: string, sql: string): unknown[][];
  exec(db: string, sql: string): void;
}

interface BunDatabase {
  query(sql: string): { values(): unknown[][] };
  exec(sql: string): void;
  close(): void;
}

interface NodeStatement {
  all(): unknown[][];
  setReturnArrays?(on: boolean): unknown;
}

interface NodeDatabase {
  prepare(sql: string): NodeStatement;
  exec(sql: string): void;
  close(): void;
}

let cached: Engine | null | undefined;
let cachedFor: string | undefined;

/** Bun's SQLite, or Node's when this build carries one. Null when neither runtime has an engine. */
function engine(): Engine | null {
  const asked = process.env.TERSIO_SQLITE ?? '';
  if (cached !== undefined && cachedFor === asked) return cached;
  cachedFor = asked;
  cached = null;
  if (asked === 'cli') return cached;
  try {
    const { Database } = requireOptional('bun:sqlite') as { Database: new (db: string, opts?: { readonly?: boolean }) => BunDatabase };
    cached = {
      kind: 'bun',
      read: (db, sql) => { const d = new Database(db, { readonly: true }); try { return d.query(sql).values(); } finally { d.close(); } },
      exec: (db, sql) => { const d = new Database(db); try { d.exec(sql); } finally { d.close(); } },
    };
    return cached;
  } catch { /* not Bun, or no SQLite in this build */ }
  try {
    const { DatabaseSync } = requireOptional('node:sqlite') as { DatabaseSync: new (db: string, opts?: { readOnly?: boolean }) => NodeDatabase };
    // Rows arrive keyed by column name unless the statement returns arrays: a duplicate name collapses its key and shifts every later cell, so a Node that cannot return arrays is no engine.
    const probe = new DatabaseSync(':memory:');
    try {
      if (typeof probe.prepare('SELECT 1').setReturnArrays !== 'function') throw new Error('no positional rows');
    } finally {
      probe.close();
    }
    cached = {
      kind: 'node',
      read: (db, sql) => {
        const d = new DatabaseSync(db, { readOnly: true });
        try {
          const st = d.prepare(sql);
          st.setReturnArrays?.(true);
          return st.all();
        } finally { d.close(); }
      },
      exec: (db, sql) => { const d = new DatabaseSync(db); try { d.exec(sql); } finally { d.close(); } },
    };
    return cached;
  } catch { /* Node older than 22.5, or one built without SQLite or positional rows */ }
  return cached;
}

/** The `sqlite3` binary, resolved once from PATH so a missing one costs one scan, not one spawn per call. */
let binary: string | null | undefined;
function findBinary(): string | null {
  if (binary !== undefined) return binary;
  binary = null;
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    for (const name of process.platform === 'win32' ? ['sqlite3.exe', 'sqlite3'] : ['sqlite3']) {
      const at = path.join(dir, name);
      try {
        fs.accessSync(at, fs.constants.X_OK);
        binary = at;
        return binary;
      } catch { /* not here */ }
    }
  }
  return binary;
}

/** `bun`, `node`, `cli`, or null when this host has no way to read SQLite at all. */
export function sqliteEngine(): 'bun' | 'node' | 'cli' | null {
  return engine()?.kind ?? (findBinary() === null ? null : 'cli');
}

/** Whether any path can run SQL: what the tests guard their skips on. */
export function sqliteAvailable(): boolean {
  return sqliteEngine() !== null;
}

/** Rows as the CLI prints them, so a caller cannot tell which engine answered. */
function toTsv(rows: unknown[][]): string {
  if (rows.length === 0) return '';
  return `${rows.map((row) => row.map((cell) => (cell === null || cell === undefined ? '' : String(cell))).join('\t')).join('\n')}\n`;
}

function cliRead(db: string, sql: string): string {
  const opts = { encoding: 'utf8' as const, timeout: TIMEOUT, stdio: ['pipe', 'pipe', 'ignore'] as ['pipe', 'pipe', 'ignore'], maxBuffer: SQLITE_READ_BUFFER, input: sql };
  try {
    return execFileSync('sqlite3', ['-separator', '\t', '-readonly', db], opts);
  } catch { /* the side files may be gone; try the next rung */ }
  if (!fs.existsSync(`${db}-wal`)) {
    try {
      return execFileSync('sqlite3', ['-separator', '\t', `file:${db}?immutable=1`], opts);
    } catch { /* fall through to the copy */ }
  }
  // A live database cannot be read without its write-ahead log, so copy the set and read the copy.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tersio-sqlite-'));
  const target = path.join(dir, path.basename(db));
  try {
    fs.copyFileSync(db, target);
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(`${db}${suffix}`)) fs.copyFileSync(`${db}${suffix}`, `${target}${suffix}`);
    }
    return execFileSync('sqlite3', ['-separator', '\t', '-readonly', target], opts);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Read through the in-process engine, retrying on a private copy when the file will not open. */
function engineRead(e: Engine, db: string, sql: string): unknown[][] {
  try {
    return e.read(db, sql);
  } catch {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tersio-sqlite-'));
    const target = path.join(dir, path.basename(db));
    try {
      fs.copyFileSync(db, target);
      for (const suffix of ['-wal', '-shm']) {
        if (fs.existsSync(`${db}${suffix}`)) fs.copyFileSync(`${db}${suffix}`, `${target}${suffix}`);
      }
      return e.read(target, sql);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

/** Run a read and return the tab-separated rows. Throws when the file is missing, as the callers expect. */
export function sqliteRead(db: string, sql: string): string {
  if (!fs.existsSync(db)) throw new Error(`missing database: ${db}`);
  const e = engine();
  if (e !== null) {
    try {
      return toTsv(engineRead(e, db, sql));
    } catch { /* the engine may lack a feature the CLI has; the CLI gets the last word */ }
  }
  return cliRead(db, sql);
}

/** Run a script, creating the file if needed. Stops at the first error, so a failed INSERT leaves no DELETEs. */
export function sqliteExec(db: string, sql: string): void {
  const e = engine();
  if (e !== null) {
    e.exec(db, sql);
    return;
  }
  execFileSync('sqlite3', ['-bail', db, sql], { stdio: ['ignore', 'ignore', 'ignore'], timeout: TIMEOUT });
}