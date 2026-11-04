// Benchmark routes: the published result files, parsed as written. One reader keeps the page and the
// markdown honest, because a number the docs do not carry cannot appear here.
import fs from 'node:fs';
import path from 'node:path';
import type http from 'node:http';
import { EXT_DIR } from './manifest.ts';

export interface BenchTable {
  title: string;
  columns: string[];
  rows: string[][];
}

export interface BenchFile {
  id: string;
  title: string;
  meta: Record<string, string>;
  tables: BenchTable[];
  findings: string[];
}

export interface BenchCtx {
  json: (res: Pick<http.ServerResponse, 'writeHead' | 'end'>, code: number, body: unknown) => void;
}

const DOCS = path.join(EXT_DIR, '..', 'docs');

/** Inline markdown a table cell never needs on screen: code ticks and bold runs. */
function plainCell(cell: string): string {
  return cell
    .replace(/`/g, '')
    .replace(/\*\*/g, '')
    .replace(/^-\s+/, '- ')
    .trim();
}

function cellsOf(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(plainCell);
}

function isSeparator(line: string): boolean {
  return /^\|?[\s:-]*-[\s:|-]*\|?$/.test(line.trim()) && line.includes('-');
}

/** One file, split into its header bullets and the tables under each second-level heading. */
export function parseBenchFile(id: string, text: string): BenchFile {
  const lines = text.split(/\r?\n/);
  const title = lines.find((line) => line.startsWith('# '))?.slice(2).trim() ?? id;
  const meta: Record<string, string> = {};
  const tables: BenchTable[] = [];
  const findings: string[] = [];
  let section = '';
  let inFindings = false;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (line.startsWith('## ')) {
      section = line.slice(3).trim();
      inFindings = /^findings$/i.test(section);
      index += 1;
      continue;
    }
    if (!section && line.startsWith('- ')) {
      const at = line.indexOf(': ');
      if (at > 2) meta[line.slice(2, at).trim()] = plainCell(line.slice(at + 2));
      index += 1;
      continue;
    }
    if (inFindings && line.startsWith('- ')) {
      findings.push(plainCell(line.slice(2)));
      index += 1;
      continue;
    }
    if (line.trim().startsWith('|') && index + 1 < lines.length && isSeparator(lines[index + 1])) {
      const columns = cellsOf(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        const cells = cellsOf(lines[index]);
        if (cells.length === columns.length) rows.push(cells);
        index += 1;
      }
      if (rows.length > 0) {
        // Two tables can share a heading: the second one is named apart so the page shows both.
        const seen = tables.filter((table) => table.title.startsWith(section)).length;
        tables.push({ title: seen === 0 ? section : `${section} · ${seen + 1}`, columns, rows });
      }
      continue;
    }
    index += 1;
  }
  return { id, title: title.replace(/^Tersio benchmark:\s*/, ''), meta, tables, findings };
}

/** Every published result file, newest first is not a thing: the name order is the reading order. */
export function readBenchmarks(): { files: BenchFile[]; dir: string } {
  let names: string[] = [];
  try {
    names = fs.readdirSync(DOCS).filter((name) => /^BENCH_.*\.md$/.test(name)).sort();
  } catch {
    return { files: [], dir: DOCS };
  }
  const files: BenchFile[] = [];
  for (const name of names) {
    try {
      files.push(parseBenchFile(name.replace(/^BENCH_|\.md$/g, ''), fs.readFileSync(path.join(DOCS, name), 'utf8')));
    } catch {
      // One unreadable file costs one card, never the page.
    }
  }
  return { files, dir: DOCS };
}

/** True when the route was answered. */
export function handleBenchRoutes(req: http.IncomingMessage, res: http.ServerResponse, ctx: BenchCtx): boolean {
  if (req.url === '/api/benchmarks' && req.method === 'GET') {
    const { files, dir } = readBenchmarks();
    ctx.json(res, 200, { ok: files.length > 0, dir, files });
    return true;
  }
  return false;
}
