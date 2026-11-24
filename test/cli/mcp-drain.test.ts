import { describe, expect, test } from 'vitest';
import http from 'node:http';
import { PassThrough } from 'node:stream';

import { runMcpServer } from '../../cli/mcp.ts';

type Wire = { id?: number; result?: unknown; error?: { code: number } };

// The server answers on a real stdout, so each check swaps it for a collector and reads the wire.
async function serve(lines: string[]): Promise<Wire[]> {
  const input = new PassThrough();
  const written: string[] = [];
  const realWrite = process.stdout.write.bind(process.stdout);
  const realExit = process.exit;
  let exited: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    exited = resolve;
  });
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    written.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.exit = (() => exited()) as unknown as typeof process.exit;
  try {
    void runMcpServer(input);
    for (const line of lines) input.write(`${line}\n`);
    input.end();
    await done;
  } finally {
    process.stdout.write = realWrite;
    process.exit = realExit;
  }
  return written.flatMap((chunk) => chunk.trim().split('\n')).map((line) => JSON.parse(line) as Wire);
}

describe('the MCP server lifecycle', () => {
  test('answers a request still running when the client closed stdin', async () => {
    // A tool that awaits the network outlives the stdin close, which is the case an exit must not cut.
    const server = http.createServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ hash: 'slow1', original_content: 'slow answer' }));
      }, 50);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const previous = process.env.TERSIO_HEADROOM_PROXY_URL;
    process.env.TERSIO_HEADROOM_PROXY_URL = `http://127.0.0.1:${port}/`;
    try {
      const answers = await serve([
        '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}',
        '{"jsonrpc":"2.0","method":"notifications/initialized"}',
        `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"tersio_headroom","arguments":{"action":"retrieve","hash":"slow1"}}}`,
      ]);
      // An exit that does not drain loses the pending answer, which the client then times out on.
      expect(answers.map((answer) => answer.id)).toEqual([1, 2]);
      expect(JSON.stringify(answers[1])).toContain('slow answer');
    } finally {
      if (previous === undefined) delete process.env.TERSIO_HEADROOM_PROXY_URL;
      else process.env.TERSIO_HEADROOM_PROXY_URL = previous;
      server.close();
    }
  });
});
