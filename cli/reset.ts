// cli/reset.ts — clear tersio-owned statistics: the usage ledger plus a reset
// watermark that filters session-derived and RTK-metered rows out of every
// derived view. Transcripts and the RTK database are never touched.
import { dryRun, yes } from './common.ts';
import { confirmDestructive } from './interactive.ts';
import { clearUsageLedger, importSessionTokens, ledgerPath, markReset, readUsage, sessionsDir } from '../extensions/shared/usage-ledger.ts';
import { clearUsageDb, usageDbPath } from '../extensions/shared/usage-store.ts';
import { readRtkGain, rtkDbPath } from '../extensions/shared/rtk-gain.ts';

async function runReset(): Promise<boolean> {
  console.log('\n=== Tersio Reset ===\n');
  const rows = readUsage().length;
  const sessions = importSessionTokens();
  const rtk = readRtkGain(1);
  console.log(`Will clear: ${rows} usage ledger rows · ${ledgerPath()} + usage.db ${usageDbPath()}`);
  console.log(`Will hide (view-level watermark): session-derived statistics (${sessions.messages} messages) · RTK metered rows (${rtk.commands})`);
  console.log(`Left intact on disk: sessions ${sessionsDir()}, rtk ${rtkDbPath()}`);

  if (dryRun) {
    console.log('[dry-run] nothing written.');
    return true;
  }
  if (rows === 0 && sessions.messages === 0 && rtk.commands === 0) {
    console.log('Nothing to reset — no statistics recorded.');
    return true;
  }
  if (!yes && !(await confirmDestructive('Clear tersio statistics?'))) return false;

  const cleared = clearUsageLedger();
  const dbCleared = clearUsageDb();
  const ts = markReset();
  console.log(`[ok] reset — removed ${cleared} usage rows${dbCleared ? ' + usage.db' : ''}; statistics view starts at ${new Date(ts).toISOString()}`);
  return true;
}

export { runReset };
