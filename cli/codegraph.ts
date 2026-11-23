// CLI command for CodeGraph.
import { exploreSymbol, getCodeGraphStatus, indexCodeGraph, syncCodeGraph } from '../extensions/codegraph/client.ts';
import { formatExplore } from '../extensions/codegraph/shared.ts';
import { readCodegraphSync } from '../extensions/shared/plugin-settings.ts';

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

  if (sub === 'explore' || sub === 'query') {
    const query = args[1];
    if (!query) {
      console.error('Error: missing symbol name for explore. Usage: tersio codegraph explore <symbol>');
      process.exitCode = 1;
      return;
    }
    const result = await exploreSymbol(query, projectRoot);
    console.log(formatExplore(result));
    return;
  }

  console.log('Usage: tersio codegraph <status|init|sync|explore <symbol>>');
}
