import { expect, test } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { codexModelIdentity, parseCodexTranscript } from '../../extensions/shared/codex-transcript.ts';
import { readAgentStats, readSessionTrace, rootSessionFile } from '../../extensions/shared/agent-stats.ts';
import { readUsageDb, syncUsageDb } from '../../extensions/shared/usage-store.ts';
import { hostOfSessionFile, sessionsDirs } from '../../extensions/shared/usage-ledger.ts';
import { withHome } from '../helpers/env.ts';

const CWD = '/Users/example/Projects/tersio';

function codexFixture(): string {
  const rows = [
    { timestamp: '2026-11-08T01:00:00.000Z', type: 'session_meta', payload: { model_provider: 'openai', cwd: CWD } },
    { timestamp: '2026-11-08T01:00:01.000Z', type: 'turn_context', payload: { model: 'gpt-6-luna', cwd: CWD, turn_id: 'turn-1' } },
    { timestamp: '2026-11-08T01:00:01.100Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } },
    { timestamp: '2026-11-08T01:00:02.000Z', type: 'event_msg', payload: { type: 'item_completed', turn_id: 'turn-1', item: { type: 'UserMessage', id: 'user-1', content: [{ type: 'text', text: 'Inspect the broken checkout' }] } } },
    { timestamp: '2026-11-08T01:00:03.000Z', type: 'event_msg', payload: { type: 'item_completed', turn_id: 'turn-1', item: { type: 'Reasoning', id: 'reason-1' } } },
    { timestamp: '2026-11-08T01:00:04.000Z', type: 'event_msg', payload: { type: 'item_completed', turn_id: 'turn-1', item: { type: 'AgentMessage', id: 'agent-1', content: [{ type: 'Text', text: 'Checking the repository.' }] } } },
    { timestamp: '2026-11-08T01:00:05.000Z', type: 'response_item', payload: { type: 'function_call', id: 'fc-1', call_id: 'call-bash', name: 'exec_command', arguments: '{"cmd":"git status"}' } },
    { timestamp: '2026-11-08T01:00:06.000Z', type: 'event_msg', payload: { type: 'item_completed', turn_id: 'turn-1', item: { type: 'CommandExecution', id: 'call-bash', status: 'failed', exit_code: 1, duration: { secs: 1, nanos: 250_000_000 }, cwd: `file://${CWD}`, command: ['/bin/zsh', '-lc', 'git status'], aggregated_output: 'fatal: not a git repository' } } },
    { timestamp: '2026-11-08T01:00:06.100Z', type: 'response_item', payload: { type: 'custom_tool_call', id: 'fc-2', call_id: 'call-patch', name: 'apply_patch', input: '*** Begin Patch' } },
    { timestamp: '2026-11-08T01:00:06.200Z', type: 'event_msg', payload: { type: 'item_completed', turn_id: 'turn-1', item: { type: 'FileChange', id: 'call-patch', status: 'completed', changes: [{ type: 'update', unified_diff: 'diff --git a/a b/a' }] } } },
    { timestamp: '2026-11-08T01:00:06.300Z', type: 'response_item', payload: { type: 'tool_search_call', id: 'fc-search', call_id: 'call-search', status: 'completed', arguments: '{"query":"github"}' } },
    { timestamp: '2026-11-08T01:00:06.350Z', type: 'response_item', payload: { type: 'tool_search_output', id: 'out-search', call_id: 'call-search', status: 'completed', tools: [{ type: 'function', name: 'fetch_issue' }] } },
    { timestamp: '2026-11-08T01:00:06.400Z', type: 'event_msg', payload: { type: 'item_completed', turn_id: 'turn-1', item: { type: 'McpToolCall', id: 'call-mcp', server: 'codex_apps', tool: 'github.fetch_issue', status: 'completed', duration: { secs: 0, nanos: 500_000_000 }, arguments: '{"issue":63}', result: '{"title":"Codex host"}' } } },
    { timestamp: '2026-11-08T01:00:06.500Z', type: 'response_item', payload: { type: 'function_call_output', call_id: 'call-bash', output: 'fatal: not a git repository' } },
    { timestamp: '2026-11-08T01:00:06.600Z', type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'call-patch', output: 'Done' } },
    { timestamp: '2026-11-08T01:00:07.000Z', type: 'token_usage_record', payload: { response_id: 'resp-1', usage: { input_tokens: 100, cached_input_tokens: 40, cache_write_input_tokens: 5, output_tokens: 10 } } },
    { timestamp: '2026-11-08T01:00:09.000Z', type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 100, cached_input_tokens: 40, cache_write_input_tokens: 5, output_tokens: 10 } } } },
    { timestamp: '2026-11-08T01:00:13.000Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-1', duration_ms: 12_000, time_to_first_token_ms: 3_000 } },
    { timestamp: '2026-11-08T01:01:00.000Z', type: 'turn_context', payload: { model: 'commandcode/deepseek/deepseek-v4.1-flash', cwd: CWD, turn_id: 'turn-2' } },
    { timestamp: '2026-11-08T01:01:01.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-2' } },
    { timestamp: '2026-11-08T01:01:02.000Z', type: 'event_msg', payload: { type: 'item_completed', turn_id: 'turn-2', item: { type: 'UserMessage', id: 'user-2', content: [{ type: 'text', text: 'Try again' }] } } },
    { timestamp: '2026-11-08T01:01:03.000Z', type: 'event_msg', payload: { type: 'item_completed', turn_id: 'turn-2', item: { type: 'Reasoning', id: 'reason-2' } } },
    { timestamp: '2026-11-08T01:01:04.000Z', type: 'event_msg', payload: { type: 'item_completed', turn_id: 'turn-2', item: { type: 'AgentMessage', id: 'agent-2', content: [{ type: 'Text', text: 'Retrying.' }] } } },
    { timestamp: '2026-11-08T01:01:05.000Z', type: 'event_msg', payload: { type: 'error', message: 'rate limited' } },
    { timestamp: '2026-11-08T01:01:06.000Z', type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 50, cached_input_tokens: 20, cache_write_input_tokens: 0, output_tokens: 5 } } } },
    { timestamp: '2026-11-08T01:01:08.000Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-2', duration_ms: 7_000, time_to_first_token_ms: 1_500 } },
  ];
  return `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
}

test('Codex requests carry cwd, tools, timing, and status', () => {
  const parsed = parseCodexTranscript(codexFixture());
  expect(parsed.cwd).toBe(CWD);
  expect(parsed.requests).toHaveLength(2);
  expect(parsed.requests[0]).toMatchObject({
    usage: { input: 55, output: 10, cacheRead: 40, cacheWrite: 5 },
    model: 'gpt-6-luna',
    provider: 'openai',
    cwd: CWD,
    durationMs: 12_000,
    ttftMs: 3_000,
    status: 'completed',
    tools: ['bash:git', 'apply_patch', 'tool_search', 'mcp:codex_apps/github.fetch_issue'],
  });
  expect(parsed.requests[0]!.toolFacts).toEqual([
    expect.objectContaining({ n: 'bash:git', e: 1 }),
    expect.objectContaining({ n: 'apply_patch', e: 0 }),
    expect.objectContaining({ n: 'tool_search', e: 0 }),
    expect.objectContaining({ n: 'mcp:codex_apps/github.fetch_issue', e: 0 }),
  ]);
  expect(parsed.requests[1]).toMatchObject({
    model: 'commandcode/deepseek/deepseek-v4.1-flash',
    provider: 'commandcode',
    status: 'error',
    note: 'rate limited',
    durationMs: 7_000,
    ttftMs: 1_500,
  });
  expect(parsed.tools[0]).toMatchObject({ name: 'bash:git', isError: true, durationMs: 1250 });
  expect(codexModelIdentity('commandcode/deepseek/deepseek-v4.1-flash', 'openai')).toEqual({
    model: 'commandcode/deepseek/deepseek-v4.1-flash',
    provider: 'commandcode',
  });
});

test('the usage store feeds every Codex dashboard view', () => {
  withHome((home) => {
    const file = path.join(home, '.codex', 'sessions', '2026', '11', '08', 'rollout-codex.jsonl');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, codexFixture(), 'utf8');
    expect(syncUsageDb()).toBe(true);
    expect(readUsageDb()?.tokens.recent.map((row) => row.d)).toEqual(expect.arrayContaining([12_000, 7_000]));

    const stats = readAgentStats('all');
    for (const view of ['overview', 'models', 'providers', 'costs', 'carbon', 'requests', 'errors', 'traces', 'tools', 'projects', 'summary'] as const) {
      expect(readAgentStats('all', view).available, view).toBe(true);
    }
    expect(stats.overall).toMatchObject({ requests: 2, failed: 1 });
    expect(stats.byModel.map((row) => row.key)).toEqual(expect.arrayContaining([
      'gpt-6-luna',
      'commandcode/deepseek/deepseek-v4.1-flash',
    ]));
    expect(stats.byProject[0]?.key).toBe(CWD);
    expect(stats.byProject[0]?.requests).toBe(2);
    expect(stats.byAgentType[0]).toMatchObject({ agentType: 'main', requests: 2 });
    expect(stats.series.reduce((sum, row) => sum + row.requests, 0)).toBe(2);
    expect(stats.seriesByProvider.map((row) => row.provider)).toEqual(expect.arrayContaining(['openai', 'commandcode']));
    expect(stats.modelSeries.map((row) => row.model)).toEqual(expect.arrayContaining([
      'gpt-6-luna',
      'commandcode/deepseek/deepseek-v4.1-flash',
    ]));
    expect(stats.overall.costUsd).toBeGreaterThan(0);
    expect(stats.tools.map((row) => row.tool)).toEqual(expect.arrayContaining([
      'bash:git', 'apply_patch', 'tool_search', 'mcp:codex_apps/github.fetch_issue',
    ]));
    expect(stats.tools.find((row) => row.tool === 'bash:git')?.errors).toBe(1);
    expect(stats.byProvider.map((row) => row.key)).toEqual(expect.arrayContaining(['openai', 'commandcode']));
    expect(stats.recent.map((row) => ({ durationMs: row.durationMs, ttftMs: row.ttftMs }))).toEqual([
      expect.objectContaining({ durationMs: 7_000, ttftMs: 1_500 }),
      expect.objectContaining({ durationMs: 12_000, ttftMs: 3_000 }),
    ]);
    expect(stats.errors).toHaveLength(1);
    expect(stats.errorGroups).toHaveLength(1);
    expect(stats.requestStats).toMatchObject({ requests: 2, failed: 1, shipped: 2 });
    expect(stats.traces).toHaveLength(1);
    expect(stats.traces[0]?.project).toBe(CWD);
    expect(stats.traces[0]?.sessionFile).toBe(file);
    expect(stats.traces[0]?.toolCalls).toBe(4);

    const trace = readSessionTrace(file);
    expect(trace.cwd).toBe(CWD);
    expect(trace.project).toBe('tersio');
    expect(trace.summary.turns).toBe(2);
    expect(trace.summary.requests).toBe(2);
    expect(trace.summary.toolCalls).toBe(4);
    expect(trace.toolStats.map((row) => row.tool)).toEqual(expect.arrayContaining([
      'bash:git', 'apply_patch', 'tool_search', 'mcp:codex_apps/github.fetch_issue',
    ]));
    expect(rootSessionFile(file)).toBe(file);
  });
});

test('the usage scan follows a relocated CODEX_HOME', () => {
  withHome((home) => {
    const codexHome = path.join(home, 'relocated-codex');
    const previous = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    try {
      const file = path.join(codexHome, 'sessions', '2026', '11', '08', 'rollout-relocated.jsonl');
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, codexFixture(), 'utf8');
      expect(sessionsDirs()).toContain(path.join(codexHome, 'sessions'));
      expect(hostOfSessionFile(file)).toBe('codex');
      expect(syncUsageDb()).toBe(true);
      expect(readUsageDb()?.tokens.messages).toBe(2);
      expect(readAgentStats('all').byProject[0]?.key).toBe(CWD);
    } finally {
      if (previous === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previous;
    }
  });
});
