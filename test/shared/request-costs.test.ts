import {afterEach, expect, test, vi} from 'vitest';
import {statSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {readAgentStats} from '../../extensions/shared/agent-stats.ts';
import {agentStats} from '../../extensions/shared/agent-snapshot.ts';
import {cachePut} from '../../extensions/shared/cache-store.ts';
import {sessionPath, writeUsageStore} from '../helpers/omp-fixture.ts';
import {withHome} from '../helpers/env.ts';

afterEach(() => vi.unstubAllEnvs());

test('request comparisons price cache reads without inventing savings for unknown or unbilled requests', () => {
  withHome((home) => {
    const prices = path.join(home, 'prices.json');
    writeFileSync(prices, JSON.stringify({
      fetchedAt: Date.now(), exact: {
        'comparison-paid': [10, 20, 1, 12.5],
        'comparison-free': [0, 0, 0, 0],
      }
    }));
    vi.stubEnv('TERSIO_PRICES_FILE', prices);
    vi.stubEnv('TERSIO_PRICES_OVERRIDE_FILE', path.join(home, 'no-overrides.json'));
    vi.stubEnv('TERSIO_AGENT_STATS_DB', writeUsageStore(path.join(home, 'usage.db'), {
      messages: [
        { entry: 'paid', model: 'comparison-paid', cost: 0.03 },
        { entry: 'unknown', model: 'comparison-unknown', cost: 0.03 },
        { entry: 'failed', model: 'comparison-paid', cost: 0, stop: 'error' },
        { entry: 'free', model: 'comparison-free', cost: 0 },
      ].map((row) => ({ ...row, session: sessionPath(home, 'project', 'session.jsonl'), ts: Date.now(), input: 1000, output: 500, cacheRead: 10_000 })),
    }));
    vi.stubEnv('TERSIO_AGENT_SESSIONS_DB', path.join(home, 'no-agent.db'));
    const legacy = readAgentStats('all', 'requests');
    for (const row of legacy.recent) {
      delete row.savedCost;
      delete row.unoptimizedCost;
    }
    const stamp = statSync(process.env.TERSIO_AGENT_STATS_DB!);
    cachePut('dashboard.agent.v2.all-requests-0', JSON.stringify({
      stamp: `${stamp.mtimeMs}:${stamp.size}|-`,
      value: legacy,
    }));
    const requests = new Map(agentStats('all', 'requests').recent.map((row) => [row.entryId, row]));
    expect(requests.get('paid')?.costUsd).toBe(0.03);
    expect(requests.get('paid')?.savedCost).toBeCloseTo(0.09, 10);
    expect(requests.get('paid')?.unoptimizedCost).toBeCloseTo(0.12, 10);
    expect(requests.get('unknown')).toMatchObject({ savedCost: null, unoptimizedCost: null });
    expect(requests.get('failed')).toMatchObject({ savedCost: 0, unoptimizedCost: 0 });
    expect(requests.get('free')).toMatchObject({ savedCost: 0, unoptimizedCost: 0 });
  });
});
