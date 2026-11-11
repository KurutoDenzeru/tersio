// Guards the Claude Code parse: the request row anchors duration, the alias names the gateway, and the turn id finds its payload.
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { readAgentRequestEntry } from '../../extensions/shared/agent-stats.ts';
import { classifySessionLine } from '../../extensions/shared/usage-ledger.ts';
import type { ClaudeParseState, SessionLineRow } from '../../extensions/shared/usage-ledger.ts';

const REQUEST: SessionLineRow = {
  type: 'api-request',
  id: 'req-1',
  timestamp: '2026-11-11T06:28:01.961Z',
};

function assistant(extra: Partial<SessionLineRow> = {}): SessionLineRow {
  return {
    type: 'assistant',
    uuid: 'turn-1',
    requestRef: 'req-1',
    requestedModel: 'mythos-magpie-2429134043',
    timestamp: '2026-11-11T06:28:08.261Z',
    message: {
      role: 'assistant',
      model: 'minimax-m3.1-flash-free',
      usage: { input_tokens: 40809, output_tokens: 16, cache_read_input_tokens: 128 },
      content: [{ type: 'text' }],
    },
    ...extra,
  };
}

function parsed(extra: Partial<SessionLineRow> = {}) {
  const claude: ClaudeParseState = { requests: new Map() };
  classifySessionLine(REQUEST, undefined, undefined, claude);
  return classifySessionLine(assistant(extra), undefined, undefined, claude);
}

describe('Claude Code transcript parse', () => {
  test('the request row turns the response into a duration', () => {
    expect(parsed()).toMatchObject({ durMs: 6300, provider: 'magpie' });
  });

  test('a thinking row reports its own first-token time', () => {
    expect(parsed({ thinkingDurationMs: 121 })).toMatchObject({ ttftMs: 121 });
  });

  test('a native Claude model reports Anthropic, an unknown alias reports nothing', () => {
    expect(parsed({ requestedModel: 'claude-sonnet-5-5' })).toMatchObject({ provider: 'anthropic' });
    expect(parsed({ requestedModel: 'opaque-alias' })).toMatchObject({ provider: undefined });
  });

  test('the turn id reads back its output message and API', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'tersio-claude-entry-'));
    const file = path.join(dir, 'session.jsonl');
    writeFileSync(file, [REQUEST, assistant()].map((row) => JSON.stringify(row)).join('\n'), 'utf8');
    const entry = readAgentRequestEntry(file, 'turn-1');
    expect(entry.entry).toMatchObject({ uuid: 'turn-1' });
    expect(entry.output).toMatchObject({ role: 'assistant', api: 'anthropic-messages' });
    expect(entry.messageRole).toBe('assistant');
  });
});
