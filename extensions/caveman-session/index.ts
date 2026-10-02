import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getSharedComboState, hasModeState, isOmpSubagentPrompt, lastCustomValue, normalizeInputCommand, normalizeMode, reconcileSharedComboEntries, sessionEntries, setSharedComboListener, setSharedComboMode, systemPromptIncludes } from '../shared/session-state.ts';
import { dirname, join } from 'node:path';
import { injectPromptText, onHostEvent, setExtensionLabel } from '../shared/host.ts';
import { announceStatus } from '../shared/status.ts';
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

// Upstream ships one SKILL.md; the level is a directive inside it, so swap only the header.
function buildInstruction(mode: string): string {
  return `Caveman ${mode} active for this session.\n${readFullRule()}`;
}

function resolveMode(entries: SessionEntry[] | null | undefined, fallback: string = DEFAULT_MODE): string {
  return lastCustomValue(entries, 'caveman-mode', (data) => normalizeMode('caveman', data?.mode)) ?? fallback;
}

function isOffCommand(text: unknown): boolean {
  const t = normalizeInputCommand(text);
  return t === 'stop caveman' || t === 'normal mode' || t === 'caveman off';
}

export default function cavemanSessionExtension(pi: ExtensionApi): void {
  let currentMode = DEFAULT_MODE;
  let lastInjected: string | undefined = undefined;
  const lastStatus = { value: '' };

  function setMode(mode: string, ctx?: ExtensionCtx): boolean {
    const normalized = normalizeMode('caveman', mode);
    if (!normalized) return false;
    currentMode = normalized;
    pi.appendEntry?.('caveman-mode', { mode: normalized });
    setSharedComboMode('caveman', normalized);
    announceStatus(ctx, lastStatus);
    return true;
  }

  setExtensionLabel(pi, 'Caveman session toggle');

  // Adopt a /tersio or /combo switch at once, so the next turn needs no reload.
  function syncFromShared(state: { caveman: string }): void {
    const mode = normalizeMode('caveman', state.caveman);
    if (mode) currentMode = mode;
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
        announceStatus(ctx, { value: '' });
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
    // Persisted state wins, then a mode already chosen this session, then the configured default. `off` is the start value, not "unset".
    const persisted = resolveMode(entries, '');
    const alreadyChosen = currentMode !== DEFAULT_MODE;
    currentMode = persisted || (alreadyChosen ? currentMode : normalizeMode('caveman', readCavemanDefault())) || DEFAULT_MODE;
    announceStatus(ctx, lastStatus);
  }

  // Start, resume, and branch all land here, so every session type shows it.
  pi.on('session_start', async (_event, ctx) => {
    restoreMode(ctx);
  });

  onHostEvent(pi, 'session_branch', async (_event, ctx) => {
    restoreMode(ctx);
  });

  pi.on('session_tree', async (_event, ctx) => {
    restoreMode(ctx);
  });

  onHostEvent(pi, 'session_switch', async (_event, ctx) => {
    restoreMode(ctx);
  });

  onHostEvent(pi, 'session_compact', async (_event, ctx) => {
    restoreMode(ctx);
  });

  pi.on('before_agent_start', async (event: SystemPromptEvent) => {
    const mode = isOmpSubagentPrompt(event.systemPrompt) ? getSharedComboState().caveman : currentMode;
    if (!mode || mode === 'off') return;
    const instruction = buildInstruction(mode);
    // Match the whole instruction so a re-presented prompt cannot stack it.
    if (systemPromptIncludes(event.systemPrompt, instruction)) return;
    // The previous level's block is replaced, not stacked on.
    const stale = lastInjected;
    lastInjected = instruction;
    return injectPromptText(pi, event, instruction, stale);
  });
}
