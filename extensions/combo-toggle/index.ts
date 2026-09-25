// /combo session toggle — set all three (caveman, rtk, ponytail) at once.
// Modes: off | medium | balanced | max

import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  activeModesSummary,
  asPromptArray,
  COMBO_LEVELS,
  getSharedComboState,
  isComboPresetActive,
  isOmpSubagentPrompt,
  normalizeComboLevel,
  paintableCtx,
  reconcileSharedComboEntries,
  sessionEntries,
  setSharedComboLevel,
  setSharedComboListener,
  setSharedComboMode,
  systemPromptIncludes,
} from '../shared/session-state.ts';
import {
  isComboSetupComplete,
  readComboDefault,
  readPonytailDefault,
  saveComboSetup,
} from '../shared/plugin-settings.ts';
import type { ComboState, ExtensionApi, ExtensionCtx, SystemPromptEvent } from '../shared/types.ts';

const require = createRequire(import.meta.url);

const PONYTAIL_FALLBACK_INTENSITY: Record<string, string> = {
  lite: 'Prefer the simplest correct solution.',
};

function ponytailFallback(mode: string): string {
  const intensity = PONYTAIL_FALLBACK_INTENSITY[mode] ?? 'Use the minimum correct solution. Delete or reuse before adding.';
  return `🦥 PONYTAIL MODE ACTIVE — level: ${mode}\n${intensity} Understand the path first and fix root causes, not symptoms. Prefer the standard library and YAGNI. Avoid speculative abstractions and dependencies. Preserve correctness. Verify changed behavior.`;
}

function levelSummary(state: ComboState): string {
  return `caveman=${state.caveman} rtk=${state.rtk} ponytail=${state.ponytail}`;
}

function loadPonytailInstructions(mode: string): string {
  try {
    const installed = path.join(
      os.homedir(),
      '.omp',
      'plugins',
      'node_modules',
      '@dietrichgebert',
      'ponytail',
      'hooks',
      'ponytail-instructions.js'
    );
    const { getPonytailInstructions } = require(installed) as { getPonytailInstructions?: (mode: string) => string };
    if (typeof getPonytailInstructions === 'function') return getPonytailInstructions(mode);
  } catch { }
  return ponytailFallback(mode);
}

export default function comboToggleExtension(pi: ExtensionApi): void {
  pi.setLabel?.('Combo session toggle (all 3 add-ons)');

  let lastCtx: ExtensionCtx | undefined = undefined;
  let setupPrompted = false;

  function syncStatus(ctx?: ExtensionCtx): void {
    lastCtx = paintableCtx(lastCtx, ctx);
    const c = lastCtx;
    if (!c?.ui?.setStatus) return;
    // Single unified bar replaces the three per-extension bars while a preset is
    // active. In custom/off, the individual bars come back and combo stays clear.
    if (!isComboPresetActive()) {
      c.ui.setStatus('combo', undefined);
      return;
    }
    // Read the live bridge, not cached extension state: sibling extensions
    // reconcile it from persisted entries before this one runs.
    const state = getSharedComboState();
    const theme = c.ui.theme;
    const c0 = state.caveman.toUpperCase();
    const r = state.rtk.toUpperCase();
    const p = state.ponytail.toUpperCase();
    const lvl = state.level.toUpperCase();
    const label = `combo ${lvl}: 🪨caveman=${c0} ⚡rtk=${r} 🦥ponytail=${p}`;
    c.ui.setStatus('combo', theme?.fg ? `${theme.fg('accent', '🧩')} ${theme.fg('muted', label)}` : `🧩 ${label}`);
    // Clobber any sibling bars another extension may have painted in a race
    // during session_start — our bar is canonical for the duration of the preset.
    c.ui.setStatus('caveman', undefined);
    c.ui.setStatus('rtk', undefined);
    c.ui.setStatus('ponytail', undefined);
  }

  // ponytail: same persistence as /combo — siblings (incl. upstream ponytail)
  // restore from these entries, so the fallback must write them too or the
  // preset evaporates on resume and ponytail never activates.
  function persistPreset(level: string): void {
    const modes = COMBO_LEVELS[level];
    pi.appendEntry?.('caveman-mode', { mode: modes.caveman });
    pi.appendEntry?.('rtk-mode', { enabled: modes.rtk === 'on' });
    pi.appendEntry?.('ponytail-mode', { mode: modes.ponytail });
    pi.appendEntry?.('combo-level', { level });
  }

  function useState(state: Readonly<ComboState>, ctx?: ExtensionCtx): Readonly<ComboState> {
    syncStatus(ctx);
    return state;
  }

  function reconcile(ctx?: ExtensionCtx): Readonly<ComboState> {
    if (!ctx?.hasUI) return getSharedComboState();
    return useState(reconcileSharedComboEntries(sessionEntries(ctx)), ctx);
  }
  function listen(ctx?: ExtensionCtx): void {
    // Stable identity: the bridge set dedupes, so repeated track()/command
    // calls register once instead of stacking duplicate listeners.
    if (ctx?.hasUI) setSharedComboListener(useState);
  }

  function track(ctx?: ExtensionCtx): void {
    listen(ctx);
    if (ctx?.hasUI) reconcile(ctx);
  }

  pi.registerCommand?.('combo', {
    description: 'Toggle all 3 OMP add-ons at once. Usage: /combo <off|medium|balanced|max|status>',
    handler: async (args, ctx) => {
      listen(ctx);
      const arg = String(args || '').trim().toLowerCase();

      if (!arg || arg === 'status') {
        const state = reconcile(ctx);
        ctx?.ui?.notify?.(
          `Combo: ${state.level === 'custom' ? 'INACTIVE' : state.level.toUpperCase()} (${levelSummary(state)})`,
          'info'
        );
        return;
      }

      if (arg === 'help') {
        ctx?.ui?.notify?.(
          '/combo off      — disables all 3 (caveman, rtk, ponytail)\n' +
          '/combo medium   — light: caveman=lite, rtk=on, ponytail=lite\n' +
          '/combo balanced — middle: caveman=full, rtk=on, ponytail=full\n' +
          '/combo max      — aggressive: caveman=ultra, rtk=on, ponytail=ultra',
          'info'
        );
        return;
      }

      const level = normalizeComboLevel(arg);
      if (!level) {
        ctx?.ui?.notify?.(
          `Unknown combo level: ${arg}. Use: off | medium | balanced | max`,
          'warning'
        );
        return;
      }

      persistPreset(level);
      useState(setSharedComboLevel(level), ctx);

      const active = activeModesSummary(getSharedComboState());
      ctx?.ui?.notify?.(
        level === 'off' ? `Combo off — all tersio modes inactive for this session. Active: ${active}.` : `Combo ${level} on — ${active} active for this session.`,
        'info'
      );
    },
  });

  async function runFirstRunSetup(ctx?: ExtensionCtx): Promise<void> {
    if (setupPrompted || !ctx?.hasUI || !ctx.ui?.select || isComboSetupComplete()) return;
    setupPrompted = true;
    const choice = await ctx.ui.select('Session-start defaults — Combo preset', [
      { label: 'off', description: 'Keep every Tersio mode inactive' },
      { label: 'medium', description: 'caveman=lite, rtk=on, ponytail=lite' },
      { label: 'balanced', description: 'caveman=full, rtk=on, ponytail=full' },
      { label: 'max', description: 'caveman=ultra, rtk=on, ponytail=ultra' },
    ], { selectionMarker: 'radio', helpText: 'You can change this later with /tersio settings.' });
    const level = choice || 'off';
    if (saveComboSetup(level) && level !== 'off') {
      persistPreset(level);
      useState(setSharedComboLevel(level), ctx);
      ctx.ui.notify?.(`Combo default saved: ${level} — ${activeModesSummary(getSharedComboState())} will activate on fresh sessions.`, 'info');
    }
  }

  pi.on('session_start', async (_event, ctx) => {
    track(ctx);
    if (!ctx?.hasUI) syncStatus(ctx);
    await runFirstRunSetup(ctx);
    // Installer/user-configured default applies only when no persisted *mode*
    // state exists — unrelated session entries must not block it, or the
    // combo bar never paints on sessions that already carry other entries.
    const entries = sessionEntries(ctx);
    const hasModeState = entries.some((e) => e?.type === 'custom' && (
      e.customType === 'combo-level' || e.customType === 'caveman-mode' ||
      e.customType === 'rtk-mode' || e.customType === 'ponytail-mode'));
    if (getSharedComboState().level === 'off' && !hasModeState) {
      const fallback = readComboDefault();
      if (fallback !== 'off') {
        persistPreset(fallback);
        useState(setSharedComboLevel(fallback), ctx);
        ctx?.ui?.notify?.(`Combo default applied: ${fallback} — ${activeModesSummary(getSharedComboState())} active for this session.`, 'info');
      }
    }
    // Standalone ponytail default: no sibling extension restores it (upstream
    // owns the command), so apply it here when nothing persisted a
    // ponytail-mode entry. Skipped when it matches the active preset — the
    // preset entry already covers that, no redundant write.
    if (!entries.some((e) => e?.type === 'custom' && e.customType === 'ponytail-mode')) {
      const ponytailFallback = readPonytailDefault();
      if (ponytailFallback !== 'off' && ponytailFallback !== getSharedComboState().ponytail) {
        pi.appendEntry?.('ponytail-mode', { mode: ponytailFallback });
        useState(setSharedComboMode('ponytail', ponytailFallback), ctx);
      }
    }
  });

  for (const event of ['session_branch', 'session_tree', 'agent_start']) {
    pi.on(event, async (_event, ctx) => {
      track(ctx);
      if (event === 'agent_start') await runFirstRunSetup(ctx);
    });
  }

  pi.on<SystemPromptEvent>('before_agent_start', async (event, ctx) => {
    if (ctx?.hasUI) reconcile(ctx);
    if (!isOmpSubagentPrompt(event.systemPrompt)) return;

    const mode = getSharedComboState().ponytail;
    if (mode === 'off' || systemPromptIncludes(event.systemPrompt, 'PONYTAIL MODE ACTIVE')) return;
    const base = asPromptArray(event.systemPrompt);
    return { systemPrompt: [...base, loadPonytailInstructions(mode)] };
  });

  // Slash commands only; natural-language input caused accidental toggles and has no reload context.
}
