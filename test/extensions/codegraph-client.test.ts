import {spawn} from 'node:child_process';
import {copyFileSync, cpSync, existsSync, mkdirSync, symlinkSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {describe, expect, test} from 'vitest';
import {cliEnv, withHome} from '../helpers/env.ts';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const clientPath = path.join(projectRoot, 'dist/extensions/codegraph/client.js');

const fakeCodeGraph = String.raw`const fs = require('node:fs');
const path = require('node:path');
class CodeGraph {
  static isInitialized(root) {
    const file = path.join(root, '.codegraph', 'codegraph.db');
    return fs.existsSync(file) && fs.statSync(file).size > 0;
  }
  constructor(root) { this.root = root; this.indexPath = path.join(root, '.codegraph', 'codegraph.db'); }
  static async init(root) { fs.mkdirSync(path.join(root, '.codegraph'), { recursive: true }); return new CodeGraph(root); }
  static async open(root) {
    const graph = new CodeGraph(root);
    if (!fs.existsSync(graph.indexPath)) throw new Error('CodeGraph not initialized');
    return graph;
  }
  async refresh() {
    const source = fs.readFileSync(path.join(this.root, 'fixture.ts'), 'utf8');
    const names = [...source.matchAll(/function\s+(\w+)/g)].map((match) => match[1]);
    const nodes = names.map((name, index) => ({ id: name, kind: 'function', name, filePath: 'fixture.ts', startLine: index + 1, endLine: index + 1, startColumn: 0, endColumn: 1 }));
    fs.writeFileSync(this.indexPath, JSON.stringify({ nodes }));
    return nodes;
  }
  async indexAll() { await this.refresh(); }
  async sync() { await this.refresh(); }
  async getStats() {
    const { nodes } = JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));
    return { nodeCount: nodes.length, fileCount: 1, edgeCount: 0, dbSizeBytes: fs.statSync(this.indexPath).size, nodesByKind: { function: nodes.length }, edgesByKind: {}, filesByLanguage: { typescript: 1 }, walSizeBytes: 0, lastUpdated: 123 };
  }
  async getNodesByName(name) { return JSON.parse(fs.readFileSync(this.indexPath, 'utf8')).nodes.filter((node) => node.name === name); }
  async getCallers() { return []; }
  async getImpactRadius() { return { nodes: new Map(), edges: [], roots: [] }; }
  watch() { return false; }
  unwatch() {}
  close() {}
}
module.exports = { CodeGraph };
`;

const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
const supportsTypeScript = nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 18);

describe('CodeGraph client process bridge', () => {
  test.each(['compiled', ...(supportsTypeScript ? ['source worker'] : [])])('initializes through IPC, syncs completed writes, and explores the new symbol (%s)', async (layout) => {
    await withHome(async (home) => {
      const project = path.join(home, 'project');
      mkdirSync(project, { recursive: true });
      const bundle = path.join(home, 'codegraph-bundle');
      const library = path.join(bundle, 'lib', 'dist', 'index.js');
      mkdirSync(path.join(project, '.git'), { recursive: true });
      mkdirSync(path.dirname(library), { recursive: true });
      writeFileSync(path.join(project, 'fixture.ts'), 'export function oldSymbol() {}\n');
      writeFileSync(library, fakeCodeGraph);
      const bundledNode = path.join(bundle, process.platform === 'win32' ? 'node.exe' : 'node');
      if (process.platform === 'win32') copyFileSync(process.execPath, bundledNode);
      else symlinkSync(process.execPath, bundledNode);

      expect(existsSync(clientPath)).toBe(true);
      let entry = clientPath;
      if (layout === 'source worker') {
        const extensions = path.join(home, 'extensions');
        cpSync(path.join(projectRoot, 'dist/extensions'), extensions, { recursive: true });
        cpSync(path.join(projectRoot, 'extensions'), extensions, { recursive: true });
        const codegraph = path.join(extensions, 'codegraph');
        copyFileSync(clientPath, path.join(codegraph, 'client.js'));
        writeFileSync(path.join(extensions, 'package.json'), '{"type":"module"}');
        entry = path.join(codegraph, 'client.js');
      }
      const script = `
          import { ensureInitializedAndWatching, getCodeGraphStatus, onToolFinished, exploreSymbol, stopWatching } from ${JSON.stringify(pathToFileURL(entry).href)};
          const waitFor = async (predicate) => {
            const deadline = Date.now() + 10000;
            while (Date.now() < deadline) {
              const value = await predicate();
              if (value) return value;
              await new Promise((resolve) => setTimeout(resolve, 25));
            }
            throw new Error('Timed out waiting for CodeGraph state');
          };
          const project = process.cwd();
          try {
            const started = await ensureInitializedAndWatching(project);
            const initial = await waitFor(async () => {
              const status = await getCodeGraphStatus(project);
              return status.initialized && !status.isIndexing ? status : undefined;
            });
            const fs = await import('node:fs/promises');
            await fs.appendFile(project + '/fixture.ts', 'export function freshSymbol() {}\\n');
            onToolFinished('write', false, project, 'omp');
            const updated = await waitFor(async () => {
              const status = await getCodeGraphStatus(project);
              return status.nodeCount === 2 ? status : undefined;
            });
            const explored = await exploreSymbol('freshSymbol', project);
            await stopWatching(project);
            await fs.appendFile(project + '/fixture.ts', 'export function offlineSymbol() {}\\n');
            await ensureInitializedAndWatching(project);
            const restarted = await waitFor(async () => {
              const status = await getCodeGraphStatus(project);
              return status.nodeCount === 3 ? status : undefined;
            });
            await stopWatching(project);
            process.stdout.write(JSON.stringify({ started, initial, updated, restarted, found: explored.symbols.map(({ node }) => node.name) }));
          } catch (error) {
            await stopWatching(project);
            throw error;
          }
        `;
      const result = await runNode(script, project, cliEnv(home, { CODEGRAPH_LIB_PATH: library }));
      expect(result.code, result.stderr).toBe(0);
      const output = JSON.parse(result.stdout) as {
        started: boolean;
        initial: { initialized: boolean; nodeCount: number; fileCount: number; edgeCount: number; dbSizeBytes: number };
        updated: { initialized: boolean; nodeCount: number; fileCount: number; edgeCount: number; dbSizeBytes: number };
        restarted: { initialized: boolean; nodeCount: number };
        found: string[];
      };
      expect(output.started).toBe(true);
      expect(output.initial).toMatchObject({ initialized: true, nodeCount: 1, fileCount: 1, edgeCount: 0 });
      expect(output.initial.dbSizeBytes).toBeGreaterThan(0);
      expect(output.updated).toMatchObject({ initialized: true, nodeCount: 2, fileCount: 1, edgeCount: 0 });
      expect(output.restarted).toMatchObject({ initialized: true, nodeCount: 3 });
      expect(output.updated.dbSizeBytes).toBeGreaterThan(output.initial.dbSizeBytes);
      expect(output.found).toEqual(['freshSymbol']);
    });
  });
});

function runNode(script: string, cwd: string, env: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    const timeout = setTimeout(() => child.kill(), 20_000);
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timeout);
      if (code === null) reject(new Error(`Node child timed out or was terminated: ${stderr}`));
      else resolve({ code, stdout, stderr });
    });
  });
}
