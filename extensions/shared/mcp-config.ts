// One MCP server for every Tersio host. Retrieval, modes, and stats live in `tersio mcp`; no
// second Headroom MCP entry is installed.

import fs, { realpathSync } from 'node:fs';
import path from 'node:path';
import { HOST_CAPS, hostCap } from './host-caps.ts';
import { stripJsonComments } from './headroom-routing.ts';
import { findTopLevelKey, spliceNestedKey, spliceTopLevelKey } from './jsonc-edit.ts';

export { spliceTopLevelKey } from './jsonc-edit.ts';
import { resolveHostBinary } from './utils.ts';

const SERVER = 'tersio';
const IS_WINDOWS = process.platform === 'win32';
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
 * The installed bin names node in its shebang, so a bare launch boots node and pays a second boot
 * once the CLI hands itself to bun. With bun on the machine and the entry point to run, the server
 * starts under bun directly and the node image never exists.
 */
function bunLaunch(bin: string): { command: string; args: string[] } | null {
  // The bin is a node script next to the tree it runs, and a symlink to it resolves to the same file.
  let script = bin;
  try {
    script = realpathSync(bin);
  } catch {
    /* keep the bin path: it may still be the script */
  }
  if (!script.endsWith('.js')) return null;
  const bun = resolveHostBinary(IS_WINDOWS ? 'bun.exe' : 'bun');
  return bun ? { command: bun, args: [script, 'mcp'] } : null;
}

/**
 * The client spawns this command with the PATH it inherited at launch, and a GUI-launched agent
 * never reads a shell profile. An absolute path is written whenever the binary is findable now;
 * the bare name stays the fallback so a moved install still starts.
 */
function launch(): { command: string; args: string[] } {
  const bin = resolveHostBinary('tersio');
  if (bin) {
    const underBun = bunLaunch(bin);
    if (underBun) return underBun;
  }
  return { command: bin ?? 'tersio', args: ['mcp'] };
}

function entry(host: string): Record<string, unknown> {
  const { command, args } = launch();
  return mcpKey(host) === 'mcp'
    ? { type: 'local', command: [command, ...args], enabled: true }
    : { command, args, enabled: true };
}

/** The command a plugin-host manifest points at; Claude Code reads command and args, not `enabled`. */
export function tersioMcpLaunch(): { command: string; args: string[] } {
  return launch();
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
  return section && typeof section === 'object' ? (section as Record<string, unknown>) : {};
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
  if (hostCap(host)?.mcp === 'plugin') return tersioMcpConfigured(host);
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
    if (Array.isArray(data.disabledServers))
      next = spliceTopLevelKey(next, 'disabledServers', data.disabledServers) ?? next;
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
