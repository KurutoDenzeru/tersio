// CodeGraph types and interfaces for Tersio integration.

export interface Node {
  id: string;
  kind: string;
  name: string;
  qualifiedName?: string;
  filePath: string;
  language?: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  docstring?: string;
  signature?: string;
  visibility?: string | null;
  isExported?: boolean;
  isAsync?: boolean;
  isStatic?: boolean;
  isAbstract?: boolean;
  updatedAt?: number;
}

export interface Edge {
  source: string;
  target: string;
  kind: string;
  line?: number;
  column?: number;
  metadata?: Record<string, unknown>;
  provenance?: string | null;
}

export interface CodeGraphStats {
  nodeCount: number;
  edgeCount: number;
  fileCount: number;
  nodesByKind: Record<string, number>;
  edgesByKind: Record<string, number>;
  filesByLanguage: Record<string, number>;
  dbSizeBytes: number;
  walSizeBytes: number;
  lastUpdated: number;
}

export interface CallerResult {
  node: Node;
  edge: Edge;
}

export interface ImpactRadiusResult {
  nodes: Map<string, Node>;
  edges: Edge[];
  roots: string[];
}

export interface ExploreResult {
  query: string;
  symbols: Array<{
    node: Node;
    callers: CallerResult[];
    blastRadius: {
      affectedNodes: number;
      affectedFiles: number;
      affectedEdges: number;
    };
  }>;
}
export interface CodeGraphStatus {
  initialized: boolean;
  nodeCount: number;
  edgeCount: number;
  fileCount: number;
  dbSizeBytes: number;
  isWatching: boolean;
  watcherObserved?: boolean;
  isIndexing: boolean;
  lastUpdated?: number;
  error?: string;
}
