// cli/dashboard.ts — localhost gain dashboard. Serves the single plain-HTML
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

const TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dashboard.html');
const BRAND = path.join(path.dirname(fileURLToPath(import.meta.url)), 'brand.webp');

async function templateHtml(): Promise<string> {
  return fs.readFile(TEMPLATE, 'utf8');
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
    const html = await templateHtml();
    const inline = html
      .replace(
        "fetch('data.json')",
        `Promise.resolve({ json: function () { return ${dataJson()}; } }).then(function (r) { return r.json(); }).then`,
      )
      .replace('href="brand.webp"', `href="${await faviconDataUri()}"`)
      .replace('src="brand.webp"', `src="${await faviconDataUri()}"`);
    await fs.writeFile(options.exportFile, inline, 'utf8');
    console.log(`[ok] dashboard exported → ${options.exportFile}`);
    return;
  }
  const html = await withInteractiveSpinner('Loading dashboard template', templateHtml);
  const server = http.createServer(async (req, res) => {
    if (req.url === '/data.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(dataJson());
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
    console.log(`[ok] dashboard live → ${url} (Ctrl-C to stop)`);
    if (options.open) openBrowser(url);
  });
}

export { runDashboard };
