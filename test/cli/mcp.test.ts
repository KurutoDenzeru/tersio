import { describe, expect, test } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';

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
    expect(answer.result.tools.map((t) => t.name)).toEqual(['tersio_stats', 'tersio_activity', 'tersio_modes', 'rtk_run']);
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
      // The README spellings resolve through the same extension normalizer as the hosts.
      const aliased = await modes({ caveman: 'wenyan', rtk: 'enable' });
      expect(aliased.text).toContain('caveman=megacave-full');
      expect(aliased.text).toContain('rtk=on');
    } finally {
      process.env.TERSIO_HOME = previousTersio;
      process.env.XDG_CONFIG_HOME = previousXdg;
    }
  });
});

describe('the MCP rtk_run tool', () => {
  const run = async (args: unknown): Promise<{ text: string; isError?: boolean; error?: { code: number; message: string } }> => {
    const { sent, send } = collector();
    await handleMessage(call(21, 'tools/call', { name: 'rtk_run', arguments: { args } }), send);
    const answer = sent[0] as {
      result?: { content: Array<{ text: string }>; isError?: boolean };
      error?: { code: number; message: string };
    };
    if (answer.error) return { text: '', error: answer.error };
    return { text: answer.result?.content[0]?.text ?? '', isError: answer.result?.isError };
  };

  test('runs the command plainly when RTK mode is off', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'tersio-rtk-off-'));
    const previous = process.env.TERSIO_HOME;
    process.env.TERSIO_HOME = home;
    try {
      const result = await run([process.execPath, '-e', 'process.stdout.write("plain")']);
      expect(result.text).toBe('plain');
      expect(result.isError).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.TERSIO_HOME;
      else process.env.TERSIO_HOME = previous;
    }
  });

  // The off path above covers Windows. The fake rtk shim is a POSIX script because cmd.exe
  // does not pass the arguments the same way to a batch fixture.
  test.skipIf(process.platform === 'win32')('runs through rtk when RTK mode is on', async () => {
    const home = await mkdtemp(path.join(tmpdir(), 'tersio-rtk-on-'));
    const bin = path.join(home, 'bin');
    await mkdir(bin, { recursive: true });
    const rtk = path.join(bin, 'rtk');
    await writeFile(rtk, '#!/bin/sh\nprintf "rtk:%s" "$*"\n', 'utf8');
    await chmod(rtk, 0o755);
    await writeFile(path.join(home, 'settings.json'), JSON.stringify({ rtkDefault: true }), 'utf8');
    const previous = { home: process.env.TERSIO_HOME, path: process.env.PATH };
    process.env.TERSIO_HOME = home;
    process.env.PATH = `${bin}${path.delimiter}${previous.path ?? ''}`;
    try {
      const result = await run(['git', 'status']);
      expect(result.text.trim()).toBe('rtk:git status');
      expect(result.isError).toBe(false);
    } finally {
      if (previous.home === undefined) delete process.env.TERSIO_HOME;
      else process.env.TERSIO_HOME = previous.home;
      process.env.PATH = previous.path;
    }
  });

  test('rejects an empty argument list with invalid-params', async () => {
    const { error } = await run([]);
    expect(error?.code).toBe(-32602);
    expect(error?.message).toContain('args must be a non-empty array of strings');
  });
});
