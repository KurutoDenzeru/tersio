// /combo session toggle: off | medium | balanced | max.

import path from 'node:path';
import { existsSync } from 'node:fs';
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
  setSharedComboModes,
  systemPromptIncludes,
} from '../shared/session-state.ts';
import { hostSelect, injectPromptText, onHostEvent, setExtensionLabel } from '../shared/host.ts';
import { announceStatus } from '../shared/status.ts';
import {
  isComboSetupComplete,
  readCavemanDefault,
  readComboDefault,
  readPluginSettings,
  readPonytailDefault,
  readRtkDefault,
  saveComboSetup,
} from '../shared/plugin-settings.ts';
import { findHoistedPackage, isPiProcess } from '../lib/utils.ts';
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


// Ponytail is hoisted, so one upward walk covers every install layout. The hook is CommonJS, so both namespace shapes are tried.
async function loadPonytailInstructions(mode: string): Promise<string> {
  const installed = findHoistedPackage('@dietrichgebert/ponytail', EXTENSION_DIR, 'hooks', 'ponytail-instructions.js');
  // The OpenCode tree ships no node_modules; the installer bundles the ruleset beside the extensions.
  const bundled = path.join(EXTENSION_DIR, '..', 'ponytail-bundle', 'hooks', 'ponytail-instructions.js');
  const treeLocal = installed ?? (existsSync(bundled) ? bundled : null);
  if (treeLocal) {
    try {
      const loaded = await import(pathToFileURL(treeLocal).href) as {
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
  // opencode has no UI event stream, so only its empty branch reconciles.
  const OPENCODE = pi.hostId === 'opencode';

  // Siblings restore from these entries, so the fallback must write them too.
  function persistPreset(level: string): void {
    const modes = COMBO_LEVELS[level];
    pi.appendEntry?.('caveman-mode', { mode: modes.caveman });
    pi.appendEntry?.('rtk-mode', { enabled: modes.rtk === 'on' });
    pi.appendEntry?.('ponytail-mode', { mode: modes.ponytail });
    pi.appendEntry?.('combo-level', { level });
  }
  function restoreConfiguredDefaults(): void {
    const settings = readPluginSettings();
    const hasModeDefaults = ['cavemanDefault', 'rtkDefault', 'ponytailDefault'].some((key) => key in settings);
    const combo = readComboDefault();
    const preset = COMBO_LEVELS[combo];
    const modes = hasModeDefaults
      ? { caveman: readCavemanDefault(), rtk: readRtkDefault() ? 'on' : 'off', ponytail: readPonytailDefault() }
      : preset;
    setSharedComboModes(modes);
    if (modes.caveman === 'off' && modes.rtk === 'off' && modes.ponytail === 'off') return;
    pi.appendEntry?.('caveman-mode', { mode: modes.caveman });
    pi.appendEntry?.('rtk-mode', { enabled: modes.rtk === 'on' });
    pi.appendEntry?.('ponytail-mode', { mode: modes.ponytail });
    if (preset && modes.caveman === preset.caveman && modes.rtk === preset.rtk && modes.ponytail === preset.ponytail) {
      pi.appendEntry?.('combo-level', { level: combo });
    }
  }


  function reconcile(ctx?: ExtensionCtx, resetEmpty = false): Readonly<ComboState> {
    if (!ctx?.hasUI && !(resetEmpty && OPENCODE)) return getSharedComboState();
    const entries = sessionEntries(ctx);
    if (!resetEmpty && entries.length === 0) return getSharedComboState();
    return reconcileSharedComboEntries(entries);
  }
  function listen(ctx?: ExtensionCtx): void {
    if (!ctx?.hasUI) return;
    setSharedComboListener('combo', (state) => { announceStatus(ctx); return state; });
  }
  function track(ctx?: ExtensionCtx, resetEmpty = false): void {
    listen(ctx);
    if (ctx?.hasUI || (resetEmpty && OPENCODE)) reconcile(ctx, resetEmpty);
  }

  pi.registerCommand?.('combo', {
    description: 'Toggle all 3 OMP add-ons at once. Usage: /combo <off|medium|balanced|max|status>',
    handler: async (args, ctx) => {
      listen(ctx);
      const arg = String(args || '').trim().toLowerCase();

      if (!arg || arg === 'status') {
        reconcile(ctx);
        announceStatus(ctx);
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
      setSharedComboLevel(level);
      announceStatus(ctx);
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
      setSharedComboLevel(level);
      ctx.ui.notify?.(`Combo default saved: ${level} — ${activeModesSummary(getSharedComboState())} will activate on fresh sessions.`, 'info');
    }
  }

  pi.on('session_start', async (_event, ctx) => {
    track(ctx, true);
    if (!isComboSetupComplete() && ctx?.hasUI && ctx.ui?.select) await runFirstRunSetup(ctx);
    // The configured defaults apply when a fresh session has no persisted mode state.
    const entries = sessionEntries(ctx);
    if (!hasModeState(entries) && (ctx?.hasUI || OPENCODE)) restoreConfiguredDefaults();
    // Announced last, so any default above is reflected.
    announceStatus(ctx);
  });

  // Resume, branch, and compaction re-announce; dedupe keeps repeats silent.
  for (const event of ['session_branch', 'session_tree', 'agent_start', 'session_switch', 'session_compact']) {
    onHostEvent(pi, event, async (_event, ctx) => {
      track(ctx);
      announceStatus(ctx);
      if (event === 'agent_start') await runFirstRunSetup(ctx);
    });
  }

  pi.on<SystemPromptEvent>('before_agent_start', async (event, ctx) => {
    if (ctx?.hasUI) reconcile(ctx);
    const mode = getSharedComboState().ponytail;
    // On pi the upstream ponytail pi-extension is the single injector; it reads these 'ponytail-mode' entries at session start, so Tersio only persists.
    if (isPiProcess()) return;
    // Match the level's own header: the shared phrase alone makes every level block every other, so a `/combo` level switch is ignored all session.
    if (mode === 'off' || systemPromptIncludes(event.systemPrompt, `PONYTAIL MODE ACTIVE — level: ${mode}`)) return;
    const instruction = await loadPonytailInstructions(mode);
    // The previous level's block is replaced, not stacked on.
    const stale = lastInjected;
    lastInjected = instruction;
    return injectPromptText(pi, event, instruction, stale);
  });

  // Slash commands only; natural-language input caused accidental toggles and has no reload context.
}
