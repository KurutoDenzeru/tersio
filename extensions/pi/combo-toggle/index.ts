// /combo for Pi: set caveman, rtk and ponytail at once.

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
// Type-only: erased at load, so the repo-only two-level jump never has to resolve in the installed tree.

const PONYTAIL_FALLBACK_INTENSITY: Record<string, string> = {
  lite: 'Prefer the simplest correct solution.',
};

// Inline intensity text. The upstream ponytail package is not installed on Pi.
function ponytailInstructions(mode: string): string {
  const intensity = PONYTAIL_FALLBACK_INTENSITY[mode] ?? 'Use the minimum correct solution. Delete or reuse before adding.';
  return `🦥 PONYTAIL MODE ACTIVE — level: ${mode}\n${intensity} Understand the path first and fix root causes, not symptoms. Prefer the standard library and YAGNI. Avoid speculative abstractions and dependencies. Preserve correctness. Verify changed behavior.`;
}

// Structural, not the canonical ComboState: that would need a repo-only import.
type ComboStateSlice = Readonly<{ level: string; caveman: string; rtk: string; ponytail: string }>;
function levelSummary(state: { caveman: string; rtk: string; ponytail: string }): string {
  return `caveman=${state.caveman} rtk=${state.rtk} ponytail=${state.ponytail}`;
}

export default function comboToggleExtension(pi: PiExtensionAPI): void {
  let lastCtx: ExtensionCtx | undefined = undefined;
  let setupPrompted = false;
  let announced = '';
  let announcedPreset = false;

  // The one line that carries the state the status bar used to carry.
  function comboLine(state: ComboStateSlice): string {
    const modes = `🪨caveman=${state.caveman.toUpperCase()} ⚡rtk=${state.rtk.toUpperCase()} 🦥ponytail=${state.ponytail.toUpperCase()}`;
    const head = state.level === 'off' || state.level === 'custom' ? state.level : `${state.level} on`;
    return `Combo ${head}: 🧩 combo ${state.level.toUpperCase()}: ${modes}`;
  }

  // Announced per change, not painted: the value only moves on /combo or session_start.
  function announce(state: ComboStateSlice, ctx?: ExtensionCtx): void {
    const signature = `${state.level}:${state.caveman}:${state.rtk}:${state.ponytail}`;
    if (signature === announced) return;
    const c = paintableCtx(lastCtx, ctx);
    // The bridge listener carries no ctx, so bailing without recording the signature keeps the caller's ctx-bearing call from...
    if (!c?.ui) return;
    const preset = state.level !== 'off' && state.level !== 'custom';
    // Leaving a preset is said, so the line that turned it on does not read as current state.
    const speak = preset || announcedPreset;
    announced = signature;
    announcedPreset = preset;
    lastCtx = c;
    c.ui.setStatus?.('combo', undefined);
    // A sibling can paint first during session_start, so clear those too.
    if (preset) {
      c.ui.setStatus?.('caveman', undefined);
      c.ui.setStatus?.('rtk', undefined);
      c.ui.setStatus?.('ponytail', undefined);
    }
    if (speak) notify(c, comboLine(state));
  }

  // The siblings restore from these entries, so a preset that did not write them would evaporate on resume.
  function persistPreset(level: string): void {
    const modes = COMBO_LEVELS[level];
    if (!modes) return;
    pi.appendEntry?.('caveman-mode', { mode: modes.caveman });
    pi.appendEntry?.('rtk-mode', { enabled: modes.rtk === 'on' });
    pi.appendEntry?.('ponytail-mode', { mode: modes.ponytail });
    pi.appendEntry?.('combo-level', { level });
  }

  function useState(state: ComboStateSlice, ctx?: ExtensionCtx): ComboStateSlice {
    announce(state, ctx);
    return state;
  }

  function reconcile(ctx?: ExtensionCtx): ComboStateSlice {
    if (!ctx?.hasUI) return getSharedComboState();
    return useState(reconcileSharedComboEntries(sessionEntries(ctx)), ctx);
  }

  function listen(ctx?: ExtensionCtx): void {
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
      useState(setSharedComboLevel(level), ctx);
    },
  });

  async function runFirstRunSetup(ctx?: ExtensionCtx): Promise<void> {
    if (setupPrompted || !ctx?.hasUI || !ctx.ui?.select || isComboSetupComplete()) return;
    setupPrompted = true;
    const choice = await ctx.ui.select('Session-start defaults — Combo preset', [
      'off — keep every Tersio mode inactive',
      'medium — caveman=lite, rtk=on, ponytail=lite',
      'balanced — caveman=full, rtk=on, ponytail=full',
      'max — caveman=ultra, rtk=on, ponytail=ultra',
    ]);
    const level = normalizeComboLevel(choice?.split(' ')[0]) || 'off';
    if (saveComboSetup(level) && level !== 'off') {
      persistPreset(level);
      useState(setSharedComboLevel(level), ctx);
      notify(ctx, `Combo default saved: ${level} — ${activeModesSummary(getSharedComboState())} will activate on fresh sessions.`);
    }
  }

  pi.on?.('session_start', async (_event, ctx) => {
    track(ctx);
    if (!ctx?.hasUI) announce(getSharedComboState(), ctx);
    await runFirstRunSetup(ctx);
    // The configured default applies only when no mode state was persisted; unrelated entries must not block it.
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
    // This file is the only writer of ponytail-mode on Pi, so it applies the standalone default when nothing persisted one.
    if (!entries.some((e) => e?.type === 'custom' && e.customType === 'ponytail-mode')) {
      const ponytailDefault = readPonytailDefault();
      if (ponytailDefault !== 'off' && ponytailDefault !== getSharedComboState().ponytail) {
        pi.appendEntry?.('ponytail-mode', { mode: ponytailDefault });
        useState(setSharedComboMode('ponytail', ponytailDefault), ctx);
      }
    }
  });

  // session_tree is Pi's other "active conversation changed" event.
  for (const event of ['session_tree', 'agent_start']) {
    pi.on?.(event, async (_event, ctx) => {
      track(ctx);
      if (event === 'agent_start') await runFirstRunSetup(ctx);
    });
  }

  // Sealed section: no other extension owns it, and there is no subagent gate — a delegated agent reads the same shared...
  const SECTION = 'tersio-ponytail';

  pi.on?.('before_agent_start', (event, ctx) => {
    if (ctx?.hasUI) reconcile(ctx);
    const mode = getSharedComboState().ponytail;
    injectPiSection(event as PiBeforeAgentStartEvent, SECTION, mode === 'off' ? '' : ponytailInstructions(mode));
  });
}
