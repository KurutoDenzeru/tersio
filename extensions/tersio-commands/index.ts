// /tersio unified root command — routes every tersio capability through one
// namespaced entrypoint. Aliases (/caveman, /rtk, /combo, /ai-addons) keep
// working: this router drives the same shared bridge + session entries the
// sibling extensions restore from, then reloads so their local mirrors sync
// (same mechanism /combo already uses to drive its siblings).
import {
  COMBO_LEVELS,
  activeModesSummary,
  getSharedComboState,
  normalizeComboLevel,
  normalizeMode,
  reconcileSharedComboEntries,
  sessionEntries,
  setSharedComboLevel,
  setSharedComboMode,
} from '../shared/session-state.ts';
import os from 'node:os';
import path from 'node:path';
import { appendUsage, readUsage } from '../shared/usage-ledger.ts';
import { checkAddonsSummary, runAddonUpdate } from '../ai-addons-updater/index.ts';
import type { ExtensionApi, ExtensionCtx } from '../shared/types.ts';

const HELP = [
  '/tersio caveman lite|full|ultra|wenyan|off — terse-reply mode',
  '/tersio combo off|medium|balanced|max — preset for all three modes',
  '/tersio rtk on|off — compact shell output',
  '/tersio ponytail off|lite|full|ultra|review — minimal code',
  '/tersio status — active modes + combo level',
  '/tersio check — add-on version check',
  '/tersio update <ponytail|rtk|caveman|all> [--dry-run]',
  '/tersio gain — savings summary + dashboard hint',
  '/tersio usage — ledger report for this machine',
  '/tersio help — this table',
  'aliases (still work): /caveman /rtk /combo /ai-addons',
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
    const exported = await pi.exec?.('tersio', ['dashboard', '--export', file], { cwd: ctx?.cwd });
    if (!exported || exported.code !== 0) throw new Error((exported?.stderr || 'export failed').trim());
    const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    await pi.exec?.(openCmd, [file], { cwd: ctx?.cwd });
    ctx?.ui?.notify?.(`tersio gain: dashboard opened in your browser.`, 'info');
  } catch (e) {
    ctx?.ui?.notify?.(`tersio gain: could not open dashboard (${(e as Error).message}). Run 'tersio dashboard --open' in a shell.`, 'warning');
  }
}

export default function tersioCommandsExtension(pi: ExtensionApi): void {
  pi.setLabel?.('Tersio unified root command');

  async function reload(ctx?: ExtensionCtx): Promise<void> {
    if (ctx?.reload) await ctx.reload();
  }

  pi.registerCommand?.('tersio', {
    description: 'Tersio root: caveman|combo|rtk|ponytail|status|check|update|gain|usage|help',
    handler: async (args, ctx) => {
      const parts = String(args || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
      const [sub, rest] = [parts[0], parts.slice(1).join(' ')];
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
      if (sub === 'caveman') {
        const mode = normalizeMode('caveman', rest);
        if (!mode) {
          ctx?.ui?.notify?.('Usage: /tersio caveman [lite|full|ultra|wenyan|off|status]', 'warning');
          return;
        }
        pi.appendEntry?.('caveman-mode', { mode });
        setSharedComboMode('caveman', mode);
        appendUsage('toggle', `caveman=${mode}`);
        ctx?.ui?.notify?.(`Caveman ${mode} on — Active: ${activeModesSummary(getSharedComboState())}.`, 'info');
        await reload(ctx);
        return;
      }
      if (sub === 'rtk') {
        if (!rest || rest === 'status') {
          const on = getSharedComboState().rtk === 'on';
          ctx?.ui?.notify?.(`RTK: ${on ? 'on' : 'off'}`, 'info');
          return;
        }
        if (!['on', 'off'].includes(rest)) {
          ctx?.ui?.notify?.('Usage: /tersio rtk [on|off|status]', 'warning');
          return;
        }
        const enabled = rest === 'on';
        pi.appendEntry?.('rtk-mode', { enabled });
        setSharedComboMode('rtk', enabled);
        appendUsage('toggle', `rtk=${rest}`);
        ctx?.ui?.notify?.(`RTK ${rest} — Active: ${activeModesSummary(getSharedComboState())}.`, 'info');
        await reload(ctx);
        return;
      }
      if (sub === 'ponytail') {
        const mode = normalizeMode('ponytail', rest);
        if (!mode) {
          ctx?.ui?.notify?.('Usage: /tersio ponytail [off|lite|full|ultra|review|status]', 'warning');
          return;
        }
        pi.appendEntry?.('ponytail-mode', { mode });
        setSharedComboMode('ponytail', mode);
        appendUsage('toggle', `ponytail=${mode}`);
        ctx?.ui?.notify?.(`Ponytail ${mode} — Active: ${activeModesSummary(getSharedComboState())}.`, 'info');
        await reload(ctx);
        return;
      }
      if (sub === 'combo') {
        if (!rest || rest === 'status') {
          if (ctx?.hasUI) reconcileSharedComboEntries(sessionEntries(ctx));
          ctx?.ui?.notify?.(statusLine(), 'info');
          return;
        }
        const level = normalizeComboLevel(rest);
        if (!level) {
          ctx?.ui?.notify?.('Unknown combo level. Use: off | medium | balanced | max', 'warning');
          return;
        }
        const modes = COMBO_LEVELS[level];
        pi.appendEntry?.('caveman-mode', { mode: modes.caveman });
        pi.appendEntry?.('rtk-mode', { enabled: modes.rtk === 'on' });
        pi.appendEntry?.('ponytail-mode', { mode: modes.ponytail });
        pi.appendEntry?.('combo-level', { level });
        setSharedComboLevel(level);
        appendUsage('toggle', `combo=${level}`);
        ctx?.ui?.notify?.(`Combo ${level} on — ${activeModesSummary(getSharedComboState())} active for this session.`, 'info');
        await reload(ctx);
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
      ctx?.ui?.notify?.(`Unknown subcommand: ${sub}.\n${HELP}`, 'warning');
    },
  });
}
