// cli/dashboard.ts — gain dashboard. Serves the single plain-HTML
// template (no deps, no build) plus a /data.json endpoint from the ledger.
// Binds 127.0.0.1 only; --export writes a file://-ready file instead.
// Note: no Promise.withResolvers here — engines still allow Node 20.12,
// which lacks it; the listening server itself keeps the process alive.
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readUsage } from '../extensions/shared/usage-ledger.ts';
import { summarizeUsage } from './usage.ts';
import { withInteractiveSpinner } from './interactive.ts';

export interface DashboardOptions {
  port: number;
  open: boolean;
  exportFile: string | null;
}

const DASH_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dashboard');
const TEMPLATE = path.join(DASH_DIR, 'template.html');
const STYLES = path.join(DASH_DIR, 'styles.css');
const APP = path.join(DASH_DIR, 'app.js');
const BRAND = path.join(DASH_DIR, 'brand.webp');

async function readSegment(file: string): Promise<string> {
  return fs.readFile(file, 'utf8');
}

async function faviconDataUri(): Promise<string> {
  const png = await fs.readFile(BRAND);
  return `data:image/webp;base64,${png.toString('base64')}`;
}

function dataJson(): string {
  return JSON.stringify(summarizeUsage(readUsage()));
}

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(cmd, [url], { detached: true, stdio: 'ignore' }).unref();
}

async function runDashboard(options: DashboardOptions): Promise<void> {
  if (options.exportFile) {
    const [template, css, js, icon] = await Promise.all([
      readSegment(TEMPLATE), readSegment(STYLES), readSegment(APP), faviconDataUri(),
    ]);
    // Replacer functions throughout: session data routinely contains `$'`
    // sequences (shell quoting in tool details), which String.replace would
    // expand as match-suffix patterns and corrupt the file.
    const inline = template
      .replace('<link rel="stylesheet" href="styles.css">', () => `<style>\n${css}</style>`)
      .replace('<script src="app.js" defer></script>', () => `<script>\n${js}</script>`)
      .replace(
        "fetch('data.json')",
        () => `Promise.resolve({ json: function () { return ${dataJson()}; } })`,
      )
      .replace('href="brand.webp"', () => `href="${icon}"`)
      .replace('src="brand.webp"', () => `src="${icon}"`);
    await fs.writeFile(options.exportFile, inline, 'utf8');
    console.log(`[ok] gain exported → ${options.exportFile}`);
    return;
  }
  const html = await withInteractiveSpinner('Loading dashboard template', () => readSegment(TEMPLATE));
  const server = http.createServer(async (req, res) => {
    if (req.url === '/data.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(dataJson());
      return;
    }
    if (req.url === '/styles.css') {
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
      res.end(await readSegment(STYLES));
      return;
    }
    if (req.url === '/app.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      res.end(await readSegment(APP));
      return;
    }
    if (req.url === '/brand.webp') {
      try {
        const png = await fs.readFile(BRAND);
        res.writeHead(200, { 'Content-Type': 'image/webp' });
        res.end(png);
      } catch {
        res.writeHead(404);
        res.end();
      }
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  server.listen(options.port, '127.0.0.1', () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : options.port;
    const url = `http://127.0.0.1:${port}`;
    console.log(`[ok] gain live → ${url} (Ctrl-C to stop)`);
    if (options.open) openBrowser(url);
  });
}

export { runDashboard };
