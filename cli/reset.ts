// cli/reset.ts — clear tersio-owned statistics: the usage ledger plus a reset
// watermark that filters session-derived and RTK-metered rows out of every
// derived view. Session transcripts (~/.omp/agent/sessions) and the RTK
// database are host/tool-owned and are never touched; the watermark only
// changes what tersio shows.
import { cancel as clackCancel, confirm as clackConfirm } from '@clack/prompts';
import { dryRun, yes } from './common.ts';
import { ask, closeRL, tty } from './interactive.ts';
import { clearUsageLedger, importSessionTokens, ledgerPath, markReset, readUsage, sessionsDir } from '../extensions/shared/usage-ledger.ts';
import { readRtkGain, rtkDbPath } from '../extensions/shared/rtk-gain.ts';

async function runReset(): Promise<boolean> {
  console.log('\n=== Tersio Reset ===\n');
  const rows = readUsage().length;
  const sessions = importSessionTokens();
  const rtk = readRtkGain(1);
  console.log(`Will clear: ${rows} usage ledger rows · ${ledgerPath()}`);
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
  if (!yes) {
    if (tty()) {
      closeRL();
      const confirmedChoice = await clackConfirm({ message: 'Clear tersio statistics?', initialValue: false });
      if (typeof confirmedChoice !== 'boolean') {
        clackCancel('Aborted.');
        closeRL();
        return false;
      }
      if (!confirmedChoice) {
        console.log('Aborted.');
        closeRL();
        return false;
      }
    } else {
      const answer = await ask('\nProceed? [y/N]: ');
      if (!answer.toLowerCase().startsWith('y')) {
        console.log('Aborted.');
        closeRL();
        return false;
      }
    }
  }
  const cleared = clearUsageLedger();
  const ts = markReset();
  console.log(`[ok] reset — removed ${cleared} usage rows; statistics view starts at ${new Date(ts).toISOString()}`);
  return true;
}

export { runReset };
