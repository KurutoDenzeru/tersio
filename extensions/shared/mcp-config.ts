// One MCP server for every Tersio host. Retrieval, modes, and stats live in `tersio mcp`; no
// second Headroom MCP entry is installed.

import fs from 'node:fs';
import path from 'node:path';
import { HOST_CAPS, hostCap } from './host-caps.ts';
import { stripJsonComments } from './headroom-routing.ts';
import { resolveHostBinary } from './utils.ts';

const SERVER = 'tersio';
/** A separate Headroom entry an earlier build wrote; one MCP server is the point. */
const LEGACY = 'headroom';

function readJson(file: string): Record<string, unknown> | null {
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(stripJsonComments(fs.readFileSync(file, 'utf8'))) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * The client spawns this command with the PATH it inherited at launch, and a GUI-launched agent
 * never reads a shell profile. An absolute path is written whenever the binary is findable now;
 * the bare name stays the fallback so a moved install still starts.
 */
function launch(): { command: string; args: string[] } {
  return { command: resolveHostBinary('tersio') ?? 'tersio', args: ['mcp'] };
}

function entry(host: string): Record<string, unknown> {
  const { command, args } = launch();
  return mcpKey(host) === 'mcp'
    ? { type: 'local', command: [command, ...args], enabled: true }
    : { command, args, enabled: true };
}

/** The end of a JSON string that starts at `start`, or -1 when it never closes. */
function skipString(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === '"') return i + 1;
  }
  return -1;
}

/** The index just past the comment that starts at `start`, or -1 for an unterminated block. */
function skipComment(text: string, start: number): number {
  if (text[start + 1] === '/') {
    const nl = text.indexOf('\n', start);
    return nl < 0 ? text.length : nl + 1;
  }
  const end = text.indexOf('*/', start + 2);
  return end < 0 ? -1 : end + 2;
}

/** Where a top-level key sits and where its value begins, scanning past strings and comments. */
function findTopLevelKey(text: string, key: string): { keyStart: number; valueStart: number } | null {
  return findKeyWithin(text, 0, text.length, key, 1);
}

/** The same scan for one object's own keys, which sit at `depth` from the root. */
function findKeyWithin(text: string, from: number, to: number, key: string, depth = 1): { keyStart: number; valueStart: number } | null {
  let level = depth - 1;
  for (let i = from; i < to;) {
    const char = text[i]!;
    if (char === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
      i = skipComment(text, i);
      if (i < 0) return null;
      continue;
    }
    if (char === '"') {
      const end = skipString(text, i);
      if (end < 0) return null;
      if (level === 1 && text.slice(i + 1, end - 1) === key) {
        let at = end;
        while (at < to && /\s/.test(text[at]!)) at++;
        if (text[at] === ':') {
          at++;
          while (at < to && /\s/.test(text[at]!)) at++;
          return { keyStart: i, valueStart: at };
        }
      }
      i = end;
      continue;
    }
    if (char === '{' || char === '[') level++;
    else if (char === '}' || char === ']') level--;
    i++;
  }
  return null;
}

/** The index where the value starting at `start` ends, so a replacement can replace exactly it. */
function valueEnd(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length;) {
    const char = text[i]!;
    if (char === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
      i = skipComment(text, i);
      if (i < 0) return -1;
      continue;
    }
    if (char === '"') {
      const end = skipString(text, i);
      if (end < 0) return -1;
      i = end;
      continue;
    }
    if (char === '{' || char === '[') { depth++; i++; continue; }
    if (char === '}' || char === ']') {
      if (depth === 0) return i;
      depth--;
      i++;
      continue;
    }
    if (char === ',' && depth === 0) return i;
    i++;
  }
  return -1;
}

/** The indentation of the line the key starts on, so a rewritten value keeps its column. */
function indentAt(text: string, index: number): string {
  const lineStart = text.lastIndexOf('\n', index) + 1;
  return /^\s*/.exec(text.slice(lineStart, index))?.[0] ?? '';
}

function indentBody(text: string, keyIndex: number, body: string): string {
  const pad = indentAt(text, keyIndex);
  return body.split('\n').map((line, n) => (n === 0 ? line : pad + line)).join('\n');
}

/** Cuts one key and its value, taking the comma that separated it so no stray `,` is left behind. */
function removeKey(text: string, found: { keyStart: number; valueStart: number }): string | null {
  const end = valueEnd(text, found.valueStart);
  if (end < 0) return null;
  let before = found.keyStart - 1;
  while (before >= 0 && /\s/.test(text[before]!)) before--;
  if (text[before] === ',') return text.slice(0, before) + text.slice(end);
  let after = end;
  while (after < text.length && /\s/.test(text[after]!)) after++;
  return text.slice(0, found.keyStart) + text.slice(text[after] === ',' ? after + 1 : end);
}

/**
 * Rewrites one top-level key in place, so a `.jsonc` keeps its comments and layout that a
 * JSON.parse round-trip would drop. Null means the text could not be scanned and nothing was written.
 */
export function spliceTopLevelKey(text: string, key: string, value: unknown): string | null {
  const found = findTopLevelKey(text, key);
  if (found) {
    const end = valueEnd(text, found.valueStart);
    if (end < 0) return null;
    return `${text.slice(0, found.valueStart)}${indentBody(text, found.keyStart, JSON.stringify(value, null, 2))}${text.slice(end)}`;
  }
  // No key yet: insert it right after the root brace, where a comment above the first property
  // can never end up between the brace and the comma.
  let open = 0;
  while (open < text.length && text[open] !== '{') {
    if (text[open] === '/' && (text[open + 1] === '/' || text[open + 1] === '*')) {
      open = skipComment(text, open);
      if (open < 0) return null;
      continue;
    }
    open++;
  }
  if (open >= text.length) return null;
  let after = open + 1;
  while (after < text.length && /\s/.test(text[after]!)) after++;
  let empty = text[after] === '}';
  if (!empty && text[after] === '/' && (text[after + 1] === '/' || text[after + 1] === '*')) {
    const jump = skipComment(text, after);
    if (jump < 0) return null;
    let probe = jump;
    while (probe < text.length && /\s/.test(text[probe]!)) probe++;
    empty = text[probe] === '}';
  }
  const block = `${JSON.stringify(key)}: ${indentBody(text, open, JSON.stringify(value, null, 2)).replace(/^/, '')}`;
  return `${text.slice(0, open + 1)}\n  ${block}${empty ? '' : ','}${text.slice(open + 1)}`;
}

/**
 * Adds, replaces, or removes one entry inside an object key, touching nothing else in the file.
 * A null value removes the entry; a missing entry is not an error, so a re-run stays quiet.
 */
export function spliceNestedKey(text: string, outer: string, inner: string, value: unknown): string | null {
  const container = findTopLevelKey(text, outer);
  if (!container) return null;
  if (text[container.valueStart] !== '{') return null;
  const containerEnd = valueEnd(text, container.valueStart);
  if (containerEnd < 0) return null;
  const found = findKeyWithin(text, container.valueStart + 1, containerEnd, inner, 2);
  if (value === null) return found ? removeKey(text, found) : text;
  const body = JSON.stringify(value, null, 2);
  if (found) {
    const end = valueEnd(text, found.valueStart);
    if (end < 0) return null;
    return `${text.slice(0, found.valueStart)}${indentBody(text, found.keyStart, body)}${text.slice(end)}`;
  }
  const pad = `${indentAt(text, container.keyStart)}  `;
  let inner_end = containerEnd - 1;
  while (inner_end > container.valueStart && /\s/.test(text[inner_end]!)) inner_end--;
  const empty = text[inner_end] === '{';
  const block = `${JSON.stringify(inner)}: ${body.split('\n').map((line, n) => (n === 0 ? line : pad + line)).join('\n')}`;
  return `${text.slice(0, container.valueStart + 1)}\n${pad}${block}${empty ? '' : ','}${text.slice(container.valueStart + 1)}`;
}

function writeIfChanged(file: string, data: Record<string, unknown>): boolean {
  const next = `${JSON.stringify(data, null, 2)}\n`;
  try {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === next) return true;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, next, 'utf8');
    return true;
  } catch {
    return false;
  }
}

function mcpFile(host: string): string | null {
  return hostCap(host)?.mcpFile() ?? null;
}

function mcpKey(host: string): 'mcpServers' | 'mcp' {
  return hostCap(host)?.mcp === 'mcp' ? 'mcp' : 'mcpServers';
}

function serverMap(host: string, data: Record<string, unknown>): Record<string, unknown> {
  const section = data[mcpKey(host)];
  return section && typeof section === 'object' ? section as Record<string, unknown> : {};
}

/** True when this host has an MCP config Tersio knows how to write. */
export function tersioMcpSupported(host: string): boolean {
  return hostCap(host)?.mcp != null;
}

/** True when this host already reaches Tersio's MCP server, through a config file or its bundle patch. */
export function tersioMcpConfigured(host: string): boolean {
  const bundle = hostCap(host)?.mcpBundle;
  if (bundle) return bundle();
  const file = mcpFile(host);
  if (!file) return false;
  const data = readJson(file);
  return Boolean(data && SERVER in serverMap(host, data));
}

function isJsonc(file: string): boolean {
  return file.toLowerCase().endsWith('.jsonc');
}

/** Applies one text edit to a comment-carrying file, leaving it untouched when nothing changed. */
function editJsonc(file: string, edit: (text: string) => string | null): boolean {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return false;
  }
  const next = edit(text);
  if (next === null) return false;
  if (next === text) return true;
  try {
    fs.writeFileSync(file, next, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** Adds Tersio's MCP server, drops the legacy Headroom entry, and leaves other servers alone. */
export function ensureTersioMcp(host: string): boolean {
  const file = mcpFile(host);
  if (!file) return false;
  const data = readJson(file);
  if (!data) return false;
  const servers = serverMap(host, data);
  if (!(SERVER in servers)) servers[SERVER] = entry(host);
  delete servers[LEGACY];
  data[mcpKey(host)] = servers;
  if (Array.isArray(data.disabledServers)) {
    data.disabledServers = data.disabledServers.filter((name) => name !== SERVER && name !== LEGACY);
  }
  if (!isJsonc(file)) return writeIfChanged(file, data);
  const key = mcpKey(host);
  return editJsonc(file, (text) => {
    // An existing block is edited entry by entry so the comments inside it survive.
    let next = findTopLevelKey(text, key)
      ? spliceNestedKey(text, key, SERVER, entry(host))
      : spliceTopLevelKey(text, key, { [SERVER]: entry(host) });
    if (next === null) return null;
    next = spliceNestedKey(next, key, LEGACY, null) ?? next;
    if (Array.isArray(data.disabledServers)) next = spliceTopLevelKey(next, 'disabledServers', data.disabledServers) ?? next;
    return next;
  });
}

/** Removes the two entries Tersio can own; a user's own server config survives. */
export function removeTersioMcp(host: string): boolean {
  const file = mcpFile(host);
  if (!file) return false;
  const data = readJson(file);
  if (!data) return false;
  const servers = serverMap(host, data);
  if (!(SERVER in servers) && !(LEGACY in servers)) return false;
  delete servers[SERVER];
  delete servers[LEGACY];
  if (!isJsonc(file)) return writeIfChanged(file, data);
  const key = mcpKey(host);
  return editJsonc(file, (text) => {
    if (!findTopLevelKey(text, key)) return text;
    const next = spliceNestedKey(text, key, SERVER, null);
    return next === null ? null : spliceNestedKey(next, key, LEGACY, null);
  });
}


/** Where the entry lives, for a dashboard or a doctor row. */
export function tersioMcpFile(host: string): string | null {
  return mcpFile(host);
}

/** Every host an MCP reader should name, in the order the host table declares them. */
export function tersioMcpHosts(): string[] {
  return Object.keys(HOST_CAPS);
}
