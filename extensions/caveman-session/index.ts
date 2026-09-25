import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { activeModesSummary, asPromptArray, getSharedComboState, isComboPresetActive, isOmpSubagentPrompt, lastCustomValue, normalizeInputCommand, normalizeMode, paintStatusBar, paintableCtx, reconcileSharedComboEntries, registerSessionLifecycle, sessionEntries, setSharedComboListener, setSharedComboMode } from '../shared/session-state.ts';
import { dirname, join } from 'node:path';
import { readCavemanDefault } from '../shared/plugin-settings.ts';
import type { ExtensionApi, ExtensionCtx, InputEvent, SessionEntry, SystemPromptEvent } from '../shared/types.ts';

const CAVERN_DIR = dirname(fileURLToPath(import.meta.url));
const RULE_PATH = join(CAVERN_DIR, 'rule.md');

const FALLBACK_FULL_RULE = `Caveman full active for this session.
Respond terse like smart caveman. Keep all technical substance. Drop filler, pleasantries, and hedging.

Rules:
- Drop articles where meaning stays clear. Keep fragments and short sentences.
- Keep technical terms, code, commands, paths, API names, numbers, units, and errors exact.
- Never invent abbreviations or causal arrows. Do not add words to sound caveman.
- Use ASD-STE100 Simplified Technical English. Keep one idea per sentence, target 20 words, active voice, and consistent terms.
- Make no tool-call narration. Use no decorative tables or emoji.
- Preserve the user's reply language. Compress style, not language.
- Drop caveman for security warnings, irreversible actions, ambiguous multi-step sequences, or requests to clarify.
- Write code, comments, commits, docs, issues, pull requests, and third-party messages in normal prose.

Default: **full**. Switch: \`/caveman lite|full|ultra|wenyan-lite|wenyan-full|wenyan-ultra|off\`. Stop: "stop caveman" or "normal mode".`;

// ponytail: synchronous read each full-mode injection; ceiling = small file, cold session start. Upgrade path: cache file contents + mtime, invalidate on change.
function readFullRule(): string {
  try { return readFileSync(RULE_PATH, 'utf8'); } catch { return FALLBACK_FULL_RULE; }
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

  function syncStatus(ctx?: ExtensionCtx): void {
    lastCtx = paintableCtx(lastCtx, ctx);
    const c = lastCtx;
    if (!c?.ui?.setStatus) return;
    // Combo owns the bar when any preset is active; keep ours empty to avoid duplication.
    if (isComboPresetActive() || currentMode === 'off') {
      c.ui.setStatus('caveman', undefined);
      return;
    }
    paintStatusBar(c.ui, 'caveman', '🪨', `caveman: ${currentMode.toUpperCase()}`, isActive);
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

  pi.setLabel?.('Caveman session toggle');

  // Live mirror: a /tersio or /combo switch publishes shared state — adopt
  // it at once so the next turn injects the new mode with no session reload.
  // Stable identity, so the bridge set dedupes across re-inits.
  function syncFromShared(state: { caveman: string }): void {
    const mode = normalizeMode('caveman', state.caveman);
    if (mode) {
      currentMode = mode;
      syncStatus();
    }
  }
  setSharedComboListener(syncFromShared);
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

  pi.on<InputEvent>('input', async (event) => {
    if (event?.source === 'extension') return;
    if (currentMode !== 'off' && isOffCommand(event?.text)) setMode('off');
  });

  function restoreMode(ctx?: ExtensionCtx): void {
    const entries = sessionEntries(ctx);
    // Publish the persisted combo state (incl. combo-level) before painting:
    // bar suppression reads the in-process bridge, which is empty in a fresh
    // host until the combo extension reconciles — and its reconcile is
    // UI-gated. Deriving it here makes suppression independent of load order.
    reconcileSharedComboEntries(entries);
    // Persisted session state wins; a fresh session falls back to the
    // installer/user-configured default (off unless configured).
    const persisted = resolveMode(entries, '');
    currentMode = persisted || normalizeMode('caveman', readCavemanDefault()) || DEFAULT_MODE;
    syncStatus(ctx);
  }

  registerSessionLifecycle(pi, {
    restore: restoreMode,
    notify: (ctx) => { ctx?.ui?.notify?.(`Caveman loaded: ${currentMode}`, 'info'); },
    onTurnStart: (ctx) => { isActive = true; syncStatus(ctx); },
    onTurnEnd: (ctx) => { isActive = false; syncStatus(ctx); },
  });

  pi.on('before_agent_start', async (event: SystemPromptEvent) => {
    const mode = isOmpSubagentPrompt(event.systemPrompt) ? getSharedComboState().caveman : currentMode;
    if (!mode || mode === 'off') return;
    const def = INSTRUCTIONS[mode];
    if (!def) return;
    const instruction = typeof def === 'function' ? def() : def;
    const base = asPromptArray(event.systemPrompt);
    return { systemPrompt: [...base, instruction] };
  });
}
