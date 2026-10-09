// Pins the omp aggregate against a fixture database: every rule in the metric contract has one
// assertion here, so a change in the reader fails loudly instead of drifting from the reference.
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { errorSignature, readOmpStats, readSessionTrace } from '../../extensions/shared/omp-stats.ts';
import { hasSqlite } from '../helpers/env.ts';
import { writeOmpAgentDb, writeOmpStatsDb, writeSessionFixture } from '../helpers/omp-fixture.ts';

const HOUR = 3_600_000;
const DAY = 86_400_000;

let dir = '';
let previous: { stats?: string; agent?: string };

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'tersio-omp-'));
  previous = { stats: process.env.TERSIO_OMP_STATS_DB, agent: process.env.TERSIO_OMP_AGENT_DB };
});

afterEach(() => {
  for (const [key, value] of Object.entries({ TERSIO_OMP_STATS_DB: previous.stats, TERSIO_OMP_AGENT_DB: previous.agent })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});

/** Five requests: two priced and cached, one free with no duration, one error, one aborted. */
function seed(): { now: number } {
  const now = Date.now();
  process.env.TERSIO_OMP_STATS_DB = writeOmpStatsDb(path.join(dir, 'stats.db'), {
    messages: [
      { session: 's1.jsonl', entry: 'e1', folder: '-proj-a', model: 'priced-model', provider: 'commandcode', ts: now - 5 * HOUR, duration: 2000, ttft: 500, input: 1000, output: 500, cacheRead: 4000, total: 5500, cost: 0.10, noCacheCost: 0.50, costInput: 0.01, costOutput: 0.05, costRead: 0.04 },
      { session: 's1.jsonl', entry: 'e2', folder: '-proj-a', model: 'priced-model', provider: 'commandcode', ts: now - 4 * HOUR, duration: 4000, ttft: 1000, input: 2000, output: 1000, cacheRead: 8000, total: 11000, cost: 0.20, noCacheCost: 1.00, costInput: 0.02, costOutput: 0.10, costRead: 0.08 },
      { session: 's2.jsonl', entry: 'e3', folder: '-proj-b', model: 'free-model', provider: 'magpie', ts: now - 3 * HOUR, duration: null, ttft: null, input: 100, output: 50, total: 150, agentType: 'subagent' },
      { session: 's2.jsonl', entry: 'e4', folder: '-proj-b', model: 'free-model', provider: 'xai-oauth', ts: now - 2 * HOUR, stop: 'error', error: '429 Too Many Requests retry-after-ms=37044000 req_abcdef123456', duration: 3000, ttft: 600, input: 10, total: 10, agentType: 'advisor', costUnpriced: 1 },
      { session: 's1.jsonl', entry: 'e5', folder: '-proj-a', model: 'free-model-2', provider: 'xai-oauth', ts: now - 10 * 60_000, stop: 'aborted', duration: 1000, ttft: 100, input: 20, total: 20 },
    ],
    tools: [
      { session: 's1.jsonl', entry: 'e1', toolCallId: 't1', tool: 'read', model: 'priced-model', provider: 'commandcode', ts: now - 5 * HOUR, callsInTurn: 2, argsChars: 100, resultChars: 200 },
      { session: 's1.jsonl', entry: 'e1', toolCallId: 't2', tool: 'bash', model: 'priced-model', provider: 'commandcode', ts: now - 5 * HOUR, callsInTurn: 2, argsChars: 50, resultChars: null, isError: 1 },
    ],
  });
  process.env.TERSIO_OMP_AGENT_DB = writeOmpAgentDb(path.join(dir, 'agent.db'), [
    { ts: now - 3 * HOUR, provider: 'openai-codex', accountKey: 'oauth|a', email: 'a@example.com', limitId: 'openai-codex:primary', label: '30 days', windowLabel: '30 days', usedFraction: 0.2, status: 'ok', resetsAt: now + DAY },
    { ts: now - 2 * HOUR, provider: 'openai-codex', accountKey: 'oauth|a', email: 'a@example.com', limitId: 'openai-codex:primary', label: '30 days', windowLabel: '30 days', usedFraction: 0.6, status: 'ok', resetsAt: now + DAY },
  ]);
  return { now };
}

describe.skipIf(!hasSqlite())('omp aggregate', () => {
  test('matches the metric contract on every figure', () => {
    seed();
    const omp = readOmpStats('all');
    expect(omp.available).toBe(true);

    expect(omp.overall.requests).toBe(5);
    expect(omp.overall.failed).toBe(1);
    expect(omp.overall.successful).toBe(4);
    expect(omp.overall.errorRate).toBeCloseTo(1 / 5, 12);
    expect(omp.overall.input).toBe(3130);
    expect(omp.overall.output).toBe(1550);
    expect(omp.overall.cacheRead).toBe(12000);
    expect(omp.overall.cacheWrite).toBe(0);
    expect(omp.overall.total).toBe(16680);
    expect(omp.overall.cacheRate).toBeCloseTo(12000 / 15130, 12);
    expect(omp.overall.cacheSavings).toBeCloseTo((1.5 - 0.15) / 1.5, 12);
    expect(omp.overall.costUsd).toBeCloseTo(0.3, 12);
    expect(omp.overall.unpricedRequests).toBe(2);
    expect(omp.overall.avgDurationMs).toBeCloseTo(2500, 9);
    expect(omp.overall.avgTtftMs).toBeCloseTo(550, 9);
    expect(omp.overall.avgTokensPerSecond).toBeCloseTo(125, 9);
    // The fixture spans five hours, minus the ten minutes of the newest row.
    expect(omp.overall.lastTs! - omp.overall.firstTs!).toBe(5 * HOUR - 10 * 60_000);
  });

  test('groups by model and provider, by provider, by project, and by agent type', () => {
    seed();
    const omp = readOmpStats('all');

    expect(omp.byModel.map((row) => `${row.key}|${row.provider}`).toSorted()).toEqual([
      'free-model-2|xai-oauth',
      'free-model|magpie',
      'free-model|xai-oauth',
      'priced-model|commandcode',
    ]);
    expect(omp.byModel[0].key).toBe('priced-model');
    expect(omp.byModel[0].requests).toBe(2);
    expect(omp.byModel[0].costUsd).toBeCloseTo(0.3, 12);

    const byProvider = Object.fromEntries(omp.byProvider.map((row) => [row.key, row]));
    expect(byProvider.commandcode.requests).toBe(2);
    expect(byProvider.commandcode.models).toBe(1);
    expect(byProvider['xai-oauth'].models).toBe(2);
    expect(byProvider.magpie.failed).toBe(0);

    const byProject = Object.fromEntries(omp.byProject.map((row) => [row.key, row.requests]));
    expect(byProject['-proj-a']).toBe(3);
    expect(byProject['-proj-b']).toBe(2);

    const byAgent = Object.fromEntries(omp.byAgentType.map((row) => [row.agentType, row.requests]));
    expect(byAgent).toEqual({ main: 3, subagent: 1, advisor: 1 });
  });

  test('buckets the series by range and keeps the totals additive', () => {
    seed();
    for (const [range, bucketMs] of [['1h', 300_000], ['24h', HOUR], ['7d', DAY], ['30d', DAY], ['90d', DAY], ['all', DAY]] as const) {
      const omp = readOmpStats(range);
      expect(omp.bucketMs).toBe(bucketMs);
      expect(omp.series.reduce((sum, bucket) => sum + bucket.requests, 0)).toBe(omp.overall.requests);
      expect(omp.series.reduce((sum, bucket) => sum + bucket.tokens, 0)).toBe(omp.overall.total);
      for (const bucket of omp.series) expect(bucket.ts % bucketMs).toBe(0);
    }
    // A one hour window holds only the row written ten minutes ago.
    const hour = readOmpStats('1h');
    expect(hour.overall.requests).toBe(1);
    expect(hour.series.length).toBe(1);
  });

  test('splits provider and hour series, and fills every hour slot it has data for', () => {
    seed();
    const omp = readOmpStats('all');
    const providers = omp.seriesByProvider.map((series) => series.provider);
    // Every provider fits under the series cap here, ordered by cost, so commandcode leads.
    expect(providers.toSorted()).toEqual(['commandcode', 'magpie', 'xai-oauth']);
    expect(providers[0]).toBe('commandcode');
    const commandcode = omp.seriesByProvider.find((series) => series.provider === 'commandcode');
    expect(commandcode?.points.reduce((sum, point) => sum + point.requests, 0)).toBe(2);
    expect(commandcode?.points.every((point) => point.ts % DAY === 0)).toBe(true);

    expect(omp.hourOfDay.reduce((sum, slot) => sum + slot.requests, 0)).toBe(5);
    expect(omp.hourOfDay.every((slot) => slot.hour >= 0 && slot.hour < 24)).toBe(true);
    expect(omp.modelSeries.length).toBeGreaterThan(0);
  });

  test('reads the recent rows and groups failures by normalized signature', () => {
    seed();
    const omp = readOmpStats('all');
    expect(omp.recent.length).toBe(5);
    expect(omp.recent[0].entryId).toBe('e5');
    expect(omp.recent[0].unpriced).toBe(true);
    expect(omp.recent.find((row) => row.entryId === 'e1')?.ttftMs).toBe(500);

    expect(omp.errorGroups.length).toBe(1);
    expect(omp.errorGroups[0].count).toBe(1);
    expect(omp.errorGroups[0].latest.entryId).toBe('e4');
    expect(omp.errorGroups[0].models).toEqual([{ model: 'free-model', provider: 'xai-oauth', count: 1 }]);
    expect(omp.errorModels).toEqual([{ model: 'free-model', provider: 'xai-oauth', count: 1 }]);
    expect(omp.errorGroups[0].signature).toBe('429 Too Many Requests retry-after-ms=N <id>');
  });

  test('averages throughput and first-token latency per model, provider, and bucket', () => {
    seed();
    const omp = readOmpStats('all', 'models');
    const priced = omp.modelPerformance.find((series) => series.model === 'priced-model' && series.provider === 'commandcode');
    expect(priced).toBeDefined();
    // One bucket holds every commandcode message, so both averages cover the same two rows.
    expect(priced?.points.length).toBe(1);
    const point = priced?.points[0];
    expect(point?.requests).toBe(2);
    // e1: 500 out over 2000ms, e2: 1000 out over 4000ms. Both run at 250 tok/s, so the mean does too.
    expect(point?.avgTokensPerSecond).toBeCloseTo(250, 9);
    expect(point?.avgTtftMs).toBeCloseTo(750, 9);
    // A provider with no timed message carries null, not a zero that would draw a flat line.
    const magpie = omp.modelPerformance.find((series) => series.provider === 'magpie');
    expect(magpie?.points.every((p) => p.avgTokensPerSecond === null && p.avgTtftMs === null)).toBe(true);
    // The models view carries the group, and a view that does not need it skips it.
    expect(readOmpStats('all', 'traces').modelPerformance).toEqual([]);
  });

  test('attributes tool tokens by the calls in the invoking turn', () => {
    seed();
    const omp = readOmpStats('all');
    const read = omp.tools.find((row) => row.tool === 'read');
    const bash = omp.tools.find((row) => row.tool === 'bash');
    expect(omp.tools.length).toBe(2);
    expect(read?.calls).toBe(1);
    expect(read?.argsChars).toBe(100);
    expect(read?.resultChars).toBe(200);
    expect(read?.totalTokensShare).toBeCloseTo(5500 / 2, 9);
    expect(read?.outputTokensShare).toBeCloseTo(500 / 2, 9);
    expect(read?.costShare).toBeCloseTo(0.10 / 2, 12);
    expect(bash?.errors).toBe(1);
    expect(bash?.resultChars).toBe(0);
    expect(omp.tools[0].tool).toBe('read');
    expect(omp.toolsByModel.length).toBe(2);
    expect(omp.toolsByModel[0].model).toBe('priced-model');
    expect(omp.toolSeries.reduce((sum, point) => sum + point.calls, 0)).toBe(2);
  });

  test('groups messages into session traces and counts their tool calls', () => {
    seed();
    const traces = readOmpStats('all').traces;
    expect(traces.length).toBe(2);
    const first = traces[0];
    expect(first.sessionFile).toBe('s1.jsonl');
    expect(first.requests).toBe(3);
    expect(first.toolCalls).toBe(2);
    expect(first.lastTs).toBeGreaterThan(first.firstTs);
    expect(traces[1].project).toBe('-proj-b');
  });

  test('reads the quota windows, their accounts, and the peak utilization', () => {
    seed();
    const omp = readOmpStats('all', 'providers');
    expect(omp.windowInsights.length).toBe(1);
    const insight = omp.windowInsights[0];
    expect(insight.provider).toBe('openai-codex');
    expect(insight.windowKey).toBe('openai-codex:primary');
    expect(insight.windowLabel).toBe('30 days');
    expect(insight.accounts).toBe(1);
    expect(insight.cycles).toBe(0);
    expect(insight.fractionConsumed).toBeCloseTo(0.4, 9);
    expect(insight.peakConcurrentFraction).toBeCloseTo(0.6, 9);
    expect(insight.idealAccounts).toBe(1);
    expect(insight.exhaustedEvents).toBe(0);
    // No message in the fixture ran through openai-codex, so no window capacity can be extrapolated.
    expect(insight.estTokensPerWindow).toBeNull();
    expect(omp.usageSeries.length).toBe(1);
    expect(omp.usageSeries[0].accountLabel).toBe('a@example.com');
    expect(omp.usageSeries[0].points.map((point) => point.usedFraction)).toEqual([0.2, 0.6]);
  });

  test('runs only the query groups a view asks for', () => {
    seed();
    const projects = readOmpStats('all', 'projects');
    expect(projects.overall.requests).toBe(5);
    expect(projects.byModel).toEqual([]);
    expect(projects.traces).toEqual([]);

    const traces = readOmpStats('all', 'traces');
    expect(traces.traces.length).toBe(2);
    expect(traces.byModel).toEqual([]);
    expect(traces.overall.requests).toBe(0);
  });

  test('flattens a session transcript, marking tool failures', () => {
    const file = writeSessionFixture(path.join(dir, 'agent', 'sessions', '-proj-a', 's.jsonl'), [
      { role: 'user', timestamp: '2026-01-01T00:00:02.000Z', content: [{ type: 'text', text: 'hello there' }] },
      {
        role: 'assistant',
        timestamp: '2026-01-01T00:00:03.000Z',
        model: 'deepseek/deepseek-v4.1-flash',
        provider: 'commandcode',
        duration: 1500,
        content: [{ type: 'toolCall', name: 'read' }],
        usage: { totalTokens: 1200, cost: { total: 0.002 } },
      },
      {
        role: 'toolResult',
        timestamp: '2026-01-01T00:00:04.000Z',
        toolName: 'read',
        isError: true,
        content: [{ type: 'text', text: 'ENOENT: no such file' }],
      },
    ]);
    const trace = readSessionTrace(file);
    expect(trace.entries.length).toBe(3);
    expect(trace.entries.map((entry) => entry.kind)).toEqual(['user', 'assistant', 'tool']);
    expect(trace.entries[0].detail).toBe('hello there');
    expect(trace.entries[1].tokens).toBe(1200);
    expect(trace.entries[1].costUsd).toBeCloseTo(0.002, 9);
    expect(trace.entries[1].tool).toBe('read');
    expect(trace.entries[2].isError).toBe(true);
    expect(trace.entries[2].label).toBe('read');
    expect(trace.truncated).toBe(false);
    expect(trace.project).toBe('-proj-a');
  });

  test('degrades to an empty result instead of throwing when a source is gone', () => {
    process.env.TERSIO_OMP_STATS_DB = path.join(dir, 'missing.db');
    process.env.TERSIO_OMP_AGENT_DB = path.join(dir, 'missing-agent.db');
    const omp = readOmpStats('all');
    expect(omp.available).toBe(false);
    expect(omp.overall.requests).toBe(0);
    expect(omp.byModel).toEqual([]);
    expect(omp.windowInsights).toEqual([]);
    expect(omp.usageSeries).toEqual([]);
  });

  test('still reads the quota half when only stats.db is missing', () => {
    seed();
    process.env.TERSIO_OMP_STATS_DB = path.join(dir, 'missing.db');
    const omp = readOmpStats('all');
    expect(omp.available).toBe(false);
    expect(omp.windowInsights.length).toBe(1);
  });
});

describe('error signatures', () => {
  test('normalizes ids and counters but keeps an HTTP status', () => {
    expect(errorSignature('429 Too Many Requests retry-after-ms=37044000 req_abcdef123456'))
      .toBe('429 Too Many Requests retry-after-ms=N <id>');
    expect(errorSignature('session 01a121a3-819c-75b4-ac63-f912798f4f86 failed'))
      .toBe('session <id> failed');
    expect(errorSignature('body a1b2c3d4e5f60718 rejected')).toBe('body <hex> rejected');
    expect(errorSignature('rate limit after 1.5s')).toBe('rate limit after Ns');
  });

  test('names an empty message and clips a long one', () => {
    expect(errorSignature(null)).toBe('Unknown error');
    expect(errorSignature('   ')).toBe('Unknown error');
    expect(errorSignature('x'.repeat(400)).length).toBe(180);
    expect(errorSignature('x'.repeat(400)).endsWith('…')).toBe(true);
  });
});
