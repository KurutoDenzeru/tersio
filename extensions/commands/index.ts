// Root command plus mode switches; sibling mirrors sync with no reload.
import { reconcileSharedComboEntries, sessionEntries } from '../shared/session-state.ts';
import { announceStatus, bindStatusHost } from '../shared/status.ts';
import { hostIdOf, setExtensionLabel } from '../shared/host.ts';
import { readStatusVisible, saveStatusVisible } from '../shared/plugin-settings.ts';
import os from 'node:os';
import path from 'node:path';
import { appendUsage } from '../shared/usage-ledger.ts';
import { runAddonUpdate } from '../shared/updater.ts';
import { openCommand } from '../shared/utils.ts';
import type { ExtensionApi, ExtensionCtx } from '../shared/types.ts';

const HELP = [
  '/tersio status [on|off|toggle] — show state; on/off/toggle sets the footer line and saves it as default',
  '/tersio update <ponytail|rtk|caveman|all> [--dry-run]',
  '/tersio dashboard — open the Dashboard',
  '/tersio help — this table',
  'mode switches: /caveman /rtk /combo (tersio) + /ponytail (upstream) + /headroom',
].join('\n');

async function openScorecard(pi: ExtensionApi, ctx?: ExtensionCtx, offline = false): Promise<void> {
  try {
    const run = await pi.exec?.('tersio', ['upstream', '--json', ...(offline ? ['--offline'] : [])], { cwd: ctx?.cwd });
    if (!run) throw new Error('this host cannot run tersio');
    const card = JSON.parse(run.stdout) as {
      accuracy?: number;
      drift?: number;
      sources?: Array<{ source: string; matched: number; tracked: number; drift: number; added: number }>;
      hosts?: Array<{
        host: string;
        installed: boolean;
        matched: number;
        files: number;
        stale: number;
        missing: number;
      }>;
    };
    const lines = [`tersio upstream: ${card.accuracy ?? '?'}% accurate · ${card.drift ?? 0} upstream file(s) drifted`];
    for (const s of card.sources ?? [])
      lines.push(
        `${s.source}: ${s.matched}/${s.tracked} match · drift ${s.drift}${s.added ? ` · +${s.added} new` : ''}`,
      );
    for (const h of card.hosts ?? []) {
      if (h.installed)
        lines.push(
          `${h.host}: ${h.matched}/${h.files} files${h.stale || h.missing ? ` · ${h.stale} stale, ${h.missing} missing` : ''}`,
        );
    }
    ctx?.ui?.notify?.(
      lines.join('\n'),
      card.hosts?.some((h) => h.installed && (h.stale > 0 || h.missing > 0)) ? 'warning' : 'info',
    );
  } catch (e) {
    ctx?.ui?.notify?.(
      `tersio upstream: could not read the scorecard (${(e as Error).message}). Run 'tersio upstream' in a shell.`,
      'warning',
    );
  }
}

async function openDashboard(pi: ExtensionApi, ctx?: ExtensionCtx): Promise<void> {
  const file = path.join(os.tmpdir(), `tersio-dashboard-${Date.now()}.html`);
  try {
    const exported = await pi.exec?.('tersio', ['dashboard', '--export', file], { cwd: ctx?.cwd });
    if (!exported || exported.code !== 0) throw new Error((exported?.stderr || 'export failed').trim());
    const [openCmd, openArgs] = openCommand(file);
    await pi.exec?.(openCmd, openArgs, { cwd: ctx?.cwd });
    ctx?.ui?.notify?.(`tersio dashboard: opened in your browser.`, 'info');
  } catch (e) {
    ctx?.ui?.notify?.(
      `tersio dashboard: could not open (${(e as Error).message}). Run 'tersio dashboard --open' in a shell.`,
      'warning',
    );
  }
}

export default function tersioCommandsExtension(pi: ExtensionApi): void {
  setExtensionLabel(pi, 'Tersio unified root command');

  pi.registerCommand?.('tersio', {
    description: 'Tersio root: status|update|dashboard|help',
    handler: async (args, ctx) => {
      const parts = String(args || '')
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
      const [sub] = [parts[0]];
      appendUsage('command', `/tersio ${parts.join(' ')}`.trim());

      if (!sub || sub === 'status') {
        const arg = parts[1];
        if (arg === 'on' || arg === 'off' || arg === 'toggle') {
          const host = hostIdOf(pi);
          const next = arg === 'toggle' ? !readStatusVisible(host) : arg === 'on';
          if (!saveStatusVisible(host, next)) {
            ctx?.ui?.notify?.('Could not save the status setting.', 'warning');
            return;
          }
          bindStatusHost(host);
          announceStatus(ctx);
          ctx?.ui?.notify?.(`Status line ${next ? 'shown' : 'hidden'} (saved as default for ${host}).`, 'info');
          return;
        }
        if (ctx?.hasUI) reconcileSharedComboEntries(sessionEntries(ctx));
        announceStatus(ctx);
        return;
      }
      if (sub === 'help') {
        ctx?.ui?.notify?.(HELP, 'info');
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
      if (sub === 'upstream') {
        await openScorecard(pi, ctx, parts.includes('--offline'));
        return;
      }
      // Removed mode switches redirect to their own commands, so there is one spelling: /caveman, /rtk, /combo, /ponytail, /headroom.
      if (sub === 'caveman' || sub === 'rtk' || sub === 'combo' || sub === 'ponytail' || sub === 'headroom') {
        ctx?.ui?.notify?.(`Use /${sub} instead — /tersio no longer duplicates mode switches.\n${HELP}`, 'warning');
        return;
      }
      ctx?.ui?.notify?.(`Unknown subcommand: ${sub}.\n${HELP}`, 'warning');
    },
  });
}
