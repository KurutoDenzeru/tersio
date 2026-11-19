import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const fakeCodeGraph = String.raw`const fs = require('node:fs');
const path = require('node:path');
const databaseName = 'codegraph.db';

function databasePath(root) {
  return path.join(root, process.env.CODEGRAPH_DIR || '.codegraph', databaseName);
}

function readIndex(root) {
  const file = databasePath(root);
  if (!fs.existsSync(file)) throw new Error('CodeGraph not initialized');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function indexProject(root) {
  const files = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith('.ts'));
  const nodes = [];
  const bodies = new Map();
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file.name), 'utf8');
    const pattern = /(?:export\s+)?function\s+([A-Za-z_]\w*)\s*\([^)]*\)[^{]*\{([\s\S]*?)\}/g;
    for (const match of source.matchAll(pattern)) {
      const name = match[1];
      const id = file.name + ':' + name;
      nodes.push({ id, kind: 'function', name, filePath: file.name, startLine: source.slice(0, match.index).split('\n').length, endLine: 1, startColumn: 0, endColumn: 1 });
      bodies.set(id, match[2]);
    }
  }
  const edges = [];
  for (const caller of nodes) {
    for (const callee of nodes) {
      if (new RegExp('\\b' + callee.name + '\\s*\\(').test(bodies.get(caller.id))) {
        edges.push({ source: caller.id, target: callee.id, kind: 'calls' });
      }
    }
  }
  fs.mkdirSync(path.dirname(databasePath(root)), { recursive: true });
  fs.writeFileSync(databasePath(root), JSON.stringify({ nodes, edges, fileCount: files.length, lastUpdated: Date.now() }));
}

class CodeGraph {
  static isInitialized(root) {
    const file = databasePath(root);
    return fs.existsSync(file) && fs.statSync(file).size > 0;
  }
  constructor(root) { this.root = root; this.watching = false; }
  static async init(root) {
    fs.mkdirSync(path.dirname(databasePath(root)), { recursive: true });
    return new CodeGraph(root);
  }
  static async open(root) {
    readIndex(root);
    return new CodeGraph(root);
  }
  async indexAll() { indexProject(this.root); }
  async sync() { indexProject(this.root); }
  async getStats() {
    const index = readIndex(this.root);
    return {
      nodeCount: index.nodes.length,
      edgeCount: index.edges.length,
      fileCount: index.fileCount,
      nodesByKind: { function: index.nodes.length },
      edgesByKind: { calls: index.edges.length },
      filesByLanguage: { typescript: index.fileCount },
      dbSizeBytes: fs.statSync(databasePath(this.root)).size,
      walSizeBytes: 0,
      lastUpdated: index.lastUpdated,
    };
  }
  async getNodesByName(name) { return readIndex(this.root).nodes.filter((node) => node.name === name); }
  async searchNodes(query) { return readIndex(this.root).nodes.filter((node) => node.name.includes(query)); }
  async getCallers(nodeId) {
    const index = readIndex(this.root);
    const byId = new Map(index.nodes.map((node) => [node.id, node]));
    return index.edges.filter((edge) => edge.target === nodeId).map((edge) => ({ node: byId.get(edge.source), edge }));
  }
  async getImpactRadius(nodeId) {
    const index = readIndex(this.root);
    const byId = new Map(index.nodes.map((node) => [node.id, node]));
    const nodes = new Map();
    const edges = [];
    const visit = (id) => {
      if (nodes.has(id)) return;
      const node = byId.get(id);
      if (!node) return;
      nodes.set(id, node);
      for (const edge of index.edges.filter((candidate) => candidate.target === id)) {
        edges.push(edge);
        visit(edge.source);
      }
    };
    visit(nodeId);
    return { nodes, edges, roots: [nodeId] };
  }
  watch() { this.watching = true; return true; }
  unwatch() { this.watching = false; return true; }
  isWatching() { return this.watching; }
  isWatcherDegraded() { return false; }
  getWatcherDegradedReason() { return null; }
  isIndexing() { return false; }
  close() {}
}

module.exports = { CodeGraph };
`;

const envNames = ['HOME', 'USERPROFILE', 'TERSIO_HOME', 'CODEGRAPH_LIB_PATH'] as const;

export interface CodeGraphTestFixture {
  tempDir: string;
  projectRoot: string;
  cleanup(): void;
}

export function createCodeGraphTestFixture(): CodeGraphTestFixture {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tersio-codegraph-test-'));
  const projectRoot = path.join(tempDir, 'project');
  const home = path.join(tempDir, 'home');
  const bundle = path.join(tempDir, 'bundle');
  const library = path.join(bundle, 'lib', 'dist', 'index.js');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.dirname(library), { recursive: true });
  fs.writeFileSync(library, fakeCodeGraph);
  const bundledNode = path.join(bundle, process.platform === 'win32' ? 'node.exe' : 'node');
  if (process.platform === 'win32') fs.copyFileSync(process.execPath, bundledNode);
  else fs.symlinkSync(process.execPath, bundledNode);

  const previous = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.TERSIO_HOME = path.join(home, '.tersio');
  // Always the fake: a bundle installed on the host must never take part in the tests.
  process.env.CODEGRAPH_LIB_PATH = library;
  let cleaned = false;

  return {
    tempDir,
    projectRoot,
    cleanup() {
      if (cleaned) return;
      cleaned = true;
      for (const name of envNames) {
        const value = previous[name];
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      // Windows keeps the copied node.exe locked for a moment after its child exits.
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    },
  };
}
