// One table of what each agent host supports. Install, MCP, RTK, and Headroom read this
// instead of repeating the same host conditionals.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { homeDir, piAgentDir, pigAgentDir } from './utils.ts';

export type HostId = 'omp' | 'pi' | 'opencode' | 'pig' | 'dsh';

export interface HostCap {
  id: HostId;
  label: string;
  bin: string;
  installCmd: string;
  removeCmd: string;
  /** The MCP config shape, or null when the host has none Tersio writes. */
  mcp: 'mcpServers' | 'mcp' | null;
  /** The MCP file at call time, so a redirected HOME is honored. */
  mcpFile: () => string | null;
  /** The rtk agent name; null when rtk has no binding or the plugin owns the rewrite. */
  rtkAgent: string | null;
  /** The Tersio plugin owns rtk's rewrite; no separate rtk entry exists. */
  rtkPlugin?: boolean;
  /** rtk has no agent for this host, so copy the named host's hook. */
  rtkCopyFrom?: HostId;
  /** Headroom can route this host. */
  headroom: boolean;
}

function ompAgentDir(): string {
  const moved = (process.env.PI_CODING_AGENT_DIR ?? '').trim();
  return moved || path.join(homeDir(), '.omp', 'agent');
}

function opencodeConfig(): string {
  const candidates = [
    path.join(homeDir(), '.config', 'opencode', 'opencode.json'),
    path.join(homeDir(), '.config', 'opencode', 'opencode.jsonc'),
  ];
  return candidates.find((file) => existsSync(file)) ?? candidates[0]!;
}

export const HOST_CAPS: Record<HostId, HostCap> = {
  omp: {
    id: 'omp', label: 'Oh My Pi', bin: 'omp',
    installCmd: 'omp plugin install @krtclcdy/tersio', removeCmd: 'omp plugin remove @krtclcdy/tersio',
    mcp: 'mcpServers', mcpFile: () => path.join(ompAgentDir(), 'mcp.json'),
    rtkAgent: 'omp', headroom: true,
  },
  pi: {
    id: 'pi', label: 'Pi', bin: 'pi',
    installCmd: 'pi install npm:@krtclcdy/tersio', removeCmd: 'pi remove npm:@krtclcdy/tersio',
    mcp: 'mcpServers', mcpFile: () => path.join(piAgentDir(), 'mcp.json'),
    rtkAgent: 'pi', headroom: false,
  },
  opencode: {
    id: 'opencode', label: 'OpenCode', bin: 'opencode',
    installCmd: 'tersio install --host opencode', removeCmd: 'tersio uninstall --host opencode',
    mcp: 'mcp', mcpFile: opencodeConfig,
    rtkAgent: null, rtkPlugin: true, headroom: true,
  },
  pig: {
    id: 'pig', label: 'Pi-in-go', bin: 'pig',
    installCmd: 'pig install npm:@krtclcdy/tersio', removeCmd: 'pig remove npm:@krtclcdy/tersio',
    mcp: 'mcpServers', mcpFile: () => path.join(pigAgentDir(), 'mcp.json'),
    rtkAgent: 'pi', rtkCopyFrom: 'pi', headroom: false,
  },
  dsh: {
    id: 'dsh', label: 'DeepSeek Harness', bin: 'dsh',
    installCmd: 'dsh plugin --profile web add npm:@krtclcdy/tersio', removeCmd: 'dsh plugin --profile web remove @krtclcdy/tersio',
    mcp: null, mcpFile: () => null,
    rtkAgent: null, headroom: false,
  },
};

export function hostCap(id: string): HostCap | null {
  return (HOST_CAPS as Record<string, HostCap>)[id] ?? null;
}
