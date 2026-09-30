// /combo session toggle: off | medium | balanced | max.

import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  activeModesSummary,
  COMBO_LEVELS,
  getSharedComboState,
  isComboPresetActive,
  isOmpSubagentPrompt,
  normalizeComboLevel,
  paintableCtx,
  reconcileSharedComboEntries,
  sessionEntries,
  setSharedComboLevel,
  statusUi,
  setSharedComboListener,
  setSharedComboMode,
  systemPromptIncludes,
  themeStatus,
} from '../shared/session-state.ts';
import { hostSelect, injectPromptText, onHostEvent, setExtensionLabel } from '../shared/host.ts';
import {
  isComboSetupComplete,
  readComboDefault,
  readPonytailDefault,
  saveComboSetup,
} from '../shared/plugin-settings.ts';
import { findHoistedPackage } from '../lib/utils.ts';
import type { ComboState, ExtensionApi, ExtensionCtx, SystemPromptEvent } from '../shared/types.ts';

const EXTENSION_DIR = path.dirname(fileURLToPath(import.meta.url));

const PONYTAIL_FALLBACK_INTENSITY: Record<string, string> = {
  lite: 'Prefer the simplest correct solution.',
};

// Fallback text when Ponytail cannot be found; exported for its own test.
export function ponytailFallback(mode: string): string {
  const intensity = PONYTAIL_FALLBACK_INTENSITY[mode] ?? 'Use the minimum correct solution. Delete or reuse before adding.';
  return `🦥 PONYTAIL MODE ACTIVE — level: ${mode}\n${intensity} Understand the path first and fix root causes, not symptoms. Prefer the standard library and YAGNI. Avoid speculative abstractions and dependencies. Preserve correctness. Verify changed behavior.`;
}

function levelSummary(state: ComboState): string {
  return `caveman=${state.caveman} rtk=${state.rtk} ponytail=${state.ponytail}`;
}

// Ponytail is hoisted, so one upward walk covers every install layout. The hook
// is CommonJS, so both namespace shapes are tried.
async function loadPonytailInstructions(mode: string): Promise<string> {
  const installed = findHoistedPackage('@dietrichgebert/ponytail', EXTENSION_DIR, 'hooks', 'ponytail-instructions.js');
  if (installed) {
    try {
      const loaded = await import(pathToFileURL(installed).href) as {
        getPonytailInstructions?: (level: string) => string;
        default?: { getPonytailInstructions?: (level: string) => string };
      };
      const build = loaded.getPonytailInstructions ?? loaded.default?.getPonytailInstructions;
      if (build) return build(mode);
    } catch { /* fall through to the built-in text */ }
  }
  return ponytailFallback(mode);
}

export default function comboToggleExtension(pi: ExtensionApi): void {
  setExtensionLabel(pi, 'Combo session toggle (all 3 add-ons)');

  let lastCtx: ExtensionCtx | undefined = undefined;
  let setupPrompted = false;

  function syncStatus(ctx?: ExtensionCtx): void {
    lastCtx = paintableCtx(lastCtx, ctx);
    const ui = statusUi(lastCtx);
    if (!ui) return;
    // One unified bar replaces the per-extension bars while a preset is active.
    if (!isComboPresetActive()) {
      ui.setStatus('combo', undefined);
      return;
    }
    // Read the live bridge, not a cache: siblings reconcile it first.
    const state = getSharedComboState();
    const c0 = state.caveman.toUpperCase();
    const r = state.rtk.toUpperCase();
    const p = state.ponytail.toUpperCase();
    const lvl = state.level.toUpperCase();
    ui.setStatus('combo', themeStatus(ui, '🧩', `combo ${lvl}: 🪨caveman=${c0} ⚡rtk=${r} 🦥ponytail=${p}`, true));
    // Our bar is canonical for the preset, so clear any sibling bar.
    ui.setStatus('caveman', undefined);
    ui.setStatus('rtk', undefined);
    ui.setStatus('ponytail', undefined);
  }

  // Siblings restore from these entries, so the fallback must write them too.
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
    // Stable identity: the bridge set dedupes, so repeat calls register once.
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
    const choice = await hostSelect(pi, ctx.ui, 'Session-start defaults — Combo preset', [
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
    // The configured default applies only when no persisted mode state exists.
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
    // No sibling restores a standalone ponytail default, so apply it here; skip
    // it when the active preset already writes the same mode.
    if (!entries.some((e) => e?.type === 'custom' && e.customType === 'ponytail-mode')) {
      const ponytailFallback = readPonytailDefault();
      if (ponytailFallback !== 'off' && ponytailFallback !== getSharedComboState().ponytail) {
        pi.appendEntry?.('ponytail-mode', { mode: ponytailFallback });
        useState(setSharedComboMode('ponytail', ponytailFallback), ctx);
      }
    }
  });

  for (const event of ['session_branch', 'session_tree', 'agent_start']) {
    onHostEvent(pi, event, async (_event, ctx) => {
      track(ctx);
      if (event === 'agent_start') await runFirstRunSetup(ctx);
    });
  }

  pi.on<SystemPromptEvent>('before_agent_start', async (event, ctx) => {
    if (ctx?.hasUI) reconcile(ctx);
    if (!isOmpSubagentPrompt(event.systemPrompt)) return;

    const mode = getSharedComboState().ponytail;
    if (mode === 'off' || systemPromptIncludes(event.systemPrompt, 'PONYTAIL MODE ACTIVE')) return;
    const instructions = await loadPonytailInstructions(mode);
    return injectPromptText(pi, event, instructions);
  });

  // Slash commands only; natural-language input caused accidental toggles and has no reload context.
}
