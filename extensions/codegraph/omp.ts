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
import { findRepoRoot, formatExplore, resolveCodeGraphLibrary } from './shared.ts';
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

/** OMP validates tool arguments with zod; pi and OpenCode take plain JSON Schema. A null query means no arguments. */
function parameters(pi: ExtensionApi, query: string | null): unknown {
  if (pi.zod) {
    const { z } = pi.zod as { z: ZodFactory };
    return query ? z.object({ query: z.string().describe(query) }) : z.object({});
  }
  return query
    ? { type: 'object', properties: { query: { type: 'string', description: query } }, required: ['query'] }
    : { type: 'object', properties: {} };
}

/** Both tools answer through one envelope, so a failure reads the same wherever it comes from. */
function toolResult(
  work: () => Promise<{ text: string; details: Record<string, unknown> }>,
): Promise<{ isError: boolean; content: Array<{ type: 'text'; text: string }>; details: Record<string, unknown> }> {
  return work().then(
    ({ text, details }) => ({ isError: false, content: [{ type: 'text' as const, text }], details }),
    (error: unknown) => ({
      isError: true,
      content: [{ type: 'text' as const, text: `CodeGraph error: ${(error as Error).message}` }],
      details: { error: (error as Error).message },
    }),
  );
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
    parameters: parameters(pi, 'Symbol name, function name, class, or search query to explore.'),
    execute: async (
      _toolCallId: string,
      params: { args: string[] },
      _signal: AbortSignal | undefined,
      _onUpdate: ((data: unknown) => void) | undefined,
      ctx: ExtensionCtx | undefined,
    ) => {
      return toolResult(async () => {
        // A host may hand the arguments as a positional list or as the named field.
        const list = Array.isArray(params?.args) ? params.args : [];
        const raw = list.length > 0 ? list[0] : (params as { query?: unknown })?.query;
        const query = typeof raw === 'string' ? raw.trim() : '';
        if (!query) return { text: 'Error: missing query argument for codegraph_explore.', details: { error: 'missing_query' } };
        const result = await exploreSymbol(query, ctx?.cwd ?? process.cwd());
        return { text: formatExplore(result), details: { found: result.symbols.length } };
      });
    },
  });

  // Register codegraph_sync tool
  pi.registerTool?.({
    name: 'codegraph_sync',
    label: 'CodeGraph Sync',
    description: 'Incrementally sync modified files into the CodeGraph index.',
    parameters: parameters(pi, null),
    execute: async (
      _toolCallId: string,
      _params: { args: string[] },
      _signal: AbortSignal | undefined,
      _onUpdate: ((data: unknown) => void) | undefined,
      ctx: ExtensionCtx | undefined,
    ) => {
      return toolResult(async () => {
        const stats = await syncCodeGraph(ctx?.cwd ?? process.cwd());
        if (!stats) throw new Error('CodeGraph sync returned no statistics.');
        return {
          text: `CodeGraph synced: ${stats.nodeCount} nodes, ${stats.edgeCount} edges across ${stats.fileCount} files.`,
          details: { stats },
        };
      });
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
        const sync = status.isWatching ? 'Auto-sync active' : 'Sync idle';
        const line = status.error
          ? [`CodeGraph error: ${status.error}`, 'warning']
          : status.isIndexing && !status.initialized
            ? ['CodeGraph: the first index is still being built.', 'info']
            : status.initialized
              ? [
                  `CodeGraph: ${status.nodeCount} symbols, ${status.edgeCount} edges, ${status.fileCount} files (${sync}).`,
                  'info',
                ]
              : ['CodeGraph: Not initialized in this repository. Run `/codegraph sync` to index.', 'warning'];
        ctx?.ui?.notify?.(line[0], line[1]);
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
