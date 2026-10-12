import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getSharedComboState, hasModeState, isOmpSubagentPrompt, lastCustomValue, normalizeInputCommand, normalizeMode, reconcileSharedComboEntries, sessionEntries, setSharedComboListener, setSharedComboMode, systemPromptIncludes } from '../shared/session-state.ts';
import { dirname, join } from 'node:path';
import { injectPromptText, onHostEvent, setExtensionLabel } from '../shared/host.ts';
import { announceStatus } from '../shared/status.ts';
import { readCavemanDefault } from '../shared/plugin-settings.ts';
import type { ExtensionApi, ExtensionCtx, InputEvent, SessionEntry, SystemPromptEvent } from '../shared/types.ts';

const CAVERN_DIR = dirname(fileURLToPath(import.meta.url));
// Upstream ships one skill per register: default, ultracave, megacave.
const RULE_FILES = { lite: 'rule.md', full: 'rule.md', ultra: 'rule-ultra.md', 'megacave-lite': 'rule-megacave.md', 'megacave-full': 'rule-megacave.md', 'megacave-ultra': 'rule-megacave.md' };

const DEFAULT_MODE = 'off';

// A rule file is immutable for the process, so read each level once; reinstalling needs a restart.
const instructionCache = new Map<string, string>();

function buildInstruction(mode: string): string {
  const cached = instructionCache.get(mode);
  if (cached) return cached;
  const name = RULE_FILES[mode as keyof typeof RULE_FILES] ?? RULE_FILES.full;
  // Fail loud: a wrong rule reads to the model as the real one.
  let body: string;
  try { body = readFileSync(join(CAVERN_DIR, name), 'utf8'); } catch {
    return `Caveman ${mode} requested, but ${name} is missing. Run: tersio doctor --fix extensions`;
  }
  const instruction = `Caveman ${mode} active for this session.\n${body}`;
  instructionCache.set(mode, instruction);
  return instruction;
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

  function setMode(mode: string, ctx?: ExtensionCtx): boolean {
    const normalized = normalizeMode('caveman', mode);
    if (!normalized) return false;
    currentMode = normalized;
    pi.appendEntry?.('caveman-mode', { mode: normalized });
    setSharedComboMode('caveman', normalized);
    announceStatus(ctx);
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
        announceStatus(ctx);
        return;
      }
      if (!setMode(arg, ctx)) {
        ctx?.ui?.notify?.('Usage: /caveman [lite|full|ultra|megacave-lite|megacave-full|megacave-ultra|off|status]', 'warning');
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
    announceStatus(ctx);
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
    return injectPromptText(pi, event, { text: instruction, staleMarker: stale, sectionTag: 'caveman' });
  });
}
