// CLI command for CodeGraph.
import {
  ensureInitializedAndWatching,
  exploreSymbol,
  getCodeGraphStatus,
  indexCodeGraph,
  stopWatching,
  syncCodeGraph,
} from '../extensions/codegraph/client.ts';
import { readCodegraphSync } from '../extensions/shared/plugin-settings.ts';
import { installGitHooks } from '../extensions/codegraph/git-hooks.ts';
import { withResolvers } from '../extensions/shared/utils.ts';

export async function runCodegraph(args: string[]): Promise<void> {
  const sub = args[0] || 'status';
  const projectRoot = process.cwd();

  if (sub === 'status') {
    const status = await getCodeGraphStatus(projectRoot);
    if (status.error) {
      console.error(`CodeGraph error: ${status.error}`);
      process.exitCode = 1;
    } else if (status.initialized) {
      console.log(`CodeGraph Status for ${projectRoot}:`);
      console.log(`  Nodes: ${status.nodeCount}`);
      console.log(`  Edges: ${status.edgeCount}`);
      console.log(`  Files: ${status.fileCount}`);
      console.log(`  DB Size: ${(status.dbSizeBytes / 1024).toFixed(1)} KB`);
      // The watcher lives inside an agent session, so this process can only report the configured mode.
      console.log(`  Sync mode: ${readCodegraphSync()}`);
      if (status.isIndexing) {
        console.log(`  State: indexing in progress`);
      }
    } else if (status.isIndexing) {
      console.log(`CodeGraph is building its first index for ${projectRoot}. Check back shortly.`);
    } else {
      console.log(
        `CodeGraph is not initialized in ${projectRoot}. Run 'tersio codegraph init' or start an agent session.`,
      );
    }
    return;
  }

  if (sub === 'init' || sub === 'index') {
    console.log(`Indexing ${projectRoot}...`);
    const stats = await indexCodeGraph(projectRoot);
    console.log(`Index complete: ${stats.nodeCount} nodes, ${stats.edgeCount} edges, ${stats.fileCount} files.`);
    return;
  }

  if (sub === 'sync') {
    console.log(`Syncing dirty files in ${projectRoot}...`);
    const stats = await syncCodeGraph(projectRoot);
    if (stats) {
      console.log(`Sync complete: ${stats.nodeCount} nodes across ${stats.fileCount} files.`);
    } else {
      console.log(`Sync complete.`);
    }
    return;
  }

  if (sub === 'watch') {
    console.log(`Starting continuous CodeGraph watcher for ${projectRoot}...`);
    const started = await ensureInitializedAndWatching(projectRoot);
    if (!started) {
      console.error('Failed to start watcher. Make sure CodeGraph library is available.');
      process.exitCode = 1;
      return;
    }
    const syncMode = readCodegraphSync();
    if (syncMode === 'live') {
      console.log('CodeGraph auto-sync active (watching file events). Press Ctrl+C to exit.');
    } else {
      console.log(`CodeGraph watcher initialized (sync mode: ${syncMode}). Press Ctrl+C to exit.`);
    }
    const { promise, resolve, reject } = withResolvers<void>();
    // The worker is a separate process: if it dies the next request starts an empty one, so check that it still watches.
    const keepAlive = setInterval(() => {
      void (async () => {
        try {
          const current = await getCodeGraphStatus(projectRoot);
          if (current.isWatching || current.isIndexing) return;
          // A failed start is reported, not retried on every tick.
          if (current.error) throw new Error(current.error);
          if (!(await ensureInitializedAndWatching(projectRoot))) throw new Error('the watcher could not be restarted');
        } catch (error) {
          console.error(`CodeGraph watcher stopped: ${(error as Error).message}`);
          process.exitCode = 1;
          process.off('SIGINT', onSigint);
          process.off('SIGTERM', onSigterm);
          clearInterval(keepAlive);
          resolve();
        }
      })();
    }, 30_000);
    const onExit = async (signal: 'SIGINT' | 'SIGTERM') => {
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigterm);
      try {
        await stopWatching(projectRoot);
        console.log('\nWatcher stopped.');
      } catch (error) {
        if (error instanceof Error && error.message === `CodeGraph worker exited (${signal}).`) {
          console.log('\nWatcher stopped.');
        } else {
          reject(error);
        }
      } finally {
        clearInterval(keepAlive);
        resolve();
      }
    };
    const onSigint = () => {
      void onExit('SIGINT');
    };
    const onSigterm = () => {
      void onExit('SIGTERM');
    };
    process.once('SIGINT', onSigint);
    process.once('SIGTERM', onSigterm);
    await promise;
    return;
  }

  if (sub === 'hooks') {
    const action = args[1] || 'install';
    if (action === 'install') {
      const result = installGitHooks(projectRoot);
      if (result.success) {
        console.log(`Git hooks configured in ${projectRoot}/.git/hooks:`);
        for (const h of result.installed) console.log(`  + installed ${h}`);
        for (const s of result.skipped) console.log(`  = already configured ${s}`);
        for (const h of result.incompatible) console.log(`  ! left ${h} alone: it is not a shell script`);
      } else {
        console.log(`Skipped: ${result.skipped.join(', ')}`);
      }
      return;
    }
  }

  if (sub === 'explore' || sub === 'query') {
    const query = args[1];
    if (!query) {
      console.error('Error: missing symbol name for explore. Usage: tersio codegraph explore <symbol>');
      process.exitCode = 1;
      return;
    }
    const result = await exploreSymbol(query, projectRoot);
    if (result.symbols.length === 0) {
      console.log(`No symbols found matching "${query}".`);
      return;
    }

    console.log(`CodeGraph explore "${query}":`);
    for (const s of result.symbols) {
      console.log(`\n• ${s.node.kind} ${s.node.qualifiedName ?? s.node.name} (${s.node.filePath}:${s.node.startLine})`);
      if (s.node.signature) console.log(`  Signature: ${s.node.signature}`);
      console.log(`  Blast radius: ${s.blastRadius.affectedNodes} nodes, ${s.blastRadius.affectedFiles} files`);
      if (s.callers.length > 0) {
        console.log(`  Callers:`);
        for (const c of s.callers) {
          console.log(`    - ${c.node.qualifiedName ?? c.node.name} (${c.node.filePath}:${c.node.startLine})`);
        }
      }
    }
    return;
  }

  console.log('Usage: tersio codegraph <status|init|sync|watch|hooks|explore <symbol>>');
}
