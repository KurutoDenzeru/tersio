import {afterEach, beforeEach, describe, expect, test} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {readAgentStats} from '../../extensions/shared/agent-stats.ts';
import {sqliteExec} from '../../extensions/shared/sqlite.ts';
import {hasSqlite} from '../helpers/env.ts';
import {sessionPath, writeQuotaDb, writeUsageStore} from '../helpers/omp-fixture.ts';

const HOUR = 3_600_000;
const MINUTE = 60_000;

let dir = '';
let previous: { stats?: string; sessions?: string };

describe.skipIf(!hasSqlite())('agent stats provider quota', () => {
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'tersio-agent-stats-'));
    previous = {
      stats: process.env.TERSIO_AGENT_STATS_DB,
      sessions: process.env.TERSIO_AGENT_SESSIONS_DB,
    };
    process.env.TERSIO_AGENT_STATS_DB = path.join(dir, 'usage.db');
    process.env.TERSIO_AGENT_SESSIONS_DB = path.join(dir, 'agent.db');
  });

  afterEach(() => {
    for (const [key, value] of Object.entries({
      TERSIO_AGENT_STATS_DB: previous.stats,
      TERSIO_AGENT_SESSIONS_DB: previous.sessions,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  test('quota estimates use only OMP-host provider tokens', () => {
    const now = Date.now();
    const statsDb = path.join(dir, 'usage.db');
    const session = sessionPath(dir, '-project', 'session.jsonl');
    writeUsageStore(statsDb, {
      messages: [
        { session, entry: 'omp-call', model: 'openai-codex/model', gateway: 'openai-codex', ts: now - 30 * MINUTE, input: 80, output: 20 },
        { session, entry: 'other-host-call', model: 'openai-codex/model', gateway: 'openai-codex', ts: now - 30 * MINUTE, input: 800, output: 200 },
      ],
    });
    sqliteExec(statsDb, "UPDATE messages SET h = 'pi' WHERE id = 'other-host-call';");
    writeQuotaDb(path.join(dir, 'agent.db'), [
      { ts: now - 2 * HOUR, provider: 'openai-codex', accountKey: 'account-a', limitId: 'primary', label: 'Monthly', usedFraction: 0.1 },
      { ts: now - 30 * MINUTE, provider: 'openai-codex', accountKey: 'account-a', limitId: 'primary', label: 'Monthly', usedFraction: 0.6 },
    ]);

    const insight = readAgentStats('1h', 'providers', now).windowInsights[0];

    expect(insight.fractionConsumed).toBeCloseTo(0.5, 9);
    expect(insight.estTokensPerWindow).toBe(200);
  });

  test('cutoff delta uses the preceding sample without plotting it', () => {
    const now = Date.now();
    const session = sessionPath(dir, '-project', 'session.jsonl');
    writeUsageStore(path.join(dir, 'usage.db'), {
      messages: [
        { session, entry: 'omp-call', model: 'openai-codex/model', gateway: 'openai-codex', ts: now - 30 * MINUTE, input: 100 },
      ],
    });
    writeQuotaDb(path.join(dir, 'agent.db'), [
      { ts: now - 2 * HOUR, provider: 'openai-codex', accountKey: 'account-a', limitId: 'primary', label: 'Monthly', usedFraction: 0.2 },
      { ts: now - 30 * MINUTE, provider: 'openai-codex', accountKey: 'account-a', limitId: 'primary', label: 'Monthly', usedFraction: 0.6 },
    ]);

    const stats = readAgentStats('1h', 'providers', now);

    expect(stats.windowInsights[0].fractionConsumed).toBeCloseTo(0.4, 9);
    expect(stats.windowInsights[0].estTokensPerWindow).toBe(250);
    expect(stats.usageSeries[0].points.map((point) => point.usedFraction)).toEqual([0.6]);
  });

  test('consumer stats preserve reported cost without inventing a component split', () => {
    const now = Date.now();
    const session = sessionPath(dir, '-project', 'session.jsonl');
    writeUsageStore(path.join(dir, 'usage.db'), {
      messages: [
        {
          session,
          entry: 'priced-call',
          model: 'commandcode/priced-model',
          ts: now - 30 * MINUTE,
          input: 1_000,
          output: 500,
          cacheRead: 4_000,
          cost: 0.3,
        },
      ],
    });

    const stats = readAgentStats('all', 'costs', now);
    const mix = stats.overall.costMix;

    expect(stats.overall.costUsd).toBeCloseTo(0.3, 12);
    expect(mix).toEqual({
      input: null,
      output: null,
      cacheRead: null,
      cacheWrite: null,
      total: 0.3,
    });
    expect(stats.byModel[0].costMix).toEqual(mix);
  });
});
