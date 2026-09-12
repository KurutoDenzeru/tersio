// cli/reset.ts — clear tersio-owned statistics (usage ledger).
// Session transcripts (~/.omp/agent/sessions) and the RTK database are
// host/tool-owned and are never touched; doctor shows where they live.
import { cancel as clackCancel, confirm as clackConfirm } from '@clack/prompts';
import { dryRun, yes } from './common.ts';
import { ask, closeRL, tty } from './interactive.ts';
import { clearUsageLedger, ledgerPath, readUsage } from '../extensions/shared/usage-ledger.ts';
import { sessionsDir } from '../extensions/shared/usage-ledger.ts';
import { rtkDbPath } from '../extensions/shared/rtk-gain.ts';

async function runReset(): Promise<boolean> {
  console.log('\n=== Tersio Reset ===\n');
  const rows = readUsage().length;
  console.log(`Will remove: ${rows} usage rows · ${ledgerPath()}`);
  console.log(`Left intact: sessions ${sessionsDir()}, rtk ${rtkDbPath()}`);

  if (dryRun) {
    console.log('[dry-run] ledger kept.');
    return true;
  }
  if (rows === 0) {
    console.log('Nothing to reset — usage ledger is already empty.');
    return true;
  }
  if (!yes) {
    if (tty()) {
      closeRL();
      const confirmedChoice = await clackConfirm({ message: 'Clear the usage ledger?', initialValue: false });
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
  console.log(`[ok] reset — removed ${cleared} usage rows`);
  return true;
}

export { runReset };
