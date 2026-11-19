// OMP Native Adapter for CodeGraph.
// Injects native tools directly into OmpApi without MCP process overhead.

import {
  ensureInitializedAndWatching,
  exploreSymbol,
  getCodeGraphStatus,
  indexCodeGraph,
  onToolFinished,
  stopWatching,
  syncCodeGraph,
} from './client.ts';
import { findRepoRoot, resolveCodeGraphLibrary } from './shared.ts';
import { readCodegraphDefault } from '../shared/plugin-settings.ts';
import { hostIdOf } from '../shared/host.ts';
import type { ExtensionApi, ExtensionCtx, ToolResultEvent } from '../shared/types.ts';

interface ZodChain {
  describe(text: string): ZodChain;
}
interface ZodFactory {
  object(shape: Record<string, ZodChain>): unknown;
  string(): ZodChain;
}

/** OMP validates tool arguments with zod; pi and OpenCode take plain JSON Schema. */
function queryParameters(pi: ExtensionApi): unknown {
  const description = 'Symbol name, function name, class, or search query to explore.';
  if (pi.zod) {
    const { z } = pi.zod as { z: ZodFactory };
    return z.object({ query: z.string().describe(description) });
  }
  return { type: 'object', properties: { query: { type: 'string', description } }, required: ['query'] };
}

function emptyParameters(pi: ExtensionApi): unknown {
  if (pi.zod) {
    const { z } = pi.zod as { z: ZodFactory };
    return z.object({});
  }
  return { type: 'object', properties: {} };
}

export default function codegraphExtension(pi: ExtensionApi): void {
  let bootstrapNotice = false;
  let unavailableNotice = false;
  // Roots whose watcher this session already started, so a prompt does not retry a failed build every turn.
  const started = new Set<string>();
  const host = hostIdOf(pi);

  // Session hooks start the index and watcher only where CodeGraph is on. Tools and the command stay registered either way.
  const startSession = async (ctx: ExtensionCtx | undefined, perPrompt: boolean) => {
    const cwd = ctx?.cwd ?? pi.cwd ?? process.cwd();
    if (readCodegraphDefault(host) !== 'on') {
      // Switched off mid-session: the worker and its sync timer must not keep running.
      const root = findRepoRoot(cwd);
      if (root && started.delete(root)) await stopWatching(cwd).catch(() => undefined);
      return;
    }
    const root = findRepoRoot(cwd);
    if (!root) return;
    if (perPrompt && started.has(root)) return;
    try {
      const missing = !resolveCodeGraphLibrary();
      const accepted = await ensureInitializedAndWatching(cwd, (message) => {
        bootstrapNotice = false;
        ctx?.ui?.notify?.(`CodeGraph installation failed: ${message}`, 'warning');
      });
      if (accepted) {
        started.add(root);
        unavailableNotice = false;
      }
      if (!accepted) {
        if (!unavailableNotice) {
          unavailableNotice = true;
          ctx?.ui?.notify?.('CodeGraph runtime is unavailable; automatic indexing could not start.', 'warning');
        }
      } else if (missing && !bootstrapNotice) {
        ctx?.ui?.notify?.('CodeGraph is installing its runtime in the background.', 'info');
        bootstrapNotice = true;
      }
      if (!missing) bootstrapNotice = false;
    } catch (error) {
      ctx?.ui?.notify?.(
        `CodeGraph could not start: ${error instanceof Error ? error.message : String(error)}`,
        'warning',
      );
    }
  };
  pi.on?.('before_agent_start', (_event: unknown, ctx?: ExtensionCtx) => startSession(ctx, true));
  pi.on?.('session_start', (_event: unknown, ctx?: ExtensionCtx) => startSession(ctx, false));
  for (const eventName of ['session_tree', 'session_switch', 'session_branch']) {
    pi.on?.(eventName, (_event: unknown, ctx?: ExtensionCtx) => startSession(ctx, false));
  }
  if (host !== 'opencode') {
    pi.on?.('session_shutdown', async (_event: unknown, ctx?: ExtensionCtx) => {
      const cwd = ctx?.cwd ?? pi.cwd ?? process.cwd();
      const root = findRepoRoot(cwd);
      if (root) started.delete(root);
      await stopWatching(cwd);
    });
  }

  // File-modifying tool results schedule an incremental sync; onToolFinished applies the gating.
  pi.on?.<ToolResultEvent>('tool_result', (event: ToolResultEvent, ctx?: ExtensionCtx) => {
    onToolFinished(String(event?.toolName ?? ''), Boolean(event?.isError), ctx?.cwd ?? pi.cwd ?? process.cwd(), host);
  });
  pi.registerTool?.({
    name: 'codegraph_explore',
    label: 'CodeGraph Explore',
    description: 'Explore code structure, symbol definitions, callers, dependencies, and blast radius in one call.',
    parameters: queryParameters(pi),
    execute: async (
      _toolCallId: string,
      params: { args: string[] },
      _signal: AbortSignal | undefined,
      _onUpdate: ((data: unknown) => void) | undefined,
      ctx: ExtensionCtx | undefined,
    ) => {
      try {
        let query = '';
        if (Array.isArray(params?.args) && params.args.length > 0) {
          query = String(params.args[0]);
        } else if (params && typeof params === 'object') {
          const dict: Record<string, unknown> = params;
          const raw = dict.query;
          if (typeof raw === 'string') query = raw;
        }

        if (!query) {
          return {
            isError: true,
            content: [{ type: 'text', text: 'Error: missing query argument for codegraph_explore.' }],
            details: { error: 'missing_query' },
          };
        }

        const projectRoot = ctx?.cwd ?? process.cwd();
        const result = await exploreSymbol(query, projectRoot);

        if (result.symbols.length === 0) {
          return {
            isError: false,
            content: [{ type: 'text', text: `CodeGraph: No symbols found matching "${query}".` }],
            details: { found: 0 },
          };
        }

        const lines: string[] = [`# CodeGraph Explore: "${query}"`, `Found ${result.symbols.length} symbol(s):`];

        for (const s of result.symbols) {
          lines.push(
            `\n## ${s.node.kind} ${s.node.qualifiedName ?? s.node.name} (${s.node.filePath}:${s.node.startLine})`,
          );
          if (s.node.signature) lines.push(`Signature: \`${s.node.signature}\``);
          lines.push(
            `Blast radius: ${s.blastRadius.affectedNodes} nodes across ${s.blastRadius.affectedFiles} file(s)`,
          );

          if (s.callers.length > 0) {
            lines.push(`Callers (${s.callers.length}):`);
            for (const c of s.callers.slice(0, 5)) {
              lines.push(`  - ${c.node.qualifiedName ?? c.node.name} in ${c.node.filePath}:${c.node.startLine}`);
            }
            if (s.callers.length > 5) {
              lines.push(`  ... and ${s.callers.length - 5} more callers`);
            }
          } else {
            lines.push('No direct callers recorded in graph.');
          }
        }

        return {
          isError: false,
          content: [{ type: 'text', text: lines.join('\n') }],
          details: { found: result.symbols.length },
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: `CodeGraph error: ${(err as Error).message}` }],
          details: { error: (err as Error).message },
        };
      }
    },
  });

  // Register codegraph_sync tool
  pi.registerTool?.({
    name: 'codegraph_sync',
    label: 'CodeGraph Sync',
    description: 'Incrementally sync modified files into the CodeGraph index.',
    parameters: emptyParameters(pi),
    execute: async (
      _toolCallId: string,
      _params: { args: string[] },
      _signal: AbortSignal | undefined,
      _onUpdate: ((data: unknown) => void) | undefined,
      ctx: ExtensionCtx | undefined,
    ) => {
      try {
        const projectRoot = ctx?.cwd ?? process.cwd();
        const stats = await syncCodeGraph(projectRoot);
        if (!stats) throw new Error('CodeGraph sync returned no statistics.');
        return {
          isError: false,
          content: [
            {
              type: 'text',
              text: `CodeGraph synced: ${stats.nodeCount} nodes, ${stats.edgeCount} edges across ${stats.fileCount} files.`,
            },
          ],
          details: { stats },
        };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: `CodeGraph sync error: ${(err as Error).message}` }],
          details: { error: (err as Error).message },
        };
      }
    },
  });

  // Register user command /codegraph
  pi.registerCommand?.('codegraph', {
    description: 'Query CodeGraph or sync the current workspace. Usage: /codegraph <query|sync|status>',
    handler: async (args: string, ctx: ExtensionCtx) => {
      const trimmed = (args || '').trim();
      const projectRoot = ctx?.cwd ?? process.cwd();

      if (!trimmed || trimmed === 'status') {
        const status = await getCodeGraphStatus(projectRoot);
        if (status.error) {
          ctx?.ui?.notify?.(`CodeGraph error: ${status.error}`, 'warning');
        } else if (status.isIndexing && !status.initialized) {
          ctx?.ui?.notify?.('CodeGraph: the first index is still being built.', 'info');
        } else if (status.initialized) {
          const syncInfo = status.isWatching ? 'Auto-sync active' : 'Sync idle';
          ctx?.ui?.notify?.(
            `CodeGraph: ${status.nodeCount} symbols, ${status.edgeCount} edges, ${status.fileCount} files (${syncInfo}).`,
            'info',
          );
        } else {
          ctx?.ui?.notify?.(
            'CodeGraph: Not initialized in this repository. Run `/codegraph sync` to index.',
            'warning',
          );
        }
        return;
      }

      if (trimmed === 'sync' || trimmed === 'init') {
        ctx?.ui?.notify?.('CodeGraph: Indexing codebase...', 'info');
        try {
          const stats = await indexCodeGraph(projectRoot);
          ctx?.ui?.notify?.(
            `CodeGraph ready: indexed ${stats.nodeCount} nodes across ${stats.fileCount} files.`,
            'info',
          );
        } catch (e) {
          ctx?.ui?.notify?.(`CodeGraph index failed: ${(e as Error).message}`, 'warning');
        }
        return;
      }

      // Default: explore symbol
      try {
        const result = await exploreSymbol(trimmed, projectRoot);
        if (result.symbols.length === 0) {
          ctx?.ui?.notify?.(`CodeGraph: No symbols found matching "${trimmed}".`, 'info');
          return;
        }
        const top = result.symbols[0];
        ctx?.ui?.notify?.(
          `CodeGraph: ${top.node.kind} ${top.node.name} (${top.node.filePath}:${top.node.startLine}) — blast radius ${top.blastRadius.affectedNodes} nodes`,
          'info',
        );
      } catch (e) {
        ctx?.ui?.notify?.(`CodeGraph error: ${(e as Error).message}`, 'warning');
      }
    },
  });
}
