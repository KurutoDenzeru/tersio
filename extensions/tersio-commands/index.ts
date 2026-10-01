// Root command plus mode switches; sibling mirrors sync with no reload.
import {

  reconcileSharedComboEntries,
  sessionEntries,
} from '../shared/session-state.ts';
import { announceStatus } from '../shared/status.ts';
import { setExtensionLabel } from '../shared/host.ts';
import os from 'node:os';
import path from 'node:path';
import { appendUsage, readUsage } from '../shared/usage-ledger.ts';
import { checkAddonsSummary, runAddonUpdate } from '../ai-addons-updater/index.ts';
import type { ExtensionApi, ExtensionCtx } from '../shared/types.ts';

const HELP = [
  '/tersio status — active modes + combo level',
  '/tersio check — add-on version check',
  '/tersio update <ponytail|rtk|caveman|all> [--dry-run]',
  '/tersio dashboard — open the Dashboard',
  '/tersio usage — ledger report for this machine',
  '/tersio help — this table',
  'mode switches: /caveman /rtk /combo (tersio) + /ponytail (upstream)',
].join('\n');


function usageSummary(): string {
  const rows = readUsage();
  if (rows.length === 0) return 'tersio usage: no ledger yet — run commands first.';
  const byKind: Record<string, number> = {};
  for (const r of rows) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
  const parts = Object.entries(byKind).map(([k, n]) => `${k}×${n}`);
  const last = new Date(rows[rows.length - 1].ts).toISOString();
  return `tersio usage: ${rows.length} rows (${parts.join(', ')}), last write ${last}.`;
}

async function openDashboard(pi: ExtensionApi, ctx?: ExtensionCtx): Promise<void> {
  const file = path.join(os.tmpdir(), `tersio-dashboard-${Date.now()}.html`);
  try {
    const exported = await pi.exec?.('tersio', ['dashboard', '--export', file], { cwd: ctx?.cwd });
    if (!exported || exported.code !== 0) throw new Error((exported?.stderr || 'export failed').trim());
    const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    await pi.exec?.(openCmd, [file], { cwd: ctx?.cwd });
    ctx?.ui?.notify?.(`tersio dashboard: opened in your browser.`, 'info');
  } catch (e) {
    ctx?.ui?.notify?.(`tersio dashboard: could not open (${(e as Error).message}). Run 'tersio dashboard --open' in a shell.`, 'warning');
  }
}

export default function tersioCommandsExtension(pi: ExtensionApi): void {
  setExtensionLabel(pi, 'Tersio unified root command');


  pi.registerCommand?.('tersio', {
    description: 'Tersio root: status|check|update|dashboard|usage|help',
    handler: async (args, ctx) => {
      const parts = String(args || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
      const [sub] = [parts[0]];
      appendUsage('command', `/tersio ${parts.join(' ')}`.trim());

      if (!sub || sub === 'status') {
        if (ctx?.hasUI) reconcileSharedComboEntries(sessionEntries(ctx));
        announceStatus(ctx, { value: '' });
        return;
      }
      if (sub === 'help') {
        ctx?.ui?.notify?.(HELP, 'info');
        return;
      }
      if (sub === 'check') {
        await checkAddonsSummary(ctx);
        return;
      }
      if (sub === 'update') {
        const dryRun = parts.includes('--dry-run');
        const target = parts.filter((p) => p !== '--dry-run' && p !== 'update' && p !== 'tersio').join(' ');
        if (!target) {
          ctx?.ui?.notify?.('Usage: /tersio update <ponytail|rtk|caveman|all> [--dry-run]', 'warning');
          return;
        }
        await runAddonUpdate(pi, ctx, target, dryRun);
        return;
      }
      if (sub === 'dashboard') {
        await openDashboard(pi, ctx);
        return;
      }
      if (sub === 'usage') {
        ctx?.ui?.notify?.(usageSummary(), 'info');
        return;
      }
      // Removed mode switches redirect to their own commands so only one
      // spelling exists to learn: /caveman, /rtk, /combo, /ponytail.
      if (sub === 'caveman' || sub === 'rtk' || sub === 'combo' || sub === 'ponytail') {
        ctx?.ui?.notify?.(`Use /${sub} instead — /tersio no longer duplicates mode switches.\n${HELP}`, 'warning');
        return;
      }
      ctx?.ui?.notify?.(`Unknown subcommand: ${sub}.\n${HELP}`, 'warning');
    },
  });
}
