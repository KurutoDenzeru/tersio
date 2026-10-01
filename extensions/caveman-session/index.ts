import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { activeModesSummary, getSharedComboState, hasModeState, isComboPresetActive, isOmpSubagentPrompt, lastCustomValue, normalizeInputCommand, normalizeMode, paintStatusBar, paintableCtx, reconcileSharedComboEntries, sessionEntries, setSharedComboListener, setSharedComboMode, statusUi, systemPromptIncludes } from '../shared/session-state.ts';
import { dirname, join } from 'node:path';
import { injectPromptText, onHostEvent, setExtensionLabel } from '../shared/host.ts';
import { readCavemanDefault } from '../shared/plugin-settings.ts';
import type { ExtensionApi, ExtensionCtx, InputEvent, SessionEntry, SystemPromptEvent } from '../shared/types.ts';

const CAVERN_DIR = dirname(fileURLToPath(import.meta.url));
const RULE_PATH = join(CAVERN_DIR, 'rule.md');

// Fail loud: a wrong rule reads to the model as the real one.
function readFullRule(): string {
  try { return readFileSync(RULE_PATH, 'utf8'); } catch {
    return 'Caveman full requested, but rule.md is missing. Run: tersio doctor --fix extensions';
  }
}

const DEFAULT_MODE = 'off';
const INSTRUCTIONS: Record<string, string | (() => string)> = {
  lite: `Caveman lite active for this session.
Respond concise. Drop pleasantries, filler, and hedging. Keep complete technical substance. Code, commands, paths, errors, commits, and PR text stay normal/exact.`,
  full: () => `Caveman full active for this session.\n${readFullRule()}`,
  ultra: `Caveman ultra active for this session.
Maximum terse prose. Strip conjunctions only when meaning stays clear. State each fact once. Use no invented abbreviations or causal arrows. Keep code, commands, commits, PR text, paths, API names, numbers, units, and errors exact. Drop caveman for security warnings, irreversible actions, ambiguous multi-step sequences, or user confusion.`,
  'wenyan-lite': `Caveman wenyan-lite active for this session. Use semi-classical terse prose. Keep grammar structure, user language, technical terms, code, commands, paths, API names, numbers, units, and errors exact. Drop caveman when clarity or safety needs normal prose.`,
  'wenyan-full': `Caveman wenyan-full active for this session. Use maximum classical terseness where meaning stays clear. Use classical sentence patterns, verbs before objects, and optional omitted subjects. Keep user language, technical terms, code, commands, paths, API names, numbers, units, and errors exact. Drop caveman when clarity or safety needs normal prose.`,
  'wenyan-ultra': `Caveman wenyan-ultra active for this session. Use extreme classical abbreviation while keeping a classical Chinese feel and meaning clear. Keep user language, technical terms, code, commands, paths, API names, numbers, units, and errors exact. Drop caveman when clarity or safety needs normal prose.`,
};

function resolveMode(entries: SessionEntry[] | null | undefined, fallback: string = DEFAULT_MODE): string {
  return lastCustomValue(entries, 'caveman-mode', (data) => normalizeMode('caveman', data?.mode)) ?? fallback;
}

function isOffCommand(text: unknown): boolean {
  const t = normalizeInputCommand(text);
  return t === 'stop caveman' || t === 'normal mode' || t === 'caveman off';
}

export default function cavemanSessionExtension(pi: ExtensionApi): void {
  let currentMode = DEFAULT_MODE;
  let isActive = false;
  let lastCtx: ExtensionCtx | undefined = undefined;
  let lastInjected: string | undefined = undefined;

  function syncStatus(ctx?: ExtensionCtx): void {
    lastCtx = paintableCtx(lastCtx, ctx);
    const ui = statusUi(lastCtx);
    if (!ui) return;
    // Combo owns the bar when any preset is active; keep ours empty to avoid duplication.
    if (isComboPresetActive() || currentMode === 'off') {
      ui.setStatus('caveman', undefined);
      return;
    }
    paintStatusBar(ui, 'caveman', '🪨', `caveman: ${currentMode.toUpperCase()}`, isActive);
  }

  function setMode(mode: string, ctx?: ExtensionCtx): boolean {
    const normalized = normalizeMode('caveman', mode);
    if (!normalized) return false;
    currentMode = normalized;
    pi.appendEntry?.('caveman-mode', { mode: normalized });
    setSharedComboMode('caveman', normalized);
    syncStatus(ctx);
    const active = activeModesSummary(getSharedComboState());
    const msg = normalized === 'off'
      ? `Caveman off. Active: ${active}.`
      : `Caveman ${normalized} on — terse replies for this session. Active: ${active}.`;
    ctx?.ui?.notify?.(msg, 'info');
    return true;
  }

  setExtensionLabel(pi, 'Caveman session toggle');

  // Adopt a /tersio or /combo switch at once, so the next turn needs no reload.
  function syncFromShared(state: { caveman: string }): void {
    const mode = normalizeMode('caveman', state.caveman);
    if (mode) {
      currentMode = mode;
      syncStatus();
    }
  }
  setSharedComboListener('caveman', syncFromShared);
  pi.registerCommand?.('caveman', {
    description: 'Toggle terse caveman replies for this session',
    handler: async (args, ctx) => {
      const arg = String(args || '').trim().toLowerCase();
      if (!arg || arg === 'on') {
        setMode('full', ctx);
        return;
      }
      if (arg === 'status') {
        ctx?.ui?.notify?.(`Caveman: ${currentMode}`, 'info');
        return;
      }
      if (!setMode(arg, ctx)) {
        ctx?.ui?.notify?.('Usage: /caveman [lite|full|ultra|wenyan-lite|wenyan-full|wenyan-ultra|off|status]', 'warning');
      }
    },
  });

  onHostEvent<InputEvent>(pi, 'input', async (event) => {
    if (event?.source === 'extension') return;
    if (currentMode !== 'off' && isOffCommand(event?.text)) setMode('off');
  });

  function restoreMode(ctx?: ExtensionCtx): void {
    const entries = sessionEntries(ctx);
    // A subagent's branch has no Tersio entries; reconciling it would wipe shared state.
    if (hasModeState(entries)) reconcileSharedComboEntries(entries);
    // Persisted state wins, then a mode already chosen this session, then the
    // configured default. `off` is the start value, not "unset".
    const persisted = resolveMode(entries, '');
    const alreadyChosen = currentMode !== DEFAULT_MODE;
    currentMode = persisted || (alreadyChosen ? currentMode : normalizeMode('caveman', readCavemanDefault())) || DEFAULT_MODE;
    syncStatus(ctx);
  }

  pi.on('session_start', async (_event, ctx) => {
    restoreMode(ctx);
    ctx?.ui?.notify?.(`Caveman loaded: ${currentMode}`, 'info');
  });

  onHostEvent(pi, 'session_branch', async (_event, ctx) => {
    restoreMode(ctx);
  });

  pi.on('session_tree', async (_event, ctx) => {
    restoreMode(ctx);
  });

  pi.on('agent_start', async (_event, ctx) => {
    isActive = true;
    syncStatus(ctx);
  });

  pi.on('agent_end', async (_event, ctx) => {
    isActive = false;
    syncStatus(ctx);
  });

  pi.on('before_agent_start', async (event: SystemPromptEvent) => {
    const mode = isOmpSubagentPrompt(event.systemPrompt) ? getSharedComboState().caveman : currentMode;
    if (!mode || mode === 'off') return;
    const def = INSTRUCTIONS[mode];
    if (!def) return;
    const instruction = typeof def === 'function' ? def() : def;
    // Skip when already present, so a host that re-presents the mutated prompt
    // cannot stack it; matching the whole instruction keeps upstream rule.md intact.
    if (systemPromptIncludes(event.systemPrompt, instruction)) return;
    // The previous level's block is replaced, not stacked on.
    const stale = lastInjected;
    lastInjected = instruction;
    return injectPromptText(pi, event, instruction, stale);
  });
}
