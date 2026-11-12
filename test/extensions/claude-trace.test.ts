// Claude Code writes its own JSONL shape; the trace page must read it instead of drawing zero spans.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { readSessionTrace } from '../../extensions/shared/agent-stats.ts';

test('a Claude transcript becomes turns, one model span per request, and tool spans', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tersio-claude-trace-'));
  const file = path.join(dir, 'projects', '-tmp-project', 'session.jsonl');
  try {
    const rows = [
      { type: 'api-request', id: 'req-1', timestamp: '2026-11-11T10:00:00.000Z' },
      {
        type: 'user',
        uuid: 'turn-1',
        timestamp: '2026-11-11T10:00:00.100Z',
        cwd: '/tmp/project',
        origin: { kind: 'human' },
        message: { role: 'user', content: [{ type: 'text', text: 'fix the trace' }] },
      },
      {
        type: 'assistant',
        uuid: 'assistant-1',
        requestRef: 'req-1',
        timestamp: '2026-11-11T10:00:01.000Z',
        message: {
          id: 'msg-1',
          role: 'assistant',
          model: 'claude-sonnet-5-5',
          stop_reason: 'tool_use',
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_read_input_tokens: 2,
            cache_creation_input_tokens: 1,
          },
          content: [
            { type: 'text', text: 'Looking at it' },
            { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'ls' } },
          ],
        },
      },
      {
        type: 'user',
        uuid: 'result-1',
        timestamp: '2026-11-11T10:00:01.500Z',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tool-1', is_error: false, content: 'ok' }],
        },
      },
      {
        type: 'assistant',
        uuid: 'assistant-2',
        requestRef: 'req-1',
        timestamp: '2026-11-11T10:00:02.000Z',
        message: {
          id: 'msg-1',
          role: 'assistant',
          model: 'claude-sonnet-5-5',
          stop_reason: 'end_turn',
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_read_input_tokens: 2,
            cache_creation_input_tokens: 1,
          },
          content: [{ type: 'text', text: 'Done' }],
        },
      },
      { type: 'custom-title', customTitle: 'Trace test' },
    ];
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
    const trace = readSessionTrace(file);
    expect(trace.title).toBe('Trace test');
    expect(trace.cwd).toBe('/tmp/project');
    expect(trace.project).toBe('-tmp-project');
    const models = trace.tracks[0].spans.filter((span) => span.kind === 'model');
    expect(models).toHaveLength(1);
    expect(models[0].tokens).toBe(18);
    expect(models[0].costUsd).toBeGreaterThan(0);
    const tools = trace.tracks[0].spans.filter((span) => span.kind === 'tool');
    expect(tools).toHaveLength(1);
    expect(tools[0].label).toBe('Bash');
    expect(tools[0].detail).toBe('ls');
    expect(tools[0].start).toBe(Date.parse('2026-11-11T10:00:01.000Z'));
    expect(tools[0].end).toBe(Date.parse('2026-11-11T10:00:01.500Z'));
    expect(trace.tracks[0].spans.some((span) => span.kind === 'turn')).toBe(true);
    expect(trace.toolStats.find((row) => row.tool === 'Bash')?.calls).toBe(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
