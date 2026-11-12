import { readFileSync } from 'node:fs';
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
import { dirname, join } from 'node:path';
import { injectPromptText, onHostEvent, sessionChangeEvents, setExtensionLabel } from '../shared/host.ts';
import { announceStatus, formatCavemanStatus } from '../shared/status.ts';
import { readCavemanDefault, saveModeState } from '../shared/plugin-settings.ts';
import { hostIdOf } from '../shared/host.ts';
import { ruleDir } from '../shared/utils.ts';
import type { ExtensionApi, ExtensionCtx, InputEvent, SessionEntry, SystemPromptEvent } from '../shared/types.ts';

const CAVERN_DIR = ruleDir('caveman', dirname(fileURLToPath(import.meta.url)));
// `rule.md`, `rule-ultra.md`, and `rule-megacave.md` track upstream and are refetched; `lite`, `megacave-lite`, and `megacave-ultra` are our forks and ship bundled.
const RULE_FILES = {
  lite: 'rule-lite.md',
  full: 'rule.md',
  ultra: 'rule-ultra.md',
  'megacave-lite': 'rule-megacave-lite.md',
  'megacave-full': 'rule-megacave.md',
  'megacave-ultra': 'rule-megacave-ultra.md',
};

const DEFAULT_MODE = 'off';

// A rule file is immutable for the process, so read each level once; reinstalling needs a restart.
const instructionCache = new Map<string, string>();

function buildInstruction(mode: string): string {
  const cached = instructionCache.get(mode);
  if (cached) return cached;
  const name = RULE_FILES[mode as keyof typeof RULE_FILES] ?? RULE_FILES.full;
  // Fail loud: a wrong rule reads to the model as the real one.
  let body: string;
  try {
    body = readFileSync(join(CAVERN_DIR, name), 'utf8');
  } catch {
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
  const host = hostIdOf(pi);
  let currentMode = DEFAULT_MODE;
  let lastInjected: string | undefined = undefined;

  function setMode(mode: string, ctx?: ExtensionCtx): boolean {
    const normalized = normalizeMode('caveman', mode);
    if (!normalized) return false;
    currentMode = normalized;
    pi.appendEntry?.('caveman-mode', { mode: normalized });
    setSharedComboMode('caveman', normalized);
    saveModeState(host, getSharedComboState());
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
      const arg = String(args || '')
        .trim()
        .toLowerCase();
      if (!arg || arg === 'on') {
        setMode('full', ctx);
        return;
      }
      if (arg === 'status') {
        announceStatus(ctx);
        // The footer carries one line, so the mode is answered here instead of standing as a second status key.
        ctx?.ui?.notify?.(formatCavemanStatus(currentMode), 'info');
        return;
      }
      if (!setMode(arg, ctx)) {
        ctx?.ui?.notify?.(
          'Usage: /caveman [lite|full|ultra|megacave-lite|megacave-full|megacave-ultra|off|status]',
          'warning',
        );
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
    // Persisted state wins, then a mode already chosen, then the default. `off` is the start value, not unset.
    const persisted = resolveMode(entries, '');
    const alreadyChosen = currentMode !== DEFAULT_MODE;
    currentMode =
      persisted || (alreadyChosen ? currentMode : normalizeMode('caveman', readCavemanDefault(host))) || DEFAULT_MODE;
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
