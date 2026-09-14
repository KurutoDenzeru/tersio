// /tersio root command — status, check, update, gain, usage, help.
// Mode switches live on their own commands (/caveman, /rtk, /combo, and the
// upstream /ponytail): the router keeps no redundant copies. Shared-state
// publishes sync sibling mirrors live, so switches notify and take effect
// next turn — no reload.
import {
  getSharedComboState,
  reconcileSharedComboEntries,
  sessionEntries,
} from '../shared/session-state.ts';
import os from 'node:os';
import path from 'node:path';
import { appendUsage, readUsage } from '../shared/usage-ledger.ts';
import { checkAddonsSummary, runAddonUpdate } from '../ai-addons-updater/index.ts';
import type { ExtensionApi, ExtensionCtx } from '../shared/types.ts';

const HELP = [
  '/tersio status — active modes + combo level',
  '/tersio check — add-on version check',
  '/tersio update <ponytail|rtk|caveman|all> [--dry-run]',
  '/tersio gain — savings summary + dashboard hint',
  '/tersio usage — ledger report for this machine',
  '/tersio help — this table',
  'mode switches: /caveman /rtk /combo (tersio) + /ponytail (upstream)',
].join('\n');

function statusLine(): string {
  const s = getSharedComboState();
  const level = s.level === 'custom' ? 'INACTIVE' : s.level.toUpperCase();
  return `tersio — caveman=${s.caveman.toUpperCase()} · rtk=${s.rtk.toUpperCase()} · ponytail=${s.ponytail.toUpperCase()} (combo ${level})`;
}

function usageSummary(): string {
  const rows = readUsage();
  if (rows.length === 0) return 'tersio usage: no ledger yet — run commands first.';
  const byKind: Record<string, number> = {};
  for (const r of rows) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
  const parts = Object.entries(byKind).map(([k, n]) => `${k}×${n}`);
  const last = new Date(rows[rows.length - 1].ts).toISOString();
  return `tersio usage: ${rows.length} rows (${parts.join(', ')}), last write ${last}.`;
}

// Gain opens instantaneously in the default browser: export a file://-ready
// snapshot (data inlined, no server to babysit) and open it. Falls back to
// the shell command when export or open fails.
async function openGainDashboard(pi: ExtensionApi, ctx?: ExtensionCtx): Promise<void> {
  const file = path.join(os.tmpdir(), `tersio-gain-${Date.now()}.html`);
  try {
    const exported = await pi.exec?.('tersio', ['gain', '--export', file], { cwd: ctx?.cwd });
    if (!exported || exported.code !== 0) throw new Error((exported?.stderr || 'export failed').trim());
    const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    await pi.exec?.(openCmd, [file], { cwd: ctx?.cwd });
    ctx?.ui?.notify?.(`tersio gain: dashboard opened in your browser.`, 'info');
  } catch (e) {
    ctx?.ui?.notify?.(`tersio gain: could not open dashboard (${(e as Error).message}). Run 'tersio gain --open' in a shell.`, 'warning');
  }
}

export default function tersioCommandsExtension(pi: ExtensionApi): void {
  pi.setLabel?.('Tersio unified root command');


  pi.registerCommand?.('tersio', {
    description: 'Tersio root: status|check|update|gain|usage|help (modes: /caveman /rtk /combo /ponytail)',
    handler: async (args, ctx) => {
      const parts = String(args || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
      const [sub] = [parts[0]];
      appendUsage('command', `/tersio ${parts.join(' ')}`.trim());

      if (!sub || sub === 'status') {
        if (ctx?.hasUI) reconcileSharedComboEntries(sessionEntries(ctx));
        ctx?.ui?.notify?.(statusLine(), 'info');
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
      if (sub === 'gain') {
        await openGainDashboard(pi, ctx);
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
