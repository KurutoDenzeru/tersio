import { describe, expect, test } from 'vitest';
import http from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';

import { tmpdir } from 'node:os';
import path from 'node:path';
import { handleMessage } from '../../cli/mcp.ts';

// One collector stands in for the wire, so the tests assert what a client receives.
function collector(): { sent: unknown[]; send: (msg: unknown) => void } {
  const sent: unknown[] = [];
  return { sent, send: (msg: unknown) => { sent.push(msg); } };
}

const call = (id: number, method: string, params?: unknown): { jsonrpc: string; id: number; method: string; params?: unknown } => ({
  jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }),
});

describe('the MCP server protocol', () => {
  test('initialize answers with the server identity and the version the server speaks', async () => {
    const { sent, send } = collector();
    await handleMessage(call(1, 'initialize', { protocolVersion: '2025-03-26', clientInfo: { name: 't', version: '0' } }), send);
    expect(sent).toHaveLength(1);
    // The collector holds raw wire objects; one cast names the answer's shape for the reads below.
    const answer = sent[0] as { result: { protocolVersion: string; capabilities: Record<string, unknown>; serverInfo: { name: string } } };
    // The spec wants a version the server supports, not an echo of whatever the client asked.
    expect(answer.result.protocolVersion).toBe('2025-06-18');
    expect(answer.result.capabilities.tools).toEqual({});
    expect(answer.result.serverInfo.name).toBe('tersio');
  });


  test('tools/list names every tool a client can call', async () => {
    const { sent, send } = collector();
    await handleMessage(call(2, 'tools/list'), send);
    const answer = sent[0] as { result: { tools: Array<{ name: string }> } };
    expect(answer.result.tools.map((t) => t.name)).toEqual(['tersio_stats', 'tersio_activity', 'tersio_modes', 'tersio_headroom']);
  });

  test('a bad range and an unknown tool answer with invalid-params', async () => {
    const { sent, send } = collector();
    await handleMessage(call(3, 'tools/call', { name: 'tersio_stats', arguments: { range: 'bogus' } }), send);
    await handleMessage(call(4, 'tools/call', { name: 'nope', arguments: {} }), send);
    const rangeError = sent[0] as { error: { code: number; message: string } };
    const toolError = sent[1] as { error: { code: number; message: string } };
    expect(rangeError.error.code).toBe(-32602);
    expect(rangeError.error.message).toContain('range must be one of');
    expect(toolError.error.code).toBe(-32602);
    expect(toolError.error.message).toContain('unknown tool');
  });

  test('tersio_headroom rejects an action it does not pass through', async () => {
    const { sent, send } = collector();
    await handleMessage(call(9, 'tools/call', { name: 'tersio_headroom', arguments: { action: 'bogus' } }), send);
    const answer = sent[0] as { error: { code: number; message: string } };
    expect(answer.error.code).toBe(-32602);
    expect(answer.error.message).toContain('action must be');
  });

  test('tersio_headroom retrieve fetches the original by hash', async () => {
    const server = http.createServer((req, res) => {
      if (req.url === '/v1/retrieve' && req.method === 'POST') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ hash: 'abc123', original_content: 'the original text' }));
        return;
      }
      res.writeHead(404);
      res.end('not found');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const previous = process.env.TERSIO_HEADROOM_PROXY_URL;
    process.env.TERSIO_HEADROOM_PROXY_URL = `http://127.0.0.1:${port}/`;
    try {
      const { sent, send } = collector();
      await handleMessage(call(10, 'tools/call', { name: 'tersio_headroom', arguments: { action: 'retrieve', hash: 'abc123' } }), send);
      const answer = sent[0] as { result: { content: Array<{ text: string }> } };
      expect(answer.result.content[0].text).toBe('the original text');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (previous === undefined) delete process.env.TERSIO_HEADROOM_PROXY_URL;
      else process.env.TERSIO_HEADROOM_PROXY_URL = previous;
    }
  });

  test('an unknown method answers with method-not-found, and ping answers empty', async () => {
    const { sent, send } = collector();
    await handleMessage(call(5, 'resources/list'), send);
    await handleMessage(call(6, 'ping'), send);
    const methodError = sent[0] as { error: { code: number } };
    const pong = sent[1] as { result: unknown };
    expect(methodError.error.code).toBe(-32601);
    expect(pong.result).toEqual({});
  });

  test('a notification and a malformed method draw no answer', async () => {
    const { sent, send } = collector();
    await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, send);
    await handleMessage({ jsonrpc: '2.0', id: 7, method: 42 }, send);
    expect(sent).toHaveLength(0);
  });
});

describe('the MCP modes tool', () => {
  const modes = async (args: Record<string, unknown>): Promise<{ text: string; error?: { message: string } }> => {
    const { sent, send } = collector();
    await handleMessage(call(11, 'tools/call', { name: 'tersio_modes', arguments: args }), send);
    const answer = sent[0] as { result?: { content: Array<{ text: string }> }; error?: { message: string } };
    if (answer.error) return { text: '', error: answer.error };
    return { text: answer.result.content[0].text };
  };

  test('an unknown level answers with invalid-params naming the mode', async () => {
    const { error } = await modes({ caveman: 'bogus' });
    expect(error?.message).toContain('caveman must be one of');
  });

  test('a single mode overrides its piece of the preset and lands in settings', async () => {
    // Isolated homes, so the write never touches the real settings or the ponytail mirror.
    const home = await mkdtemp(path.join(tmpdir(), 'tersio-modes-'));
    const previousTersio = process.env.TERSIO_HOME;
    const previousXdg = process.env.XDG_CONFIG_HOME;
    process.env.TERSIO_HOME = home;
    process.env.XDG_CONFIG_HOME = path.join(home, 'config');
    try {
      const set = await modes({ combo: 'balanced', caveman: 'ultra' });
      expect(set.text).toContain('Session defaults saved');
      expect(set.text).toContain('caveman=ultra');
      // balanced sets rtk on; the read-back proves the whole profile persisted.
      const read = await modes({});
      expect(read.text).toContain('caveman=ultra');
      expect(read.text).toContain('rtk=on');
      const stored = JSON.parse(await readFile(path.join(home, 'settings.json'), 'utf8')) as { cavemanDefault: string };
      expect(stored.cavemanDefault).toBe('ultra');
    } finally {
      process.env.TERSIO_HOME = previousTersio;
      process.env.XDG_CONFIG_HOME = previousXdg;
    }
  });
});
