import {afterEach, expect, test, vi} from 'vitest';
import {runCodegraph} from '../../cli/codegraph.ts';

const { ensureInitializedAndWatching, stopWatching, readCodegraphSync } = vi.hoisted(() => ({
  ensureInitializedAndWatching: vi.fn<() => Promise<boolean>>(async () => true),
  stopWatching: vi.fn<() => Promise<void>>(async () => undefined),
  readCodegraphSync: vi.fn<() => string>(() => 'live'),
}));

vi.mock('../../extensions/codegraph/client.ts', () => ({
  ensureInitializedAndWatching,
  stopWatching,
}));
vi.mock('../../extensions/shared/plugin-settings.ts', () => ({ readCodegraphSync }));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  ensureInitializedAndWatching.mockClear();
  stopWatching.mockClear();
});

test.each(['live', '5m', '15m', '1h', 'manual'])('watch remains active until signal and cleans up in %s mode', async (mode) => {
  vi.useFakeTimers();
  readCodegraphSync.mockReturnValue(mode);
  const log = vi.spyOn(console, 'log').mockImplementation(() => { });
  const existingSigintListeners = process.listeners('SIGINT');
  const existingSigtermListeners = process.listeners('SIGTERM');
  const running = runCodegraph(['watch']);
  await Promise.resolve();

  expect(ensureInitializedAndWatching).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(1);
  expect(process.listenerCount('SIGINT')).toBe(existingSigintListeners.length + 1);
  expect(process.listenerCount('SIGTERM')).toBe(existingSigtermListeners.length + 1);
  expect(log.mock.calls.flat().join('\n')).toContain(mode === 'live' ? 'watching file events' : `sync mode: ${mode}`);
  if (mode !== 'live') expect(log.mock.calls.flat().join('\n')).not.toContain('auto-sync active');

  const onExit = process.listeners('SIGINT').find((listener) => !existingSigintListeners.includes(listener));
  expect(onExit).toBeDefined();
  onExit?.call(process, 'SIGINT');
  await running;
  expect(stopWatching).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  expect(process.listenerCount('SIGINT')).toBe(existingSigintListeners.length);
  expect(process.listenerCount('SIGTERM')).toBe(existingSigtermListeners.length);
  expect(log.mock.calls.flat().join('\n')).toContain('Watcher stopped.');
});

test('watch treats a worker terminated by SIGINT as completed shutdown', async () => {
  vi.useFakeTimers();
  stopWatching.mockRejectedValueOnce(new Error('CodeGraph worker exited (SIGINT).'));
  vi.spyOn(console, 'log').mockImplementation(() => { });
  const existingListeners = process.listeners('SIGINT');
  const running = runCodegraph(['watch']);
  await Promise.resolve();

  const onExit = process.listeners('SIGINT').find((listener) => !existingListeners.includes(listener));
  expect(onExit).toBeDefined();
  onExit?.call(process, 'SIGINT');
  await expect(running).resolves.toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
  expect(process.listeners('SIGINT')).toEqual(existingListeners);
});
