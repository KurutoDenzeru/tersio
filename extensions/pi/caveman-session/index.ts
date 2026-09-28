// Caveman mode on Pi. Port of extensions/caveman-session/index.ts: same levels,
// /caveman command, `caveman` status key, combo suppression and restore
// precedence. The Pi-only differences: the text goes into a sealed section
// because returning systemPrompt would replace the whole prompt; session_start
// and session_tree both restore because there is no session_branch; setLabel
// labels entries, not extensions, so it is dropped; and Pi has no subagent
// surface, so every turn is the parent turn.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  activeModesSummary,
  getSharedComboState,
  injectPiSection,
  isComboPresetActive,
  lastCustomValue,
  notify,
  normalizeInputCommand,
  normalizeMode,
  paintStatusBar,
  paintableCtx,
  reconcileSharedComboEntries,
  sessionEntries,
  setSharedComboListener,
  setSharedComboMode,
} from '../shared/pi-session-state.ts';
import { readCavemanDefault } from '../shared/plugin-settings.ts';
import type { ExtensionCtx, PiBeforeAgentStartEvent, PiExtensionAPI, PiInputEvent, SessionEntry } from '../shared/pi-types.ts';

// Sealed section: this file writes `tersio-caveman` and nothing else.
const SECTION = 'tersio-caveman';

const EXT_DIR = dirname(fileURLToPath(import.meta.url));
// rule.md is written beside this module by the installer.
const RULE_PATH = join(EXT_DIR, 'rule.md');

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

export default function cavemanSessionExtension(pi: PiExtensionAPI): void {
  let currentMode = DEFAULT_MODE;
  let isActive = false;
  let lastCtx: ExtensionCtx | undefined = undefined;

  function syncStatus(ctx?: ExtensionCtx): void {
    // Pi's footer is terminal-only; an absent mode still paints.
    if (ctx && ctx.mode !== undefined && ctx.mode !== 'tui') return;
    lastCtx = paintableCtx(lastCtx, ctx);
    const c = lastCtx;
    if (!c?.ui?.setStatus) return;
    // Combo owns the bar when any preset is active; keep ours empty to avoid duplication.
    if (isComboPresetActive() || currentMode === 'off') {
      c.ui.setStatus('caveman', undefined);
      return;
    }
    // Theme from the context that can actually paint, which is not always the
    // incoming one.
    paintStatusBar(c.ui, 'caveman', '🪨', `caveman: ${currentMode.toUpperCase()}`, isActive, c.ui.theme);
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
    notify(ctx, msg);
    return true;
  }

  // Live mirror of shared state, so a /combo or /tersio switch lands on the
  // next turn with no reload. The bridge is a process-global symbol: one Pi
  // process is one realm.
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
        notify(ctx, `Caveman: ${currentMode}`);
        return;
      }
      if (!setMode(arg, ctx)) {
        notify(ctx, 'Usage: /caveman [lite|full|ultra|wenyan-lite|wenyan-full|wenyan-ultra|off|status]', 'warning');
      }
    },
  });

  pi.on?.('input', (event) => {
    const e = event as PiInputEvent;
    if (e?.source === 'extension') return;
    if (currentMode !== 'off' && isOffCommand(e?.text)) setMode('off');
  });

  function restoreMode(ctx?: ExtensionCtx): void {
    const entries = sessionEntries(ctx);
    // Publish the persisted combo state before painting: bar suppression reads
    // the in-process bridge, which is empty until the combo extension
    // reconciles, and that reconcile is UI-gated.
    reconcileSharedComboEntries(entries);
    const persisted = resolveMode(entries, '');
    currentMode = persisted || normalizeMode('caveman', readCavemanDefault()) || DEFAULT_MODE;
    syncStatus(ctx);
  }

  pi.on?.('session_start', (_event, ctx) => {
    restoreMode(ctx);
    notify(ctx, `Caveman loaded: ${currentMode}`);
  });

  pi.on?.('session_tree', (_event, ctx) => {
    restoreMode(ctx);
  });

  pi.on?.('agent_start', (_event, ctx) => {
    isActive = true;
    syncStatus(ctx);
  });

  pi.on?.('agent_end', (_event, ctx) => {
    isActive = false;
    syncStatus(ctx);
  });

  pi.on?.('before_agent_start', (event) => {
    const e = event as PiBeforeAgentStartEvent;
    const def = currentMode === 'off' ? undefined : INSTRUCTIONS[currentMode];
    // Always write, empty when off: Pi omits falsy content, so the mode
    // switches off in one write instead of leaving a stale section behind.
    injectPiSection(e, SECTION, def ? (typeof def === 'function' ? def() : def) : '');
  });
}
