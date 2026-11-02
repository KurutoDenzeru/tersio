// One MCP server for every Tersio host. Retrieval, modes, and stats live in `tersio mcp`; no
// second Headroom MCP entry is installed.

import fs from 'node:fs';
import path from 'node:path';
import { hostCap } from './host-caps.ts';
import { stripJsonComments } from './headroom-routing.ts';

const SERVER = 'tersio';
/** A separate Headroom entry an earlier build wrote; one MCP server is the point. */
const LEGACY = 'headroom';
const ENTRY = { command: 'tersio', args: ['mcp'], enabled: true };
const OPENCODE_ENTRY = { type: 'local', command: ['tersio', 'mcp'], enabled: true };

function readJson(file: string): Record<string, unknown> | null {
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(stripJsonComments(fs.readFileSync(file, 'utf8'))) as Record<string, unknown>;
  } catch {
    return null;
  }
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

/** True when this host's config names Tersio's MCP server. */
export function tersioMcpConfigured(host: string): boolean {
  const file = mcpFile(host);
  if (!file) return false;
  const data = readJson(file);
  return Boolean(data && SERVER in serverMap(host, data));
}

/** Adds Tersio's MCP server, drops the legacy Headroom entry, and leaves other servers alone. */
export function ensureTersioMcp(host: string): boolean {
  const file = mcpFile(host);
  if (!file) return false;
  const data = readJson(file);
  if (!data) return false;
  const servers = serverMap(host, data);
  if (!(SERVER in servers)) servers[SERVER] = mcpKey(host) === 'mcp' ? { ...OPENCODE_ENTRY } : { ...ENTRY };
  delete servers[LEGACY];
  data[mcpKey(host)] = servers;
  if (Array.isArray(data.disabledServers)) {
    data.disabledServers = data.disabledServers.filter((name) => name !== SERVER && name !== LEGACY);
  }
  return writeIfChanged(file, data);
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
  return writeIfChanged(file, data);
}

/** Where the entry lives, for a dashboard or a doctor row. */
export function tersioMcpFile(host: string): string | null {
  return mcpFile(host);
}
