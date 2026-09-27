// extensions/pi/combo-toggle/index.ts — /combo for Pi: set all three
// (caveman, rtk, ponytail) at once. Modes: off | medium | balanced | max.
//
// Same state machine, commands, notifications, status-bar ownership, and combo
// coordination as extensions/combo-toggle/index.ts. Divergences, all forced by
// Pi's ExtensionAPI:
//
//   - No `pi.setLabel`. Pi's setLabel(entryId, label) names a session entry for
//     bookmarks; it has no "name this extension" equivalent, so the call is
//     dropped rather than substituted with setSessionName.
//   - No `session_branch`. Pi documents session_start and session_tree, which
//     are the two that fire when the active conversation changes, so the mode
//     restore hooks those two.
//   - `ctx.ui.select` takes `string[]`; the setup dialog folds each option's
//     description into the string itself, and Pi's `{signal, timeout}` options
//     carry no selectionMarker/helpText.
//   - The OMP port loaded the real ponytail instructions through
//     createRequire of `~/.omp/plugins/node_modules/@dietrichgebert/ponytail`.
//     That package is not part of a Pi install, so the require is gone and this
//     port uses the inline intensity text it already defined as its fallback.
//   - Prompt injection is a section write, not a returned prompt (see SECTION).

import {
  activeModesSummary,
  COMBO_LEVELS,
  getSharedComboState,
  injectPiSection,
  notify,
  normalizeComboLevel,
  paintableCtx,
  reconcileSharedComboEntries,
  sessionEntries,
  setSharedComboLevel,
  setSharedComboListener,
  setSharedComboMode,
} from '../shared/pi-session-state.ts';
import { isComboSetupComplete, readComboDefault, readPonytailDefault, saveComboSetup } from '../shared/plugin-settings.ts';
import type { ExtensionCtx, PiBeforeAgentStartEvent, PiExtensionAPI } from '../shared/pi-types.ts';
// Erased at load: this specifier is resolved by tsc against the repo layout
// only, never by Pi at runtime, so the two-level jump here cannot break the
// installed tree where extensions/shared/types.ts sits one level up.
import type { ComboState } from '../../shared/types.ts';

const PONYTAIL_FALLBACK_INTENSITY: Record<string, string> = {
  lite: 'Prefer the simplest correct solution.',
};

/** Inline intensity text. The upstream ponytail package is not installed on Pi. */
function ponytailInstructions(mode: string): string {
  const intensity = PONYTAIL_FALLBACK_INTENSITY[mode] ?? 'Use the minimum correct solution. Delete or reuse before adding.';
  return `🦥 PONYTAIL MODE ACTIVE — level: ${mode}\n${intensity} Understand the path first and fix root causes, not symptoms. Prefer the standard library and YAGNI. Avoid speculative abstractions and dependencies. Preserve correctness. Verify changed behavior.`;
}

// The bridge types its own state, so annotating this with the canonical
// `ComboState` would mean importing extensions/shared/types — a specifier that is
// correct in this repo (../../shared/) and wrong once installed (../shared/).
// The structural parameter below is the slice this reads and needs no import.
function levelSummary(state: { caveman: string; rtk: string; ponytail: string }): string {
  return `caveman=${state.caveman} rtk=${state.rtk} ponytail=${state.ponytail}`;
}

export default function comboToggleExtension(pi: PiExtensionAPI): void {
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
    if (speak) notify(c, comboLine(state));
  }

  // ponytail: same persistence as /combo — siblings restore from these entries,
  // so the preset must write them too or it evaporates on resume and ponytail
  // never activates.
  function persistPreset(level: string): void {
    const modes = COMBO_LEVELS[level];
    if (!modes) return;
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
    description: 'Toggle all 3 Tersio add-ons at once. Usage: /combo <off|medium|balanced|max|status>',
    handler: async (args, ctx) => {
      listen(ctx);
      const arg = String(args || '').trim().toLowerCase();

      if (!arg || arg === 'status') {
        const state = reconcile(ctx);
        notify(ctx, `Combo: ${state.level === 'custom' ? 'INACTIVE' : state.level.toUpperCase()} (${levelSummary(state)})`);
        return;
      }

      if (arg === 'help') {
        notify(ctx,
          '/combo off      — disables all 3 (caveman, rtk, ponytail)\n' +
          '/combo medium   — light: caveman=lite, rtk=on, ponytail=lite\n' +
          '/combo balanced — middle: caveman=full, rtk=on, ponytail=full\n' +
          '/combo max      — aggressive: caveman=ultra, rtk=on, ponytail=ultra');
        return;
      }

      const level = normalizeComboLevel(arg);
      if (!level) {
        notify(ctx, `Unknown combo level: ${arg}. Use: off | medium | balanced | max`, 'warning');
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
    // Pi's select takes plain strings, so each row carries its own description;
    // `selectionMarker` and `helpText` are not in Pi's dialog options.
    const choice = await ctx.ui.select('Session-start defaults — Combo preset', [
      'off — keep every Tersio mode inactive',
      'medium — caveman=lite, rtk=on, ponytail=lite',
      'balanced — caveman=full, rtk=on, ponytail=full',
      'max — caveman=ultra, rtk=on, ponytail=ultra',
    ]);
    // The row is "<level> — <detail>"; saveComboSetup validates the level.
    const level = normalizeComboLevel(choice?.split(' ')[0]) || 'off';
    if (saveComboSetup(level) && level !== 'off') {
      persistPreset(level);
      useState(setSharedComboLevel(level), ctx);
      notify(ctx, `Combo default saved: ${level} — ${activeModesSummary(getSharedComboState())} will activate on fresh sessions.`);
    }
  }

  pi.on?.('session_start', async (_event, ctx) => {
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
    // Standalone ponytail default: no sibling extension restores it (on OMP
    // upstream owns the command; on Pi this file is the only writer), so apply
    // it here when nothing persisted a ponytail-mode entry. Skipped when it
    // matches the active preset — the preset entry already covers that.
    if (!entries.some((e) => e?.type === 'custom' && e.customType === 'ponytail-mode')) {
      const ponytailDefault = readPonytailDefault();
      if (ponytailDefault !== 'off' && ponytailDefault !== getSharedComboState().ponytail) {
        pi.appendEntry?.('ponytail-mode', { mode: ponytailDefault });
        useState(setSharedComboMode('ponytail', ponytailDefault), ctx);
      }
    }
  });

  // `session_branch` does not exist on Pi; session_tree is the other event that
  // fires when the active conversation changes.
  for (const event of ['session_tree', 'agent_start']) {
    pi.on?.(event, async (_event, ctx) => {
      track(ctx);
      if (event === 'agent_start') await runFirstRunSetup(ctx);
    });
  }

  // Sealed section name: Pi requires lowercase alphanumerics, dashes, and
  // underscores, and wraps every non-empty section in matching XML tags. No
  // other extension owns it, and the OMP subagent gate is gone: upstream
  // ponytail does not exist on Pi, so this is the only ponytail channel and a
  // delegated agent reads the same shared bridge anyway.
  const SECTION = 'tersio-ponytail';

  // `pi.on` is typed `(event: string, handler: (event: unknown, …) => …)` in
  // the Pi subset, so the handler takes the event as unknown and narrows it.
  pi.on?.('before_agent_start', (event, ctx) => {
    if (ctx?.hasUI) reconcile(ctx);
    const mode = getSharedComboState().ponytail;
    // Falsy content is omitted by Pi, so '' is how the mode switches off.
    injectPiSection(event as PiBeforeAgentStartEvent, SECTION, mode === 'off' ? '' : ponytailInstructions(mode));
  });
}
