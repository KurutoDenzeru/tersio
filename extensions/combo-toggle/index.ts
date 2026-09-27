// /combo session toggle — set all three (caveman, rtk, ponytail) at once.
// Modes: off | medium | balanced | max

import {
  activeModesSummary,
  COMBO_LEVELS,
  getSharedComboState,
  normalizeComboLevel,
  paintableCtx,
  reconcileSharedComboEntries,
  sessionEntries,
  setSharedComboLevel,
  setSharedComboListener,
  setSharedComboMode,
} from '../shared/session-state.ts';
import { asPromptArray, isOmpSubagentPrompt, systemPromptIncludes } from '../shared/omp-prompt.ts';
import {
  isComboSetupComplete,
  readComboDefault,
  readPonytailDefault,
  saveComboSetup,
} from '../shared/plugin-settings.ts';
import type { ComboState, ExtensionApi, ExtensionCtx, SystemPromptEvent } from '../shared/types.ts';

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
  // The bundled ponytail package used to be required out of
  // ~/.omp/plugins/node_modules — a non-literal require of a user-writable
  // path, and the only one in the codebase. The inline text is what the Pi port
  // already ships, so both ports now answer from the same place.
  return ponytailFallback(mode);
}

export default function comboToggleExtension(pi: ExtensionApi): void {
  pi.setLabel?.('Combo session toggle (all 3 add-ons)');

  let lastCtx: ExtensionCtx | undefined = undefined;
  let setupPrompted = false;
  let announced = '';
  let announcedPreset = false;

  /** The one line that carries the state the status bar used to carry. */
  function comboLine(state: Readonly<ComboState>): string {
    const modes = `🪨caveman=${state.caveman.toUpperCase()} ⚡rtk=${state.rtk.toUpperCase()} 🦥ponytail=${state.ponytail.toUpperCase()}`;
    // A preset is "on"; off and a custom mix are not, and calling a custom mix
    // "on" would claim a preset the session does not have.
    const head = state.level === 'off' || state.level === 'custom' ? state.level : `${state.level} on`;
    return `Combo ${head}: 🧩 combo ${state.level.toUpperCase()}: ${modes}`;
  }

  /**
   * Combo state goes in the conversation, not the footer.
   *
   * A permanent status row costs a line of screen for a value that only moves
   * when someone types /combo or a session starts, so it is announced once per
   * change instead. A session that starts dark, and a lone /caveman in a custom
   * mix, say nothing: those keep the sibling bars they already had.
   */
  function announce(state: Readonly<ComboState>, ctx?: ExtensionCtx): void {
    const signature = `${state.level}:${state.caveman}:${state.rtk}:${state.ponytail}`;
    if (signature === announced) return;
    const c = paintableCtx(lastCtx, ctx);
    // The bridge listener runs before the caller's own useState and carries no
    // ctx, so this is the first call on a session that has just started. Bail
    // without recording the signature, or the state is marked announced with
    // nothing shown and the caller's ctx-bearing call is deduped away.
    if (!c?.ui) return;
    const preset = state.level !== 'off' && state.level !== 'custom';
    // Moving off a preset has to be said, or the line that turned it on reads
    // as the current state. Moving within a dark session says nothing: those
    // modes keep the sibling bars they already had.
    const speak = preset || announcedPreset;
    announced = signature;
    announcedPreset = preset;
    lastCtx = c;
    // Ours, and no longer painted: clear it so a reload cannot leave the old
    // bar stranded. A module reload resets `announced`, so this runs on resume.
    c.ui.setStatus?.('combo', undefined);
    // The siblings suppress themselves while a preset is active, but a race
    // during session_start can paint one first, so clear those too.
    if (preset) {
      c.ui.setStatus?.('caveman', undefined);
      c.ui.setStatus?.('rtk', undefined);
      c.ui.setStatus?.('ponytail', undefined);
    }
    if (speak) c.ui.notify?.(comboLine(state), 'info');
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
    announce(state, ctx);
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
      // useState announces the new state; a second line here would say it twice.
      useState(setSharedComboLevel(level), ctx);
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
    // No UI yet (a pre-attach start) still counts as a state to announce, so
    // the line is not lost when the TUI attaches later.
    if (!ctx?.hasUI) announce(getSharedComboState(), ctx);
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
