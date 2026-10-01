// /combo session toggle: off | medium | balanced | max.

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  activeModesSummary,
  COMBO_LEVELS,
  getSharedComboState,
  hasModeState,
  normalizeComboLevel,
  reconcileSharedComboEntries,
  sessionEntries,
  setSharedComboLevel,
  setSharedComboListener,
  setSharedComboMode,
  systemPromptIncludes,
} from '../shared/session-state.ts';
import { hostSelect, injectPromptText, onHostEvent, setExtensionLabel } from '../shared/host.ts';
import { announceStatus } from '../shared/status.ts';
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

  let setupPrompted = false;
  let lastInjected: string | undefined = undefined;
  const lastStatus = { value: '' };


  // Siblings restore from these entries, so the fallback must write them too.
  function persistPreset(level: string): void {
    const modes = COMBO_LEVELS[level];
    pi.appendEntry?.('caveman-mode', { mode: modes.caveman });
    pi.appendEntry?.('rtk-mode', { enabled: modes.rtk === 'on' });
    pi.appendEntry?.('ponytail-mode', { mode: modes.ponytail });
    pi.appendEntry?.('combo-level', { level });
  }

  // Silent: the caller decides when to show the line.
  function useState(state: Readonly<ComboState>): Readonly<ComboState> {
    return state;
  }

  function reconcile(ctx?: ExtensionCtx): Readonly<ComboState> {
    if (!ctx?.hasUI) return getSharedComboState();
    return useState(reconcileSharedComboEntries(sessionEntries(ctx)));
  }
  function listen(ctx?: ExtensionCtx): void {
    if (!ctx?.hasUI) return;
    setSharedComboListener('combo', (state) => { announceStatus(ctx, lastStatus); return state; });
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
        reconcile(ctx);
        announceStatus(ctx, { value: '' });
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
      useState(setSharedComboLevel(level));
      announceStatus(ctx, lastStatus);
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
      useState(setSharedComboLevel(level));
      ctx.ui.notify?.(`Combo default saved: ${level} — ${activeModesSummary(getSharedComboState())} will activate on fresh sessions.`, 'info');
    }
  }

  pi.on('session_start', async (_event, ctx) => {
    track(ctx);
    await runFirstRunSetup(ctx);
    // The configured default applies only when no persisted mode state exists.
    const entries = sessionEntries(ctx);
    const persisted = hasModeState(entries);
    if (getSharedComboState().level === 'off' && !persisted) {
      const fallback = readComboDefault();
      if (fallback !== 'off') {
        persistPreset(fallback);
        useState(setSharedComboLevel(fallback));
      }
    }
    // No sibling restores a standalone ponytail default, so apply it here; skip
    // it when the active preset already writes the same mode.
    if (!entries.some((e) => e?.type === 'custom' && e.customType === 'ponytail-mode')) {
      const ponytailFallback = readPonytailDefault();
      if (ponytailFallback !== 'off' && ponytailFallback !== getSharedComboState().ponytail) {
        pi.appendEntry?.('ponytail-mode', { mode: ponytailFallback });
        useState(setSharedComboMode('ponytail', ponytailFallback));
      }
    }
    // Announced last, so any default above is reflected.
    announceStatus(ctx, lastStatus);
  });

  // Resume, branch, and compaction re-announce; dedupe keeps repeats silent.
  for (const event of ['session_branch', 'session_tree', 'agent_start', 'session_switch', 'session_compact']) {
    onHostEvent(pi, event, async (_event, ctx) => {
      track(ctx);
      announceStatus(ctx, lastStatus);
      if (event === 'agent_start') await runFirstRunSetup(ctx);
    });
  }

  pi.on<SystemPromptEvent>('before_agent_start', async (event, ctx) => {
    if (ctx?.hasUI) reconcile(ctx);
    const mode = getSharedComboState().ponytail;
    // Match the level's own header: the shared phrase alone makes every level
    // block every other, so a `/combo` level switch is ignored all session.
    if (mode === 'off' || systemPromptIncludes(event.systemPrompt, `PONYTAIL MODE ACTIVE — level: ${mode}`)) return;
    const instruction = await loadPonytailInstructions(mode);
    // The previous level's block is replaced, not stacked on.
    const stale = lastInjected;
    lastInjected = instruction;
    return injectPromptText(pi, event, instruction, stale);
  });

  // Slash commands only; natural-language input caused accidental toggles and has no reload context.
}
