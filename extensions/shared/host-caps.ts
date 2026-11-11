// One table of what each agent host supports. Install, MCP, RTK, and Headroom read this
// instead of repeating the same host conditionals.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { homeDir, piAgentDir, pigAgentDir } from './utils.ts';
import { codexPluginInstalled } from './codex-state.ts';
import { claudePluginInstalled } from './claude-state.ts';

export type HostId = 'omp' | 'pi' | 'opencode' | 'pig' | 'dsh' | 'codex' | 'claude';

type McpShape = 'mcpServers' | 'mcp' | 'plugin';

export interface HostCap {
  id: HostId;
  label: string;
  bin: string;
  installCmd: string;
  removeCmd: string;
  /** The MCP config shape, or null when the host has none Tersio writes. */
  mcp: McpShape | null;
  /** The MCP file at call time, so a redirected HOME is honored. */
  mcpFile: () => string | null;
  /** The MCP entry rides inside the plugin bundle, so read that instead of a config file. */
  mcpBundle?: () => boolean;
  /** The rtk agent name; null when rtk has no binding or the plugin owns the rewrite. */
  rtkAgent: string | null;
  /** The Tersio plugin owns rtk's rewrite; no separate rtk entry exists. */
  rtkPlugin?: boolean;
  /** rtk has no agent for this host, so copy the named host's hook. */
  rtkCopyFrom?: HostId;
  /** Headroom can route this host when its provider endpoint points at the proxy. */
  headroom: boolean;
  /** Headroom ships a config writer Tersio can run for this host. */
  headroomDurable?: boolean;
  /** Headroom reaches this host through a local gateway, so its provider line moves too. */
  headroomGateway?: boolean;
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

const TERSIO_PACKAGE = '@krtclcdy/tersio';

/** The MCP entry ships in the bundle patch, so a profile that mounts the bundle already carries it. */
function dshBundleMounted(): boolean {
  const profiles = path.join(homeDir(), '.dsh', 'profiles');
  try {
    return readdirSync(profiles).some((name) => {
      try {
        const raw = readFileSync(path.join(profiles, name, 'package.json'), 'utf8');
        const pkg = JSON.parse(raw) as { dsh?: { profile?: { bundles?: unknown } } };
        const bundles = pkg.dsh?.profile?.bundles;
        return Array.isArray(bundles) && bundles.includes(TERSIO_PACKAGE);
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

export const HOST_CAPS: Record<HostId, HostCap> = {
  omp: {
    id: 'omp',
    label: 'Oh My Pi',
    bin: 'omp',
    installCmd: 'omp plugin install @krtclcdy/tersio',
    removeCmd: 'omp plugin remove @krtclcdy/tersio',
    mcp: 'mcpServers',
    mcpFile: () => path.join(ompAgentDir(), 'mcp.json'),
    rtkAgent: 'omp',
    headroom: true,
    headroomDurable: true,
    headroomGateway: true,
  },
  pi: {
    id: 'pi',
    label: 'Pi',
    bin: 'pi',
    installCmd: 'pi install npm:@krtclcdy/tersio',
    removeCmd: 'pi remove npm:@krtclcdy/tersio',
    mcp: 'mcpServers',
    mcpFile: () => path.join(piAgentDir(), 'mcp.json'),
    rtkAgent: 'pi',
    headroom: true,
  },
  opencode: {
    id: 'opencode',
    label: 'OpenCode',
    bin: 'opencode',
    installCmd: 'tersio install --host opencode',
    removeCmd: 'tersio uninstall --host opencode',
    mcp: 'mcp',
    mcpFile: opencodeConfig,
    rtkAgent: null,
    rtkPlugin: true,
    headroom: true,
    headroomDurable: true,
  },
  pig: {
    id: 'pig',
    label: 'Pi-in-go',
    bin: 'pig',
    installCmd: 'pig install npm:@krtclcdy/tersio',
    removeCmd: 'pig remove npm:@krtclcdy/tersio',
    mcp: 'mcpServers',
    mcpFile: () => path.join(pigAgentDir(), 'mcp.json'),
    rtkAgent: 'pi',
    rtkCopyFrom: 'pi',
    headroom: true,
  },
  dsh: {
    id: 'dsh',
    label: 'DeepSeek Harness',
    bin: 'dsh',
    installCmd: 'dsh plugin --profile web add npm:@krtclcdy/tersio',
    removeCmd: 'dsh plugin --profile web remove @krtclcdy/tersio',
    mcp: null,
    mcpFile: () => null,
    mcpBundle: dshBundleMounted,
    rtkAgent: null,
    headroom: true,
  },
  codex: {
    id: 'codex',
    label: 'Codex',
    bin: 'codex',
    installCmd: 'tersio install --host codex',
    removeCmd: 'tersio uninstall --host codex',
    mcp: 'plugin',
    mcpFile: () => null,
    mcpBundle: codexPluginInstalled,
    rtkAgent: null,
    headroom: true,
    headroomDurable: true,
  },
  claude: {
    id: 'claude',
    label: 'Claude Code',
    bin: 'claude',
    installCmd: 'tersio install --host claude',
    removeCmd: 'tersio uninstall --host claude',
    // The MCP entry rides inside the plugin bundle, the way Codex's does.
    mcp: 'plugin',
    mcpFile: () => null,
    mcpBundle: claudePluginInstalled,
    rtkAgent: null,
    // Readable through ANTHROPIC_BASE_URL. Tersio reads the route but does not write it, so the
    // drawer offers the switch and reports what the settings file says.
    headroom: true,
  },
};

/**
 * A plugin host ships its files inside a plugin bundle, so it has no extension tree Tersio writes.
 * Every tree check skips these; one predicate keeps "is a tree host" from being spelled nineteen ways.
 */
export function isPluginHost(id: HostId): id is 'codex' | 'claude' {
  return id === 'codex' || id === 'claude';
}

export function hostCap(id: string): HostCap | null {
  return (HOST_CAPS as Record<string, HostCap>)[id] ?? null;
}
