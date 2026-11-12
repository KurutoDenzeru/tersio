// /pstack session mode: injects the pstack rigor body. Opt-in, so no preset turns it on.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getSharedComboState,
  hasModeState,
  isOmpSubagentPrompt,
  lastCustomValue,
  normalizeInputCommand,
  normalizeMode,
  reconcileSharedComboEntries,
  sessionEntries,
  setSharedComboListener,
  setSharedComboMode,
  systemPromptIncludes,
} from '../shared/session-state.ts';
import { injectPromptText, onHostEvent, sessionChangeEvents, setExtensionLabel } from '../shared/host.ts';
import { announceStatus } from '../shared/status.ts';
import { readPstackDefault, saveModeState } from '../shared/plugin-settings.ts';
import { hostIdOf } from '../shared/host.ts';
import { ruleDir } from '../shared/utils.ts';
import type { ExtensionApi, ExtensionCtx, InputEvent, SessionEntry, SystemPromptEvent } from '../shared/types.ts';

const PSTACK_DIR = ruleDir('pstack', dirname(fileURLToPath(import.meta.url)));
const RULE_FILE = 'rule.md';
const DEFAULT_MODE = 'off';

// The body is immutable for the process, so read it once; reinstalling needs a restart.
let cachedInstruction: string | undefined;

function buildInstruction(): string {
  if (cachedInstruction) return cachedInstruction;
  // Fail loud: a missing body would otherwise read to the model as an active mode.
  let body: string;
  try {
    body = readFileSync(join(PSTACK_DIR, RULE_FILE), 'utf8');
  } catch {
    return `pstack mode requested, but ${RULE_FILE} is missing. Run: tersio doctor --fix extensions`;
  }
  // The rule body names the files by relative path, so one line gives the directory they sit in.
  const home = `Leaves, playbooks, and skills live at: ${PSTACK_DIR} — \`principles/<title>.md\`, \`playbooks/<title>.md\`, \`skills/<name>/SKILL.md\`, \`references/<title>.md\`.`;
  cachedInstruction = `pstack mode active for this session.\n${body}\n${home}`;
  return cachedInstruction;
}

function resolveMode(entries: SessionEntry[] | null | undefined, fallback: string = DEFAULT_MODE): string {
  return lastCustomValue(entries, 'pstack-mode', (data) => normalizeMode('pstack', data?.mode)) ?? fallback;
}

// The shared off phrase; every mode honours it, so one word clears the session.
function isOffCommand(text: unknown): boolean {
  return normalizeInputCommand(text) === 'normal mode';
}

export default function pstackSessionExtension(pi: ExtensionApi): void {
  const host = hostIdOf(pi);
  let currentMode = DEFAULT_MODE;
  let lastInjected: string | undefined = undefined;

  function setMode(mode: string, ctx?: ExtensionCtx): boolean {
    const normalized = normalizeMode('pstack', mode);
    if (!normalized) return false;
    currentMode = normalized;
    pi.appendEntry?.('pstack-mode', { mode: normalized });
    setSharedComboMode('pstack', normalized);
    saveModeState(host, getSharedComboState());
    announceStatus(ctx);
    return true;
  }

  setExtensionLabel(pi, 'pstack rigor mode');

  // Adopt a /tersio or /combo switch at once, so the next turn needs no reload.
  function syncFromShared(state: { pstack: string }): void {
    const mode = normalizeMode('pstack', state.pstack);
    if (mode) currentMode = mode;
  }
  setSharedComboListener('pstack', syncFromShared);

  pi.registerCommand?.('pstack', {
    description: 'Toggle the pstack rigor mode for this session',
    handler: async (args, ctx) => {
      const arg = String(args || '')
        .trim()
        .toLowerCase();
      if (!arg || arg === 'on') {
        setMode('on', ctx);
        return;
      }
      if (arg === 'status') {
        announceStatus(ctx);
        return;
      }
      if (!setMode(arg, ctx)) {
        ctx?.ui?.notify?.('Usage: /pstack [on|off|status]', 'warning');
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
    // Persisted state wins, then a mode already chosen, then the configured default. `off` is the start value, not unset.
    const persisted = resolveMode(entries, '');
    const alreadyChosen = currentMode !== DEFAULT_MODE;
    currentMode =
      persisted || (alreadyChosen ? currentMode : normalizeMode('pstack', readPstackDefault(host))) || DEFAULT_MODE;
    announceStatus(ctx);
  }

  // Start, resume, and branch all land here, so every session type shows it.
  pi.on('session_start', async (_event, ctx) => {
    restoreMode(ctx);
  });

  // The host adapter names the switch events it emits, so this stays free of any one host's naming.
  for (const event of sessionChangeEvents(pi)) {
    onHostEvent(pi, event, async (_event, ctx) => {
      restoreMode(ctx);
    });
  }

  pi.on('before_agent_start', async (event: SystemPromptEvent) => {
    const mode = isOmpSubagentPrompt(event.systemPrompt) ? getSharedComboState().pstack : currentMode;
    if (!mode || mode === 'off') return;
    const instruction = buildInstruction();
    // Match the whole instruction, so a re-presented prompt cannot stack it.
    if (systemPromptIncludes(event.systemPrompt, instruction)) return;
    // The previous block is replaced, not stacked on.
    const stale = lastInjected;
    lastInjected = instruction;
    return injectPromptText(pi, event, { text: instruction, staleMarker: stale, sectionTag: 'pstack' });
  });
}
